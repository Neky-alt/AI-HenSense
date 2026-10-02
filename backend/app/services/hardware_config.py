"""Runtime monitoring configuration for hardware devices."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.enums import FarmingType
from app.models import Device, MonitoringSettings
from app.services.settings_storage import (
    DEFAULT_CAGE_SETTINGS,
    DEFAULT_FREE_RANGE_SETTINGS,
)


def get_device_monitoring_config(
    db: Session,
    device: Device,
) -> dict:
    row = db.scalar(
        select(MonitoringSettings).where(
            MonitoringSettings.farm_id == device.farm_id,
            MonitoringSettings.farming_type == device.farming_type,
        )
    )

    defaults = (
        DEFAULT_CAGE_SETTINGS
        if device.farming_type == FarmingType.caged.value
        else DEFAULT_FREE_RANGE_SETTINGS
    )

    if row is None:
        return {
            "device_id": device.device_id,
            "device_code": device.device_code,
            "farming_type": device.farming_type,
            **defaults,
        }

    return {
        "device_id": device.device_id,
        "device_code": device.device_code,
        "farming_type": device.farming_type,
        "monitoring_enabled": row.monitoring_enabled,
        "monitoring_start_time": (
            row.monitoring_start_time.strftime("%H:%M")
            if row.monitoring_start_time
            else None
        ),
        "monitoring_end_time": (
            row.monitoring_end_time.strftime("%H:%M")
            if row.monitoring_end_time
            else None
        ),
        "detection_mode": row.detection_mode,
        "detection_interval_minutes": row.detection_interval_minutes,
        "scheduled_times": row.scheduled_times,
        "cage_warning_low_ratio_threshold":
            row.cage_warning_low_ratio_threshold,
        "result_snapshot_interval_minutes":
            row.result_snapshot_interval_minutes,
        "free_range_warning_low_count_threshold":
            row.free_range_warning_low_count_threshold,
    }