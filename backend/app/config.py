"""
应用配置。

所有可变配置集中在这里，禁止在业务代码里写死。
特别是 03 文档中仍为 TBD 的阈值（Traffic-light Threshold / Device Offline 判定时间），
必须以配置项形式存在，等 Client / AI Team / Hardware 确认后只改这里一处。
"""

from pathlib import Path
import os

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/ 目录
BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=os.environ.get("HENSENSE_ENV_FILE", BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ---------- 基础 ----------
    APP_NAME: str = "Hen Monitoring API"
    APP_VERSION: str = "0.1.0"

    # 03 §17：统一 API Prefix
    API_PREFIX: str = "/api/v1"

    # ---------- 数据库 ----------
    # 02 §8：Local Database 统一使用 SQLite
    DATABASE_URL: str = f"sqlite:///{BASE_DIR / 'hen_monitoring.db'}"

    ENABLE_INFERENCE_MEDIA_MIGRATION: bool = False

    # ---------- CORS ----------
    # Web (Vite 默认 5173) 需要跨域访问本 API；React Native 不受同源策略限制。
    CORS_ORIGINS: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:3000,http://localhost:8081"
    )

    # ---------- 03 §7 / TBD-04：Device Offline 判定 ----------
    # 超过这个分钟数没有收到设备心跳，则判定为 offline。
    # 当前为占位值，等 Hardware + Development 确认后修改。
    DEVICE_OFFLINE_THRESHOLD_MINUTES: int = 15

    # ---------- BE-03：AI service / capture boundary ----------
    # AI Team 的推理服务独立运行，新版 AI 交接包默认 8000；本地双服务联调时改用 8002 避免与 Backend 冲突。
    AI_SERVICE_URL: str = "http://127.0.0.1:8002"
    AI_SERVICE_TIMEOUT_SECONDS: float = 120.0

    # Camera 硬件实现仍由 Hardware + Development 对接。默认不伪造拍摄结果。
    # 本地真模型联调时显式使用 test_file，并读取下面的测试图片。
    CAPTURE_ADAPTER_MODE: str = "unconfigured"
    CAPTURE_TEST_IMAGE_PATH: str = "test_assets/be03_sample.jpg"

    # Local-first retained Detection Images; media files never belong in SQLite.
    LOCAL_IMAGE_DIR: str = str(BASE_DIR / "local_storage" / "detection_images")
    MAX_DETECTION_IMAGE_BYTES: int = 10 * 1024 * 1024

    # ---------- Supabase（BE-04 才会用到，先留空） ----------
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""
    # Auth only; Quick Detection does not sync records to Supabase.
    SUPABASE_PUBLISHABLE_KEY: str = ""

    # BE-04: cloud read endpoints are opt-in and require a verified Supabase token.
    BE04_CLOUD_READ_ENABLED: bool = False
    BE04_FARM_ID: str = ""
    BE04_OWNER_USER_ID: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()
