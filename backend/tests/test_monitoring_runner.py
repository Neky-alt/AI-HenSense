"""Tests for the automatic monitoring runner."""

from types import SimpleNamespace

from app.enums import FarmingType, TriggerType
from app.services.ai_adapter import AIInferenceResult
from app.services.capture_adapter import CapturedFrame
from app.services.free_range_accumulator import FreeRangeSampleOutcome
import app.services.monitoring_runner as runner


class FakeCaptureAdapter:
    def __init__(self):
        self.calls = 0

    def capture(self, device):
        self.calls += 1
        return CapturedFrame(
            content=b"image-bytes",
            filename="capture.jpg",
        )


class FakeAIAdapter:
    def __init__(self):
        self.calls = 0

    def infer(self, device, frame):
        self.calls += 1
        return AIInferenceResult(
            total_count=5,
            normal_count=4,
            low_count=1,
        )


def test_caged_monitoring_creates_scheduled_detection(monkeypatch):
    capture = FakeCaptureAdapter()
    ai = FakeAIAdapter()

    device = SimpleNamespace(
        device_id="device-cage",
        farming_type=FarmingType.caged.value,
    )

    observed = {}

    def fake_persist(
        db,
        passed_device,
        frame,
        result,
        *,
        trigger_type,
        **kwargs,
    ):
        observed["device"] = passed_device
        observed["trigger_type"] = trigger_type

        return SimpleNamespace(
            detection_id="detection-001",
        )

    monkeypatch.setattr(
        runner,
        "persist_inference_media",
        fake_persist,
    )

    outcome = runner.run_monitoring_sample(
        object(),
        device,
        capture_adapter=capture,
        ai_adapter=ai,
    )

    assert capture.calls == 1
    assert ai.calls == 1

    assert observed["device"] is device
    assert observed["trigger_type"] == TriggerType.scheduled

    assert outcome.farming_type == FarmingType.caged.value
    assert outcome.detection_id == "detection-001"
    assert outcome.snapshot_created is False


def test_free_range_monitoring_uses_accumulator(monkeypatch):
    capture = FakeCaptureAdapter()
    ai = FakeAIAdapter()

    device = SimpleNamespace(
        device_id="device-free",
        farming_type=FarmingType.free_range.value,
    )

    observed = {}

    def fake_record_sample(
        db,
        passed_device,
        result,
        *,
        observed_at=None,
        force_snapshot=False,
    ):
        observed["device"] = passed_device
        observed["result"] = result

        return FreeRangeSampleOutcome(
            snapshot_created=True,
            window=None,
            detection_id="snapshot-001",
        )

    monkeypatch.setattr(
        runner.free_range_accumulator,
        "record_sample",
        fake_record_sample,
    )

    outcome = runner.run_monitoring_sample(
        object(),
        device,
        capture_adapter=capture,
        ai_adapter=ai,
    )

    assert capture.calls == 1
    assert ai.calls == 1

    assert observed["device"] is device
    assert observed["result"].total_count == 5

    assert outcome.farming_type == FarmingType.free_range.value
    assert outcome.snapshot_created is True
    assert outcome.detection_id == "snapshot-001"


def test_free_range_without_due_snapshot_returns_no_detection(monkeypatch):
    device = SimpleNamespace(
        device_id="device-free",
        farming_type=FarmingType.free_range.value,
    )

    monkeypatch.setattr(
        runner.free_range_accumulator,
        "record_sample",
        lambda *args, **kwargs: FreeRangeSampleOutcome(
            snapshot_created=False,
            window=None,
            detection_id=None,
        ),
    )

    outcome = runner.run_monitoring_sample(
        object(),
        device,
        capture_adapter=FakeCaptureAdapter(),
        ai_adapter=FakeAIAdapter(),
    )

    assert outcome.snapshot_created is False
    assert outcome.detection_id is None


def test_unsupported_farming_type_is_rejected():
    device = SimpleNamespace(
        device_id="device-invalid",
        farming_type="invalid",
    )

    try:
        runner.run_monitoring_sample(
            object(),
            device,
            capture_adapter=FakeCaptureAdapter(),
            ai_adapter=FakeAIAdapter(),
        )
    except ValueError as exc:
        assert str(exc) == "Unsupported farming type"
    else:
        raise AssertionError("ValueError was not raised")