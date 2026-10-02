"""Tests for inference media trigger propagation."""

from datetime import datetime

from app.enums import TriggerType
from app.services.ai_adapter import AIInferenceResult
from app.services.capture_adapter import CapturedFrame
import app.services.inference_media as inference_media


class FakeDevice:
    device_id = "20000000-0000-0000-0000-000000000001"


def _frame() -> CapturedFrame:
    return CapturedFrame(
        content=b"test-image-bytes",
        filename="capture.jpg",
        content_type="image/jpeg",
        captured_at=datetime(2026, 9, 27, 4, 0, 0),
    )


def _result() -> AIInferenceResult:
    return AIInferenceResult(
        total_count=5,
        normal_count=4,
        low_count=1,
    )


def test_default_trigger_is_manual(monkeypatch):
    captured = {}

    monkeypatch.setattr(
        inference_media,
        "save_capture_image",
        lambda frame, device_id: "detections/original.jpg",
    )

    def fake_persist_ai_result(db, device, result, **kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(
        inference_media,
        "persist_ai_result",
        fake_persist_ai_result,
    )

    inference_media.persist_inference_media(
        object(),
        FakeDevice(),
        _frame(),
        _result(),
    )

    assert captured["trigger_type"] == TriggerType.manual


def test_scheduled_trigger_is_forwarded(monkeypatch):
    captured = {}

    monkeypatch.setattr(
        inference_media,
        "save_capture_image",
        lambda frame, device_id: "detections/original.jpg",
    )

    def fake_persist_ai_result(db, device, result, **kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(
        inference_media,
        "persist_ai_result",
        fake_persist_ai_result,
    )

    inference_media.persist_inference_media(
        object(),
        FakeDevice(),
        _frame(),
        _result(),
        trigger_type=TriggerType.scheduled,
    )

    assert captured["trigger_type"] == TriggerType.scheduled