"""Real AI-only batch runner. New isolated directory by default; --resume skips committed rows.

Run from backend: .venv/bin/python -m scripts.run_field_validation --help
No app imports before validated output isolation/environment configuration.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from uuid import uuid4

BACKEND = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate_manifest(path, source):
    from PIL import Image
    rows = list(csv.DictReader(path.open(encoding="utf-8")))
    if not rows:
        raise ValueError("Empty manifest")
    with sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True) as db:
        devices = {r[0]: r[1:] for r in db.execute("SELECT device_id, device_code, farming_type, is_active FROM devices")}
    seen = set()
    sequences = set()
    for row in rows:
        if row["sequence"] in sequences:
            raise ValueError("Duplicate sequence")
        sequences.add(row["sequence"])
        image = (path.parent / row["image_path"]).resolve()
        if not image.is_relative_to(path.parent) or not image.is_file():
            raise ValueError("Image outside manifest directory or missing")
        if image in seen:
            raise ValueError("Duplicate image in manifest")
        seen.add(image)
        if row["mapping_status"] != "confirmed" or row["trigger_type"] != "manual" or row["capture_source_type"] != "file_upload":
            raise ValueError("Manifest must be confirmed, manual and file_upload")
        if devices.get(row["device_id"]) != (row["device_code"], row["farming_type"], 1):
            raise ValueError("Manifest/device mismatch")
        if sha(image) != row["original_sha256"]:
            raise ValueError(f"Input changed: {image}")
        with Image.open(image) as im:
            im.verify()
        with Image.open(image) as im:
            im.load()
            expected_format = "PNG" if image.suffix.lower() == ".png" else "JPEG"
            if im.format != expected_format or im.format != row["format"] or im.getexif().get(274, 1) != 1:
                raise ValueError("Unsupported image format/orientation")
            if im.size != (int(row["width"]), int(row["height"])):
                raise ValueError("Image dimensions changed")
    return rows


def isolated_output(output, source):
    output = output.resolve()
    # A new directory is required, never the configured production directory.
    forbidden = [source.resolve(), BACKEND / "hen_monitoring.db"]
    if any(p.is_relative_to(output) or output == p for p in forbidden):
        raise ValueError("Output would contain the source/production database")
    if output == BACKEND / "local_storage" or output.is_relative_to(BACKEND / "local_storage" / "detection_images"):
        raise ValueError("Output overlaps production media")
    return output


def copy_configuration(source, target):
    """Copy configuration only using read-only SQLite, never historical results."""
    tables = ["profiles", "farms", "devices", "monitoring_settings", "device_settings", "device_storage_settings"]
    with sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True) as src, sqlite3.connect(target) as dst:
        dst.execute("PRAGMA foreign_keys=ON")
        for table in tables:
            if not src.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                continue
            columns = [r[1] for r in src.execute(f'PRAGMA table_info("{table}")')]
            target_columns = {r[1] for r in dst.execute(f'PRAGMA table_info("{table}")')}
            columns = [c for c in columns if c in target_columns]
            quoted = ','.join(f'"{c}"' for c in columns)
            values = src.execute(f'SELECT {quoted} FROM "{table}"').fetchall()
            dst.executemany(f'INSERT INTO "{table}" ({quoted}) VALUES ({",".join("?" for _ in columns)})', values)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=BACKEND / "test_assets/field_validation/manifest.csv")
    parser.add_argument("--source-db", type=Path, default=BACKEND / "hen_monitoring.db")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--ai-url", default="http://127.0.0.1:8004")
    parser.add_argument("--ai-root", type=Path, default=BACKEND.parent / "ai_service/hen_repro")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    manifest, source = args.manifest.resolve(), args.source_db.resolve()
    source_hash = sha(source)
    rows = validate_manifest(manifest, source)
    output = isolated_output(args.output_dir, source)
    if args.resume:
        metadata = json.loads((output / "run.json").read_text())
        if metadata["manifest_sha256"] != sha(manifest) or metadata["ai_url"] != args.ai_url:
            raise ValueError("Resume must use original manifest and AI URL")
        if not (output / "validation.db").is_file() or (output / "validation.db").resolve() == source:
            raise ValueError("Invalid resume database")
    else:
        output.mkdir(parents=True, exist_ok=False)
        metadata = {"run_id": str(uuid4()), "manifest_sha256": sha(manifest), "source_db_sha256": source_hash, "ai_url": args.ai_url}
    # Prevent concurrent resumes and reject symlink escapes into other databases/media.
    import fcntl
    lock = (output / ".run.lock").open("a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    for name in ("validation.db", "media", "responses", "run.json", "results.json", "results.csv"):
        if (output / name).is_symlink():
            raise ValueError("Output entries must not be symlinks")
    # Set isolation before importing ANY app module (including database/models).
    os.environ["DATABASE_URL"] = f"sqlite:///{output / 'validation.db'}"
    os.environ["LOCAL_IMAGE_DIR"] = str(output / "media")
    os.environ["AI_SERVICE_URL"] = args.ai_url
    import httpx
    from sqlalchemy import select
    from app.database import init_db, SessionLocal
    from app.enums import CaptureSourceType
    from app.models import Detection, Device
    from app.services.ai_adapter import AIServiceAdapter
    from app.services.capture_adapter import TestFileCaptureAdapter
    from app.services.core_data import serialize_detection
    from app.services.inference_media import persist_inference_media

    health = httpx.get(args.ai_url + "/health", timeout=30).raise_for_status().json()
    if health.get("status") != "ok":
        raise ValueError("Real AI service not ready")
    identity = {"health": health, "local_artifact_sha256": {}}
    for path in [args.ai_root / "api_server.py", *sorted((args.ai_root / "models").glob("*.py"))]:
        identity["local_artifact_sha256"][str(path.relative_to(args.ai_root))] = sha(path)
    for config in health["modes"].values():
        for key in ("det_weights", "cls_ckpt"):
            path = Path(config[key]); path = path if path.is_absolute() else args.ai_root / path
            identity["local_artifact_sha256"][str(path)] = sha(path)
    if args.resume and metadata["ai_identity"] != identity:
        raise ValueError("AI identity changed; use a new run directory")
    metadata["ai_identity"] = identity
    (output / "run.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False))
    init_db()
    if not args.resume:
        copy_configuration(source, output / "validation.db")
        (output / "manifest.csv").write_bytes(manifest.read_bytes())
    (output / "responses").mkdir(exist_ok=True)
    adapter = AIServiceAdapter(args.ai_url, timeout_seconds=300)
    reports = []
    with SessionLocal() as db:
        existing = {d.provenance.get("sequence"): d for d in db.scalars(select(Detection)).all()
                    if d.provenance and d.provenance.get("run_id") == metadata["run_id"]}
        for row in rows:
            report = {"sequence": row["sequence"], "image_path": row["image_path"], "device_code": row["device_code"], "original_sha256": row["original_sha256"]}
            try:
                detection = existing.get(row["sequence"])
                if detection is None:
                    device = db.get(Device, row["device_id"])
                    frame = TestFileCaptureAdapter(manifest.parent / row["image_path"]).capture(device)
                    # Verify the exact bytes about to be sent, not only the preflight file.
                    if hashlib.sha256(frame.content).hexdigest() != row["original_sha256"]:
                        raise ValueError("Input changed after preflight")
                    result = adapter.infer(device, frame)  # ALWAYS real HTTP inference, no fallback.
                    response_file = output / "responses" / f"{row['sequence']}-{uuid4().hex}.json"
                    response_file.write_text(json.dumps(result.raw_response, ensure_ascii=False, indent=2))
                    detection = persist_inference_media(db, device, frame, result, source=CaptureSourceType.file_upload,
                        provenance={"run_id": metadata["run_id"], "sequence": row["sequence"], "manifest_sha256": metadata["manifest_sha256"],
                                    "ai_identity": identity, "ai_service_url": args.ai_url, "raw_response_file": str(response_file),
                                    "input_relative_path": row["image_path"]})
                    state = "success"
                else:
                    for relative in (detection.image_path, detection.annotated_image_path):
                        if not relative or not (output / "media" / relative).resolve().is_relative_to(output / "media") or not (output / "media" / relative).is_file():
                            raise ValueError("Completed record has missing/invalid media; not reinserting it")
                    if sha(output / "media" / detection.image_path) != row["original_sha256"]:
                        raise ValueError("Completed original hash mismatch")
                    state = "already_completed"
                report.update(status=state, detection_id=detection.detection_id, normal_count=detection.normal_count,
                              low_count=detection.low_count, total_count=detection.total_count, monitoring_status=detection.monitoring_status,
                              original_path=str(output / "media" / detection.image_path),
                              annotated_path=str(output / "media" / detection.annotated_image_path),
                              image_url=detection.image_url, annotated_image_url=serialize_detection(detection)["annotated_image_url"])
            except Exception as exc:
                db.rollback()
                report.update(status="failed", error=f"{type(exc).__name__}: {exc}")
            reports.append(report)
            print(json.dumps(report, ensure_ascii=False), flush=True)
            (output / "results.json").write_text(json.dumps(reports, ensure_ascii=False, indent=2))
    assert sha(source) == source_hash, "Source database changed during run"
    columns = list(dict.fromkeys(k for r in reports for k in r))
    with (output / "results.csv").open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns); writer.writeheader(); writer.writerows(reports)
    if any(r["status"] == "failed" for r in reports):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
