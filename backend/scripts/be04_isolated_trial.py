"""Prepare and mutate a REAL isolated BE-04 cloud-sync sandbox.

No Supabase credentials or network operations. Never edits its source SQLite/media.
Run from backend/ with .venv/bin/python scripts/be04_isolated_trial.py ...
"""
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

MAGIC = "HENSENSE_BE04_ISOLATED_V1"
TABLES = ("profiles", "farms", "devices", "detections", "alerts")

def iso_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def rowdict(r):
    return dict(r)

def insert_row(conn, table, row):
    names = tuple(row)
    conn.execute(
        f'INSERT INTO {table} ({",".join(names)}) VALUES ({",".join("?" for _ in names)})',
        tuple(row.values()),
    )

def resolve_image(media_root: Path, rel_path: str):
    base = media_root.resolve(strict=True)
    candidate = (base / rel_path).resolve(strict=True)
    if not candidate.is_relative_to(base) or not candidate.is_file():
        raise ValueError("Source image missing or outside specified media root")
    return candidate

def prepare(src_db: Path, source_media: Path, target: Path):
    source_db = src_db.resolve(strict=True)
    source_root = source_media.resolve(strict=True)
    output = target.resolve(strict=False)
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite test directory: {output}")
    if output == source_db.parent or source_db.is_relative_to(output) or output.is_relative_to(source_db.parent / "field_validation-20260924"):
        raise ValueError("Target must be a new, independent sandbox directory")
    with sqlite3.connect(f"file:{source_db}?mode=ro", uri=True) as source:
        source.row_factory = sqlite3.Row
        picked = source.execute("""
            SELECT d.* FROM detections d JOIN devices v ON d.device_id=v.device_id
            WHERE d.image_path IS NOT NULL AND d.annotated_image_path IS NOT NULL
              AND d.deleted_at IS NULL AND d.image_deleted_at IS NULL
            ORDER BY d.detected_at,d.detection_id LIMIT 2
        """).fetchall()
        if len(picked) != 2:
            raise ValueError("Need two active Detections with both images")
        devices = [rowdict(source.execute('SELECT * FROM devices WHERE device_id=?', (r['device_id'],)).fetchone()) for r in picked]
        original_farm_ids = {d['farm_id'] for d in devices}
        if len(original_farm_ids) != 1:
            raise ValueError("The two source Detections must belong to one farm")
        farm = rowdict(source.execute('SELECT * FROM farms WHERE farm_id=?', (devices[0]['farm_id'],)).fetchone())
        profile_result = source.execute('SELECT * FROM profiles WHERE user_id=?', (farm['user_id'],)).fetchone()
        profile = rowdict(profile_result) if profile_result else None
        # Verify every source file before creating the target directory.
        image_sources = [(resolve_image(source_root, r['image_path']),resolve_image(source_root, r['annotated_image_path'])) for r in picked]
        schemas = {}
        for table in TABLES:
            found = source.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?",(table,)).fetchone()
            if not found: raise ValueError(f"Source DB missing required table: {table}")
            schemas[table] = found['sql']

    farm_id, user_id = str(uuid.uuid4()), farm['user_id']
    device_map = {d['device_id']:str(uuid.uuid4()) for d in devices}
    det_ids = [str(uuid.uuid4()),str(uuid.uuid4())]
    alert_id = str(uuid.uuid4())
    # All media copied into the new sandbox; no link back to source images.
    output.mkdir(parents=True,exist_ok=False)
    media_dir = output / 'media'
    media_dir.mkdir()
    db_path = output / 'isolated.db'
    try:
        with sqlite3.connect(db_path) as dest:
            dest.execute('PRAGMA foreign_keys=ON')
            for table in TABLES:
                dest.execute(schemas[table])
            dest.execute('CREATE TABLE be04_isolation_meta (marker TEXT NOT NULL, farm_id TEXT NOT NULL, image_detection_id TEXT NOT NULL, record_detection_id TEXT NOT NULL, alert_id TEXT NOT NULL)')
            if profile:
                insert_row(dest,'profiles',profile)
            else:
                insert_row(dest,'profiles',dict(user_id=user_id, display_name='BE04 isolated test user',created_at=iso_now(),updated_at=iso_now()))
            farm['farm_id']=farm_id
            farm['farm_name']='BE04 ISOLATED TEST — safe to remove after verification'
            farm['created_at']=iso_now();farm['updated_at']=iso_now()
            insert_row(dest,'farms',farm)
            for source_id,new_id in device_map.items():
                d=next(d for d in devices if d['device_id']==source_id)
                d['device_id']=new_id;d['farm_id']=farm_id
                d['device_code']='BE04-ISOLATED-'+str(len([x for x in device_map if x<=source_id]))
                d['device_name']='BE04 isolated test device'
                d['last_seen_at']=None
                insert_row(dest,'devices',d)
            for i,(r, pair) in enumerate(zip(picked,image_sources)):
                rec=rowdict(r)
                rec['detection_id']=det_ids[i]
                rec['device_id']=device_map[r['device_id']]
                rec['sync_status']='pending'
                rec['deleted_at']=None;rec['image_deleted_at']=None;rec['image_url']=None
                for column,path in zip(('image_path','annotated_image_path'), pair):
                    name=('original' if column=='image_path' else 'annotated')+path.suffix.lower()
                    rel=f'{rec["device_id"]}/isolated/{det_ids[i]}/{name}'
                    dst=media_dir/rel
                    dst.parent.mkdir(parents=True,exist_ok=True)
                    shutil.copy2(path,dst)
                    rec[column]=rel
                insert_row(dest,'detections',rec)
            # One real local alert linked to the first isolated detection.
            insert_row(dest,'alerts',dict(alert_id=alert_id,device_id=device_map[picked[0]['device_id']], detection_id=det_ids[0], alert_type='stale_data',message='[BE04 ISOLATED TEST] synthetic stale-data alert',alert_status='active',sync_status='pending',created_at=iso_now(),resolved_at=None))
            dest.execute('INSERT INTO be04_isolation_meta VALUES (?,?,?,?,?)',(MAGIC,farm_id,det_ids[0],det_ids[1],alert_id))
            integrity=dest.execute('PRAGMA integrity_check').fetchone()[0]
            if integrity!='ok': raise RuntimeError('Isolated SQLite integrity check failed: '+integrity)
            dest.commit()
    except Exception:
        shutil.rmtree(output)
        raise
    result={'db':str(db_path),'media_dir':str(media_dir),'farm_id':farm_id,'device_ids':list(device_map.values()),'image_detection_id':det_ids[0],'record_detection_id':det_ids[1],'alert_id':alert_id,'rows':{'farms':1,'devices':len(device_map),'detections':2,'alerts':1},'source_untouched':True}
    (output/'ids.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))

def get_meta(conn):
    try:
        meta=conn.execute('SELECT * FROM be04_isolation_meta').fetchone()
    except sqlite3.OperationalError:
        raise ValueError('Not a BE04 isolated DB') from None
    if not meta or meta['marker'] != MAGIC:
        raise ValueError('Invalid isolation marker; refusing to modify database')
    if conn.execute('SELECT COUNT(*) FROM farms').fetchone()[0] != 1 or conn.execute('SELECT COUNT(*) FROM detections').fetchone()[0] != 2:
        raise ValueError('Isolation row counts changed; refusing mutation')
    return meta

def mutate(action: str, target:Path):
    db = (target/'isolated.db').resolve(strict=True)
    media_dir=(target/'media').resolve(strict=True)
    if db.parent != media_dir.parent or target.name in {'field_validation-20260924','be04_trial','be04_watch','be04_retry'}:
        raise ValueError('Refusing non-isolated target')
    with sqlite3.connect(db) as conn:
        conn.row_factory=sqlite3.Row
        meta=get_meta(conn)
        now=iso_now()
        if action=='resolve-alert':
            row=conn.execute('SELECT alert_status FROM alerts WHERE alert_id=?',(meta['alert_id'],)).fetchone()
            if row[0]!='active':raise ValueError('Alert already resolved; do not replay mutation')
            conn.execute("UPDATE alerts SET alert_status='resolved',resolved_at=?,sync_status='pending' WHERE alert_id=?",(now,meta['alert_id']))
            item=meta['alert_id']
        else:
            ident=meta['image_detection_id'] if action=='image-delete' else meta['record_detection_id']
            row=conn.execute('SELECT * FROM detections WHERE detection_id=?',(ident,)).fetchone()
            marker_col='image_deleted_at' if action=='image-delete' else 'deleted_at'
            if row[marker_col] is not None:raise ValueError('Already tombstoned; do not replay mutation')
            if row['sync_status'] != 'synced':raise ValueError('Sync the sandbox to cloud BEFORE tombstoning')
            # Do not remove the staged images until source paths are verified safe.
            media_paths=[]
            for col in ('image_path','annotated_image_path'):
                if row[col]:
                    p=(media_dir/row[col]).resolve(strict=True)
                    if not p.is_relative_to(media_dir):raise ValueError('Unsafe sandbox media path')
                    media_paths.append(p)
            conn.execute(f"UPDATE detections SET {marker_col}=?,image_path=NULL,annotated_image_path=NULL,sync_status='pending' WHERE detection_id=?",(now,ident))
            for p in media_paths:p.unlink()  # only staged copies under sandbox/media
            item=ident
        conn.commit()
    print(json.dumps({'action':action,'id':item,'local_status':'pending','next':'Run existing BE04 Worker --apply on this sandbox only'},indent=2))

def main():
    p=argparse.ArgumentParser(description=__doc__)
    sub=p.add_subparsers(dest='action',required=True)
    prep=sub.add_parser('prepare',help='Create a new independent DB and media copy; no cloud writes')
    prep.add_argument('--source-db',type=Path,required=True)
    prep.add_argument('--source-media',type=Path,required=True)
    prep.add_argument('--out',type=Path,required=True)
    for name in ('resolve-alert','image-delete','record-delete'):
        cmd=sub.add_parser(name,help='Mutate only a prepared sandbox DB and sandbox media')
        cmd.add_argument('--sandbox',type=Path,required=True)
    a=p.parse_args()
    if a.action=='prepare':prepare(a.source_db,a.source_media,a.out)
    else:mutate(a.action,a.sandbox)

if __name__=='__main__':main()
