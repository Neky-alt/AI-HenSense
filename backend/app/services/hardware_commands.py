"""Device command lifecycle for Raspberry Pi / hardware workers.

Concurrency and recovery rules (P2):

- Claiming is atomic: a command moves pending -> running only through a
  conditional UPDATE (``WHERE command_status = 'pending'``), so two workers can
  never both claim it.
- Completing / failing is also conditional on ``running``, so a late upload and a
  timeout can never both win.
- While a command is running, ``executed_at`` holds the time execution *started*
  (the claim). Completion / failure overwrites it with the finish time. This
  avoids a schema change; there is no separate ``claimed_at`` column.
- Stale commands are failed automatically:
    pending longer than COMMAND_PENDING_TIMEOUT_SECONDS  -> device never picked it up
    running longer than COMMAND_RUNNING_TIMEOUT_SECONDS  -> device never reported back
  The sweep runs whenever the device claims work, sends a heartbeat, or a user
  requests a new command, so it also recovers when the Pi died mid-command.
"""

from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.enums import CommandStatus, CommandType
from app.models import Device, DeviceCommand, Detection, utcnow

PENDING_TIMEOUT_MESSAGE = "Device did not pick up the command in time"
RUNNING_TIMEOUT_MESSAGE = "Device did not report a result in time"
_MAX_CLAIM_ATTEMPTS = 5


def expire_stale_commands(
    db: Session,
    device_id: str,
    *,
    now: datetime | None = None,
) -> int:
    """Fail pending/running commands that exceeded their timeout. Returns count.

    Uses ORM row updates (not a bulk UPDATE) so it also works inside the
    user-scoped ``authorized_db`` session, which rejects bulk statements.
    """

    now = now or utcnow()
    pending_cutoff = now - timedelta(seconds=settings.COMMAND_PENDING_TIMEOUT_SECONDS)
    running_cutoff = now - timedelta(seconds=settings.COMMAND_RUNNING_TIMEOUT_SECONDS)

    open_commands = db.scalars(
        select(DeviceCommand).where(
            DeviceCommand.device_id == device_id,
            DeviceCommand.command_status.in_(
                [CommandStatus.pending.value, CommandStatus.running.value]
            ),
        )
    ).all()

    expired = 0
    for command in open_commands:
        if command.command_status == CommandStatus.pending.value:
            if command.created_at >= pending_cutoff:
                continue
            message = PENDING_TIMEOUT_MESSAGE
        else:
            # executed_at = execution start while running; older rows may lack it.
            started = command.executed_at or command.created_at
            if started >= running_cutoff:
                continue
            message = RUNNING_TIMEOUT_MESSAGE
        command.command_status = CommandStatus.failed.value
        command.executed_at = now
        command.error_message = message
        expired += 1

    if expired:
        db.commit()
    return expired


def create_manual_detection_command(
    db: Session,
    device: Device,
) -> DeviceCommand:
    """Create a pending manual-detection command.

    If one is already pending or running for this device, return it instead of
    queueing a duplicate (repeated clicks on Run Detection Now).
    """

    expire_stale_commands(db, device.device_id)

    existing = db.scalars(
        select(DeviceCommand)
        .where(
            DeviceCommand.device_id == device.device_id,
            DeviceCommand.command_type == CommandType.manual_detection.value,
            DeviceCommand.command_status.in_(
                [CommandStatus.pending.value, CommandStatus.running.value]
            ),
        )
        .order_by(DeviceCommand.created_at.asc())
        .limit(1)
    ).first()
    if existing is not None:
        return existing

    command = DeviceCommand(
        device_id=device.device_id,
        command_type=CommandType.manual_detection.value,
        command_status=CommandStatus.pending.value,
    )

    db.add(command)
    db.commit()
    db.refresh(command)

    return command


def claim_next_command(
    db: Session,
    device: Device,
) -> DeviceCommand | None:
    """Atomically claim the oldest pending command for one device."""

    expire_stale_commands(db, device.device_id)

    for _ in range(_MAX_CLAIM_ATTEMPTS):
        candidate_id = db.scalars(
            select(DeviceCommand.command_id)
            .where(
                DeviceCommand.device_id == device.device_id,
                DeviceCommand.command_status == CommandStatus.pending.value,
            )
            .order_by(DeviceCommand.created_at.asc())
            .limit(1)
        ).first()

        if candidate_id is None:
            return None

        claimed = db.execute(
            update(DeviceCommand)
            .where(
                DeviceCommand.command_id == candidate_id,
                DeviceCommand.command_status == CommandStatus.pending.value,
            )
            .values(
                command_status=CommandStatus.running.value,
                executed_at=utcnow(),  # execution start, see module docstring
                error_message=None,
            )
            .execution_options(synchronize_session=False)
        ).rowcount
        db.commit()

        if claimed == 1:
            command = db.get(DeviceCommand, candidate_id)
            db.refresh(command)
            return command
        # Another worker won this one; try the next pending command.

    return None


def _finish_running(
    db: Session,
    command: DeviceCommand,
    **values,
) -> DeviceCommand:
    finished = db.execute(
        update(DeviceCommand)
        .where(
            DeviceCommand.command_id == command.command_id,
            DeviceCommand.command_status == CommandStatus.running.value,
        )
        .values(executed_at=utcnow(), **values)
        .execution_options(synchronize_session=False)
    ).rowcount

    if finished != 1:
        db.rollback()
        raise ValueError("Command is not running")

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
    """Mark a running device command as completed."""

    if command.device_id != device.device_id:
        raise ValueError(
            "Command does not belong to device"
        )

    if (
        command.command_status
        != CommandStatus.running.value
    ):
        raise ValueError(
            "Command is not running"
        )

    if result_detection_id is not None:
        detection = db.get(
            Detection,
            result_detection_id,
        )

        if (
            detection is None
            or detection.device_id
            != device.device_id
        ):
            raise ValueError(
                "Detection does not belong to device"
            )

    return _finish_running(
        db,
        command,
        command_status=CommandStatus.completed.value,
        result_detection_id=result_detection_id,
        error_message=None,
    )


def fail_command(
    db: Session,
    device: Device,
    command: DeviceCommand,
    *,
    error_message: str,
) -> DeviceCommand:
    """Mark a running device command as failed."""

    if command.device_id != device.device_id:
        raise ValueError(
            "Command does not belong to device"
        )

    if (
        command.command_status
        != CommandStatus.running.value
    ):
        raise ValueError(
            "Command is not running"
        )

    return _finish_running(
        db,
        command,
        command_status=CommandStatus.failed.value,
        result_detection_id=None,
        error_message=error_message,
    )
