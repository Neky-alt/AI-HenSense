# 测试与验收说明

[返回 README](../README.md) · [交接检查表](HANDOVER.md)

## 1. 证据范围

本页记录第一阶段实际执行结果和用户已确认的人工验收，不把第二阶段文档检查说成重新运行功能测试。本阶段没有运行上传、删除、迁移、Worker apply 或云端写入。历史原始报告可由负责人私下提供，正式文档不依赖接收方的本地备份目录。

| 已执行项目 | 实际结果 | 限制 |
|---|---|---|
| Backend 选定回归套件 | 51 passed | 非全部 Backend 测试；见下方精确范围 |
| 启动检查单独复查 | 4 passed | 与上述套件有重叠，不累计为 55 个独立用例 |
| Web 单元测试 | 54 passed | 包含 Web/Mobile 授权适配测试及映射/显示；不是全浏览器 E2E |
| Web build | TypeScript + Vite 通过 | 有大于 500 kB chunk 提示 |
| Mobile 单元测试 | 47 passed | Node 环境测试，不代替原生拍照/权限验收 |
| Mobile TypeScript | `tsc --noEmit` 通过 | 不是 iOS 原生编译 |
| 标准 Backend 入口 | 隔离空测试库/临时端口启动成功，health 200、主要 API 存在、匿名 401 | 未替换正在验收的运行进程 |
| Worker status | 临时库只读查询通过，DB 哈希未变 | 未执行同步 apply |
| AI 启动配置 | 模拟 Uvicorn 调用验证 host/port 通过 | 未用新入口重载模型；既有 AI health 200 |
| 现有服务检查 | Backend、AI、Web、Metro 均返回 200 | 不表示全部依赖或交互已再次验收 |
| 数据保护 | 262 个受保护文件 SHA-256 未变 | 第一阶段本机检查范围，不是本轮新的云端全量审计 |

第一次前端测试暴露旧测试环境未适配 Auth 和英文错误映射；修复测试 fixture/断言后上述最终结果通过。Backend 有依赖弃用警告，Mobile 有 Node module-type 提示，均未改变运行判断。

## 2. 可重复自动化命令

每组从仓库根目录的新终端执行；先安装依赖。用例使用临时数据库和模拟服务，不要设置正式数据库作为测试目标。

```sh
cd backend
DATABASE_URL=sqlite:///:memory: .venv/bin/python -m pytest -q \
  tests/test_runtime_startup.py tests/test_farm_access.py \
  tests/test_quick_detection.py tests/test_quick_deletion.py \
  tests/test_be04_worker.py tests/test_be04_integration_gate.py
```

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

关键覆盖：启动不创建/修改错误数据库、旧 Schema 拒绝、主要路由；A/B Token、Farm、直接 Device/Detection/图片访问、写入拒绝；Quick 上传、所有权、幂等、零目标、异常/提交失败与删除清理；Worker 所有权和同步边界；Local/Cloud 路由和退出切换时旧请求无效；离线展示和 Free-range 正式/手动记录分离。

旧浏览器 trial 脚本可能依赖历史路径、数据和认证方式，不列作新队友必须执行的标准测试。标准单元测试的模拟 Auth/AI 是测试 fixture，不是运行时 Mock 检测功能。

## 3. 已完成人工验收（用户确认）

用户已确认 Web/Mobile 最终验收、iPhone Mobile Stage 1、Quick Detection、多账号隔离和 Quick 历史删除通过。正式数据基线已核对为 Local/Cloud 4 台设备、15 条设备 Detection、30 张云端图片。

此前 BE-04 隔离残留清理在明确授权、备份、外键/触发器检查之后完成，删除 1 Farm、1 Device、2 测试 Detection、1 合成 Alert，Storage 删除 0。清理后正式记录、媒体引用及本地数据比对未变。这里记录历史事实，不提供再次执行删除的命令。

本阶段未重复操作 iPhone。原始签字、设备/iOS 版本、逐项截图和完整测试日志若需用于客户正式审计，仍需负责人归档提供，不能从“已通过”推测所有边界都在所有设备上测试过。

## 4. 新队友验收顺序

1. 验证配置及权限，无 Farm 账户应为空；只读检查批准演示包的 4/15/30 基线。
2. 在 A/B 两账户之间切换，确认 Profile、Alerts 正式页和 Quick 历史隔离；直接访问对方 ID/媒体应拒绝。
3. Web/Mobile Cage Offline 仍显示 Last Recorded Result；数字、时间、图片属于同一记录。
4. FREE-01 无正式 Snapshot，显示 Manual 预览；不纳入正式统计。
5. 测试图片切换、Previous/Next、刷新和旧记录无图占位。
6. 新上传/删除只能在另行批准的隔离 Quick 数据范围：拍照、相册、权限拒绝、断网、超时、同 key 重试、零目标及末页删除。
7. 对比上传/删除前后设备 Detection、媒体、统计和 Alerts 未受影响。
8. Worker 故障/恢复/删除标记实验使用独立数据，确认不会回放已经清理的历史试验 UUID。

## 5. 已知限制与硬件后补测试

- Web 顶部 AlertsMailbox 仍用原型数据；正式 Alerts 页面才读取真实源。Web Settings/设备编辑是浏览器原型，Mobile 相关写界面只读。
- 新 Supabase 项目缺全量 schema/RLS/Storage 基线；新 Mac 依赖安装未独立复现，AI 依赖未完整锁定。
- Local 交互 Auth 依赖联网；离线采集/本地持久化设计不能等同“手机断网仍可上传”。
- AI 是弱监督模型结果，Free-range 单图不是群体计数，未提供校准的真实产蛋概率。
- 远程 Quick Detection 的公网部署、安全入口、性能和持续可用性未验收。
- 仍需真实 Pi 验证：摄像头方向/分辨率、驱动和心跳、定时采集、两次阈值 Warning/恢复、Free-range 正式 Snapshot 生成、录像保留、SD 满盘/掉电、时区/时钟、设备断网重连、长期 Worker 重试和资源占用。
- 邮件/Push 投递、远程 DeviceCommand 执行、多 Farm 共享成员权限不列为已完成功能。

## 6. 本阶段文档检查

第二阶段只改 Markdown 文档。已静态核对 27 个 Backend 业务路由（含 4 个可选路由）、3 个 AI 路由、正式文档内部链接、具体源码路径、环境变量名称及 npm 脚本；Shell 和内嵌 Python/JSON 示例通过语法检查。275 个业务源码/配置/测试文件的前后 SHA-256 一致。

没有重新运行第一阶段功能测试，也没有执行文档中的空库初始化、安装、上传、删除或同步命令。全新电脑的端到端部署仍须由接收方按检查表实际完成。
