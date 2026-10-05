"""Detection history deletion and fixed image retention.

Both use the tombstones that already exist on ``detections``:

- ``image_deleted_at``: the record stays, its original/annotated images are gone.
- ``deleted_at``:       the record is soft-deleted and hidden from History.

Every change sets ``sync_status='pending'`` so the BE-04 Worker re-publishes the
row; the Worker deletes the cloud image objects for tombstoned rows before
upserting the empty references (see be04_worker._sync_detection). Local files
are removed only after the database commit succeeds.

Image retention is fixed by team decision (2026-10-03): detection images are kept
for ``DETECTION_IMAGE_RETENTION_DAYS`` (30) days and then deleted automatically,
locally and in the cloud. Records and counts are kept; only images expire.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.enums import SyncStatus
from app.models import Detection, utcnow
from app.services.detection_images import remove_image


@dataclass
class DetectionNotFound(Exception):
    detection_id: str


def _media_paths(detection: Detection) -> list[str]:
    return [p for p in (detection.image_path, detection.annotated_image_path) if p]


def _remove_files(paths: list[str]) -> None:
    for relative in paths:
        remove_image(relative)  # resolves safely inside LOCAL_IMAGE_DIR; ignores missing


def _tombstone_images(detection: Detection, now: datetime) -> list[str]:
    paths = _media_paths(detection)
    if detection.image_deleted_at is None:
        detection.image_deleted_at = now
    detection.sync_status = SyncStatus.pending.value
    return paths


def _live_detection(db: Session, device_id: str, detection_id: str) -> Detection:
    detection = db.scalar(
        select(Detection).where(
            Detection.detection_id == detection_id,
            Detection.device_id == device_id,
            Detection.deleted_at.is_(None),
        )
    )
    if detection is None:
        raise DetectionNotFound(detection_id)
    return detection


def delete_detection_image(db: Session, device_id: str, detection_id: str) -> Detection:
    """Keep the record and its counts; delete both images. Idempotent."""
    detection = _live_detection(db, device_id, detection_id)
    if detection.image_deleted_at is not None:
        return detection
    paths = _tombstone_images(detection, utcnow())
    db.commit()
    _remove_files(paths)
    return detection


def delete_detection_record(db: Session, device_id: str, detection_id: str) -> dict:
    """Soft-delete the record (hidden from History) and delete its images."""
    detection = _live_detection(db, device_id, detection_id)
    now = utcnow()
    paths = _tombstone_images(detection, now)
    detection.deleted_at = now
    db.commit()
    _remove_files(paths)
    return {"detection_id": detection_id, "deleted": True}


# --------------------------------------------------------------------- retention
def apply_image_retention(db: Session, *, now: datetime | None = None) -> int:
    """Expire images older than the fixed retention period. Returns detections changed."""
    now = now or utcnow()
    cutoff = now - timedelta(days=settings.DETECTION_IMAGE_RETENTION_DAYS)
    expired = db.scalars(
        select(Detection).where(
            Detection.detected_at < cutoff,
            Detection.image_deleted_at.is_(None),
            or_(Detection.image_path.is_not(None), Detection.annotated_image_path.is_not(None)),
        )
    ).all()
    paths: list[str] = []
    for detection in expired:
        paths += _tombstone_images(detection, now)
    if expired:
        db.commit()
        _remove_files(paths)
    return len(expired)


_retention_lock = threading.Lock()
_last_retention_run: datetime | None = None


def maybe_apply_image_retention(db: Session, *, now: datetime | None = None) -> int | None:
    """Run retention at most once per RETENTION_CHECK_INTERVAL; never raises.

    Called from the hardware heartbeat so the policy runs whenever the system is
    live, without a separate scheduler process. Returns None when skipped.
    """
    global _last_retention_run
    now = now or utcnow()
    interval = timedelta(minutes=settings.IMAGE_RETENTION_CHECK_INTERVAL_MINUTES)
    with _retention_lock:
        if _last_retention_run is not None and now - _last_retention_run < interval:
            return None
        _last_retention_run = now
    try:
        return apply_image_retention(db, now=now)
    except Exception:
        db.rollback()
        return None


def reset_retention_throttle() -> None:
    """Test helper."""
    global _last_retention_run
    with _retention_lock:
        _last_retention_run = None
