"""User-owned inference with no Device, Snapshot, monitoring or Alert writes."""
from datetime import timedelta
from dataclasses import replace
from io import BytesIO
import hashlib
from pathlib import Path
import shutil
import warnings
from uuid import UUID, uuid4
from PIL import Image, ImageOps, UnidentifiedImageError
from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.config import settings
from app.quick_models import QuickDetection, now
from app.services.capture_adapter import CapturedFrame
from app.services.detection_annotations import render_annotation
from app.services.detection_images import save_capture_image, storage_root
from app.services.detection_pipeline import validate_ai_result
from app.services.ai_adapter import AIServiceUnavailable

MAX_PIXELS=24_000_000
# Lossless normalized/annotated PNGs can be larger than the bounded upload.
MAX_DERIVATIVE_BYTES=MAX_PIXELS*4+65536

def normalize_upload(content,content_type):
    if not content or len(content)>settings.MAX_DETECTION_IMAGE_BYTES:raise HTTPException(413,'Image must be between 1 byte and 10 MB')
    if content_type not in ('image/jpeg','image/png'):raise HTTPException(415,'Choose a JPEG or PNG photo; HEIC is not supported')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error',Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as image:
                if image.format not in ('JPEG','PNG') or Image.MIME[image.format]!=content_type:raise ValueError('Content does not match file type')
                if getattr(image,'n_frames',1)!=1 or image.width*image.height>MAX_PIXELS:raise ValueError('Use a single image up to 24 megapixels')
                orientation=image.getexif().get(274,1)
                if orientation not in range(1,9):raise ValueError('Unsupported EXIF orientation')
                image.load()
                size=image.size
                if orientation!=1:
                    normalized=ImageOps.exif_transpose(image).convert('RGB');size=normalized.size
                    out=BytesIO();normalized.save(out,format='PNG');pixels=out.getvalue();mime='image/png'
                else:pixels=content;mime=content_type
        if len(pixels)>MAX_DERIVATIVE_BYTES:raise HTTPException(413,'Normalized image is too large. Choose a smaller image.')
    except HTTPException:raise
    except (ValueError,OSError,UnidentifiedImageError,Image.DecompressionBombError,Image.DecompressionBombWarning) as exc:
        raise HTTPException(422,'Invalid image: '+str(exc)) from exc
    return CapturedFrame(pixels,'inference.png' if mime=='image/png' else 'inference.jpg',mime,now()),orientation,size

def cleanup(user,attempt):
    path=storage_root()/'quick_detections'/str(UUID(user))/str(UUID(attempt))
    if path.exists():shutil.rmtree(path)

def recover_expired(db,user):
    rows=db.scalars(select(QuickDetection).where(QuickDetection.user_id==user,QuickDetection.status=='processing',QuickDetection.lease_expires_at<now())).all()
    for row in rows:
        attempt=row.attempt_id
        changed=db.execute(update(QuickDetection).where(QuickDetection.quick_detection_id==row.quick_detection_id,QuickDetection.attempt_id==attempt,QuickDetection.status=='processing',QuickDetection.lease_expires_at<now()).values(status='failed',error_code='INTERRUPTED'))
        db.commit()
        if changed.rowcount:cleanup(user,attempt)

def serialize(row):
    prefix=f'{settings.API_PREFIX}/quick-detections/{row.quick_detection_id}'
    utc=lambda t:t.isoformat(timespec='milliseconds')+'Z' if t else None
    return dict(quick_detection_id=row.quick_detection_id,record_type='quick_detection',source_label='Phone Upload / Quick Detection',farming_type=row.farming_type,source_type=row.source_type,status=row.status,error_code=row.error_code,created_at=utc(row.created_at),completed_at=utc(row.completed_at),normal_count=row.normal_count,low_count=row.low_count,total_count=row.total_count,normal_ratio=row.normal_ratio,low_ratio=row.low_ratio,image_url=prefix+'/image' if row.status=='succeeded' and row.image_path else None,annotated_image_url=prefix+'/annotated-image' if row.status=='succeeded' and row.annotated_image_path else None,ai_instances=row.ai_instances,provenance=row.provenance)

def analyze(db,user,key,content,mime,mode,source,ai):
    frame,orientation,size=normalize_upload(content,mime)
    digest=hashlib.sha256(content).hexdigest()
    recover_expired(db,user)
    row=db.scalar(select(QuickDetection).where(QuickDetection.user_id==user,QuickDetection.client_request_id==key))
    attempt=str(uuid4());deadline=now()+timedelta(seconds=max(600,settings.AI_SERVICE_TIMEOUT_SECONDS+180))
    if row is None:
        row=QuickDetection(user_id=user,client_request_id=key,input_sha256=digest,farming_type=mode,source_type=source,lease_expires_at=deadline,attempt_id=attempt)
        db.add(row)
        try:db.commit()
        except IntegrityError:
            db.rollback();row=db.scalar(select(QuickDetection).where(QuickDetection.user_id==user,QuickDetection.client_request_id==key))
    if row.input_sha256!=digest or row.farming_type!=mode or row.source_type!=source:raise HTTPException(409,'Idempotency key already used for another image or mode')
    if row.status=='succeeded':return serialize(row),200
    if row.attempt_id!=attempt:
        if row.status=='processing':return serialize(row),202
        cleanup(user,row.attempt_id)
        claimed=db.execute(update(QuickDetection).where(QuickDetection.quick_detection_id==row.quick_detection_id,QuickDetection.status=='failed').values(status='processing',attempt_id=attempt,lease_expires_at=deadline,error_code=None))
        db.commit()
        if not claimed.rowcount:
            db.refresh(row);return serialize(row),202
        db.refresh(row)
    record_id=row.quick_detection_id
    try:
        result=ai.infer_mode(mode,frame)
        validate_ai_result(result)
        if result.raw_response is None:raise ValueError('AI raw response required')
        annotated=render_annotation(frame,result)
        original=save_capture_image(CapturedFrame(content,'upload',mime,frame.captured_at),attempt,owner_id=user)
        image=original if orientation==1 else save_capture_image(frame,attempt,owner_id=user,max_bytes=MAX_DERIVATIVE_BYTES)
        annotation=save_capture_image(replace(frame,content=annotated,content_type='image/png'),attempt,owner_id=user,max_bytes=MAX_DERIVATIVE_BYTES)
        total=result.total_count
        values=dict(status='succeeded',completed_at=now(),normal_count=result.normal_count,low_count=result.low_count,total_count=total,normal_ratio=result.normal_count/total if total else None,low_ratio=result.low_count/total if total else None,original_upload_path=original,image_path=image,annotated_image_path=annotation,ai_instances=result.detections,ai_response=result.raw_response,provenance={'origin':'phone_upload','original_sha256':digest,'inference_sha256':hashlib.sha256(frame.content).hexdigest(),'exif_orientation':orientation,'orientation_normalized':orientation!=1,'width':size[0],'height':size[1],'coordinate_space':'normalized_image_pixels','ai_mode':mode,'limitation_note':result.limitation_note})
        changed=db.execute(update(QuickDetection).where(QuickDetection.quick_detection_id==record_id,QuickDetection.attempt_id==attempt,QuickDetection.status=='processing').values(**values))
        if not changed.rowcount:raise ValueError('Request lease expired; retry safely')
        db.commit()
    except Exception as exc:
        db.rollback()
        # A connection can fail after COMMIT succeeded. Never delete committed media.
        try:
            persisted=db.get(QuickDetection,record_id,populate_existing=True)
        except SQLAlchemyError as read_error:
            raise HTTPException(503,'Result status is uncertain. Check History or retry the same photo safely.') from read_error
        if persisted and persisted.status=='succeeded' and persisted.attempt_id==attempt:
            return serialize(persisted),200
        error_code='AI_UNAVAILABLE' if isinstance(exc,AIServiceUnavailable) else 'ANALYSIS_FAILED'
        try:cleanup(user,attempt)
        except OSError:error_code='CLEANUP_REQUIRED'
        db.execute(update(QuickDetection).where(QuickDetection.quick_detection_id==record_id,QuickDetection.attempt_id==attempt,QuickDetection.status=='processing').values(status='failed',error_code=error_code))
        db.commit()
        raise HTTPException(502,'Analysis failed. Retry the same photo safely; no completed result was saved.') from exc
    # Read after commit separately: a read failure must never delete committed media.
    db.expire_all();return serialize(db.get(QuickDetection,record_id)),201
