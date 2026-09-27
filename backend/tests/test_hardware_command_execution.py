"""Tests for hardware command execution service."""

from types import SimpleNamespace

import pytest

from app.enums import CommandStatus, CommandType, TriggerType
from app.services.ai_adapter import AIInferenceResult
from app.services.capture_adapter import CapturedFrame
import app.services.hardware_command_execution as execution


class FakeDB:
    def __init__(self, command=None):
        self.command = command
        self.rollback_calls = 0

    def rollback(self):
        self.rollback_calls += 1

    def get(self, model, object_id):
        return self.command


class FakeAIAdapter:
    def __init__(self, *, error=None):
        self.error = error
        self.calls = 0

    def infer(self, device, frame):
        self.calls += 1

        if self.error is not None:
            raise self.error

        return AIInferenceResult(
            total_count=5,
            normal_count=4,
            low_count=1,
        )


def make_device():
    return SimpleNamespace(
        device_id="device-001",
        farming_type="caged",
    )


def make_command():
    return SimpleNamespace(
        command_id="command-001",
        device_id="device-001",
        command_type=CommandType.manual_detection.value,
        command_status=CommandStatus.running.value,
    )


def make_frame():
    return CapturedFrame(
        content=b"fake-jpeg",
        filename="capture.jpg",
        content_type="image/jpeg",
    )


def test_manual_detection_command_completes(monkeypatch):
    device = make_device()
    command = make_command()
    db = FakeDB(command)
    ai = FakeAIAdapter()

    observed = {}

    def fake_persist(
        db_arg,
        device_arg,
        frame_arg,
        result_arg,
        *,
        trigger_type,
        provenance,
        **kwargs,
    ):
        observed["trigger_type"] = trigger_type
        observed["provenance"] = provenance
        observed["result"] = result_arg

        return SimpleNamespace(
            detection_id="detection-001",
        )

    def fake_complete(
        db_arg,
        device_arg,
        command_arg,
        *,
        result_detection_id,
    ):
        observed["result_detection_id"] = result_detection_id

        command_arg.command_status = CommandStatus.completed.value
        command_arg.result_detection_id = result_detection_id

        return command_arg

    monkeypatch.setattr(
        execution,
        "persist_inference_media",
        fake_persist,
    )

    monkeypatch.setattr(
        execution,
        "complete_command",
        fake_complete,
    )

    completed = execution.execute_manual_detection_command(
        db,
        device,
        command,
        make_frame(),
        ai_adapter=ai,
    )

    assert ai.calls == 1

    assert observed["trigger_type"] == TriggerType.manual
    assert observed["provenance"]["origin"] == "hardware_command"
    assert observed["provenance"]["command_id"] == "command-001"

    assert observed["result_detection_id"] == "detection-001"

    assert completed.command_status == CommandStatus.completed.value
    assert completed.result_detection_id == "detection-001"


def test_ai_failure_marks_command_failed(monkeypatch):
    device = make_device()
    command = make_command()
    db = FakeDB(command)

    ai = FakeAIAdapter(
        error=RuntimeError("AI service unavailable")
    )

    recorded = {}

    def fake_record_failure(db_arg, device_arg, message):
        recorded["failure_message"] = message

    def fake_fail(
        db_arg,
        device_arg,
        command_arg,
        *,
        error_message,
    ):
        recorded["command_error"] = error_message

        command_arg.command_status = CommandStatus.failed.value
        command_arg.error_message = error_message

        return command_arg

    monkeypatch.setattr(
        execution,
        "record_detection_failure",
        fake_record_failure,
    )

    monkeypatch.setattr(
        execution,
        "fail_command",
        fake_fail,
    )

    with pytest.raises(
        RuntimeError,
        match="AI service unavailable",
    ):
        execution.execute_manual_detection_command(
            db,
            device,
            command,
            make_frame(),
            ai_adapter=ai,
        )

    assert db.rollback_calls == 1
    assert recorded["failure_message"] == "AI service unavailable"
    assert recorded["command_error"] == "AI service unavailable"

    assert command.command_status == CommandStatus.failed.value


def test_pending_command_is_rejected():
    device = make_device()
    command = make_command()

    command.command_status = CommandStatus.pending.value

    with pytest.raises(
        ValueError,
        match="Command is not running",
    ):
        execution.execute_manual_detection_command(
            FakeDB(command),
            device,
            command,
            make_frame(),
            ai_adapter=FakeAIAdapter(),
        )


def test_wrong_command_type_is_rejected():
    device = make_device()
    command = make_command()

    command.command_type = CommandType.manual_screenshot.value

    with pytest.raises(
        ValueError,
        match="manual detection",
    ):
        execution.execute_manual_detection_command(
            FakeDB(command),
            device,
            command,
            make_frame(),
            ai_adapter=FakeAIAdapter(),
        )