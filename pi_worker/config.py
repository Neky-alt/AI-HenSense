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

    return PiWorkerConfig(
        backend_base_url=backend_base_url,
        device_id=device_id,
        hardware_api_key=hardware_api_key,
    )