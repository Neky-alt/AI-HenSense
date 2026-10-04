# 部署指南

[返回 README](../README.md) · [交接清单](HANDOVER.md) · [Pi Worker](PI_WORKER.md)

命令同时给出 Windows（`cmd`）和 macOS 写法。每组命令从仓库根目录的新终端开始。

## 1. 准备

| 组件 | 版本 | 说明 |
|---|---|---|
| Python | 3.12 – 3.14 | Windows 3.12 已验证可安装并通过测试；文档最初验证于 3.14.3 |
| Node | 24.x | Web / Mobile 使用各自 lockfile |
| Git | 任意近期版本 | 从团队确认的分支检出 |

仓库**不包含**：Supabase 密钥、SQLite 数据库、媒体文件、模型权重、签名材料。这些按 [交接清单](HANDOVER.md) 私下获取。

## 2. 安装依赖

Backend：

```bat
cd backend
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env.runtime
```

```sh
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp -n .env.example .env.runtime
```

`requirements.txt` 已包含 `tzdata`。Windows 自带的 Python 没有时区数据库，缺了它自动监测会一直返回 `invalid_farm_timezone`。

Web：

```bat
cd web
npm ci
copy .env.example .env.local
```

AI 服务（只有 Quick Detection 和 Backend `/detect` 需要）：`ai_service/hen_repro` 下同样建 venv、安装 `requirements.txt`，复制 `.env.example` 为 `.env`，并放入三份权重。Pi Worker 的安装见 [PI_WORKER](PI_WORKER.md)。

## 3. 数据库：二选一

### 3.1 推荐：从云端演示数据生成数据包

`scripts/build_demo_pack.py` 读取 Supabase 中指定 Farm 的全部数据（Farm、Device、Detection、Alert、设置、图片），生成本地 SQLite 和媒体目录。UUID 与云端完全相同，所以登录用户能通过本地权限校验，Worker 也不会重复上传。

前提：`.env.runtime` 已填 `SUPABASE_URL`、`SUPABASE_KEY`（secret key，见第 4 节）。

```bat
cd backend
.venv\Scripts\python -m scripts.build_demo_pack --farm-id <FARM_UUID> --out D:/HenSenseData/demo-v1
.venv\Scripts\python -m scripts.build_demo_pack --farm-id <FARM_UUID> --out D:/HenSenseData/demo-v1 --apply
```

- 第一条是试运行，只打印将导入的 Farm、设备、各表行数和警告，不写任何文件。
- 第二条生成 `database.sqlite3`、`media/`、`manifest.json`（数量和每个文件的 SHA-256），并依次检查完整性、外键和 Backend 启动预检。
- 输出目录必须是新目录，脚本从不覆盖。`--farm-id` 可以重复。
- 跑完会打印 `DATABASE_URL` 和 `LOCAL_IMAGE_DIR` 两行，复制进 `.env.runtime`。

当前团队演示 Farm：`91000000-0000-0000-0000-000000000001`，owner `011f1bfb-ac10-424b-b687-52baf06eddc1`，4 台设备（CAGE-01/02/03、FREE-01）、15 条检测、30 张图片。登录 Web 必须用这个 owner 账户。

### 3.2 全新空库

只建表，不含 Farm / Device。用户登录后列表为空，添加设备会返回 `FARM_NOT_FOUND`，因为没有 Farm 自助开通。只在需要干净环境时使用：

```bat
cd backend
mkdir D:\HenSenseData\empty-v1\media
set DATABASE_URL=sqlite:///D:/HenSenseData/empty-v1/database.sqlite3
.venv\Scripts\python -c "from sqlalchemy import create_engine; from app.database import Base; from app import models; from app.quick_models import QuickBase; e=create_engine(r'%DATABASE_URL%'); Base.metadata.create_all(e); QuickBase.metadata.create_all(e)"
```

### 3.3 已有旧数据库：设备编号全局唯一迁移

2026-10-03 起 `device_code` 全局唯一。新库自动带约束；旧库运行（先停 Backend 和 Worker）：

```bat
.venv\Scripts\python -m scripts.migrate_device_code_unique --database D:/HenSenseData/old/database.sqlite3
.venv\Scripts\python -m scripts.migrate_device_code_unique --database D:/HenSenseData/old/database.sqlite3 --apply
```

第一条只报告重复编号；有重复时 `--apply` 拒绝执行。`--apply` 会先自动备份数据库。

## 4. 配置

### Supabase 密钥

| 变量 | 填什么 | 放在哪 |
|---|---|---|
| `SUPABASE_URL` | `https://<项目>.supabase.co` | Backend、Web、Mobile 相同 |
| `SUPABASE_PUBLISHABLE_KEY` / `VITE_…` / `EXPO_PUBLIC_…` | publishable key（`sb_publishable_…`，旧称 anon key） | 可以进前端 |
| `SUPABASE_KEY` | **secret key**（`sb_secret_…`，替代旧 service_role，绕过 RLS） | **只放 `backend/.env.runtime`** |

secret key 不能出现在任何 `VITE_` / `EXPO_PUBLIC_` 变量、截图、聊天或 Git 中。

### `backend/.env.runtime`

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | `sqlite:///D:/HenSenseData/demo-v1/database.sqlite3`（绝对路径，正斜杠） |
| `LOCAL_IMAGE_DIR` | `D:/HenSenseData/demo-v1/media` |
| `BACKEND_HOST` / `BACKEND_PORT` | `0.0.0.0` / `8006`（手机和 Pi 通过 LAN IP 访问） |
| `CORS_ORIGINS` | Web 实际 origin，逗号分隔 |
| `HARDWARE_API_KEY` | Pi 与 Backend 共享的密钥；自己生成，两边一致。不要使用 `.env.example` 里那串旧值 |
| `AI_SERVICE_URL` | `http://127.0.0.1:8004` |
| `BE04_FARM_ID` / `BE04_OWNER_USER_ID` | Worker 同步的 Farm 和 owner |
| `DEVICE_CLOUD_WRITE_ENABLED` | 默认 `false`。`true` 时添加设备和彻底删除会先同步写 Supabase，云端不可达返回 503。**Supabase 的 `devices.device_code` 唯一约束建好之前保持 `false`** |
| `CAPTURE_ADAPTER_MODE` | `unconfigured`（Backend 自己不拍照；拍照由 Pi 完成） |
| `DEVICE_OFFLINE_THRESHOLD_MINUTES` | 默认 15 |

可选调整（代码默认值，一般不改）：`DETECTION_IMAGE_RETENTION_DAYS=30`、`COMMAND_RUNNING_TIMEOUT_SECONDS=300`、`COMMAND_PENDING_TIMEOUT_SECONDS=600`、`MONITORING_SAMPLE_LEASE_SECONDS=300`。

### `web/.env.local`

`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`VITE_DATA_SOURCE=local`、`VITE_API_BASE_URL=http://127.0.0.1:8006`。`cloud` 模式直连 Supabase，只读：设备管理、设置保存、Run Detection Now、历史删除按钮都会隐藏。

## 5. 启动与停止

| 服务 | 目录 | 命令（Windows） |
|---|---|---|
| Backend | `backend/` | `.venv\Scripts\python -m scripts.start_backend --check`，通过后去掉 `--check` |
| Web | `web/` | `npm run dev` |
| Worker 状态 | `backend/` | `.venv\Scripts\python -m scripts.start_worker --status` |
| Worker 同步 | `backend/` | `.venv\Scripts\python -m scripts.start_worker --apply --watch` |
| AI | `ai_service/hen_repro/` | `.venv\Scripts\python start_service.py` |
| Pi Worker | Pi 上 `pi_worker/` | 见 [PI_WORKER](PI_WORKER.md) |

- 禁止直接用 `uvicorn` 启动 Backend，禁止 `--reload`。标准启动只运行一个进程（监测时段占位记在内存里）。
- 每个数据库只运行一个 Worker；Worker 用文件锁保证这一点（Windows / macOS 都支持）。
- 历史删除和 30 天到期产生的云端图片删除由 Worker 执行；Worker 不运行时云端副本会延后删除。
- “移除并删除全部历史”只有在 `DEVICE_CLOUD_WRITE_ENABLED=true` 时才会同时删除云端；为 `false` 时只删本地，云端记录会留下（Worker 不同步硬删除）。
- 停止：在各自终端按 Ctrl-C。

## 6. 健康检查

```bat
curl http://127.0.0.1:8006/api/v1/health
curl http://127.0.0.1:5173/
```

Backend 返回 200 后再看 `data.status`、`data.database`。手机和 Pi 用开发电脑的 LAN IP，不能用 `localhost`。

## 7. 常见问题

| 现象 | 处理 |
|---|---|
| `Startup refused` | 数据库 / 媒体路径不存在、不是绝对路径、缺表或缺图片；不要改指旧库 |
| 登录后列表为空 | 当前账户不是该 Farm 的 owner；换 owner 账户登录 |
| 401 / 503 | Supabase URL / publishable key 不一致、Token 过期、Supabase 不可达 |
| 添加设备 `FARM_NOT_FOUND` | 本地库没有该用户的 Farm（空库或账户不对） |
| 添加设备 `CLOUD_UNAVAILABLE` | 打开了 `DEVICE_CLOUD_WRITE_ENABLED` 但 secret key 缺失或云端不可达 |
| 自动监测不触发，reason=`invalid_farm_timezone` | 没装 `tzdata`（Windows） |
| 设备一直 Offline | Pi 没有心跳：检查 Pi 的 `HENSENSE_BACKEND_URL`、`HENSENSE_DEVICE_ID`、`HARDWARE_API_KEY` |
| 命令失败 “Device did not report a result in time” | Pi 超过 5 分钟没回报；真机推理更慢时调大 `COMMAND_RUNNING_TIMEOUT_SECONDS` |
| Worker 报 already running | 同一数据库已有 Worker；先停掉旧进程 |
| 端口占用 | 确认并停止自己的旧进程，不随意换端口 |
