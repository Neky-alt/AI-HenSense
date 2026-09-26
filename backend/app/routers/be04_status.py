"""Opt-in, authenticated read-only status of the current local SQLite sync ledger.

No endpoints start a worker or expose server credentials.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from app.auth import current_user
from app.config import settings
from app.database import get_db
from app.models import Farm
from app.responses import success
from app.services.be04_worker import status

router = APIRouter(prefix='/sync', tags=['cloud-sync'])

@router.get('/status')
def sync_status(user_id: str = Depends(current_user), db: Session = Depends(get_db),
                authorization: str | None = Header(default=None)):
    # Unlike the trial CLI, the API deliberately does not map arbitrary demo IDs.
    # A real local Farm must be owned by this verified user to see its status.
    if not db.query(Farm.farm_id).filter(Farm.user_id == user_id).first():
        # Demo local database has an explicitly fake user_id. For this deployment
        # require BOTH an opt-in mapping AND the actual cloud owner's confirmation.
        if not (settings.BE04_FARM_ID and settings.BE04_OWNER_USER_ID == user_id and
                db.query(Farm.farm_id).filter(Farm.farm_id == settings.BE04_FARM_ID).first()):
            raise HTTPException(status_code=403, detail='No local farm owned by this user')
        from app.routers.be04_cloud import _owned_farm
        cloud = _owned_farm(authorization, settings.BE04_FARM_ID)
        cloud.close()
    raw = db.connection().connection.driver_connection
    return success(status(raw))
