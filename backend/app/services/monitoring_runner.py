"""Execute one automatic monitoring sample for a device.

Scheduling itself is intentionally outside this module.  A future scheduler or
hardware loop decides *when* to call this service.

Caged:
    capture -> AI -> scheduled Detection

Free-range:
    capture -> AI -> process-local accumulator -> optional formal snapshot
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.enums import FarmingType, TriggerType
from app.models import Device
from app.services.ai_adapter import AIAdapter
from app.services.capture_adapter import CaptureAdapter
from app.services.free_range_accumulator import free_range_accumulator
from app.services.inference_media import persist_inference_media


@dataclass(frozen=True)
class MonitoringRunOutcome:
    farming_type: str
    detection_id: str | None
    snapshot_created: bool


def run_monitoring_sample(
    db: Session,
    device: Device,
    *,
    capture_adapter: CaptureAdapter,
    ai_adapter: AIAdapter,
) -> MonitoringRunOutcome:
    """Capture and process one automatic monitoring sample."""

    if device.farming_type not in {
        FarmingType.caged.value,
        FarmingType.free_range.value,
    }:
        raise ValueError("Unsupported farming type")

    frame = capture_adapter.capture(device)
    result = ai_adapter.infer(device, frame)

    if device.farming_type == FarmingType.caged.value:
        detection = persist_inference_media(
            db,
            device,
            frame,
            result,
            trigger_type=TriggerType.scheduled,
        )

        return MonitoringRunOutcome(
            farming_type=device.farming_type,
            detection_id=detection.detection_id,
            snapshot_created=False,
        )

    outcome = free_range_accumulator.record_sample(
        db,
        device,
        result,
        observed_at=result.detected_at or frame.captured_at,
    )

    return MonitoringRunOutcome(
        farming_type=device.farming_type,
        detection_id=outcome.detection_id,
        snapshot_created=outcome.snapshot_created,
    )