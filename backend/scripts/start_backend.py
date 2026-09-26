"""Canonical runtime entry: explicit existing SQLite + media, never schema writes."""
from __future__ import annotations
import argparse
import json
import os
import sqlite3
from pathlib import Path
from dotenv import dotenv_values
from sqlalchemy.engine import make_url

BACKEND = Path(__file__).resolve().parents[1]


def configure(env_file: Path) -> dict[str, str]:
    env_file = env_file.resolve(strict=True)
    values = {**dotenv_values(env_file), **os.environ}
    required = ('DATABASE_URL', 'LOCAL_IMAGE_DIR', 'AI_SERVICE_URL', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY')
    for key in required:
        if not str(values.get(key) or '').strip():
            raise ValueError(f'{key} must be explicitly configured')
    if str(values.get('ENABLE_INFERENCE_MEDIA_MIGRATION', 'false')).lower() not in ('false', '0'):
        raise ValueError('Runtime migration is forbidden; use a reviewed explicit migration separately')
    for key, value in values.items():
        if value is not None:
            os.environ[key] = str(value)
    os.environ['HENSENSE_ENV_FILE'] = str(env_file)
    return values


def preflight(values: dict[str, str], tables=None) -> dict:
    url = make_url(values['DATABASE_URL'])
    if url.drivername != 'sqlite' or not url.database or url.query:
        raise ValueError('Use a plain sqlite:////absolute/path/database.sqlite3 URL')
    database = Path(url.database)
    media = Path(values['LOCAL_IMAGE_DIR'])
    if not database.is_absolute() or not database.is_file():
        raise ValueError('DATABASE_URL must point to an existing absolute SQLite path')
    if not media.is_absolute() or not media.is_dir():
        raise ValueError('LOCAL_IMAGE_DIR must point to an existing absolute directory')
    if tables is None:
        from app.database import Base
        from app import models, quick_models  # noqa: F401
        tables = {t.name: {c.name for c in t.columns}
                  for metadata in (Base.metadata, quick_models.QuickBase.metadata)
                  for t in metadata.sorted_tables}
    with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('SQLite integrity check failed')
        for table, required in tables.items():
            columns = {r[1] for r in db.execute(f'PRAGMA table_info("{table}")')}
            missing = required - columns
            if missing:
                raise ValueError(f'Incompatible schema: {table} missing {sorted(missing)}; no changes applied')
        missing_media = 0
        for table in ('detections', 'quick_detections'):
            if table not in tables:
                continue
            fields = 'image_path, annotated_image_path' + (', original_upload_path' if table == 'quick_detections' else '')
            for row in db.execute(f'SELECT {fields} FROM "{table}"'):
                for name in row:
                    if name:
                        path = (media / name).resolve()
                        if not path.is_relative_to(media.resolve()):
                            raise ValueError('Media reference escapes LOCAL_IMAGE_DIR')
                        missing_media += not path.is_file()
        if missing_media:
            raise ValueError(f'{missing_media} referenced media files missing; verify the matching media directory')
    return {'database': str(database.resolve()), 'media': str(media.resolve()), 'schema': 'compatible', 'migration': 'disabled'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', type=Path, default=BACKEND / '.env.runtime')
    parser.add_argument('--check', action='store_true', help='Read-only configuration/schema/media preflight; no server')
    args = parser.parse_args()
    try:
        values = configure(args.env_file)
        result = preflight(values)
        port = int(values.get('BACKEND_PORT', '8006'))
        if not 1 <= port <= 65535:
            raise ValueError('BACKEND_PORT out of range')
    except (ValueError, OSError, sqlite3.Error) as error:
        parser.exit(2, f'Startup refused: {error}\n')
    print(json.dumps(result), flush=True)
    if not args.check:
        import uvicorn
        uvicorn.run('app.main:app', host=values.get('BACKEND_HOST', '0.0.0.0'), port=port,
                    reload=False, lifespan='off')


if __name__ == '__main__':
    main()
