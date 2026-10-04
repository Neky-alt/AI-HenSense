"""scripts/build_demo_pack.py with a fake Supabase reader (no network)."""
import json
import sqlite3
from contextlib import closing

import pytest

from scripts.build_demo_pack import CloudError, MissingTable, build

OWNER = "00000000-0000-0000-0000-0000000000aa"
FARM = "10000000-0000-0000-0000-0000000000aa"
CAGE = "20000000-0000-0000-0000-0000000000a1"
FREE = "20000000-0000-0000-0000-0000000000a2"
KEY = f"farms/{FARM}/devices/{CAGE}/detections/d1/original.jpg"
KEY_ANN = f"farms/{FARM}/devices/{CAGE}/detections/d1/annotated.png"
KEY_GONE = f"farms/{FARM}/devices/{CAGE}/detections/d2/original.jpg"


def _detection(detection_id, device_id, **extra):
    return {
        "detection_id": detection_id, "device_id": device_id, "detected_at": "2026-10-01T02:00:00Z",
        "trigger_type": "manual", "capture_source_type": "pi_camera", "total_count": 4,
        "normal_count": 3, "low_count": 1, "normal_ratio": 0.75, "low_ratio": 0.25,
        "monitoring_status": "normal", "confidence": None, "image_url": None,
        "annotated_image_path": None, "image_path": None, "image_deleted_at": None,
        "ai_instances": None, "ai_response": None, "provenance": {"origin": "pi_local_inference"},
        "sync_status": "synced", "deleted_at": None, "created_at": "2026-10-01T02:00:01Z",
        "cloud_only_column": "ignored", **extra,
    }


CLOUD = {
    "profiles": [],  # owner profile missing on purpose
    "farms": [{"farm_id": FARM, "user_id": OWNER, "farm_name": "Demo Farm", "timezone": "Australia/Sydney",
               "created_at": "2026-09-20T00:00:00+00:00", "updated_at": "2026-09-20T00:00:00+00:00"}],
    "devices": [
        {"device_id": CAGE, "farm_id": FARM, "device_code": "CAGE-01", "device_name": "Cage 1",
         "farming_type": "caged", "last_seen_at": None, "is_active": True,
         "created_at": "2026-09-20T00:00:00Z", "updated_at": "2026-09-20T00:00:00Z"},
        {"device_id": FREE, "farm_id": FARM, "device_code": "FREE-01", "device_name": "Free 1",
         "farming_type": "free_range", "last_seen_at": None, "is_active": True,
         "created_at": "2026-09-20T00:00:00Z", "updated_at": "2026-09-20T00:00:00Z"},
    ],
    "monitoring_settings": [{
        "settings_id": "30000000-0000-0000-0000-0000000000aa", "farm_id": FARM, "farming_type": "caged",
        "monitoring_enabled": True, "monitoring_start_time": "10:00:00", "monitoring_end_time": "14:00:00",
        "detection_mode": "scheduled", "detection_interval_minutes": None, "scheduled_times": ["12:00"],
        "cage_warning_low_ratio_threshold": 0.6, "result_snapshot_interval_minutes": None,
        "free_range_warning_low_count_threshold": None, "updated_at": "2026-09-20T00:00:00Z"}],
    "notification_settings": [],
    "device_storage_settings": [],
    "detections": [
        _detection("d1", CAGE, image_url=KEY, annotated_image_path=KEY_ANN),
        _detection("d2", CAGE, image_url=KEY_GONE),  # object missing in Storage
        _detection("d3", CAGE, image_url=f"farms/{FARM}/devices/{CAGE}/detections/d3/original.jpg",
                   image_deleted_at="2026-10-02T00:00:00Z"),
        _detection("d4", FREE, image_url="../../etc/passwd"),  # unsafe key is never followed
    ],
    "alerts": [{"alert_id": "a1", "device_id": CAGE, "detection_id": "d1", "alert_type": "detection_failed",
                "message": "x", "alert_status": "resolved", "sync_status": "synced",
                "created_at": "2026-10-01T00:00:00Z", "resolved_at": "2026-10-01T03:00:00Z"}],
}
OBJECTS = {KEY: b"jpeg-bytes", KEY_ANN: b"png-bytes"}


class FakeReader:
    def __init__(self, tables=CLOUD, objects=OBJECTS, missing=("device_settings",)):
        self.tables, self.objects, self.missing = tables, objects, set(missing)
        self.downloads = []

    def rows(self, table, column, values):
        if table in self.missing:
            raise MissingTable(table)
        return [dict(r) for r in self.tables.get(table, []) if r.get(column) in values]

    def download(self, key):
        self.downloads.append(key)
        return self.objects.get(key)


def _query(path, sql, *args):
    with closing(sqlite3.connect(path)) as db:
        return db.execute(sql, args).fetchall()


def test_dry_run_reports_and_writes_nothing(tmp_path):
    out = tmp_path / "pack"
    report = build(FakeReader(), [FARM], out, apply=False)
    assert not out.exists()
    assert report["counts"]["devices"] == 2
    assert report["counts"]["detections"] == 4
    assert report["counts"]["profiles"] == 1
    assert report["ignored_cloud_columns"]["detections"] == ["cloud_only_column"]
    assert any("device_settings" in w for w in report["warnings"])
    assert any("minimal local profile" in w for w in report["warnings"])


def test_apply_builds_a_pack_the_backend_accepts(tmp_path):
    out = tmp_path / "pack"
    reader = FakeReader()
    report = build(reader, [FARM], out, apply=True)
    database = out / "database.sqlite3"

    assert _query(database, "SELECT farm_id, user_id, timezone FROM farms") == [(FARM, OWNER, "Australia/Sydney")]
    assert sorted(r[0] for r in _query(database, "SELECT device_code FROM devices")) == ["CAGE-01", "FREE-01"]
    rows = dict((r[0], r[1:]) for r in _query(
        database, "SELECT detection_id, image_path, annotated_image_path, sync_status, image_url FROM detections"))
    assert rows["d1"] == (KEY, KEY_ANN, "synced", None)
    assert rows["d2"][:2] == (None, None)       # missing object -> no dangling path
    assert rows["d3"][:2] == (None, None)       # image tombstone kept, no download
    assert rows["d4"][:2] == (None, None)       # unsafe key ignored
    assert reader.downloads == [KEY, KEY_ANN, KEY_GONE]
    assert (out / "media" / KEY).read_bytes() == b"jpeg-bytes"
    assert _query(database, "SELECT sync_status FROM alerts") == [("synced",)]
    assert _query(database, "SELECT monitoring_start_time FROM monitoring_settings")[0][0].startswith("10:00")

    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["images_downloaded"] == 2
    assert manifest["images_missing_in_cloud"] == [KEY_GONE]
    assert set(manifest["media_sha256"]) == {KEY, KEY_ANN}
    assert report["database"] == str(database.resolve())


def test_refuses_existing_output(tmp_path):
    out = tmp_path / "pack"
    out.mkdir()
    with pytest.raises(FileExistsError):
        build(FakeReader(), [FARM], out, apply=True)


def test_unknown_farm_is_an_error(tmp_path):
    with pytest.raises(CloudError, match="not found"):
        build(FakeReader(), ["10000000-0000-0000-0000-0000000000ff"], tmp_path / "pack", apply=False)
