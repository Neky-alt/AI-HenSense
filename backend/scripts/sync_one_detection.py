"""Run from backend/: .venv/bin/python scripts/sync_one_detection.py ...

Dry-run by default. --apply mutates ONLY a specifically named disposable SQLite copy.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

# backend/scripts -> backend for app imports
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings
from app.services.cloud_sync import SyncClient, sync_one


def main():
    parser = argparse.ArgumentParser(description='BE-04 one-record cloud sync; dry run by default')
    parser.add_argument('--db', type=Path, required=True, help='Use ONLY a disposable copy, not validation.db')
    parser.add_argument('--media-dir', type=Path, required=True)
    parser.add_argument('--owner-user-id', default=os.environ.get('SUPABASE_SYNC_OWNER_ID', ''),
                        help='Your own Supabase auth.users.id, not the local demo user id')
    parser.add_argument('--detection-id', default=None)
    parser.add_argument('--apply', action='store_true', help='Upload and mark ONLY one local record synced')
    args = parser.parse_args()
    if not args.owner_user_id:
        parser.error('Provide --owner-user-id (your real Supabase Auth UUID)')
    if not args.db.is_file():
        parser.error('SQLite DB missing')
    if args.apply and args.db.name != 'sync_trial.db':
        parser.error('--apply is only allowed for a disposable file named sync_trial.db')
    if not args.media_dir.is_dir():
        parser.error('Local media directory missing')

    # Dry run gets read-only SQLite; apply explicitly uses the disposable copy.
    db_url = f'file:{args.db.resolve()}?mode={"rw" if args.apply else "ro"}'
    conn = sqlite3.connect(db_url, uri=True)
    client = None
    try:
        client = SyncClient(settings.SUPABASE_URL, settings.SUPABASE_KEY)
        result = sync_one(conn, args.media_dir, client, args.owner_user_id,
                          detection_id=args.detection_id, apply=args.apply)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    except Exception as exc:
        conn.rollback()
        print(f'SYNC FAILED (local DB remains unchanged): {exc}', file=sys.stderr)
        return 1
    finally:
        conn.close()
        if client:
            client.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
