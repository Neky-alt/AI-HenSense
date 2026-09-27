"""Internal Raspberry Pi / hardware integration routes."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.hardware_auth import require_hardware_key
from app.models import Device, utcnow
from app.responses import success
from app.services.core_data import compute_device_status, utc_iso


router = APIRouter(
    prefix="/hardware",
    tags=["Hardware"],
)


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