"""Internal Raspberry Pi / hardware integration routes."""

import json
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.enums import FarmingType, TriggerType
from app.hardware_auth import require_hardware_key
from app.models import Device, DeviceCommand, utcnow
from app.responses import success
from app.services.ai_adapter import AIInvalidResponse, normalize_ai_payload
from app.services.capture_adapter import CapturedFrame
from app.services.core_data import compute_device_status, utc_iso
from app.services.detection_deletion import maybe_apply_image_retention
from app.services.free_range_accumulator import free_range_accumulator
from app.services.hardware_command_execution import (
    execute_manual_detection_command,
)
from app.services.hardware_commands import (
    claim_next_command,
    complete_command,
    expire_stale_commands,
    fail_command,
)
from app.services.hardware_config import get_device_monitoring_config
from app.services.inference_media import persist_inference_media
from app.services.monitoring_lease import monitoring_leases
from app.services.monitoring_schedule import evaluate_device_schedule

router = APIRouter(
    prefix="/hardware",
    tags=["Hardware"],
)


class CommandCompletePayload(BaseModel):
    result_detection_id: str | None = None


class CommandFailPayload(BaseModel):
    error_message: str = Field(
        min_length=1,
        max_length=1000,
    )


def _serialize_command(
    command: DeviceCommand,
) -> dict:
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


async def _read_inference_upload(
    file: UploadFile,
    result_json: str,
    *,
    expected_mode: str,
    fallback_filename: str,
) -> tuple[CapturedFrame, object]:
    """Validate one Pi image + locally inferred result."""

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

    try:
        payload = json.loads(result_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail="result_json must be valid JSON",
        ) from exc

    try:
        result = normalize_ai_payload(
            payload,
            expected_mode=expected_mode,
        )
    except AIInvalidResponse as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    filename = (
        Path(file.filename).name
        if file.filename
        else fallback_filename
    )

    frame = CapturedFrame(
        content=content,
        filename=filename,
        content_type=file.content_type,
        captured_at=utcnow(),
    )

    return frame, result


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

    device = db.get(
        Device,
        device_id,
    )

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

    # Recover commands the device abandoned (e.g. it restarted mid-command).
    try:
        expire_stale_commands(db, device.device_id)
    except Exception:
        db.rollback()

    # Fixed 30-day image retention, throttled to once an hour; never fails the heartbeat.
    maybe_apply_image_retention(db)

    return success(
        {
            "device_id": device.device_id,
            "device_code": device.device_code,
            "last_seen_at": utc_iso(
                device.last_seen_at
            ),
            "device_status": compute_device_status(
                device
            ).value,
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
    device = db.get(
        Device,
        device_id,
    )

    if device is None or not device.is_active:
        raise HTTPException(
            status_code=404,
            detail="Device not found",
        )

    return success(
        get_device_monitoring_config(
            db,
            device,
        )
    )

@router.get(
    "/devices/{device_id}/monitoring-due",
    summary="Check whether automatic monitoring is due",
)
def read_device_monitoring_due(
    device_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_hardware_key),
) -> dict:
    """Let the Raspberry Pi ask whether an automatic sample is due."""

    device = db.get(
        Device,
        device_id,
    )

    if device is None or not device.is_active:
        raise HTTPException(
            status_code=404,
            detail="Device not found",
        )

    now = utcnow()
    decision = evaluate_device_schedule(
        db,
        device,
        now=now,
    )

    due = decision.due
    reason = decision.reason

    # Only one caller may take a due slot; others wait for its sample.
    if due and not monitoring_leases.try_acquire(device.device_id, now=now):
        due = False
        reason = "sample_in_progress"

    return success(
        {
            "device_id": device.device_id,
            "farming_type": device.farming_type,
            "due": due,
            "reason": reason,
            "due_at": (
                decision.due_at.isoformat(
                    timespec="seconds"
                )
                if decision.due_at is not None
                else None
            ),
            "farm_timezone": (
                device.farm.timezone or "UTC"
            ),
        }
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

    device = db.get(
        Device,
        device_id,
    )

    if device is None or not device.is_active:
        raise HTTPException(
            status_code=404,
            detail="Device not found",
        )

    command = claim_next_command(
        db,
        device,
    )

    return success(
        None
        if command is None
        else _serialize_command(command)
    )


@router.post(
    "/devices/{device_id}/commands/{command_id}/detection",
    summary="Submit locally inferred manual detection result",
)
async def submit_manual_detection(
    device_id: str,
    command_id: str,
    result_json: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: None = Depends(require_hardware_key),
) -> dict:
    """
    Receive an image and manual inference result produced
    locally by the Raspberry Pi.
    """

    device = db.get(
        Device,
        device_id,
    )

    if device is None or not device.is_active:
        raise HTTPException(
            status_code=404,
            detail="Device not found",
        )

    command = db.get(
        DeviceCommand,
        command_id,
    )

    if (
        command is None
        or command.device_id != device.device_id
    ):
        raise HTTPException(
            status_code=404,
            detail="Command not found",
        )

    frame, result = await _read_inference_upload(
        file,
        result_json,
        expected_mode=device.farming_type,
        fallback_filename=f"{command_id}.jpg",
    )

    try:
        completed = execute_manual_detection_command(
            db,
            device,
            command,
            frame,
            result,
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=409,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Command execution failed: {exc}"
            ),
        ) from exc

    return success(
        _serialize_command(completed)
    )


@router.post(
    "/devices/{device_id}/monitoring-samples",
    summary="Submit locally inferred automatic monitoring sample",
)
async def submit_monitoring_sample(
    device_id: str,
    result_json: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: None = Depends(require_hardware_key),
) -> dict:
    try:
        return await _process_monitoring_sample(device_id, result_json, file, db)
    finally:
        # The slot is either recorded now or failed; let the next due check decide.
        monitoring_leases.release(device_id)


async def _process_monitoring_sample(
    device_id: str,
    result_json: str,
    file: UploadFile,
    db: Session,
) -> dict:
    """
    Receive one automatic monitoring sample inferred locally
    by the Raspberry Pi.

    Caged devices persist one scheduled Detection per sample.

    Free-range devices add the result to the Backend-side
    accumulation window. A formal free_range_snapshot Detection
    is created only when the configured snapshot interval is due.
    """

    device = db.get(
        Device,
        device_id,
    )

    if device is None or not device.is_active:
        raise HTTPException(
            status_code=404,
            detail="Device not found",
        )

    if device.farming_type not in {
        FarmingType.caged.value,
        FarmingType.free_range.value,
    }:
        raise HTTPException(
            status_code=400,
            detail="Unsupported farming type",
        )

    frame, result = await _read_inference_upload(
        file,
        result_json,
        expected_mode=device.farming_type,
        fallback_filename="monitoring-sample.jpg",
    )

    if device.farming_type == FarmingType.caged.value:
        try:
            detection = persist_inference_media(
                db,
                device,
                frame,
                result,
                trigger_type=TriggerType.scheduled,
                provenance={
                    "origin": "pi_local_inference",
                    "monitoring_mode": "automatic",
                },
            )

        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc),
            ) from exc

        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Monitoring sample processing "
                    f"failed: {exc}"
                ),
            ) from exc

        return success(
            {
                "device_id": device.device_id,
                "farming_type": device.farming_type,
                "detection_id": detection.detection_id,
                "snapshot_created": False,
            }
        )

    try:
        outcome = free_range_accumulator.record_sample(
            db,
            device,
            result,
            observed_at=frame.captured_at,
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        db.rollback()

        raise HTTPException(
            status_code=503,
            detail=(
                "Monitoring sample processing "
                f"failed: {exc}"
            ),
        ) from exc

    return success(
        {
            "device_id": device.device_id,
            "farming_type": device.farming_type,
            "detection_id": outcome.detection_id,
            "snapshot_created": outcome.snapshot_created,
        }
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

    device = db.get(
        Device,
        device_id,
    )

    if device is None or not device.is_active:
        raise HTTPException(
            status_code=404,
            detail="Device not found",
        )

    command = db.get(
        DeviceCommand,
        command_id,
    )

    if (
        command is None
        or command.device_id != device.device_id
    ):
        raise HTTPException(
            status_code=404,
            detail="Command not found",
        )

    try:
        command = complete_command(
            db,
            device,
            command,
            result_detection_id=(
                payload.result_detection_id
            ),
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=409,
            detail=str(exc),
        ) from exc

    return success(
        _serialize_command(command)
    )


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

    device = db.get(
        Device,
        device_id,
    )

    if device is None or not device.is_active:
        raise HTTPException(
            status_code=404,
            detail="Device not found",
        )

    command = db.get(
        DeviceCommand,
        command_id,
    )

    if (
        command is None
        or command.device_id != device.device_id
    ):
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

    return success(
        _serialize_command(command)
    )