"""Explicit one-off migration: make devices.device_code globally unique.

Team decision 2026-10-03 (docs/DEVICE_MANAGEMENT_API.md, R1). New databases get the
constraint from the model; existing SQLite files need this script because the
standard launcher never migrates.

Dry run (default, read-only):
    python -m scripts.migrate_device_code_unique --database D:/HenSenseData/database.sqlite3

Apply (backs up the database first, refuses if duplicates exist):
    python -m scripts.migrate_device_code_unique --database D:/HenSenseData/database.sqlite3 --apply

Stop the Backend and the Worker before --apply.
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

INDEX_NAME = "uq_devices_device_code"
CODE_PATTERN = re.compile(r"^[A-Z0-9-]{3,32}$")


def has_global_unique_index(db: sqlite3.Connection) -> bool:
    for _seq, name, unique, *_rest in db.execute("PRAGMA index_list(devices)"):
        if not unique:
            continue
        columns = [row[2] for row in db.execute(f'PRAGMA index_info("{name}")')]
        if columns == ["device_code"]:
            return True
    return False


def inspect(db: sqlite3.Connection) -> dict:
    if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='devices'").fetchone() is None:
        raise SystemExit("No devices table in this database; nothing to migrate.")
    duplicates = db.execute(
        "SELECT UPPER(device_code) AS code, COUNT(*), GROUP_CONCAT(device_id, ', ') "
        "FROM devices GROUP BY UPPER(device_code) HAVING COUNT(*) > 1 ORDER BY code"
    ).fetchall()
    nonstandard = [
        (device_id, code)
        for device_id, code in db.execute("SELECT device_id, device_code FROM devices")
        if not CODE_PATTERN.fullmatch(code or "")
    ]
    return {
        "devices": db.execute("SELECT COUNT(*) FROM devices").fetchone()[0],
        "duplicates": duplicates,
        "nonstandard": nonstandard,
        "already_unique": has_global_unique_index(db),
    }


def report(result: dict) -> None:
    print(f"devices: {result['devices']}")
    print(f"global unique index present: {result['already_unique']}")
    if result["duplicates"]:
        print("DUPLICATE device_code values (must be resolved by a person before --apply):")
        for code, count, ids in result["duplicates"]:
            print(f"  {code}: {count} devices -> {ids}")
    else:
        print("duplicates: none")
    if result["nonstandard"]:
        print("Codes not matching ^[A-Z0-9-]{3,32}$ (allowed to stay; new devices are validated):")
        for device_id, code in result["nonstandard"]:
            print(f"  {device_id}: {code!r}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--database", type=Path, required=True, help="Absolute path to the SQLite file")
    parser.add_argument("--apply", action="store_true", help="Back up, then create the unique index")
    args = parser.parse_args(argv)

    database = args.database
    if not database.is_absolute() or not database.is_file():
        parser.error("--database must be an existing absolute path")

    with closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)) as ro:
        result = inspect(ro)
    report(result)

    if result["already_unique"]:
        print("Nothing to do.")
        return 0
    if not args.apply:
        print("DRY RUN: no changes made. Re-run with --apply to create the index.")
        return 1 if result["duplicates"] else 0
    if result["duplicates"]:
        print("Refusing to apply while duplicates exist.")
        return 2

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = database.with_name(f"{database.stem}.before-device-code-unique-{stamp}{database.suffix}")
    with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(backup)) as target:
        source.backup(target)
    print(f"backup: {backup}")

    with closing(sqlite3.connect(database)) as db:
        db.execute(f"CREATE UNIQUE INDEX {INDEX_NAME} ON devices(device_code)")
        db.commit()
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            print("integrity_check failed; restore from the backup above.")
            return 3
        assert has_global_unique_index(db)
    print(f"APPLIED: {INDEX_NAME} created.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
