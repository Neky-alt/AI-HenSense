"""Local retained Detection Image tests; no AI service or Pi hardware needed."""
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.auth import current_user
from app.farm_access import owned_cloud_farms
from app.database import Base, get_db
from app.main import app
from app.models import Device, Farm, Profile, utcnow
from app.services.ai_adapter import AIInferenceResult, get_ai_adapter
from app.services.capture_adapter import CapturedFrame, get_capture_adapter

# Minimal JPEG marker bytes adequate for HTTP media storage test (not AI decoding).
JPEG = b"\xff\xd8\xff" + b"fixture-only"


class FakeCapture:
    def capture(self, device):
        return CapturedFrame(content=JPEG, filename="cage.jpg", content_type="image/jpeg", captured_at=utcnow())


class FakeAI:
    def infer(self, device, frame):
        return AIInferenceResult(total_count=2, normal_count=1, low_count=1)


@pytest.fixture
def media_env(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "LOCAL_IMAGE_DIR", str(tmp_path / "media"))
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()
    uid = "00000000-0000-0000-0000-000000000001"
    fid = "10000000-0000-0000-0000-000000000001"
    did = "20000000-0000-0000-0000-000000000001"
    db.add(Profile(user_id=uid, display_name="Test"))
    db.add(Farm(farm_id=fid, user_id=uid, farm_name="Farm"))
    db.flush()
    db.add(Device(device_id=did, farm_id=fid, device_code="CAGE-01", farming_type="caged", last_seen_at=utcnow()))
    db.commit()
    def _db():
        yield db
    app.dependency_overrides[current_user] = lambda: uid
    app.dependency_overrides[owned_cloud_farms] = lambda: [fid]
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_capture_adapter] = lambda: FakeCapture()
    app.dependency_overrides[get_ai_adapter] = lambda: FakeAI()
    try:
        yield TestClient(app), db, did, tmp_path / "media"
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()


def test_detection_saves_original_image_and_access_url(media_env):
    client, db, did, root = media_env
    resp = client.post(f"/api/v1/devices/{did}/detect")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["image_path"] is not None
    assert data["image_url"].endswith(f"/detections/{data['detection_id']}/image")
    assert (root / data["image_path"]).read_bytes() == JPEG
    fetched = client.get(data["image_url"])
    assert fetched.status_code == 200
    assert fetched.headers["content-type"] == "image/jpeg"
    assert fetched.content == JPEG
    assert client.get(f"/api/v1/devices/{did}/detections/latest").json()["data"]["image_path"] == data["image_path"]


def test_image_route_rejects_missing_or_deleted(media_env):
    client, db, did, root = media_env
    result = client.post(f"/api/v1/devices/{did}/detect").json()["data"]
    from app.models import Detection
    item = db.get(Detection, result["detection_id"])
    item.image_deleted_at = utcnow()
    db.commit()
    assert client.get(result["image_url"]).status_code == 404
    item.image_deleted_at = None
    db.commit()
    (root / result["image_path"]).unlink()
    assert client.get(result["image_url"]).status_code == 404


def test_image_route_rejects_wrong_device_and_path_traversal(media_env):
    client, db, did, root = media_env
    result = client.post(f"/api/v1/devices/{did}/detect").json()["data"]
    assert client.get(result["image_url"].replace(did,"20000000-0000-0000-0000-000000000099")).status_code == 404
    from app.models import Detection
    item = db.get(Detection, result["detection_id"])
    item.image_path = "../../.env"
    db.commit()
    assert client.get(result["image_url"]).status_code == 404


def test_invalid_image_size_does_not_create_detection(media_env, monkeypatch):
    client, db, did, root = media_env
    monkeypatch.setattr(settings,"MAX_DETECTION_IMAGE_BYTES", 2)
    result = client.post(f"/api/v1/devices/{did}/detect")
    assert result.status_code == 507
    assert result.json()["error"]["code"] == "IMAGE_STORAGE_FAILED"
    assert list(root.rglob("*.jpg")) == [] if root.exists() else True
