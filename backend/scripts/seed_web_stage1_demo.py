"""Create DEMO data in a NEW directory only; never use the configured database.

Run from backend/: python -m scripts.seed_web_stage1_demo --output-dir /tmp/hensense-web-demo
Existing directories are refused, even if empty. Use a new directory to repeat.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import struct
from uuid import NAMESPACE_URL, uuid5
import zlib

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Detection, Device, Farm, Profile


def demo_id(name: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"hensense-web-stage1-demo/{name}"))


def demo_png() -> bytes:
    """Dependency-free PNG labelled DEMO, deliberately not a fake hen photo."""
    letters = [
        ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
        ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
        ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
        ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    ]
    width, height, scale = 128, 64, 4
    pixels = bytearray(bytes([240, 245, 242]) * width * height)
    for letter, rows in enumerate(letters):
        for y, row in enumerate(rows):
            for x, bit in enumerate(row):
                if bit != "1":
                    continue
                for dy in range(scale):
                    for dx in range(scale):
                        offset = ((18 + y * scale + dy) * width + 16 + (letter * 6 + x) * scale + dx) * 3
                        pixels[offset:offset + 3] = bytes([180, 40, 40])
    raw = b"".join(b"\x00" + pixels[y * width * 3:(y + 1) * width * 3] for y in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def create_demo(output_dir: Path, now: datetime | None = None) -> dict:
    root = output_dir.expanduser().resolve()
    # This is the only creation entry point: no reset, overwrite, or default DB path.
    root.mkdir(parents=True, exist_ok=False)
    media = root / "media"
    media.mkdir()
    (media / "demo.png").write_bytes(demo_png())
    database = root / "demo.sqlite3"
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).replace(tzinfo=None)
    engine = create_engine(f"sqlite:///{database}")
    manifest = {"demo_only": True, "created_at_utc": now.isoformat() + "Z",
                "database": str(database), "media": str(media), "devices": {}, "detections": {}}
    try:
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            user_id, farm_id = demo_id("user"), demo_id("farm")
            db.add(Profile(user_id=user_id, display_name="DEMO ONLY"))
            db.add(Farm(farm_id=farm_id, user_id=user_id, farm_name="DEMO ONLY — Web Stage 1", timezone="Australia/Sydney"))
            db.flush()

            def device(code: str, farming_type: str, online: bool) -> Device:
                row = Device(device_id=demo_id(code), farm_id=farm_id, device_code=code,
                             device_name=f"DEMO ONLY {code}", farming_type=farming_type,
                             last_seen_at=now if online else None)
                db.add(row)
                db.flush()
                manifest["devices"][code] = row.device_id
                return row

            def result(owner: Device, key: str, minutes: int, normal: int, low: int,
                       status: str, trigger: str = "scheduled", image: bool = True) -> None:
                total = normal + low
                rid = demo_id(key)
                db.add(Detection(
                    detection_id=rid, device_id=owner.device_id,
                    detected_at=now - timedelta(minutes=minutes), trigger_type=trigger,
                    capture_source_type="pi_camera", normal_count=normal, low_count=low,
                    total_count=total, normal_ratio=normal / total if total else None,
                    low_ratio=low / total if total else None, monitoring_status=status,
                    image_path="demo.png" if image else None,
                    image_url=f"/api/v1/devices/{owner.device_id}/detections/{rid}/image" if image else None,
                    confidence=None,
                ))
                manifest["detections"][key] = rid

            cage_online = device("DEMO-CAGE-ONLINE", "caged", True)
            result(cage_online, "cage-online-normal", 3, 8, 2, "normal")
            cage_warning = device("DEMO-CAGE-OFFLINE-WARNING", "caged", False)
            result(cage_warning, "cage-warning-first-no-image", 40, 3, 7, "normal", image=False)
            result(cage_warning, "cage-offline-warning", 35, 2, 8, "warning")
            cage_normal = device("DEMO-CAGE-OFFLINE-NORMAL", "caged", False)
            result(cage_normal, "cage-offline-normal", 35, 8, 2, "normal")
            device("DEMO-CAGE-EMPTY", "caged", False)
            for online in (True, False):
                name = "free-online" if online else "free-offline"
                free = device(f"DEMO-{name.upper()}", "free_range", online)
                result(free, f"{name}-first-snapshot", 50, 6, 4, "normal", "free_range_snapshot", False)
                result(free, f"{name}-formal", 40, 6, 4, "warning", "free_range_snapshot")
                result(free, f"{name}-manual-no-image", 10, 0, 1, "normal", "manual", False)
                result(free, f"{name}-manual", 1, 1, 0, "normal", "manual")
            free_manual = device("DEMO-FREE-MANUAL-ONLY", "free_range", True)
            result(free_manual, "free-manual-only", 1, 0, 1, "normal", "manual")
            db.commit()
        (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        (root / "README.txt").write_text(
            "DEMO ONLY. Synthetic counts and labelled test image, not AI inference.\n"
            "Start the unchanged Backend from backend/ with these environment variables:\n"
            f"DATABASE_URL=sqlite:///{database}\nLOCAL_IMAGE_DIR={media}\n"
            "Use a separate port, e.g. 8011. Do not change your existing .env.\n"
            "Online fixtures age to Offline using the existing heartbeat timeout.\n"
            "Generate a NEW directory to repeat; existing directories are never overwritten.\n"
        )
    finally:
        engine.dispose()
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path, help="New directory for DEMO SQLite and media")
    args = parser.parse_args()
    try:
        manifest = create_demo(args.output_dir)
    except FileExistsError:
        parser.error("Output directory already exists; choose a NEW directory. Nothing was overwritten.")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
