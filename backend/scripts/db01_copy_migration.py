"""DB-01: timestamped backup, copy-only migration and preservation verification.

No app imports; never consult DATABASE_URL or modify the source database.
Requires a stopped source in DELETE journal mode with no WAL/journal sidecar.
"""
from __future__ import annotations
import argparse
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess

COLUMNS = {"annotated_image_path": "TEXT", "ai_instances": "JSON", "ai_response": "JSON", "provenance": "JSON"}


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()


def ro(path):
    c = sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)
    c.execute('PRAGMA query_only=ON')
    return c


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def table_names(c):
    return [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]


def audit(path, media):
    with closing(ro(path)) as c:
        tables = table_names(c)
        schema = {t: [list(r) for r in c.execute(f'PRAGMA table_info({quote(t)})')] for t in tables}
        records = []
        cols = {r[1] for r in schema.get('detections', [])}
        if 'image_path' in cols:
            for did, image in c.execute('SELECT detection_id,image_path FROM detections ORDER BY detection_id'):
                candidate = (media / image).resolve() if image else None
                valid = candidate and not Path(image).is_absolute() and candidate.is_relative_to(media)
                records.append({'detection_id': did, 'image_path': image,
                                'state': 'no_path' if not image else ('present' if valid and candidate.is_file() else 'missing_or_unsafe')})
        return {'sha256': sha(path), 'integrity_check': list(c.execute('PRAGMA integrity_check')),
                'foreign_key_check': list(c.execute('PRAGMA foreign_key_check')), 'schema': schema,
                'counts': {t: c.execute(f'SELECT count(*) FROM {quote(t)}').fetchone()[0] for t in tables},
                'images': records}


def media_hashes(root):
    result = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink(): raise ValueError(f'Media symlink not permitted: {path}')
        if path.is_file(): result[path.relative_to(root).as_posix()] = {'sha256': sha(path), 'bytes': path.stat().st_size}
    return result


def assert_stopped(path):
    # Check before opening our own read-only connection. No output may be truncated.
    result = subprocess.run(['lsof', '-t', str(path)], capture_output=True, text=True)
    if result.returncode not in (0, 1) or result.stderr.strip():
        raise RuntimeError('Cannot establish database process status: ' + result.stderr)
    if result.stdout.strip(): raise RuntimeError('Database still open by PIDs: ' + result.stdout.strip())


def make_backup(source, media, output):
    source, media, output = source.resolve(), media.resolve(), output.resolve()
    if not source.is_file() or not media.is_dir(): raise ValueError('Source DB/media must exist')
    if output.is_relative_to(media) or media.is_relative_to(output) or source.is_relative_to(output):
        raise ValueError('Output must not overlap source database or media')
    assert_stopped(source)
    for suffix in ('-wal', '-shm', '-journal'):
        if Path(str(source) + suffix).exists(): raise ValueError('Source sidecar exists; stop and investigate, no automatic checkpoint')
    output.mkdir(parents=True, exist_ok=False)
    with closing(ro(source)) as c:
        c.execute('BEGIN')
        c.execute('SELECT count(*) FROM sqlite_master').fetchone()  # Hold read lock while copying.
        if c.execute('PRAGMA journal_mode').fetchone()[0] != 'delete': raise ValueError('Requires stopped DELETE-journal source')
        before = audit(source, media)
        if before['integrity_check'] != [('ok',)] or before['foreign_key_check']:
            raise ValueError('Source integrity/foreign-key check failed')
        hashes = media_hashes(media)
        backup = output / 'backup'; backup.mkdir()
        shutil.copy2(source, backup / 'database.sqlite3')
        shutil.copytree(media, backup / 'media')
        if sha(source) != before['sha256'] or sha(backup / 'database.sqlite3') != before['sha256']:
            raise RuntimeError('Source changed while backing up')
        if media_hashes(media) != hashes or media_hashes(backup / 'media') != hashes:
            raise RuntimeError('Media changed while backing up')
        c.rollback()
    manifest = {'created_at_utc': datetime.now(timezone.utc).isoformat(), 'source_database': str(source),
                'source_media': str(media), 'before': before, 'media_files': hashes,
                'unreferenced_media': sorted(set(hashes) - {r['image_path'] for r in before['images'] if r['state'] == 'present'})}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    working = output / 'working'; working.mkdir()
    shutil.copy2(backup / 'database.sqlite3', working / 'database.sqlite3')
    shutil.copytree(backup / 'media', working / 'media')
    return manifest


def verified_paths(output):
    output = output.resolve()
    manifest = json.loads((output / 'manifest.json').read_text())
    source = Path(manifest['source_database'])
    backup, target = output / 'backup/database.sqlite3', output / 'working/database.sqlite3'
    # This CLI cannot target an arbitrary/in-place DB, symlink or hardlinked source.
    for path in (backup, target):
        if path.is_symlink() or path.resolve() != path or not path.is_file() or path.samefile(source):
            raise ValueError('Unsafe backup/working database')
    if target.samefile(backup): raise ValueError('Working DB must be independent of backup')
    if sha(source) != manifest['before']['sha256'] or sha(backup) != manifest['before']['sha256']:
        raise ValueError('Source or backup no longer matches manifest')
    for name in ('backup', 'working'):
        if media_hashes(output / name / 'media') != manifest['media_files']:
            raise ValueError('Media hash mismatch: ' + name)
    if media_hashes(Path(manifest['source_media'])) != manifest['media_files']:
        raise ValueError('Source media changed')
    return manifest, backup, target


def compare_original(backup, target, *, require_new):
    with closing(ro(backup)) as a, closing(ro(target)) as b:
        assert table_names(a) == table_names(b), 'Table set changed'
        for table in table_names(a):
            original_schema = list(a.execute(f'PRAGMA table_info({quote(table)})'))
            new_schema = list(b.execute(f'PRAGMA table_info({quote(table)})'))
            assert new_schema[:len(original_schema)] == original_schema, f'Old columns changed: {table}'
            expected_extra = set(COLUMNS) - {r[1] for r in original_schema} if table == 'detections' and require_new else set()
            assert {r[1] for r in new_schema[len(original_schema):]} == expected_extra, f'Unexpected columns: {table}'
            cols = ','.join(quote(r[1]) for r in original_schema)
            assert Counter(a.execute(f'SELECT {cols} FROM {quote(table)}')) == Counter(b.execute(f'SELECT {cols} FROM {quote(table)}')), f'Old rows changed: {table}'
        # Indexes, triggers and views must not be changed by an additive migration.
        sql = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type != 'table' ORDER BY type,name"
        assert a.execute(sql).fetchall() == b.execute(sql).fetchall()
        if require_new:
            info = {r[1]: r for r in b.execute('PRAGMA table_info(detections)')}
            for name, kind in COLUMNS.items():
                assert info[name][2].upper() == kind and info[name][3] == 0 and info[name][4] is None
                assert b.execute(f'SELECT count(*) FROM detections WHERE {name} IS NOT NULL').fetchone()[0] == 0
        assert b.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
        assert b.execute('PRAGMA foreign_key_check').fetchall() == []


def migrate_copy(output):
    manifest, backup, target = verified_paths(output)
    assert_stopped(target)
    with closing(ro(target)) as c:
        current = {r[1] for r in c.execute('PRAGMA table_info(detections)')}
    # Only accept an exact original or a previously validated migration, not arbitrary data.
    compare_original(backup, target, require_new=set(COLUMNS).issubset(current))
    added = []
    with closing(sqlite3.connect(target)) as c:
        try:
            c.execute('BEGIN IMMEDIATE')
            for name, kind in COLUMNS.items():
                if name not in current:
                    c.execute(f'ALTER TABLE detections ADD COLUMN {name} {kind}')
                    added.append(name)
            c.commit()
        except Exception:
            c.rollback(); raise
    compare_original(backup, target, require_new=True)
    verified_paths(output)
    report = {'added_columns': added, 'database': str(target), 'sha256': sha(target),
              'original_values_preserved': True, 'old_records_new_fields_null': True,
              'media_hashes_preserved': True, 'integrity_check': 'ok'}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    with (output / f'migration-{stamp}.json').open('x') as f: json.dump(report, f, indent=2)
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='action',required=True)
    p=sub.add_parser('backup');p.add_argument('--source-db',type=Path,required=True);p.add_argument('--source-media',type=Path,required=True);p.add_argument('--output-parent',type=Path,required=True)
    for name in ('migrate','verify'):
        p=sub.add_parser(name);p.add_argument('--run-dir',type=Path,required=True)
    args=parser.parse_args()
    if args.action=='backup':
        out=args.output_parent / datetime.now(timezone.utc).strftime('db01-%Y%m%dT%H%M%S%fZ')
        m=make_backup(args.source_db,args.source_media,out)
        print(json.dumps({'run_dir':str(out.resolve()),'source_sha256':m['before']['sha256'],'counts':m['before']['counts'],'media_count':len(m['media_files'])},indent=2))
    elif args.action=='migrate': print(json.dumps(migrate_copy(args.run_dir),indent=2))
    else:
        _,backup,target=verified_paths(args.run_dir);compare_original(backup,target,require_new=True)
        print(json.dumps({'verified':True,'target_sha256':sha(target),'source_backup_rows_media_preserved':True}))


if __name__=='__main__': main()
