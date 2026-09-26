"""BE-04 isolated one-record cloud-sync transport. No application imports or side effects.

Service role is server-side only. This MVP intentionally does NOT synchronize alerts,
settings, tombstones, or Quick Detections. Never deploy as a public endpoint.
"""
from __future__ import annotations

import json
import mimetypes
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import httpx

FIELDS = (
    'detection_id', 'device_id', 'detected_at', 'trigger_type',
    'capture_source_type', 'total_count', 'normal_count', 'low_count',
    'normal_ratio', 'low_ratio', 'monitoring_status', 'confidence',
    'image_deleted_at', 'ai_instances', 'ai_response', 'provenance',
    'deleted_at', 'created_at',
)


def _utc(value):
    if value is None:
        return None
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)  # local ORM stores naive UTC
    return parsed.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


def _local_image(media_dir: Path, rel: str | None) -> Path | None:
    if not rel:
        return None
    base = media_dir.resolve(strict=True)
    p = (base / rel).resolve(strict=True)
    if not p.is_relative_to(base) or not p.is_file():
        raise ValueError('Refusing media path outside LOCAL_IMAGE_DIR')
    return p


def _require_response(response: httpx.Response):
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        # Never print request headers/secret keys or raw server error bodies.
        raise RuntimeError(f'Supabase HTTP {exc.response.status_code} at {exc.request.url.path}') from None
    return response


class SyncClient:
    def __init__(self, url: str, service_key: str, timeout: float = 35):
        if not url.startswith('https://') or '.supabase.co' not in url:
            raise ValueError('SUPABASE_URL must be your HTTPS Supabase project URL')
        if not service_key:
            raise ValueError('Missing backend SUPABASE_KEY (service role)')
        self.base = url.rstrip('/')
        self.http = httpx.Client(
            timeout=timeout,
            headers={'apikey': service_key, 'Authorization': f'Bearer {service_key}'},
            follow_redirects=False,
        )

    def close(self):
        self.http.close()

    def get_rows(self, table: str, key: str, value: str, select: str):
        r = _require_response(self.http.get(
            f'{self.base}/rest/v1/{table}',
            params={'select': select, key: f'eq.{value}', 'limit': 2},
        ))
        return r.json()

    def upload(self, key: str, path: Path):
        mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        with path.open('rb') as source:
            _require_response(self.http.post(
                f'{self.base}/storage/v1/object/detection-images/{quote(key, safe="/")}',
                headers={'Content-Type': mime, 'x-upsert': 'true'},
                content=source.read(),
            ))

    def upsert_detection(self, payload: dict):
        _require_response(self.http.post(
            f'{self.base}/rest/v1/detections',
            params={'on_conflict': 'detection_id'},
            headers={'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal'},
            json=payload,
        ))


def make_payload(record: sqlite3.Row, original_key: str | None, annotated_key: str | None):
    result = {name: record[name] for name in FIELDS}
    for name in ('detected_at', 'image_deleted_at', 'deleted_at', 'created_at'):
        result[name] = _utc(result[name])
    for name in ('ai_instances', 'ai_response', 'provenance'):
        result[name] = _json(result[name])
    # Cloud never stores Mac/SD-card paths; these two columns hold private bucket keys.
    result.update(image_path=None, image_url=original_key,
                  annotated_image_path=annotated_key, sync_status='synced')
    return result


def load_one(conn: sqlite3.Connection, detection_id: str | None):
    conn.row_factory = sqlite3.Row
    if detection_id:
        row = conn.execute('SELECT * FROM detections WHERE detection_id=?', (detection_id,)).fetchone()
    else:
        row = conn.execute("SELECT * FROM detections WHERE sync_status IN ('pending','failed') "
                           'AND deleted_at IS NULL ORDER BY detected_at, detection_id LIMIT 1').fetchone()
    if row is None:
        raise ValueError('No matching Detection')
    if row['sync_status'] not in ('pending', 'failed') or row['deleted_at'] or row['image_deleted_at']:
        raise ValueError('Only pending/failed active Detections with active media can use this first-sync MVP')
    return row


def sync_one(conn: sqlite3.Connection, media_dir: Path, client: SyncClient,
             owner_id: str, detection_id: str | None = None, apply: bool = False):
    record = load_one(conn, detection_id)
    device = conn.execute('SELECT farm_id FROM devices WHERE device_id=?', (record['device_id'],)).fetchone()
    if not device:
        raise ValueError('Local device missing')
    farm_id = device[0]
    # Fail closed for incorrect cloud ownership or missing/incorrect cloud device.
    farms = client.get_rows('farms', 'farm_id', farm_id, 'farm_id,user_id')
    if len(farms) != 1 or farms[0]['user_id'] != owner_id:
        raise ValueError('Cloud farm missing or owned by a different user')
    devices = client.get_rows('devices', 'device_id', record['device_id'], 'device_id,farm_id')
    if len(devices) != 1 or devices[0]['farm_id'] != farm_id:
        raise ValueError('Cloud device missing or belongs to a different farm')

    original = _local_image(media_dir, record['image_path'])
    annotated = _local_image(media_dir, record['annotated_image_path'])
    base = f'farms/{farm_id}/devices/{record["device_id"]}/detections/{record["detection_id"]}'
    original_key = base + '/original' + original.suffix.lower() if original else None
    annotated_key = base + '/annotated' + annotated.suffix.lower() if annotated else None
    payload = make_payload(record, original_key, annotated_key)
    if not apply:
        return {'mode': 'DRY RUN', 'id': record['detection_id'],
                'device_id': record['device_id'], 'original': str(original) if original else None,
                'annotated': str(annotated) if annotated else None,
                'cloud_original': original_key, 'cloud_annotated': annotated_key}

    # Transport deliberately precedes local status update. Deterministic object names,
    # object overwrite, and detection_id upsert make a retry safe after partial failure.
    if original:
        client.upload(original_key, original)
    if annotated:
        client.upload(annotated_key, annotated)
    client.upsert_detection(payload)
    cur = conn.execute("UPDATE detections SET sync_status='synced' "
                       "WHERE detection_id=? AND sync_status IN ('pending','failed')",
                       (record['detection_id'],))
    if cur.rowcount != 1:
        conn.rollback()
        raise RuntimeError('Concurrent modification of local sync_status; cloud row can be safely retried')
    conn.commit()
    return {'mode': 'APPLIED', 'id': record['detection_id'], 'uploaded_images': int(bool(original)) + int(bool(annotated)),
            'cloud_original': original_key, 'cloud_annotated': annotated_key}
