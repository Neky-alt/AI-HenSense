"""Window accumulator for Free-range automatic monitoring.

The current AI hand-off keeps only the highest-confidence chicken head for each
Free-range frame (``top_k=1``).  Country Watch therefore treats each successful frame
as an observation and accumulates observations during the configured Result Snapshot
Interval.  At the end of the interval, one formal ``free_range_snapshot`` Detection is
persisted using the unchanged frontend contract:

    normal_count / low_count / total_count / normal_ratio / low_ratio

These counts are *observations within the window*, not guaranteed unique chickens.  No
cross-frame re-identification is performed, consistent with the project scope.

The accumulator is intentionally process-local for BE-03; losing a partial window after
a backend restart is acceptable for the prototype and does not corrupt formal Detection
history.  A future scheduler/hardware loop calls ``record_sample`` for each AI frame.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from threading import Lock

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.enums import CaptureSourceType, FarmingType, TriggerType
from app.models import Device, MonitoringSettings, utcnow
from app.services.ai_adapter import AIInferenceResult
from app.services.detection_pipeline import persist_ai_result, validate_ai_result
from app.services.settings_storage import DEFAULT_FREE_RANGE_SETTINGS


@dataclass
class FreeRangeWindow:
    started_at: datetime
    last_sample_at: datetime
    total_count: int = 0
    normal_count: int = 0
    low_count: int = 0
    sample_calls: int = 0


@dataclass(frozen=True)
class FreeRangeSampleOutcome:
    snapshot_created: bool
    window: FreeRangeWindow | None
    detection_id: str | None = None


class FreeRangeAccumulator:
    def __init__(self):
        self._windows: dict[str, FreeRangeWindow] = {}
        self._last_sample_at: dict[str, datetime] = {}
        self._lock = Lock()

    def reset(self, device_id: str | None = None) -> None:
        with self._lock:
            if device_id is None:
                self._windows.clear()
                self._last_sample_at.clear()
            else:
                self._windows.pop(device_id, None)
                self._last_sample_at.pop(device_id, None)

    def get_window(self, device_id: str) -> FreeRangeWindow | None:
        with self._lock:
            return self._windows.get(device_id)

    def get_last_sample_at(self, device_id: str) -> datetime | None:
        with self._lock:
            return self._last_sample_at.get(device_id)

    def _snapshot_interval_minutes(self, db: Session, device: Device) -> int:
        row = db.scalar(
            select(MonitoringSettings).where(
                MonitoringSettings.farm_id == device.farm_id,
                MonitoringSettings.farming_type == FarmingType.free_range.value,
            )
        )
        if row is not None and row.result_snapshot_interval_minutes is not None:
            return int(row.result_snapshot_interval_minutes)
        return int(DEFAULT_FREE_RANGE_SETTINGS["result_snapshot_interval_minutes"])

    def record_sample(
        self,
        db: Session,
        device: Device,
        result: AIInferenceResult,
        *,
        observed_at: datetime | None = None,
        force_snapshot: bool = False,
    ) -> FreeRangeSampleOutcome:
        """Accumulate one successful Free-range frame and maybe persist a formal snapshot."""

        if device.farming_type != FarmingType.free_range.value:
            raise ValueError("FreeRangeAccumulator only accepts free_range devices")
        validate_ai_result(result)
        now = observed_at or utcnow()
        interval = timedelta(minutes=self._snapshot_interval_minutes(db, device))

        with self._lock:
            window = self._windows.get(device.device_id)
            if window is None:
                window = FreeRangeWindow(started_at=now, last_sample_at=now)
                self._windows[device.device_id] = window

            window.total_count += result.total_count
            window.normal_count += result.normal_count
            window.low_count += result.low_count
            window.sample_calls += 1
            window.last_sample_at = now
            self._last_sample_at[device.device_id] = now

            due = force_snapshot or (now - window.started_at >= interval)
            if not due:
                return FreeRangeSampleOutcome(snapshot_created=False, window=window)

            aggregate = AIInferenceResult(
                total_count=window.total_count,
                normal_count=window.normal_count,
                low_count=window.low_count,
                detected_at=now,
                confidence=None,
            )

            # Keep the partial window until the formal Detection is committed.  If the
            # database write fails, the caller can retry without silently losing the
            # accumulated observations.
            detection = persist_ai_result(
                db,
                device,
                aggregate,
                trigger_type=TriggerType.free_range_snapshot,
                capture_source_type=CaptureSourceType.pi_camera,
            )
            self._windows.pop(device.device_id, None)
            return FreeRangeSampleOutcome(
                snapshot_created=True,
                window=None,
                detection_id=detection.detection_id,
            )


free_range_accumulator = FreeRangeAccumulator()
