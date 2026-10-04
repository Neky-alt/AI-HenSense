"""History deletion endpoints and the fixed 30-day image retention."""
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_user
from app.config import settings
from app.database import Base, get_db
from app.farm_access import owned_cloud_farms
from app.main import app
from app.models import Detection, Device, Farm, Profile, utcnow
from app.services import detection_deletion
from app.services.detection_deletion import apply_image_retention, maybe_apply_image_retention

USER = "00000000-0000-0000-0000-00000000000a"
OTHER = "00000000-0000-0000-0000-00000000000b"
FARM = "10000000-0000-0000-0000-00000000000a"
OTHER_FARM = "10000000-0000-0000-0000-00000000000b"
DEVICE = "20000000-0000-0000-0000-0000000000a1"
OTHER_DEVICE = "20000000-0000-0000-0000-0000000000b1"
HARDWARE_KEY = "test-hardware-key"


def _detection(device_id, detected_at, name, **extra):
    return Detection(
        device_id=device_id, detected_at=detected_at, trigger_type="manual",
        capture_source_type="pi_camera", total_count=2, normal_count=1, low_count=1,
        monitoring_status="normal", image_path=f"{device_id}/{name}.jpg",
        annotated_image_path=f"{device_id}/{name}-annotated.png", sync_status="synced", **extra,
    )


@pytest.fixture
def env(tmp_path, monkeypatch):
    media = tmp_path / "media"
    monkeypatch.setattr(settings, "LOCAL_IMAGE_DIR", str(media))
    monkeypatch.setattr(settings, "HARDWARE_API_KEY", HARDWARE_KEY)
    detection_deletion.reset_retention_throttle()

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    now = utcnow()
    db.add_all([
        Profile(user_id=USER), Profile(user_id=OTHER),
        Farm(farm_id=FARM, user_id=USER, farm_name="A"),
        Farm(farm_id=OTHER_FARM, user_id=OTHER, farm_name="B"),
    ])
    db.flush()
    db.add_all([
        Device(device_id=DEVICE, farm_id=FARM, device_code="CAGE-01", farming_type="caged", last_seen_at=now),
        Device(device_id=OTHER_DEVICE, farm_id=OTHER_FARM, device_code="CAGE-B", farming_type="caged"),
    ])
    db.flush()
    rows = {
        "recent": _detection(DEVICE, now - timedelta(days=1), "recent"),
        "old": _detection(DEVICE, now - timedelta(days=31), "old"),
        "other": _detection(OTHER_DEVICE, now - timedelta(days=1), "other"),
    }
    db.add_all(rows.values())
    db.commit()
    ids = {key: row.detection_id for key, row in rows.items()}
    for row in rows.values():
        for rel in (row.image_path, row.annotated_image_path):
            (media / rel).parent.mkdir(parents=True, exist_ok=True)
            (media / rel).write_bytes(b"img")

    def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[current_user] = lambda: USER
    app.dependency_overrides[owned_cloud_farms] = lambda: [FARM]
    try:
        yield TestClient(app), db, ids, media
    finally:
        app.dependency_overrides.clear()
        detection_deletion.reset_retention_throttle()
        db.close()
        engine.dispose()


def _row(db, detection_id):
    return db.connection().exec_driver_sql(
        "SELECT image_deleted_at, deleted_at, sync_status FROM detections WHERE detection_id=?",
        (detection_id,),
    ).first()


def test_delete_image_keeps_record_and_marks_for_cloud_sync(env):
    client, db, ids, media = env
    response = client.delete(f"/api/v1/devices/{DEVICE}/detections/{ids['recent']}/image")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["image_deleted_at"] is not None
    assert data["total_count"] == 2
    image_deleted_at, deleted_at, sync_status = _row(db, ids["recent"])
    assert image_deleted_at is not None and deleted_at is None and sync_status == "pending"
    assert not (media / DEVICE / "recent.jpg").exists()
    assert not (media / DEVICE / "recent-annotated.png").exists()
    history = client.get(f"/api/v1/devices/{DEVICE}/detections").json()["data"]
    assert ids["recent"] in [item["detection_id"] for item in history]
    assert client.get(f"/api/v1/devices/{DEVICE}/detections/{ids['recent']}/image").status_code == 404
    # Idempotent
    assert client.delete(f"/api/v1/devices/{DEVICE}/detections/{ids['recent']}/image").status_code == 200


def test_delete_record_hides_it_and_removes_images(env):
    client, db, ids, media = env
    response = client.delete(f"/api/v1/devices/{DEVICE}/detections/{ids['recent']}")
    assert response.status_code == 200, response.text
    assert response.json()["data"] == {"detection_id": ids["recent"], "deleted": True}
    image_deleted_at, deleted_at, sync_status = _row(db, ids["recent"])
    assert image_deleted_at is not None and deleted_at is not None and sync_status == "pending"
    assert not (media / DEVICE / "recent.jpg").exists()
    history = client.get(f"/api/v1/devices/{DEVICE}/detections").json()["data"]
    assert ids["recent"] not in [item["detection_id"] for item in history]
    assert client.delete(f"/api/v1/devices/{DEVICE}/detections/{ids['recent']}").status_code == 404


@pytest.mark.parametrize("suffix", ["", "/image"])
def test_cannot_delete_other_users_or_mismatched_detections(env, suffix):
    client, db, ids, media = env
    assert client.delete(f"/api/v1/devices/{OTHER_DEVICE}/detections/{ids['other']}{suffix}").status_code == 404
    assert client.delete(f"/api/v1/devices/{DEVICE}/detections/{ids['other']}{suffix}").status_code == 404
    assert _row(db, ids["other"]) == (None, None, "synced")
    assert (media / OTHER_DEVICE / "other.jpg").exists()


def test_retention_expires_only_images_older_than_30_days(env):
    client, db, ids, media = env
    assert apply_image_retention(db) == 1
    image_deleted_at, deleted_at, sync_status = _row(db, ids["old"])
    assert image_deleted_at is not None and deleted_at is None and sync_status == "pending"
    assert not (media / DEVICE / "old.jpg").exists()
    assert not (media / DEVICE / "old-annotated.png").exists()
    assert _row(db, ids["recent"]) == (None, None, "synced")
    assert (media / DEVICE / "recent.jpg").exists()
    assert apply_image_retention(db) == 0  # already expired


def test_retention_is_throttled(env):
    client, db, ids, media = env
    now = utcnow()
    assert maybe_apply_image_retention(db, now=now) == 1
    assert maybe_apply_image_retention(db, now=now + timedelta(minutes=10)) is None
    assert maybe_apply_image_retention(db, now=now + timedelta(minutes=61)) == 0


def test_heartbeat_triggers_retention(env):
    client, db, ids, media = env
    response = client.post(f"/api/v1/hardware/devices/{DEVICE}/heartbeat", headers={"X-Hardware-Key": HARDWARE_KEY})
    assert response.status_code == 200
    assert _row(db, ids["old"])[0] is not None
    assert not (media / DEVICE / "old.jpg").exists()
