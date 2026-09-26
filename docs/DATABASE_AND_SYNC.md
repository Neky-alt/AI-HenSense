# 数据库与同步

[返回 README](../README.md) · [初始化](DEPLOYMENT.md) · [云端权限](CLOUD_HANDOVER.md)

## 数据模型

SQLite 模型以 `backend/app/models.py` 为准；Quick 使用 `quick_models.py` 的独立 metadata。标准启动只检查，不调用 `create_all` 或迁移。全新空库方式见部署指南。

| 表 | 主键/归属 | 当前职责 |
|---|---|---|
| `profiles` | `user_id` | 本地业务 Profile；不等于实际登录凭据 |
| `farms` | `farm_id` → `user_id` | Farm 与 owner；Local 授权最终依赖云端真实 owner |
| `devices` | `device_id` → `farm_id` | Code、名称、farming_type、last_seen_at、is_active |
| `detections` | `detection_id` → `device_id` | 时间、数量/比例、触发类型、监测状态、媒体、AI、删除与同步标记 |
| `alerts` | `alert_id` → Device，可关联 Detection | 类型、Active/Resolved、恢复时间与 sync_status |
| `device_settings` | Device 关联 | 设备配置模型，不等于硬件已生效 |
| `device_commands` | Device 关联，可关联结果 Detection | 指令数据模型，Pi 执行器未交付 |
| `monitoring_settings` | Farm + farming_type | 开关、时间、间隔、Cage/Free-range 阈值 |
| `device_storage_settings` | Device | 图片/视频保留与容量策略 |
| `notification_settings` | user_id | 投递偏好；不代表发送服务已部署 |
| `video_segments` | Device | 本地视频元数据；非已验收录像系统 |
| `quick_detections` | quick_detection_id；user_id | 手机上传，完全独立于设备 Detection |
| `be04_outbox` | kind + record_id | Worker 显式 apply 时建立的同步账本 |

Detection 的新增 nullable 字段：`annotated_image_path`、`ai_instances`、`ai_response`、`provenance`。旧行允许 NULL；不得补造 AI 响应或图片。比例保存为 0–1，零目标比例可为 NULL；时间返回 UTC。DeviceStatus 按心跳计算，不等同 MonitoringStatus。

Quick 字段包括 `client_request_id`、`input_sha256`、`farming_type`、`source_type`、`status`、`attempt_id`、`lease_expires_at`、错误、数量/比例、三类媒体路径和 AI/provenance。`(user_id, client_request_id)` 唯一；状态为 processing/succeeded/failed。该表不通过 nullable device_id 绕过设备归属，也不需要本地 Profile 外键才能保存真实已验证用户的上传。

## 媒体

SQLite 存元数据和相对路径，不存图片二进制。`LOCAL_IMAGE_DIR` 必须与 DB 匹配。设备的原图/标注图关联同一 Detection ID；Quick 的原始上传与纠正方向后的展示图可能不同，但都关联同一 Quick 记录。标注不改变模型预测。

Supabase 使用私有 `detection-images` bucket，对象路径为 `farms/{farm_id}/devices/{device_id}/detections/{detection_id}/...`。Cloud `image_url`/`annotated_image_path` 保存对象 key，不是 Mac 路径或永久公开 URL；客户端取得短期签名 URL。头像使用独立 `hensense-avatars` bucket 和用户自己的目录，不计入正式 30 张检测图片。

`image_deleted_at` 表示只删除图片；`deleted_at` 表示检测记录软删除。历史会排除已删记录；无图旧记录仍可显示统计和占位。Quick 删除是所有者作用域的记录及专属媒体删除，处理中的记录拒绝删除；不会变更设备删除标记。

## 真实 Farm 权限

当前实现以 `farms.user_id` 的 owner 模式为基础，没有已交付的多人 Farm membership/角色系统。Supabase Dashboard 成员不自动成为应用 owner。Local 保留原 Farm UUID，即使本地演示 Profile 是历史占位值，也必须用实际 Token 和云端所有权授权，绝不以占位 Profile 登录。

设备、历史、图片、Dashboard、Alerts 和相关写入均经过服务端范围检查。Quick 用验证后的 user_id 单独过滤。客户端切换用户清理状态并拒绝旧请求结果；不能用前端隐藏代替权限。

## Worker 的实际规则

1. 校验本地目标 Farm、云端同 UUID Farm 的 owner 及真实云端 Profile；owner 冲突拒绝。
2. 默认阶段是 farms、devices、detections、alerts，先父后子。向云端序列化 Farm 时使用明确批准的 owner，不改本地历史 Profile。
3. 对 pending/failed Detection 或 tombstone 进行处理；稳定 UUID upsert、确定性媒体 key 支持重试，不重新运行 AI。
4. 先上传媒体再发布记录；成功后更新本地 sync_status。失败记录重试时间，watch 循环恢复联网后重试。
5. tombstone 优先于媒体引用；只删除该记录所属路径下的云端旧对象，再同步空引用和标记。
6. 默认不上传监测/存储/通知设置，避免覆盖云端较新配置。底层 CLI 存在 `--include-settings`，标准包装器未开放该选项，不作为日常交接命令。
7. `be04_outbox` 保存指纹、失败次数、重试信息；没有标准启动自动 schema 迁移。显式 apply 创建 Worker 账本是既有行为。
8. 不同步 Quick Detection、头像、Profile 凭据或视频文件；不是双向数据库复制，不会下载云端设备到空 SQLite。

因此 Local/Cloud 不一定天然拥有同一数据集。验收的 4 台设备一致是经过比对的特定基线，不是系统自动下载所有云端数据的承诺。单次 `synced` 也不能替代定期记录/对象完整性核对。

## 正式数据与其他数据

正式演示：CAGE-01、CAGE-02、CAGE-03、FREE-01 共 4 台，Detection 数量依次 5、4、0、6，共 15；原图及标注图共 30 个 Cloud 引用。FREE-01 为 Manual Detection，没有正式 Snapshot。Quick 属于个人数据，不包含在 15 条内，数量会随上传/删除变化。

旧数据库、DB-01 副本、field-validation 原始库、隔离 trial、清理备份均不是新部署默认数据源。已删除的 BE-04 隔离测试 Farm 不得通过旧 Worker 重新上传。本正式文档不要求接收方拥有历史本地目录。

## 备份、迁移与恢复

备份应覆盖一致性 SQLite 快照、匹配媒体、配置版本和 SHA-256 清单；密钥另行安全保存，不放公开备份。正式迁移必须先在副本执行、验证幂等性、记录数量、原字段值和媒体哈希，再由负责人批准切换。现有迁移脚本仅处理其注明的范围，不是完整 schema 版本管理器。

回滚应恢复同一时点的数据库和媒体配对；不能只恢复数据库后忽略后来发生的删除/同步。云端恢复和所有权更改需要独立审批，不能重放历史测试包。新 Supabase 项目缺少完整可审核 schema/RLS baseline，是交付待办，详见云端交接。
