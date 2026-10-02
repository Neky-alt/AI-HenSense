"""Configuration for the Raspberry Pi worker."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class PiWorkerConfig:
    backend_base_url: str
    device_id: str
    hardware_api_key: str
    request_timeout_seconds: float = 10.0
    poll_interval_seconds: float = 5.0


def _read_positive_float(
    name: str,
    default: float,
) -> float:
    """Read a positive floating-point environment variable."""

    raw_value = os.environ.get(
        name,
        str(default),
    ).strip()

    try:
        value = float(raw_value)
    except ValueError as exc:
        raise RuntimeError(
            f"{name} must be a number"
        ) from exc

    if value <= 0:
        raise RuntimeError(
            f"{name} must be greater than 0"
        )

    return value


def load_config() -> PiWorkerConfig:
    backend_base_url = os.environ.get(
        "HENSENSE_BACKEND_URL",
        "",
    ).rstrip("/")

    device_id = os.environ.get(
        "HENSENSE_DEVICE_ID",
        "",
    ).strip()

    hardware_api_key = os.environ.get(
        "HENSENSE_HARDWARE_API_KEY",
        "",
    ).strip()

    if not backend_base_url:
        raise RuntimeError(
            "HENSENSE_BACKEND_URL is required"
        )

    if not device_id:
        raise RuntimeError(
            "HENSENSE_DEVICE_ID is required"
        )

    if not hardware_api_key:
        raise RuntimeError(
            "HENSENSE_HARDWARE_API_KEY is required"
        )

    request_timeout_seconds = _read_positive_float(
        "HENSENSE_REQUEST_TIMEOUT_SECONDS",
        10.0,
    )

    poll_interval_seconds = _read_positive_float(
        "HENSENSE_POLL_INTERVAL_SECONDS",
        5.0,
    )

    return PiWorkerConfig(
        backend_base_url=backend_base_url,
        device_id=device_id,
        hardware_api_key=hardware_api_key,
        request_timeout_seconds=request_timeout_seconds,
        poll_interval_seconds=poll_interval_seconds,
    )