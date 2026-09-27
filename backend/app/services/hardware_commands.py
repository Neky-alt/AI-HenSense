"""Device command lifecycle for Raspberry Pi / hardware workers."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.enums import CommandStatus
from app.models import Device, DeviceCommand, Detection, utcnow


def claim_next_command(
    db: Session,
    device: Device,
) -> DeviceCommand | None:
    """Claim the oldest pending command for one active device."""

    command = db.scalars(
        select(DeviceCommand)
        .where(
            DeviceCommand.device_id == device.device_id,
            DeviceCommand.command_status == CommandStatus.pending.value,
        )
        .order_by(DeviceCommand.created_at.asc())
        .limit(1)
    ).first()

    if command is None:
        return None

    command.command_status = CommandStatus.running.value
    command.error_message = None

    db.commit()
    db.refresh(command)
    return command


def complete_command(
    db: Session,
    device: Device,
    command: DeviceCommand,
    *,
    result_detection_id: str | None = None,
) -> DeviceCommand:
    """Mark one running hardware command as completed."""

    if command.device_id != device.device_id:
        raise ValueError("Command does not belong to device")

    if command.command_status != CommandStatus.running.value:
        raise ValueError("Command is not running")

    if result_detection_id is not None:
        detection = db.get(Detection, result_detection_id)

        if detection is None or detection.device_id != device.device_id:
            raise ValueError("Detection does not belong to device")

    command.command_status = CommandStatus.completed.value
    command.executed_at = utcnow()
    command.result_detection_id = result_detection_id
    command.error_message = None

    db.commit()
    db.refresh(command)
    return command


def fail_command(
    db: Session,
    device: Device,
    command: DeviceCommand,
    *,
    error_message: str,
) -> DeviceCommand:
    """Mark one running hardware command as failed."""

    if command.device_id != device.device_id:
        raise ValueError("Command does not belong to device")

    if command.command_status != CommandStatus.running.value:
        raise ValueError("Command is not running")

    command.command_status = CommandStatus.failed.value
    command.executed_at = utcnow()
    command.result_detection_id = None
    command.error_message = error_message

    db.commit()
    db.refresh(command)
    return command