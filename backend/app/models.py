"""
核心数据模型。

严格对应 03《数据结构与接口约定》，字段名、类型、枚举一律不得自行改动。
如确需修改：提出 -> Development Lead 确认 -> 修改 03 -> 再改本文件（04 §17）。

字段命名说明：
    03 原稿使用 high_count / high_ratio，团队已确认统一改为
    normal_count / normal_ratio，本文件按确认后的命名实现。

Ratio 说明（03 §2.4）：
    数据库统一保存 0-1 小数（0.82），前端负责显示为 82%。

时间说明（03 §2.3）：
    SQLite 不保存时区信息，因此这里统一保存 **naive UTC**。
    API 输出时再补上 ISO 8601 的 Z 后缀。禁止保存本地时间。
"""

import uuid
from datetime import datetime, time, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.enums import (
    AlertStatus,
    AlertType,
    CaptureSourceType,
    CommandStatus,
    CommandType,
    DetectionMode,
    FarmingType,
    MonitoringStatus,
    StorageLimitAction,
    SyncStatus,
    TriggerType,
    _values,
)


def new_uuid() -> str:
    """03 §2.2：核心 ID 统一使用 UUID。SQLite 无原生 UUID 类型，存为 36 位字符串。"""
    return str(uuid.uuid4())


def utcnow() -> datetime:
    """返回不带时区的 UTC 时间，用于入库。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


# --------------------------------------------------------------------------
# 4. Profile
# --------------------------------------------------------------------------
class Profile(Base):
    """03 §4：用户附加信息。Email / Password 由 Supabase Auth 管理，本表不保存。"""

    __tablename__ = "profiles"

    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    display_name: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    farms: Mapped[list["Farm"]] = relationship(
        back_populates="owner", passive_deletes="all"
    )


# --------------------------------------------------------------------------
# 5. Farm
# --------------------------------------------------------------------------
class Farm(Base):
    """03 §5：MVP 阶段一个 User 对应一个 Farm，但保留这一层关系。"""

    __tablename__ = "farms"

    farm_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("profiles.user_id", ondelete="CASCADE"), nullable=False, index=True
    )
    farm_name: Mapped[str] = mapped_column(Text, nullable=False)
    timezone: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    owner: Mapped["Profile"] = relationship(back_populates="farms")
    devices: Mapped[list["Device"]] = relationship(
        back_populates="farm", passive_deletes="all"
    )
    monitoring_settings: Mapped[list["MonitoringSettings"]] = relationship(
        back_populates="farm", passive_deletes="all"
    )


# --------------------------------------------------------------------------
# 6 & 7. Device
# --------------------------------------------------------------------------
class Device(Base):
    """03 §6：一个 Camera + Raspberry Pi ≈ 一个 Device。

    注意本表 **不保存 device_status**。
    03 §7 规定：只保存 last_seen_at，online/offline/error 由 Backend 计算得出。
    """

    __tablename__ = "devices"

    device_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    farm_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("farms.farm_id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 用户可读编号，如 CAGE-01。与 device_id 是两个不同的东西。
    device_code: Mapped[str] = mapped_column(Text, nullable=False)
    device_name: Mapped[str | None] = mapped_column(Text)
    farming_type: Mapped[str] = mapped_column(String(16), nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            f"farming_type IN ({_values(FarmingType)})", name="ck_devices_farming_type"
        ),
        # device_code 只要求在同一个 Farm 内唯一。不同 Farm 可以各自使用 CAGE-01。
        UniqueConstraint("farm_id", "device_code", name="uq_devices_farm_code"),
    )

    farm: Mapped["Farm"] = relationship(back_populates="devices")
    detections: Mapped[list["Detection"]] = relationship(
        back_populates="device", passive_deletes="all"
    )
    alerts: Mapped[list["Alert"]] = relationship(
        back_populates="device", passive_deletes="all"
    )
    settings: Mapped["DeviceSettings | None"] = relationship(
        back_populates="device", uselist=False, passive_deletes="all"
    )
    storage_settings: Mapped["DeviceStorageSettings | None"] = relationship(
        back_populates="device", uselist=False, passive_deletes="all"
    )
    video_segments: Mapped[list["VideoSegment"]] = relationship(
        back_populates="device", passive_deletes="all"
    )


# --------------------------------------------------------------------------
# 8. Detection
# --------------------------------------------------------------------------
class Detection(Base):
    """03 §8：系统最核心的数据表。每次有效检测产生一条记录。

    03 §8.1 数据规则由下方 CHECK 约束强制执行：
        total_count = normal_count + low_count
        total_count = 0 时，两个 ratio 必须为 NULL（不能写 0）
    """

    __tablename__ = "detections"

    detection_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    device_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("devices.device_id", ondelete="CASCADE"), nullable=False, index=True
    )
    detected_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    trigger_type: Mapped[str] = mapped_column(
        String(32), nullable=False, default=TriggerType.scheduled.value
    )
    capture_source_type: Mapped[str] = mapped_column(
        String(32), nullable=False, default=CaptureSourceType.pi_camera.value
    )

    total_count: Mapped[int] = mapped_column(Integer, nullable=False)
    normal_count: Mapped[int] = mapped_column(Integer, nullable=False)
    low_count: Mapped[int] = mapped_column(Integer, nullable=False)

    # 0-1 小数，不是百分比
    normal_ratio: Mapped[float | None] = mapped_column(Float)
    low_ratio: Mapped[float | None] = mapped_column(Float)

    monitoring_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=MonitoringStatus.normal.value
    )
    confidence: Mapped[float | None] = mapped_column(Float)

    image_path: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text)
    image_deleted_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Additive local inference audit/media extension; old records remain unknown.
    annotated_image_path: Mapped[str | None] = mapped_column(Text)
    ai_instances: Mapped[list | None] = mapped_column(JSON)
    ai_response: Mapped[dict | None] = mapped_column(JSON)
    provenance: Mapped[dict | None] = mapped_column(JSON)

    sync_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=SyncStatus.pending.value, index=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "total_count = normal_count + low_count", name="ck_detections_count_sum"
        ),
        CheckConstraint(
            "total_count >= 0 AND normal_count >= 0 AND low_count >= 0",
            name="ck_detections_count_non_negative",
        ),
        CheckConstraint(
            "normal_ratio IS NULL OR (normal_ratio >= 0 AND normal_ratio <= 1)",
            name="ck_detections_normal_ratio_range",
        ),
        CheckConstraint(
            "low_ratio IS NULL OR (low_ratio >= 0 AND low_ratio <= 1)",
            name="ck_detections_low_ratio_range",
        ),
        # 03 §8.1：没检测到鸡时 ratio 必须为 NULL，不能写 0
        CheckConstraint(
            "total_count > 0 OR (normal_ratio IS NULL AND low_ratio IS NULL)",
            name="ck_detections_zero_count_null_ratio",
        ),
        CheckConstraint(
            f"trigger_type IN ({_values(TriggerType)})",
            name="ck_detections_trigger_type",
        ),
        CheckConstraint(
            f"capture_source_type IN ({_values(CaptureSourceType)})",
            name="ck_detections_capture_source_type",
        ),
        CheckConstraint(
            f"monitoring_status IN ({_values(MonitoringStatus)})",
            name="ck_detections_monitoring_status",
        ),
        CheckConstraint(
            f"sync_status IN ({_values(SyncStatus)})", name="ck_detections_sync_status"
        ),
    )

    device: Mapped["Device"] = relationship(back_populates="detections")
    alerts: Mapped[list["Alert"]] = relationship(
        back_populates="detection", passive_deletes="all"
    )


# --------------------------------------------------------------------------
# 12. Alert
# --------------------------------------------------------------------------
class Alert(Base):
    """03 §12：Alert 必须关联具体 Device，可选关联触发它的 Detection。"""

    __tablename__ = "alerts"

    alert_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    device_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("devices.device_id", ondelete="CASCADE"), nullable=False, index=True
    )
    detection_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("detections.detection_id", ondelete="SET NULL")
    )
    alert_type: Mapped[str] = mapped_column(String(32), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    alert_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=AlertStatus.active.value, index=True
    )
    sync_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=SyncStatus.pending.value
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime)

    __table_args__ = (
        CheckConstraint(f"alert_type IN ({_values(AlertType)})", name="ck_alerts_type"),
        CheckConstraint(f"alert_status IN ({_values(AlertStatus)})", name="ck_alerts_status"),
        CheckConstraint(f"sync_status IN ({_values(SyncStatus)})", name="ck_alerts_sync_status"),
    )

    device: Mapped["Device"] = relationship(back_populates="alerts")
    detection: Mapped["Detection | None"] = relationship(back_populates="alerts")


# --------------------------------------------------------------------------
# 13. Device Settings
# --------------------------------------------------------------------------
class DeviceSettings(Base):
    """03 §13：每个 Device 一套设置。

    Traffic-light Threshold 当前 **不放入本表**（03 §13 明确说明，TBD-05 未确定）。
    """

    __tablename__ = "device_settings"

    device_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("devices.device_id", ondelete="CASCADE"), primary_key=True
    )
    auto_detection_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    detection_mode: Mapped[str] = mapped_column(
        String(16), nullable=False, default=DetectionMode.interval.value
    )
    detection_interval_minutes: Mapped[int | None] = mapped_column(Integer)
    # 固定时间模式，例如 ["08:00", "12:00", "18:00"]
    scheduled_times: Mapped[list | None] = mapped_column(JSON)
    screenshot_interval_minutes: Mapped[int | None] = mapped_column(Integer)
    alert_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            f"detection_mode IN ({_values(DetectionMode)})", name="ck_device_settings_mode"
        ),
    )

    device: Mapped["Device"] = relationship(back_populates="settings")


# --------------------------------------------------------------------------
# 15. Device Command
# --------------------------------------------------------------------------
class DeviceCommand(Base):
    """03 §15：远程 Manual Detection 通过 Cloud Command 下发，避免把 Pi 暴露到公网。

    虽然业务逻辑在 BE-05 才实现，但表结构在 BE-01 一次建好，
    避免后期给 SQLite 加表 / 改表。
    """

    __tablename__ = "device_commands"

    command_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    device_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("devices.device_id", ondelete="CASCADE"), nullable=False, index=True
    )
    command_type: Mapped[str] = mapped_column(String(32), nullable=False)
    command_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=CommandStatus.pending.value, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    executed_at: Mapped[datetime | None] = mapped_column(DateTime)
    result_detection_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("detections.detection_id", ondelete="SET NULL")
    )
    error_message: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint(f"command_type IN ({_values(CommandType)})", name="ck_commands_type"),
        CheckConstraint(
            f"command_status IN ({_values(CommandStatus)})", name="ck_commands_status"
        ),
    )


# --------------------------------------------------------------------------
# 14. Monitoring Settings (V2.0)
# --------------------------------------------------------------------------
class MonitoringSettings(Base):
    """03 V2.0 §14：Farm + farming_type 场景级 Monitoring Settings。"""

    __tablename__ = "monitoring_settings"

    settings_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    farm_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("farms.farm_id", ondelete="CASCADE"), nullable=False, index=True
    )
    farming_type: Mapped[str] = mapped_column(String(16), nullable=False)
    monitoring_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    monitoring_start_time: Mapped[time | None] = mapped_column(Time)
    monitoring_end_time: Mapped[time | None] = mapped_column(Time)
    detection_mode: Mapped[str | None] = mapped_column(String(16))
    detection_interval_minutes: Mapped[int | None] = mapped_column(Integer)
    scheduled_times: Mapped[list | None] = mapped_column(JSON)
    cage_warning_low_ratio_threshold: Mapped[float | None] = mapped_column(Float)
    result_snapshot_interval_minutes: Mapped[int | None] = mapped_column(Integer)
    free_range_warning_low_count_threshold: Mapped[int | None] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint("farm_id", "farming_type", name="uq_monitoring_settings_farm_type"),
        CheckConstraint(
            f"farming_type IN ({_values(FarmingType)})",
            name="ck_monitoring_settings_farming_type",
        ),
        CheckConstraint(
            f"detection_mode IS NULL OR detection_mode IN ({_values(DetectionMode)})",
            name="ck_monitoring_settings_mode",
        ),
        CheckConstraint(
            "cage_warning_low_ratio_threshold IS NULL OR "
            "(cage_warning_low_ratio_threshold >= 0 AND cage_warning_low_ratio_threshold <= 1)",
            name="ck_monitoring_settings_cage_threshold",
        ),
        CheckConstraint(
            "detection_interval_minutes IS NULL OR detection_interval_minutes >= 1",
            name="ck_monitoring_settings_detection_interval",
        ),
        CheckConstraint(
            "result_snapshot_interval_minutes IS NULL OR result_snapshot_interval_minutes >= 1",
            name="ck_monitoring_settings_snapshot_interval",
        ),
        CheckConstraint(
            "free_range_warning_low_count_threshold IS NULL OR free_range_warning_low_count_threshold >= 0",
            name="ck_monitoring_settings_free_threshold",
        ),
    )

    farm: Mapped["Farm"] = relationship(back_populates="monitoring_settings")


# --------------------------------------------------------------------------
# 15. Device Storage Settings
# --------------------------------------------------------------------------
class DeviceStorageSettings(Base):
    """03 V2.0 §15：每台 Device 独立的媒体保存/保留策略。"""

    __tablename__ = "device_storage_settings"

    device_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("devices.device_id", ondelete="CASCADE"), primary_key=True
    )
    store_detection_images: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    detection_image_retention_days: Mapped[int | None] = mapped_column(Integer)
    store_video_locally: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    video_retention_days: Mapped[int | None] = mapped_column(Integer)
    max_media_storage_gb: Mapped[float] = mapped_column(Float, nullable=False, default=80.0)
    storage_limit_action: Mapped[str] = mapped_column(
        String(32), nullable=False, default=StorageLimitAction.delete_oldest.value
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            f"storage_limit_action IN ({_values(StorageLimitAction)})",
            name="ck_device_storage_settings_action",
        ),
        CheckConstraint("max_media_storage_gb > 0", name="ck_device_storage_settings_max"),
        CheckConstraint(
            "detection_image_retention_days IS NULL OR detection_image_retention_days >= 1",
            name="ck_device_storage_settings_image_retention",
        ),
        CheckConstraint(
            "video_retention_days IS NULL OR video_retention_days >= 1",
            name="ck_device_storage_settings_video_retention",
        ),
    )

    device: Mapped["Device"] = relationship(back_populates="storage_settings")


# --------------------------------------------------------------------------
# 16. Notification Settings
# --------------------------------------------------------------------------
class NotificationSettings(Base):
    """03 V2.0 §16：通知偏好与 Alert 生成规则分离。"""

    __tablename__ = "notification_settings"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("profiles.user_id", ondelete="CASCADE"), primary_key=True
    )
    in_app_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    email_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    push_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )


# --------------------------------------------------------------------------
# 12. Video Segment metadata
# --------------------------------------------------------------------------
class VideoSegment(Base):
    """03 V2.0 §12：Free-range local video segment metadata；视频文件本身不进 DB。"""

    __tablename__ = "video_segments"

    video_segment_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    device_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("devices.device_id", ondelete="CASCADE"), nullable=False, index=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    ended_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    local_path: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    device: Mapped["Device"] = relationship(back_populates="video_segments")
