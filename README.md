# HenSense · AI 家禽智能监测系统

HenSense（Country Watch）是一个结合计算机视觉、树莓派和 Web / 移动端的家禽监测项目。系统通过设备采集图像，使用 YOLO + ProtoMIL 进行检测与分析，并提供监测看板、历史记录、告警和设备管理功能。

## 主要功能

- **智能检测**：树莓派拍照并在本地运行 AI，上传检测结果与图片。
- **监测看板**：查看笼养（Cage）和散养（Free-range）设备状态、统计与最新结果。
- **设备管理**：添加、重命名、移除设备，支持手动发起检测和自动监测。
- **历史与告警**：查看原图、标注图和检测历史，管理告警与图片保留。
- **移动端检测**：手机拍照上传，使用 Quick Detection 获取结果。
- **账户与云同步**：使用 Supabase 登录，支持本地数据与云端同步。

## 技术栈与目录

| 目录 | 技术 / 用途 |
| --- | --- |
| `web/` | React + TypeScript + Vite，Web 管理界面 |
| `mobile/` | Expo + React Native，移动端应用 |
| `backend/` | FastAPI + SQLAlchemy + SQLite，业务 API 与同步服务 |
| `pi_worker/` | 树莓派采集、命令执行与本地 AI 推理 |
| `ai_service/hen_repro/` | YOLO + ProtoMIL 独立推理服务，供 Quick Detection 使用 |
| `docs/` | 部署、架构、API、测试与用户文档 |

云端使用 Supabase Auth、PostgreSQL 和 Storage。

## 快速开始

环境要求：Python 3.12–3.14、Node.js 24.x。以下为 macOS / Linux 命令。

```bash
git clone https://github.com/Neky-alt/AI-.git
cd AI-

# 安装后端依赖
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp -n .env.example .env.runtime

# 返回根目录并安装 Web 依赖
cd ../web
npm ci
cp -n .env.example .env.local
```

启动前，按照 [部署指南](docs/DEPLOYMENT.md) 配置 Supabase、已有数据库与媒体目录，并填写环境变量。仓库不包含模型权重、运行数据库、图片或真实密钥，这些资源需要另行准备；仅安装依赖不能直接运行完整系统。

在两个终端分别启动：

```bash
# 终端 1：在仓库根目录执行
cd backend
.venv/bin/python -m scripts.start_backend --check
# 预检通过后启动
.venv/bin/python -m scripts.start_backend
```

```bash
# 终端 2：在仓库根目录执行
cd web
npm run dev
```

默认地址：Web `http://localhost:5173`，Backend `http://localhost:8006`，AI 服务端口 `8004`。后端使用项目启动脚本，不使用 `--reload`。

移动端、独立 AI 服务及树莓派的配置和启动步骤见 [部署指南](docs/DEPLOYMENT.md) 与 [Pi Worker 文档](docs/PI_WORKER.md)。

## 项目文档

- [部署指南](docs/DEPLOYMENT.md)：依赖、环境变量、数据准备与启动步骤。
- [用户手册](docs/USER_GUIDE.md)：页面功能与操作说明。
- [系统架构](docs/ARCHITECTURE.md)：模块职责与数据流。
- [API 参考](docs/API_REFERENCE.md)：后端接口与认证规则。
- [测试说明](docs/TESTING.md)：测试命令与人工验收清单。
- [交接清单](docs/HANDOVER.md)：当前状态、资源准备和待完成事项。

## 项目状态

本项目为 COMP5703 课程项目，目前支持本地部署及设备联调。树莓派开机自启、多人共享 Farm、邮件 / Push 通知与公网部署仍待完善，具体进度见交接清单。

AI 检测结果为模型估计，仅用于辅助监测，不能作为经过核实的个体产蛋结论。
