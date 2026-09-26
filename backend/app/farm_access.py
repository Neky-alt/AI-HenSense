"""Request-scoped authorization only; offline ingestion/Worker sessions are untouched."""
from uuid import UUID
import httpx
from fastapi import Depends, Header, HTTPException, Response
from sqlalchemy import event, select
from sqlalchemy.orm import Session, with_loader_criteria
from app.auth import current_user
from app.config import settings
from app.database import get_db
from app import models as m


def owned_cloud_farms(user: str = Depends(current_user), authorization: str = Header()) -> list[str]:
    # Public key + actual access token: never use the worker/service-role identity.
    try:
        response = httpx.get(settings.SUPABASE_URL.rstrip('/')+'/rest/v1/farms',
            headers={'apikey':settings.SUPABASE_PUBLISHABLE_KEY,'Authorization':authorization},
            params={'select':'farm_id,user_id','user_id':'eq.'+user}, timeout=10)
        if response.status_code in (401,403): raise HTTPException(401,'Session expired. Sign in again.')
        if response.status_code != 200: raise HTTPException(503,'Unable to verify farm access.')
        rows = response.json()
        if not isinstance(rows,list): raise ValueError('Invalid farm response')
        return [str(UUID(r['farm_id'])) for r in rows if r['user_id']==user]
    except (httpx.HTTPError,ValueError,KeyError,TypeError) as exc:
        raise HTTPException(503,'Unable to verify farm access.') from exc


def authorized_db(response: Response, user: str = Depends(current_user),
                  farms: list[str] = Depends(owned_cloud_farms), db: Session = Depends(get_db)):
    response.headers['Cache-Control']='private, no-store'
    # Resolve the existing local IDs; no owner rewrites or authorization caches.
    farm_ids=tuple(db.scalars(select(m.Farm.farm_id).where(m.Farm.farm_id.in_(farms))).all())
    device_ids=tuple(db.scalars(select(m.Device.device_id).where(m.Device.farm_id.in_(farm_ids))).all())
    rules=[(m.Farm,m.Farm.farm_id.in_(farm_ids)),(m.Device,m.Device.device_id.in_(device_ids)),
           (m.MonitoringSettings,m.MonitoringSettings.farm_id.in_(farm_ids)),
           (m.Profile,m.Profile.user_id==user),(m.NotificationSettings,m.NotificationSettings.user_id==user)]
    for model in (m.Detection,m.Alert,m.DeviceSettings,m.DeviceStorageSettings,m.DeviceCommand,m.VideoSegment):
        rules.append((model,model.device_id.in_(device_ids)))
    def scope(state):
        if not state.is_select:
            # Current interactive writes use checked ORM entities, not raw/bulk SQL.
            raise HTTPException(403,'Unsupported data operation.')
        state.statement=state.statement.options(*[with_loader_criteria(model,clause,include_aliases=True) for model,clause in rules])
    def guard(session,*args):
        for row in session.new | session.dirty | session.deleted:
            if isinstance(row,(m.Profile,m.NotificationSettings)): allowed=row.user_id==user
            elif isinstance(row,(m.Farm,m.Device,m.MonitoringSettings)): allowed=row.farm_id in farm_ids
            else: allowed=getattr(row,'device_id',None) in device_ids
            if not allowed: raise HTTPException(403,'You do not have access to this record.')
    db.expunge_all()  # no preloaded unscoped entities may bypass Session.get filtering
    event.listen(db,'do_orm_execute',scope);event.listen(db,'before_flush',guard)
    try:yield db
    finally:
        db.rollback();event.remove(db,'do_orm_execute',scope);event.remove(db,'before_flush',guard)
