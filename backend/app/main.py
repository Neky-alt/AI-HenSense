"""FastAPI routes. Standard runtime: python -m scripts.start_backend.

The standard launcher preflights an explicit existing database and disables
this legacy initialization lifespan. Do not launch app.main directly against
accepted data; init_db remains available for legacy explicit test workflows.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.quick_upload_limit import QuickUploadLimit
from app.database import init_db
from app.responses import failure
from app.routers import (
    dashboard,
    devices,
    health,
    settings_storage,
    quick_detections,
    be04_cloud,
    be04_status,
    hardware,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时确保表存在（已存在则跳过）
    init_db()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(QuickUploadLimit)

# ---------------------------------------------------------------------------
# CORS：Web 端（React + Vite）跨域访问本 API 必须配置，否则浏览器会拦截。
# React Native 不受同源策略限制，不需要额外处理。
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# 异常处理：FastAPI 默认返回 {"detail": "..."}，这违反 03 §18 的统一格式。
# 这里全部转换成 {"success": false, "data": null, "error": {...}}。
# ---------------------------------------------------------------------------
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    code_map = {
        404: "NOT_FOUND",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        405: "METHOD_NOT_ALLOWED",
        422: "VALIDATION_ERROR",
    }
    return JSONResponse(
        status_code=exc.status_code,
        content=failure(code_map.get(exc.status_code, "HTTP_ERROR"), str(exc.detail)),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content=failure("VALIDATION_ERROR", "Request validation failed"),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content=failure("INTERNAL_ERROR", "Internal server error"),
    )


# ---------------------------------------------------------------------------
# 路由挂载：所有接口统一使用 /api/v1 前缀（03 §17）
# ---------------------------------------------------------------------------
app.include_router(health.router, prefix=settings.API_PREFIX)
app.include_router(devices.router, prefix=settings.API_PREFIX)
app.include_router(dashboard.router, prefix=settings.API_PREFIX)
app.include_router(settings_storage.router, prefix=settings.API_PREFIX)
app.include_router(hardware.router, prefix=settings.API_PREFIX)
app.include_router(quick_detections.router, prefix=settings.API_PREFIX)

# Enable only after SUPABASE_URL / server key / publishable key are configured.
if settings.BE04_CLOUD_READ_ENABLED:
    app.include_router(be04_cloud.router, prefix=settings.API_PREFIX)
    app.include_router(be04_status.router, prefix=settings.API_PREFIX)
