"""Adapter between HenSense Backend and the AI team's 2026-09-23 inference service.

AI team package contract (2026-09-23 hand-off):
- POST /predict/caged
- POST /predict/free_range
- multipart field name: ``file``
- response uses ``high_count`` for normal-production hens.

HenSense Backend never exposes new ``high_*`` fields.  This adapter is the single
translation boundary: AI ``high_count`` -> Backend ``normal_count``.  Ratio,
Monitoring Status, warning thresholds, Alert lifecycle and sync state remain Backend
responsibilities.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

import httpx

from app.config import settings
from app.enums import FarmingType
from app.models import Device
from app.services.capture_adapter import CapturedFrame


@dataclass(frozen=True)
class AIInferenceResult:
    """Normalized model result consumed by Country Watch business rules."""

    total_count: int
    normal_count: int
    low_count: int
    detections: list[dict[str, Any]] = field(default_factory=list)
    annotated_image_path: str | None = None
    # The AI hand-off explicitly says per-instance probabilities are weak-supervision
    # estimates, so the formal Detection confidence remains null for now.
    confidence: float | None = None
    detected_at: datetime | None = None
    # Preserve the AI team's limitation notice for integration/UX use.
    limitation_note: str | None = None
    raw_response: dict[str, Any] | None = None


class AIAdapter(Protocol):
    def infer(self, device: Device, frame: CapturedFrame) -> AIInferenceResult:
        ...


class AIServiceUnavailable(RuntimeError):
    """The independent AI service cannot be reached or is not ready."""


class AIInvalidResponse(RuntimeError):
    """The AI service responded, but its payload violates the agreed boundary."""


def normalize_ai_payload(payload: dict[str, Any], *, expected_mode: str) -> AIInferenceResult:
    """Translate the AI team's current JSON into the V2.0 Backend contract."""

    if not isinstance(payload, dict):
        raise AIInvalidResponse("AI response must be a JSON object")

    mode = payload.get("mode")
    if mode is not None and mode != expected_mode:
        raise AIInvalidResponse(
            f"AI response mode '{mode}' does not match requested mode '{expected_mode}'"
        )

    try:
        total_count = payload["total_count"]
        normal_count = payload["high_count"]  # AI legacy naming -> Country Watch normal_count
        low_count = payload["low_count"]
    except KeyError as exc:
        raise AIInvalidResponse(f"AI response is missing required field: {exc.args[0]}") from exc

    counts = (total_count, normal_count, low_count)
    if any(not isinstance(value, int) or isinstance(value, bool) or value < 0 for value in counts):
        raise AIInvalidResponse("AI counts must be non-negative integers")
    if total_count != normal_count + low_count:
        raise AIInvalidResponse("AI total_count must equal high_count + low_count")

    # The 2026-09-23 package also supplies ratio_normal, cage_label and
    # limitation_note.  Our Backend computes its own ratios and warning status;
    # validate optional metadata without treating weakly supervised confidence
    # as an independently verified production estimate.
    ratio = payload.get("ratio_normal")
    if ratio is not None:
        import math

        if isinstance(ratio, bool) or not isinstance(ratio, (int, float)) or not math.isfinite(ratio) or not 0 <= ratio <= 1:
            raise AIInvalidResponse("AI ratio_normal must be null or a finite number between 0 and 1")

    note = payload.get("limitation_note")
    if note is not None and not isinstance(note, str):
        raise AIInvalidResponse("AI limitation_note must be a string")

    instances = payload.get("instances")
    if instances is None:
        instances = []
    if not isinstance(instances, list):
        raise AIInvalidResponse("AI instances must be a list")

    return AIInferenceResult(
        total_count=total_count,
        normal_count=normal_count,
        low_count=low_count,
        detections=instances,
        raw_response=payload,
        confidence=None,
        limitation_note=note,
    )


class AIServiceAdapter:
    """HTTP client for the AI team's separately deployed FastAPI service."""

    def __init__(self, base_url: str | None = None, timeout_seconds: float | None = None):
        self.base_url = (base_url or settings.AI_SERVICE_URL).rstrip("/")
        self.timeout_seconds = timeout_seconds or settings.AI_SERVICE_TIMEOUT_SECONDS

    def infer(self, device: Device, frame: CapturedFrame) -> AIInferenceResult:
        return self.infer_mode(device.farming_type, frame)

    def infer_mode(self, farming_type: str, frame: CapturedFrame) -> AIInferenceResult:
        if farming_type == FarmingType.caged.value:
            mode = FarmingType.caged.value
            endpoint = "/predict/caged"
        elif farming_type == FarmingType.free_range.value:
            mode = FarmingType.free_range.value
            endpoint = "/predict/free_range"
        else:
            raise AIInvalidResponse(f"Unsupported farming_type: {farming_type}")

        try:
            with httpx.Client(timeout=self.timeout_seconds) as client:
                response = client.post(
                    f"{self.base_url}{endpoint}",
                    files={
                        "file": (
                            frame.filename,
                            frame.content,
                            frame.content_type,
                        )
                    },
                )
        except httpx.HTTPError as exc:
            raise AIServiceUnavailable("AI inference service is unavailable") from exc

        if response.status_code == 503:
            raise AIServiceUnavailable("AI inference service is still loading")
        if response.status_code >= 500:
            raise AIServiceUnavailable(f"AI inference service returned HTTP {response.status_code}")
        if response.status_code >= 400:
            raise AIInvalidResponse(
                f"AI inference service returned HTTP {response.status_code}"
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise AIInvalidResponse("AI inference service did not return valid JSON") from exc

        return normalize_ai_payload(payload, expected_mode=mode)


def get_ai_adapter() -> AIAdapter:
    return AIServiceAdapter()
