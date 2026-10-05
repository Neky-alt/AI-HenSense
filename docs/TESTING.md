# 测试说明

[返回 README](../README.md) · [交接检查表](HANDOVER.md)

## 1. 自动化测试

所有测试使用临时数据库和模拟服务，**不要**把正式数据库设为测试目标。

Backend（Windows；macOS 用 `export DATABASE_URL=...` 和 `.venv/bin/python`）：

```bat
cd backend
set DATABASE_URL=sqlite:///:memory:
.venv\Scripts\python -m pytest -q
```

Web：

```bat
cd web
npm test
npm run build
```

Mobile：`npm test`、`npm run typecheck`（Mobile 组维护）。

预期：Backend 全部通过。Windows 上未开启“开发者模式”时，2 个需要创建符号链接的测试会显示 skipped（`test_db01_copy_migration`、`test_quick_deletion` 各一个），属于正常。

## 2. 按功能对应的测试文件

| 功能 | Backend 测试 | Web 测试 |
|---|---|---|
| 设备增删改、编号全局唯一、云端一致性 | `test_device_management.py`、`test_models.py` | `deviceService.test.mjs` |
| 旧库唯一编号迁移 | `test_device_code_migration.py` | — |
| 历史删除、30 天图片保留 | `test_detection_deletion_and_retention.py` | `settingsService.test.mjs` |
| 命令原子领取、超时、防重复、监测时段占位 | `test_command_recovery.py`、`test_hardware_commands.py` | — |
| Free-range / Alert 设置走 Backend | `test_settings_storage_api.py` | `settingsService.test.mjs` |
| 演示数据包生成 | `test_build_demo_pack.py` | — |
| 用户 / Farm 权限隔离 | `test_farm_access.py` | `accountIsolation.test.mjs` |
| 监测时间表、时区 | `test_monitoring_schedule*.py` | — |
| Pi 上传检测、自动样本 | `test_hardware_*.py`、`test_be03_*.py` | — |
| Worker 同步、单实例锁 | `test_be04_*.py` | `be04_cloud_reader.test.mjs` |
| Quick Detection | `test_quick_*.py` | — |
| 数据映射与显示 | `test_core_data_api.py` | `detectionService.test.mjs`、`recordedResult.test.mjs` |

`tests/conftest.py` 在每个测试前后重置进程内状态（监测时段占位、保留检查节流）；`tests/_platform.py` 提供符号链接能力检测。

## 3. Windows 注意事项

- 必须安装 `tzdata`（已在 requirements 中），否则时区相关测试失败、自动监测不触发。
- Worker 单实例锁在 Windows 用 `msvcrt`，macOS / Linux 用 `fcntl`（`app/services/process_lock.py`）。
- 临时目录清理会忽略 Windows 的文件占用错误。

## 4. 人工验收清单

前提：Backend 使用演示数据包，Web 用演示 Farm 的 owner 账户登录。

**设备管理**
- [ ] 添加 `PI-TEST` → 列表出现、状态 Offline
- [ ] 再次添加同编号 → “already registered”
- [ ] 改名 → 刷新后仍是新名字；Device ID 和养殖类型不可编辑
- [ ] `Remove device` → 列表消失；再添加同编号 → 提示属于已移除设备，可“删除旧历史并添加”
- [ ] `Remove and delete all history`（需输入编号）→ 编号可重新使用

**历史与图片**
- [ ] `Delete image` → 图片变占位，数量保留
- [ ] `Delete record` → 记录从历史消失
- [ ] 详情页不再有 Storage Settings；显示 30 天保留说明

**设置**
- [ ] Free-range Settings 保存 → 刷新 / 换浏览器后仍在
- [ ] Alert Settings 关闭 In-app → 顶部信封图标消失；打开后恢复

**Pi 联调**（需要真机或用 `HENSENSE_TEST_IMAGE`）
- [ ] Pi 配置新设备 `device_id` → 心跳后 Online
- [ ] Run Detection Now → 新记录出现；连续点击不重复排队
- [ ] 中途停止 Pi → 5 分钟后命令显示失败
- [ ] 自动监测到点采样，不重复

**权限**
- [ ] 非 owner 账户登录 → 空列表；直接访问他人设备 / 图片 URL → 404

## 5. 已知限制

- 30 天保留和超时命令检查依赖 Pi 心跳；没有 Pi 在线时不会执行。
- 云端图片删除依赖 Worker 运行；“删除全部历史”的云端部分依赖 `DEVICE_CLOUD_WRITE_ENABLED`。
- 未在真机验证：模型缓存、Pi 重启恢复、systemd、长时间运行、断网重连。
- 邮件 / Push、多 Farm 共享成员、公网部署未实现。
