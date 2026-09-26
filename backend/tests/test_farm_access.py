from datetime import datetime
from uuid import uuid4
import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine,select
from sqlalchemy.orm import Session
from app.database import Base,get_db
from app.config import settings
from app import models as m
from app.routers import devices,dashboard,settings_storage
from app.services.core_data import dashboard_summary

A='10000000-0000-0000-0000-000000000001';B='10000000-0000-0000-0000-000000000002'
@pytest.fixture
def env(tmp_path,monkeypatch):
 engine=create_engine(f'sqlite:///{tmp_path}/test.db',connect_args={'check_same_thread':False});Base.metadata.create_all(engine)
 farms=[str(uuid4()),str(uuid4())];devs=[str(uuid4()),str(uuid4())];dets=[str(uuid4()),str(uuid4())]
 media=tmp_path/'media';media.mkdir();(media/'one.jpg').write_bytes(b'test-image')
 monkeypatch.setattr(settings,'LOCAL_IMAGE_DIR',str(media));monkeypatch.setattr(settings,'SUPABASE_URL','https://test.supabase.co');monkeypatch.setattr(settings,'SUPABASE_PUBLISHABLE_KEY','public')
 with Session(engine) as db:
  db.add(m.Profile(user_id='demo'));db.flush()
  for i in range(2):
   db.add(m.Farm(farm_id=farms[i],user_id='demo',farm_name='Demo'));db.flush()
   db.add(m.Device(device_id=devs[i],farm_id=farms[i],device_code=f'CAGE-{i}',farming_type='caged'));db.flush()
   db.add(m.Detection(detection_id=dets[i],device_id=devs[i],detected_at=datetime.now(),total_count=0,normal_count=0,low_count=0,image_path='one.jpg',annotated_image_path='one.jpg'))
  db.commit()
 def db_session():
  with Session(engine) as db:yield db
 def remote(url,headers,timeout,params=None):
  token=headers['Authorization'];user=A if token=='Bearer A' else B if token=='Bearer B' else None
  if url.endswith('/auth/v1/user'):return httpx.Response(200,json={'id':user}) if user else httpx.Response(401)
  assert headers['apikey']=='public';assert params['user_id']=='eq.'+user
  # B initially has no farm; mutation in test can grant the second fixture farm.
  return httpx.Response(200,json=[{'farm_id':farms[0],'user_id':A}] if user==A else [])
 monkeypatch.setattr(httpx,'get',remote)
 app=FastAPI()
 for router in (devices.router,dashboard.router,settings_storage.router):app.include_router(router,prefix='/api/v1')
 app.dependency_overrides[get_db]=db_session
 with TestClient(app) as c:yield c,engine,farms,devs,dets,remote
 engine.dispose()

def test_auth_lists_dashboard_and_direct_ids(env):
 c,engine,farms,devs,dets,_=env
 base='/api/v1/devices/'+devs[0]
 paths=['/api/v1/devices','/api/v1/dashboard/summary',base,base+'/detections',base+'/detections/latest',base+'/alerts',base+'/storage',base+'/storage/settings',base+f'/detections/{dets[0]}/image',base+f'/detections/{dets[0]}/annotated-image','/api/v1/monitoring-settings/caged','/api/v1/notification-settings']
 for path in paths:
  assert c.get(path).status_code==401
  assert c.get(path,headers={'Authorization':'Bearer invalid'}).status_code==401
 assert len(c.get('/api/v1/devices',headers={'Authorization':'Bearer A'}).json()['data'])==1
 assert c.get('/api/v1/devices?farm_id='+farms[0],headers={'Authorization':'Bearer B'}).json()['data']==[]
 summary=c.get('/api/v1/dashboard/summary',headers={'Authorization':'Bearer B'});assert summary.status_code==200
 assert str(devs[0]) not in summary.text
 for path in paths[2:]:assert c.get(path,headers={'Authorization':'Bearer B'}).status_code==404
 assert c.get(base+f'/detections/{dets[0]}/image',headers={'Authorization':'Bearer A'}).content==b'test-image'
 assert c.get(base+f'/detections/{dets[1]}/image',headers={'Authorization':'Bearer A'}).status_code==404
 assert c.get('/api/v1/devices/'+devs[1],headers={'Authorization':'Bearer A'}).status_code==404
 with Session(engine) as db:assert len(db.scalars(select(m.Device)).all())==2 # offline sessions stay unrestricted

def test_writes_are_authorized(env):
 c,engine,farms,devs,dets,_=env
 payload={'store_detection_images':True,'detection_image_retention_days':10,'store_video_locally':False,'video_retention_days':None,'max_media_storage_gb':1,'storage_limit_action':'delete_oldest'}
 path='/api/v1/devices/'+devs[0]
 assert c.put(path+'/storage/settings',json=payload,headers={'Authorization':'Bearer B'}).status_code==404
 assert c.post(path+'/detect',headers={'Authorization':'Bearer B'}).status_code==404
 assert c.post(path+'/detect',headers={'Authorization':'Bearer A'}).status_code==409 # owned but offline
 assert c.put(path+'/storage/settings',json=payload,headers={'Authorization':'Bearer A'}).status_code==200
 assert c.put('/api/v1/notification-settings',json={'in_app_enabled':False},headers={'Authorization':'Bearer B'}).status_code==404
 assert c.put('/api/v1/monitoring-settings/caged',json={'monitoring_enabled':True,'detection_mode':'interval','detection_interval_minutes':30,'cage_warning_low_ratio_threshold':0.6},headers={'Authorization':'Bearer B'}).status_code==404
 with Session(engine) as db:assert db.get(m.DeviceStorageSettings,devs[1]) is None

def test_remote_failure_is_closed_and_wrong_owner_rows_are_ignored(env,monkeypatch):
 c,_,farms,_,_,remote=env
 def bad(url,**kw):
  if url.endswith('/auth/v1/user'):return remote(url,**kw)
  return httpx.Response(200,json=[{'farm_id':farms[0],'user_id':A}])
 monkeypatch.setattr(httpx,'get',bad)
 assert c.get('/api/v1/devices',headers={'Authorization':'Bearer B'}).json()['data']==[]
 def offline(url,**kw):
  if url.endswith('/auth/v1/user'):return remote(url,**kw)
  raise httpx.ConnectError('offline')
 monkeypatch.setattr(httpx,'get',offline)
 assert c.get('/api/v1/devices',headers={'Authorization':'Bearer A'}).status_code==503

def test_two_real_owners_share_no_local_rows_despite_demo_owner(env,monkeypatch):
 c,_,farms,devs,dets,remote=env
 def owners(url,**kw):
  if url.endswith('/auth/v1/user'):return remote(url,**kw)
  user=kw['params']['user_id'][3:];idx=0 if user==A else 1
  return httpx.Response(200,json=[{'farm_id':farms[idx],'user_id':user}])
 monkeypatch.setattr(httpx,'get',owners)
 for token,idx in [('A',0),('B',1)]:
  headers={'Authorization':'Bearer '+token}
  data=c.get('/api/v1/devices',headers=headers).json()['data']
  assert [r['device_id'] for r in data]==[devs[idx]]
  assert c.get('/api/v1/devices/'+devs[1-idx],headers=headers).status_code==404
  assert c.get(f'/api/v1/devices/{devs[1-idx]}/detections/{dets[1-idx]}/annotated-image',headers=headers).status_code==404
