import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings

class IntegrationGateTests(unittest.TestCase):
    def test_legacy_local_routes_still_exist(self):
        paths=set(app.openapi()['paths'])
        self.assertIn('/api/v1/devices',paths)
        self.assertIn('/api/v1/quick-detections',paths)
    def test_cloud_disabled_by_default(self):
        if not settings.BE04_CLOUD_READ_ENABLED:
            paths=set(app.openapi()['paths'])
            self.assertNotIn('/api/v1/cloud/farms/{farm_id}/devices',paths)
            self.assertNotIn('/api/v1/sync/status',paths)
    def test_cloud_auth_never_falls_back_to_service_role(self):
        from app.routers.be04_cloud import _current_user
        from fastapi import HTTPException
        with patch('app.auth.settings') as cfg:
            cfg.SUPABASE_URL='https://example.supabase.co'
            cfg.SUPABASE_PUBLISHABLE_KEY=''
            with self.assertRaises(HTTPException) as e:
                _current_user('Bearer a-fake-token')
        self.assertEqual(e.exception.status_code,503)


class WorkerEntryTests(unittest.TestCase):
    def test_cli_safety_guards(self):
        import fcntl
        import os
        from pathlib import Path
        import sqlite3
        import subprocess
        import sys
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / 'worker.db'
            with sqlite3.connect(db) as conn:
                conn.execute('CREATE TABLE detections(sync_status TEXT)')
            before = db.read_bytes()
            env = dict(os.environ, DATABASE_URL=f'sqlite:///{db}', LOCAL_IMAGE_DIR=tmp)
            args = [sys.executable, '-m', 'scripts.be04_worker', '--db', str(db),
                    '--media-dir', tmp, '--owner-user-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                    '--farm-id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '--active-db-check']
            result = subprocess.run(args + ['--status'], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(db.read_bytes(), before)
            mismatch = dict(env, DATABASE_URL=f'sqlite:///{tmp}/other.db')
            result = subprocess.run(args + ['--status'], env=mismatch, capture_output=True, text=True)
            self.assertIn('Worker DB does not match', result.stderr)
            self.assertNotEqual(result.returncode, 0)
            with db.with_suffix('.db.be04.lock').open('a+') as lock:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                result = subprocess.run(args + ['--apply'], env=env, capture_output=True, text=True)
                self.assertIn('already running', result.stderr)
                self.assertNotEqual(result.returncode, 0)
            self.assertEqual(db.read_bytes(), before)

if __name__ == '__main__':
    unittest.main()
