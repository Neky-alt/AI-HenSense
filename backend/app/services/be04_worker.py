"""BE04 opt-in, local-first outbox worker. No FastAPI startup side effects.

Run ONE worker per SQLite DB. The deployed service_role key stays server-side.
No cloud-to-local settings writes, quick_detections, or remote command executor here.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.services.cloud_sync import SyncClient, _utc, _json, _local_image, make_payload

LEDGER_SQL = '''CREATE TABLE IF NOT EXISTS be04_outbox (
    kind TEXT NOT NULL,
    record_id TEXT NOT NULL,
    fingerprint TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT,
    last_error_type TEXT,
    synced_at TEXT,
    PRIMARY KEY (kind, record_id)
)'''

TABLES = {
    'farms': ('farm_id', ('farm_id','user_id','farm_name','timezone','created_at','updated_at')),
    'devices': ('device_id', ('device_id','farm_id','device_code','device_name','farming_type','last_seen_at','is_active','created_at','updated_at')),
    'monitoring_settings': ('settings_id', ('settings_id','farm_id','farming_type','monitoring_enabled','monitoring_start_time','monitoring_end_time','detection_mode','detection_interval_minutes','scheduled_times','cage_warning_low_ratio_threshold','result_snapshot_interval_minutes','free_range_warning_low_count_threshold','updated_at')),
    'device_storage_settings': ('device_id', ('device_id','store_detection_images','detection_image_retention_days','store_video_locally','video_retention_days','max_media_storage_gb','storage_limit_action','updated_at')),
    'notification_settings': ('user_id', ('user_id','in_app_enabled','email_enabled','push_enabled','updated_at')),
    'alerts': ('alert_id', ('alert_id','device_id','detection_id','alert_type','message','alert_status','sync_status','created_at','resolved_at')),
}
TIME_FIELDS = {'created_at','updated_at','detected_at','last_seen_at','resolved_at','image_deleted_at','deleted_at'}

def utcnow():
    return datetime.now(timezone.utc)

def stamp(t):
    return t.isoformat().replace('+00:00', 'Z')

def fingerprint(payload):
    return hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def serialize(row, fields):
    out = {field: row[field] for field in fields}
    for key, value in tuple(out.items()):
        if key in TIME_FIELDS and value is not None:
            out[key] = _utc(value)
        elif key.endswith('_time') and isinstance(value,str):
            out[key] = value
        elif key == 'scheduled_times':
            out[key] = _json(value)
    return out

def initialize(conn):
    conn.execute(LEDGER_SQL)
    conn.commit()

def ready(conn, kind, id_, fp, now):
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='be04_outbox'").fetchone():
        return True
    row = conn.execute('SELECT fingerprint,next_retry_at FROM be04_outbox WHERE kind=? AND record_id=?', (kind,id_)).fetchone()
    if row and row[0] == fp:
        return False
    if row and row[1] and row[1] > now:
        return False
    return True

def succeeded(conn, kind, id_, fp):
    conn.execute('''INSERT INTO be04_outbox(kind,record_id,fingerprint,attempts,next_retry_at,last_error_type,synced_at)
        VALUES(?,?,?,0,NULL,NULL,?) ON CONFLICT(kind,record_id) DO UPDATE SET
        fingerprint=excluded.fingerprint,attempts=0,next_retry_at=NULL,last_error_type=NULL,synced_at=excluded.synced_at''',
        (kind,id_,fp,stamp(utcnow())))
    conn.commit()

def failed(conn, kind, id_, error, cap):
    old = conn.execute('SELECT attempts FROM be04_outbox WHERE kind=? AND record_id=?',(kind,id_)).fetchone()
    attempts = (old[0] if old else 0) + 1
    delay = min(cap, 30*2**min(attempts-1,10))
    conn.execute('''INSERT INTO be04_outbox(kind,record_id,attempts,next_retry_at,last_error_type)
       VALUES(?,?,?,?,?) ON CONFLICT(kind,record_id) DO UPDATE SET
       attempts=excluded.attempts,next_retry_at=excluded.next_retry_at,last_error_type=excluded.last_error_type''',
       (kind,id_,attempts,stamp(utcnow()+timedelta(seconds=delay)),type(error).__name__))
    if kind == 'detections':
        conn.execute("UPDATE detections SET sync_status='failed' WHERE detection_id=? AND sync_status IN ('pending','failed')",(id_,))
    elif kind == 'alerts':
        conn.execute("UPDATE alerts SET sync_status='failed' WHERE alert_id=? AND sync_status IN ('pending','failed')",(id_,))
    conn.commit()
    return delay

class CloudTransport(SyncClient):
    def upsert(self, table, pk, payload):
        from app.services.cloud_sync import _require_response
        _require_response(self.http.post(f'{self.base}/rest/v1/{table}',
            params={'on_conflict':pk},headers={'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},json=payload))

    def delete_object(self, key):
        from app.services.cloud_sync import _require_response
        from urllib.parse import quote
        response = self.http.delete(f'{self.base}/storage/v1/object/detection-images/{quote(key,safe="/")}')
        if response.status_code != 404:
            _require_response(response)

    def cloud_detection(self, detection_id):
        rows = self.get_rows('detections','detection_id',detection_id,'detection_id,image_url,annotated_image_path,image_deleted_at,deleted_at')
        return rows[0] if rows else None

class Worker:
    def __init__(self, conn, media_dir, cloud, owner_id, farm_id, *, include_settings=False, max_backoff=3600):
        self.db=conn
        self.db.row_factory=sqlite3.Row
        self.media_dir=Path(media_dir)
        self.cloud=cloud
        self.owner_id=owner_id
        self.farm_id=farm_id
        self.include_settings=include_settings
        self.max_backoff=max_backoff
        # Explicit apply only: dry-run must leave the source DB byte-for-byte untouched.

    def guard_owner(self):
        local=self.db.execute('SELECT farm_id,user_id FROM farms WHERE farm_id=?',(self.farm_id,)).fetchone()
        if not local:
            raise ValueError('Local farm missing')
        remote=self.cloud.get_rows('farms','farm_id',self.farm_id,'farm_id,user_id')
        if remote and (len(remote)!=1 or remote[0]['user_id']!=self.owner_id):
            raise ValueError('Cloud farm owner mismatch; refusing sync')
        profile=self.cloud.get_rows('profiles','user_id',self.owner_id,'user_id')
        if len(profile)!=1:
            raise ValueError('Cloud owner profile not found')

    def _upsert_metadata(self,table,row):
        pk,fields=TABLES[table]
        payload=serialize(row,fields)
        if table in ('farms','notification_settings'):
            payload['user_id']=self.owner_id  # demo user is never uploaded
        if table=='alerts':
            payload['sync_status']='synced'
        self.cloud.upsert(table,pk,payload)
        if table=='alerts':
            self.db.execute("UPDATE alerts SET sync_status='synced' WHERE alert_id=? AND sync_status IN ('pending','failed')",(row['alert_id'],))
            self.db.commit()
        return payload

    def _sync_detection(self,row):
        device=self.db.execute('SELECT farm_id FROM devices WHERE device_id=?',(row['device_id'],)).fetchone()
        if not device or device[0]!=self.farm_id:
            raise ValueError('Detection belongs to different farm')
        cloud_device=self.cloud.get_rows('devices','device_id',row['device_id'],'device_id,farm_id')
        if len(cloud_device)!=1 or cloud_device[0]['farm_id']!=self.farm_id:
            raise ValueError('Cloud device mismatch')
        base=f'farms/{self.farm_id}/devices/{row["device_id"]}/detections/{row["detection_id"]}'
        old=self.cloud.cloud_detection(row['detection_id'])
        # Tombstones always override media references; delete old cloud files before upsert.
        if row['deleted_at'] is not None or row['image_deleted_at'] is not None:
            if old:
                for key in (old.get('image_url'),old.get('annotated_image_path')):
                    if key and key.startswith(base+'/'):
                        self.cloud.delete_object(key)
            payload=make_payload(row,None,None)
            self.cloud.upsert_detection(payload)
        else:
            original=_local_image(self.media_dir,row['image_path'])
            annotated=_local_image(self.media_dir,row['annotated_image_path'])
            original_key=base+'/original'+original.suffix.lower() if original else None
            annotated_key=base+'/annotated'+annotated.suffix.lower() if annotated else None
            # A partial retry can safely overwrite the same deterministic keys.
            if original: self.cloud.upload(original_key,original)
            if annotated: self.cloud.upload(annotated_key,annotated)
            self.cloud.upsert_detection(make_payload(row,original_key,annotated_key))
        if row['sync_status'] in ('pending','failed'):
            self.db.execute("UPDATE detections SET sync_status='synced' WHERE detection_id=? AND sync_status IN ('pending','failed')",(row['detection_id'],))
            self.db.commit()

    def once(self, limit=100, dry_run=True):
        if not 1<=limit<=500: raise ValueError('limit must be 1..500')
        self.guard_owner()
        if not dry_run:
            initialize(self.db)
        now=stamp(utcnow())
        result={'mode':'DRY RUN' if dry_run else 'APPLY','selected':0,'synced':0,'failed':0,'skipped':0,'events':[]}
        # Parent metadata before children; settings upload is opt-in (source-aware policy).
        phases=['farms','devices','detections','alerts']
        if self.include_settings:
            phases += ['monitoring_settings','device_storage_settings','notification_settings']
        for table in phases:
            if table=='farms':
                rows=self.db.execute('SELECT * FROM farms WHERE farm_id=?',(self.farm_id,)).fetchall()
            elif table=='devices':
                rows=self.db.execute('SELECT * FROM devices WHERE farm_id=?',(self.farm_id,)).fetchall()
            elif table=='detections':
                rows=self.db.execute('SELECT d.* FROM detections d JOIN devices v ON d.device_id=v.device_id WHERE v.farm_id=? ORDER BY d.detected_at,d.detection_id',(self.farm_id,)).fetchall()
            elif table=='alerts':
                rows=self.db.execute('SELECT a.* FROM alerts a JOIN devices d ON d.device_id=a.device_id WHERE d.farm_id=?',(self.farm_id,)).fetchall()
            elif table=='monitoring_settings':
                rows=self.db.execute('SELECT * FROM monitoring_settings WHERE farm_id=?',(self.farm_id,)).fetchall()
            elif table=='device_storage_settings':
                rows=self.db.execute('SELECT s.* FROM device_storage_settings s JOIN devices d ON d.device_id=s.device_id WHERE d.farm_id=?',(self.farm_id,)).fetchall()
            else:
                rows=self.db.execute('SELECT n.* FROM notification_settings n JOIN farms f ON f.user_id=n.user_id WHERE f.farm_id=?',(self.farm_id,)).fetchall()
            for row in rows:
                if result['selected']>=limit: return result
                pk='detection_id' if table=='detections' else TABLES[table][0]
                id_=row[pk]
                if table=='detections':
                    raw={k:row[k] for k in row.keys() if k!='sync_status'}
                    # Already synced rows do not require replay unless tombstoned or explicitly dirty.
                    pending=row['sync_status'] in ('pending','failed')
                    tombstoned=bool(row['deleted_at'] or row['image_deleted_at'])
                    if not pending and not tombstoned:
                        result['skipped']+=1; continue
                    fp=fingerprint(raw)
                else:
                    payload=serialize(row,TABLES[table][1]); payload.pop('sync_status',None)
                    if table in ('farms','notification_settings'): payload['user_id']=self.owner_id
                    fp=fingerprint(payload)
                if not ready(self.db,table,id_,fp,now):
                    result['skipped']+=1; continue
                result['selected']+=1
                if dry_run:
                    result['events'].append({'table':table,'id':id_,'status':'DRY RUN'})
                    continue
                try:
                    if table=='detections': self._sync_detection(row)
                    else: self._upsert_metadata(table,row)
                    succeeded(self.db,table,id_,fp)
                    result['synced']+=1
                    result['events'].append({'table':table,'id':id_,'status':'synced'})
                except Exception as exc:
                    self.db.rollback()
                    delay=failed(self.db,table,id_,exc,self.max_backoff)
                    result['failed']+=1
                    # Don't include remote exception text (could contain secrets).
                    result['events'].append({'table':table,'id':id_,'status':'failed','error_type':type(exc).__name__,'retry_seconds':delay})
                    if table in ('farms','devices'):
                        return result # stop on missing parent; retry next tick
        return result

def status(conn):
    exists=conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='be04_outbox'").fetchone()
    rows=(conn.execute('SELECT kind,COUNT(*) AS total,SUM(CASE WHEN fingerprint IS NOT NULL THEN 1 ELSE 0 END) AS synced, SUM(CASE WHEN next_retry_at IS NOT NULL THEN 1 ELSE 0 END) AS queued FROM be04_outbox GROUP BY kind').fetchall() if exists else [])
    return {'outbox':{r[0]:{'total':r[1],'synced':r[2],'retrying':r[3]} for r in rows},
            'detection_states':dict(conn.execute('SELECT sync_status,COUNT(*) FROM detections GROUP BY sync_status').fetchall())}
