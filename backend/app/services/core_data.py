"""BE-02 Core Data service helpers.

This module keeps read-side business rules out of the FastAPI routers:
- compute Device Status from ``last_seen_at``;
- select the latest non-deleted Detection;
- serialize timestamps as UTC ISO 8601;
- aggregate the Home dashboard without creating a dashboard table.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.enums import DeviceStatus, FarmingType, MonitoringStatus
from app.models import Alert, Detection, Device


def utc_iso(value: datetime | None) -> str | None:
    """Serialize a naive-UTC database datetime as ISO 8601 with a ``Z`` suffix."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


def compute_device_status(device: Device, now: datetime | None = None) -> DeviceStatus:
    """03 §7: derive runtime Device Status primarily from ``last_seen_at``.

    BE-02 currently has no persisted hardware-error signal, so this read path can
    deterministically produce ``online`` or ``offline``. ``error`` remains a valid
    contract value for the later hardware/command layer.
    """
    if not device.is_active or device.last_seen_at is None:
        return DeviceStatus.offline

    now_utc = now or datetime.now(timezone.utc).replace(tzinfo=None)
    if now_utc.tzinfo is not None:
        now_utc = now_utc.astimezone(timezone.utc).replace(tzinfo=None)

    threshold = timedelta(minutes=settings.DEVICE_OFFLINE_THRESHOLD_MINUTES)
    return (
        DeviceStatus.offline
        if now_utc - device.last_seen_at > threshold
        else DeviceStatus.online
    )


def latest_detection_for_device(db: Session, device_id: str) -> Detection | None:
    """Return the newest valid Detection for a Device (History = Detection query)."""
    stmt = (
        select(Detection)
        .where(
            Detection.device_id == device_id,
            Detection.deleted_at.is_(None),
        )
        .order_by(Detection.detected_at.desc(), Detection.created_at.desc())
        .limit(1)
    )
    return db.scalars(stmt).first()



def latest_formal_snapshot_for_device(db: Session, device_id: str) -> Detection | None:
    """Return the newest formal Free-range Result Snapshot.

    Free-range manual detections are immediate single-frame results and must not replace
    the monitoring card/Home state, whose contract is the latest formal Result Snapshot.
    """
    stmt = (
        select(Detection)
        .where(
            Detection.device_id == device_id,
            Detection.deleted_at.is_(None),
            Detection.trigger_type == "free_range_snapshot",
        )
        .order_by(Detection.detected_at.desc(), Detection.created_at.desc())
        .limit(1)
    )
    return db.scalars(stmt).first()


def latest_monitoring_detection_for_device(
    db: Session, device: Device
) -> Detection | None:
    """Latest result that represents the Device's monitoring state."""
    if device.farming_type == FarmingType.free_range.value:
        return latest_formal_snapshot_for_device(db, device.device_id)
    return latest_detection_for_device(db, device.device_id)

def detection_history_for_device(db: Session, device_id: str) -> list[Detection]:
    """03 §10: history is non-deleted Detection records ordered newest first."""
    stmt = (
        select(Detection)
        .where(
            Detection.device_id == device_id,
            Detection.deleted_at.is_(None),
        )
        .order_by(Detection.detected_at.desc(), Detection.created_at.desc())
    )
    return list(db.scalars(stmt).all())


def alerts_for_device(db: Session, device_id: str) -> list[Alert]:
    stmt = (
        select(Alert)
        .where(Alert.device_id == device_id)
        .order_by(Alert.created_at.desc())
    )
    return list(db.scalars(stmt).all())


def serialize_detection(detection: Detection) -> dict:
    """Serialize one Detection using the 03 V2.0 field names only."""
    return {
        "detection_id": detection.detection_id,
        "device_id": detection.device_id,
        "detected_at": utc_iso(detection.detected_at),
        "trigger_type": detection.trigger_type,
        "capture_source_type": detection.capture_source_type,
        "total_count": detection.total_count,
        "normal_count": detection.normal_count,
        "low_count": detection.low_count,
        "normal_ratio": detection.normal_ratio,
        "low_ratio": detection.low_ratio,
        "monitoring_status": detection.monitoring_status,
        "confidence": detection.confidence,
        "image_path": detection.image_path,
        "image_url": detection.image_url,
        "annotated_image_url": (
            f"{settings.API_PREFIX}/devices/{detection.device_id}/detections/{detection.detection_id}/annotated-image"
            if detection.annotated_image_path and detection.image_deleted_at is None else None
        ),
        "ai_instances": detection.ai_instances,
        "ai_response": detection.ai_response,
        "provenance": detection.provenance,
        "image_deleted_at": utc_iso(detection.image_deleted_at),
        "sync_status": detection.sync_status,
        "deleted_at": utc_iso(detection.deleted_at),
        "created_at": utc_iso(detection.created_at),
    }


def serialize_alert(alert: Alert) -> dict:
    return {
        "alert_id": alert.alert_id,
        "device_id": alert.device_id,
        "detection_id": alert.detection_id,
        "alert_type": alert.alert_type,
        "message": alert.message,
        "alert_status": alert.alert_status,
        "created_at": utc_iso(alert.created_at),
        "resolved_at": utc_iso(alert.resolved_at),
    }


def serialize_device(
    device: Device,
    latest_detection: Detection | None,
    *,
    now: datetime | None = None,
) -> dict:
    """Return Device metadata plus computed status and its latest Detection snapshot."""
    return {
        "device_id": device.device_id,
        "farm_id": device.farm_id,
        "device_code": device.device_code,
        "device_name": device.device_name,
        "farming_type": device.farming_type,
        "device_status": compute_device_status(device, now=now).value,
        "last_seen_at": utc_iso(device.last_seen_at),
        "is_active": device.is_active,
        "created_at": utc_iso(device.created_at),
        "updated_at": utc_iso(device.updated_at),
        "latest_detection": (
            serialize_detection(latest_detection) if latest_detection is not None else None
        ),
    }


def dashboard_summary(db: Session) -> dict:
    """03 §21 / PRD §5.1: aggregate Cage and Free-range summaries dynamically."""
    devices = list(
        db.scalars(select(Device).where(Device.is_active.is_(True))).all()
    )
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    cage_devices = [d for d in devices if d.farming_type == FarmingType.caged.value]
    free_devices = [d for d in devices if d.farming_type == FarmingType.free_range.value]

    cage_normal = 0
    cage_warning = 0
    cage_offline = 0
    cage_low_sum = 0
    cage_total_sum = 0

    for device in cage_devices:
        status = compute_device_status(device, now=now)
        latest = latest_detection_for_device(db, device.device_id)

        if status == DeviceStatus.offline:
            cage_offline += 1
            continue

        if latest is not None:
            if latest.monitoring_status == MonitoringStatus.warning.value:
                cage_warning += 1
            elif latest.monitoring_status == MonitoringStatus.normal.value:
                cage_normal += 1

            # Weighted Cage ratio: Σ low_count / Σ total_count.
            if latest.total_count > 0:
                cage_low_sum += latest.low_count
                cage_total_sum += latest.total_count

    free_normal = 0
    free_warning = 0
    free_offline = 0
    free_latest_low_count = 0

    for device in free_devices:
        status = compute_device_status(device, now=now)
        latest = latest_formal_snapshot_for_device(db, device.device_id)

        # 03 §21: each Free-range Device's latest valid formal snapshot contributes.
        if latest is not None:
            free_latest_low_count += latest.low_count

        if status == DeviceStatus.offline:
            free_offline += 1
            continue

        if latest is not None:
            if latest.monitoring_status == MonitoringStatus.warning.value:
                free_warning += 1
            elif latest.monitoring_status == MonitoringStatus.normal.value:
                free_normal += 1

    return {
        "cage": {
            "device_count": len(cage_devices),
            "overall_low_ratio": (
                cage_low_sum / cage_total_sum if cage_total_sum > 0 else None
            ),
            "normal_device_count": cage_normal,
            "warning_device_count": cage_warning,
            "offline_device_count": cage_offline,
        },
        "free_range": {
            "device_count": len(free_devices),
            "latest_low_count": free_latest_low_count,
            "normal_device_count": free_normal,
            "warning_device_count": free_warning,
            "offline_device_count": free_offline,
        },
    }
