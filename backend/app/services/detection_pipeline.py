"""BE-03 inference result -> Backend business rules -> SQLite.

The AI service only classifies image content.  This module is the business source of
truth for ratios, Monitoring Status, warning continuity, alerts and local-first sync
state.

Important Free-range rule for the current AI model:
The AI hand-off keeps only one detected head per frame (top_k=1).  Automatic
Free-range monitoring therefore aggregates repeated frame-level observations into one
formal ``free_range_snapshot`` Detection.  Manual Free-range detections are saved and
returned, but they do not participate in or reset the two-snapshot warning lifecycle.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.enums import (
    AlertStatus,
    AlertType,
    CaptureSourceType,
    FarmingType,
    MonitoringStatus,
    SyncStatus,
    TriggerType,
)
from app.models import Alert, Detection, Device, MonitoringSettings, utcnow
from app.services.ai_adapter import AIInferenceResult
from app.services.settings_storage import DEFAULT_CAGE_SETTINGS, DEFAULT_FREE_RANGE_SETTINGS


LOW_WARNING_MESSAGE_CAGE = "Low-production ratio reached the configured cage warning threshold."
LOW_WARNING_MESSAGE_FREE = "Low count reached the configured free-range warning threshold."
DETECTION_FAILED_MESSAGE = "Detection task failed."


def _monitoring_settings_for_device(db: Session, device: Device) -> tuple[float | None, int | None]:
    row = db.scalar(
        select(MonitoringSettings).where(
            MonitoringSettings.farm_id == device.farm_id,
            MonitoringSettings.farming_type == device.farming_type,
        )
    )
    if device.farming_type == FarmingType.caged.value:
        threshold = (
            row.cage_warning_low_ratio_threshold
            if row is not None and row.cage_warning_low_ratio_threshold is not None
            else float(DEFAULT_CAGE_SETTINGS["cage_warning_low_ratio_threshold"])
        )
        return threshold, None

    threshold = (
        row.free_range_warning_low_count_threshold
        if row is not None and row.free_range_warning_low_count_threshold is not None
        else int(DEFAULT_FREE_RANGE_SETTINGS["free_range_warning_low_count_threshold"])
    )
    return None, threshold


def _threshold_hit(
    device: Device,
    *,
    low_count: int,
    low_ratio: float | None,
    cage_threshold: float | None,
    free_threshold: int | None,
) -> bool:
    if device.farming_type == FarmingType.caged.value:
        return low_ratio is not None and cage_threshold is not None and low_ratio >= cage_threshold
    return free_threshold is not None and low_count >= free_threshold


def _warning_eligible_trigger(device: Device, trigger_type: TriggerType) -> bool:
    """Only formal Free-range Result Snapshots drive the Free-range warning rule."""
    if device.farming_type == FarmingType.free_range.value:
        return trigger_type == TriggerType.free_range_snapshot
    # Cage scheduled and Run Detection Now both create formal Detection records.
    return trigger_type in {TriggerType.scheduled, TriggerType.manual}


def _previous_warning_eligible_detection(
    db: Session, device: Device, trigger_type: TriggerType
) -> Detection | None:
    if device.farming_type == FarmingType.free_range.value:
        stmt = (
            select(Detection)
            .where(
                Detection.device_id == device.device_id,
                Detection.deleted_at.is_(None),
                Detection.trigger_type == TriggerType.free_range_snapshot.value,
            )
            .order_by(Detection.detected_at.desc(), Detection.created_at.desc())
            .limit(1)
        )
    else:
        stmt = (
            select(Detection)
            .where(
                Detection.device_id == device.device_id,
                Detection.deleted_at.is_(None),
                Detection.trigger_type.in_([
                    TriggerType.scheduled.value,
                    TriggerType.manual.value,
                ]),
            )
            .order_by(Detection.detected_at.desc(), Detection.created_at.desc())
            .limit(1)
        )
    return db.scalars(stmt).first()


def _active_alert(db: Session, device_id: str, alert_type: AlertType) -> Alert | None:
    return db.scalar(
        select(Alert)
        .where(
            Alert.device_id == device_id,
            Alert.alert_type == alert_type.value,
            Alert.alert_status == AlertStatus.active.value,
        )
        .order_by(Alert.created_at.desc())
        .limit(1)
    )


def _activate_or_refresh_alert(
    db: Session,
    device: Device,
    alert_type: AlertType,
    message: str,
    *,
    detection_id: str | None = None,
) -> Alert:
    alert = _active_alert(db, device.device_id, alert_type)
    if alert is None:
        alert = Alert(
            device_id=device.device_id,
            detection_id=detection_id,
            alert_type=alert_type.value,
            message=message,
            alert_status=AlertStatus.active.value,
            sync_status=SyncStatus.pending.value,
        )
        db.add(alert)
    else:
        alert.detection_id = detection_id
        alert.message = message
        alert.sync_status = SyncStatus.pending.value
    return alert


def _resolve_alert(db: Session, device_id: str, alert_type: AlertType) -> None:
    alert = _active_alert(db, device_id, alert_type)
    if alert is not None:
        alert.alert_status = AlertStatus.resolved.value
        alert.resolved_at = utcnow()
        alert.sync_status = SyncStatus.pending.value


def record_detection_failure(db: Session, device: Device, message: str | None = None) -> None:
    _activate_or_refresh_alert(
        db,
        device,
        AlertType.detection_failed,
        message or DETECTION_FAILED_MESSAGE,
    )
    db.commit()


def _normalize_detected_at(value: datetime | None) -> datetime:
    if value is None:
        return utcnow()
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def validate_ai_result(result: AIInferenceResult) -> None:
    counts = (result.total_count, result.normal_count, result.low_count)
    if any(
        not isinstance(value, int) or isinstance(value, bool) or value < 0
        for value in counts
    ):
        raise ValueError("AI counts must be non-negative integers")
    if result.total_count != result.normal_count + result.low_count:
        raise ValueError("AI total_count must equal normal_count + low_count")


def persist_ai_result(
    db: Session,
    device: Device,
    result: AIInferenceResult,
    *,
    trigger_type: TriggerType,
    capture_source_type: CaptureSourceType = CaptureSourceType.pi_camera,
    image_path: str | None = None,
    annotated_image_path: str | None = None,
    provenance: dict | None = None,
) -> Detection:
    """Persist one Backend Detection from a normalized AI result."""

    validate_ai_result(result)

    if result.total_count == 0:
        normal_ratio = None
        low_ratio = None
    else:
        normal_ratio = result.normal_count / result.total_count
        low_ratio = result.low_count / result.total_count

    cage_threshold, free_threshold = _monitoring_settings_for_device(db, device)
    eligible = _warning_eligible_trigger(device, trigger_type)

    # Free-range manual calls are immediate single-frame observations.  They must not
    # activate or resolve the formal snapshot warning lifecycle.
    monitoring_status = MonitoringStatus.normal.value
    if eligible:
        current_hit = _threshold_hit(
            device,
            low_count=result.low_count,
            low_ratio=low_ratio,
            cage_threshold=cage_threshold,
            free_threshold=free_threshold,
        )
        previous = _previous_warning_eligible_detection(db, device, trigger_type)
        previous_hit = False
        if previous is not None:
            previous_hit = _threshold_hit(
                device,
                low_count=previous.low_count,
                low_ratio=previous.low_ratio,
                cage_threshold=cage_threshold,
                free_threshold=free_threshold,
            )
        monitoring_status = (
            MonitoringStatus.warning.value
            if current_hit and previous_hit
            else MonitoringStatus.normal.value
        )

    detection = Detection(
        device_id=device.device_id,
        detected_at=_normalize_detected_at(result.detected_at),
        trigger_type=trigger_type.value,
        capture_source_type=capture_source_type.value,
        total_count=result.total_count,
        normal_count=result.normal_count,
        low_count=result.low_count,
        normal_ratio=normal_ratio,
        low_ratio=low_ratio,
        monitoring_status=monitoring_status,
        # Current AI probabilities are weak-supervision estimates and do not yet have
        # a reliable Detection-level confidence definition.
        confidence=None,
        image_path=image_path,
        annotated_image_path=annotated_image_path or result.annotated_image_path,
        ai_instances=result.detections if result.raw_response is not None else None,
        ai_response=result.raw_response,
        provenance=provenance,
        sync_status=SyncStatus.pending.value,
    )
    db.add(detection)
    db.flush()
    if image_path is not None:
        detection.image_url = (
            f"{settings.API_PREFIX}/devices/{device.device_id}"
            f"/detections/{detection.detection_id}/image"
        )

    if eligible:
        if monitoring_status == MonitoringStatus.warning.value:
            message = (
                LOW_WARNING_MESSAGE_CAGE
                if device.farming_type == FarmingType.caged.value
                else LOW_WARNING_MESSAGE_FREE
            )
            _activate_or_refresh_alert(
                db,
                device,
                AlertType.low_production_warning,
                message,
                detection_id=detection.detection_id,
            )
        else:
            _resolve_alert(db, device.device_id, AlertType.low_production_warning)

    # A successful capture + inference resolves an earlier task-failure alert, even
    # when this particular call is a manual Free-range observation.
    _resolve_alert(db, device.device_id, AlertType.detection_failed)

    db.commit()
    db.refresh(detection)
    return detection
