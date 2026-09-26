"""Offline tests for BE04 live worker: no credentials or Supabase network."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from app.services.be04_worker import Worker, status

FARM='91000000-0000-0000-0000-000000000001'
USER='90000000-0000-0000-0000-000000000001'
OWNER='011f1bfb-ac10-424b-b687-52baf06eddc1'
DEVICE='92000000-0000-0000-0000-000000000001'
DET='6ff020d6-93b2-440e-9874-1080afd29800'
NOW='2026-09-24T01:00:00Z'

class FakeCloud:
    def __init__(self):
        self.tables={'farms':{},'devices':{},'detections':{},'alerts':{},'monitoring_settings':{},'device_storage_settings':{},'notification_settings':{}}
        self.tables['farms'][FARM]={'farm_id':FARM,'user_id':OWNER}
        self.tables['devices'][DEVICE]={'device_id':DEVICE,'farm_id':FARM}
        self.objects={}
        self.fail=False
    def get_rows(self,table,key,val,select):
        if table=='profiles': return [{'user_id':OWNER}] if val==OWNER else []
        return [v for v in self.tables[table].values() if v.get(key)==val]
    def cloud_detection(self,id_): return self.tables['detections'].get(id_)
    def upsert(self,table,pk,payload):
        if self.fail:raise ConnectionError('offline')
        self.tables[table][payload[pk]]=payload
    def upsert_detection(self,payload): self.upsert('detections','detection_id',payload)
    def upload(self,key,path):
        if self.fail:raise ConnectionError('offline')
        self.objects[key]=path.read_bytes()
    def delete_object(self,key): self.objects.pop(key,None)

class WorkerTests(unittest.TestCase):
    def setUp(self):
        td=tempfile.TemporaryDirectory();self.addCleanup(td.cleanup)
        base=Path(td.name);self.media=base/'media';self.media.mkdir()
        (self.media/'original.jpg').write_bytes(b'jpg')
        (self.media/'annotated.png').write_bytes(b'png')
        self.conn=sqlite3.connect(base/'trial.db');self.addCleanup(self.conn.close)
        self.conn.executescript('''
        CREATE TABLE farms(farm_id TEXT,user_id TEXT,farm_name TEXT,timezone TEXT,created_at TEXT,updated_at TEXT);
        CREATE TABLE devices(device_id TEXT,farm_id TEXT,device_code TEXT,device_name TEXT,farming_type TEXT,last_seen_at TEXT,is_active INTEGER,created_at TEXT,updated_at TEXT);
        CREATE TABLE detections(detection_id TEXT,device_id TEXT,detected_at TEXT,trigger_type TEXT,capture_source_type TEXT,total_count INT,normal_count INT,low_count INT,normal_ratio REAL,low_ratio REAL,monitoring_status TEXT,confidence REAL,image_path TEXT,image_url TEXT,image_deleted_at TEXT,annotated_image_path TEXT,ai_instances TEXT,ai_response TEXT,provenance TEXT,sync_status TEXT,deleted_at TEXT,created_at TEXT);
        CREATE TABLE alerts(alert_id TEXT,device_id TEXT,detection_id TEXT,alert_type TEXT,message TEXT,alert_status TEXT,sync_status TEXT,created_at TEXT,resolved_at TEXT);
        CREATE TABLE monitoring_settings(settings_id TEXT,farm_id TEXT,farming_type TEXT,monitoring_enabled INT,monitoring_start_time TEXT,monitoring_end_time TEXT,detection_mode TEXT,detection_interval_minutes INT,scheduled_times TEXT,cage_warning_low_ratio_threshold REAL,result_snapshot_interval_minutes INT,free_range_warning_low_count_threshold INT,updated_at TEXT);
        CREATE TABLE device_storage_settings(device_id TEXT,store_detection_images INT,detection_image_retention_days INT,store_video_locally INT,video_retention_days INT,max_media_storage_gb REAL,storage_limit_action TEXT,updated_at TEXT);
        CREATE TABLE notification_settings(user_id TEXT,in_app_enabled INT,email_enabled INT,push_enabled INT,updated_at TEXT);
        ''')
        self.conn.execute('INSERT INTO farms VALUES (?,?,?,?,?,?)',(FARM,USER,'Demo','Australia/Sydney',NOW,NOW))
        self.conn.execute('INSERT INTO devices VALUES (?,?,?,?,?,?,?,?,?)',(DEVICE,FARM,'CAGE-01','Cage','caged',None,1,NOW,NOW))
        self.conn.execute('INSERT INTO detections VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (DET,DEVICE,NOW,'manual','file_upload',1,1,0,1.,0.,'normal',None,'original.jpg',None,None,'annotated.png','[]','{}','{}','pending',None,NOW))
        self.conn.commit()
        self.cloud=FakeCloud()
        self.worker=Worker(self.conn,self.media,self.cloud,OWNER,FARM)

    def test_dry_run_read_only_and_real_sync(self):
        r=self.worker.once(dry_run=True)
        self.assertEqual(r['selected'],3)
        self.assertFalse(self.conn.execute("SELECT 1 FROM sqlite_master WHERE name='be04_outbox'").fetchone())
        self.assertEqual(len(self.cloud.objects),0)
        r=self.worker.once(dry_run=False)
        self.assertEqual((r['selected'],r['synced']), (3,3))
        self.assertEqual(len(self.cloud.objects),2)
        self.assertEqual(len(self.cloud.tables['detections']),1)
        self.assertEqual(self.cloud.tables['farms'][FARM]['user_id'],OWNER)
        self.assertEqual(self.conn.execute('SELECT sync_status FROM detections').fetchone()[0],'synced')
        self.assertEqual(self.worker.once(dry_run=False)['selected'],0)

    def test_outage_backoff_then_retry(self):
        self.cloud.fail=True
        failed=self.worker.once(dry_run=False)
        self.assertEqual(failed['failed'],1)
        self.assertEqual(len(self.cloud.tables['detections']),0)
        self.cloud.fail=False
        self.conn.execute("UPDATE be04_outbox SET next_retry_at=NULL")
        self.conn.commit()
        result=self.worker.once(dry_run=False)
        self.assertEqual(result['synced'],3)
        self.assertEqual(len(self.cloud.tables['detections']),1)

    def test_tombstone_deletes_cloud_images_and_preserves_row(self):
        self.worker.once(dry_run=False)
        self.conn.execute('UPDATE detections SET image_deleted_at=? WHERE detection_id=?',(NOW,DET))
        self.conn.commit()
        result=self.worker.once(dry_run=False)
        self.assertEqual(result['synced'],1)
        self.assertEqual(len(self.cloud.objects),0)
        self.assertIsNone(self.cloud.tables['detections'][DET]['image_url'])
        self.assertEqual(self.cloud.tables['detections'][DET]['image_deleted_at'],NOW)

    def test_alert_and_settings_opt_in(self):
        self.conn.execute('INSERT INTO alerts VALUES (?,?,?,?,?,?,?,?,?)',('93000000-0000-0000-0000-000000000001',DEVICE,DET,'stale_data','stale','active','pending',NOW,None))
        self.conn.execute('INSERT INTO monitoring_settings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',('94000000-0000-0000-0000-000000000001',FARM,'caged',1,None,None,'interval',60,'["10:00"]',.6,None,None,NOW))
        self.conn.commit()
        self.worker.once(dry_run=False)
        self.assertEqual(len(self.cloud.tables['alerts']),1)
        self.assertEqual(len(self.cloud.tables['monitoring_settings']),0)
        self.worker.include_settings=True
        self.worker.once(dry_run=False)
        self.assertEqual(len(self.cloud.tables['monitoring_settings']),1)

    def test_new_pending_after_initial_sync(self):
        self.worker.once(dry_run=False)
        next_id='6ff020d6-93b2-440e-9874-1080afd29801'
        self.conn.execute('INSERT INTO detections SELECT ?,device_id,detected_at,trigger_type,capture_source_type,total_count,normal_count,low_count,normal_ratio,low_ratio,monitoring_status,confidence,image_path,image_url,image_deleted_at,annotated_image_path,ai_instances,ai_response,provenance,?,deleted_at,created_at FROM detections WHERE detection_id=?',(next_id,'pending',DET))
        self.conn.commit()
        out=self.worker.once(dry_run=False)
        self.assertEqual(out['synced'],1)
        self.assertEqual(len(self.cloud.tables['detections']),2)
        self.assertEqual(len(self.cloud.objects),4)

    def test_record_tombstone_preserves_structured_history(self):
        self.worker.once(dry_run=False)
        self.conn.execute('UPDATE detections SET deleted_at=? WHERE detection_id=?',(NOW,DET))
        self.conn.commit()
        result=self.worker.once(dry_run=False)
        self.assertEqual(result['synced'],1)
        self.assertEqual(len(self.cloud.objects),0)
        self.assertEqual(len(self.cloud.tables['detections']),1)
        self.assertEqual(self.cloud.tables['detections'][DET]['deleted_at'],NOW)

    def test_wrong_cloud_owner_fails_closed(self):
        self.cloud.tables['farms'][FARM]['user_id']='00000000-0000-0000-0000-000000000002'
        with self.assertRaises(ValueError):
            self.worker.once(dry_run=False)
        self.assertEqual(len(self.cloud.objects),0)
        self.assertEqual(len(self.cloud.tables['detections']),0)

if __name__=='__main__':unittest.main()
