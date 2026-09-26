"""Startup checks must never create or migrate a real database."""
import hashlib
import sqlite3
import pytest
from scripts.start_backend import configure, preflight


def test_missing_and_relative_database_fail_without_creation(tmp_path):
    media=tmp_path/'media';media.mkdir()
    for name in (str(tmp_path/'missing.db'),'relative.db'):
        with pytest.raises(ValueError, match='existing absolute'):
            preflight({'DATABASE_URL':'sqlite:///'+name,'LOCAL_IMAGE_DIR':str(media)}, {})
    assert not (tmp_path/'missing.db').exists()


def test_old_schema_refused_without_mutation(tmp_path):
    db=tmp_path/'old.db';media=tmp_path/'media';media.mkdir()
    with sqlite3.connect(db) as c:c.execute('create table detections (detection_id text)')
    before=db.read_bytes()
    with pytest.raises(ValueError,match='Incompatible schema'):
        preflight({'DATABASE_URL':'sqlite:///'+str(db),'LOCAL_IMAGE_DIR':str(media)}, {'detections':{'detection_id','ai_response'}})
    assert db.read_bytes()==before


def test_complete_schema_routes_and_preflight_are_read_only(tmp_path, monkeypatch):
    from sqlalchemy import create_engine
    from app.database import Base
    from app.quick_models import QuickBase
    from app import models
    db=tmp_path/'current.db';media=tmp_path/'media';media.mkdir()
    engine=create_engine('sqlite:///'+str(db));Base.metadata.create_all(engine);QuickBase.metadata.create_all(engine);engine.dispose()
    before=hashlib.sha256(db.read_bytes()).hexdigest()
    result=preflight({'DATABASE_URL':'sqlite:///'+str(db),'LOCAL_IMAGE_DIR':str(media)})
    assert result['schema']=='compatible'
    assert hashlib.sha256(db.read_bytes()).hexdigest()==before
    from app.main import app
    from fastapi.testclient import TestClient
    # Uvicorn standard launcher disables legacy lifespan; OpenAPI route discovery is read-only.
    schema=TestClient(app).get('/openapi.json').json()['paths']
    for path in ('/api/v1/devices','/api/v1/dashboard/summary','/api/v1/quick-detections'):
        assert path in schema


def test_config_requires_explicit_values_and_forbids_migration(tmp_path,monkeypatch):
    for key in ('DATABASE_URL','LOCAL_IMAGE_DIR','AI_SERVICE_URL','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','ENABLE_INFERENCE_MEDIA_MIGRATION'):
        monkeypatch.delenv(key,raising=False)
    env=tmp_path/'.env';env.write_text('')
    with pytest.raises(ValueError,match='DATABASE_URL'):configure(env)
    env.write_text('\n'.join(f'{key}=placeholder' for key in ('DATABASE_URL','LOCAL_IMAGE_DIR','AI_SERVICE_URL','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY'))+'\nENABLE_INFERENCE_MEDIA_MIGRATION=true\n')
    with pytest.raises(ValueError,match='migration is forbidden'):configure(env)
