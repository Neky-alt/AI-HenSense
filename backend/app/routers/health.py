"""
03 §17：GET /api/v1/health —— 检查 Pi / Backend 状态。

这个接口除了自检，还有两个实际用途：
1. Web / App 可以用它判断当前是否在农场局域网内（能通 -> 走 Local API）；
2. 部署到 Pi 之后用来确认服务真的起来了。
"""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.responses import success

router = APIRouter(tags=["system"])


@router.get("/health", summary="Health check")
def health_check(db: Session = Depends(get_db)) -> dict:
    try:
        db.execute(text("SELECT 1"))
        database_ok = True
    except Exception:
        database_ok = False

    return success(
        {
            "status": "ok" if database_ok else "degraded",
            "database": "connected" if database_ok else "unavailable",
            "app_version": settings.APP_VERSION,
            "api_prefix": settings.API_PREFIX,
        }
    )
