"""BE-04 optional authenticated remote-read router (no cloud writes)."""
from __future__ import annotations
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Header, HTTPException, Query
from app.config import settings
from app.services.be04_worker import CloudTransport
from app.services.cloud_sync import _require_response

router = APIRouter(prefix='/cloud', tags=['cloud-read'])


def _current_user(authorization: str | None) -> str:
    # Share the same Supabase token verification used by Quick Detection.
    # Never use service_role as the public apikey fallback.
    from app.auth import current_user
    return current_user(authorization)


def _owned_farm(authorization: str | None, farm_id: str) -> CloudTransport:
    owner_id = _current_user(authorization)
    try:
        cloud = CloudTransport(settings.SUPABASE_URL, settings.SUPABASE_KEY)
        owners = cloud.get_rows('farms', 'farm_id', farm_id, 'farm_id,user_id')
        if len(owners) != 1 or owners[0]['user_id'] != owner_id:
            cloud.close()
            raise HTTPException(404, 'Farm not found')
        return cloud
    except HTTPException:
        raise
    except (httpx.RequestError, RuntimeError, ValueError):
        raise HTTPException(503, 'Cloud data unavailable') from None


@router.get('/farms/{farm_id}/devices')
def cloud_devices(farm_id: str, authorization: str | None = Header(default=None)):
    cloud = _owned_farm(authorization, farm_id)
    try:
        response = _require_response(cloud.http.get(cloud.base+'/rest/v1/devices', params={
            'select': 'device_id,farm_id,device_code,device_name,farming_type,last_seen_at,is_active',
            'farm_id': 'eq.'+farm_id, 'order': 'device_code.asc', 'limit': 100}))
        return {'data': response.json()}
    except (httpx.RequestError, RuntimeError):
        raise HTTPException(503, 'Cloud data unavailable') from None
    finally:
        cloud.close()


@router.get('/farms/{farm_id}/detections')
def cloud_detections(farm_id: str, device_id: str,
                     limit: int = Query(default=30, ge=1, le=100),
                     authorization: str | None = Header(default=None)):
    cloud = _owned_farm(authorization, farm_id)
    try:
        device = cloud.get_rows('devices', 'device_id', device_id, 'device_id,farm_id')
        if len(device) != 1 or device[0]['farm_id'] != farm_id:
            raise HTTPException(404, 'Device not found')
        response = _require_response(cloud.http.get(cloud.base+'/rest/v1/detections', params={
            'select': 'detection_id,device_id,detected_at,total_count,normal_count,low_count,normal_ratio,low_ratio,monitoring_status,image_deleted_at,deleted_at',
            'device_id': 'eq.'+device_id, 'deleted_at': 'is.null',
            'order': 'detected_at.desc', 'limit': limit}))
        return {'data': response.json()}
    except (httpx.RequestError, RuntimeError):
        raise HTTPException(503, 'Cloud data unavailable') from None
    finally:
        cloud.close()


@router.get('/farms/{farm_id}/detections/{detection_id}/media')
def cloud_media(farm_id: str, detection_id: str,
                authorization: str | None = Header(default=None)):
    cloud = _owned_farm(authorization, farm_id)
    try:
        rows = cloud.get_rows('detections','detection_id',detection_id,
            'detection_id,device_id,image_url,annotated_image_path,image_deleted_at,deleted_at')
        if len(rows) != 1 or rows[0]['deleted_at'] or rows[0]['image_deleted_at']:
            raise HTTPException(404, 'Media unavailable')
        record = rows[0]
        device = cloud.get_rows('devices', 'device_id', record['device_id'], 'device_id,farm_id')
        if len(device) != 1 or device[0]['farm_id'] != farm_id:
            raise HTTPException(404, 'Media unavailable')
        allowed_prefix = f'farms/{farm_id}/devices/{record["device_id"]}/detections/{detection_id}/'
        result = {}
        for label, key in (('original', record['image_url']),
                           ('annotated', record['annotated_image_path'])):
            if not key:
                result[label] = None
                continue
            if not key.startswith(allowed_prefix):
                raise HTTPException(409, 'Invalid stored media path')
            signed = _require_response(cloud.http.post(
                cloud.base+'/storage/v1/object/sign/detection-images/'+quote(key, safe='/'),
                json={'expiresIn': 60}))
            signed_path = signed.json().get('signedURL')
            if not signed_path or not signed_path.startswith('/object/sign/'):
                raise HTTPException(502, 'Media signing failed')
            result[label] = cloud.base+'/storage/v1'+signed_path
        return {'data': result, 'expires_in_seconds': 60}
    except (httpx.RequestError, RuntimeError):
        raise HTTPException(503, 'Cloud data unavailable') from None
    finally:
        cloud.close()
