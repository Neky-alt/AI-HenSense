"""Offline isolation tests. Execute from backend/ after installing trial helper."""
import hashlib
import sqlite3
import tempfile
import unittest
from pathlib import Path
from importlib.util import spec_from_file_location,module_from_spec

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts' / 'be04_isolated_trial.py'
spec = spec_from_file_location('be04_isolated_trial',SCRIPT)
trial = module_from_spec(spec)
spec.loader.exec_module(trial)

# Reuse the currently installed worker fake test fixture so schema follows the
# same test contract already used by the user's BE04 release.
from tests.test_be04_worker import WorkerTests, FakeCloud, OWNER
from app.services.be04_worker import Worker

class IsolationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = WorkerTests('test_dry_run_read_only_and_real_sync')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        # Windows keeps SQLite files locked until every handle is closed; never fail on cleanup.
        self.tmp=tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.tmp.cleanup)
        self.base=Path(self.tmp.name)
        self.src=self.base/'source.sqlite'
        target=sqlite3.connect(self.src)
        self.fixture.conn.backup(target)
        target.close()
        with sqlite3.connect(self.src) as conn:
            # Add source profile table absent from worker fake's minimal schema.
            conn.execute('CREATE TABLE profiles (user_id TEXT PRIMARY KEY, display_name TEXT, created_at TEXT, updated_at TEXT)')
            conn.execute('INSERT INTO profiles VALUES (?,?,?,?)',('90000000-0000-0000-0000-000000000001','Demo','2026-09-24T01:00:00Z','2026-09-24T01:00:00Z'))
            conn.execute("INSERT INTO detections SELECT '6ff020d6-93b2-440e-9874-1080afd29801',device_id,detected_at,trigger_type,capture_source_type,total_count,normal_count,low_count,normal_ratio,low_ratio,monitoring_status,confidence,image_path,image_url,image_deleted_at,annotated_image_path,ai_instances,ai_response,provenance,sync_status,deleted_at,created_at FROM detections")
            conn.commit()
        self.orig_hash=hashlib.sha256(self.src.read_bytes()).hexdigest()
        self.image_hash=hashlib.sha256((self.fixture.media/'original.jpg').read_bytes()).hexdigest()
        self.out=self.base/'be04_isolated_test'
        trial.prepare(self.src,self.fixture.media,self.out)
        self.meta=__import__('json').loads((self.out/'ids.json').read_text())

    def test_isolation_and_full_cloud_lifecycle(self):
        self.assertEqual(self.orig_hash,hashlib.sha256(self.src.read_bytes()).hexdigest())
        with sqlite3.connect(self.out/'isolated.db') as conn:
            conn.row_factory=sqlite3.Row
            cloud=FakeCloud()
            cloud.tables['farms'].clear()
            cloud.tables['devices'].clear()
            worker=Worker(conn,self.out/'media',cloud,OWNER,self.meta['farm_id'])
            first=worker.once(limit=20,dry_run=False)
            self.assertEqual((first['selected'],first['synced'],first['failed']),(5,5,0))
            self.assertEqual(len(cloud.objects),4)
            self.assertEqual(len(cloud.tables['detections']),2)
            self.assertEqual(len(cloud.tables['alerts']),1)
        trial.mutate('resolve-alert',self.out)
        trial.mutate('image-delete',self.out)
        trial.mutate('record-delete',self.out)
        with sqlite3.connect(self.out/'isolated.db') as conn:
            conn.row_factory=sqlite3.Row
            worker=Worker(conn,self.out/'media',cloud,OWNER,self.meta['farm_id'])
            later=worker.once(limit=20,dry_run=False)
            self.assertEqual((later['selected'],later['synced'],later['failed']),(3,3,0))
            self.assertEqual(len(cloud.objects),0)
            self.assertEqual(cloud.tables['alerts'][self.meta['alert_id']]['alert_status'],'resolved')
            self.assertIsNotNone(cloud.tables['detections'][self.meta['image_detection_id']]['image_deleted_at'])
            self.assertIsNotNone(cloud.tables['detections'][self.meta['record_detection_id']]['deleted_at'])
        self.assertEqual(self.orig_hash,hashlib.sha256(self.src.read_bytes()).hexdigest())
        self.assertEqual(self.image_hash,hashlib.sha256((self.fixture.media/'original.jpg').read_bytes()).hexdigest())
        with self.assertRaises(ValueError):trial.mutate('image-delete',self.out)

if __name__=='__main__':unittest.main()
