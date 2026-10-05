"""Device Management: Add / Rename / Remove / Purge (docs/DEVICE_MANAGEMENT_API.md)."""
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_user
from app.config import settings
from app.database import Base, get_db
from app.farm_access import owned_cloud_farms
from app.main import app
from app.models import (
    Alert,
    Detection,
    Device,
    DeviceCommand,
    Farm,
    Profile,
    utcnow,
)
from app.services.device_cloud import CloudCodeTaken, CloudUnavailable, get_device_cloud

USER_A = "00000000-0000-0000-0000-00000000000a"
USER_B = "00000000-0000-0000-0000-00000000000b"
USER_NO_FARM = "00000000-0000-0000-0000-00000000000c"
FARM_A = "10000000-0000-0000-0000-00000000000a"
FARM_B = "10000000-0000-0000-0000-00000000000b"
CAGE_A = "20000000-0000-0000-0000-0000000000a1"
OLD_A = "20000000-0000-0000-0000-0000000000a2"
CAGE_B = "20000000-0000-0000-0000-0000000000b1"
HARDWARE_KEY = "test-hardware-key"
FARMS = {USER_A: [FARM_A], USER_B: [FARM_B], USER_NO_FARM: []}


class FakeCloud:
    def __init__(self):
        self.calls = []
        self.taken = set()
        self.fail = False
        self.conflict_on_insert = False

    def _maybe_fail(self):
        if self.fail:
            raise CloudUnavailable("offline")

    def code_taken(self, code):
        self._maybe_fail()
        self.calls.append(("code_taken", code))
        return code in self.taken

    def insert_device(self, payload):
        self._maybe_fail()
        if self.conflict_on_insert:
            raise CloudCodeTaken(payload["device_code"])
        self.calls.append(("insert", payload["device_id"], payload["device_code"]))

    def update_device(self, device_id, fields):
        self._maybe_fail()
        self.calls.append(("update", device_id, fields))

    def delete_device_row(self, device_id):
        self._maybe_fail()
        self.calls.append(("delete_row", device_id))

    def purge_device(self, farm_id, device_id):
        self._maybe_fail()
        self.calls.append(("purge", farm_id, device_id))
        return 2


@pytest.fixture
def env(tmp_path, monkeypatch):
    media = tmp_path / "media"
    (media / OLD_A).mkdir(parents=True)
    (media / OLD_A / "original.jpg").write_bytes(b"jpg")
    (media / OLD_A / "annotated.png").write_bytes(b"png")
    monkeypatch.setattr(settings, "LOCAL_IMAGE_DIR", str(media))
    monkeypatch.setattr(settings, "HARDWARE_API_KEY", HARDWARE_KEY)

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    now = utcnow()
    db.add_all(
        [
            Profile(user_id=USER_A),
            Profile(user_id=USER_B),
            Profile(user_id=USER_NO_FARM),
            Farm(farm_id=FARM_A, user_id=USER_A, farm_name="A"),
            Farm(farm_id=FARM_B, user_id=USER_B, farm_name="B"),
        ]
    )
    db.flush()
    db.add_all(
        [
            Device(device_id=CAGE_A, farm_id=FARM_A, device_code="CAGE-01", device_name="Cage 1",
                   farming_type="caged", last_seen_at=now),
            Device(device_id=OLD_A, farm_id=FARM_A, device_code="OLD-01", device_name="Old",
                   farming_type="caged", is_active=False),
            Device(device_id=CAGE_B, farm_id=FARM_B, device_code="BCAGE-01", device_name="B cage",
                   farming_type="caged"),
        ]
    )
    db.flush()
    detection = Detection(
        device_id=OLD_A, detected_at=now - timedelta(days=1), trigger_type="manual",
        capture_source_type="pi_camera", total_count=2, normal_count=1, low_count=1,
        monitoring_status="normal", image_path=f"{OLD_A}/original.jpg",
        annotated_image_path=f"{OLD_A}/annotated.png",
    )
    db.add(detection)
    db.flush()
    db.add_all(
        [
            Alert(device_id=OLD_A, detection_id=detection.detection_id,
                  alert_type="detection_failed", message="x"),
            DeviceCommand(device_id=OLD_A, command_type="manual_detection", command_status="completed"),
            DeviceCommand(device_id=CAGE_A, command_type="manual_detection", command_status="pending"),
        ]
    )
    db.commit()
    db.connection().exec_driver_sql(
        "CREATE TABLE be04_outbox (kind TEXT NOT NULL, record_id TEXT NOT NULL, fingerprint TEXT, "
        "attempts INTEGER NOT NULL DEFAULT 0, next_retry_at TEXT, last_error_type TEXT, synced_at TEXT, "
        "PRIMARY KEY (kind, record_id))"
    )
    db.connection().exec_driver_sql(
        "INSERT INTO be04_outbox(kind, record_id, fingerprint) VALUES ('devices', ?, 'f'), ('detections', ?, 'f')",
        (OLD_A, detection.detection_id),
    )
    db.commit()

    who = {"user": USER_A}
    cloud = {"value": None}  # None = local-only mode

    def _db():
        yield db

    def _cloud():
        yield cloud["value"]

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[current_user] = lambda: who["user"]
    app.dependency_overrides[owned_cloud_farms] = lambda: FARMS[who["user"]]
    app.dependency_overrides[get_device_cloud] = _cloud
    try:
        yield TestClient(app), db, who, cloud, media
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()


def _add(client, **overrides):
    body = {"device_code": " pi-005 ", "device_name": " Cage C-05 ", "farming_type": "caged"}
    body.update(overrides)
    return client.post("/api/v1/devices", json=body)


def _error_code(response):
    return response.json()["error"]["code"]


# ------------------------------------------------------------------------ add
def test_add_device_creates_offline_device_visible_in_list(env):
    client, *_ = env
    response = _add(client)
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["device_code"] == "PI-005"
    assert data["device_name"] == "Cage C-05"
    assert data["farm_id"] == FARM_A
    assert data["device_status"] == "offline"
    assert data["latest_detection"] is None
    codes = [d["device_code"] for d in client.get("/api/v1/devices").json()["data"]]
    assert "PI-005" in codes
    assert client.get(f"/api/v1/devices/{data['device_id']}").status_code == 200


@pytest.mark.parametrize(
    ("code", "expected"),
    [("cage-01", "DEVICE_CODE_TAKEN"), ("BCAGE-01", "DEVICE_CODE_TAKEN"), ("old-01", "DEVICE_CODE_RETIRED")],
)
def test_add_device_code_conflicts(env, code, expected):
    client, db, *_ = env
    before = db.connection().exec_driver_sql("SELECT COUNT(*) FROM devices").scalar()
    response = _add(client, device_code=code)
    assert response.status_code == 409
    assert _error_code(response) == expected
    assert db.connection().exec_driver_sql("SELECT COUNT(*) FROM devices").scalar() == before


def test_retired_code_of_another_user_is_reported_as_taken(env):
    client, _db, who, *_ = env
    who["user"] = USER_B
    response = _add(client, device_code="OLD-01")
    assert response.status_code == 409
    assert _error_code(response) == "DEVICE_CODE_TAKEN"


@pytest.mark.parametrize(
    ("field", "value", "expected"),
    [
        ("device_code", "", "INVALID_DEVICE_CODE"),
        ("device_code", "AB", "INVALID_DEVICE_CODE"),
        ("device_code", "PI 005", "INVALID_DEVICE_CODE"),
        ("device_code", "X" * 33, "INVALID_DEVICE_CODE"),
        ("device_name", "   ", "INVALID_DEVICE_NAME"),
        ("device_name", "n" * 65, "INVALID_DEVICE_NAME"),
        ("farming_type", "free-range", "INVALID_FARMING_TYPE"),
    ],
)
def test_add_device_validation(env, field, value, expected):
    client, *_ = env
    response = _add(client, **{field: value})
    assert response.status_code == 422
    assert _error_code(response) == expected


def test_add_device_without_body_is_validation_error(env):
    client, *_ = env
    response = client.post("/api/v1/devices", content=b"not json", headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert _error_code(response) == "VALIDATION_ERROR"


def test_add_device_requires_owned_farm(env):
    client, _db, who, *_ = env
    response = _add(client, farm_id=FARM_B)
    assert response.status_code == 404
    assert _error_code(response) == "FARM_NOT_FOUND"
    who["user"] = USER_NO_FARM
    response = _add(client)
    assert response.status_code == 404
    assert _error_code(response) == "FARM_NOT_FOUND"


def test_add_device_writes_cloud_first(env):
    client, _db, _who, cloud, _media = env
    cloud["value"] = fake = FakeCloud()
    response = _add(client)
    assert response.status_code == 201
    device_id = response.json()["data"]["device_id"]
    assert fake.calls == [("code_taken", "PI-005"), ("insert", device_id, "PI-005")]


@pytest.mark.parametrize("mode", ["taken", "conflict", "offline", "misconfigured"])
def test_add_device_cloud_failures_change_nothing_locally(env, mode):
    client, db, _who, cloud, _media = env
    fake = FakeCloud()
    if mode == "taken":
        fake.taken.add("PI-005")
    elif mode == "conflict":
        fake.conflict_on_insert = True
    elif mode == "offline":
        fake.fail = True
    cloud["value"] = False if mode == "misconfigured" else fake
    response = _add(client)
    expected = (409, "DEVICE_CODE_TAKEN") if mode in ("taken", "conflict") else (503, "CLOUD_UNAVAILABLE")
    assert (response.status_code, _error_code(response)) == expected
    assert db.connection().exec_driver_sql(
        "SELECT COUNT(*) FROM devices WHERE device_code='PI-005'"
    ).scalar() == 0


# --------------------------------------------------------------------- rename
def test_rename_device(env):
    client, _db, _who, cloud, _media = env
    cloud["value"] = fake = FakeCloud()
    response = client.patch(f"/api/v1/devices/{CAGE_A}", json={"device_name": "  North cage "})
    assert response.status_code == 200, response.text
    assert response.json()["data"]["device_name"] == "North cage"
    assert response.json()["data"]["device_code"] == "CAGE-01"
    assert fake.calls[0][0:2] == ("update", CAGE_A)
    assert fake.calls[0][2]["device_name"] == "North cage"


def test_rename_still_succeeds_when_cloud_is_down(env):
    client, _db, _who, cloud, _media = env
    cloud["value"] = fake = FakeCloud()
    fake.fail = True
    response = client.patch(f"/api/v1/devices/{CAGE_A}", json={"device_name": "Offline rename"})
    assert response.status_code == 200


@pytest.mark.parametrize("body", [{"device_name": "x", "farming_type": "free_range"}, {"device_code": "NEW-01"}])
def test_rename_rejects_other_fields(env, body):
    client, *_ = env
    response = client.patch(f"/api/v1/devices/{CAGE_A}", json=body)
    assert response.status_code == 422
    assert _error_code(response) == "VALIDATION_ERROR"


@pytest.mark.parametrize("device_id", [CAGE_B, OLD_A, "missing"])
def test_rename_only_own_active_devices(env, device_id):
    client, *_ = env
    response = client.patch(f"/api/v1/devices/{device_id}", json={"device_name": "x"})
    assert response.status_code == 404


# --------------------------------------------------------------------- remove
def test_remove_device_is_soft_and_stops_hardware(env):
    client, db, *_ = env
    response = client.delete(f"/api/v1/devices/{CAGE_A}")
    assert response.status_code == 200, response.text
    assert response.json()["data"] == {"device_id": CAGE_A, "is_active": False, "history_retained": True}
    assert CAGE_A not in [d["device_id"] for d in client.get("/api/v1/devices").json()["data"]]
    removed = client.get("/api/v1/devices/removed").json()["data"]
    assert {d["device_id"] for d in removed} == {CAGE_A, OLD_A}
    command = db.scalar(select(DeviceCommand).where(DeviceCommand.device_id == CAGE_A))
    assert command.command_status == "failed"
    assert command.error_message == "Device removed"
    heartbeat = client.post(
        f"/api/v1/hardware/devices/{CAGE_A}/heartbeat", headers={"X-Hardware-Key": HARDWARE_KEY}
    )
    assert heartbeat.status_code == 404
    # R3: the code stays reserved.
    assert _error_code(_add(client, device_code="CAGE-01")) == "DEVICE_CODE_RETIRED"


def test_remove_other_users_or_already_removed_device_is_404(env):
    client, *_ = env
    assert client.delete(f"/api/v1/devices/{CAGE_B}").status_code == 404
    assert client.delete(f"/api/v1/devices/{OLD_A}").status_code == 404


def test_removed_list_is_scoped_to_caller(env):
    client, _db, who, *_ = env
    who["user"] = USER_B
    assert client.get("/api/v1/devices/removed").json()["data"] == []


# ---------------------------------------------------------------------- purge
def test_purge_deletes_history_media_outbox_and_releases_code(env):
    client, db, _who, cloud, media = env
    cloud["value"] = fake = FakeCloud()
    response = client.delete(f"/api/v1/devices/{OLD_A}?purge_history=true")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["purged"] is True
    assert data["detections_deleted"] == 1
    assert data["alerts_deleted"] == 1
    assert data["media_deleted"] == 2
    assert fake.calls == [("purge", FARM_A, OLD_A)]
    raw = db.connection()
    for table in ("devices", "detections", "alerts", "device_commands"):
        assert raw.exec_driver_sql(f"SELECT COUNT(*) FROM {table} WHERE device_id=?", (OLD_A,)).scalar() == 0
    assert raw.exec_driver_sql("SELECT COUNT(*) FROM be04_outbox").scalar() == 0
    assert not (media / OLD_A / "original.jpg").exists()
    assert not (media / OLD_A / "annotated.png").exists()
    # R4: the code can be reused now.
    assert _add(client, device_code="OLD-01").status_code == 201


def test_purge_active_device_in_local_only_mode(env):
    client, db, *_ = env
    response = client.delete(f"/api/v1/devices/{CAGE_A}?purge_history=true")
    assert response.status_code == 200
    assert db.connection().exec_driver_sql(
        "SELECT COUNT(*) FROM devices WHERE device_id=?", (CAGE_A,)
    ).scalar() == 0


def test_purge_cloud_failure_keeps_everything_local(env):
    client, db, _who, cloud, media = env
    cloud["value"] = fake = FakeCloud()
    fake.fail = True
    response = client.delete(f"/api/v1/devices/{OLD_A}?purge_history=true")
    assert response.status_code == 503
    assert _error_code(response) == "CLOUD_UNAVAILABLE"
    raw = db.connection()
    assert raw.exec_driver_sql("SELECT COUNT(*) FROM devices WHERE device_id=?", (OLD_A,)).scalar() == 1
    assert raw.exec_driver_sql("SELECT COUNT(*) FROM detections WHERE device_id=?", (OLD_A,)).scalar() == 1
    assert (media / OLD_A / "original.jpg").exists()


def test_purge_other_users_device_is_404(env):
    client, db, *_ = env
    assert client.delete(f"/api/v1/devices/{CAGE_B}?purge_history=true").status_code == 404
    assert db.connection().exec_driver_sql(
        "SELECT COUNT(*) FROM devices WHERE device_id=?", (CAGE_B,)
    ).scalar() == 1
