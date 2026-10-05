"""P2: atomic command claim, stale-command timeouts, de-duplication, monitoring lease."""
import threading
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.database import Base, get_db
from app.enums import CommandStatus
from app.main import app
from app.models import Device, DeviceCommand, Farm, Profile, utcnow
from app.routers import hardware as hardware_router
from app.services.hardware_commands import (
    PENDING_TIMEOUT_MESSAGE,
    RUNNING_TIMEOUT_MESSAGE,
    claim_next_command,
    complete_command,
    create_manual_detection_command,
    expire_stale_commands,
    fail_command,
)
from app.services.monitoring_schedule import ScheduleDecision

DEVICE = "20000000-0000-0000-0000-0000000000a1"
HARDWARE_KEY = "test-hardware-key"


@pytest.fixture
def env(tmp_path, monkeypatch):
    # File database so several threads/sessions really compete for the same rows.
    engine = create_engine(
        f"sqlite:///{tmp_path / 'commands.sqlite3'}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with Session() as db:
        db.add(Profile(user_id="u1"))
        db.add(Farm(farm_id="f1", user_id="u1", farm_name="F", timezone="UTC"))
        db.flush()
        db.add(Device(device_id=DEVICE, farm_id="f1", device_code="CAGE-01",
                      farming_type="caged", last_seen_at=utcnow()))
        db.commit()

    def _db():
        with Session() as db:
            yield db

    monkeypatch.setattr(settings, "HARDWARE_API_KEY", HARDWARE_KEY)
    app.dependency_overrides[get_db] = _db
    try:
        yield TestClient(app), Session
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def _add_command(Session, *, status="pending", created_ago=timedelta(0), started_ago=None):
    with Session() as db:
        now = utcnow()
        command = DeviceCommand(
            device_id=DEVICE,
            command_type="manual_detection",
            command_status=status,
            created_at=now - created_ago,
            executed_at=(now - started_ago) if started_ago is not None else None,
        )
        db.add(command)
        db.commit()
        return command.command_id


def _status(Session, command_id):
    with Session() as db:
        command = db.get(DeviceCommand, command_id)
        return command.command_status, command.error_message


def _device(db):
    return db.get(Device, DEVICE)


def test_concurrent_claims_hand_out_a_command_exactly_once(env):
    _, Session = env
    _add_command(Session)
    results, barrier = [], threading.Barrier(8)

    def worker():
        with Session() as db:
            barrier.wait()
            command = claim_next_command(db, _device(db))
            results.append(command.command_id if command else None)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len([r for r in results if r is not None]) == 1


def test_claim_records_execution_start(env):
    _, Session = env
    command_id = _add_command(Session)
    with Session() as db:
        command = claim_next_command(db, _device(db))
        assert command.command_id == command_id
        assert command.command_status == "running"
        assert command.executed_at is not None


def test_complete_and_fail_cannot_both_win(env):
    _, Session = env
    _add_command(Session)
    with Session() as db:
        command = claim_next_command(db, _device(db))
    with Session() as first, Session() as second:
        a = first.get(DeviceCommand, command.command_id)
        b = second.get(DeviceCommand, command.command_id)
        fail_command(first, _device(first), a, error_message="camera error")
        with pytest.raises(ValueError, match="not running"):
            complete_command(second, _device(second), b)
    assert _status(Session, command.command_id) == ("failed", "camera error")


def test_stale_pending_and_running_commands_are_failed(env):
    _, Session = env
    stale_pending = _add_command(Session, created_ago=timedelta(seconds=settings.COMMAND_PENDING_TIMEOUT_SECONDS + 5))
    fresh_pending = _add_command(Session, created_ago=timedelta(seconds=5))
    stale_running = _add_command(Session, status="running", created_ago=timedelta(hours=1),
                                 started_ago=timedelta(seconds=settings.COMMAND_RUNNING_TIMEOUT_SECONDS + 5))
    fresh_running = _add_command(Session, status="running", created_ago=timedelta(hours=1),
                                 started_ago=timedelta(seconds=5))
    legacy_running = _add_command(Session, status="running", created_ago=timedelta(hours=1))
    with Session() as db:
        assert expire_stale_commands(db, DEVICE) == 3
    assert _status(Session, stale_pending) == ("failed", PENDING_TIMEOUT_MESSAGE)
    assert _status(Session, stale_running) == ("failed", RUNNING_TIMEOUT_MESSAGE)
    assert _status(Session, legacy_running) == ("failed", RUNNING_TIMEOUT_MESSAGE)
    assert _status(Session, fresh_pending)[0] == "pending"
    assert _status(Session, fresh_running)[0] == "running"


def test_heartbeat_recovers_abandoned_running_command(env):
    client, Session = env
    stuck = _add_command(Session, status="running", created_ago=timedelta(hours=1),
                         started_ago=timedelta(seconds=settings.COMMAND_RUNNING_TIMEOUT_SECONDS + 5))
    response = client.post(f"/api/v1/hardware/devices/{DEVICE}/heartbeat", headers={"X-Hardware-Key": HARDWARE_KEY})
    assert response.status_code == 200
    assert _status(Session, stuck) == ("failed", RUNNING_TIMEOUT_MESSAGE)


def test_late_upload_after_timeout_is_rejected(env):
    client, Session = env
    stuck = _add_command(Session, status="running", created_ago=timedelta(hours=1),
                         started_ago=timedelta(seconds=settings.COMMAND_RUNNING_TIMEOUT_SECONDS + 5))
    with Session() as db:
        expire_stale_commands(db, DEVICE)
    response = client.post(
        f"/api/v1/hardware/devices/{DEVICE}/commands/{stuck}/complete",
        headers={"X-Hardware-Key": HARDWARE_KEY},
        json={},
    )
    assert response.status_code == 409


def test_repeated_run_detection_reuses_the_open_command(env):
    _, Session = env
    with Session() as db:
        first = create_manual_detection_command(db, _device(db))
        second = create_manual_detection_command(db, _device(db))
        assert first.command_id == second.command_id
        claim_next_command(db, _device(db))
        third = create_manual_detection_command(db, _device(db))
        assert third.command_id == first.command_id  # still running -> no duplicate
        fail_command(db, _device(db), db.get(DeviceCommand, first.command_id), error_message="x")
        fourth = create_manual_detection_command(db, _device(db))
        assert fourth.command_id != first.command_id
        assert fourth.command_status == CommandStatus.pending.value


def test_monitoring_due_slot_is_given_to_one_caller(env, monkeypatch):
    client, _ = env
    monkeypatch.setattr(
        hardware_router,
        "evaluate_device_schedule",
        lambda db, device, now: ScheduleDecision(due=True, reason="interval_elapsed", due_at=now),
    )
    url = f"/api/v1/hardware/devices/{DEVICE}/monitoring-due"
    headers = {"X-Hardware-Key": HARDWARE_KEY}
    first = client.get(url, headers=headers).json()["data"]
    second = client.get(url, headers=headers).json()["data"]
    assert first["due"] is True
    assert second == {**second, "due": False, "reason": "sample_in_progress"}

    # Submitting the sample (even a rejected one) releases the slot.
    rejected = client.post(
        f"/api/v1/hardware/devices/{DEVICE}/monitoring-samples",
        headers=headers,
        data={"result_json": "{}"},
        files={"file": ("x.txt", b"not an image", "text/plain")},
    )
    assert rejected.status_code == 400
    assert client.get(url, headers=headers).json()["data"]["due"] is True
