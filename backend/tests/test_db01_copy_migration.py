"""DB-01 uses disposable legacy SQLite fixtures, never the configured DB."""
from pathlib import Path
import sqlite3
import pytest
from scripts import db01_copy_migration as migration
from tests._platform import requires_symlinks


@pytest.fixture
def legacy(tmp_path, monkeypatch):
    source=tmp_path/'legacy.sqlite3'; media=tmp_path/'media';media.mkdir()
    (media/'kept.bin').write_bytes(b'original bytes, not an AI image')
    with sqlite3.connect(source) as c:
        c.execute('CREATE TABLE detections (detection_id TEXT PRIMARY KEY, image_path TEXT, normal_count INTEGER NOT NULL)')
        c.executemany('INSERT INTO detections VALUES (?,?,?)',[('one','kept.bin',3),('two',None,0)])
        c.execute('CREATE INDEX detection_count ON detections(normal_count)')
    monkeypatch.setattr(migration,'assert_stopped',lambda path: None)
    return source,media,tmp_path/'run'


def test_backup_exact_and_copy_migration_idempotent(legacy):
    source,media,out=legacy;initial=migration.sha(source)
    migration.make_backup(source,media,out)
    assert migration.sha(out/'backup/database.sqlite3')==initial
    report=migration.migrate_copy(out)
    assert set(report['added_columns'])==set(migration.COLUMNS)
    migrated=migration.sha(out/'working/database.sqlite3')
    assert migration.migrate_copy(out)['added_columns']==[]
    assert migration.sha(out/'working/database.sqlite3')==migrated
    assert migration.sha(source)==initial
    assert len(list(out.glob('migration-*.json')))==2


def test_existing_backup_is_not_overwritten(legacy):
    source,media,out=legacy;migration.make_backup(source,media,out)
    (out/'sentinel').write_text('keep')
    with pytest.raises(FileExistsError): migration.make_backup(source,media,out)
    assert (out/'sentinel').read_text()=='keep'


@requires_symlinks
def test_working_db_cannot_alias_source(legacy):
    source,media,out=legacy;migration.make_backup(source,media,out)
    (out/'working/database.sqlite3').unlink()
    (out/'working/database.sqlite3').symlink_to(source)
    with pytest.raises(ValueError,match='Unsafe'): migration.migrate_copy(out)


def test_changed_media_is_rejected(legacy):
    source,media,out=legacy;migration.make_backup(source,media,out)
    (out/'working/media/kept.bin').write_bytes(b'changed')
    with pytest.raises(ValueError,match='Media hash'): migration.migrate_copy(out)


def test_existing_rows_cannot_be_changed(legacy):
    source,media,out=legacy;migration.make_backup(source,media,out)
    with sqlite3.connect(out/'working/database.sqlite3') as c:
        c.execute('UPDATE detections SET normal_count=7')
    with pytest.raises(AssertionError,match='Old rows'): migration.migrate_copy(out)


def test_sidecar_prevents_backup(legacy):
    source,media,out=legacy;Path(str(source)+'-wal').write_bytes(b'pending')
    with pytest.raises(ValueError,match='sidecar'): migration.make_backup(source,media,out)
