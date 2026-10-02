"""Execute hardware-submitted DeviceCommands."""

from sqlalchemy.orm import Session

from app.enums import CommandStatus, CommandType, TriggerType
from app.models import Device, DeviceCommand
from app.services.ai_adapter import AIInferenceResult
from app.services.capture_adapter import CapturedFrame
from app.services.detection_pipeline import record_detection_failure
from app.services.hardware_commands import complete_command, fail_command
from app.services.inference_media import persist_inference_media


def execute_manual_detection_command(
    db: Session,
    device: Device,
    command: DeviceCommand,
    frame: CapturedFrame,
    result: AIInferenceResult,
) -> DeviceCommand:
    """Persist one manual-detection result produced locally by the hardware."""

    if command.device_id != device.device_id:
        raise ValueError("Command does not belong to device")

    if command.command_type != CommandType.manual_detection.value:
        raise ValueError("Command is not a manual detection command")

    if command.command_status != CommandStatus.running.value:
        raise ValueError("Command is not running")

    try:
        detection = persist_inference_media(
            db,
            device,
            frame,
            result,
            trigger_type=TriggerType.manual,
            provenance={
                "origin": "pi_local_inference",
                "command_id": command.command_id,
            },
        )

        return complete_command(
            db,
            device,
            command,
            result_detection_id=detection.detection_id,
        )

    except Exception as exc:
        db.rollback()

        record_detection_failure(
            db,
            device,
            str(exc),
        )

        current_command = db.get(
            DeviceCommand,
            command.command_id,
        )

        if (
            current_command is not None
            and current_command.command_status
            == CommandStatus.running.value
        ):
            fail_command(
                db,
                device,
                current_command,
                error_message=str(exc),
            )

        raise