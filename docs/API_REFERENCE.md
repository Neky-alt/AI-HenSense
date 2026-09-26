# API 参考

[返回 README](../README.md) · [权限与数据](DATABASE_AND_SYNC.md)

依据 `backend/app/main.py`、`backend/app/routers/` 和 AI `api_server.py`。Backend origin 为 `http://127.0.0.1:8006`，默认前缀 `/api/v1`。本表是当前代码的接口，不表示前端已启用所有写操作。

## 认证与通用结构

除健康检查和框架文档外，业务接口使用 `Authorization: Bearer <access-token>`。每次请求向 Supabase 验证；设备域还验证真实 Farm 所有权。不存在/不属于当前用户的资源通常返回 404，不能用自填 user_id 绕过。Auth、注册、Profile、密码恢复由 Supabase SDK 直接处理，不存在自建 `/login`、`/register` API。

普通业务成功结构：

```json
{"success": true, "data": {}, "error": null}
```

普通失败结构：

```json
{"success": false, "data": null, "error": {"code": "UNAUTHORIZED", "message": "Sign in to continue"}}
```

`data` 可是数组、对象或 null；媒体返回图片二进制而不是 JSON。可选 `/cloud` 路由成功是 `{"data": ...}`，媒体签名还带 `expires_in_seconds`，并不使用普通 success envelope。客户端应按 HTTP 状态/error code 映射英文提示，不直接展示原始服务错误。

## 全部 Backend 业务路由

下表路径均加 `/api/v1`。设备 ID 必须与 Farm 授权以及 Detection 所属设备一致。

| 方法 | 路径 | 参数与返回摘要 |
|---|---|---|
| GET | `/health` | 无认证；data.status、database、app_version、api_prefix |
| GET | `/devices` | 可选 query：farming_type=caged/free_range；status=normal/warning/offline；sort=low_desc/low_asc/name_asc/name_desc；返回有权访问且 active 的设备数组 |
| GET | `/devices/{device_id}` | 返回设备信息、计算状态、最新监测检测 |
| GET | `/devices/{device_id}/detections/latest` | Cage 最新记录；Free-range 仅正式 snapshot；可返回 null |
| GET | `/devices/{device_id}/detections` | 未软删除历史数组，detected_at、created_at 倒序；当前无分页 query |
| GET | `/devices/{device_id}/alerts` | 设备告警数组，created_at 倒序 |
| GET | `/devices/{device_id}/detections/{detection_id}/image` | 受保护原图；无图/删除/跨设备返回 404 |
| GET | `/devices/{device_id}/detections/{detection_id}/annotated-image` | 同记录受保护标注图 |
| POST | `/devices/{device_id}/detect` | 无上传 body；从 Capture Adapter 取图调用 AI，返回 Detection；设备必须 Online，当前 UI 禁用 |
| GET | `/dashboard/summary` | 返回 cage/free_range 摘要；遵循在线及正式快照规则 |
| GET | `/monitoring-settings/{farming_type}` | caged/free_range；当前授权范围的设置 |
| PUT | `/monitoring-settings/{farming_type}` | MonitoringSettingsUpdate JSON，返回保存结果 |
| GET | `/devices/{device_id}/storage` | 设备媒体容量/使用状态；读取服务端 local_storage 对应磁盘，不能据此宣称实测 Pi SD 卡 |
| GET | `/devices/{device_id}/storage/settings` | 设备保留/容量策略 |
| PUT | `/devices/{device_id}/storage/settings` | StorageSettingsUpdate JSON |
| GET | `/notification-settings` | 当前用户投递偏好 |
| PUT | `/notification-settings` | NotificationSettingsUpdate JSON |
| POST | `/quick-detections` | Bearer + Idempotency-Key + multipart，见下文 |
| GET | `/quick-detections` | limit 默认 30、1–100；offset 默认 0、≥0；返回 items、next_offset |
| GET | `/quick-detections/{id}` | 当前用户详情，加 previous_id（较旧）和 next_id（较新） |
| GET | `/quick-detections/{id}/image` | 当前用户成功结果的展示原图 |
| GET | `/quick-detections/{id}/annotated-image` | 当前用户成功结果的标注图 |
| DELETE | `/quick-detections/{id}` | UUID、无文件路径参数；成功 data.deleted=true；永久删除当前用户记录和专属媒体 |

以下四项仅在 `BE04_CLOUD_READ_ENABLED=true` 时注册，默认不存在：

| 方法 | 路径 | 约束 |
|---|---|---|
| GET | `/cloud/farms/{farm_id}/devices` | 验证云端 Farm owner；最多 100 台 |
| GET | `/cloud/farms/{farm_id}/detections` | 必填 query device_id；limit 默认 30、1–100；排除软删除 |
| GET | `/cloud/farms/{farm_id}/detections/{detection_id}/media` | 验证 Farm→Device→Detection→对象前缀，返回 original/annotated 签名 URL，期限 60 秒 |
| GET | `/sync/status` | 验证本地用户归属或明确配置且云端复核的 owner 映射；返回本地 outbox 与 detection_states，不启动 Worker |

当前没有正式设备新增/编辑/删除、设备 Detection 删除、告警手工解决、Farm 自助开户或远程 Pi 指令执行 HTTP API。单条设备 Detection 详情由客户端从设备历史中定位，不要假设存在额外 `/detections/{id}` JSON 路由。多 Farm 设置选择当前没有显式 farm_id 参数，应作为后续多 Farm 配置设计限制核验。

## 主要返回字段

Device：`device_id`、`farm_id`、`device_code`、`device_name`、`farming_type`、`device_status`、`last_seen_at`、`latest_detection` 等；最新记录可为 null。

Detection：`detection_id`、`device_id`、`detected_at`、`trigger_type`、`capture_source_type`、数量/比例、`monitoring_status`、`confidence`、`image_path`、`image_url`、`annotated_image_url`、`ai_instances`、`ai_response`、`provenance`、`image_deleted_at`、`deleted_at`、`sync_status`、`created_at`。历史字段 image_path 不是客户端可直接访问的文件地址。

Quick：`quick_detection_id`、`record_type=quick_detection`、`source_label`、`farming_type`、`source_type`、`status`、`error_code`、`created_at`、`completed_at`、数量/比例、两个媒体 URL、`ai_instances`、`provenance`。完整 ai_response 存库但当前 Quick 序列化不直接返回该字段。零目标的 normal_ratio/low_ratio 为 null。

## 设置写入 body

`MonitoringSettingsUpdate`：

- 必填 `monitoring_enabled`。
- `monitoring_start_time`、`monitoring_end_time` 可空，但必须成对，格式 HH:MM。
- Cage 必须有 `detection_mode`（interval/scheduled）、`cage_warning_low_ratio_threshold`（0–1）；interval 需 `detection_interval_minutes>=1`，scheduled 需非空 `scheduled_times` HH:MM 数组。
- Free-range 必须有 `result_snapshot_interval_minutes>=1`、`free_range_warning_low_count_threshold>=0`。

`StorageSettingsUpdate`：必填 `store_detection_images`、`store_video_locally`、`max_media_storage_gb>0`、`storage_limit_action`（delete_oldest/stop_recording）。启用相应存储时，`detection_image_retention_days`/`video_retention_days` 必须为 1–3650。Cage 不允许 continuous video；容量不能超过服务端计算的容量。

`NotificationSettingsUpdate`：`in_app_enabled` 必填，`email_enabled` 和 `push_enabled` 默认 false。保存偏好不证明投递服务已实现。

## Quick 上传与删除

multipart 字段：`file` 必填，`farming_type` 默认 caged，可选 free_range；`source_type` 必填 camera/gallery。`Idempotency-Key` header 必须为 UUID，同一用户重试保留该值。

校验 MIME、实际解码、10 MB 默认上限、24 MP、单帧图片和 EXIF；只支持 JPEG/PNG。返回 201 表示首次成功，200 表示已成功请求的重试结果，202 表示同一请求处理中。相同 key 换图片、模式或 source 返回 409。失败记录仍可进入历史供诊断/重试；GET 历史/详情可能回收过期 processing lease，所以不能将这些 GET 当作严格“字节不变”的数据库审计工具。

示意命令，仅用于批准的隔离上传测试；ACCESS_TOKEN 从自己的有效会话私下取得，勿写入脚本或文档：

```sh
export BACKEND_ORIGIN=http://127.0.0.1:8006
# Generate once for one logical request; keep this value for retries.
REQUEST_ID="$(uuidgen)"
PHOTO_PATH=/absolute/path/to/approved-photo.jpg
# ACCESS_TOKEN must already contain your own valid session token.
curl --fail-with-body "$BACKEND_ORIGIN/api/v1/quick-detections" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Idempotency-Key: $REQUEST_ID" \
  -F "farming_type=caged" -F "source_type=gallery" \
  -F "file=@$PHOTO_PATH;type=image/jpeg"
```

删除使用服务器保存的 owner/attempt 路径，校验共享引用和符号链接。先暂存媒体，提交记录删除后清理；失败可能返回 DELETE_CLEANUP_PENDING，重试只清理同用户暂存目录，不接收任意路径。

## 典型错误

| HTTP/代码 | 含义 |
|---|---|
| 401 UNAUTHORIZED | 无效、缺失或过期 Token |
| 403 FORBIDDEN | 不支持的范围写入/同步状态权限不足 |
| 404 NOT_FOUND | 无记录、非所有者、无媒体或未注册可选路由 |
| 409 DEVICE_OFFLINE | 设备手动检测时 Offline |
| 409 / DELETE_BUSY | 幂等冲突，或 Quick 正在处理不能删除 |
| 413 / 415 / 422 | 大小、格式、内容或参数不合法 |
| 502 INVALID_AI_RESULT / DETECTION_FAILED | 设备 AI/捕获结果异常 |
| 503 CAPTURE_NOT_CONFIGURED / AI_SERVICE_UNAVAILABLE | 设备 Capture/AI 未就绪 |
| 503 | Supabase 不可达/配置缺失、删除清理异常等；通用 HTTP 错误可能编码为 HTTP_ERROR |
| 507 IMAGE_STORAGE_FAILED | 设备图片保存失败 |
| DELETE_UNSAFE_MEDIA / DELETE_FAILED / DELETE_CLEANUP_PENDING | Quick 删除范围不安全、失败或待完成清理 |

错误码并非所有路由都完全一致；以实际 error.code 和 HTTP 状态为准。Quick 推理失败通常返回 502，并在记录中保留 AI_UNAVAILABLE/ANALYSIS_FAILED/CLEANUP_REQUIRED；不能假设它与设备 detect 的错误结构完全相同。

## AI 内部 API

AI origin 为 `http://127.0.0.1:8004`，没有 Backend 的 `/api/v1` 前缀：

| 方法 | 路径 | 内容 |
|---|---|---|
| GET | `/health` | 模型配置/加载状态 |
| POST | `/predict/caged` | multipart file；Caged 推理 |
| POST | `/predict/free_range` | multipart file；Free-range 单图推理 |

AI 返回 `total_count`、`high_count`、`low_count`、`ratio_normal`、`cage_label`、`instances` 等。Adapter 把 high_count 映射为 normal_count；实例含 bbox{x1,y1,x2,y2}、label=normal/low_yield、prob_normal。AI 本身没有 Supabase Token 验证，应保留内部监听，不直接向公网或手机开放。无目标实例数组为空。

## Swagger

运行 Backend 后访问 `http://127.0.0.1:8006/docs`，机器描述为 `/openapi.json`；AI 也有自己的 `/docs`。这些是框架文档路径，不属于 `/api/v1`。当前认证用 Header 参数声明，不应假设有全局 OAuth 登录按钮；在受保护操作的 authorization 字段填写自己的 `Bearer ...`。写操作只对隔离测试环境 Try it out，不对演示数据随意点击。

前端 Cloud 模式直连 Supabase SDK/PostgREST，其 RLS/Schema 由云端项目管理，不是这些 FastAPI Router 自动创建的。
