"""Synthetic unit fixtures only; field-validation runner never imports these."""
from io import BytesIO
from PIL import Image
import pytest
from sqlalchemy import select, create_engine
from app.services.ai_adapter import normalize_ai_payload
from app.services.capture_adapter import CapturedFrame
from app.services.detection_annotations import render_annotation
from app.services.inference_media import persist_inference_media
from app.enums import CaptureSourceType
from app.models import Detection, Device
from tests.test_be03_detection_images import media_env


def frame():
    out = BytesIO()
    Image.new('RGB', (160, 120), 'white').save(out, format='PNG')
    return CapturedFrame(out.getvalue(), 'unit.png', 'image/png')


def payload():
    return dict(mode='caged', total_count=2, high_count=1, low_count=1, ratio_normal=.5,
                instances=[dict(bbox=dict(x1=10,y1=35,x2=70,y2=110),label='normal',prob_normal=.8),
                           dict(bbox=dict(x1=80,y1=35,x2=150,y2=110),label='low_yield',prob_normal=.2)])


def result(p=None):
    return normalize_ai_payload(p or payload(), expected_mode='caged')


def test_colours_size_and_original_unchanged():
    f = frame(); original = f.content; data = payload()
    annotated = Image.open(BytesIO(render_annotation(f, result(data))))
    assert annotated.size == (160,120)
    assert annotated.getpixel((10,100)) == (22,163,74)
    assert annotated.getpixel((80,100)) == (220,38,38)
    assert f.content == original
    assert result(data).raw_response == data


@pytest.mark.parametrize('mutation', ['outside','inverted','nan','probability','label','count'])
def test_reject_bad_instance_contract(mutation):
    p = payload(); i = p['instances'][0]
    if mutation=='outside': i['bbox']['x2']=161
    if mutation=='inverted': i['bbox']['x2']=1
    if mutation=='nan': i['bbox']['x1']=float('nan')
    if mutation=='probability': i['prob_normal']=1.1
    if mutation=='label': i['label']='other'
    if mutation=='count': p['instances'].pop()
    with pytest.raises(ValueError): render_annotation(frame(), result(p))


def test_zero_targets_has_no_boxes():
    p=dict(mode='caged',total_count=0,high_count=0,low_count=0,ratio_normal=None,instances=[])
    im=Image.open(BytesIO(render_annotation(frame(),result(p))))
    assert im.getextrema()==((255,255),(255,255),(255,255))


def test_rotated_exif_rejected():
    im=Image.new('RGB',(160,120)); exif=Image.Exif();exif[274]=6
    out=BytesIO();im.save(out,format='JPEG',exif=exif)
    with pytest.raises(ValueError,match='EXIF'):
        render_annotation(CapturedFrame(out.getvalue(),'rotated.jpg'),result())


def test_media_persistence_and_ownership_tombstones(media_env):
    client,db,did,root=media_env
    from app.services.core_data import serialize_detection
    d=persist_inference_media(db,db.get(Device,did),frame(),result(),source=CaptureSourceType.file_upload,provenance={'run_id':'test'})
    data=serialize_detection(d)
    assert d.ai_instances==payload()['instances'] and d.ai_response==payload()
    assert d.provenance['origin']=='ai_inference'
    assert d.image_path != d.annotated_image_path
    assert client.get(data['image_url']).content==frame().content
    assert client.get(data['annotated_image_url']).status_code==200
    assert client.get(data['annotated_image_url'].replace(did,'wrong')).status_code==404
    d.annotated_image_path='../../.env'; db.commit()
    assert client.get(data['annotated_image_url']).status_code==404
    from app.models import utcnow
    d.image_deleted_at=utcnow();db.commit()
    assert client.get(data['image_url']).status_code==404
    assert client.get(data['annotated_image_url']).status_code==404


def test_bad_annotations_clean_up_original(media_env):
    _,db,did,root=media_env
    p=payload();p['instances'][0]['bbox']['x1']=-1
    with pytest.raises(ValueError): persist_inference_media(db,db.get(Device,did),frame(),result(p))
    assert db.scalars(select(Detection)).all()==[]
    assert list(root.rglob('*.png'))==[]


def test_explicit_migration_preserves_legacy_rows_and_is_idempotent(tmp_path,monkeypatch):
    from app import database
    engine=create_engine(f'sqlite:///{tmp_path / "legacy.db"}')
    with engine.begin() as con:
        con.exec_driver_sql('CREATE TABLE detections (detection_id TEXT PRIMARY KEY, normal_count INTEGER)')
        con.exec_driver_sql("INSERT INTO detections VALUES ('legacy',7)")
    monkeypatch.setattr(database,'engine',engine)
    database.migrate_inference_columns();database.migrate_inference_columns()
    with engine.connect() as con:
        assert con.exec_driver_sql('SELECT * FROM detections').first()==('legacy',7,None,None,None,None)
    engine.dispose()


def test_batch_rejects_production_output():
    from scripts.run_field_validation import isolated_output,BACKEND
    for path in [BACKEND,BACKEND/'local_storage',BACKEND/'local_storage/detection_images/subdir']:
        with pytest.raises(ValueError): isolated_output(path,BACKEND/'hen_monitoring.db')


def test_startup_does_not_migrate_existing_db_without_opt_in(tmp_path, monkeypatch):
    from app import database
    from app.config import settings
    engine=create_engine(f'sqlite:///{tmp_path / "protected.db"}')
    with engine.begin() as con:
        con.exec_driver_sql('CREATE TABLE detections (detection_id TEXT)')
    monkeypatch.setattr(database,'engine',engine)
    monkeypatch.setattr(settings,'ENABLE_INFERENCE_MEDIA_MIGRATION',False)
    with pytest.raises(RuntimeError,match='migration disabled'): database.init_db()
    with engine.connect() as con:
        assert [r[1] for r in con.exec_driver_sql('PRAGMA table_info(detections)')]==['detection_id']
        assert len(con.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'").all())==1
    engine.dispose()


def test_commit_failure_rolls_back_and_removes_both_files(media_env, monkeypatch):
    _,db,did,root=media_env
    def fail(): raise RuntimeError('disk full')
    monkeypatch.setattr(db,'commit',fail)
    with pytest.raises(RuntimeError,match='disk full'):
        persist_inference_media(db,db.get(Device,did),frame(),result())
    assert db.scalars(select(Detection)).all()==[]
    assert list(root.rglob('*.png'))==[]
