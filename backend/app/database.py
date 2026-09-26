"""
SQLite 连接与 Session 管理（02 §8）。
"""

from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

# check_same_thread=False：FastAPI 在多线程中处理请求，SQLite 默认不允许跨线程复用连接
engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)


@event.listens_for(engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection, connection_record) -> None:
    """SQLite 默认不强制外键，必须每个连接显式打开，否则 ForeignKey 形同虚设。"""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""


def get_db() -> Generator[Session, None, None]:
    """FastAPI 依赖注入用：每个请求一个 Session，请求结束自动关闭。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _migrate_be01_detection_columns() -> None:
    """Upgrade the existing BE-01 SQLite Detection table in-place.

    ``create_all`` does not alter an existing SQLite table. The uploaded BE-01 database
    used ``screenshot_*`` names and did not yet contain the V2.0 trigger/source/tombstone
    fields. BE-02 must keep that database usable rather than forcing a project/database
    rebuild, so we apply only additive/rename-safe SQLite changes when needed.
    """
    with engine.begin() as connection:
        table_exists = connection.exec_driver_sql(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='detections'"
        ).first()
        if table_exists is None:
            return

        columns = {
            row[1] for row in connection.exec_driver_sql("PRAGMA table_info(detections)").all()
        }

        if "screenshot_path" in columns and "image_path" not in columns:
            connection.exec_driver_sql(
                "ALTER TABLE detections RENAME COLUMN screenshot_path TO image_path"
            )
            columns.remove("screenshot_path")
            columns.add("image_path")

        if "screenshot_url" in columns and "image_url" not in columns:
            connection.exec_driver_sql(
                "ALTER TABLE detections RENAME COLUMN screenshot_url TO image_url"
            )
            columns.remove("screenshot_url")
            columns.add("image_url")

        additions = {
            "trigger_type": (
                "ALTER TABLE detections ADD COLUMN trigger_type VARCHAR(32) "
                "NOT NULL DEFAULT 'scheduled'"
            ),
            "capture_source_type": (
                "ALTER TABLE detections ADD COLUMN capture_source_type VARCHAR(32) "
                "NOT NULL DEFAULT 'pi_camera'"
            ),
            "image_deleted_at": (
                "ALTER TABLE detections ADD COLUMN image_deleted_at DATETIME"
            ),
            "deleted_at": "ALTER TABLE detections ADD COLUMN deleted_at DATETIME",
        }
        for column_name, ddl in additions.items():
            if column_name not in columns:
                connection.exec_driver_sql(ddl)



def _migrate_be05_farm_timezone() -> None:
    """Add the V2.0 optional Farm timezone column without rebuilding existing data."""
    with engine.begin() as connection:
        table_exists = connection.exec_driver_sql(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='farms'"
        ).first()
        if table_exists is None:
            return
        columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(farms)").all()}
        if "timezone" not in columns:
            connection.exec_driver_sql("ALTER TABLE farms ADD COLUMN timezone TEXT")


def migrate_inference_columns() -> None:
    """Explicitly enabled additive migration; never applied implicitly to old databases."""
    with engine.begin() as connection:
        columns = {r[1] for r in connection.exec_driver_sql("PRAGMA table_info(detections)")}
        for name, kind in {"annotated_image_path": "TEXT", "ai_instances": "JSON", "ai_response": "JSON", "provenance": "JSON"}.items():
            if name not in columns:
                connection.exec_driver_sql(f"ALTER TABLE detections ADD COLUMN {name} {kind}")


def init_db() -> None:
    """Create missing tables and apply the small BE-01 -> V2.0 compatibility upgrade."""
    from app import models  # noqa: F401  确保模型被注册到 Base.metadata

    # Fail before any DDL when an existing database has not opted into this migration.
    with engine.connect() as connection:
        columns = {r[1] for r in connection.exec_driver_sql("PRAGMA table_info(detections)")}
    required = {"annotated_image_path", "ai_instances", "ai_response", "provenance"}
    if columns and not required.issubset(columns) and not settings.ENABLE_INFERENCE_MEDIA_MIGRATION:
        raise RuntimeError("Inference media migration disabled: use an isolated database or explicitly enable ENABLE_INFERENCE_MEDIA_MIGRATION after backup")
    Base.metadata.create_all(bind=engine)
    _migrate_be01_detection_columns()
    _migrate_be05_farm_timezone()
    if settings.ENABLE_INFERENCE_MEDIA_MIGRATION:
        migrate_inference_columns()
