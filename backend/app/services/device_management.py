"""Device Management business rules (docs/DEVICE_MANAGEMENT_API.md).

R1  device_code is globally unique (trim + upper-case, ^[A-Z0-9-]{3,32}$).
R2  After creation only device_name may change.
R3  Remove = soft delete (is_active=false); history kept, code stays reserved.
R4  Purge = delete device + all history locally and in the cloud; code is released.
R5  Cloud stays consistent: Add and Purge go to the cloud first (see device_cloud.py).

All functions take the request-scoped ``authorized_db`` session. That session only
*sees* the caller's own farms/devices, which is why the global uniqueness check
uses a raw connection query instead of an ORM select.

Note on sessions: ``authorized_db`` filters every ORM SELECT by the device IDs that
existed when the request began. A device created in this request is therefore not
re-loadable after commit, so responses are serialized after ``flush()`` and before
``commit()``.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.enums import CommandStatus, FarmingType
from app.models import (
    Alert,
    Detection,
    Device,
    DeviceCommand,
    DeviceSettings,
    DeviceStorageSettings,
    Farm,
    VideoSegment,
    new_uuid,
    utcnow,
)
from app.services.core_data import (
    latest_monitoring_detection_for_device,
    serialize_device,
    utc_iso,
)
from app.services.detection_images import remove_image, resolve_image_path
from app.services.device_cloud import CloudCodeTaken, CloudUnavailable, DeviceCloud

DEVICE_CODE_PATTERN = re.compile(r"^[A-Z0-9-]{3,32}$")
DEVICE_NAME_MAX_LENGTH = 64
REMOVED_COMMAND_ERROR = "Device removed"


@dataclass
class DeviceError(Exception):
    status_code: int
    code: str
    message: str


def _taken() -> DeviceError:
    return DeviceError(409, "DEVICE_CODE_TAKEN", "Device code is already registered")


def _retired() -> DeviceError:
    return DeviceError(
        409,
        "DEVICE_CODE_RETIRED",
        "Device code belongs to a removed device. Delete its history to reuse it.",
    )


def _cloud_unavailable() -> DeviceError:
    return DeviceError(
        503,
        "CLOUD_UNAVAILABLE",
        "Unable to reach the cloud right now. Nothing was changed. Try again.",
    )


def _not_found() -> DeviceError:
    return DeviceError(404, "NOT_FOUND", "Device not found")


def normalize_device_code(raw: str | None) -> str:
    code = (raw or "").strip().upper()
    if not DEVICE_CODE_PATTERN.fullmatch(code):
        raise DeviceError(
            422,
            "INVALID_DEVICE_CODE",
            "Device ID must be 3-32 letters, numbers or hyphens",
        )
    return code


def normalize_device_name(raw: str | None) -> str:
    name = (raw or "").strip()
    if not name or len(name) > DEVICE_NAME_MAX_LENGTH:
        raise DeviceError(
            422,
            "INVALID_DEVICE_NAME",
            f"Device name must be 1-{DEVICE_NAME_MAX_LENGTH} characters",
        )
    return name


def _farming_type(raw: str | None) -> str:
    if raw not in {item.value for item in FarmingType}:
        raise DeviceError(422, "INVALID_FARMING_TYPE", "farming_type must be caged or free_range")
    return raw


def _resolve_farm(db: Session, requested: str | None) -> str:
    owned = [farm.farm_id for farm in db.scalars(select(Farm)).all()]  # scoped to the caller
    if requested:
        if requested not in owned:
            raise DeviceError(404, "FARM_NOT_FOUND", "Farm not found")
        return requested
    if not owned:
        raise DeviceError(404, "FARM_NOT_FOUND", "You need a farm before adding devices")
    if len(owned) > 1:
        raise DeviceError(422, "VALIDATION_ERROR", "farm_id is required when you own more than one farm")
    return owned[0]


def _code_used_anywhere_locally(db: Session, code: str) -> bool:
    # Raw connection query: bypasses the per-user ORM scope on purpose (R1 is global).
    return (
        db.connection()
        .exec_driver_sql(
            "SELECT 1 FROM devices WHERE UPPER(device_code) = ? LIMIT 1",
            (code,),
        )
        .first()
        is not None
    )


def _cloud_payload(device: Device) -> dict:
    return {
        "device_id": device.device_id,
        "farm_id": device.farm_id,
        "device_code": device.device_code,
        "device_name": device.device_name,
        "farming_type": device.farming_type,
        "last_seen_at": None,
        "is_active": True,
        "created_at": utc_iso(device.created_at),
        "updated_at": utc_iso(device.updated_at),
    }


def _require_cloud_if_enabled(cloud: DeviceCloud | None | bool) -> DeviceCloud | None:
    """None = local-only mode. False = enabled but misconfigured -> fail closed."""
    if cloud is False:
        raise _cloud_unavailable()
    return cloud


def _best_effort_cloud_update(cloud: DeviceCloud | None | bool, device_id: str, fields: dict) -> None:
    if not cloud:
        return
    try:
        cloud.update_device(device_id, fields)
    except CloudUnavailable:
        pass  # Worker re-uploads the changed device row later.


# ---------------------------------------------------------------------- create
def create_device(
    db: Session,
    cloud: DeviceCloud | None | bool,
    *,
    device_code: str | None,
    device_name: str | None,
    farming_type: str | None,
    farm_id: str | None = None,
) -> dict:
    code = normalize_device_code(device_code)
    name = normalize_device_name(device_name)
    kind = _farming_type(farming_type)
    target_farm = _resolve_farm(db, farm_id)

    own = db.scalar(select(Device).where(func.upper(Device.device_code) == code))
    if own is not None:
        raise _taken() if own.is_active else _retired()
    if _code_used_anywhere_locally(db, code):
        raise _taken()  # someone else's device; never reveal whose

    cloud = _require_cloud_if_enabled(cloud)
    now = utcnow()
    device = Device(
        device_id=new_uuid(),
        farm_id=target_farm,
        device_code=code,
        device_name=name,
        farming_type=kind,
        is_active=True,
        created_at=now,
        updated_at=now,
    )

    if cloud is not None:
        try:
            if cloud.code_taken(code):
                raise _taken()
            cloud.insert_device(_cloud_payload(device))
        except CloudCodeTaken:
            raise _taken() from None
        except CloudUnavailable:
            raise _cloud_unavailable() from None

    try:
        db.add(device)
        db.flush()
        data = serialize_device(device, None)
        db.commit()
    except IntegrityError:
        db.rollback()
        _compensate_cloud_insert(cloud, device.device_id)
        raise _taken() from None
    except Exception:
        db.rollback()
        _compensate_cloud_insert(cloud, device.device_id)
        raise
    return data


def _compensate_cloud_insert(cloud: DeviceCloud | None, device_id: str) -> None:
    if cloud is None:
        return
    try:
        cloud.delete_device_row(device_id)
    except CloudUnavailable:
        # Orphan cloud row with no local twin; it keeps the code reserved until an
        # admin removes it. Rare (local commit failed right after cloud insert).
        pass


# ---------------------------------------------------------------------- rename
def rename_device(db: Session, cloud, device_id: str, device_name: str | None) -> dict:
    device = db.scalar(select(Device).where(Device.device_id == device_id, Device.is_active.is_(True)))
    if device is None:
        raise _not_found()
    device.device_name = normalize_device_name(device_name)
    device.updated_at = utcnow()
    db.flush()
    data = serialize_device(device, latest_monitoring_detection_for_device(db, device))
    db.commit()
    _best_effort_cloud_update(
        cloud,
        device_id,
        {"device_name": data["device_name"], "updated_at": data["updated_at"]},
    )
    return data


# ------------------------------------------------------------ remove (soft, R3)
def remove_device(db: Session, cloud, device_id: str) -> dict:
    device = db.scalar(select(Device).where(Device.device_id == device_id, Device.is_active.is_(True)))
    if device is None:
        raise _not_found()
    now = utcnow()
    device.is_active = False
    device.updated_at = now
    open_commands = db.scalars(
        select(DeviceCommand).where(
            DeviceCommand.device_id == device_id,
            DeviceCommand.command_status.in_(
                [CommandStatus.pending.value, CommandStatus.running.value]
            ),
        )
    ).all()
    for command in open_commands:
        command.command_status = CommandStatus.failed.value
        command.error_message = REMOVED_COMMAND_ERROR
    db.commit()
    _best_effort_cloud_update(cloud, device_id, {"is_active": False, "updated_at": utc_iso(now)})
    return {"device_id": device_id, "is_active": False, "history_retained": True}


def list_removed_devices(db: Session) -> list[dict]:
    devices = db.scalars(
        select(Device).where(Device.is_active.is_(False)).order_by(Device.device_code)
    ).all()
    return [serialize_device(device, None) for device in devices]


# -------------------------------------------------------------- purge (hard, R4)
@dataclass
class _PurgePlan:
    detection_ids: list[str] = field(default_factory=list)
    alert_ids: list[str] = field(default_factory=list)
    media: list[str] = field(default_factory=list)


def purge_device(db: Session, cloud, device_id: str) -> dict:
    device = db.scalar(select(Device).where(Device.device_id == device_id))  # active or removed
    if device is None:
        raise _not_found()
    cloud = _require_cloud_if_enabled(cloud)

    detections = db.scalars(select(Detection).where(Detection.device_id == device_id)).all()
    alerts = db.scalars(select(Alert).where(Alert.device_id == device_id)).all()
    segments = db.scalars(select(VideoSegment).where(VideoSegment.device_id == device_id)).all()
    plan = _PurgePlan(
        detection_ids=[d.detection_id for d in detections],
        alert_ids=[a.alert_id for a in alerts],
        media=[
            path
            for d in detections
            for path in (d.image_path, d.annotated_image_path)
            if path
        ]
        + [s.local_path for s in segments if s.local_path],
    )

    cloud_media = 0
    if cloud is not None:
        try:
            cloud_media = cloud.purge_device(device.farm_id, device_id)
        except CloudUnavailable:
            raise _cloud_unavailable() from None

    # Cloud is clean; now remove local rows. Children first, then the device.
    rows = [
        *alerts,
        *db.scalars(select(DeviceCommand).where(DeviceCommand.device_id == device_id)).all(),
        *detections,
        *db.scalars(select(DeviceSettings).where(DeviceSettings.device_id == device_id)).all(),
        *db.scalars(
            select(DeviceStorageSettings).where(DeviceStorageSettings.device_id == device_id)
        ).all(),
        *segments,
    ]
    for row in rows:
        db.delete(row)
    db.flush()
    db.delete(device)
    db.flush()
    _forget_outbox(db, device_id, plan)
    db.commit()

    # Files only after the commit succeeded; a rollback must never lose media.
    removed_files = 0
    for relative in plan.media:
        if resolve_image_path(relative) is not None:
            remove_image(relative)
            removed_files += 1

    return {
        "device_id": device_id,
        "purged": True,
        "detections_deleted": len(plan.detection_ids),
        "alerts_deleted": len(plan.alert_ids),
        "media_deleted": removed_files,
        "cloud_media_deleted": cloud_media,
    }


def _forget_outbox(db: Session, device_id: str, plan: _PurgePlan) -> None:
    """Drop Worker ledger rows so a purged UUID is never treated as already synced."""
    connection = db.connection()
    exists = connection.exec_driver_sql(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='be04_outbox'"
    ).first()
    if exists is None:
        return
    pairs = [("devices", device_id), ("device_storage_settings", device_id)]
    pairs += [("detections", item) for item in plan.detection_ids]
    pairs += [("alerts", item) for item in plan.alert_ids]
    for kind, record_id in pairs:
        connection.exec_driver_sql(
            "DELETE FROM be04_outbox WHERE kind = ? AND record_id = ?",
            (kind, record_id),
        )
