"""scripts/migrate_device_code_unique.py: dry run, duplicate refusal, backup + apply."""
import sqlite3
from contextlib import closing

import pytest

from scripts.migrate_device_code_unique import has_global_unique_index, main

LEGACY_SCHEMA = (
    "CREATE TABLE devices (device_id TEXT PRIMARY KEY, farm_id TEXT NOT NULL, "
    "device_code TEXT NOT NULL, UNIQUE (farm_id, device_code))"
)


def _db(path, rows):
    with closing(sqlite3.connect(path)) as db:
        db.execute(LEGACY_SCHEMA)
        db.executemany("INSERT INTO devices VALUES (?, ?, ?)", rows)
        db.commit()
    return path


def _unique(path):
    with closing(sqlite3.connect(path)) as db:
        return has_global_unique_index(db)


def test_dry_run_changes_nothing(tmp_path):
    path = _db(tmp_path / "db.sqlite3", [("d1", "f1", "CAGE-01"), ("d2", "f2", "CAGE-02")])
    before = path.read_bytes()
    assert main(["--database", str(path)]) == 0
    assert path.read_bytes() == before
    assert not _unique(path)


def test_apply_refuses_duplicates_across_farms(tmp_path, capsys):
    path = _db(tmp_path / "db.sqlite3", [("d1", "f1", "CAGE-01"), ("d2", "f2", "cage-01")])
    assert main(["--database", str(path), "--apply"]) == 2
    assert "CAGE-01: 2 devices" in capsys.readouterr().out
    assert not _unique(path)
    assert list(tmp_path.glob("*.before-device-code-unique-*")) == []


def test_apply_backs_up_then_enforces_and_is_idempotent(tmp_path):
    path = _db(tmp_path / "db.sqlite3", [("d1", "f1", "CAGE-01"), ("d2", "f2", "CAGE-02")])
    assert main(["--database", str(path), "--apply"]) == 0
    assert _unique(path)
    backups = list(tmp_path.glob("db.before-device-code-unique-*.sqlite3"))
    assert len(backups) == 1 and not _unique(backups[0])
    with closing(sqlite3.connect(path)) as db, pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO devices VALUES ('d3', 'f3', 'CAGE-01')")
    assert main(["--database", str(path), "--apply"]) == 0  # already unique -> nothing to do


def test_requires_existing_absolute_path(tmp_path):
    with pytest.raises(SystemExit):
        main(["--database", "relative.sqlite3"])
