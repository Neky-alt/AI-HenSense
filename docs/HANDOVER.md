# 交接清单

[返回 README](../README.md) · [部署](DEPLOYMENT.md) · [测试](TESTING.md)

## 1. 交付状态（2026-10-04）

**已实现**

- 登录、注册、密码恢复、Profile；按 Farm owner 的权限隔离。
- 监测、设备详情、历史、原图 / 标注图、告警；Offline 显示最后记录；Free-range 正式 Snapshot 与 Manual 分离。
- 设备管理：添加（编号全局唯一）、改名、软删除、彻底删除（本地 + 云端）。
- Run Detection Now 全链路：Web / Mobile → Backend 命令 → Pi 拍照与本地推理 → Backend → 页面；命令原子领取、超时失败、防重复；Pi 上传重试。
- 自动监测：按 Farm 时区和监测设置采样；同一时段只采一次。
- 设置走 Backend：Cage / Free-range 监测设置、In-app 告警开关。
- 历史删除（图片 / 记录）及云端同步；图片固定保留 30 天并自动删除。
- 云同步 Worker（Windows / macOS 均可运行）；从云端生成演示数据包的脚本。
- Mobile Quick Detection。

**未完成**

- Pi：开机自启（systemd）、模型只加载一次、重启后状态恢复、长时间运行验证。
- Supabase：`devices.device_code` 唯一约束、完整 schema 基线（见 [CLOUD_HANDOVER §4](CLOUD_HANDOVER.md)）。在此之前 `DEVICE_CLOUD_WRITE_ENABLED` 保持 `false`，“删除全部历史”只删本地。
- Mobile 端设备管理 / 设置 / 历史删除接入（Mobile 组，接口与 Web 相同）。
- 邮件 / Push、多人共享 Farm、Farm 自助开通、公网部署。

## 2. 新队友检查表

- [ ] 检出团队确认的分支，安装 Backend、Web（及需要的 AI、Mobile）依赖。
- [ ] 取得 Supabase URL、publishable key、secret key；secret key 只放 `backend/.env.runtime`。
- [ ] 生成自己的 `HARDWARE_API_KEY`，与 Pi 保持一致。
- [ ] 用 `build_demo_pack.py` 生成演示数据包（[部署 §3.1](DEPLOYMENT.md)），写入 `.env.runtime`。
- [ ] `start_backend --check` 通过后启动 Backend；启动 Web。
- [ ] 用演示 Farm 的 owner 账户登录，确认 4 台设备可见。
- [ ] 运行 Backend 与 Web 测试（[TESTING](TESTING.md)）。
- [ ] 需要 Pi 时按 [PI_WORKER](PI_WORKER.md) 配置 `device_id` 并确认心跳。
- [ ] 需要云同步时：先 `start_worker --status`，确认 Farm / owner 后再 `--apply --watch`。

## 3. 私下交接资源

- Supabase 项目 URL、成员邀请；secret key 经安全渠道交付，不共享个人密码或 Token。
- 演示 Farm owner 账户的登录方式（由负责人决定是否共享或为队友建 Farm）。
- AI 三份权重（AI 服务与 Pi 各一份）及版本 / 哈希。
- Apple 签名团队与 bundle identifier 安排（Mobile）。

## 4. 演示数据

演示 Farm `91000000-0000-0000-0000-000000000001`（owner `011f1bfb-ac10-424b-b687-52baf06eddc1`）：CAGE-01 = 5、CAGE-02 = 4、CAGE-03 = 0、FREE-01 = 6，共 15 条检测、30 张图片。FREE-01 全是 Manual，没有正式 Snapshot。

注意 30 天图片保留：早于 30 天的演示图片会在第一次 Pi 心跳后被删除。正式演示前，用 Pi 生成近期数据，或在不连接 Pi 的情况下展示旧数据。演示中做添加 / 删除操作时使用新建的测试设备，不要删除这 4 台。

## 5. 不进入 Git

`.env.runtime`、`.env.local`、SQLite 及 sidecar 文件、媒体目录、演示数据包、权重、`.venv`、`node_modules`、构建产物、日志。发布前检查历史提交中是否有密钥（`HARDWARE_API_KEY` 旧值已在历史中，需轮换）。

## 6. 未决问题

| 问题 | 下一步 |
|---|---|
| Supabase 唯一约束 / 外键级联 | 管理员执行，之后打开 `DEVICE_CLOUD_WRITE_ENABLED` 并联调 |
| 命令超时 300 秒是否足够 | 在 Pi 真机上测“加载模型 + 拍照 + 推理”耗时后调整 |
| 30 天保留与演示数据 | 决定演示用近期数据还是不连 Pi 展示 |
| Mobile 接入 | Mobile 组按 [DEVICE_MANAGEMENT_API §6](DEVICE_MANAGEMENT_API.md#6-mobile-接入要点) 接入 |
| 多 Farm 设置 | 监测设置没有 `farm_id` 参数，作用于第一个 Farm；需要时另行设计 |
| Pi 配对 | 目前手抄 `device_id`；可选实现用 `device_code` 自动配对 |
| 公网 / 远程使用 | 需要 TLS、守护进程、安全入口方案 |
