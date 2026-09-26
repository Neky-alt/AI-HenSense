"""Explicit, additive migration. Never invoked by application startup."""
import argparse
from pathlib import Path
from sqlalchemy import create_engine
from app.quick_models import QuickBase

def migrate(path):
    path=Path(path).resolve()
    if not path.is_file():raise ValueError('Existing database copy required')
    if path.name=='hen_monitoring.db' or 'db01' in path.parts or 'backup' in path.parts or 'field_validation-20260924' in path.parts:
        raise ValueError('Protected database: migrate an independent working copy')
    engine=create_engine(f'sqlite:///{path}')
    try:
        with engine.begin() as conn:
            QuickBase.metadata.create_all(conn)
            assert conn.exec_driver_sql('PRAGMA integrity_check').scalar()=='ok'
    finally:engine.dispose()
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--database',required=True);args=p.parse_args();migrate(args.database);print('Quick Detection schema ready; existing tables untouched.')
