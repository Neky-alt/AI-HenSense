"""Hardware monitoring configuration API tests."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.database import Base, get_db
from app.main import app
from app.models import Device, Farm, MonitoringSettings, Profile


CAGE_DEVICE_ID = "20000000-0000-0000-0000-000000000001"
FREE_DEVICE_ID = "20000000-0000-0000-0000-000000000002"
INACTIVE_DEVICE_ID = "20000000-0000-0000-0000-000000000099"

HARDWARE_KEY = "test-hardware-key"


@pytest.fixture
def config_api(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)

    TestSession = sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
    )

    db = TestSession()

    user_id = "00000000-0000-0000-0000-000000000001"
    farm_id = "10000000-0000-0000-0000-000000000001"

    db.add(
        Profile(
            user_id=user_id,
            display_name="Hardware Tester",
        )
    )

    db.add(
        Farm(
            farm_id=farm_id,
            user_id=user_id,
            farm_name="Hardware Test Farm",
        )
    )

    db.flush()

    db.add_all(
        [
            Device(
                device_id=CAGE_DEVICE_ID,
                farm_id=farm_id,
                device_code="CAGE-01",
                device_name="Cage Camera",
                farming_type="caged",
                is_active=True,
            ),
            Device(
                device_id=FREE_DEVICE_ID,
                farm_id=farm_id,
                device_code="FREE-01",
                device_name="Free Range Camera",
                farming_type="free_range",
                is_active=True,
            ),
            Device(
                device_id=INACTIVE_DEVICE_ID,
                farm_id=farm_id,
                device_code="CAGE-X",
                device_name="Inactive",
                farming_type="caged",
                is_active=False,
            ),
        ]
    )

    db.flush()

    db.add(
        MonitoringSettings(
            farm_id=farm_id,
            farming_type="caged",
            monitoring_enabled=True,
            detection_mode="interval",
            detection_interval_minutes=20,
            scheduled_times=None,
            cage_warning_low_ratio_threshold=0.5,
        )
    )

    db.commit()
    db.close()

    def override_get_db():
        test_db = TestSession()
        try:
            yield test_db
        finally:
            test_db.close()

    app.dependency_overrides[get_db] = override_get_db

    monkeypatch.setattr(
        settings,
        "HARDWARE_API_KEY",
        HARDWARE_KEY,
    )

    client = TestClient(app)

    yield client

    app.dependency_overrides.pop(get_db, None)
    engine.dispose()


def url(device_id: str) -> str:
    return f"/api/v1/hardware/devices/{device_id}/monitoring-config"


def headers() -> dict[str, str]:
    return {
        "X-Hardware-Key": HARDWARE_KEY,
    }


def test_monitoring_config_requires_hardware_key(config_api):
    response = config_api.get(url(CAGE_DEVICE_ID))

    assert response.status_code == 401
    assert response.json()["success"] is False


def test_cage_monitoring_config_reads_database(config_api):
    response = config_api.get(
        url(CAGE_DEVICE_ID),
        headers=headers(),
    )

    assert response.status_code == 200

    data = response.json()["data"]

    assert data["device_id"] == CAGE_DEVICE_ID
    assert data["device_code"] == "CAGE-01"
    assert data["farming_type"] == "caged"
    assert data["monitoring_enabled"] is True
    assert data["detection_mode"] == "interval"
    assert data["detection_interval_minutes"] == 20
    assert data["cage_warning_low_ratio_threshold"] == 0.5


def test_free_range_uses_defaults_when_no_database_row(config_api):
    response = config_api.get(
        url(FREE_DEVICE_ID),
        headers=headers(),
    )

    assert response.status_code == 200

    data = response.json()["data"]

    assert data["device_id"] == FREE_DEVICE_ID
    assert data["device_code"] == "FREE-01"
    assert data["farming_type"] == "free_range"
    assert data["monitoring_enabled"] is True
    assert data["result_snapshot_interval_minutes"] == 5
    assert data["free_range_warning_low_count_threshold"] == 3


def test_unknown_device_returns_404(config_api):
    response = config_api.get(
        url("20000000-0000-0000-0000-000000000777"),
        headers=headers(),
    )

    assert response.status_code == 404


def test_inactive_device_returns_404(config_api):
    response = config_api.get(
        url(INACTIVE_DEVICE_ID),
        headers=headers(),
    )

    assert response.status_code == 404