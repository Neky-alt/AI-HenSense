"""BE-01 验收测试：表结构符合 03，且数据规则约束真的生效。"""

from datetime import datetime

import pytest
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Alert, Detection, Device, DeviceSettings, Farm, Profile

EXPECTED_TABLES = {
    "profiles",
    "farms",
    "devices",
    "detections",
    "alerts",
    "device_settings",
    "device_commands",
}

# 03 §22 明确规定不建立的重复表
FORBIDDEN_TABLES = {
    "history",
    "detection_history",
    "device_history",
    "screenshot",
    "screenshots",
    "dashboard",
    "home_data",
    "dashboard_statistics",
    "traffic_light",
    "roles",
    "permissions",
}


@pytest.fixture
def session():
    """每个测试用独立的内存数据库，互不影响。"""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    yield db
    db.close()


def _seed_device(db) -> Device:
    profile = Profile(user_id="u-1", display_name="Tester")
    farm = Farm(farm_id="f-1", user_id="u-1", farm_name="Test Farm")
    device = Device(
        device_id="d-1",
        farm_id="f-1",
        device_code="CAGE-01",
        device_name="Cage 1",
        farming_type="caged",
    )
    db.add_all([profile, farm, device])
    db.commit()
    return device


def test_all_expected_tables_created(session):
    tables = set(inspect(session.get_bind()).get_table_names())
    assert EXPECTED_TABLES.issubset(tables)


def test_no_forbidden_duplicate_tables(session):
    """03 §22：不允许建 History / Screenshot / Dashboard 等重复表。"""
    tables = set(inspect(session.get_bind()).get_table_names())
    assert tables & FORBIDDEN_TABLES == set()


def test_detection_uses_normal_naming_not_high(session):
    """团队已确认统一用 normal_*，不应再出现 high_*。"""
    columns = {c["name"] for c in inspect(session.get_bind()).get_columns("detections")}
    assert {"normal_count", "normal_ratio", "low_count", "low_ratio"}.issubset(columns)
    assert "high_count" not in columns
    assert "high_ratio" not in columns


def test_device_table_has_no_device_status_column(session):
    """03 §7：device_status 由 Backend 根据 last_seen_at 计算，不入库。"""
    columns = {c["name"] for c in inspect(session.get_bind()).get_columns("devices")}
    assert "last_seen_at" in columns
    assert "device_status" not in columns


def test_valid_detection_can_be_saved(session):
    _seed_device(session)
    session.add(
        Detection(
            device_id="d-1",
            detected_at=datetime(2026, 9, 9, 3, 30),
            total_count=22,
            normal_count=18,
            low_count=4,
            normal_ratio=18 / 22,
            low_ratio=4 / 22,
            monitoring_status="normal",
        )
    )
    session.commit()

    saved = session.query(Detection).one()
    assert saved.total_count == 22
    assert 0 <= saved.normal_ratio <= 1  # 小数不是百分比
    assert saved.sync_status == "pending"  # 03 §20：新记录默认待同步


def test_count_sum_rule_is_enforced(session):
    """03 §8.1：total_count 必须等于 normal_count + low_count。"""
    _seed_device(session)
    session.add(
        Detection(
            device_id="d-1",
            detected_at=datetime(2026, 9, 9, 3, 30),
            total_count=30,  # 错的：18 + 4 = 22
            normal_count=18,
            low_count=4,
        )
    )
    with pytest.raises(IntegrityError):
        session.commit()


def test_zero_count_must_have_null_ratio(session):
    """03 §8.1：没检测到鸡时 ratio 必须是 NULL，不能写 0。"""
    _seed_device(session)
    session.add(
        Detection(
            device_id="d-1",
            detected_at=datetime(2026, 9, 9, 3, 30),
            total_count=0,
            normal_count=0,
            low_count=0,
            normal_ratio=0.0,  # 错的：应该是 None
            low_ratio=0.0,
        )
    )
    with pytest.raises(IntegrityError):
        session.commit()


def test_zero_count_with_null_ratio_is_allowed(session):
    _seed_device(session)
    session.add(
        Detection(
            device_id="d-1",
            detected_at=datetime(2026, 9, 9, 3, 30),
            total_count=0,
            normal_count=0,
            low_count=0,
            normal_ratio=None,
            low_ratio=None,
        )
    )
    session.commit()
    assert session.query(Detection).one().normal_ratio is None


def test_invalid_farming_type_rejected(session):
    """03 §6：只允许 caged / free_range。"""
    session.add_all([Profile(user_id="u-2"), Farm(farm_id="f-2", user_id="u-2", farm_name="F2")])
    session.commit()
    session.add(
        Device(farm_id="f-2", device_code="FREE-01", farming_type="free-range")  # 错的写法
    )
    with pytest.raises(IntegrityError):
        session.commit()


def test_ratio_out_of_range_rejected(session):
    """Ratio 必须是 0-1 小数，写成 82 这种百分比会被拒绝。"""
    _seed_device(session)
    session.add(
        Detection(
            device_id="d-1",
            detected_at=datetime(2026, 9, 9, 3, 30),
            total_count=22,
            normal_count=18,
            low_count=4,
            normal_ratio=82,  # 错的：百分比
            low_ratio=18,
        )
    )
    with pytest.raises(IntegrityError):
        session.commit()


def test_device_code_is_globally_unique(session):
    """2026-10-03 决定：device_code 全局唯一，不同 Farm 也不能使用相同编号。"""
    session.add_all(
        [
            Profile(user_id="u-a"),
            Profile(user_id="u-b"),
            Farm(farm_id="f-a", user_id="u-a", farm_name="Farm A"),
            Farm(farm_id="f-b", user_id="u-b", farm_name="Farm B"),
        ]
    )
    session.commit()

    session.add(
        Device(
            device_id="d-a",
            farm_id="f-a",
            device_code="CAGE-01",
            farming_type="caged",
        )
    )
    session.commit()

    session.add(
        Device(
            device_id="d-b",
            farm_id="f-b",
            device_code="CAGE-01",
            farming_type="caged",
        )
    )
    with pytest.raises(IntegrityError):
        session.commit()


def test_delete_device_uses_database_cascade(session):
    """删除 Device 时，SQLite FK cascade 应删除强依赖记录，而不是把非空 FK 置 NULL。"""
    _seed_device(session)

    detection = Detection(
        detection_id="det-1",
        device_id="d-1",
        detected_at=datetime(2026, 9, 9, 3, 30),
        total_count=22,
        normal_count=18,
        low_count=4,
        normal_ratio=18 / 22,
        low_ratio=4 / 22,
        monitoring_status="normal",
    )
    alert = Alert(
        alert_id="a-1",
        device_id="d-1",
        detection_id="det-1",
        alert_type="low_production_warning",
        message="Test alert",
    )
    settings = DeviceSettings(device_id="d-1")
    session.add_all([detection, alert, settings])
    session.commit()

    device = session.get(Device, "d-1")
    session.delete(device)
    session.commit()

    assert session.get(Device, "d-1") is None
    assert session.get(Detection, "det-1") is None
    assert session.get(Alert, "a-1") is None
    assert session.get(DeviceSettings, "d-1") is None


def test_delete_profile_cascades_farm_and_device_tree(session):
    """顶层 Profile 删除时，DB 级联应能贯穿 Farm -> Device -> Detection。"""
    _seed_device(session)
    session.add(
        Detection(
            detection_id="det-profile-delete",
            device_id="d-1",
            detected_at=datetime(2026, 9, 9, 3, 30),
            total_count=1,
            normal_count=1,
            low_count=0,
            normal_ratio=1.0,
            low_ratio=0.0,
            monitoring_status="normal",
        )
    )
    session.commit()

    profile = session.get(Profile, "u-1")
    session.delete(profile)
    session.commit()

    assert session.get(Profile, "u-1") is None
    assert session.get(Farm, "f-1") is None
    assert session.get(Device, "d-1") is None
    assert session.get(Detection, "det-profile-delete") is None
