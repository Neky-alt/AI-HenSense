"""Process-local lease so one automatic monitoring slot is sampled only once.

``GET /hardware/devices/{id}/monitoring-due`` answers "is a sample due?" from the
last saved detection. Between that answer and the upload of the sample, another
poll (a second worker, a retry, a duplicated Pi process) would see the same slot
as still due and take a duplicate sample.

When a slot is due, the first caller gets a lease for that device; later callers
are told ``due=False, reason="sample_in_progress"`` until the sample is submitted
or the lease expires (MONITORING_SAMPLE_LEASE_SECONDS). Like the Free-range
accumulator, this is in-memory: the standard launcher runs a single Backend
process. A restart simply forgets leases, which is safe.
"""
from __future__ import annotations

import threading
from datetime import datetime, timedelta

from app.config import settings
from app.models import utcnow


class MonitoringLeases:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._expires: dict[str, datetime] = {}

    def try_acquire(self, device_id: str, *, now: datetime | None = None) -> bool:
        now = now or utcnow()
        with self._lock:
            expires = self._expires.get(device_id)
            if expires is not None and expires > now:
                return False
            self._expires[device_id] = now + timedelta(seconds=settings.MONITORING_SAMPLE_LEASE_SECONDS)
            return True

    def release(self, device_id: str) -> None:
        with self._lock:
            self._expires.pop(device_id, None)

    def reset(self) -> None:
        with self._lock:
            self._expires.clear()


monitoring_leases = MonitoringLeases()
