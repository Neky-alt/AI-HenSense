# 正式交接清单

[返回 README](../README.md) · [部署](DEPLOYMENT.md) · [测试证据](TESTING.md)

## 1. 交付状态

已实现：标准显式启动、真实 Local/Cloud 监测读取、设备检测历史/图片、Offline 历史展示、Free-range Snapshot 与 Manual 分离、Supabase 登录/恢复/Profile、用户 Farm 授权、手机 Quick Detection 及独立历史/删除、设备数据 BE-04 Worker。

未完成或未启用：真实 Pi 摄像头/常驻调度/指令执行/录像现场部署、完整前端配置下发、Farm 多成员协作、Quick 云同步、远程生产托管、通知邮件/Push 全链路。Web 顶部提醒及设备/Settings 部分仍为原型，不能写成全部 UI 都是真实后端功能。

## 2. 新队友从零部署检查表

- [ ] 取得负责人确认的完整源码版本；所有拟交付但原先未提交的运行文件已纳入发布。
- [ ] 安装本机 Node/Python；首次原生构建准备 Xcode/模拟器/签名。
- [ ] 四个组件分别安装依赖，不拷贝他人的 .venv/node_modules/ios 构建产物。
- [ ] 明确使用已有 Supabase 项目还是全新项目；全新项目先取得完整审核基线。
- [ ] 使用自己的 Dashboard 成员账户和应用账户，理解二者权限不同。
- [ ] 从模板生成配置，填同一项目 URL/公钥；仅服务端保存高权限 key。
- [ ] 选择全新空库或批准的演示数据包，确认 DB/media 的绝对路径及哈希。
- [ ] 空库只初始化结构，不复制现有个人 Quick 历史；Farm/Device 建档另行审批。
- [ ] 取得 AI 三份权重与版本/哈希，确认依赖和模型健康。
- [ ] Backend `--check` 通过，再按 8006/8004/5173/8081 启动。
- [ ] 配置 Mobile LAN API 地址和 Local/Cloud 模式；Cloud 下 Quick 仍需 Backend。
- [ ] 首次安装自己的 iOS 开发客户端；环境变量变化后重启 Metro/Reload。
- [ ] 运行正式自动化命令，完成 A/B 权限和获准的隔离上传验收。
- [ ] 如启用 Worker，确认唯一进程、Farm/owner、同步目标，先 status 后经批准 apply。
- [ ] 填写操作人、日期、版本、测试结果及遗留问题，不在记录中粘贴密钥。

## 3. GitHub 正式交付建议

这是**建议范围**，本阶段没有 stage、commit、push 或重建 main。计划纳入文件须在最终发布时完整提交；正式文档不要求接收方从原机器未提交区或备份中找文件。

| 建议纳入 | 内容及理由 |
|---|---|
| 根目录 | README.md、.gitignore、.env.example；本套九份正式中文文档 |
| `backend/app/` | 全部现有模块、Router、认证、Quick、AI/媒体和 Worker 服务，不能只按旧 Git tracked 集合挑选 |
| Backend 启动链 | `scripts/start_backend.py`、`scripts/start_worker.py`、`scripts/be04_worker.py`；后者被包装器调用 |
| Backend 依赖/测试 | requirements.txt、tests/、必要的显式迁移工具；保留测试实际导入的 trial 工具，不能只因名字含 trial 就遗漏 |
| `web/` | src、public、index.html、Vite/TS/lint 配置、package.json、package-lock.json、.env.example、单元测试及测试辅助文件 |
| `mobile/` | src、运行需要的 assets、app.json、package/lock、TS/入口配置、.env.example、单元测试及必要开发说明 |
| AI | api_server.py、start_service.py、models/ 及实际导入模块、requirements.txt、.env.example；不含权重/虚拟环境 |
| 云配置参考 | 头像 SQL 可作为明确限定范围的参考；完整云基线在审核补齐后纳入，不能将局部 SQL 标成全量部署 |
| 中文原件 | 现有中文 PRD、技术架构和接口约定 DOCX 原件保留，不翻译、不覆盖；未来计划与当前代码不一致处以本套状态说明为准 |

建议在全新检出目录运行安装、build 和测试，检查资源导入完整性后再发布。单元测试需要的 fixtures 可提交，但真实图片的授权和个人内容须先审查。Web `assets/mock` 中部分图片仍用于装饰/原型，代码仍引用的文件不能直接从发布包删除。

### 仅本地保留，不进入 GitHub

所有 SQLite/sidecar、local_storage、真实媒体、Quick 用户上传、.env/.env.local/.env.runtime、密钥/签名、weights、.venv、node_modules、dist/build、ios/android 构建产物及个人签名/用户状态（本候选版保留必要的 iOS 原生源码，见部署指南）、缓存/日志、截图测试产物、压缩包及全部数据备份。不要仅依赖 .gitignore；发布前检查历史跟踪文件和打包内容是否包含敏感数据。

### 历史资料建议后续归档、不纳入正式阅读/发布主线

保留原件，不在本阶段删除：`SOFTWARE_HANDOVER_V1.md`、`BE04_FINAL_INTEGRATION.md`、`MULTI_ACCOUNT_ISOLATION.md`、`PROJECT_CLEANUP_REPORT.md`、旧阶段验收报告目录、Mobile/Web PATCH/MANIFEST 说明、BE03 集成笔记、旧导出和回滚资料。

其中 SOFTWARE_HANDOVER_V1、Backend/Web 子 README 已改为指向正式入口的简短说明，避免继续复制启动命令。旧清理/验收原始证据可能包含机器路径和测试配置，发布前应作为私下证据审查，不让正式部署依赖它们。旧 seed、批量试验和临时启动脚本是否进入开发工具包应逐个按测试依赖决定；不能自动当成生产命令，也不能为“干净”而破坏测试。

## 4. 私下交接资源清单

- Supabase 项目 URL/标识、成员邀请、真实配置位置及维护联系人；服务端密钥经安全渠道交接，不共享个人密码或 Token。
- 全量数据库 schema/RLS/触发器、Storage bucket/policies、Auth 邮件/回调配置的审核版本。
- 经批准的数据包（如需 Demo）：一致性 SQLite、匹配媒体、版本、SHA-256、允许使用的账户/用途；明确是否排除了个人 Quick 数据。
- AI 三份权重、哈希、来源、可用许可和推荐依赖版本；必要的合法测试照片。
- Apple 开发团队/签名权限、bundle identifier 使用安排及设备安装步骤；不传递个人开发者密码。
- 原始人工验收签字、截图/日志、备份恢复位置与保管人；敏感信息脱敏。
- 若要求外网 Quick Detection：另行批准的服务器/域名/TLS/运维方案，不把个人 Mac LAN 地址当正式服务地址。

## 5. 正式数据与演示准备

正式监测基线：CAGE-01=5、CAGE-02=4、CAGE-03=0、FREE-01=6，共 4 台设备/15 条 Detection/30 张 Cloud 图片。FREE-01 都是 Manual，无正式 Snapshot。Quick 不包含在该基线，也不应固定为某个条数。

旧库、迁移副本、隔离 trial、备份只是证据，不是可随意重新同步的源。清理过的 BE-04 测试 Farm 不应再出现。不得使用批量检测、seed 或新上传“修正”正式演示数量。

演示前确认：服务健康；A 看到批准 Farm，B 无 Farm 则空；Offline 卡片标 Last Recorded Result；无图旧记录保持占位；图片/数字同 ID；Free-range 不伪造 Snapshot；设备历史和 Quick 历史分离。上传、删除和 Worker 故障演示使用独立批准数据，演示后对比正式基线未变。

## 6. 尚需确认的问题

| 问题 | 当前事实/下一步 |
|---|---|
| 全新 Mac 可复现性 | 既有环境已通过；AI requirements 含范围版本，需要新机器安装验证及后续锁定方案 |
| 新 Supabase 建库 | 缺完整 migration/RLS 基线，负责人补齐后才能称为可完整重建云端 |
| Farm 开通与共享 | owner 模式；无 membership/自助建档，管理员提供批准流程，不能迁移 Demo owner |
| 原型 UI | Web 顶部提醒、设备/Settings 的本地保存未接通真实配置；是否移除或实现由产品确认 |
| 多 Farm Settings | 当前 API 未提供显式 Farm 选择参数，后续需单独设计和测试 |
| 远程使用 | 当前是 Mac 开发运行合同，尚无生产 TLS/守护/外网验收 |
| iOS 交付 | 当前 App 标识和签名团队可否由队友使用需确认；首次设备安装不等于 Reload |
| 数据包隐私 | 是否向队友提供真实 Quick 历史、测试图片及各资源授权须明确 |
| 硬件集成 | 真实摄像头、调度/心跳、正式 Snapshot、指令、视频、断电/满盘测试尚待硬件组 |
| 最终发布范围 | 当前是拟交付清单，需重建 main 前做全新 checkout 验证；本轮未操作 Git |

完成以上资源和权限确认后，由接收方签认“环境、数据、权限、功能、已知限制”五项，再转入后续开发。
