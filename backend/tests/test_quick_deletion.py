"""All deletion tests use pytest temporary SQLite/media, never accepted records."""
from pathlib import Path
from sqlalchemy.orm import Session
from app.quick_models import QuickDetection
from app.auth import current_user
from tests.test_quick_detection import env, upload, photo, USER, OTHER

def endpoint(record):return '/api/v1/quick-detections/'+record['quick_detection_id']

def test_delete_owner_media_and_preserve_others(env):
 c,app,engine,_,root=env
 a=upload(c,content=photo(6)).json()['data'];b=upload(c).json()['data']
 sentinel=root/'media'/'device-original.jpg';sentinel.write_bytes(b'preserved')
 with Session(engine) as db:
  row=db.get(QuickDetection,a['quick_detection_id']);paths=[root/'media'/v for v in (row.image_path,row.original_upload_path,row.annotated_image_path)]
 app.dependency_overrides[current_user]=lambda:OTHER
 assert c.delete(endpoint(a)).status_code==404
 assert all(p.exists() for p in paths)
 app.dependency_overrides.pop(current_user)
 assert c.delete(endpoint(a)).status_code==401
 app.dependency_overrides[current_user]=lambda:USER
 assert c.delete(endpoint(a)).status_code==200
 assert all(not p.exists() for p in paths)
 assert c.get(endpoint(a)).status_code==404
 assert c.get(b['image_url']).status_code==200 and sentinel.read_bytes()==b'preserved'
 assert c.get('/api/v1/quick-detections').json()['data']['items'][0]['quick_detection_id']==b['quick_detection_id']
 assert c.delete(endpoint(b)).status_code==200
 assert c.get('/api/v1/quick-detections').json()['data']=={'items':[],'next_offset':None}

def test_delete_processing_rejected(env):
 c,_,engine,_,_=env;r=upload(c).json()['data']
 with Session(engine) as db:row=db.get(QuickDetection,r['quick_detection_id']);row.status='processing';db.commit()
 assert c.delete(endpoint(r)).status_code==409

def test_delete_commit_failure_restores_media(env,monkeypatch):
 c,_,_,_,_=env;r=upload(c).json()['data']
 def fail(self):raise RuntimeError('db failure')
 monkeypatch.setattr(Session,'commit',fail)
 assert c.delete(endpoint(r)).status_code==503
 assert c.get(r['image_url']).status_code==200

def test_delete_ambiguous_commit_does_not_restore_orphan(env,monkeypatch):
 c,_,_,_,root=env;r=upload(c).json()['data'];real=Session.commit
 def fail(self):real(self);raise RuntimeError('lost commit response')
 monkeypatch.setattr(Session,'commit',fail)
 assert c.delete(endpoint(r)).status_code==200
 assert not [p for p in (root/'media').rglob('*') if p.is_file()]

def test_cleanup_failure_retry_is_owner_scoped(env,monkeypatch):
 import app.services.quick_deletion as deletion
 c,app,_,_,root=env;r=upload(c).json()['data'];real=deletion.shutil.rmtree
 def fail(path):raise OSError('disk permissions')
 monkeypatch.setattr(deletion.shutil,'rmtree',fail)
 response=c.delete(endpoint(r));assert response.status_code==503;assert response.json()['error']['code']=='DELETE_CLEANUP_PENDING'
 app.dependency_overrides[current_user]=lambda:OTHER
 assert c.delete(endpoint(r)).status_code==404
 app.dependency_overrides[current_user]=lambda:USER
 monkeypatch.setattr(deletion.shutil,'rmtree',real)
 assert c.delete(endpoint(r)).status_code==200
 assert not [p for p in (root/'media').rglob('*') if p.is_file()]

def test_unsafe_media_and_symlinks_rejected(env):
 c,_,engine,_,root=env;r=upload(c).json()['data'];outside=root/'outside';outside.write_bytes(b'keep')
 with Session(engine) as db:
  row=db.get(QuickDetection,r['quick_detection_id']);original=row.image_path;row.image_path='../outside';db.commit()
 assert c.delete(endpoint(r)).status_code==503 and outside.read_bytes()==b'keep'
 with Session(engine) as db:row=db.get(QuickDetection,r['quick_detection_id']);row.image_path=original;db.commit()
 target=root/'media'/original;target.unlink();target.symlink_to(outside)
 assert c.delete(endpoint(r)).status_code==503 and outside.read_bytes()==b'keep'

def test_delete_last_page_and_navigation(env):
 c,_,_,_,_=env;rows=[upload(c).json()['data'] for _ in range(3)]
 assert c.get('/api/v1/quick-detections?limit=2').json()['data']['next_offset']==2
 assert c.delete(endpoint(rows[0])).status_code==200
 assert c.get('/api/v1/quick-detections?limit=2&offset=2').json()['data']['items']==[]
 assert c.get('/api/v1/quick-detections?limit=2').json()['data']['next_offset'] is None
 assert c.get(endpoint(rows[1])).json()['data']['previous_id'] is None
 assert c.get(endpoint(rows[2])).json()['data']['previous_id']==rows[1]['quick_detection_id']

def test_staging_failure_keeps_record_and_media(env,monkeypatch):
 c,_,_,_,_=env;r=upload(c).json()['data']
 def fail(*args,**kwargs):raise OSError('rename failed')
 monkeypatch.setattr(Path,'rename',fail)
 assert c.delete(endpoint(r)).status_code==503
 assert c.get(r['image_url']).status_code==200

def test_retry_after_interruption_between_stage_and_commit(env):
 c,_,engine,_,root=env;r=upload(c).json()['data']
 with Session(engine) as db:attempt=db.get(QuickDetection,r['quick_detection_id']).attempt_id
 owner=root/'media'/'quick_detections'/USER
 staged=owner/'.deleting'/r['quick_detection_id'];staged.parent.mkdir();(owner/attempt).rename(staged)
 assert c.delete(endpoint(r)).status_code==200 and not staged.exists()
