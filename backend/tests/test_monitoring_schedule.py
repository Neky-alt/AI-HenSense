"""Tests for monitoring schedule policy."""

from datetime import datetime, timedelta

from app.services.monitoring_schedule import evaluate_cage_schedule


def config(**overrides):
    value = {
        "monitoring_enabled": True,
        "monitoring_start_time": "10:00",
        "monitoring_end_time": "14:00",
        "detection_mode": "interval",
        "detection_interval_minutes": 30,
        "scheduled_times": ["11:00", "12:00", "13:00"],
    }

    value.update(overrides)
    return value


def test_disabled_monitoring_is_not_due():
    decision = evaluate_cage_schedule(
        config(monitoring_enabled=False),
        now=datetime(2026, 9, 27, 11, 0),
        last_scheduled_at=None,
    )

    assert decision.due is False
    assert decision.reason == "monitoring_disabled"


def test_outside_window_is_not_due():
    decision = evaluate_cage_schedule(
        config(),
        now=datetime(2026, 9, 27, 9, 0),
        last_scheduled_at=None,
    )

    assert decision.due is False
    assert decision.reason == "outside_monitoring_window"


def test_interval_first_run_is_due():
    decision = evaluate_cage_schedule(
        config(),
        now=datetime(2026, 9, 27, 10, 5),
        last_scheduled_at=None,
    )

    assert decision.due is True
    assert decision.reason == "interval_due"
    assert decision.due_at == datetime(2026, 9, 27, 10, 0)


def test_interval_not_due_before_interval_elapsed():
    decision = evaluate_cage_schedule(
        config(),
        now=datetime(2026, 9, 27, 10, 20),
        last_scheduled_at=datetime(2026, 9, 27, 10, 0),
    )

    assert decision.due is False
    assert decision.reason == "interval_not_due"
    assert decision.due_at == datetime(2026, 9, 27, 10, 30)


def test_interval_due_after_interval_elapsed():
    decision = evaluate_cage_schedule(
        config(),
        now=datetime(2026, 9, 27, 10, 35),
        last_scheduled_at=datetime(2026, 9, 27, 10, 0),
    )

    assert decision.due is True
    assert decision.due_at == datetime(2026, 9, 27, 10, 30)


def test_scheduled_mode_runs_after_slot():
    decision = evaluate_cage_schedule(
        config(detection_mode="scheduled"),
        now=datetime(2026, 9, 27, 12, 3),
        last_scheduled_at=datetime(2026, 9, 27, 11, 0),
    )

    assert decision.due is True
    assert decision.reason == "scheduled_time_due"
    assert decision.due_at == datetime(2026, 9, 27, 12, 0)


def test_scheduled_mode_does_not_repeat_same_slot():
    decision = evaluate_cage_schedule(
        config(detection_mode="scheduled"),
        now=datetime(2026, 9, 27, 12, 10),
        last_scheduled_at=datetime(2026, 9, 27, 12, 2),
    )

    assert decision.due is False
    assert decision.reason == "scheduled_time_already_processed"
    assert decision.due_at == datetime(2026, 9, 27, 12, 0)


def test_overnight_window_supported():
    decision = evaluate_cage_schedule(
        config(
            monitoring_start_time="20:00",
            monitoring_end_time="06:00",
            detection_interval_minutes=30,
        ),
        now=datetime(2026, 9, 28, 1, 0),
        last_scheduled_at=datetime(2026, 9, 28, 0, 20),
    )

    assert decision.due is True
    assert decision.due_at == datetime(2026, 9, 28, 0, 50)