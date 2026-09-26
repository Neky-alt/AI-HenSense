# 部署指南

[返回 README](../README.md) · [交接清单](HANDOVER.md)

## 1. 全新电脑准备

从团队确认的最终 GitHub 仓库取得完整发布目录；仓库 URL、发布版本由负责人提供。以下所有组件命令块均从仓库根目录的新终端开始。不要依赖他人的虚拟环境、node_modules、绝对路径或开发客户端。

负责人提供最终仓库地址后，可在目标父目录执行以下命令；不要在现有项目内再次克隆，也不要使用未确认的旧发布内容：

```sh
# Set REPOSITORY_URL privately to the approved GitHub URL before running.
: "${REPOSITORY_URL:?Set the approved GitHub repository URL}"
git clone "$REPOSITORY_URL" COMP-DATA-5703
cd COMP-DATA-5703
```

本阶段只记录命令，没有执行 clone 或任何 Git 操作。

建议复现已验证的 Node 24.20.0、Python 3.14.3。先检查 `node --version`、`npm --version`、`python3.14 --version`。macOS iOS 构建需安装并初始化 Xcode、Command Line Tools、模拟器和签名团队；实际 SDK 与 Xcode 兼容版本需在新电脑核验。不要为通过安装擅自升级 Expo 或模型依赖。

| 仓库内可取得 | 必须另外准备 | 缺少时的影响 |
|---|---|---|
| Web/Mobile 源码、package-lock.json | Supabase 项目 URL、公钥、自己的应用账户 | 不能完成认证和授权访问 |
| Backend 源码、requirements.txt | 新空库或经批准的数据包 | Backend 预检拒绝不存在的 DB |
| 媒体服务实现 | 与数据库匹配的媒体文件 | 有图片路径却缺文件时预检失败 |
| AI 源码、requirements.txt | 三份批准的模型权重 | 推理服务不能提供完整检测 |
| `.env.example` | 本机路径、LAN 地址、实际配置 | 占位符不能直接用于运行 |
| Expo 原生配置与插件 | Xcode、签名、首次开发客户端 | 不能直接在新 iPhone 运行开发版本 |
| Worker | 服务端高权限密钥、确认的 Farm/owner | 不能启用云同步 |

仅 Cloud 监测不需要本地演示数据或 AI。Quick Detection 上传需要 Backend、SQLite/媒体和 AI；自身历史仍依赖同一个 Backend。公开互联网部署所需的 TLS、域名、反向代理、限流和持续运行服务没有随当前 Mac 开发启动方式提供。

## 2. 安装依赖

```sh
cd backend
python3.14 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp -n .env.example .env.runtime
```

```sh
cd ai_service/hen_repro
python3.14 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp -n .env.example .env
```

```sh
cd web
npm ci
cp -n .env.example .env.local
```

```sh
cd mobile
npm ci
cp -n .env.example .env.local
```

`cp -n` 不覆盖既有文件。AI 有范围版本依赖，尚无完全锁定的跨机器依赖清单；第一阶段验证的是既有环境，未完成全新 Mac 下载安装。禁止把“本机测试通过”理解为任意 Python/Xcode 都兼容。

## 3. 数据库首次初始化：两条不同路径

### 3.1 全新空库，不使用验收库作模板

标准启动入口不初始化数据库；仓库目前没有独立的生产建库 CLI。现有模型提供 `Base.metadata` 和独立的 `QuickBase.metadata`，测试使用它们创建全新结构。以下是基于实际模型的**显式一次性空库初始化**，仅在全新目录执行，不能用于升级旧库。本阶段仅编写步骤，未运行这些写库命令。

从仓库根目录的新终端执行；目录已存在时整个命令组会失败，不会覆盖：

```sh
set -eu
cd backend
DATA_DIR="$HOME/HenSenseData/installation-v1"
mkdir -p "$HOME/HenSenseData"
mkdir "$DATA_DIR"
mkdir "$DATA_DIR/media"
export DATABASE_URL="sqlite:///$DATA_DIR/database.sqlite3"
export LOCAL_IMAGE_DIR="$DATA_DIR/media"
.venv/bin/python - <<'PY'
import os
from pathlib import Path
from sqlalchemy import create_engine
from app.database import Base
from app import models
from app.quick_models import QuickBase

path = Path(os.environ['LOCAL_IMAGE_DIR']).parent / 'database.sqlite3'
# Exclusive creation: existing files, including empty ones, are refused.
with path.open('xb'):
    pass
engine = create_engine(os.environ['DATABASE_URL'])
try:
    Base.metadata.create_all(engine)
    QuickBase.metadata.create_all(engine)
    with engine.connect() as db:
        assert db.exec_driver_sql('PRAGMA integrity_check').scalar() == 'ok'
finally:
    engine.dispose()
print('Empty schema created. No Farm, Device or Detection was seeded.')
PY
```

将这两个绝对路径填入 `backend/.env.runtime`。关闭初始化终端，日常启动使用新的终端，避免遗留 shell 覆盖。

空库包含设备业务表和 `quick_detections`，不产生 Profile/Farm/Device，也不伪造数据。已有 Supabase 项目中注册并登录的用户可使用 Quick Detection；Local 设备列表为空是正确状态。设备数据接入需要管理员批准的独立建档方案，使本地 Farm UUID 与该用户拥有的云端 Farm 对齐。目前没有正式设备创建 API 或完整的 Farm 自助开通界面。不要运行旧 seed/trial 工具来填充生产环境。

### 3.2 演示数据包

正式演示基线为 4 台设备、15 条设备 Detection、30 张云端原图/标注图；各设备数量为 5、4、0、6。数据包通过私下渠道交接，必须有版本、用途、允许使用的账户、DB/media 对应关系和 SHA-256 清单。

不得把当前工作库当作所有用户的新库模板；其中可能有个人 Quick Detection 和用户元数据。负责人应另行批准导出范围。复制运行中的 SQLite 需一致性快照，并在协调的停止写入窗口同步媒体；不能只复制主 DB 而忽略 WAL 或媒体。接收方核验后填入自己的绝对路径，本文件不依赖任何历史测试目录。

## 4. 环境变量

| 配置文件 | 主要变量及含义 |
|---|---|
| `backend/.env.runtime` | `DATABASE_URL`、`LOCAL_IMAGE_DIR` 必须是显式绝对既有路径；`BACKEND_HOST=0.0.0.0`、`BACKEND_PORT=8006` |
| 同上 | `AI_SERVICE_URL=http://127.0.0.1:8004`、`AI_SERVICE_TIMEOUT_SECONDS=120`；`API_PREFIX=/api/v1` 保持与客户端一致 |
| 同上 | `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` 用于实时认证/Farm 授权；`SUPABASE_KEY` 仅服务端同步/可选云代理需要 |
| 同上 | `ENABLE_INFERENCE_MEDIA_MIGRATION=false`；`CAPTURE_ADAPTER_MODE=unconfigured` 不伪造摄像头；`DEVICE_OFFLINE_THRESHOLD_MINUTES=15` |
| 同上 | `CORS_ORIGINS` 为实际 Web origin 逗号列表；`MAX_DETECTION_IMAGE_BYTES=10485760` |
| 同上 | `BE04_CLOUD_READ_ENABLED=false`；启用可选代理时才设 true；`BE04_FARM_ID`、`BE04_OWNER_USER_ID` 必须由管理员确认 |
| `ai_service/hen_repro/.env` | `AI_HOST=127.0.0.1`、`AI_PORT=8004`；四个权重路径变量见模板，三份文件由 AI 组提供 |
| `web/.env.local` | `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`VITE_DATA_SOURCE=local` 或 `cloud`、`VITE_API_BASE_URL=http://127.0.0.1:8006` |
| 同上 | `WEB_HOST=127.0.0.1`、`WEB_PORT=5173`；LAN 浏览可改 host，并同步 CORS |
| `mobile/.env.local` | `EXPO_PUBLIC_SUPABASE_URL`、`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`EXPO_PUBLIC_DATA_SOURCE=local` 或 `cloud` |
| 同上 | `EXPO_PUBLIC_API_BASE_URL=http://YOUR_MAC_LAN_IP:8006`；真机不能用 localhost |
| Metro 所在 shell | `METRO_PORT=8081`，由命令行传给 Expo，不是应用 public 变量 |

权重变量是 `CAGED_DET_WEIGHTS`、`CAGED_CLS_CKPT`、`FREE_RANGE_DET_WEIGHTS`、`FREE_RANGE_CLS_CKPT`。所需文件名为 `detector_yolov8n_head_best.pt`、`caged_protomil_best.pt`、`free_range_protomil_best.pt`。不调整模型阈值。

三个应用必须指向同一 Supabase 项目。VITE_/EXPO_PUBLIC_ 会进入客户端，绝不能填写服务端密钥。Backend 的 `--env-file` 会设置 `HENSENSE_ENV_FILE`，不再依赖旧 `.env` 或读取 Mobile 配置。导出的 shell 变量优先于 dotenv，检查覆盖时不要把全部环境值打印到共享日志。

Wi-Fi Mac 可执行 `ipconfig getifaddr en0`；没有结果时用 `networksetup -listallhardwareports` 找到实际接口。手机与 Mac 必须网络互通，检查系统防火墙和 AP 客户端隔离。`0.0.0.0` 是监听地址，不是手机应填写的目标地址。

## 5. 日常启动与停止

| 服务 | 目录 | 命令 |
|---|---|---|
| Backend | `backend/` | `.venv/bin/python -m scripts.start_backend --check`，通过后去掉 `--check` |
| AI | `ai_service/hen_repro/` | `.venv/bin/python start_service.py` |
| Web | `web/` | `npm run dev` |
| Metro | `mobile/` | `export METRO_PORT=8081` 后执行 `npx expo start --dev-client --lan --port "$METRO_PORT"` |
| Worker 只读状态 | `backend/` | `.venv/bin/python -m scripts.start_worker --status` |
| Worker 持续同步 | `backend/` | 经批准后 `.venv/bin/python -m scripts.start_worker --apply --watch` |

Backend 支持 `--env-file /absolute/path/to/runtime.env`。它检查模型所需列、数据库完整性及引用媒体，关闭 legacy lifespan；不会保证配置选中的兼容数据库就是正确的业务数据集，操作员必须核对打印的路径和交接清单。禁止直接使用 bare Uvicorn 启动 Backend，禁止 `--reload`。

Worker 共用 Backend 配置，并调用既有 Worker；标准包装器不启用设置上传。`--status` 不联网同步、不建 outbox；显式 `--apply` 的既有规则会初始化 `be04_outbox` 并更新同步状态。启动前看清 owner/Farm，不能用于重建已删除的隔离试验数据。

首次 iPhone：从 `mobile/` 执行 `npm run ios -- --device`，在本机选择设备和签名；首次模拟器可执行 `npm run ios`。Expo 配置负责权限声明和 `hensense` scheme；不要复制他人 ios 构建目录。具体 Apple 开发者团队和 bundle identifier 使用权限需要管理员确认。已有客户端可在 Metro 按 `i` 打开模拟器，或 iPhone 扫描开发客户端二维码。

停止：在各自前台终端按 Ctrl-C。终端丢失时先用 `lsof -nP -iTCP:8006 -sTCP:LISTEN` 确认目标（换成对应端口），核对进程身份后才使用 `kill -TERM <verified-pid>`。不要批量结束 Python/Node。每个 checkout 只运行一个 Metro、每个库只运行一个 Worker。

## 6. 健康检查

```sh
export BACKEND_ORIGIN=http://127.0.0.1:8006
export AI_ORIGIN=http://127.0.0.1:8004
export WEB_ORIGIN=http://127.0.0.1:5173
export METRO_PORT=8081
curl --fail --silent --show-error "$BACKEND_ORIGIN/api/v1/health"
curl --fail --silent --show-error "$AI_ORIGIN/health"
curl --fail --silent --show-error --output /dev/null "$WEB_ORIGIN/"
curl --fail --silent --show-error "http://127.0.0.1:$METRO_PORT/status"
```

Backend 的 200 还需查看 `data.status` 和 `data.database`；不能据此证明 Auth/AI 正常。AI health 不能替代真实图片推理测试。不要向正式数据上传“健康检查图片”。

## 7. 现有环境升级与故障

升级前备份 DB、媒体和配置，在独立副本验证；保持新旧代码与 Schema 对应。本阶段没有通用 schema version 管理或一键升级工具。缺列时停止，不把 `create_all` 当迁移，不开启自动迁移。修改客户端环境后重启 Vite/Metro并 Reload；仅 JS/环境变更无需重建已安装客户端，新增原生模块、权限或 scheme 时必须重建。

| 故障 | 检查与处理 |
|---|---|
| Startup refused | 文件是否存在、路径是否绝对、是否为正确 DB/media、是否缺 Quick 表或图片；不要改指旧库 |
| 登录失败/401/503 | 同项目 URL/公钥、Token 是否有效、Supabase 可达性；禁止匿名放行 |
| B 账户列表为空 | 注册不会自动取得 Demo Farm；检查真实 Farm 所有权，不复制 A 的 Token |
| 手机无法访问 | LAN IP、Backend host、防火墙；手机浏览器打开 Backend health |
| Cloud 能看监测，Quick 失败 | Cloud 不托管 Quick；检查 Backend 和 Backend→AI 链路 |
| 图片不可用 | 删除标记、文件/Storage 对象、权限、签名 URL 过期；不能替换成 Mock 图片 |
| 上传 0%/超时 | 保留照片和 request ID，先查看 History，再安全重试 |
| 端口占用 | 不随意跳到新端口；确认并由操作者停止自己的旧进程 |
| Worker 不同步 | owner/profile、服务端密钥、网络、状态及重试；禁止改 Farm 归属绕过 |
| 密码恢复失效 | 配置精确回调 URL，使用最新邮件；详见云端交接 |
| 全新 Supabase 无表 | 仓库缺完整云端基线；取得管理员审核的 Schema/RLS/Storage 配置后再部署 |

## 发布候选版的 iOS 原生工程

候选版保留 `mobile/ios` 的 AppDelegate、Info.plist、网络与权限设置、图标、Podfile/Podfile.lock 和 Xcode 工程。个人签名 Team 已留空，Pods、构建和用户状态未交付。不要直接执行 `expo prebuild --clean` 覆盖这些原生设置。现有 Xcode bundle identifier 与 `app.json` 不一致；发布前由负责人确定正式 identifier，在 Xcode 中选择自己的合法签名 Team，并核对 URL scheme。之后安装 Pods、重建并在 iPhone 验收。本轮未进行原生编译，不能保证仅从 app.json 再生成即可复现已验收客户端。
