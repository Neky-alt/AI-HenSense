"""Internal Raspberry Pi / hardware integration routes."""

from app.services.hardware_config import get_device_monitoring_config
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.hardware_auth import require_hardware_key
from app.models import Device, DeviceCommand, utcnow
from app.responses import success
from app.services.core_data import compute_device_status, utc_iso
from app.services.hardware_commands import (
    claim_next_command,
    complete_command,
    fail_command,
)
from app.services.ai_adapter import AIAdapter, get_ai_adapter
from app.services.capture_adapter import CapturedFrame
from app.services.hardware_command_execution import (
    execute_manual_detection_command,
)

router = APIRouter(
    prefix="/hardware",
    tags=["Hardware"],
)


class CommandCompletePayload(BaseModel):
    result_detection_id: str | None = None


class CommandFailPayload(BaseModel):
    error_message: str = Field(min_length=1, max_length=1000)


def _serialize_command(command: DeviceCommand) -> dict:
    return {
        "command_id": command.command_id,
        "device_id": command.device_id,
        "command_type": command.command_type,
        "command_status": command.command_status,
        "created_at": utc_iso(command.created_at),
        "executed_at": utc_iso(command.executed_at),
        "result_detection_id": command.result_detection_id,
        "error_message": command.error_message,
    }


@router.post(
    "/devices/{device_id}/heartbeat",
    summary="Receive device heartbeat",
)
def device_heartbeat(
    device_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_hardware_key),
) -> dict:
    """Mark an active Raspberry Pi device as recently seen."""

    device = db.get(Device, device_id)

    if device is None or not device.is_active:
        raise HTTPException(
            status_code=404,
            detail="Device not found",
        )

    # Backend time is authoritative.
    # Do not trust a timestamp supplied by the hardware client.
    device.last_seen_at = utcnow()

    db.commit()
    db.refresh(device)

    return success(
        {
            "device_id": device.device_id,
            "device_code": device.device_code,
            "last_seen_at": utc_iso(device.last_seen_at),
            "device_status": compute_device_status(device).value,
        }
    )

@router.get(
    "/devices/{device_id}/monitoring-config",
    summary="Read device monitoring configuration",
)
def read_device_monitoring_config(
    device_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_hardware_key),
) -> dict:
    device = db.get(Device, device_id)

    if device is None or not device.is_active:
        raise HTTPException(
            status_code=404,
            detail="Device not found",
        )

    return success(
        get_device_monitoring_config(db, device)
    )

@router.post(
    "/devices/{device_id}/commands/claim",
    summary="Claim next pending device command",
)
def claim_device_command(
    device_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_hardware_key),
) -> dict:
    """Claim the oldest pending command for one active device."""

    device = db.get(Device, device_id)

    if device is None or not device.is_active:
        raise HTTPException(
            status_code=404,
            detail="Device not found",
        )

    command = claim_next_command(db, device)

    return success(
        None if command is None else _serialize_command(command)
    )

@router.post(
    "/devices/{device_id}/commands/{command_id}/detection",
    summary="Submit image for a manual detection command",
)
async def submit_manual_detection(
    device_id: str,
    command_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    ai_adapter: AIAdapter = Depends(get_ai_adapter),
    _: None = Depends(require_hardware_key),
) -> dict:
    device = db.get(Device, device_id)

    if device is None or not device.is_active:
        raise HTTPException(
            status_code=404,
            detail="Device not found",
        )

    command = db.get(DeviceCommand, command_id)

    if command is None or command.device_id != device.device_id:
        raise HTTPException(
            status_code=404,
            detail="Command not found",
        )

    if file.content_type not in {
        "image/jpeg",
        "image/png",
    }:
        raise HTTPException(
            status_code=400,
            detail="Only JPEG and PNG images are supported",
        )

    content = await file.read()

    if not content:
        raise HTTPException(
            status_code=400,
            detail="Uploaded image is empty",
        )

    filename = (
        Path(file.filename).name
        if file.filename
        else f"{command_id}.jpg"
    )

    frame = CapturedFrame(
        content=content,
        filename=filename,
        content_type=file.content_type,
        captured_at=utcnow(),
    )

    try:
        completed = execute_manual_detection_command(
            db,
            device,
            command,
            frame,
            ai_adapter=ai_adapter,
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=409,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Command execution failed: {exc}",
        ) from exc

    return success(
        _serialize_command(completed)
    )

@router.post(
    "/devices/{device_id}/commands/{command_id}/complete",
    summary="Complete device command",
)
def complete_device_command(
    device_id: str,
    command_id: str,
    payload: CommandCompletePayload,
    db: Session = Depends(get_db),
    _: None = Depends(require_hardware_key),
) -> dict:
    """Mark a running command as completed."""

    device = db.get(Device, device_id)

    if device is None or not device.is_active:
        raise HTTPException(
            status_code=404,
            detail="Device not found",
        )

    command = db.get(DeviceCommand, command_id)

    if command is None or command.device_id != device.device_id:
        raise HTTPException(
            status_code=404,
            detail="Command not found",
        )

    try:
        command = complete_command(
            db,
            device,
            command,
            result_detection_id=payload.result_detection_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=409,
            detail=str(exc),
        ) from exc

    return success(_serialize_command(command))


@router.post(
    "/devices/{device_id}/commands/{command_id}/fail",
    summary="Fail device command",
)
def fail_device_command(
    device_id: str,
    command_id: str,
    payload: CommandFailPayload,
    db: Session = Depends(get_db),
    _: None = Depends(require_hardware_key),
) -> dict:
    """Mark a running command as failed."""

    device = db.get(Device, device_id)

    if device is None or not device.is_active:
        raise HTTPException(
            status_code=404,
            detail="Device not found",
        )

    command = db.get(DeviceCommand, command_id)

    if command is None or command.device_id != device.device_id:
        raise HTTPException(
            status_code=404,
            detail="Command not found",
        )

    try:
        command = fail_command(
            db,
            device,
            command,
            error_message=payload.error_message,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=409,
            detail=str(exc),
        ) from exc

    return success(_serialize_command(command))