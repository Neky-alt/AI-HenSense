"""Opt-in BE04 foreground process; keep exactly one worker per SQLite DB."""
from __future__ import annotations
import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path
from uuid import UUID
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.config import settings
from app.services.be04_worker import CloudTransport,Worker,status
from app.services.process_lock import try_lock

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db',type=Path,required=True)
    p.add_argument('--media-dir',type=Path,required=True)
    p.add_argument('--owner-user-id',required=True)
    p.add_argument('--farm-id',required=True)
    p.add_argument('--limit',type=int,default=100)
    p.add_argument('--interval-seconds',type=int,default=60)
    p.add_argument('--apply',action='store_true')
    p.add_argument('--watch',action='store_true')
    p.add_argument('--include-settings',action='store_true',help='Opt-in local->cloud settings, do not use if cloud edits may be newer')
    p.add_argument('--status',action='store_true')
    p.add_argument('--active-db-check',action='store_true',help='Require Worker DB/media to match the FastAPI DATABASE_URL/LOCAL_IMAGE_DIR')
    a=p.parse_args()
    UUID(a.owner_user_id);UUID(a.farm_id)
    if not a.db.is_file():p.error('SQLite DB missing')
    if not a.media_dir.is_dir():p.error('media-dir missing')
    if not 1<=a.limit<=500 or a.interval_seconds<10:p.error('Invalid limit / interval')
    if a.watch and not a.apply:p.error('--watch requires --apply')
    # Explicit safety barrier; never mutate original validation.db or old formal db.
    resolved=a.db.resolve()
    if a.active_db_check:
        from sqlalchemy.engine import make_url
        configured = make_url(settings.DATABASE_URL)
        if not configured.drivername.startswith('sqlite') or not configured.database:
            p.error('BE-04 requires a configured SQLite DATABASE_URL')
        if Path(configured.database).resolve() != resolved:
            p.error('Worker DB does not match FastAPI DATABASE_URL')
        if Path(settings.LOCAL_IMAGE_DIR).resolve() != a.media_dir.resolve():
            p.error('Worker media directory does not match FastAPI LOCAL_IMAGE_DIR')
    if a.apply and ('field_validation-' in str(resolved) or resolved.name in {'validation.db','hen_monitoring.db'}):
        p.error('Use a disposable copy; this command refuses known source databases')
    # Exclusive process lock for apply/watch. Keeps Uvicorn reload and double terminals
    # from running two sync workers on the same SQLite file.
    lock_handle = None
    if a.apply:
        lock_path = resolved.with_suffix(resolved.suffix + '.be04.lock')
        lock_handle = lock_path.open('a+')
        if not try_lock(lock_handle):
            p.error('BE-04 worker already running for this database')
    # as_uri() gives file:///D:/... on Windows; a raw backslash path is not a valid URI.
    uri=f'{resolved.as_uri()}?mode={"rw" if a.apply else "ro"}' 
    # Status is read-only unless --apply was explicitly supplied.
    with sqlite3.connect(uri,uri=True,timeout=20) as conn:
        if a.status:
            print(json.dumps(status(conn),indent=2));return
        cloud=CloudTransport(settings.SUPABASE_URL,settings.SUPABASE_KEY)
        try:
            worker=Worker(conn,a.media_dir,cloud,a.owner_user_id,a.farm_id,include_settings=a.include_settings)
            while True:
                try:
                    result=worker.once(limit=a.limit,dry_run=not a.apply)
                    print(json.dumps(result,indent=2),flush=True)
                except Exception as exc:
                    # A temporary network outage must not stop --watch.
                    # Print only exception type to avoid leaking credentials / URL.
                    print(json.dumps({'status':'cycle_failed','error_type':type(exc).__name__}),flush=True)
                    if not a.watch:
                        raise SystemExit(1)
                if not a.watch:break
                time.sleep(a.interval_seconds)
        except KeyboardInterrupt:
            print('Stopped by user')
        finally:
            cloud.close()

if __name__=='__main__':main()
