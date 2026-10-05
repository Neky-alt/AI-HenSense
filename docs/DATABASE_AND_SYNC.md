# 数据库与同步

[返回 README](../README.md) · [部署](DEPLOYMENT.md) · [云端权限](CLOUD_HANDOVER.md) · [设备管理](DEVICE_MANAGEMENT_API.md)

## 1. 数据模型

SQLite 模型以 `backend/app/models.py` 为准；Quick Detection 使用 `quick_models.py` 的独立 metadata。标准启动只检查表结构，不调用 `create_all`，也不迁移。

| 表 | 主键 / 归属 | 职责 |
|---|---|---|
| `profiles` | `user_id` | 本地业务 Profile；不是登录凭据 |
| `farms` | `farm_id` → `user_id` | Farm 与 owner；Local 授权依赖云端真实 owner |
| `devices` | `device_id` → `farm_id` | 编号、名称、farming_type、last_seen_at、is_active。**`device_code` 全局唯一** |
| `detections` | `detection_id` → `device_id` | 时间、数量 / 比例、触发类型、监测状态、媒体、AI 结果、删除标记、同步状态 |
| `alerts` | `alert_id` → Device，可关联 Detection | 类型、Active / Resolved、sync_status |
| `device_commands` | Device，可关联结果 Detection | Run Detection Now 命令：pending → running → completed / failed |
| `monitoring_settings` | Farm + farming_type | 开关、时间窗、间隔 / 定时、Cage / Free-range 阈值；Pi 自动采样按此执行 |
| `notification_settings` | user_id | 只有 `in_app_enabled` 生效 |
| `device_storage_settings` | Device | 存储设置接口仍在，但 Web 不再使用、设置不生效（图片保留固定 30 天） |
| `device_settings`、`video_segments` | Device | 保留的旧表，当前没有功能使用 |
| `quick_detections` | user_id | 手机上传，独立于设备数据 |
| `be04_outbox` | kind + record_id | Worker 同步账本（指纹、重试） |

比例保存为 0–1，零目标时为 NULL；时间以 naive UTC 存储、API 输出带 `Z`。DeviceStatus 由 `last_seen_at` 计算（超过 `DEVICE_OFFLINE_THRESHOLD_MINUTES` 为 Offline），与 MonitoringStatus（Normal / Warning）无关。

## 2. 媒体

SQLite 只存相对路径，图片在 `LOCAL_IMAGE_DIR`。原图和标注图属于同一条 Detection。

Supabase 私有 bucket `detection-images`，对象路径 `farms/{farm_id}/devices/{device_id}/detections/{detection_id}/original.jpg|annotated.png`。云端 `image_url` / `annotated_image_path` 存对象 key；客户端用短期签名 URL 读取。头像在独立 bucket `hensense-avatars`。

## 3. 删除与保留

| 操作 | 本地 | 云端 |
|---|---|---|
| 删除图片（History） | 删文件，写 `image_deleted_at`，`sync_status=pending` | Worker 删除对象并同步空引用 |
| 删除记录（History） | 写 `deleted_at` + `image_deleted_at`，删文件 | Worker 同步 tombstone |
| **30 天到期**（固定，不可配置） | 设备心跳时（每小时最多一次）处理 `detected_at` 早于 30 天的图片，同上 | Worker 删除对象 |
| Pi 拍摄缓存 | `pi_worker/captures` 超过 30 天的文件每小时清理 | — |
| 移除设备（软删除） | `is_active=false`，历史保留，编号继续占用；未完成命令改为 failed | 开关开启时立即更新，否则由 Worker 同步 `is_active` |
| 移除并删除全部历史 | 删除设备及全部 Detection、Alert、命令、设置、媒体、outbox 记录；编号释放 | **只在 `DEVICE_CLOUD_WRITE_ENABLED=true` 时**先删云端（对象 → alerts → detections → device），云端成功才删本地 |

注意：开关为 `false` 时“删除全部历史”只删本地。Worker 只做 upsert、不同步硬删除，云端会留下该设备和记录，并继续占用编号。演示前若要用这个功能，先由管理员完成 [CLOUD_HANDOVER](CLOUD_HANDOVER.md) 中的唯一约束，再打开开关。

## 4. 设备编号全局唯一

- 本地：模型约束 `uq_devices_device_code`；旧库用 `scripts/migrate_device_code_unique.py` 迁移（见部署指南 §3.3）。
- 添加设备时先用原始 SQL 在全部本地设备中查重（不受用户权限过滤）；云端开关开启时再由 Supabase 唯一约束做最终裁决。
- 软删除的设备仍占用编号；只有彻底删除后才释放。

## 5. 真实 Farm 权限

owner 模式（`farms.user_id`），没有多成员 Farm。每个请求都向 Supabase 验证 Token，再用用户自己的 Token 查询其拥有的 Farm，与本地 Farm UUID 取交集。`authorized_db` 让该请求只能看到这些 Farm 下的设备和数据，并拒绝批量 UPDATE / DELETE 语句。Quick Detection 按 user_id 过滤。

## 6. Worker 规则

1. 校验本地 Farm、云端同 UUID Farm 的 owner 和云端 Profile；不一致即拒绝。
2. 默认同步 farms → devices → detections → alerts（先父后子）；设置默认不上传，避免覆盖云端较新的配置。
3. 只处理 pending / failed 或带 tombstone 的 Detection；稳定 UUID、确定性对象 key，失败可安全重试。
4. 先上传图片再发布记录；tombstone 时先删云端对象再写空引用。
5. 只做 upsert，**不同步硬删除**。
6. 每个数据库只能运行一个 Worker（跨平台文件锁）；`--status` 只读。
7. 不同步 Quick Detection、头像、视频。

启动方式见部署指南 §5。

## 7. 演示数据包

用 `scripts/build_demo_pack.py` 从 Supabase 生成（部署指南 §3.1）。数据包与云端 UUID 一致，Detection / Alert 标为 `synced`，只写入实际下载到的图片路径，并生成带 SHA-256 的 `manifest.json`。

当前演示 Farm：4 台设备（CAGE-01、CAGE-02、CAGE-03、FREE-01）、15 条检测、30 张图片。注意 30 天保留规则：早于 30 天的演示图片会在第一次 Pi 心跳后被删除，正式演示前需要重新生成数据或使用近期数据。

## 8. 备份与恢复

备份要同时包含一致的 SQLite 快照、匹配的媒体目录和配置版本；密钥另行保存。迁移先在副本上执行。恢复时数据库和媒体必须来自同一时间点。
