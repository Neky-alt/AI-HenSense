"""Every route, including media, is scoped to a verified Supabase user."""
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.auth import current_user
from app.config import settings
from app.database import get_db
from app.quick_models import QuickDetection
from app.responses import success
from app.services.ai_adapter import get_ai_adapter
from app.services.detection_images import resolve_image_path
from app.services.quick_detection_service import analyze,recover_expired,serialize
router=APIRouter(prefix='/quick-detections',tags=['quick-detections'])

def owned(db,user,id):
    row=db.scalar(select(QuickDetection).where(QuickDetection.quick_detection_id==id,QuickDetection.user_id==user))
    if row is None:raise HTTPException(404,'Quick Detection not found')
    return row

@router.post('')
def upload(file: UploadFile=File(...),farming_type: Literal['caged','free_range']=Form('caged'),source_type: Literal['camera','gallery']=Form(...),idempotency_key: UUID=Header(...),user: str=Depends(current_user),db: Session=Depends(get_db),ai=Depends(get_ai_adapter)):
    try:content=file.file.read(settings.MAX_DETECTION_IMAGE_BYTES+1)
    finally:file.file.close()
    data,status=analyze(db,user,str(idempotency_key),content,file.content_type,farming_type,source_type,ai)
    return JSONResponse(success(data),status_code=status,headers={'Cache-Control':'no-store'})

@router.get('')
def history(user: str=Depends(current_user),db: Session=Depends(get_db),limit: int=Query(30,ge=1,le=100),offset: int=Query(0,ge=0)):
    recover_expired(db,user)
    rows=db.scalars(select(QuickDetection).where(QuickDetection.user_id==user).order_by(QuickDetection.created_at.desc(),QuickDetection.quick_detection_id.desc()).offset(offset).limit(limit+1)).all()
    return success({'items':[serialize(r) for r in rows[:limit]],'next_offset':offset+limit if len(rows)>limit else None})

@router.get('/{id}')
def detail(id: str,user: str=Depends(current_user),db: Session=Depends(get_db)):
    recover_expired(db,user)
    row=owned(db,user,id)
    before=(QuickDetection.created_at<row.created_at)|((QuickDetection.created_at==row.created_at)&(QuickDetection.quick_detection_id<row.quick_detection_id))
    after=(QuickDetection.created_at>row.created_at)|((QuickDetection.created_at==row.created_at)&(QuickDetection.quick_detection_id>row.quick_detection_id))
    previous=db.scalar(select(QuickDetection.quick_detection_id).where(QuickDetection.user_id==user,before).order_by(QuickDetection.created_at.desc(),QuickDetection.quick_detection_id.desc()).limit(1))
    following=db.scalar(select(QuickDetection.quick_detection_id).where(QuickDetection.user_id==user,after).order_by(QuickDetection.created_at,QuickDetection.quick_detection_id).limit(1))
    return success({**serialize(row),'previous_id':previous,'next_id':following})

@router.get('/{id}/image')
def original(id: str,user: str=Depends(current_user),db: Session=Depends(get_db)):
    return media(owned(db,user,id),False)

@router.get('/{id}/annotated-image')
def annotated(id: str,user: str=Depends(current_user),db: Session=Depends(get_db)):
    return media(owned(db,user,id),True)

def media(row,annotation):
    path=resolve_image_path((row.annotated_image_path if annotation else row.image_path) or '') if row.status=='succeeded' else None
    if path is None:raise HTTPException(404,'Image not found')
    return FileResponse(path,headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})

@router.delete('/{id}')
def delete_record(id: UUID,user: str=Depends(current_user),db: Session=Depends(get_db)):
    from app.services.quick_deletion import delete_quick
    try:delete_quick(db,user,str(id))
    except HTTPException as exc:
        if isinstance(exc.detail,dict):
            return JSONResponse({'success':False,'data':None,'error':{'code':exc.detail['code'],'message':'Unable to complete deletion. Please try again.'}},status_code=exc.status_code)
        raise
    return success({'deleted':True})
