# HenSense 软件交接 v1.0

HenSense 是 COMP5703 的家禽监测软件，提供 Web、Mobile、设备检测历史、原图/标注图、告警查看，以及按登录用户隔离的手机 Quick Detection。AI 结果是模型估计，不能作为经过核实的个体产蛋结论。

## 从哪里开始

1. 新队友先读 [部署指南](docs/DEPLOYMENT.md)，准备依赖、Supabase 和私下交接资源。
2. 按 [交接清单](docs/HANDOVER.md) 确认权限、交付文件和演示数据。
3. 操作人员使用 [用户手册](docs/USER_GUIDE.md)，开发人员使用 [架构](docs/ARCHITECTURE.md) 和 [API 参考](docs/API_REFERENCE.md)。

本文档描述当前本地代码的**拟发布版本**，不表示所有文件已进入 GitHub。重新建立干净 main 前，必须按交付清单纳入源码、启动脚本、测试、资源和文档；不能只提交文档。本阶段不操作 Git 历史。

## 技术栈与结构

| 目录 | 技术与职责 |
|---|---|
| `web/` | React、TypeScript、Vite；监测、历史、账户页面 |
| `mobile/` | Expo SDK 57、React Native、Expo Router；监测、拍照/相册 Quick Detection |
| `backend/` | FastAPI、SQLAlchemy、SQLite；权限、设备数据、Quick Detection、媒体、同步服务 |
| `ai_service/hen_repro/` | PyTorch、Ultralytics、ProtoMIL、FastAPI；Caged / Free-range 推理 |
| `docs/` | 正式中文交接文档及保留的中文需求/架构/接口原件 |
| Supabase | Auth、PostgreSQL、私有 Storage；云端监测与账户服务 |

## 环境与资源

已验证环境为 Node 24.20.0、Python 3.14.3；Web/Mobile 使用各自 lockfile。AI 依赖部分未锁定，其他 Mac 的全新安装仍需验证。首次 iPhone 开发客户端需要 Xcode、签名权限和本机编译；已有客户端不等于可交给所有队友安装。

仓库提供代码和配置模板，**不提供**真实密钥、SQLite、个人上传图片、正式媒体、模型权重或签名材料。无数据库时可按部署指南显式创建全新空库；它不会产生 Farm、设备或 Demo 数据。无权访问 Farm 的账户应看到空状态。

## 快速启动

先完成 [首次部署](docs/DEPLOYMENT.md)；以下是依赖和配置齐备后的日常命令。每个命令组从仓库根目录打开独立终端执行：

```sh
cd backend
.venv/bin/python -m scripts.start_backend --check
.venv/bin/python -m scripts.start_backend
```

```sh
cd ai_service/hen_repro
.venv/bin/python start_service.py
```

```sh
cd web
npm run dev
```

```sh
cd mobile
export METRO_PORT=8081
npx expo start --dev-client --lan --port "$METRO_PORT"
```

固定规划：Backend **8006**、AI **8004**、Web **5173**、Metro **8081**。Worker 没有监听端口，启用前单独核对同步授权。Backend 只接受显式的既有数据库/媒体路径，禁止 reload 和启动自动迁移。

## 功能概览与边界

- Web/Mobile：登录、注册、密码恢复、用户 Profile、真实监测、检测历史、原图/标注图、正式 Alerts 页面。
- Offline 设备保留 `Last Recorded Result`；Home Summary 不把离线历史当实时监测。
- Free-range 的正式 `Latest Snapshot` 与 `Latest Manual Detection` 分离；单帧结果不是整个鸡群统计。
- Mobile Quick Detection：拍照/选图、真实 AI、幂等重试、独立历史和删除，不影响设备统计或告警。
- Local 交互访问需要 Supabase 联网验证；设备侧内部采集/推理/SQLite 保存不依赖交互登录，Worker 断网时不能上传，恢复后重试。
- Cloud 监测可直接访问 Supabase；**Quick Detection 的远程上传仍需可达 Backend，Backend 需可达 AI**。历史读取不需重新推理。
- 设备新增/编辑、Settings 等部分界面仍是浏览器原型或 Mobile 只读；不是已完成的设备配置部署。Web 顶部提醒仍有原型数据，详见用户手册和已知限制。
- Raspberry Pi 摄像头、持续调度、硬件端指令及现场部署不在本次软件验收范围。

## 测试与文档导航

每组命令在对应目录执行，勿对正式库运行测试：

```sh
cd web
npm test
npm run build
```

```sh
cd mobile
npm test
npm run typecheck
```

Backend 的安全回归命令及历史验证证据见 [测试说明](docs/TESTING.md)。

| 文档 | 内容 |
|---|---|
| [DEPLOYMENT](docs/DEPLOYMENT.md) | 全新部署、初始化、运行、停止、排错 |
| [USER_GUIDE](docs/USER_GUIDE.md) | 中文操作说明与实际英文界面名称 |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | 模块、访问路径、检测及同步流程 |
| [API_REFERENCE](docs/API_REFERENCE.md) | 全部 Router、认证、参数、返回与错误 |
| [DATABASE_AND_SYNC](docs/DATABASE_AND_SYNC.md) | 表、媒体、权限、离线与 Worker |
| [CLOUD_HANDOVER](docs/CLOUD_HANDOVER.md) | 团队权限、Farm 权限、密钥和账户交接 |
| [TESTING](docs/TESTING.md) | 已执行检查、人工验收、后续测试 |
| [HANDOVER](docs/HANDOVER.md) | 新队友检查表、GitHub 清单、私下资源、未决项 |

历史运行/验收资料保留，但不是正式启动依据；本套九份文档是交接阅读主线。
