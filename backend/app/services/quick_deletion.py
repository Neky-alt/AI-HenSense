"""Delete only verified-owner Quick media; stage files before committing the row removal."""
import logging
import shutil
from pathlib import Path
from uuid import UUID
from fastapi import HTTPException
from sqlalchemy import select, text
from app.quick_models import QuickDetection
from app.services.detection_images import storage_root

log = logging.getLogger(__name__)

def error(code, status=503):
    return HTTPException(status, {'code': code})

def safe_path(path, root):
    # Reject symlinks in every component, including a replaced user/attempt directory.
    if not path.is_relative_to(root):
        raise error('DELETE_UNSAFE_MEDIA')
    for part in [path, *path.parents]:
        if part == root: break
        if part.is_symlink(): raise error('DELETE_UNSAFE_MEDIA')
    if not path.resolve().is_relative_to(root): raise error('DELETE_UNSAFE_MEDIA')
    return path

def delete_quick(db, user, record_id):
    root = storage_root()
    owner = root / 'quick_detections' / str(UUID(user))
    staged = safe_path(owner / '.deleting' / str(UUID(record_id)), root)
    source = None
    moved = False
    committed = False
    try:
        # Serialize SQLite deletes/retries, including the processing-state check.
        db.execute(text('BEGIN IMMEDIATE'))
        row = db.scalar(select(QuickDetection).where(QuickDetection.quick_detection_id == record_id, QuickDetection.user_id == user))
        if row is None:
            db.rollback()
            if not staged.exists(): raise error('NOT_FOUND', 404)
            # A previous delete committed but cleanup failed. Only this owner's staging can be retried.
            shutil.rmtree(staged)
            return
        if row.status == 'processing': raise error('DELETE_BUSY', 409)
        source = safe_path(owner / str(UUID(row.attempt_id)), root)
        if db.scalar(select(QuickDetection.quick_detection_id).where(QuickDetection.attempt_id == row.attempt_id, QuickDetection.quick_detection_id != record_id)):
            raise error('DELETE_UNSAFE_MEDIA')
        for value in (row.original_upload_path, row.image_path, row.annotated_image_path):
            if value:
                candidate = root / value
                if Path(value).is_absolute() or '..' in Path(value).parts or not candidate.is_relative_to(source):
                    raise error('DELETE_UNSAFE_MEDIA')
                safe_path(candidate, root)
        # A prior process may have stopped after staging but before commit.
        if source.exists() and staged.exists(): raise error('DELETE_UNSAFE_MEDIA')
        if source.exists():
            safe_path(staged.parent, root).mkdir(parents=True, exist_ok=True)
            source.rename(staged)
            moved = True
        elif staged.exists():
            moved = True
        db.delete(row)
        try:
            db.commit()
            committed = True
        except Exception:
            db.rollback()
            # Resolve an ambiguous commit before restoring/removing media.
            persisted = db.get(QuickDetection, record_id, populate_existing=True)
            committed = persisted is None
            if not committed: raise
        if staged.exists(): shutil.rmtree(staged)
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        if moved and not committed and source is not None:
            try:
                # Do not restore on an uncertain database read failure.
                if db.get(QuickDetection, record_id, populate_existing=True) is not None and staged.exists() and not source.exists():
                    staged.rename(source)
            except Exception:
                log.exception('Quick delete rollback recovery required: %s', record_id)
        log.warning('Quick deletion failed: %s', record_id, exc_info=True)
        raise error('DELETE_CLEANUP_PENDING' if committed else 'DELETE_FAILED') from exc
    finally:
        db.rollback()  # release any transaction opened by commit verification
