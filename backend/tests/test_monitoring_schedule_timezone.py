from datetime import datetime
from types import SimpleNamespace

import app.services.monitoring_schedule as schedule_module


def _device(timezone_name="Australia/Sydney"):
    return SimpleNamespace(
        device_id="test-device",
        farming_type="caged",
        farm=SimpleNamespace(
            timezone=timezone_name,
        ),
    )


def _config():
    return {
        "monitoring_enabled": True,
        "monitoring_start_time": "10:00",
        "monitoring_end_time": "14:00",
        "detection_mode": "scheduled",
        "detection_interval_minutes": 30,
        "scheduled_times": ["12:00"],
    }


def test_device_schedule_uses_farm_local_time(monkeypatch):
    device = _device()

    monkeypatch.setattr(
        schedule_module,
        "get_device_monitoring_config",
        lambda db, device: _config(),
    )

    monkeypatch.setattr(
        schedule_module,
        "get_last_scheduled_detection_at",
        lambda db, device: None,
    )

    # 02:05 UTC = 12:05 Australia/Sydney on 2026-09-27.
    decision = schedule_module.evaluate_device_schedule(
        object(),
        device,
        now=datetime(2026, 9, 27, 2, 5),
    )

    assert decision.due is True
    assert decision.reason == "scheduled_time_due"
    assert decision.due_at == datetime(2026, 9, 27, 12, 0)


def test_last_detection_is_converted_to_farm_local_time(monkeypatch):
    device = _device()

    monkeypatch.setattr(
        schedule_module,
        "get_device_monitoring_config",
        lambda db, device: _config(),
    )

    monkeypatch.setattr(
        schedule_module,
        "get_last_scheduled_detection_at",
        lambda db, device: datetime(2026, 9, 27, 2, 2),
    )

    # Last detection:
    # 02:02 UTC = 12:02 Australia/Sydney.
    #
    # Current time:
    # 02:10 UTC = 12:10 Australia/Sydney.
    #
    # Therefore the 12:00 slot has already been processed.
    decision = schedule_module.evaluate_device_schedule(
        object(),
        device,
        now=datetime(2026, 9, 27, 2, 10),
    )

    assert decision.due is False
    assert decision.reason == "scheduled_time_already_processed"


def test_invalid_farm_timezone_is_not_due(monkeypatch):
    device = _device("Invalid/Timezone")

    monkeypatch.setattr(
        schedule_module,
        "get_device_monitoring_config",
        lambda db, device: _config(),
    )

    monkeypatch.setattr(
        schedule_module,
        "get_last_scheduled_detection_at",
        lambda db, device: None,
    )

    decision = schedule_module.evaluate_device_schedule(
        object(),
        device,
        now=datetime(2026, 9, 27, 2, 5),
    )

    assert decision.due is False
    assert decision.reason == "invalid_farm_timezone"
