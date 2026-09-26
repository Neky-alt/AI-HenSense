"""Quick upload contract tests. Fake AI/Auth exist only in this isolated test app."""
from io import BytesIO
from uuid import uuid4
import pytest
from PIL import Image
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from app.quick_models import QuickBase, QuickDetection
from app.database import get_db
from app.auth import current_user
from app.routers.quick_detections import router
from app.services.ai_adapter import AIInferenceResult, get_ai_adapter, AIServiceUnavailable
from app.config import settings

USER='10000000-0000-0000-0000-000000000001'
OTHER='10000000-0000-0000-0000-000000000002'
def photo(orientation=1):
 out=BytesIO(); im=Image.new('RGB',(60,40),'white');exif=im.getexif();exif[274]=orientation;im.save(out,format='JPEG',exif=exif);return out.getvalue()
class AI:
 calls=0
 fail=False
 def infer_mode(self,mode,frame):
  self.calls+=1
  if self.fail:raise AIServiceUnavailable('offline')
  assert Image.open(BytesIO(frame.content)).getexif().get(274,1)==1
  return AIInferenceResult(total_count=0,normal_count=0,low_count=0,raw_response={'mode':mode,'high_count':0,'low_count':0,'total_count':0,'instances':[]})
@pytest.fixture
def env(tmp_path,monkeypatch):
 engine=create_engine(f'sqlite:///{tmp_path}/test.db',connect_args={'check_same_thread':False});QuickBase.metadata.create_all(engine)
 monkeypatch.setattr(settings,'LOCAL_IMAGE_DIR',str(tmp_path/'media'))
 app=FastAPI();app.include_router(router,prefix='/api/v1')
 def db():
  with Session(engine) as session:yield session
 app.dependency_overrides[get_db]=db;app.dependency_overrides[current_user]=lambda:USER
 ai=AI();app.dependency_overrides[get_ai_adapter]=lambda:ai
 with TestClient(app) as client:yield client,app,engine,ai,tmp_path
 engine.dispose()
def upload(c,key=None,content=None,mode='caged',mime='image/jpeg'):
 return c.post('/api/v1/quick-detections',headers={'Idempotency-Key':key or str(uuid4())},data={'farming_type':mode,'source_type':'gallery'},files={'file':('photo.jpg',content or photo(),mime)})
def test_zero_result_idempotency_media_and_owner(env):
 c,app,engine,ai,_=env;key=str(uuid4());r=upload(c,key);assert r.status_code==201;r=r.json()['data'];assert r['total_count']==0 and r['normal_ratio'] is None
 assert upload(c,key).json()['data']['quick_detection_id']==r['quick_detection_id'];assert ai.calls==1
 for url in [r['image_url'],r['annotated_image_url']]:assert c.get(url).status_code==200
 assert len(c.get('/api/v1/quick-detections').json()['data']['items'])==1
 app.dependency_overrides[current_user]=lambda:OTHER
 assert c.get('/api/v1/quick-detections').json()['data']['items']==[]
 for url in [f"/api/v1/quick-detections/{r['quick_detection_id']}",r['image_url'],r['annotated_image_url']]:assert c.get(url).status_code==404
 assert upload(c,key).status_code==201

def test_conflicting_key_and_invalid_input(env):
 c,_,_,ai,_=env;key=str(uuid4());assert upload(c,key).status_code==201
 assert upload(c,key,mode='free_range').status_code==409
 for content,mime in [(b'invalid','image/jpeg'),(photo(),'image/heic'),(photo(),'text/plain')]:assert upload(c,content=content,mime=mime).status_code in (415,422)
 assert ai.calls==1

def test_size_limit(env,monkeypatch):
 c,*_=env;monkeypatch.setattr(settings,'MAX_DETECTION_IMAGE_BYTES',100);assert upload(c).status_code==413

@pytest.mark.parametrize('orientation',range(1,9))
def test_exif_normalization(env,orientation):
 c,_,_,_,root=env;r=upload(c,content=photo(orientation));assert r.status_code==201
 result=r.json()['data'];image=Image.open(BytesIO(c.get(result['image_url']).content));assert image.size==((40,60) if orientation>=5 else (60,40))
 assert result['provenance']['original_sha256']

def test_failure_cleanup_and_safe_retry(env):
 c,_,engine,ai,root=env;ai.fail=True;key=str(uuid4());assert upload(c,key).status_code==502
 with Session(engine) as db:
  row=db.scalar(select(QuickDetection));assert row.status=='failed';assert row.image_path is None;assert row.total_count is None
 assert not list((root/'media').rglob('*.jpg'))
 ai.fail=False;assert upload(c,key).status_code==201
 with Session(engine) as db:assert len(db.scalars(select(QuickDetection)).all())==1

def test_auth_required_for_every_route(env):
 c,app,_,_,_=env;app.dependency_overrides.pop(current_user)
 for url in ['/api/v1/quick-detections','/api/v1/quick-detections/x','/api/v1/quick-detections/x/image','/api/v1/quick-detections/x/annotated-image']:assert c.get(url).status_code==401
 assert upload(c).status_code==401

def test_failed_commit_removes_media(env,monkeypatch):
 c,_,engine,ai,root=env;real=Session.commit;calls=0
 def fail_once(self):
  nonlocal calls
  calls+=1
  if calls==2:raise RuntimeError('simulated commit failure')
  return real(self)
 monkeypatch.setattr(Session,'commit',fail_once)
 assert upload(c).status_code==502
 assert not [p for p in (root/'media').rglob('*') if p.is_file()]
 with Session(engine) as db:
  row=db.scalar(select(QuickDetection));assert row.status=='failed';assert row.image_path is None

def test_storage_failure_cleanup(env,monkeypatch):
 import app.services.quick_detection_service as service
 c,_,_,_,root=env;real=service.save_capture_image;calls=0
 def fail(*args,**kwargs):
  nonlocal calls
  calls+=1
  if calls==2:raise OSError('disk full')
  return real(*args,**kwargs)
 monkeypatch.setattr(service,'save_capture_image',fail)
 assert upload(c).status_code==502
 assert not [p for p in (root/'media').rglob('*') if p.is_file()]

def test_concurrent_retry_does_not_infer_twice(env,monkeypatch):
 from concurrent.futures import ThreadPoolExecutor
 from threading import Event
 c,_,_,ai,_=env;started=Event();resume=Event();real=ai.infer_mode
 def slow(*args):
  started.set();assert resume.wait(10);return real(*args)
 monkeypatch.setattr(ai,'infer_mode',slow);key=str(uuid4())
 with ThreadPoolExecutor() as pool:
  future=pool.submit(upload,c,key)
  assert started.wait(5)
  try:assert upload(c,key).status_code==202
  finally:resume.set()
  assert future.result().status_code==201
 assert ai.calls==1

def test_interrupted_attempt_recovery(env):
 from datetime import timedelta
 from app.quick_models import now
 c,_,engine,ai,root=env;key=str(uuid4());result=upload(c,key).json()['data']
 with Session(engine) as db:
  row=db.get(QuickDetection,result['quick_detection_id']);row.status='processing';row.lease_expires_at=now()-timedelta(seconds=1)
  # Simulate interruption before successful persistence, with staged files only.
  row.image_path=row.annotated_image_path=row.original_upload_path=None;row.total_count=row.normal_count=row.low_count=None;db.commit()
 assert c.get('/api/v1/quick-detections').json()['data']['items'][0]['status']=='failed'
 assert not [p for p in (root/'media').rglob('*') if p.is_file()]
 assert upload(c,key).status_code==201

def test_server_token_verification(env,monkeypatch):
 import httpx
 from app import auth
 c,app,_,_,_=env;app.dependency_overrides.pop(current_user)
 monkeypatch.setattr(settings,'SUPABASE_URL','https://auth.example.test');monkeypatch.setattr(settings,'SUPABASE_PUBLISHABLE_KEY','public-test')
 def auth_response(url,headers,timeout):
  assert url=='https://auth.example.test/auth/v1/user';assert headers['apikey']=='public-test'
  return httpx.Response(200,json={'id':USER}) if headers['Authorization']=='Bearer valid' else httpx.Response(401)
 monkeypatch.setattr(auth.httpx,'get',auth_response)
 assert c.get('/api/v1/quick-detections',headers={'Authorization':'Bearer expired'}).status_code==401
 assert c.get('/api/v1/quick-detections',headers={'Authorization':'Bearer valid','user_id':OTHER}).status_code==200
 def offline(*a,**k):raise httpx.ConnectError('offline')
 monkeypatch.setattr(auth.httpx,'get',offline)
 assert c.get('/api/v1/quick-detections',headers={'Authorization':'Bearer valid'}).status_code==503

def test_navigation_and_pagination_are_user_scoped(env):
 c,app,_,_,_=env;a=upload(c).json()['data'];b=upload(c).json()['data']
 first=c.get('/api/v1/quick-detections?limit=1').json()['data'];assert len(first['items'])==1;assert first['next_offset']==1
 assert c.get('/api/v1/quick-detections/'+b['quick_detection_id']).json()['data']['previous_id']==a['quick_detection_id']
 assert c.get('/api/v1/quick-detections/'+a['quick_detection_id']).json()['data']['next_id']==b['quick_detection_id']
 app.dependency_overrides[current_user]=lambda:OTHER
 own=upload(c).json()['data'];d=c.get('/api/v1/quick-detections/'+own['quick_detection_id']).json()['data'];assert d['previous_id'] is None and d['next_id'] is None

def test_explicit_migration_and_no_auto_creation(tmp_path):
 import sqlite3,hashlib
 from scripts.migrate_quick_detections import migrate
 from app.database import Base
 path=tmp_path/'copy.sqlite3'
 with sqlite3.connect(path) as db:db.execute('create table preserved(id integer, value text)');db.execute("insert into preserved values(1,'original')")
 assert 'quick_detections' not in Base.metadata.tables
 migrate(path);before=hashlib.sha256(path.read_bytes()).hexdigest();migrate(path);assert hashlib.sha256(path.read_bytes()).hexdigest()==before
 with sqlite3.connect(path) as db:assert db.execute('select * from preserved').fetchall()==[(1,'original')]
 protected=tmp_path/'hen_monitoring.db';protected.touch()
 with pytest.raises(ValueError):migrate(protected)

def test_multipart_body_limit(env,monkeypatch):
 from app.quick_upload_limit import QuickUploadLimit
 from fastapi import FastAPI
 from fastapi.testclient import TestClient
 monkeypatch.setattr(settings,'MAX_DETECTION_IMAGE_BYTES',10)
 app=FastAPI();app.add_middleware(QuickUploadLimit)
 with TestClient(app) as client:assert client.post('/api/v1/quick-detections',content=b'x'*70000).status_code==413

def test_larger_lossless_derivative_does_not_reject_valid_upload(env,monkeypatch):
 import random
 c,_,_,_,_=env
 image=Image.frombytes('RGB',(60,40),random.Random(42).randbytes(60*40*3));out=BytesIO();image.save(out,format='JPEG',quality=30);content=out.getvalue()
 monkeypatch.setattr(settings,'MAX_DETECTION_IMAGE_BYTES',len(content))
 response=upload(c,content=content);assert response.status_code==201
 annotation=c.get(response.json()['data']['annotated_image_url']);assert len(annotation.content)>len(content)

def test_ambiguous_commit_keeps_successful_media(env,monkeypatch):
 c,_,_,ai,root=env;real=Session.commit;calls=0
 def fail_after_commit(self):
  nonlocal calls
  calls+=1;real(self)
  if calls==2:raise RuntimeError('connection failed after commit')
 monkeypatch.setattr(Session,'commit',fail_after_commit)
 response=upload(c);assert response.status_code==200
 result=response.json()['data'];assert result['status']=='succeeded';assert ai.calls==1
 assert c.get(result['image_url']).status_code==200
 assert c.get(result['annotated_image_url']).status_code==200
