"""Hardware heartbeat API tests."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.database import Base, get_db
from app.main import app
from app.models import Device, Farm, Profile, utcnow


ACTIVE_DEVICE_ID = "20000000-0000-0000-0000-000000000001"
INACTIVE_DEVICE_ID = "20000000-0000-0000-0000-000000000099"

HARDWARE_KEY = "test-hardware-key"


@pytest.fixture
def hardware_api(monkeypatch):
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

    old_last_seen = utcnow() - timedelta(hours=1)

    db.add_all(
        [
            Device(
                device_id=ACTIVE_DEVICE_ID,
                farm_id=farm_id,
                device_code="CAGE-01",
                device_name="Cage Camera",
                farming_type="caged",
                last_seen_at=old_last_seen,
                is_active=True,
            ),
            Device(
                device_id=INACTIVE_DEVICE_ID,
                farm_id=farm_id,
                device_code="CAGE-X",
                device_name="Inactive Camera",
                farming_type="caged",
                last_seen_at=old_last_seen,
                is_active=False,
            ),
        ]
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

    yield client, TestSession

    app.dependency_overrides.pop(get_db, None)
    engine.dispose()


def heartbeat_url(device_id: str) -> str:
    return f"/api/v1/hardware/devices/{device_id}/heartbeat"


def test_heartbeat_requires_hardware_key(hardware_api):
    client, _ = hardware_api

    response = client.post(
        heartbeat_url(ACTIVE_DEVICE_ID),
    )

    assert response.status_code == 401

    body = response.json()
    assert body["success"] is False
    assert body["error"] is not None


def test_heartbeat_rejects_wrong_hardware_key(hardware_api):
    client, _ = hardware_api

    response = client.post(
        heartbeat_url(ACTIVE_DEVICE_ID),
        headers={
            "X-Hardware-Key": "wrong-key",
        },
    )

    assert response.status_code == 401

    body = response.json()
    assert body["success"] is False


def test_heartbeat_returns_503_when_hardware_auth_not_configured(
    hardware_api,
    monkeypatch,
):
    client, _ = hardware_api

    monkeypatch.setattr(
        settings,
        "HARDWARE_API_KEY",
        "",
    )

    response = client.post(
        heartbeat_url(ACTIVE_DEVICE_ID),
        headers={
            "X-Hardware-Key": HARDWARE_KEY,
        },
    )

    assert response.status_code == 503

    body = response.json()
    assert body["success"] is False


def test_heartbeat_updates_last_seen_and_returns_online(hardware_api):
    client, TestSession = hardware_api

    with TestSession() as db:
        before = db.get(Device, ACTIVE_DEVICE_ID).last_seen_at

    response = client.post(
        heartbeat_url(ACTIVE_DEVICE_ID),
        headers={
            "X-Hardware-Key": HARDWARE_KEY,
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["data"]["device_id"] == ACTIVE_DEVICE_ID
    assert body["data"]["device_code"] == "CAGE-01"
    assert body["data"]["device_status"] == "online"
    assert body["data"]["last_seen_at"] is not None

    with TestSession() as db:
        device = db.get(Device, ACTIVE_DEVICE_ID)

        assert device.last_seen_at is not None
        assert device.last_seen_at > before


def test_heartbeat_unknown_device_returns_404(hardware_api):
    client, _ = hardware_api

    response = client.post(
        heartbeat_url(
            "20000000-0000-0000-0000-000000000777"
        ),
        headers={
            "X-Hardware-Key": HARDWARE_KEY,
        },
    )

    assert response.status_code == 404


def test_heartbeat_inactive_device_returns_404(hardware_api):
    client, _ = hardware_api

    response = client.post(
        heartbeat_url(INACTIVE_DEVICE_ID),
        headers={
            "X-Hardware-Key": HARDWARE_KEY,
        },
    )

    assert response.status_code == 404