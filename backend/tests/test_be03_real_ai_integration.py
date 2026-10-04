"""BE-03 acceptance tests: real AI-service boundary + Free-range window accumulation."""

from datetime import datetime, time, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_user
from app.database import Base, get_db
from app.farm_access import owned_cloud_farms
from app.enums import AlertStatus, AlertType, TriggerType
from app.main import app
from app.models import Alert, Detection, Device, Farm, MonitoringSettings, Profile, utcnow
from app.services.ai_adapter import (
    AIInferenceResult,
    AIInvalidResponse,
    AIServiceUnavailable,
    normalize_ai_payload,
    get_ai_adapter,
)
from app.services.capture_adapter import (
    CaptureAdapterUnavailable,
    CapturedFrame,
    get_capture_adapter,
)
from app.services.core_data import dashboard_summary, latest_monitoring_detection_for_device
from app.services.detection_pipeline import persist_ai_result
from app.services.free_range_accumulator import (
    FreeRangeAccumulator,
    free_range_accumulator,
)
from app.services.monitoring_schedule import evaluate_device_schedule


class FakeCaptureAdapter:
    def __init__(self, error: Exception | None = None):
        self.error = error

    def capture(self, device: Device) -> CapturedFrame:
        if self.error is not None:
            raise self.error
        return CapturedFrame(
            content=b"fake-image",
            filename="frame.jpg",
            captured_at=utcnow(),
        )


class FakeAIAdapter:
    def __init__(self, result: AIInferenceResult | None = None, error: Exception | None = None):
        self.result = result or AIInferenceResult(total_count=10, normal_count=8, low_count=2)
        self.error = error
        self.calls: list[tuple[str, str]] = []

    def infer(self, device: Device, frame: CapturedFrame) -> AIInferenceResult:
        self.calls.append((device.farming_type, frame.filename))
        if self.error is not None:
            raise self.error
        return self.result


@pytest.fixture
def be03_env():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()

    db.add(Profile(user_id="00000000-0000-0000-0000-000000000001", display_name="Tester"))
    db.add(
        Farm(
            farm_id="10000000-0000-0000-0000-000000000001",
            user_id="00000000-0000-0000-0000-000000000001",
            farm_name="Test Farm",
            timezone="Australia/Sydney",
        )
    )
    db.flush()
    now = utcnow()
    cage = Device(
        device_id="20000000-0000-0000-0000-000000000001",
        farm_id="10000000-0000-0000-0000-000000000001",
        device_code="CAGE-01",
        farming_type="caged",
        last_seen_at=now,
    )
    free = Device(
        device_id="20000000-0000-0000-0000-000000000002",
        farm_id="10000000-0000-0000-0000-000000000001",
        device_code="FREE-01",
        farming_type="free_range",
        last_seen_at=now,
    )
    db.add_all([cage, free])
    db.add_all(
        [
            MonitoringSettings(
                farm_id="10000000-0000-0000-0000-000000000001",
                farming_type="caged",
                cage_warning_low_ratio_threshold=0.60,
            ),
            MonitoringSettings(
                farm_id="10000000-0000-0000-0000-000000000001",
                farming_type="free_range",
                result_snapshot_interval_minutes=5,
                free_range_warning_low_count_threshold=3,
            ),
        ]
    )
    db.commit()

    def _override_db():
        yield db

    app.dependency_overrides[get_db] = _override_db
    # User endpoints now require a verified owner (authorized_db); simulate the farm owner.
    app.dependency_overrides[current_user] = lambda: "00000000-0000-0000-0000-000000000001"
    app.dependency_overrides[owned_cloud_farms] = lambda: ["10000000-0000-0000-0000-000000000001"]
    client = TestClient(app)
    try:
        yield client, db, cage, free
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()


def _latest_alert(db, device_id: str, alert_type: AlertType) -> Alert | None:
    return db.scalar(
        select(Alert)
        .where(Alert.device_id == device_id, Alert.alert_type == alert_type.value)
        .order_by(Alert.created_at.desc())
    )


def test_ai_team_high_count_is_normalized_to_normal_count():
    result = normalize_ai_payload(
        {
            "mode": "caged",
            "total_count": 6,
            "high_count": 5,
            "low_count": 1,
            "instances": [{"label": "normal", "prob_normal": 0.91}],
        },
        expected_mode="caged",
    )
    assert result.total_count == 6
    assert result.normal_count == 5
    assert result.low_count == 1
    assert result.confidence is None


def test_ai_team_inconsistent_counts_are_rejected():
    with pytest.raises(AIInvalidResponse, match="total_count"):
        normalize_ai_payload(
            {"mode": "free_range", "total_count": 2, "high_count": 1, "low_count": 0},
            expected_mode="free_range",
        )


def test_manual_detection_calls_capture_and_ai_and_persists(be03_env):
    client, db, cage, _ = be03_env
    ai = FakeAIAdapter(AIInferenceResult(total_count=5, normal_count=4, low_count=1))
    app.dependency_overrides[get_capture_adapter] = lambda: FakeCaptureAdapter()
    app.dependency_overrides[get_ai_adapter] = lambda: ai

    response = client.post(f"/api/v1/devices/{cage.device_id}/detect")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["trigger_type"] == "manual"
    assert data["normal_count"] == 4
    assert data["low_count"] == 1
    assert data["normal_ratio"] == pytest.approx(0.8)
    assert data["confidence"] is None
    assert ai.calls == [("caged", "frame.jpg")]
    assert db.get(Detection, data["detection_id"]) is not None


def test_manual_detection_allowed_when_monitoring_disabled(be03_env):
    client, db, cage, _ = be03_env
    row = db.scalar(select(MonitoringSettings).where(MonitoringSettings.farming_type == "caged"))
    row.monitoring_enabled = False
    db.commit()
    app.dependency_overrides[get_capture_adapter] = lambda: FakeCaptureAdapter()
    app.dependency_overrides[get_ai_adapter] = lambda: FakeAIAdapter()

    response = client.post(f"/api/v1/devices/{cage.device_id}/detect")
    assert response.status_code == 200


def test_manual_detection_rejects_offline_device(be03_env):
    client, db, cage, _ = be03_env
    cage.last_seen_at = utcnow() - timedelta(hours=1)
    db.commit()
    app.dependency_overrides[get_capture_adapter] = lambda: FakeCaptureAdapter()
    app.dependency_overrides[get_ai_adapter] = lambda: FakeAIAdapter()

    response = client.post(f"/api/v1/devices/{cage.device_id}/detect")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DEVICE_OFFLINE"


def test_unconfigured_capture_returns_503_without_detection(be03_env):
    client, db, cage, _ = be03_env
    app.dependency_overrides[get_capture_adapter] = lambda: FakeCaptureAdapter(
        error=CaptureAdapterUnavailable("missing")
    )
    app.dependency_overrides[get_ai_adapter] = lambda: FakeAIAdapter()

    response = client.post(f"/api/v1/devices/{cage.device_id}/detect")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "CAPTURE_NOT_CONFIGURED"
    assert db.scalar(select(Detection).where(Detection.device_id == cage.device_id)) is None


def test_ai_service_failure_creates_one_alert_then_success_resolves_it(be03_env):
    client, db, cage, _ = be03_env
    app.dependency_overrides[get_capture_adapter] = lambda: FakeCaptureAdapter()
    app.dependency_overrides[get_ai_adapter] = lambda: FakeAIAdapter(
        error=AIServiceUnavailable("down")
    )

    first = client.post(f"/api/v1/devices/{cage.device_id}/detect")
    second = client.post(f"/api/v1/devices/{cage.device_id}/detect")
    assert first.status_code == 503 and second.status_code == 503
    active = list(
        db.scalars(
            select(Alert).where(
                Alert.device_id == cage.device_id,
                Alert.alert_type == AlertType.detection_failed.value,
                Alert.alert_status == AlertStatus.active.value,
            )
        ).all()
    )
    assert len(active) == 1

    app.dependency_overrides[get_ai_adapter] = lambda: FakeAIAdapter()
    success = client.post(f"/api/v1/devices/{cage.device_id}/detect")
    assert success.status_code == 200
    db.expire_all()
    alert = _latest_alert(db, cage.device_id, AlertType.detection_failed)
    assert alert is not None and alert.alert_status == AlertStatus.resolved.value


def test_cage_warning_requires_two_consecutive_formal_detections(be03_env):
    _, db, cage, _ = be03_env
    hit = AIInferenceResult(total_count=10, normal_count=3, low_count=7)
    first = persist_ai_result(db, cage, hit, trigger_type=TriggerType.scheduled)
    second = persist_ai_result(db, cage, hit, trigger_type=TriggerType.scheduled)
    assert first.monitoring_status == "normal"
    assert second.monitoring_status == "warning"
    alert = _latest_alert(db, cage.device_id, AlertType.low_production_warning)
    assert alert is not None and alert.alert_status == "active"


def test_free_range_accumulator_turns_single_head_observations_into_one_snapshot(be03_env):
    _, db, _, free = be03_env
    acc = FreeRangeAccumulator()
    start = utcnow()
    samples = [
        AIInferenceResult(total_count=1, normal_count=1, low_count=0),
        AIInferenceResult(total_count=1, normal_count=0, low_count=1),
        AIInferenceResult(total_count=1, normal_count=1, low_count=0),
        AIInferenceResult(total_count=1, normal_count=0, low_count=1),
    ]
    for i, sample in enumerate(samples[:-1]):
        out = acc.record_sample(db, free, sample, observed_at=start + timedelta(seconds=i))
        assert out.snapshot_created is False

    out = acc.record_sample(
        db,
        free,
        samples[-1],
        observed_at=start + timedelta(seconds=3),
        force_snapshot=True,
    )
    assert out.snapshot_created is True
    detection = db.get(Detection, out.detection_id)
    assert detection.trigger_type == "free_range_snapshot"
    assert detection.total_count == 4
    assert detection.normal_count == 2
    assert detection.low_count == 2
    assert detection.low_ratio == pytest.approx(0.5)

def test_free_range_snapshot_keeps_last_sample_timestamp(be03_env):
    _, db, _, free = be03_env
    acc = FreeRangeAccumulator()

    observed_at = utcnow()
    sample = AIInferenceResult(
        total_count=1,
        normal_count=1,
        low_count=0,
    )

    out = acc.record_sample(
        db,
        free,
        sample,
        observed_at=observed_at,
        force_snapshot=True,
    )

    assert out.snapshot_created is True

    # Snapshot aggregation window should be cleared.
    assert acc.get_window(free.device_id) is None

    # Sampling timestamp must survive the snapshot.
    assert acc.get_last_sample_at(free.device_id) == observed_at

def test_free_range_schedule_keeps_sampling_interval_after_snapshot(be03_env):
    _, db, _, free = be03_env

    settings_row = db.scalar(
        select(MonitoringSettings).where(
            MonitoringSettings.farm_id == free.farm_id,
            MonitoringSettings.farming_type == "free_range",
        )
    )

    settings_row.monitoring_enabled = True
    settings_row.monitoring_start_time = time(8, 0)
    settings_row.monitoring_end_time = time(18, 0)
    db.commit()

    free_range_accumulator.reset(free.device_id)

    sample_at = datetime(2026, 9, 27, 0, 5, 0)
    check_at = sample_at + timedelta(seconds=5)

    sample = AIInferenceResult(
        total_count=1,
        normal_count=1,
        low_count=0,
    )

    try:
        out = free_range_accumulator.record_sample(
            db,
            free,
            sample,
            observed_at=sample_at,
            force_snapshot=True,
        )

        assert out.snapshot_created is True

        # Snapshot aggregation window is cleared.
        assert free_range_accumulator.get_window(free.device_id) is None

        # Sampling timestamp is still available.
        assert (
            free_range_accumulator.get_last_sample_at(free.device_id)
            == sample_at
        )

        decision = evaluate_device_schedule(
            db,
            free,
            now=check_at,
        )

        assert decision.due is False
        assert decision.reason == "free_range_sampling_not_due"

    finally:
        free_range_accumulator.reset(free.device_id)

def test_free_range_accumulator_is_future_compatible_with_multi_head_ai(be03_env):
    _, db, _, free = be03_env
    acc = FreeRangeAccumulator()
    out = acc.record_sample(
        db,
        free,
        AIInferenceResult(total_count=4, normal_count=3, low_count=1),
        force_snapshot=True,
    )
    detection = db.get(Detection, out.detection_id)
    assert detection.total_count == 4
    assert detection.normal_count == 3
    assert detection.low_count == 1


def test_free_range_warning_uses_two_formal_window_snapshots(be03_env):
    _, db, _, free = be03_env
    acc = FreeRangeAccumulator()
    hit = AIInferenceResult(total_count=5, normal_count=2, low_count=3)
    first_out = acc.record_sample(db, free, hit, force_snapshot=True)
    second_out = acc.record_sample(db, free, hit, force_snapshot=True)
    first = db.get(Detection, first_out.detection_id)
    second = db.get(Detection, second_out.detection_id)
    assert first.monitoring_status == "normal"
    assert second.monitoring_status == "warning"
    alert = _latest_alert(db, free.device_id, AlertType.low_production_warning)
    assert alert is not None and alert.alert_status == "active"


def test_free_range_manual_single_head_does_not_replace_formal_monitoring_snapshot(be03_env):
    client, db, _, free = be03_env
    formal = persist_ai_result(
        db,
        free,
        AIInferenceResult(total_count=8, normal_count=5, low_count=3),
        trigger_type=TriggerType.free_range_snapshot,
    )
    app.dependency_overrides[get_capture_adapter] = lambda: FakeCaptureAdapter()
    app.dependency_overrides[get_ai_adapter] = lambda: FakeAIAdapter(
        AIInferenceResult(total_count=1, normal_count=0, low_count=1)
    )
    manual_response = client.post(f"/api/v1/devices/{free.device_id}/detect")
    assert manual_response.status_code == 200
    assert manual_response.json()["data"]["trigger_type"] == "manual"

    latest = client.get(f"/api/v1/devices/{free.device_id}/detections/latest").json()["data"]
    assert latest["detection_id"] == formal.detection_id
    assert latest["low_count"] == 3
    summary = dashboard_summary(db)
    assert summary["free_range"]["latest_low_count"] == 3


def test_free_range_manual_does_not_resolve_active_snapshot_warning(be03_env):
    client, db, _, free = be03_env
    hit = AIInferenceResult(total_count=5, normal_count=2, low_count=3)
    persist_ai_result(db, free, hit, trigger_type=TriggerType.free_range_snapshot)
    persist_ai_result(db, free, hit, trigger_type=TriggerType.free_range_snapshot)
    before = _latest_alert(db, free.device_id, AlertType.low_production_warning)
    assert before is not None and before.alert_status == "active"

    app.dependency_overrides[get_capture_adapter] = lambda: FakeCaptureAdapter()
    app.dependency_overrides[get_ai_adapter] = lambda: FakeAIAdapter(
        AIInferenceResult(total_count=1, normal_count=1, low_count=0)
    )
    response = client.post(f"/api/v1/devices/{free.device_id}/detect")
    assert response.status_code == 200
    db.expire_all()
    after = _latest_alert(db, free.device_id, AlertType.low_production_warning)
    assert after is not None and after.alert_status == "active"
    assert latest_monitoring_detection_for_device(db, free).trigger_type == "free_range_snapshot"
