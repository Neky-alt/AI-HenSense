"""Offline smoke/regression tests: no Supabase credentials or network required."""
from pathlib import Path
import importlib.util
import sqlite3
import sys
import tempfile
import types
import unittest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

# These tests must run in the user's existing backend, which already contains
# app.services.cloud_sync from the accepted one-record sync step.
from app.services.cloud_sync import sync_one

# Loading the CLI imports app.config; run in installed backend with its deps.
spec = importlib.util.spec_from_file_location('be04_batch', BACKEND / 'scripts' / 'sync_pending_detections.py')
batch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch)

DID = '6ff020d6-93b2-440e-9874-1080afd29800'
DEV = '92000000-0000-0000-0000-000000000001'
FARM = '91000000-0000-0000-0000-000000000001'
OWNER = '011f1bfb-ac10-424b-b687-52baf06eddc1'

class FakeCloud:
    def __init__(self, fail_at=None):
        self.objects = {}
        self.rows = {}
        self.fail_at = fail_at

    def get_rows(self, table, key, value, select):
        if table == 'farms':
            return [{'farm_id': FARM, 'user_id': OWNER}]
        if table == 'devices':
            return [{'device_id': DEV, 'farm_id': FARM}]
        raise AssertionError(table)

    def upload(self, key, path):
        if self.fail_at == 'upload':
            raise RuntimeError('offline')
        self.objects[key] = path.read_bytes()

    def upsert_detection(self, payload):
        if self.fail_at == 'db':
            raise RuntimeError('offline')
        self.rows[payload['detection_id']] = payload

class BatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.media = root / 'media'
        self.media.mkdir()
        (self.media / 'original.jpg').write_bytes(b'JPEG bytes')
        (self.media / 'annotated.png').write_bytes(b'PNG bytes')
        self.db = root / 'sync_trial.db'
        self.conn = sqlite3.connect(self.db)
        self.addCleanup(self.conn.close)
        self.conn.executescript('''
        CREATE TABLE devices (device_id TEXT PRIMARY KEY, farm_id TEXT NOT NULL);
        CREATE TABLE detections (
          detection_id TEXT PRIMARY KEY, device_id TEXT, detected_at TEXT,
          trigger_type TEXT, capture_source_type TEXT, total_count INT,
          normal_count INT, low_count INT, normal_ratio REAL, low_ratio REAL,
          monitoring_status TEXT, confidence REAL, image_path TEXT,
          annotated_image_path TEXT, image_deleted_at TEXT, ai_instances TEXT,
          ai_response TEXT, provenance TEXT, deleted_at TEXT, created_at TEXT,
          sync_status TEXT
        );
        ''')
        self.conn.execute('INSERT INTO devices VALUES (?, ?)', (DEV, FARM))
        self.conn.execute('''INSERT INTO detections VALUES
          (?, ?, '2026-09-24T02:00:00', 'manual', 'file_upload',
           1, 1, 0, 1.0, 0.0, 'normal', NULL,
           'original.jpg', 'annotated.png', NULL,
           '[]', '{}', '{}', NULL, '2026-09-24T02:00:00', 'pending')''', (DID, DEV))
        self.conn.commit()
        self.args = types.SimpleNamespace(apply=True, limit=1, media_dir=self.media,
                                          owner_user_id=OWNER, max_backoff_seconds=3600)

    def test_success_two_objects_one_row_local_synced(self):
        cloud = FakeCloud()
        rows = batch.process_batch(self.conn, cloud, self.args)
        self.assertEqual(rows[0]['status'], 'APPLIED')
        self.assertEqual(len(cloud.objects), 2)
        self.assertEqual(len(cloud.rows), 1)
        self.assertEqual(self.conn.execute('SELECT sync_status FROM detections').fetchone()[0], 'synced')
        self.assertEqual(batch.process_batch(self.conn, cloud, self.args), [])

    def test_partial_failure_retry_upsert_idempotent(self):
        cloud = FakeCloud('db')
        rows = batch.process_batch(self.conn, cloud, self.args)
        self.assertEqual(rows[0]['status'], 'FAILED')
        self.assertEqual(self.conn.execute('SELECT sync_status FROM detections').fetchone()[0], 'failed')
        self.assertEqual(len(cloud.objects), 2)
        self.assertEqual(len(cloud.rows), 0)
        # Force retry eligibility, simulating time after exponential backoff.
        self.conn.execute("UPDATE be04_sync_attempts SET next_retry_at='2000-01-01T00:00:00Z'")
        self.conn.commit()
        cloud.fail_at = None
        rows = batch.process_batch(self.conn, cloud, self.args)
        self.assertEqual(rows[0]['status'], 'APPLIED')
        self.assertEqual(len(cloud.objects), 2)
        self.assertEqual(len(cloud.rows), 1)
        self.assertEqual(self.conn.execute('SELECT sync_status FROM detections').fetchone()[0], 'synced')

    def test_dry_run_does_not_mutate_db_or_cloud(self):
        self.args.apply = False
        cloud = FakeCloud()
        results = batch.process_batch(self.conn, cloud, self.args)
        self.assertEqual(results[0]['status'], 'DRY RUN')
        self.assertEqual(len(cloud.objects), 0)
        self.assertEqual(len(cloud.rows), 0)
        self.assertIsNone(self.conn.execute("SELECT 1 FROM sqlite_master WHERE name='be04_sync_attempts'").fetchone())
        self.assertEqual(self.conn.execute('SELECT sync_status FROM detections').fetchone()[0], 'pending')

    def test_invalid_media_failure_does_not_mark_synced(self):
        self.conn.execute("UPDATE detections SET image_path='../outside.jpg'")
        self.conn.commit()
        rows = batch.process_batch(self.conn, FakeCloud(), self.args)
        self.assertEqual(rows[0]['status'], 'FAILED')
        self.assertEqual(self.conn.execute('SELECT sync_status FROM detections').fetchone()[0], 'failed')
        self.assertEqual(self.conn.execute('SELECT attempts FROM be04_sync_attempts').fetchone()[0], 1)

if __name__ == '__main__':
    unittest.main()
