"""Tests for user-side DeviceCommand creation."""

from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.enums import CommandStatus, CommandType
from app.farm_access import authorized_db
from app.routers import devices as devices_router


DEVICE_ID = "20000000-0000-0000-0000-000000000001"
COMMAND_ID = "40000000-0000-0000-0000-000000000001"


class FakeAuthorizedDB:
    """Minimal authorized DB used by the device command endpoint."""

    def __init__(self, device=None):
        self.device = device

    def scalar(self, statement):
        # authorized_db would normally expose only devices
        # belonging to the authenticated user's farm.
        return self.device


def make_device():
    return SimpleNamespace(
        device_id=DEVICE_ID,
        device_code="CAGE-01",
        device_name="Cage Camera 01",
        farming_type="caged",
        is_active=True,
    )


def make_command():
    return SimpleNamespace(
        command_id=COMMAND_ID,
        device_id=DEVICE_ID,
        command_type=CommandType.manual_detection.value,
        command_status=CommandStatus.pending.value,
        created_at=datetime(2026, 9, 27, 10, 0, 0),
        executed_at=None,
        result_detection_id=None,
        error_message=None,
    )


@pytest.fixture
def command_client():
    test_app = FastAPI()

    test_app.include_router(
        devices_router.router,
        prefix="/api/v1",
    )

    device = make_device()
    db = FakeAuthorizedDB(device)

    test_app.dependency_overrides[authorized_db] = lambda: db

    with TestClient(test_app) as client:
        yield client, db, device

    test_app.dependency_overrides.clear()


def test_create_manual_detection_command(
    command_client,
    monkeypatch,
):
    client, _, device = command_client

    command = make_command()
    observed = {}

    def fake_create(db, device_arg):
        observed["device"] = device_arg
        return command

    monkeypatch.setattr(
        devices_router,
        "create_manual_detection_command",
        fake_create,
    )

    response = client.post(
        f"/api/v1/devices/{DEVICE_ID}/commands",
        json={
            "command_type": "manual_detection",
        },
    )

    assert response.status_code == 200

    data = response.json()["data"]

    assert data["command_id"] == COMMAND_ID
    assert data["device_id"] == DEVICE_ID
    assert data["command_type"] == "manual_detection"
    assert data["command_status"] == "pending"
    assert data["executed_at"] is None
    assert data["result_detection_id"] is None
    assert data["error_message"] is None

    assert observed["device"] is device


def test_manual_screenshot_not_supported(
    command_client,
):
    client, _, _ = command_client

    response = client.post(
        f"/api/v1/devices/{DEVICE_ID}/commands",
        json={
            "command_type": "manual_screenshot",
        },
    )

    assert response.status_code == 400
    assert (
        response.json()["detail"]
        == "Unsupported command type"
    )


def test_inaccessible_device_returns_404(
    command_client,
):
    client, db, _ = command_client

    # Simulate authorized_db not exposing this device.
    db.device = None

    response = client.post(
        f"/api/v1/devices/{DEVICE_ID}/commands",
        json={
            "command_type": "manual_detection",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Device not found"


def test_invalid_command_type_returns_422(
    command_client,
):
    client, _, _ = command_client

    response = client.post(
        f"/api/v1/devices/{DEVICE_ID}/commands",
        json={
            "command_type": "something_invalid",
        },
    )

    assert response.status_code == 422