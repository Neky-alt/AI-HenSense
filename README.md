# HenSense（Country Watch）

HenSense 是 COMP5703 的家禽监测系统：Raspberry Pi 拍照并在本地运行 AI，Backend 保存检测结果，Web / Mobile 查看监测、历史、告警，并管理设备。AI 结果是模型估计，不能作为经过核实的个体产蛋结论。

## 从哪里开始

1. [部署指南](docs/DEPLOYMENT.md)：安装依赖、配置 Supabase、生成演示数据包、启动服务。
2. [交接清单](docs/HANDOVER.md)：当前完成情况、新队友检查表、未决问题。
3. 操作人员看 [用户手册](docs/USER_GUIDE.md)；开发人员看 [架构](docs/ARCHITECTURE.md)、[API 参考](docs/API_REFERENCE.md) 和 [Pi Worker](docs/PI_WORKER.md)。

## 结构

| 目录 | 技术与职责 |
|---|---|
| `backend/` | FastAPI、SQLAlchemy、SQLite；权限、设备管理、检测与告警、设置、媒体、硬件接口、云同步 Worker |
| `pi_worker/` | Raspberry Pi 端：心跳、领取命令、拍照、本地 YOLO + ProtoMIL 推理、上传结果 |
| `web/` | React、TypeScript、Vite；监测、设备管理、历史、设置、账户 |
| `mobile/` | Expo、React Native；监测、Quick Detection（Mobile 组维护） |
| `ai_service/hen_repro/` | 独立 AI 服务；只给 Quick Detection 和 Backend `/detect` 使用 |
| `docs/` | 正式中文文档 |
| Supabase | Auth、PostgreSQL、私有 Storage；云端数据和登录 |

## 快速启动（依赖和配置已就绪后）

Backend（Windows `cmd`；macOS 把 `.venv\Scripts\python` 换成 `.venv/bin/python`）：

```bat
cd backend
.venv\Scripts\python -m scripts.start_backend --check
.venv\Scripts\python -m scripts.start_backend
```

Web：

```bat
cd web
npm run dev
```

Pi Worker 见 [PI_WORKER](docs/PI_WORKER.md)；Mobile 见 Mobile 组说明。固定端口：Backend **8006**、AI **8004**、Web **5173**、Metro **8081**。Backend 只接受已存在的数据库和媒体目录，禁止 `--reload` 和启动时自动迁移。

## 功能概览

- 登录、注册、密码恢复、Profile（Supabase）。
- Cage / Free-range 监测、设备详情、检测历史、原图 / 标注图、告警列表；Offline 设备显示 `Last Recorded Result`。
- **设备管理**：添加（Device ID 全局唯一）、改名、移除（保留历史）、移除并删除全部历史（本地 + 云端）。
- **Run Detection Now**：Web / Mobile 发命令 → Pi 拍照并本地推理 → Backend 保存 → 页面显示。命令有超时和防重复。
- **自动监测**：Cage 按设置的时间 / 间隔采样；Free-range 按快照间隔生成正式 Snapshot。
- **设置**：Cage / Free-range 监测设置、In-app 告警开关，都保存在 Backend。
- **历史删除**：删除单张图片或整条记录，同步到云端。
- **图片保留**：检测图片固定保留 30 天，到期自动删除（Pi SD 卡、Backend 媒体、云端副本），记录和数量保留。
- Mobile Quick Detection：手机拍照上传检测，独立历史，不影响设备统计。

尚未完成：Pi 开机自启（systemd）、模型缓存、多人共享 Farm、邮件 / Push 通知、公网部署。详见 [交接清单](docs/HANDOVER.md)。

## 测试

```bat
cd backend
set DATABASE_URL=sqlite:///:memory:
.venv\Scripts\python -m pytest -q
```

```bat
cd web
npm test
npm run build
```

详细范围和 Windows 注意事项见 [测试说明](docs/TESTING.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [DEPLOYMENT](docs/DEPLOYMENT.md) | 安装、配置、演示数据包、启动、排错 |
| [USER_GUIDE](docs/USER_GUIDE.md) | 操作说明（保留英文界面名称） |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | 模块、数据流、Local / Cloud 访问 |
| [API_REFERENCE](docs/API_REFERENCE.md) | 全部 Backend 路由、认证、错误码 |
| [DEVICE_MANAGEMENT_API](docs/DEVICE_MANAGEMENT_API.md) | 设备增删改的规则、错误码、云端一致性、Mobile 接入 |
| [PI_WORKER](docs/PI_WORKER.md) | Pi 配置、运行、硬件接口、命令生命周期 |
| [DATABASE_AND_SYNC](docs/DATABASE_AND_SYNC.md) | 表、媒体、删除与保留、Worker 同步 |
| [CLOUD_HANDOVER](docs/CLOUD_HANDOVER.md) | Supabase 权限、密钥、管理员待办 |
| [TESTING](docs/TESTING.md) | 自动化测试、人工验收清单 |
| [HANDOVER](docs/HANDOVER.md) | 交付状态、检查表、私下资源、未决项 |

仓库不包含真实密钥、SQLite、媒体、模型权重或签名材料。
