"""Contract tests for the AI team's 2026-09-23 API hand-off.

No torch/model weights, physical camera or running AI service is needed.
"""
from datetime import datetime

import httpx
import pytest

from app.models import Device
from app.services.ai_adapter import (
    AIInvalidResponse,
    AIServiceAdapter,
    AIServiceUnavailable,
    normalize_ai_payload,
)
from app.services.capture_adapter import CapturedFrame


def _payload(mode: str = "caged") -> dict:
    return {
        "mode": mode,
        "cage_label": "spent_cage",
        "ratio_normal": 0.5,
        "total_count": 2,
        "high_count": 1,
        "low_count": 1,
        "instances": [
            {"bbox": {"x1": 1.0, "y1": 2.0, "x2": 12.0, "y2": 25.0}, "label": "normal", "prob_normal": 0.8},
            {"bbox": {"x1": 20.0, "y1": 2.0, "x2": 30.0, "y2": 22.0}, "label": "low_yield", "prob_normal": 0.2},
        ],
        "limitation_note": "Weakly supervised estimates for research/demo only.",
    }


def test_latest_handoff_preserves_counts_and_limitations():
    result = normalize_ai_payload(_payload(), expected_mode="caged")
    assert (result.total_count, result.normal_count, result.low_count) == (2, 1, 1)
    assert result.confidence is None  # Weak-supervision estimates are not calibrated confidence
    assert result.limitation_note == _payload()["limitation_note"]
    assert len(result.detections) == 2


def test_latest_handoff_free_range_single_head():
    payload = _payload("free_range")
    payload.update(total_count=1, high_count=0, low_count=1, ratio_normal=0.0, instances=[payload["instances"][1]])
    result = normalize_ai_payload(payload, expected_mode="free_range")
    assert result.low_count == 1
    assert result.normal_count == 0


def test_latest_handoff_no_detections():
    payload = _payload()
    payload.update(cage_label="no_detections", ratio_normal=None, total_count=0, high_count=0, low_count=0, instances=[])
    result = normalize_ai_payload(payload, expected_mode="caged")
    assert result.total_count == 0
    assert result.detections == []


@pytest.mark.parametrize("invalid", [float("nan"), float("inf"), -0.01, 1.01, "0.5", True])
def test_invalid_ratio_is_rejected(invalid):
    payload = _payload()
    payload["ratio_normal"] = invalid
    with pytest.raises(AIInvalidResponse, match="ratio_normal"):
        normalize_ai_payload(payload, expected_mode="caged")


def test_mode_mismatch_is_rejected():
    with pytest.raises(AIInvalidResponse, match="mode"):
        normalize_ai_payload(_payload("free_range"), expected_mode="caged")


def test_http_boundary_routes_image_and_parses_real_contract(monkeypatch):
    paths = []

    def handler(request: httpx.Request):
        paths.append(request.url.path)
        assert 'name="file"' in request.content.decode("latin-1")
        assert b"sample-jpg-content" in request.content
        return httpx.Response(200, json=_payload("caged" if request.url.path.endswith("caged") else "free_range"))

    transport = httpx.MockTransport(handler)
    original_client = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original_client(transport=transport, **kwargs))
    adapter = AIServiceAdapter(base_url="http://127.0.0.1:8002", timeout_seconds=10)
    frame = CapturedFrame(content=b"sample-jpg-content", filename="frame.jpg", captured_at=datetime.now())
    for farming_type in ("caged", "free_range"):
        result = adapter.infer(Device(farming_type=farming_type), frame)
        assert result.total_count == 2
        assert result.normal_count == 1
    assert paths == ["/predict/caged", "/predict/free_range"]


@pytest.mark.parametrize("status", [500, 503])
def test_ai_server_failures_are_unavailable(monkeypatch, status):
    transport = httpx.MockTransport(lambda _: httpx.Response(status))
    original_client = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original_client(transport=transport, **kwargs))
    adapter = AIServiceAdapter(base_url="http://127.0.0.1:8002")
    with pytest.raises(AIServiceUnavailable):
        adapter.infer(Device(farming_type="caged"), CapturedFrame(content=b"x", filename="a.jpg"))
