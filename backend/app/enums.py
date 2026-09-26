"""
系统统一枚举值。

全部来自 03《数据结构与接口约定》。
禁止在其它文件里直接写字符串字面量（例如 "free-range"、"Online"），
一律引用这里的枚举，避免出现同义不同写法。
"""

from enum import Enum


class FarmingType(str, Enum):
    """03 §6：只允许 caged / free_range，不允许 free-range、freeRange、cage。"""

    caged = "caged"
    free_range = "free_range"


class DeviceStatus(str, Enum):
    """03 §7：设备自身运行状态。不入库，由 Backend 根据 last_seen_at 计算。"""

    online = "online"
    offline = "offline"
    error = "error"


class MonitoringStatus(str, Enum):
    """03 V2.0 §9：鸡群生产状态只允许 normal / warning。"""

    normal = "normal"
    warning = "warning"


class TriggerType(str, Enum):
    """03 V2.0 §8：正式 Detection 的触发来源。"""

    scheduled = "scheduled"
    manual = "manual"
    free_range_snapshot = "free_range_snapshot"
    upload = "upload"


class CaptureSourceType(str, Enum):
    """03 V2.0 §8：Detection 的图像采集源。"""

    pi_camera = "pi_camera"
    mobile_camera = "mobile_camera"
    file_upload = "file_upload"


class SyncStatus(str, Enum):
    """03 §20 / 02 §12.1：本地记录的云同步状态。"""

    pending = "pending"
    synced = "synced"
    failed = "failed"


class AlertType(str, Enum):
    """03 §12：当前仅这四种，新增必须先改 03。"""

    low_production_warning = "low_production_warning"
    device_offline = "device_offline"
    detection_failed = "detection_failed"
    stale_data = "stale_data"


class AlertStatus(str, Enum):
    active = "active"
    resolved = "resolved"


class DetectionMode(str, Enum):
    """03 §13：自动检测模式。"""

    interval = "interval"
    scheduled = "scheduled"


class StorageLimitAction(str, Enum):
    """03 V2.0 §15：达到媒体上限后的处理策略。"""

    delete_oldest = "delete_oldest"
    stop_recording = "stop_recording"


class CommandType(str, Enum):
    """03 §15：远程命令类型。"""

    manual_detection = "manual_detection"
    manual_screenshot = "manual_screenshot"


class CommandStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


def _values(enum_cls: type[Enum]) -> str:
    """生成 SQLite CHECK 约束用的取值列表，例如 "'caged','free_range'"。"""
    return ",".join(f"'{m.value}'" for m in enum_cls)
