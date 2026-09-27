"""Camera capture abstraction for the Raspberry Pi worker."""

from __future__ import annotations

import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path


PI_WORKER_DIR = Path(__file__).resolve().parent
CAPTURE_DIR = PI_WORKER_DIR / "captures"


class CameraError(RuntimeError):
    """Raised when the Pi camera cannot capture an image."""


def _capture_from_test_image() -> Path | None:
    """
    Use an existing image during development on a non-Raspberry-Pi machine.

    Set:
        HENSENSE_TEST_IMAGE=<path to jpg/png>

    This path is only for local integration testing.
    """

    raw_path = os.environ.get(
        "HENSENSE_TEST_IMAGE",
        "",
    ).strip()

    if not raw_path:
        return None

    source = Path(raw_path).expanduser().resolve()

    if not source.is_file():
        raise CameraError(
            f"Test image does not exist: {source}"
        )

    suffix = source.suffix.lower()

    if suffix not in {".jpg", ".jpeg", ".png"}:
        raise CameraError(
            "Test image must be JPEG or PNG"
        )

    CAPTURE_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    destination = CAPTURE_DIR / (
        f"{datetime.now():%Y%m%d_%H%M%S}_"
        f"{uuid.uuid4().hex}{suffix}"
    )

    shutil.copy2(
        source,
        destination,
    )

    print(
        "[Pi Camera] Development image copied:",
        destination,
    )

    return destination


def _capture_with_picamera2() -> Path:
    """Capture one JPEG image using Raspberry Pi Picamera2."""

    try:
        from picamera2 import Picamera2
    except ImportError as exc:
        raise CameraError(
            "Picamera2 is not installed. "
            "Run this worker on the Raspberry Pi or set "
            "HENSENSE_TEST_IMAGE for local development."
        ) from exc

    CAPTURE_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    destination = CAPTURE_DIR / (
        f"{datetime.now():%Y%m%d_%H%M%S}_"
        f"{uuid.uuid4().hex}.jpg"
    )

    camera = Picamera2()

    try:
        config = camera.create_still_configuration()
        camera.configure(config)

        camera.start()

        camera.capture_file(
            str(destination)
        )

    except Exception as exc:
        raise CameraError(
            f"Camera capture failed: {exc}"
        ) from exc

    finally:
        try:
            camera.stop()
        except Exception:
            pass

        try:
            camera.close()
        except Exception:
            pass

    if not destination.is_file():
        raise CameraError(
            "Camera capture completed but no image was created"
        )

    print(
        "[Pi Camera] Captured:",
        destination,
    )

    return destination


def capture_image() -> Path:
    """
    Capture one image.

    Local development:
        HENSENSE_TEST_IMAGE=test_cage.jpg

    Raspberry Pi:
        Uses Picamera2.
    """

    test_image = _capture_from_test_image()

    if test_image is not None:
        return test_image

    return _capture_with_picamera2()