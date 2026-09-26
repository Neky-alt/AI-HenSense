"""Capture adapter boundary for BE-03.

The product contract says Run Detection Now captures the current Pi-camera frame before
AI inference.  Hardware camera details are still a project TBD, so the backend keeps a
small replaceable boundary instead of hard-coding Picamera/OpenCV commands.

For local acceptance testing, ``CAPTURE_ADAPTER_MODE=test_file`` reads one configured
image from disk.  Production defaults to ``unconfigured`` until the Hardware team wires
the real Raspberry Pi camera implementation to this interface.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Protocol

from app.config import BASE_DIR, settings
from app.models import Device, utcnow


@dataclass(frozen=True)
class CapturedFrame:
    content: bytes
    filename: str
    content_type: str = "image/jpeg"
    captured_at: datetime | None = None
    local_path: str | None = None


class CaptureAdapter(Protocol):
    def capture(self, device: Device) -> CapturedFrame:
        ...


class CaptureAdapterUnavailable(RuntimeError):
    """No production camera adapter has been configured yet."""


class CaptureFailed(RuntimeError):
    """A configured capture adapter attempted capture but failed."""


class UnconfiguredCaptureAdapter:
    def capture(self, device: Device) -> CapturedFrame:
        raise CaptureAdapterUnavailable(
            "Camera capture adapter is not configured for this backend."
        )


class TestFileCaptureAdapter:
    """Local-only adapter that treats one file as the current camera frame.

    This is deliberately explicit and opt-in.  It allows the real AI service to be
    exercised end-to-end before Raspberry Pi camera code is available, without ever
    fabricating AI predictions in the Country Watch backend.
    """

    def __init__(self, image_path: str | Path | None = None):
        raw_path = image_path or settings.CAPTURE_TEST_IMAGE_PATH
        self.image_path = Path(raw_path).expanduser()
        if not self.image_path.is_absolute():
            self.image_path = (BASE_DIR / self.image_path).resolve()

    def capture(self, device: Device) -> CapturedFrame:
        try:
            content = self.image_path.read_bytes()
        except OSError as exc:
            raise CaptureFailed(f"Unable to read capture test image: {self.image_path}") from exc

        suffix = self.image_path.suffix.casefold()
        content_type = "image/png" if suffix == ".png" else "image/jpeg"
        return CapturedFrame(
            content=content,
            filename=self.image_path.name,
            content_type=content_type,
            captured_at=utcnow(),
            # This path is an input/test asset, not a retained Detection Image.
            local_path=None,
        )


def get_capture_adapter() -> CaptureAdapter:
    mode = settings.CAPTURE_ADAPTER_MODE.casefold().strip()
    if mode in {"test_file", "file"}:
        return TestFileCaptureAdapter()
    return UnconfiguredCaptureAdapter()
