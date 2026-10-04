"""Device, Detection History, Alerts and BE-03 Run Detection Now endpoints."""

from enum import Enum

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.farm_access import authorized_db
from app.enums import (
    CaptureSourceType,
    CommandType,
    DeviceStatus,
    FarmingType,
    TriggerType,
)
from app.models import Detection, Device, DeviceCommand
from app.responses import failure, success
from app.services.ai_adapter import (
    AIAdapter,
    AIInvalidResponse,
    AIServiceUnavailable,
    get_ai_adapter,
)
from app.services.capture_adapter import (
    CaptureAdapter,
    CaptureAdapterUnavailable,
    CaptureFailed,
    get_capture_adapter,
)
from app.services.core_data import (
    alerts_for_device,
    compute_device_status,
    detection_history_for_device,
    latest_monitoring_detection_for_device,
    serialize_alert,
    serialize_detection,
    serialize_device,
)
from app.services.detection_images import (
    ImageStorageError,
    resolve_image_path,
)
from app.services.detection_pipeline import record_detection_failure
from app.services.detection_deletion import (
    DetectionNotFound,
    delete_detection_image,
    delete_detection_record,
)
from app.services.device_cloud import get_device_cloud
from app.services.device_management import (
    DeviceError,
    create_device,
    list_removed_devices,
    purge_device,
    remove_device,
    rename_device,
)
from app.services.hardware_commands import (
    create_manual_detection_command,
)
from app.services.inference_media import persist_inference_media


router = APIRouter(
    prefix="/devices",
    tags=["devices"],
)


class DeviceListStatus(str, Enum):
    normal = "normal"
    warning = "warning"
    offline = "offline"


class DeviceSort(str, Enum):
    low_desc = "low_desc"
    low_asc = "low_asc"
    name_asc = "name_asc"
    name_desc = "name_desc"


class DeviceCommandCreatePayload(BaseModel):
    command_type: CommandType


class DeviceCreatePayload(BaseModel):
    # Optional at the schema level so missing/blank fields get the specific
    # INVALID_* codes from device_management instead of a generic 422.
    device_code: str | None = None
    device_name: str | None = None
    farming_type: str | None = None
    farm_id: str | None = None


class DeviceRenamePayload(BaseModel):
    # R2: only the name can change; any other field -> 422 VALIDATION_ERROR.
    model_config = ConfigDict(extra="forbid")

    device_name: str | None = None


def _device_error(exc: DeviceError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=failure(exc.code, exc.message),
    )


def _active_device_or_404(
    db: Session,
    device_id: str,
) -> Device:
    device = db.scalar(
        select(Device).where(
            Device.device_id == device_id,
            Device.is_active.is_(True),
        )
    )

    if device is None:
        raise HTTPException(
            status_code=404,
            detail="Device not found",
        )

    return device


def _low_metric(
    item: tuple[Device, Detection | None],
) -> float:
    device, latest = item

    if latest is None:
        return -1.0

    if device.farming_type == FarmingType.free_range.value:
        return float(latest.low_count)

    return (
        float(latest.low_ratio)
        if latest.low_ratio is not None
        else -1.0
    )


def _iso_datetime(value):
    return value.isoformat() if value is not None else None


def _serialize_device_command(
    command: DeviceCommand,
) -> dict:
    return {
        "command_id": command.command_id,
        "device_id": command.device_id,
        "command_type": command.command_type,
        "command_status": command.command_status,
        "created_at": _iso_datetime(command.created_at),
        "executed_at": _iso_datetime(command.executed_at),
        "result_detection_id": command.result_detection_id,
        "error_message": command.error_message,
    }

@router.get(
    "",
    summary="List devices",
)
def list_devices(
    farming_type: FarmingType | None = Query(default=None),
    status: DeviceListStatus | None = Query(default=None),
    sort: DeviceSort | None = Query(default=None),
    db: Session = Depends(authorized_db),
) -> dict:
    stmt = select(Device).where(
        Device.is_active.is_(True)
    )

    if farming_type is not None:
        stmt = stmt.where(
            Device.farming_type == farming_type.value
        )

    devices = list(
        db.scalars(stmt).all()
    )

    items = [
        (
            device,
            latest_monitoring_detection_for_device(
                db,
                device,
            ),
        )
        for device in devices
    ]

    if status is not None:
        filtered: list[
            tuple[Device, Detection | None]
        ] = []

        for device, latest in items:
            device_status = (
                compute_device_status(device).value
            )

            if status == DeviceListStatus.offline:
                if (
                    device_status
                    == DeviceStatus.offline.value
                ):
                    filtered.append(
                        (device, latest)
                    )

                continue

            if (
                device_status
                != DeviceStatus.offline.value
                and latest is not None
                and latest.monitoring_status
                == status.value
            ):
                filtered.append(
                    (device, latest)
                )

        items = filtered

    if sort == DeviceSort.low_desc:
        items.sort(
            key=_low_metric,
            reverse=True,
        )

    elif sort == DeviceSort.low_asc:
        items.sort(
            key=lambda item: (
                _low_metric(item) < 0,
                _low_metric(item),
            )
        )

    elif sort == DeviceSort.name_asc:
        items.sort(
            key=lambda item: (
                item[0].device_name
                or item[0].device_code
            ).casefold()
        )

    elif sort == DeviceSort.name_desc:
        items.sort(
            key=lambda item: (
                item[0].device_name
                or item[0].device_code
            ).casefold(),
            reverse=True,
        )

    else:
        items.sort(
            key=lambda item: (
                item[0].device_code.casefold()
            )
        )

    return success(
        [
            serialize_device(
                device,
                latest,
            )
            for device, latest in items
        ]
    )


@router.post(
    "",
    summary="Add a device",
    status_code=201,
)
def add_device(
    payload: DeviceCreatePayload,
    db: Session = Depends(authorized_db),
    cloud=Depends(get_device_cloud),
):
    try:
        data = create_device(
            db,
            cloud,
            device_code=payload.device_code,
            device_name=payload.device_name,
            farming_type=payload.farming_type,
            farm_id=payload.farm_id,
        )
    except DeviceError as exc:
        return _device_error(exc)
    return JSONResponse(status_code=201, content=success(data))


@router.get(
    "/removed",
    summary="List removed (soft-deleted) devices",
)
def get_removed_devices(
    db: Session = Depends(authorized_db),
) -> dict:
    return success(list_removed_devices(db))


@router.patch(
    "/{device_id}",
    summary="Rename a device",
)
def patch_device(
    device_id: str,
    payload: DeviceRenamePayload,
    db: Session = Depends(authorized_db),
    cloud=Depends(get_device_cloud),
):
    try:
        return success(rename_device(db, cloud, device_id, payload.device_name))
    except DeviceError as exc:
        return _device_error(exc)


@router.delete(
    "/{device_id}",
    summary="Remove a device (soft) or remove it with all history (purge_history=true)",
)
def delete_device(
    device_id: str,
    purge_history: bool = Query(default=False),
    db: Session = Depends(authorized_db),
    cloud=Depends(get_device_cloud),
):
    try:
        if purge_history:
            return success(purge_device(db, cloud, device_id))
        return success(remove_device(db, cloud, device_id))
    except DeviceError as exc:
        return _device_error(exc)


@router.get(
    "/{device_id}",
    summary="Get device detail",
)
def get_device(
    device_id: str,
    db: Session = Depends(authorized_db),
) -> dict:
    device = _active_device_or_404(
        db,
        device_id,
    )

    latest = (
        latest_monitoring_detection_for_device(
            db,
            device,
        )
    )

    return success(
        serialize_device(
            device,
            latest,
        )
    )


@router.get(
    "/{device_id}/detections/latest",
    summary="Get latest monitoring detection",
)
def get_latest_detection(
    device_id: str,
    db: Session = Depends(authorized_db),
) -> dict:
    device = _active_device_or_404(
        db,
        device_id,
    )

    latest = (
        latest_monitoring_detection_for_device(
            db,
            device,
        )
    )

    return success(
        serialize_detection(latest)
        if latest is not None
        else None
    )


@router.get(
    "/{device_id}/detections",
    summary="Get detection history",
)
def get_detection_history(
    device_id: str,
    db: Session = Depends(authorized_db),
) -> dict:
    _active_device_or_404(
        db,
        device_id,
    )

    detections = (
        detection_history_for_device(
            db,
            device_id,
        )
    )

    return success(
        [
            serialize_detection(item)
            for item in detections
        ]
    )


@router.get(
    "/{device_id}/alerts",
    summary="Get device alerts",
)
def get_device_alerts(
    device_id: str,
    db: Session = Depends(authorized_db),
) -> dict:
    _active_device_or_404(
        db,
        device_id,
    )

    alerts = alerts_for_device(
        db,
        device_id,
    )

    return success(
        [
            serialize_alert(item)
            for item in alerts
        ]
    )


@router.get(
    "/{device_id}/detections/{detection_id}/image",
    summary="Read saved detection image",
)
def get_detection_image(
    device_id: str,
    detection_id: str,
    db: Session = Depends(authorized_db),
):
    return _detection_media(
        device_id,
        detection_id,
        db,
        annotated=False,
    )


@router.get(
    "/{device_id}/detections/{detection_id}/annotated-image",
    summary="Read annotated detection image",
)
def get_annotated_image(
    device_id: str,
    detection_id: str,
    db: Session = Depends(authorized_db),
):
    return _detection_media(
        device_id,
        detection_id,
        db,
        annotated=True,
    )


@router.delete(
    "/{device_id}/detections/{detection_id}/image",
    summary="Delete a detection's images (record and counts are kept)",
)
def delete_history_image(
    device_id: str,
    detection_id: str,
    db: Session = Depends(authorized_db),
) -> dict:
    _active_device_or_404(db, device_id)
    try:
        detection = delete_detection_image(db, device_id, detection_id)
    except DetectionNotFound:
        raise HTTPException(status_code=404, detail="Detection not found") from None
    return success(serialize_detection(detection))


@router.delete(
    "/{device_id}/detections/{detection_id}",
    summary="Delete a detection record from History (soft delete, synced to cloud)",
)
def delete_history_record(
    device_id: str,
    detection_id: str,
    db: Session = Depends(authorized_db),
) -> dict:
    _active_device_or_404(db, device_id)
    try:
        return success(delete_detection_record(db, device_id, detection_id))
    except DetectionNotFound:
        raise HTTPException(status_code=404, detail="Detection not found") from None


def _detection_media(
    device_id: str,
    detection_id: str,
    db: Session,
    *,
    annotated: bool,
):
    _active_device_or_404(
        db,
        device_id,
    )

    detection = db.scalar(
        select(Detection).where(
            Detection.detection_id
            == detection_id,
            Detection.device_id
            == device_id,
            Detection.deleted_at.is_(None),
            Detection.image_deleted_at.is_(None),
        )
    )

    relative_path = (
        (
            detection.annotated_image_path
            if annotated
            else detection.image_path
        )
        if detection
        else None
    )

    if not relative_path:
        raise HTTPException(
            status_code=404,
            detail="Detection image not found",
        )

    image = resolve_image_path(
        relative_path
    )

    if image is None:
        raise HTTPException(
            status_code=404,
            detail="Detection image not found",
        )

    return FileResponse(
        image,
        media_type=(
            "image/png"
            if image.suffix.lower() == ".png"
            else "image/jpeg"
        ),
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post(
    "/{device_id}/commands",
    summary="Create a device command",
)
def create_device_command(
    device_id: str,
    payload: DeviceCommandCreatePayload,
    db: Session = Depends(authorized_db),
) -> dict:
    """Create a pending command for hardware execution."""

    device = _active_device_or_404(
        db,
        device_id,
    )

    if (
        payload.command_type
        != CommandType.manual_detection
    ):
        raise HTTPException(
            status_code=400,
            detail="Unsupported command type",
        )

    command = (
        create_manual_detection_command(
            db,
            device,
        )
    )

    return success(
        _serialize_device_command(
            command
        )
    )


@router.post(
    "/{device_id}/detect",
    summary="Run manual detection now",
)
def run_manual_detection_now(
    device_id: str,
    db: Session = Depends(authorized_db),
    capture_adapter: CaptureAdapter = Depends(
        get_capture_adapter
    ),
    ai_adapter: AIAdapter = Depends(
        get_ai_adapter
    ),
) -> dict:
    """Capture one current frame, call the real AI service, save and return Detection.

    Monitoring Enabled intentionally does not block this endpoint.
    Free-range manual results are immediate single-frame observations;
    they are saved in History but do not replace the latest formal
    Result Snapshot used by monitoring cards/Home.
    """

    device = _active_device_or_404(
        db,
        device_id,
    )

    if (
        compute_device_status(device)
        != DeviceStatus.online
    ):
        return JSONResponse(
            status_code=409,
            content=failure(
                "DEVICE_OFFLINE",
                "Device is offline",
            ),
        )

    try:
        frame = capture_adapter.capture(
            device
        )

    except CaptureAdapterUnavailable:
        return JSONResponse(
            status_code=503,
            content=failure(
                "CAPTURE_NOT_CONFIGURED",
                (
                    "Camera capture adapter is not "
                    "configured for this backend"
                ),
            ),
        )

    except CaptureFailed:
        record_detection_failure(
            db,
            device,
            "Camera capture failed.",
        )

        return JSONResponse(
            status_code=502,
            content=failure(
                "DETECTION_FAILED",
                "Camera capture failed",
            ),
        )

    try:
        ai_result = ai_adapter.infer(
            device,
            frame,
        )

    except AIServiceUnavailable:
        record_detection_failure(
            db,
            device,
            (
                "AI inference service is "
                "unavailable."
            ),
        )

        return JSONResponse(
            status_code=503,
            content=failure(
                "AI_SERVICE_UNAVAILABLE",
                (
                    "AI inference service "
                    "is unavailable"
                ),
            ),
        )

    except AIInvalidResponse:
        record_detection_failure(
            db,
            device,
            (
                "AI returned an invalid "
                "detection result."
            ),
        )

        return JSONResponse(
            status_code=502,
            content=failure(
                "INVALID_AI_RESULT",
                (
                    "AI returned an invalid "
                    "detection result"
                ),
            ),
        )

    except Exception:
        record_detection_failure(
            db,
            device,
        )

        return JSONResponse(
            status_code=502,
            content=failure(
                "DETECTION_FAILED",
                "Detection task failed",
            ),
        )

    try:
        detection = persist_inference_media(
            db,
            device,
            frame,
            ai_result,
        )

    except ImageStorageError:
        record_detection_failure(
            db,
            device,
            (
                "Detection image could "
                "not be saved."
            ),
        )

        return JSONResponse(
            status_code=507,
            content=failure(
                "IMAGE_STORAGE_FAILED",
                (
                    "Detection image could "
                    "not be saved"
                ),
            ),
        )

    except ValueError:
        record_detection_failure(
            db,
            device,
            (
                "AI returned an invalid "
                "detection result."
            ),
        )

        return JSONResponse(
            status_code=502,
            content=failure(
                "INVALID_AI_RESULT",
                (
                    "AI returned an invalid "
                    "detection result"
                ),
            ),
        )

    return success(
        serialize_detection(
            detection
        )
    )
