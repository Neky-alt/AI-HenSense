"""BE-05 Settings & Storage service helpers.

This module implements the local SQLite persistence and runtime SD-card status
required by 03 V2.0 §§14-16 and §20.  It deliberately does not implement
scheduler execution, AI inference, or cloud sync; those remain separate backend
concerns.
"""

from __future__ import annotations

import shutil
from datetime import time
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.enums import FarmingType
from app.models import (
    Device,
    DeviceStorageSettings,
    Farm,
    MonitoringSettings,
    NotificationSettings,
    Profile,
)


DEFAULT_CAGE_SETTINGS: dict[str, Any] = {
    "monitoring_enabled": True,
    "monitoring_start_time": "10:00",
    "monitoring_end_time": "14:00",
    "detection_mode": "scheduled",
    "detection_interval_minutes": 30,
    "scheduled_times": ["12:00"],
    "cage_warning_low_ratio_threshold": 0.60,
    "result_snapshot_interval_minutes": None,
    "free_range_warning_low_count_threshold": None,
}

DEFAULT_FREE_RANGE_SETTINGS: dict[str, Any] = {
    "monitoring_enabled": True,
    "monitoring_start_time": "08:00",
    "monitoring_end_time": "18:00",
    "detection_mode": None,
    "detection_interval_minutes": None,
    "scheduled_times": None,
    "cage_warning_low_ratio_threshold": None,
    "result_snapshot_interval_minutes": 5,
    "free_range_warning_low_count_threshold": 3,
}

DEFAULT_STORAGE_SETTINGS: dict[str, Any] = {
    "store_detection_images": True,
    "detection_image_retention_days": 30,
    "store_video_locally": True,
    "video_retention_days": 7,
    "max_media_storage_gb": 80.0,
    "storage_limit_action": "delete_oldest",
}

DEFAULT_NOTIFICATION_SETTINGS: dict[str, Any] = {
    "in_app_enabled": True,
    "email_enabled": False,
    "push_enabled": False,
}


def _time_to_hhmm(value: time | None) -> str | None:
    return value.strftime("%H:%M") if value is not None else None


def _hhmm_to_time(value: str | None) -> time | None:
    if value is None:
        return None
    hour, minute = value.split(":", 1)
    return time(hour=int(hour), minute=int(minute))


def _z(dt) -> str | None:
    if dt is None:
        return None
    return dt.isoformat(timespec="microseconds") + "Z"


def _first_farm(db: Session) -> Farm:
    farm = db.execute(select(Farm).order_by(Farm.created_at.asc())).scalars().first()
    if farm is None:
        raise HTTPException(status_code=404, detail="Farm not found")
    return farm


def _first_profile(db: Session) -> Profile:
    profile = db.execute(select(Profile).order_by(Profile.created_at.asc())).scalars().first()
    if profile is None:
        raise HTTPException(status_code=404, detail="User profile not found")
    return profile


def get_device_or_404(db: Session, device_id: str) -> Device:
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


def serialize_monitoring_settings(row: MonitoringSettings | None, farming_type: str) -> dict:
    if row is None:
        defaults = (
            DEFAULT_CAGE_SETTINGS if farming_type == FarmingType.caged.value else DEFAULT_FREE_RANGE_SETTINGS
        )
        return {
            "settings_id": None,
            "farm_id": None,
            "farming_type": farming_type,
            **defaults,
            "updated_at": None,
        }

    return {
        "settings_id": row.settings_id,
        "farm_id": row.farm_id,
        "farming_type": row.farming_type,
        "monitoring_enabled": row.monitoring_enabled,
        "monitoring_start_time": _time_to_hhmm(row.monitoring_start_time),
        "monitoring_end_time": _time_to_hhmm(row.monitoring_end_time),
        "detection_mode": row.detection_mode,
        "detection_interval_minutes": row.detection_interval_minutes,
        "scheduled_times": row.scheduled_times,
        "cage_warning_low_ratio_threshold": row.cage_warning_low_ratio_threshold,
        "result_snapshot_interval_minutes": row.result_snapshot_interval_minutes,
        "free_range_warning_low_count_threshold": row.free_range_warning_low_count_threshold,
        "updated_at": _z(row.updated_at),
    }


def get_monitoring_settings(db: Session, farming_type: str) -> dict:
    farm = _first_farm(db)
    row = db.execute(
        select(MonitoringSettings).where(
            MonitoringSettings.farm_id == farm.farm_id,
            MonitoringSettings.farming_type == farming_type,
        )
    ).scalars().first()
    data = serialize_monitoring_settings(row, farming_type)
    if row is None:
        data["farm_id"] = farm.farm_id
    return data


def upsert_monitoring_settings(db: Session, farming_type: str, payload: dict) -> dict:
    farm = _first_farm(db)
    row = db.execute(
        select(MonitoringSettings).where(
            MonitoringSettings.farm_id == farm.farm_id,
            MonitoringSettings.farming_type == farming_type,
        )
    ).scalars().first()
    if row is None:
        row = MonitoringSettings(farm_id=farm.farm_id, farming_type=farming_type)
        db.add(row)

    row.monitoring_enabled = payload["monitoring_enabled"]
    row.monitoring_start_time = _hhmm_to_time(payload.get("monitoring_start_time"))
    row.monitoring_end_time = _hhmm_to_time(payload.get("monitoring_end_time"))

    if farming_type == FarmingType.caged.value:
        row.detection_mode = payload["detection_mode"]
        row.detection_interval_minutes = payload.get("detection_interval_minutes")
        row.scheduled_times = payload.get("scheduled_times")
        row.cage_warning_low_ratio_threshold = payload["cage_warning_low_ratio_threshold"]
        row.result_snapshot_interval_minutes = None
        row.free_range_warning_low_count_threshold = None
    else:
        row.detection_mode = None
        row.detection_interval_minutes = None
        row.scheduled_times = None
        row.cage_warning_low_ratio_threshold = None
        row.result_snapshot_interval_minutes = payload["result_snapshot_interval_minutes"]
        row.free_range_warning_low_count_threshold = payload[
            "free_range_warning_low_count_threshold"
        ]

    db.commit()
    db.refresh(row)
    return serialize_monitoring_settings(row, farming_type)


def serialize_storage_settings(row: DeviceStorageSettings | None, device: Device) -> dict:
    if row is None:
        defaults = dict(DEFAULT_STORAGE_SETTINGS)
        if device.farming_type == FarmingType.caged.value:
            defaults["store_video_locally"] = False
        return {"device_id": device.device_id, **defaults, "updated_at": None}

    return {
        "device_id": row.device_id,
        "store_detection_images": row.store_detection_images,
        "detection_image_retention_days": row.detection_image_retention_days,
        "store_video_locally": row.store_video_locally,
        "video_retention_days": row.video_retention_days,
        "max_media_storage_gb": row.max_media_storage_gb,
        "storage_limit_action": row.storage_limit_action,
        "updated_at": _z(row.updated_at),
    }


def get_storage_settings(db: Session, device_id: str) -> dict:
    device = get_device_or_404(db, device_id)
    return serialize_storage_settings(db.get(DeviceStorageSettings, device_id), device)


def upsert_storage_settings(db: Session, device_id: str, payload: dict) -> dict:
    device = get_device_or_404(db, device_id)
    row = db.get(DeviceStorageSettings, device_id)
    if row is None:
        row = DeviceStorageSettings(device_id=device_id)
        db.add(row)

    row.store_detection_images = payload["store_detection_images"]
    row.detection_image_retention_days = payload.get("detection_image_retention_days")
    row.store_video_locally = payload["store_video_locally"]
    row.video_retention_days = payload.get("video_retention_days")
    row.max_media_storage_gb = payload["max_media_storage_gb"]
    row.storage_limit_action = payload["storage_limit_action"]

    db.commit()
    db.refresh(row)
    return serialize_storage_settings(row, device)


def get_storage_status(db: Session, device_id: str, storage_root: Path) -> dict:
    get_device_or_404(db, device_id)
    storage_root.mkdir(parents=True, exist_ok=True)
    usage = shutil.disk_usage(storage_root)
    return {
        "device_id": device_id,
        "sd_capacity_bytes": usage.total,
        "sd_used_bytes": usage.used,
        "sd_available_bytes": usage.free,
    }


def serialize_notification_settings(row: NotificationSettings | None, user_id: str) -> dict:
    if row is None:
        return {"user_id": user_id, **DEFAULT_NOTIFICATION_SETTINGS, "updated_at": None}
    return {
        "user_id": row.user_id,
        "in_app_enabled": row.in_app_enabled,
        "email_enabled": row.email_enabled,
        "push_enabled": row.push_enabled,
        "updated_at": _z(row.updated_at),
    }


def get_notification_settings(db: Session) -> dict:
    profile = _first_profile(db)
    return serialize_notification_settings(db.get(NotificationSettings, profile.user_id), profile.user_id)


def upsert_notification_settings(db: Session, payload: dict) -> dict:
    profile = _first_profile(db)
    row = db.get(NotificationSettings, profile.user_id)
    if row is None:
        row = NotificationSettings(user_id=profile.user_id)
        db.add(row)
    row.in_app_enabled = payload["in_app_enabled"]
    row.email_enabled = payload.get("email_enabled", False)
    row.push_enabled = payload.get("push_enabled", False)
    db.commit()
    db.refresh(row)
    return serialize_notification_settings(row, profile.user_id)
