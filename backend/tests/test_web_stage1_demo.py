"""Exercise the isolated demo through the unchanged Backend read APIs."""
from pathlib import Path

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import settings
from app.auth import current_user
from app.database import get_db
from app.farm_access import owned_cloud_farms
from app.main import app
from scripts.seed_web_stage1_demo import create_demo, demo_id, demo_png


@pytest.fixture
def demo(tmp_path, monkeypatch):
    configured_db = tmp_path / "existing.sqlite3"
    configured_db.write_bytes(b"existing database must not be touched")
    monkeypatch.setattr(settings, "DATABASE_URL", f"sqlite:///{configured_db}")
    manifest = create_demo(tmp_path / "isolated")
    assert configured_db.read_bytes() == b"existing database must not be touched"
    monkeypatch.setattr(settings, "LOCAL_IMAGE_DIR", manifest["media"])
    engine = create_engine(f"sqlite:///{manifest['database']}", connect_args={"check_same_thread": False})

    def session():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = session
    # Read APIs require the verified farm owner; the demo seeds a deterministic owner.
    app.dependency_overrides[current_user] = lambda: demo_id("user")
    app.dependency_overrides[owned_cloud_farms] = lambda: [demo_id("farm")]
    try:
        yield TestClient(app), manifest
    finally:
        for dependency in (get_db, current_user, owned_cloud_farms):
            app.dependency_overrides.pop(dependency, None)
        engine.dispose()


def test_refuses_existing_output_without_overwriting(tmp_path):
    marker = tmp_path / "keep.txt"
    marker.write_text("keep")
    with pytest.raises(FileExistsError):
        create_demo(tmp_path)
    assert marker.read_text() == "keep"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["keep.txt"]


def test_demo_covers_online_offline_normal_warning_and_empty(demo):
    client, manifest = demo
    rows = client.get("/api/v1/devices").json()["data"]
    by_code = {row["device_code"]: row for row in rows}
    assert len(rows) == 7
    assert all(row["device_name"].startswith("DEMO ONLY") for row in rows)
    assert by_code["DEMO-CAGE-ONLINE"]["device_status"] == "online"
    assert by_code["DEMO-CAGE-OFFLINE-NORMAL"]["device_status"] == "offline"
    warning = by_code["DEMO-CAGE-OFFLINE-WARNING"]
    assert warning["device_status"] == "offline"
    assert warning["latest_detection"]["monitoring_status"] == "warning"
    assert warning["latest_detection"]["low_count"] == 8
    assert by_code["DEMO-CAGE-EMPTY"]["latest_detection"] is None
    # Backend online Cage aggregation must not include Offline historical values.
    cage = client.get("/api/v1/dashboard/summary").json()["data"]["cage"]
    assert cage["overall_low_ratio"] == 0.2
    assert Path(manifest["database"]).is_file()


@pytest.mark.parametrize("name", ["free-online", "free-offline"])
def test_formal_snapshot_stays_separate_from_newer_manual_and_images(demo, name):
    client, manifest = demo
    did = manifest["devices"][f"DEMO-{name.upper()}"]
    prefix = f"/api/v1/devices/{did}"
    latest = client.get(prefix + "/detections/latest").json()["data"]
    device = client.get(prefix).json()["data"]
    history = client.get(prefix + "/detections").json()["data"]
    assert latest["detection_id"] == manifest["detections"][f"{name}-formal"]
    assert device["latest_detection"] == latest
    assert (latest["normal_count"], latest["low_count"], latest["monitoring_status"]) == (6, 4, "warning")
    assert history[0]["detection_id"] == manifest["detections"][f"{name}-manual"]
    assert (history[0]["normal_count"], history[0]["low_count"]) == (1, 0)
    image = client.get(history[0]["image_url"])
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    assert image.content == demo_png()
    no_image = history[1]
    assert no_image["image_url"] is None
    assert client.get(prefix + f"/detections/{no_image['detection_id']}/image").status_code == 404
    assert len(client.get(prefix + "/detections").json()["data"]) == 4


def test_manual_only_device_has_history_but_no_formal_snapshot(demo):
    client, manifest = demo
    did = manifest["devices"]["DEMO-FREE-MANUAL-ONLY"]
    assert client.get(f"/api/v1/devices/{did}").json()["data"]["latest_detection"] is None
    history = client.get(f"/api/v1/devices/{did}/detections").json()["data"]
    assert len(history) == 1
    assert history[0]["trigger_type"] == "manual"
    assert history[0]["image_url"]
