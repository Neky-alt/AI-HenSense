"""BE-05 acceptance tests for Monitoring, Notification and Storage APIs."""

from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_user
from app.farm_access import owned_cloud_farms
from app.database import Base, get_db
from app.main import app
from app.models import Device, Farm, Profile


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

    db.add(Profile(user_id="00000000-0000-0000-0000-000000000001", display_name="Tester"))
    db.add(
        Farm(
            farm_id="10000000-0000-0000-0000-000000000001",
            user_id="00000000-0000-0000-0000-000000000001",
            farm_name="Test Farm",
            timezone="Australia/Sydney",
            created_at=datetime(2026, 9, 13, 0, 0),
        )
    )
    db.flush()
    db.add_all(
        [
            Device(
                device_id="20000000-0000-0000-0000-000000000001",
                farm_id="10000000-0000-0000-0000-000000000001",
                device_code="CAGE-01",
                device_name="Cage 01",
                farming_type="caged",
            ),
            Device(
                device_id="20000000-0000-0000-0000-000000000002",
                farm_id="10000000-0000-0000-0000-000000000001",
                device_code="FREE-01",
                device_name="Free-range 01",
                farming_type="free_range",
            ),
        ]
    )
    db.commit()

    def _override_db():
        yield db

    app.dependency_overrides[current_user] = lambda: '00000000-0000-0000-0000-000000000001'
    app.dependency_overrides[owned_cloud_farms] = lambda: ['10000000-0000-0000-0000-000000000001']
    app.dependency_overrides[get_db] = _override_db
    client = TestClient(app)
    try:
        yield client, db
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()


def test_be05_v2_tables_exist(api_client):
    _, db = api_client
    tables = set(inspect(db.get_bind()).get_table_names())
    assert {
        "monitoring_settings",
        "device_storage_settings",
        "notification_settings",
        "video_segments",
    }.issubset(tables)


def test_get_cage_monitoring_defaults(api_client):
    client, _ = api_client
    response = client.get("/api/v1/monitoring-settings/caged")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["farming_type"] == "caged"
    assert data["detection_mode"] == "scheduled"
    assert data["cage_warning_low_ratio_threshold"] == pytest.approx(0.60)
    assert data["result_snapshot_interval_minutes"] is None


def test_update_and_read_cage_interval_settings(api_client):
    client, _ = api_client
    payload = {
        "monitoring_enabled": True,
        "monitoring_start_time": "09:00",
        "monitoring_end_time": "17:00",
        "detection_mode": "interval",
        "detection_interval_minutes": 120,
        "scheduled_times": None,
        "cage_warning_low_ratio_threshold": 0.55,
        "result_snapshot_interval_minutes": None,
        "free_range_warning_low_count_threshold": None,
    }
    updated = client.put("/api/v1/monitoring-settings/caged", json=payload)
    assert updated.status_code == 200
    assert updated.json()["data"]["detection_interval_minutes"] == 120
    assert updated.json()["data"]["updated_at"].endswith("Z")

    reread = client.get("/api/v1/monitoring-settings/caged").json()["data"]
    assert reread["monitoring_start_time"] == "09:00"
    assert reread["cage_warning_low_ratio_threshold"] == pytest.approx(0.55)


def test_update_and_read_free_range_settings(api_client):
    client, _ = api_client
    payload = {
        "monitoring_enabled": True,
        "monitoring_start_time": "08:00",
        "monitoring_end_time": "18:00",
        "detection_mode": None,
        "detection_interval_minutes": None,
        "scheduled_times": None,
        "cage_warning_low_ratio_threshold": None,
        "result_snapshot_interval_minutes": 10,
        "free_range_warning_low_count_threshold": 4,
    }
    response = client.put("/api/v1/monitoring-settings/free_range", json=payload)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["result_snapshot_interval_minutes"] == 10
    assert data["free_range_warning_low_count_threshold"] == 4
    assert data["detection_mode"] is None


def test_monitoring_validation_rejects_bad_scenario_payload(api_client):
    client, _ = api_client
    response = client.put(
        "/api/v1/monitoring-settings/caged",
        json={
            "monitoring_enabled": True,
            "detection_mode": "scheduled",
            "scheduled_times": [],
            "cage_warning_low_ratio_threshold": 0.60,
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_storage_status_reports_runtime_bytes(api_client):
    client, _ = api_client
    response = client.get(
        "/api/v1/devices/20000000-0000-0000-0000-000000000002/storage"
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["sd_capacity_bytes"] > 0
    assert data["sd_used_bytes"] >= 0
    assert data["sd_available_bytes"] >= 0
    assert data["sd_used_bytes"] + data["sd_available_bytes"] <= data["sd_capacity_bytes"]


def test_storage_settings_defaults_differ_by_farming_type(api_client):
    client, _ = api_client
    cage = client.get(
        "/api/v1/devices/20000000-0000-0000-0000-000000000001/storage/settings"
    ).json()["data"]
    free = client.get(
        "/api/v1/devices/20000000-0000-0000-0000-000000000002/storage/settings"
    ).json()["data"]
    assert cage["store_video_locally"] is False
    assert free["store_video_locally"] is True


def test_update_free_range_storage_settings(api_client):
    client, _ = api_client
    response = client.put(
        "/api/v1/devices/20000000-0000-0000-0000-000000000002/storage/settings",
        json={
            "store_detection_images": True,
            "detection_image_retention_days": 14,
            "store_video_locally": True,
            "video_retention_days": 3,
            "max_media_storage_gb": 1,
            "storage_limit_action": "delete_oldest",
        },
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["detection_image_retention_days"] == 14
    assert data["video_retention_days"] == 3
    assert data["storage_limit_action"] == "delete_oldest"


def test_cage_rejects_continuous_video_storage(api_client):
    client, _ = api_client
    response = client.put(
        "/api/v1/devices/20000000-0000-0000-0000-000000000001/storage/settings",
        json={
            "store_detection_images": True,
            "detection_image_retention_days": 30,
            "store_video_locally": True,
            "video_retention_days": 7,
            "max_media_storage_gb": 1,
            "storage_limit_action": "delete_oldest",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_notification_settings_get_update_get(api_client):
    client, _ = api_client
    initial = client.get("/api/v1/notification-settings")
    assert initial.status_code == 200
    assert initial.json()["data"]["in_app_enabled"] is True

    updated = client.put(
        "/api/v1/notification-settings",
        json={"in_app_enabled": False, "email_enabled": True, "push_enabled": False},
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["in_app_enabled"] is False
    assert updated.json()["data"]["email_enabled"] is True

    reread = client.get("/api/v1/notification-settings").json()["data"]
    assert reread["in_app_enabled"] is False
    assert reread["email_enabled"] is True


def test_missing_device_uses_unified_404(api_client):
    client, _ = api_client
    response = client.get("/api/v1/devices/not-real/storage/settings")
    assert response.status_code == 404
    assert response.json()["error"] == {"code": "NOT_FOUND", "message": "Device not found"}
