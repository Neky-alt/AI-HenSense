"""BE-02 acceptance tests for the six fixed Core Data APIs."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_user
from app.farm_access import owned_cloud_farms
from app.database import Base, get_db
from app.main import app
from app.models import Alert, Detection, Device, Farm, Profile


@pytest.fixture
def api_client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db.add(Profile(user_id="00000000-0000-0000-0000-000000000001", display_name="Tester"))
    db.add(
        Farm(
            farm_id="10000000-0000-0000-0000-000000000001",
            user_id="00000000-0000-0000-0000-000000000001",
            farm_name="Test Farm",
        )
    )
    db.flush()

    devices = [
        Device(
            device_id="20000000-0000-0000-0000-000000000001",
            farm_id="10000000-0000-0000-0000-000000000001",
            device_code="CAGE-01",
            device_name="Cage A",
            farming_type="caged",
            last_seen_at=now - timedelta(minutes=1),
        ),
        Device(
            device_id="20000000-0000-0000-0000-000000000002",
            farm_id="10000000-0000-0000-0000-000000000001",
            device_code="CAGE-02",
            device_name="Cage B",
            farming_type="caged",
            last_seen_at=now - timedelta(minutes=2),
        ),
        Device(
            device_id="20000000-0000-0000-0000-000000000003",
            farm_id="10000000-0000-0000-0000-000000000001",
            device_code="CAGE-03",
            device_name="Cage Offline",
            farming_type="caged",
            last_seen_at=now - timedelta(minutes=30),
        ),
        Device(
            device_id="20000000-0000-0000-0000-000000000004",
            farm_id="10000000-0000-0000-0000-000000000001",
            device_code="FREE-01",
            device_name="Free Range A",
            farming_type="free_range",
            last_seen_at=now - timedelta(minutes=1),
        ),
        Device(
            device_id="20000000-0000-0000-0000-000000000005",
            farm_id="10000000-0000-0000-0000-000000000001",
            device_code="FREE-02",
            device_name="Free Range B",
            farming_type="free_range",
            last_seen_at=now - timedelta(minutes=1),
        ),
        Device(
            device_id="20000000-0000-0000-0000-000000000099",
            farm_id="10000000-0000-0000-0000-000000000001",
            device_code="CAGE-X",
            device_name="Inactive",
            farming_type="caged",
            last_seen_at=now,
            is_active=False,
        ),
    ]
    db.add_all(devices)
    db.flush()

    detections = [
        # Cage A: older record + latest valid record.
        Detection(
            detection_id="30000000-0000-0000-0000-000000000001",
            device_id=devices[0].device_id,
            detected_at=now - timedelta(hours=2),
            trigger_type="scheduled",
            capture_source_type="pi_camera",
            total_count=10,
            normal_count=7,
            low_count=3,
            normal_ratio=0.7,
            low_ratio=0.3,
            monitoring_status="normal",
            image_url="https://example.test/cage-a-old.jpg",
        ),
        Detection(
            detection_id="30000000-0000-0000-0000-000000000002",
            device_id=devices[0].device_id,
            detected_at=now - timedelta(minutes=5),
            trigger_type="scheduled",
            capture_source_type="pi_camera",
            total_count=10,
            normal_count=8,
            low_count=2,
            normal_ratio=0.8,
            low_ratio=0.2,
            monitoring_status="normal",
            image_url="https://example.test/cage-a.jpg",
        ),
        # Newer tombstoned record must be ignored by Latest/History.
        Detection(
            detection_id="30000000-0000-0000-0000-000000000099",
            device_id=devices[0].device_id,
            detected_at=now,
            trigger_type="scheduled",
            capture_source_type="pi_camera",
            total_count=10,
            normal_count=0,
            low_count=10,
            normal_ratio=0.0,
            low_ratio=1.0,
            monitoring_status="warning",
            deleted_at=now,
        ),
        Detection(
            detection_id="30000000-0000-0000-0000-000000000003",
            device_id=devices[1].device_id,
            detected_at=now - timedelta(minutes=4),
            trigger_type="scheduled",
            capture_source_type="pi_camera",
            total_count=20,
            normal_count=8,
            low_count=12,
            normal_ratio=0.4,
            low_ratio=0.6,
            monitoring_status="warning",
        ),
        Detection(
            detection_id="30000000-0000-0000-0000-000000000004",
            device_id=devices[2].device_id,
            detected_at=now - timedelta(minutes=3),
            trigger_type="scheduled",
            capture_source_type="pi_camera",
            total_count=10,
            normal_count=1,
            low_count=9,
            normal_ratio=0.1,
            low_ratio=0.9,
            monitoring_status="warning",
        ),
        Detection(
            detection_id="30000000-0000-0000-0000-000000000005",
            device_id=devices[3].device_id,
            detected_at=now - timedelta(minutes=2),
            trigger_type="free_range_snapshot",
            capture_source_type="pi_camera",
            total_count=9,
            normal_count=6,
            low_count=3,
            normal_ratio=6 / 9,
            low_ratio=3 / 9,
            monitoring_status="warning",
        ),
        Detection(
            detection_id="30000000-0000-0000-0000-000000000006",
            device_id=devices[4].device_id,
            detected_at=now - timedelta(minutes=1),
            trigger_type="free_range_snapshot",
            capture_source_type="pi_camera",
            total_count=9,
            normal_count=8,
            low_count=1,
            normal_ratio=8 / 9,
            low_ratio=1 / 9,
            monitoring_status="normal",
        ),
    ]
    db.add_all(detections)
    db.flush()

    db.add_all(
        [
            Alert(
                alert_id="40000000-0000-0000-0000-000000000001",
                device_id=devices[1].device_id,
                detection_id=detections[3].detection_id,
                alert_type="low_production_warning",
                message="Low-production warning",
                alert_status="active",
                created_at=now - timedelta(minutes=5),
            ),
            Alert(
                alert_id="40000000-0000-0000-0000-000000000002",
                device_id=devices[1].device_id,
                alert_type="stale_data",
                message="Old stale-data alert",
                alert_status="resolved",
                created_at=now - timedelta(hours=1),
                resolved_at=now - timedelta(minutes=30),
            ),
        ]
    )
    db.commit()

    def _override_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[current_user] = lambda: '00000000-0000-0000-0000-000000000001'
    app.dependency_overrides[owned_cloud_farms] = lambda: ['10000000-0000-0000-0000-000000000001']
    app.dependency_overrides[get_db] = _override_db
    client = TestClient(app)
    try:
        yield client
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()


def test_devices_list_returns_runtime_status_and_latest_detection(api_client):
    response = api_client.get("/api/v1/devices")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert len(body["data"]) == 5  # inactive device is excluded

    cage_a = next(item for item in body["data"] if item["device_code"] == "CAGE-01")
    assert cage_a["device_status"] == "online"
    assert cage_a["latest_detection"]["detection_id"].endswith("0002")
    assert "image_url" in cage_a["latest_detection"]
    assert "screenshot_url" not in cage_a["latest_detection"]


def test_devices_filter_by_farming_type(api_client):
    body = api_client.get("/api/v1/devices?farming_type=free_range").json()
    assert [item["device_code"] for item in body["data"]] == ["FREE-01", "FREE-02"]


def test_devices_filter_by_product_status(api_client):
    warning = api_client.get("/api/v1/devices?status=warning").json()["data"]
    assert {item["device_code"] for item in warning} == {"CAGE-02", "FREE-01"}

    offline = api_client.get("/api/v1/devices?status=offline").json()["data"]
    assert [item["device_code"] for item in offline] == ["CAGE-03"]


def test_devices_sort_low_desc_matches_farming_type_semantics(api_client):
    cage = api_client.get("/api/v1/devices?farming_type=caged&sort=low_desc").json()["data"]
    assert [item["device_code"] for item in cage] == ["CAGE-03", "CAGE-02", "CAGE-01"]

    free_range = api_client.get(
        "/api/v1/devices?farming_type=free_range&sort=low_desc"
    ).json()["data"]
    assert [item["device_code"] for item in free_range] == ["FREE-01", "FREE-02"]


def test_device_detail_and_not_found_use_unified_envelope(api_client):
    ok = api_client.get("/api/v1/devices/20000000-0000-0000-0000-000000000001")
    assert ok.status_code == 200
    assert ok.json()["data"]["device_code"] == "CAGE-01"

    missing = api_client.get("/api/v1/devices/does-not-exist")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "NOT_FOUND"
    assert missing.json()["error"]["message"] == "Device not found"


def test_latest_detection_ignores_tombstone_and_uses_v2_fields(api_client):
    body = api_client.get(
        "/api/v1/devices/20000000-0000-0000-0000-000000000001/detections/latest"
    ).json()
    data = body["data"]
    assert data["detection_id"].endswith("0002")
    assert data["trigger_type"] == "scheduled"
    assert data["capture_source_type"] == "pi_camera"
    assert data["deleted_at"] is None
    assert data["detected_at"].endswith("Z")


def test_detection_history_is_newest_first_and_excludes_deleted(api_client):
    data = api_client.get(
        "/api/v1/devices/20000000-0000-0000-0000-000000000001/detections"
    ).json()["data"]
    assert [item["detection_id"][-4:] for item in data] == ["0002", "0001"]


def test_device_alerts_are_newest_first(api_client):
    data = api_client.get(
        "/api/v1/devices/20000000-0000-0000-0000-000000000002/alerts"
    ).json()["data"]
    assert [item["alert_type"] for item in data] == [
        "low_production_warning",
        "stale_data",
    ]
    assert set(data[0]) == {
        "alert_id",
        "device_id",
        "detection_id",
        "alert_type",
        "message",
        "alert_status",
        "created_at",
        "resolved_at",
    }


def test_dashboard_summary_uses_weighted_cage_ratio_and_free_low_count(api_client):
    data = api_client.get("/api/v1/dashboard/summary").json()["data"]

    cage = data["cage"]
    assert cage["device_count"] == 3
    assert cage["overall_low_ratio"] == pytest.approx(14 / 30)
    assert cage["normal_device_count"] == 1
    assert cage["warning_device_count"] == 1
    assert cage["offline_device_count"] == 1

    free_range = data["free_range"]
    assert free_range == {
        "device_count": 2,
        "latest_low_count": 4,
        "normal_device_count": 1,
        "warning_device_count": 1,
        "offline_device_count": 0,
    }


def test_invalid_filter_uses_unified_validation_error(api_client):
    response = api_client.get("/api/v1/devices?status=attention")
    assert response.status_code == 422
    assert response.json()["error"] == {
        "code": "VALIDATION_ERROR",
        "message": "Request validation failed",
    }
