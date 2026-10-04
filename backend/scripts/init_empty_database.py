"""Create a brand-new, empty HenSense SQLite database + media folder (any OS).

Same steps as docs/DEPLOYMENT.md §3.1, without the Mac-only shell syntax:

    python -m scripts.init_empty_database --data-dir D:/HenSenseData/installation-v1

Refuses to touch an existing directory. Seeds nothing: no Profile, Farm or Device.
Never use this on an accepted/demo database; it only creates new files.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import create_engine


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", type=Path, required=True, help="New absolute directory to create")
    args = parser.parse_args(argv)

    data_dir = args.data_dir
    if not data_dir.is_absolute():
        parser.error("--data-dir must be an absolute path")
    if data_dir.exists():
        parser.error(f"{data_dir} already exists; refusing to touch it")

    from app.database import Base
    from app import models  # noqa: F401  (registers tables)
    from app.quick_models import QuickBase

    data_dir.mkdir(parents=True)
    (data_dir / "media").mkdir()
    database = data_dir / "database.sqlite3"
    with database.open("xb"):
        pass

    engine = create_engine(f"sqlite:///{database.as_posix()}")
    try:
        Base.metadata.create_all(engine)
        QuickBase.metadata.create_all(engine)
        with engine.connect() as db:
            assert db.exec_driver_sql("PRAGMA integrity_check").scalar() == "ok"
    finally:
        engine.dispose()

    print("Empty schema created. No Farm, Device or Detection was seeded.")
    print(f"DATABASE_URL=sqlite:///{database.as_posix()}")
    print(f"LOCAL_IMAGE_DIR={(data_dir / 'media').as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
