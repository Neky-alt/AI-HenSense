"""Authentication for trusted Raspberry Pi / hardware requests."""

import hmac

from fastapi import Header, HTTPException

from app.config import settings


def require_hardware_key(
    hardware_key: str | None = Header(default=None, alias="X-Hardware-Key"),
) -> None:
    configured_key = settings.HARDWARE_API_KEY.strip()

    if not configured_key:
        raise HTTPException(
            status_code=503,
            detail="Hardware authentication is not configured",
        )

    if not hardware_key or not hmac.compare_digest(hardware_key, configured_key):
        raise HTTPException(
            status_code=401,
            detail="Invalid hardware credentials",
        )