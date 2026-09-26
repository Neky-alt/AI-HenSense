"""BE-04 trial batch worker for an isolated `sync_trial.db` ONLY.

One-shot dry run by default. --apply writes only the explicitly supplied disposable
DB and uploads to the configured Supabase project. --watch runs in foreground and
can be stopped with Ctrl+C. No local/web/app/Pi production integration yet.

Usage (from backend/):
  .venv/bin/python scripts/sync_pending_detections.py --db .../sync_trial.db \
      --media-dir .../media --owner-user-id <UUID> --limit 1
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings
from app.services.cloud_sync import SyncClient, sync_one

RETRY_TABLE = """
CREATE TABLE IF NOT EXISTS be04_sync_attempts (
    detection_id TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    next_retry_at TEXT,
    last_error_type TEXT
)
"""


def now_utc():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.isoformat().replace('+00:00', 'Z')


def check_trial_db(path: Path, apply: bool):
    if not path.is_file():
        raise ValueError('Database does not exist')
    if apply and (path.name != 'sync_trial.db' or 'field_validation-' in str(path.resolve())):
        raise ValueError('--apply only permitted on disposable sync_trial.db; never validation.db')
    uri = f'file:{path.resolve()}?mode={"rw" if apply else "ro"}'
    return sqlite3.connect(uri, uri=True, timeout=15)


def select_rows(conn, limit, apply):
    # Retries are eligible when next_retry_at has passed; untouched pending rows
    # have no ledger entry. A dry run must not create a ledger table.
    ledger_exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='be04_sync_attempts'"
    ).fetchone() is not None
    sql = """SELECT d.detection_id, d.device_id, d.sync_status,
                    d.image_path, d.annotated_image_path
             FROM detections AS d"""
    if ledger_exists:
        sql += ' LEFT JOIN be04_sync_attempts AS a ON a.detection_id=d.detection_id'
    sql += " WHERE d.sync_status IN ('pending','failed') AND d.deleted_at IS NULL "
    # This trial worker deliberately excludes tombstones and expired images.
    sql += 'AND d.image_deleted_at IS NULL '
    if ledger_exists:
        sql += "AND (a.next_retry_at IS NULL OR a.next_retry_at <= ?) "
    sql += 'ORDER BY d.detected_at, d.detection_id LIMIT ?'
    params = (iso(now_utc()), limit) if ledger_exists else (limit,)
    conn.row_factory = sqlite3.Row
    return conn.execute(sql, params).fetchall()


def record_failed(conn, detection_id, exc, max_backoff_seconds):
    # Errors are logged by TYPE ONLY; never dump URLs, keys, server error bodies,
    # request headers, or filenames into the trial database.
    previous = conn.execute(
        'SELECT attempts FROM be04_sync_attempts WHERE detection_id=?',
        (detection_id,)
    ).fetchone()
    attempts = (previous[0] if previous else 0) + 1
    delay = min(max_backoff_seconds, 30 * (2 ** min(attempts - 1, 10)))
    retry = now_utc() + timedelta(seconds=delay)
    conn.execute('''INSERT INTO be04_sync_attempts
          (detection_id, attempts, last_attempt_at, next_retry_at, last_error_type)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(detection_id) DO UPDATE SET attempts=excluded.attempts,
              last_attempt_at=excluded.last_attempt_at,
              next_retry_at=excluded.next_retry_at,
              last_error_type=excluded.last_error_type''',
        (detection_id, attempts, iso(now_utc()), iso(retry), type(exc).__name__))
    conn.execute("UPDATE detections SET sync_status='failed' "
                 "WHERE detection_id=? AND sync_status IN ('pending','failed')", (detection_id,))
    conn.commit()
    return attempts, delay


def process_batch(conn, client, args):
    if args.apply:
        conn.execute(RETRY_TABLE)
        conn.commit()
    rows = select_rows(conn, args.limit, args.apply)
    outcomes = []
    for row in rows:
        id_ = row['detection_id']
        try:
            response = sync_one(conn, args.media_dir, client, args.owner_user_id,
                                detection_id=id_, apply=args.apply)
            if args.apply:
                conn.execute('DELETE FROM be04_sync_attempts WHERE detection_id=?', (id_,))
                conn.commit()
            outcomes.append({'id': id_, 'status': response['mode'],
                             'uploaded_images': response.get('uploaded_images')})
        except Exception as exc:
            conn.rollback()
            detail = {'id': id_, 'status': 'FAILED', 'error_type': type(exc).__name__}
            if args.apply:
                attempts, backoff = record_failed(conn, id_, exc, args.max_backoff_seconds)
                detail.update(attempts=attempts, retry_after_seconds=backoff)
            outcomes.append(detail)
            # A wrong account or broken auth/configuration is global: stop rather
            # than repeatedly retry every record. Local file failures are per-row.
            if isinstance(exc, ValueError) and ('Cloud farm' in str(exc) or 'Cloud device' in str(exc)):
                break
            if 'Supabase HTTP 401' in str(exc) or 'Supabase HTTP 403' in str(exc):
                break
    return outcomes


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db', required=True, type=Path)
    p.add_argument('--media-dir', required=True, type=Path)
    p.add_argument('--owner-user-id', required=True)
    p.add_argument('--limit', type=int, default=1,
                   help='Maximum rows per pass, default 1; maximum 100')
    p.add_argument('--apply', action='store_true', help='Actually upload and update trial DB')
    p.add_argument('--watch', action='store_true', help='Stay running and retry pending rows')
    p.add_argument('--interval-seconds', type=int, default=60)
    p.add_argument('--max-backoff-seconds', type=int, default=3600)
    a = p.parse_args(argv)
    if not (1 <= a.limit <= 100):
        p.error('--limit must be 1..100')
    if a.watch and not a.apply:
        p.error('--watch requires --apply')
    if a.interval_seconds < 10 or a.max_backoff_seconds < 30:
        p.error('Interval must be >=10 and max backoff >=30 seconds')
    try:
        UUID(a.owner_user_id)
        if not a.media_dir.is_dir():
            raise ValueError('Media directory does not exist')
        conn = check_trial_db(a.db, a.apply)
    except ValueError as exc:
        p.error(str(exc))
    client = None
    try:
        client = SyncClient(settings.SUPABASE_URL, settings.SUPABASE_KEY)
        while True:
            outcomes = process_batch(conn, client, a)
            print(json.dumps({'mode': 'APPLY' if a.apply else 'DRY RUN',
                              'selected': len(outcomes), 'results': outcomes},
                             ensure_ascii=False, indent=2), flush=True)
            if not a.watch:
                return 1 if any(r['status'] == 'FAILED' for r in outcomes) else 0
            if outcomes and any(r['status'] == 'FAILED' for r in outcomes):
                # Still continue on next interval; backoff prevents tight retries.
                pass
            time.sleep(a.interval_seconds)
    except KeyboardInterrupt:
        print('Stopped by user; local data kept.', file=sys.stderr)
        return 0
    except Exception as exc:
        print(f'BATCH STOPPED: {type(exc).__name__}', file=sys.stderr)
        return 1
    finally:
        conn.close()
        if client:
            client.close()


if __name__ == '__main__':
    raise SystemExit(main())
