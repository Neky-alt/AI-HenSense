"""Retain original capture images and serve only DB-authorized Detection files.

Storage path is relative to LOCAL_IMAGE_DIR; API URL is generated from the Detection ID.
No AI annotations are required for this first local-media milestone.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from app.config import BASE_DIR, settings
from app.services.capture_adapter import CapturedFrame


class ImageStorageError(Exception):
    """Captured image could not be safely retained."""


def storage_root() -> Path:
    root = Path(settings.LOCAL_IMAGE_DIR).expanduser()
    return (root if root.is_absolute() else BASE_DIR / root).resolve()


def save_capture_image(frame: CapturedFrame, device_id: str, *, owner_id: str | None = None, max_bytes: int | None = None) -> str:
    """Save a fresh copy of a frame; never reuse/modify the test source image."""
    # Device IDs are UUIDs in the existing DB contract, not arbitrary path fragments.
    try:
        safe_id = str(UUID(str(device_id)))
    except ValueError as exc:
        raise ImageStorageError("Invalid device identifier") from exc

    allowed_types = {"image/jpeg": ".jpg", "image/png": ".png"}
    suffix = allowed_types.get(frame.content_type)
    if suffix is None:
        raise ImageStorageError("Only JPEG and PNG captures are supported")
    if not frame.content or len(frame.content) > (max_bytes if max_bytes is not None else settings.MAX_DETECTION_IMAGE_BYTES):
        raise ImageStorageError("Captured image is empty or exceeds the size limit")

    day = (frame.captured_at or datetime.now(timezone.utc)).strftime("%Y-%m-%d")
    rel_path = Path(safe_id) / day / f"{uuid4().hex}{suffix}"
    if owner_id is not None:
        rel_path = Path("quick_detections") / str(UUID(owner_id)) / rel_path
    root = storage_root()
    target = root / rel_path
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as output:
            output.write(frame.content)
    except OSError as exc:
        target.unlink(missing_ok=True)
        raise ImageStorageError("Unable to save captured image") from exc
    return rel_path.as_posix()


def resolve_image_path(relative_path: str) -> Path | None:
    """Reject traversal/absolute paths, including legacy DB entries outside media root."""
    if not relative_path or Path(relative_path).is_absolute():
        return None
    root = storage_root()
    candidate = (root / relative_path).resolve()
    if not candidate.is_relative_to(root) or not candidate.is_file():
        return None
    return candidate


def remove_image(relative_path: str) -> None:
    path = resolve_image_path(relative_path)
    if path is not None:
        path.unlink(missing_ok=True)
