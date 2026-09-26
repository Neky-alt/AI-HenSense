"""BE-05 Monitoring, Notification and local media Storage APIs."""

from __future__ import annotations

import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.config import BASE_DIR
from app.farm_access import authorized_db
from app.enums import FarmingType
from app.responses import success
from app.services.settings_storage import (
    get_device_or_404,
    get_monitoring_settings,
    get_notification_settings,
    get_storage_settings,
    get_storage_status,
    upsert_monitoring_settings,
    upsert_notification_settings,
    upsert_storage_settings,
)

router = APIRouter(tags=["settings-storage"])

_TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


def _valid_time(value: str | None) -> bool:
    return value is None or bool(_TIME_RE.fullmatch(value))


class MonitoringSettingsUpdate(BaseModel):
    monitoring_enabled: bool
    monitoring_start_time: str | None = None
    monitoring_end_time: str | None = None
    detection_mode: Literal["interval", "scheduled"] | None = None
    detection_interval_minutes: int | None = Field(default=None, ge=1)
    scheduled_times: list[str] | None = None
    cage_warning_low_ratio_threshold: float | None = Field(default=None, ge=0, le=1)
    result_snapshot_interval_minutes: int | None = Field(default=None, ge=1)
    free_range_warning_low_count_threshold: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_time_values(self):
        if not _valid_time(self.monitoring_start_time) or not _valid_time(self.monitoring_end_time):
            raise ValueError("Monitoring times must use HH:MM format")
        if (self.monitoring_start_time is None) != (self.monitoring_end_time is None):
            raise ValueError("Monitoring start and end times must be provided together")
        if self.scheduled_times is not None and any(not _valid_time(v) for v in self.scheduled_times):
            raise ValueError("Scheduled times must use HH:MM format")
        return self


class StorageSettingsUpdate(BaseModel):
    store_detection_images: bool
    detection_image_retention_days: int | None = Field(default=None, ge=1, le=3650)
    store_video_locally: bool
    video_retention_days: int | None = Field(default=None, ge=1, le=3650)
    max_media_storage_gb: float = Field(gt=0)
    storage_limit_action: Literal["delete_oldest", "stop_recording"]

    @model_validator(mode="after")
    def validate_retention(self):
        if self.store_detection_images and self.detection_image_retention_days is None:
            raise ValueError("detection_image_retention_days is required when image storage is enabled")
        if self.store_video_locally and self.video_retention_days is None:
            raise ValueError("video_retention_days is required when local video storage is enabled")
        return self


class NotificationSettingsUpdate(BaseModel):
    in_app_enabled: bool
    email_enabled: bool = False
    push_enabled: bool = False


def _farming_value(farming_type: FarmingType) -> str:
    return farming_type.value


@router.get("/monitoring-settings/{farming_type}")
def read_monitoring_settings(farming_type: FarmingType, db: Session = Depends(authorized_db)):
    return success(get_monitoring_settings(db, _farming_value(farming_type)))


@router.put("/monitoring-settings/{farming_type}")
def update_monitoring_settings(
    farming_type: FarmingType,
    payload: MonitoringSettingsUpdate,
    db: Session = Depends(authorized_db),
):
    data = payload.model_dump()
    if farming_type == FarmingType.caged:
        if payload.detection_mode is None or payload.cage_warning_low_ratio_threshold is None:
            raise HTTPException(status_code=422, detail="Cage monitoring fields are incomplete")
        if payload.detection_mode == "interval" and payload.detection_interval_minutes is None:
            raise HTTPException(status_code=422, detail="detection_interval_minutes is required")
        if payload.detection_mode == "scheduled" and not payload.scheduled_times:
            raise HTTPException(status_code=422, detail="scheduled_times is required")
    else:
        if (
            payload.result_snapshot_interval_minutes is None
            or payload.free_range_warning_low_count_threshold is None
        ):
            raise HTTPException(status_code=422, detail="Free-range monitoring fields are incomplete")
    return success(upsert_monitoring_settings(db, farming_type.value, data))


@router.get("/devices/{device_id}/storage")
def read_storage_status(device_id: str, db: Session = Depends(authorized_db)):
    return success(get_storage_status(db, device_id, BASE_DIR / "local_storage"))


@router.get("/devices/{device_id}/storage/settings")
def read_storage_settings(device_id: str, db: Session = Depends(authorized_db)):
    return success(get_storage_settings(db, device_id))


@router.put("/devices/{device_id}/storage/settings")
def update_storage_settings(
    device_id: str,
    payload: StorageSettingsUpdate,
    db: Session = Depends(authorized_db),
):
    device = get_device_or_404(db, device_id)
    if device.farming_type == FarmingType.caged.value and payload.store_video_locally:
        raise HTTPException(
            status_code=422,
            detail="Cage devices do not use continuous local video storage",
        )
    status = get_storage_status(db, device_id, BASE_DIR / "local_storage")
    capacity_gb = status["sd_capacity_bytes"] / (1024 ** 3)
    if payload.max_media_storage_gb > capacity_gb:
        raise HTTPException(status_code=422, detail="Maximum media storage exceeds SD capacity")
    return success(upsert_storage_settings(db, device_id, payload.model_dump()))


@router.get("/notification-settings")
def read_notification_settings(db: Session = Depends(authorized_db)):
    return success(get_notification_settings(db))


@router.put("/notification-settings")
def update_notification_settings(
    payload: NotificationSettingsUpdate,
    db: Session = Depends(authorized_db),
):
    return success(upsert_notification_settings(db, payload.model_dump()))
