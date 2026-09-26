"""Separate metadata: normal app startup MUST NOT auto-create this feature's schema."""
from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import CheckConstraint, DateTime, Float, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

def now(): return datetime.now(timezone.utc).replace(tzinfo=None)
class QuickBase(DeclarativeBase): pass
class QuickDetection(QuickBase):
    __tablename__='quick_detections'
    quick_detection_id: Mapped[str]=mapped_column(String(36),primary_key=True,default=lambda:str(uuid4()))
    user_id: Mapped[str]=mapped_column(String(36),nullable=False)
    client_request_id: Mapped[str]=mapped_column(String(36),nullable=False)
    input_sha256: Mapped[str]=mapped_column(String(64),nullable=False)
    farming_type: Mapped[str]=mapped_column(String(16),nullable=False)
    source_type: Mapped[str]=mapped_column(String(16),nullable=False)
    status: Mapped[str]=mapped_column(String(16),nullable=False,default='processing')
    attempt_id: Mapped[str]=mapped_column(String(36),nullable=False)
    error_code: Mapped[str|None]=mapped_column(String(64))
    created_at: Mapped[datetime]=mapped_column(DateTime,nullable=False,default=now)
    completed_at: Mapped[datetime|None]=mapped_column(DateTime)
    lease_expires_at: Mapped[datetime]=mapped_column(DateTime,nullable=False)
    normal_count: Mapped[int|None]=mapped_column(Integer)
    low_count: Mapped[int|None]=mapped_column(Integer)
    total_count: Mapped[int|None]=mapped_column(Integer)
    normal_ratio: Mapped[float|None]=mapped_column(Float)
    low_ratio: Mapped[float|None]=mapped_column(Float)
    original_upload_path: Mapped[str|None]=mapped_column(Text)
    image_path: Mapped[str|None]=mapped_column(Text)
    annotated_image_path: Mapped[str|None]=mapped_column(Text)
    ai_instances: Mapped[list|None]=mapped_column(JSON)
    ai_response: Mapped[dict|None]=mapped_column(JSON)
    provenance: Mapped[dict|None]=mapped_column(JSON)
    __table_args__=(
      UniqueConstraint('user_id','client_request_id',name='uq_quick_user_request'),
      Index('ix_quick_user_time','user_id','created_at','quick_detection_id'),
      CheckConstraint("status IN ('processing','succeeded','failed')"),
      CheckConstraint("farming_type IN ('caged','free_range')"),
      CheckConstraint("source_type IN ('camera','gallery')"),
      CheckConstraint("status != 'succeeded' OR (total_count IS NOT NULL AND normal_count IS NOT NULL AND low_count IS NOT NULL AND total_count=normal_count+low_count AND normal_count>=0 AND low_count>=0 AND image_path IS NOT NULL AND annotated_image_path IS NOT NULL AND ai_response IS NOT NULL)"),
      CheckConstraint('total_count IS NULL OR total_count>0 OR (normal_ratio IS NULL AND low_ratio IS NULL)'),
      CheckConstraint('normal_ratio IS NULL OR (normal_ratio>=0 AND normal_ratio<=1)'),
      CheckConstraint('low_ratio IS NULL OR (low_ratio>=0 AND low_ratio<=1)'),
    )
