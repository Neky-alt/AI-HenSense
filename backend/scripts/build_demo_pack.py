"""Build a local demo data pack (SQLite + media) from the Supabase demo data.

Runs on your own computer; the service-role key is read from the Backend env
file and never printed. The pack mirrors the selected cloud farms exactly:
same farm/device/detection UUIDs, so local and cloud stay aligned and the
logged-in owner passes authorized_db.

Dry run (default): reads the cloud, reports what would be imported, writes nothing.
    python -m scripts.build_demo_pack --farm-id <FARM_UUID> --out D:/HenSenseData/demo-v1

Apply: creates <out>/database.sqlite3, <out>/media/... and <out>/manifest.json.
    python -m scripts.build_demo_pack --farm-id <FARM_UUID> --out D:/HenSenseData/demo-v1 --apply

The output directory must not exist yet (never overwrites a dataset).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from contextlib import closing
from datetime import datetime, time, timezone
from pathlib import Path
from urllib.parse import quote
from uuid import UUID

BACKEND = Path(__file__).resolve().parents[1]
BUCKET = "detection-images"
PAGE = 1000

# Import order respects foreign keys. (table, cloud filter column, required?)
TABLES = [
    ("profiles", "user_id", False),
    ("farms", "farm_id", True),
    ("devices", "farm_id", True),
    ("monitoring_settings", "farm_id", False),
    ("notification_settings", "user_id", False),
    ("device_settings", "device_id", False),
    ("device_storage_settings", "device_id", False),
    ("detections", "device_id", False),
    ("alerts", "device_id", False),
]


class CloudError(RuntimeError):
    pass


class MissingTable(CloudError):
    pass


class SupabaseReader:
    """Minimal PostgREST/Storage reader using the server-side service key."""

    def __init__(self, url: str, service_key: str):
        import httpx

        if not url.startswith("https://") or not service_key:
            raise CloudError("SUPABASE_URL (https) and SUPABASE_KEY must be set in the env file")
        self.base = url.rstrip("/")
        self.http = httpx.Client(
            timeout=60,
            headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
        )

    def close(self):
        self.http.close()

    def rows(self, table: str, column: str, values: list[str]) -> list[dict]:
        if not values:
            return []
        out: list[dict] = []
        offset = 0
        while True:
            response = self.http.get(
                f"{self.base}/rest/v1/{table}",
                params={
                    "select": "*",
                    column: f"in.({','.join(values)})",
                    "limit": PAGE,
                    "offset": offset,
                },
            )
            if response.status_code == 404 or (
                response.status_code == 400 and "PGRST205" in response.text
            ):
                raise MissingTable(table)
            if response.status_code >= 400:
                # Never echo headers or the key; the status + table is enough.
                raise CloudError(f"Supabase HTTP {response.status_code} reading {table}")
            batch = response.json()
            out.extend(batch)
            if len(batch) < PAGE:
                return out
            offset += PAGE

    def download(self, key: str) -> bytes | None:
        response = self.http.get(f"{self.base}/storage/v1/object/{BUCKET}/{quote(key, safe='/')}")
        if response.status_code in (400, 404):
            return None
        if response.status_code >= 400:
            raise CloudError(f"Supabase Storage HTTP {response.status_code}")
        return response.content


# ------------------------------------------------------------------ conversion
def _to_datetime(value):
    if value is None or isinstance(value, datetime):
        return value
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)  # local stores naive UTC
    return parsed


def _to_time(value):
    if value is None or isinstance(value, time):
        return value
    return time.fromisoformat(str(value)[:8])


def convert_row(table, cloud_row: dict) -> tuple[dict, list[str]]:
    """Keep only columns the local schema has; convert types. Returns (row, ignored)."""
    from sqlalchemy import DateTime, Time

    local = {}
    for column in table.columns:
        if column.name not in cloud_row:
            continue
        value = cloud_row[column.name]
        if isinstance(column.type, DateTime):
            value = _to_datetime(value)
        elif isinstance(column.type, Time):
            value = _to_time(value)
        local[column.name] = value
    ignored = sorted(set(cloud_row) - {c.name for c in table.columns})
    return local, ignored


def _safe_key(key: str, prefix: str) -> bool:
    return (
        isinstance(key, str)
        and key.startswith(prefix)
        and ".." not in Path(key).parts
        and not Path(key).is_absolute()
    )


# ---------------------------------------------------------------------- core
def collect(reader, farm_ids: list[str]) -> tuple[dict[str, list[dict]], list[str]]:
    """Read every table for the selected farms. Returns (rows by table, warnings)."""
    data: dict[str, list[dict]] = {}
    warnings: list[str] = []

    farms = reader.rows("farms", "farm_id", farm_ids)
    missing = sorted(set(farm_ids) - {f["farm_id"] for f in farms})
    if missing:
        raise CloudError(f"Farm(s) not found in the cloud: {', '.join(missing)}")
    owners = sorted({f["user_id"] for f in farms})
    devices = reader.rows("devices", "farm_id", farm_ids)
    device_ids = [d["device_id"] for d in devices]
    keys = {"user_id": owners, "farm_id": farm_ids, "device_id": device_ids}

    for table, column, required in TABLES:
        if table == "farms":
            data[table] = farms
            continue
        if table == "devices":
            data[table] = devices
            continue
        try:
            data[table] = reader.rows(table, column, keys[column])
        except MissingTable:
            if required:
                raise
            warnings.append(f"cloud table '{table}' not found; skipped")
            data[table] = []

    # Every farm owner needs a local profile row (farms.user_id FK).
    have = {p["user_id"] for p in data["profiles"]}
    for owner in owners:
        if owner not in have:
            data["profiles"].append({"user_id": owner, "display_name": None})
            warnings.append(f"no cloud profile for owner {owner}; created a minimal local profile")
    return data, warnings


def build(reader, farm_ids: list[str], out: Path, *, apply: bool, skip_images: bool = False) -> dict:
    from sqlalchemy import create_engine, event, insert
    from sqlalchemy.exc import IntegrityError

    from app import models  # noqa: F401  (registers tables)
    from app.database import Base
    from app.models import utcnow
    from app.quick_models import QuickBase

    data, warnings = collect(reader, farm_ids)
    tables = {t.name: t for t in Base.metadata.sorted_tables}
    now = utcnow()

    farm_of_device = {d["device_id"]: d["farm_id"] for d in data["devices"]}
    prepared: dict[str, list[dict]] = {}
    ignored_columns: dict[str, list[str]] = {}
    media: list[tuple[str, str]] = []  # (cloud key, local relative path)

    for name, _, _ in TABLES:
        table = tables[name]
        rows = []
        for cloud_row in data[name]:
            row, ignored = convert_row(table, cloud_row)
            if ignored:
                ignored_columns[name] = sorted(set(ignored_columns.get(name, [])) | set(ignored))
            # Fill local-only NOT NULL bookkeeping columns.
            for column in ("created_at", "updated_at"):
                if column in table.c and row.get(column) is None:
                    row[column] = now
            if name in ("detections", "alerts"):
                row["sync_status"] = "synced"  # already in the cloud; Worker must not re-upload
            if name == "detections":
                # Only objects under this detection's own device prefix are trusted.
                prefix = f"farms/{farm_of_device.get(cloud_row.get('device_id'))}/devices/{cloud_row.get('device_id')}/"
                original = cloud_row.get("image_url")
                annotated = cloud_row.get("annotated_image_path")
                row["image_url"] = None  # local API builds image URLs from IDs
                row["image_path"] = None
                row["annotated_image_path"] = None
                if cloud_row.get("image_deleted_at") is None and cloud_row.get("deleted_at") is None:
                    for field, key in (("image_path", original), ("annotated_image_path", annotated)):
                        if key and _safe_key(key, prefix):
                            row[field] = key
                            media.append((key, key))
            rows.append(row)
        prepared[name] = rows

    report = {
        "mode": "APPLY" if apply else "DRY RUN",
        "farms": [{"farm_id": f["farm_id"], "user_id": f["user_id"], "farm_name": f.get("farm_name")} for f in data["farms"]],
        "devices": [
            {"device_id": d["device_id"], "device_code": d.get("device_code"), "device_name": d.get("device_name"),
             "farming_type": d.get("farming_type"), "is_active": d.get("is_active")}
            for d in data["devices"]
        ],
        "counts": {name: len(rows) for name, rows in prepared.items()},
        "images_referenced": len(media),
        "ignored_cloud_columns": ignored_columns,
        "warnings": warnings,
    }

    codes = [d.get("device_code", "").upper() for d in data["devices"]]
    duplicates = sorted({c for c in codes if codes.count(c) > 1})
    if duplicates:
        report["warnings"].append(f"duplicate device_code in selection (violates global uniqueness): {duplicates}")

    if not apply:
        return report

    out.mkdir(parents=True, exist_ok=False)
    media_dir = out / "media"
    media_dir.mkdir()
    database = out / "database.sqlite3"
    engine = create_engine(f"sqlite:///{database.as_posix()}")

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    try:
        Base.metadata.create_all(engine)
        QuickBase.metadata.create_all(engine)

        downloaded, missing_media = 0, []
        files: dict[str, str] = {}
        if not skip_images:
            for key, rel in media:
                content = reader.download(key)
                if content is None:
                    missing_media.append(key)
                    continue
                target = media_dir / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
                files[rel] = hashlib.sha256(content).hexdigest()
                downloaded += 1
        # Never point a record at a file we do not have (preflight would refuse it).
        for row in prepared["detections"]:
            for field in ("image_path", "annotated_image_path"):
                if row.get(field) and row[field] not in files:
                    row[field] = None

        try:
            with engine.begin() as connection:
                for name, _, _ in TABLES:
                    if prepared[name]:
                        connection.execute(insert(tables[name]), prepared[name])
        except IntegrityError as exc:
            raise CloudError(
                f"cloud data violates a local constraint ({type(exc.orig).__name__}: {exc.orig}). "
                f"Delete {out} and fix the cloud rows first."
            ) from None
    finally:
        engine.dispose()

    with closing(sqlite3.connect(database)) as db:
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise CloudError("integrity_check failed on the new database")
        if db.execute("PRAGMA foreign_key_check").fetchall():
            raise CloudError("foreign_key_check failed on the new database")

    from scripts.start_backend import preflight

    try:
        preflight({"DATABASE_URL": f"sqlite:///{database.resolve().as_posix()}", "LOCAL_IMAGE_DIR": str(media_dir.resolve())})
    except ValueError as exc:
        raise CloudError(f"Backend preflight rejected the new pack: {exc}") from None

    report.update(
        images_downloaded=downloaded,
        images_missing_in_cloud=missing_media,
        database=str(database.resolve()),
        media=str(media_dir.resolve()),
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        database_sha256=hashlib.sha256(database.read_bytes()).hexdigest(),
        media_sha256=files,
    )
    (out / "manifest.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--env-file", type=Path, default=BACKEND / ".env.runtime")
    parser.add_argument("--farm-id", action="append", required=True, help="Cloud farm UUID; repeat for several")
    parser.add_argument("--out", type=Path, required=True, help="New absolute directory for the pack")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--skip-images", action="store_true", help="Records only; image paths are left empty")
    args = parser.parse_args(argv)

    try:
        farm_ids = [str(UUID(value)) for value in args.farm_id]
    except ValueError:
        parser.error("--farm-id must be a UUID")
    if not args.out.is_absolute():
        parser.error("--out must be an absolute path")
    if args.out.exists():
        parser.error("--out already exists; choose a new directory (datasets are never overwritten)")

    from dotenv import dotenv_values

    values = dotenv_values(args.env_file.resolve(strict=True))
    reader = SupabaseReader(str(values.get("SUPABASE_URL") or ""), str(values.get("SUPABASE_KEY") or ""))
    try:
        report = build(reader, farm_ids, args.out, apply=args.apply, skip_images=args.skip_images)
    except CloudError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    finally:
        reader.close()

    printable = {k: v for k, v in report.items() if k != "media_sha256"}
    print(json.dumps(printable, indent=2, ensure_ascii=False))
    if args.apply:
        print("\nAdd these two lines to backend/.env.runtime:")
        print(f"DATABASE_URL=sqlite:///{Path(report['database']).as_posix()}")
        print(f"LOCAL_IMAGE_DIR={Path(report['media']).as_posix()}")
    else:
        print("\nDRY RUN: nothing was written. Re-run with --apply to build the pack.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
