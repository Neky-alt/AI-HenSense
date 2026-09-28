"""Monitoring schedule policy.

This module only decides whether a monitoring run is due.
It does not start background threads and it does not access camera hardware.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.enums import FarmingType, TriggerType
from app.models import Detection, Device
from app.services.hardware_config import get_device_monitoring_config
from app.config import settings
from app.services.free_range_accumulator import free_range_accumulator

@dataclass(frozen=True)
class ScheduleDecision:
    due: bool
    reason: str
    due_at: datetime | None = None


def _parse_hhmm(value: str | None) -> time | None:
    if not value:
        return None

    return datetime.strptime(value, "%H:%M").time()


def _active_window(
    now: datetime,
    start_value: str | None,
    end_value: str | None,
) -> tuple[datetime, datetime] | None:
    """Return the monitoring window containing now, if any."""

    start_time = _parse_hhmm(start_value)
    end_time = _parse_hhmm(end_value)

    if start_time is None or end_time is None:
        return None

    # Normal daytime window, e.g. 10:00 -> 14:00.
    if start_time <= end_time:
        start = datetime.combine(now.date(), start_time)
        end = datetime.combine(now.date(), end_time)

        if start <= now <= end:
            return start, end

        return None

    # Overnight window, e.g. 20:00 -> 06:00.
    if now.time() >= start_time:
        start = datetime.combine(now.date(), start_time)
        end = datetime.combine(
            now.date() + timedelta(days=1),
            end_time,
        )
        return start, end

    if now.time() <= end_time:
        start = datetime.combine(
            now.date() - timedelta(days=1),
            start_time,
        )
        end = datetime.combine(now.date(), end_time)
        return start, end

    return None


def _scheduled_slots(
    window_start: datetime,
    window_end: datetime,
    scheduled_times: list[str],
) -> list[datetime]:
    slots: list[datetime] = []

    current_date = window_start.date()

    while current_date <= window_end.date():
        for value in scheduled_times:
            slot_time = _parse_hhmm(value)

            if slot_time is None:
                continue

            slot = datetime.combine(current_date, slot_time)

            if window_start <= slot <= window_end:
                slots.append(slot)

        current_date += timedelta(days=1)

    return sorted(slots)


def evaluate_cage_schedule(
    config: dict,
    *,
    now: datetime,
    last_scheduled_at: datetime | None,
) -> ScheduleDecision:
    """Evaluate whether one Caged monitoring run is currently due."""

    if not config.get("monitoring_enabled", False):
        return ScheduleDecision(
            due=False,
            reason="monitoring_disabled",
        )

    window = _active_window(
        now,
        config.get("monitoring_start_time"),
        config.get("monitoring_end_time"),
    )

    if window is None:
        return ScheduleDecision(
            due=False,
            reason="outside_monitoring_window",
        )

    window_start, window_end = window
    mode = config.get("detection_mode")

    if mode == "interval":
        interval = config.get("detection_interval_minutes")

        if not isinstance(interval, int) or interval <= 0:
            return ScheduleDecision(
                due=False,
                reason="invalid_interval",
            )

        # No automatic run has happened during this monitoring window yet.
        if (
            last_scheduled_at is None
            or last_scheduled_at < window_start
        ):
            return ScheduleDecision(
                due=True,
                reason="interval_due",
                due_at=window_start,
            )

        due_at = last_scheduled_at + timedelta(minutes=interval)

        if due_at <= now and due_at <= window_end:
            return ScheduleDecision(
                due=True,
                reason="interval_due",
                due_at=due_at,
            )

        return ScheduleDecision(
            due=False,
            reason="interval_not_due",
            due_at=due_at,
        )

    if mode == "scheduled":
        values = config.get("scheduled_times") or []

        slots = _scheduled_slots(
            window_start,
            window_end,
            values,
        )

        elapsed_slots = [
            slot
            for slot in slots
            if slot <= now
        ]

        if not elapsed_slots:
            return ScheduleDecision(
                due=False,
                reason="scheduled_time_not_reached",
            )

        latest_slot = max(elapsed_slots)

        if (
            last_scheduled_at is None
            or last_scheduled_at < latest_slot
        ):
            return ScheduleDecision(
                due=True,
                reason="scheduled_time_due",
                due_at=latest_slot,
            )

        return ScheduleDecision(
            due=False,
            reason="scheduled_time_already_processed",
            due_at=latest_slot,
        )

    return ScheduleDecision(
        due=False,
        reason="unsupported_detection_mode",
    )

def evaluate_free_range_schedule(
    config: dict,
    *,
    now: datetime,
    last_sample_at: datetime | None,
    sampling_interval_seconds: int,
) -> ScheduleDecision:
    """Evaluate whether one Free-range camera sample is currently due."""

    if not config.get("monitoring_enabled", False):
        return ScheduleDecision(
            due=False,
            reason="monitoring_disabled",
        )

    window = _active_window(
        now,
        config.get("monitoring_start_time"),
        config.get("monitoring_end_time"),
    )

    if window is None:
        return ScheduleDecision(
            due=False,
            reason="outside_monitoring_window",
        )

    window_start, window_end = window

    if sampling_interval_seconds <= 0:
        return ScheduleDecision(
            due=False,
            reason="invalid_free_range_sampling_interval",
        )

    # No sample has been taken during the current monitoring window yet.
    if (
        last_sample_at is None
        or last_sample_at < window_start
    ):
        return ScheduleDecision(
            due=True,
            reason="free_range_sampling_due",
            due_at=window_start,
        )

    due_at = last_sample_at + timedelta(
        seconds=sampling_interval_seconds
    )

    if due_at <= now and due_at <= window_end:
        return ScheduleDecision(
            due=True,
            reason="free_range_sampling_due",
            due_at=due_at,
        )

    return ScheduleDecision(
        due=False,
        reason="free_range_sampling_not_due",
        due_at=due_at,
    )

def _utc_naive_to_farm_local(
    value: datetime,
    timezone_name: str,
) -> datetime:
    """Convert a naive UTC database timestamp to naive farm-local time."""

    utc_value = value

    if utc_value.tzinfo is None:
        utc_value = utc_value.replace(
            tzinfo=timezone.utc
        )
    else:
        utc_value = utc_value.astimezone(
            timezone.utc
        )

    return (
        utc_value.astimezone(
            ZoneInfo(timezone_name)
        )
        .replace(tzinfo=None)
    )

def get_last_scheduled_detection_at(
    db: Session,
    device: Device,
) -> datetime | None:
    return db.scalar(
        select(Detection.detected_at)
        .where(
            Detection.device_id == device.device_id,
            Detection.deleted_at.is_(None),
            Detection.trigger_type == TriggerType.scheduled.value,
        )
        .order_by(
            Detection.detected_at.desc(),
            Detection.created_at.desc(),
        )
        .limit(1)
    )

def evaluate_device_schedule(
    db: Session,
    device: Device,
    *,
    now: datetime,
) -> ScheduleDecision:
    """Evaluate one device using farm-local monitoring time."""

    config = get_device_monitoring_config(
        db,
        device,
    )

    timezone_name = device.farm.timezone or "UTC"

    try:
        local_now = _utc_naive_to_farm_local(
            now,
            timezone_name,
        )
    except ZoneInfoNotFoundError:
        return ScheduleDecision(
            due=False,
            reason="invalid_farm_timezone",
        )

    if device.farming_type == FarmingType.free_range.value:
        accumulator_window = free_range_accumulator.get_window(
            device.device_id
        )

        last_sample_at = (
            accumulator_window.last_sample_at
            if accumulator_window is not None
            else None
        )

        local_last_sample_at = None

        if last_sample_at is not None:
            try:
                local_last_sample_at = _utc_naive_to_farm_local(
                    last_sample_at,
                    timezone_name,
                )
            except ZoneInfoNotFoundError:
                return ScheduleDecision(
                    due=False,
                    reason="invalid_farm_timezone",
                )

        # Discard a partial accumulator window left from an earlier
        # monitoring window before starting today's sampling.
        active_window = _active_window(
            local_now,
            config.get("monitoring_start_time"),
            config.get("monitoring_end_time"),
        )

        if (
            config.get("monitoring_enabled", False)
            and active_window is not None
            and local_last_sample_at is not None
            and local_last_sample_at < active_window[0]
        ):
            free_range_accumulator.reset(device.device_id)
            local_last_sample_at = None

        return evaluate_free_range_schedule(
            config,
            now=local_now,
            last_sample_at=local_last_sample_at,
            sampling_interval_seconds=(
                settings.FREE_RANGE_SAMPLING_INTERVAL_SECONDS
            ),
        )

    if device.farming_type != FarmingType.caged.value:
        return ScheduleDecision(
            due=False,
            reason="unsupported_farming_type",
        )

    last_scheduled_at = get_last_scheduled_detection_at(
        db,
        device,
    )

    local_last_scheduled_at = None

    if last_scheduled_at is not None:
        try:
            local_last_scheduled_at = (
                _utc_naive_to_farm_local(
                    last_scheduled_at,
                    timezone_name,
                )
            )
        except ZoneInfoNotFoundError:
            return ScheduleDecision(
                due=False,
                reason="invalid_farm_timezone",
            )

    return evaluate_cage_schedule(
        config,
        now=local_now,
        last_scheduled_at=local_last_scheduled_at,
    )