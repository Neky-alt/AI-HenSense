"""Hardware DeviceCommand API tests."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.database import Base, get_db
from app.enums import CommandStatus, CommandType
from app.main import app
from app.models import Device, DeviceCommand, Farm, Profile, utcnow
import app.routers.hardware as hardware_router


DEVICE_ID = "20000000-0000-0000-0000-000000000001"
INACTIVE_DEVICE_ID = "20000000-0000-0000-0000-000000000099"

COMMAND_1_ID = "40000000-0000-0000-0000-000000000001"
COMMAND_2_ID = "40000000-0000-0000-0000-000000000002"

HARDWARE_KEY = "test-hardware-key"


@pytest.fixture
def command_api(monkeypatch):
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

    now = utcnow()

    db.add_all(
        [
            Device(
                device_id=DEVICE_ID,
                farm_id=farm_id,
                device_code="CAGE-01",
                device_name="Cage Camera",
                farming_type="caged",
                last_seen_at=now,
                is_active=True,
            ),
            Device(
                device_id=INACTIVE_DEVICE_ID,
                farm_id=farm_id,
                device_code="CAGE-X",
                device_name="Inactive Camera",
                farming_type="caged",
                last_seen_at=now,
                is_active=False,
            ),
        ]
    )

    db.flush()

    # Older command: this one should be claimed first.
    db.add(
        DeviceCommand(
            command_id=COMMAND_1_ID,
            device_id=DEVICE_ID,
            command_type=CommandType.manual_detection.value,
            command_status=CommandStatus.pending.value,
            created_at=now - timedelta(minutes=2),
        )
    )

    # Newer pending command.
    db.add(
        DeviceCommand(
            command_id=COMMAND_2_ID,
            device_id=DEVICE_ID,
            command_type=CommandType.manual_screenshot.value,
            command_status=CommandStatus.pending.value,
            created_at=now - timedelta(minutes=1),
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

    yield client, TestSession

    app.dependency_overrides.pop(get_db, None)
    engine.dispose()


def hardware_headers() -> dict[str, str]:
    return {
        "X-Hardware-Key": HARDWARE_KEY,
    }


def claim_url(device_id: str = DEVICE_ID) -> str:
    return (
        f"/api/v1/hardware/devices/{device_id}/commands/claim"
    )


def complete_url(
    command_id: str,
    device_id: str = DEVICE_ID,
) -> str:
    return (
        f"/api/v1/hardware/devices/{device_id}"
        f"/commands/{command_id}/complete"
    )


def fail_url(
    command_id: str,
    device_id: str = DEVICE_ID,
) -> str:
    return (
        f"/api/v1/hardware/devices/{device_id}"
        f"/commands/{command_id}/fail"
    )


def test_claim_requires_hardware_key(command_api):
    client, _ = command_api

    response = client.post(claim_url())

    assert response.status_code == 401

    body = response.json()
    assert body["success"] is False


def test_claim_oldest_pending_command(command_api):
    client, TestSession = command_api

    response = client.post(
        claim_url(),
        headers=hardware_headers(),
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["data"]["command_id"] == COMMAND_1_ID
    assert body["data"]["command_type"] == "manual_detection"
    assert body["data"]["command_status"] == "running"

    with TestSession() as db:
        first = db.get(
            DeviceCommand,
            COMMAND_1_ID,
        )
        second = db.get(
            DeviceCommand,
            COMMAND_2_ID,
        )

        assert (
            first.command_status
            == CommandStatus.running.value
        )

        assert (
            second.command_status
            == CommandStatus.pending.value
        )


def test_claim_returns_null_when_no_pending_command(
    command_api,
):
    client, TestSession = command_api

    with TestSession() as db:
        commands = db.query(DeviceCommand).all()

        for command in commands:
            command.command_status = (
                CommandStatus.completed.value
            )

        db.commit()

    response = client.post(
        claim_url(),
        headers=hardware_headers(),
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["data"] is None


def test_complete_running_command(command_api):
    client, TestSession = command_api

    # Claim the oldest command first so it becomes running.
    claimed = client.post(
        claim_url(),
        headers=hardware_headers(),
    )

    assert claimed.status_code == 200

    response = client.post(
        complete_url(COMMAND_1_ID),
        headers=hardware_headers(),
        json={
            "result_detection_id": None,
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["data"]["command_status"] == "completed"
    assert body["data"]["executed_at"] is not None
    assert body["data"]["error_message"] is None

    with TestSession() as db:
        command = db.get(
            DeviceCommand,
            COMMAND_1_ID,
        )

        assert (
            command.command_status
            == CommandStatus.completed.value
        )

        assert command.executed_at is not None


def test_fail_running_command(command_api):
    client, TestSession = command_api

    claimed = client.post(
        claim_url(),
        headers=hardware_headers(),
    )

    assert claimed.status_code == 200

    response = client.post(
        fail_url(COMMAND_1_ID),
        headers=hardware_headers(),
        json={
            "error_message": "Camera capture failed",
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["data"]["command_status"] == "failed"
    assert (
        body["data"]["error_message"]
        == "Camera capture failed"
    )
    assert body["data"]["executed_at"] is not None

    with TestSession() as db:
        command = db.get(
            DeviceCommand,
            COMMAND_1_ID,
        )

        assert (
            command.command_status
            == CommandStatus.failed.value
        )

        assert (
            command.error_message
            == "Camera capture failed"
        )

        assert command.executed_at is not None


def test_cannot_complete_pending_command(command_api):
    client, _ = command_api

    response = client.post(
        complete_url(COMMAND_1_ID),
        headers=hardware_headers(),
        json={
            "result_detection_id": None,
        },
    )

    assert response.status_code == 409

    body = response.json()
    assert body["success"] is False


def test_inactive_device_cannot_claim_command(
    command_api,
):
    client, _ = command_api

    response = client.post(
        claim_url(INACTIVE_DEVICE_ID),
        headers=hardware_headers(),
    )

    assert response.status_code == 404


def test_submit_manual_detection_result(
    command_api,
    monkeypatch,
):
    client, _ = command_api

    # First claim the command so that it is running.
    claimed = client.post(
        claim_url(),
        headers=hardware_headers(),
    )

    assert claimed.status_code == 200
    assert (
        claimed.json()["data"]["command_status"]
        == CommandStatus.running.value
    )

    observed = {}

    def fake_execute(
        db,
        device,
        command,
        frame,
        result,
    ):
        observed["db"] = db
        observed["device"] = device
        observed["command"] = command
        observed["frame"] = frame
        observed["result"] = result

        command.command_status = (
            CommandStatus.completed.value
        )

        command.result_detection_id = (
            "50000000-0000-0000-0000-000000000001"
        )

        return command

    monkeypatch.setattr(
        hardware_router,
        "execute_manual_detection_command",
        fake_execute,
    )

    response = client.post(
        (
            f"/api/v1/hardware/devices/{DEVICE_ID}"
            f"/commands/{COMMAND_1_ID}/detection"
        ),
        headers=hardware_headers(),
        data={
            "result_json": (
                '{"mode":"caged",'
                '"total_count":1,'
                '"high_count":1,'
                '"low_count":0,'
                '"ratio_normal":1.0,'
                '"instances":['
                '{'
                '"label":"normal",'
                '"prob_normal":0.9,'
                '"bbox":{'
                '"x1":1,'
                '"y1":1,'
                '"x2":10,'
                '"y2":10'
                '}'
                '}'
                ']'
                '}'
            ),
        },
        files={
            "file": (
                "capture.jpg",
                b"fake-jpeg-bytes",
                "image/jpeg",
            )
        },
    )

    assert response.status_code == 200

    data = response.json()["data"]

    assert data["command_status"] == "completed"

    assert (
        data["result_detection_id"]
        == "50000000-0000-0000-0000-000000000001"
    )

    assert (
        observed["frame"].content
        == b"fake-jpeg-bytes"
    )

    assert (
        observed["frame"].filename
        == "capture.jpg"
    )

    assert (
        observed["frame"].content_type
        == "image/jpeg"
    )

    # The Backend receives the already-computed Pi result.
    assert observed["result"].total_count == 1
    assert observed["result"].normal_count == 1
    assert observed["result"].low_count == 0

    assert len(observed["result"].detections) == 1

    assert (
        observed["result"].detections[0]["label"]
        == "normal"
    )


def test_submit_detection_rejects_non_image(
    command_api,
):
    client, _ = command_api

    claimed = client.post(
        claim_url(),
        headers=hardware_headers(),
    )

    assert claimed.status_code == 200

    response = client.post(
        (
            f"/api/v1/hardware/devices/{DEVICE_ID}"
            f"/commands/{COMMAND_1_ID}/detection"
        ),
        headers=hardware_headers(),
        data={
            "result_json": (
                '{"mode":"caged",'
                '"total_count":0,'
                '"high_count":0,'
                '"low_count":0,'
                '"instances":[]'
                '}'
            ),
        },
        files={
            "file": (
                "not-image.txt",
                b"hello",
                "text/plain",
            )
        },
    )

    assert response.status_code == 400