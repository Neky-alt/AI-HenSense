# Device Management API 契约（Add / Rename / Remove / Purge）

[返回 README](../README.md) · [API 参考](API_REFERENCE.md) · [数据与同步](DATABASE_AND_SYNC.md) · [Pi Worker](PI_WORKER.md)

状态：**已实现**。Backend 与 Web 已接入；Mobile 按 §6 接入。

Mobile 与 Web 都按本契约对接；所有响应沿用 03 §18 统一格式 `{success, data, error:{code, message}}`，前缀 `/api/v1`，需要用户 Token（`authorized_db`）。

## 1. 已确认的业务规则

| # | 规则 | 说明 |
|---|---|---|
| R1 | `device_code` **全局唯一** | 不再只是 Farm 内唯一。保存前 `trim()` + 转大写；格式 `^[A-Z0-9-]{3,32}$`。 |
| R2 | 设备创建后**只能改名** | `device_code`、`farming_type`、`farm_id` 一律不可修改。 |
| R3 | **移除设备 = 软删除** | `is_active=false`，设备及其检测历史保留；该 code **继续被占用**，不能被任何人复用。 |
| R4 | **移除并删除历史 = 彻底删除** | 设备、全部 Detection / Alert / 设置 / 命令 / 媒体在本地与云端一并删除；之后 code 可以复用。 |
| R5 | 云端必须同步 | R1/R3/R4 在 Supabase 上必须同样成立（见 §4）。 |

## 2. 接口

### 2.1 `POST /devices` — 添加设备

```json
{ "device_code": "PI-005", "device_name": "Cage C-05", "farming_type": "caged", "farm_id": "可选" }
```

- `farm_id` 可省略：用户只有一个 Farm 时自动使用；有多个时必须传。
- 成功 `201`，`data` = `serialize_device` 格式（新设备 `device_status` 为 `offline`，`latest_detection` 为 `null`）。

| HTTP | `error.code` | 何时 | 前端提示建议 |
|---|---|---|---|
| 409 | `DEVICE_CODE_TAKEN` | code 正在被使用（任何用户，包括自己的 active 设备） | This Device ID is already registered. |
| 409 | `DEVICE_CODE_RETIRED` | code 属于**本人已移除**的设备（R3） | This Device ID belongs to a removed device. Delete its history to reuse it. → 跳转 §2.4 |
| 404 | `FARM_NOT_FOUND` | 用户没有可用 Farm / `farm_id` 不属于用户 | You need a farm before adding devices. |
| 422 | `INVALID_DEVICE_CODE` / `INVALID_DEVICE_NAME` / `INVALID_FARMING_TYPE` | 对应字段为空或格式不对（在接口内手动校验，不走全局的 `VALIDATION_ERROR`） | 高亮对应字段 |
| 422 | `VALIDATION_ERROR` | body 不是合法 JSON；或拥有多个 Farm 却没传 `farm_id`（兜底） | Check your input and try again. |
| 503 | `CLOUD_UNAVAILABLE` | 云端模式下无法完成全局唯一性校验（已确认：直接拒绝，不降级为只查本地） | Unable to verify the Device ID right now. Try again. |

> 别人的已移除设备也返回 `DEVICE_CODE_TAKEN`，不泄露是谁的设备。

### 2.2 `PATCH /devices/{device_id}` — 改名

```json
{ "device_name": "Cage C-05 (North)" }
```

- 只接受 `device_name`（1–64 字符，去首尾空格）。body 里出现其他字段 → `422 VALIDATION_ERROR`。
- 仅 active 设备；否则 `404 NOT_FOUND`。成功 `200`，返回更新后的设备。

### 2.3 `DELETE /devices/{device_id}` — 移除设备（软删除，R3）

- `is_active=false`；该设备 `pending` / `running` 的命令改为 `failed`，`error_message="Device removed"`。
- Pi 之后的 heartbeat / claim 返回 404，自然停止。
- 成功 `200`，`data = {device_id, is_active:false, history_retained:true}`。

### 2.4 `DELETE /devices/{device_id}?purge_history=true` — 移除并删除全部历史（R4）

- 对 active 或已移除的设备都可调用。**不可恢复**，前端必须二次确认。
- 成功 `200`，`data = {device_id, purged:true, detections_deleted, alerts_deleted, media_deleted, cloud_media_deleted}`。
- 云端写入开关关闭时只删本地，云端记录保留（见 §4）。
- 云端删除失败 → `503 CLOUD_UNAVAILABLE`，**本地什么都不删**，可以安全重试（幂等）。

### 2.5 `GET /devices/removed` — 已移除设备列表

返回本人 Farm 下 `is_active=false` 的设备（字段同列表，不含 `latest_detection`），用于"已移除设备 → 删除历史"入口，以及处理 `DEVICE_CODE_RETIRED`。

### 2.6 Pi 配对

当前做法：添加设备后，把设备详情页地址中的 `device_id` 填进 Pi 的 `HENSENSE_DEVICE_ID`（见 [PI_WORKER](PI_WORKER.md#怎么拿到-hensense_device_id)）。

未实现（后续可选）：`POST /hardware/devices/resolve`，Pi 用机身上的 `device_code` 换取 `device_id`，就不用手抄 UUID。编号已全局唯一，具备实现条件。

## 3. 本地实现要点（SQLite）

- **唯一索引**：模型新增 `uq_devices_device_code`（新库自动带上），旧的 `(farm_id, device_code)` 约束保留。已有数据库：停掉 Backend 和 Worker，运行 `python -m scripts.migrate_device_code_unique --database <绝对路径>` 先 dry run 查重复，再加 `--apply`（脚本会先自动备份）。没迁移之前，接口也会先用原始 SQL 做全局查重，只是少了数据库层面的并发保护。
- 软删除的行仍然占着唯一索引，所以 R3 天然成立；彻底删除行之后 code 才释放，R4 天然成立。
- `authorized_db` 的 `guard` 用的是请求开始时的 `device_ids` 快照，所以**创建设备的同一个请求里不要创建** `DeviceSettings` / `DeviceStorageSettings`；设置在读取时用默认值懒加载。
- 彻底删除时逐个调用 `session.delete()`（批量 `delete()` 语句会被 `scope` 拦成 403）；本地 FK 已经是 `ON DELETE CASCADE`。同时删掉 `LOCAL_IMAGE_DIR` 下的原图/标注图、`video_segments` 文件，以及 `be04_outbox` 里相关的 `devices` / `detections` / `alerts` 记录。

## 4. 云端同步（Supabase）

现状：BE04 Worker 是**单向、只做 upsert** 的 outbox（farms → devices → detections → alerts），需要手动开启，**不会把删除同步到云端**；Cloud 读取（Web `be04CloudApi.ts`、`/cloud/farms/{id}/devices`）已经过滤 `is_active=true`。

| 操作 | 本地 | 云端 | 一致性策略 |
|---|---|---|---|
| 添加 | 插入 Device | **先**插入云端 `devices`（secret key），云端唯一约束作为最终裁决，成功后再写本地 | 云端成功但本地失败 → 补偿删除云端行。云端不可达 → 503，什么都不创建 |
| 改名 | 更新 `device_name` | 立即尽力 upsert；失败就交给 Worker（指纹变化会重新上传） | 最终一致 |
| 移除（软删） | `is_active=false` | 同上（`is_active` 在 Worker 同步字段里） | 最终一致；云端读取已过滤 inactive |
| 删除历史 | 删除所有行与媒体 | **先**删云端：Storage 前缀 `farms/{farm_id}/devices/{device_id}/` 下全部对象 → alerts → detections → device_storage_settings → devices | 云端全部成功才删本地；每一步 404 都视为成功，保证幂等可重试 |

"云端模式" = `.env.runtime` 中 `DEVICE_CLOUD_WRITE_ENABLED=true`（同时需要 `SUPABASE_KEY`）。默认 `false`：只做本地校验和删除，改名/软删除靠 Worker 同步到云端。开关打开但没配 key → 一律 503，不会悄悄降级为只查本地。**在 Supabase 加好唯一约束之前保持 `false`。**

**需要管理员 / Yifan 在 Supabase 上确认或执行（Backend 改不了）：**

1. `devices.device_code` 加 UNIQUE 约束。**执行前先查有没有重复**：各队友 Farm 很可能都有 `CAGE-01` 之类的 Demo 编号，需要先决定怎么改名。
2. 确认 `detections` / `alerts` / `device_storage_settings` → `devices` 的外键是不是 `ON DELETE CASCADE`（仓库里没有云端 schema 基线）。不是的话按 §4 的顺序逐表删除。
3. Backend 的 `SUPABASE_KEY`（secret key `sb_secret_…`，或旧 service_role key）只放在服务端，用于唯一性校验、插入和彻底删除；绝不下发给客户端。

**已知风险**：彻底删除期间如果 Worker 同时运行，可能把还没删掉的本地记录重新 upsert 到云端。第一版要求删除时 Worker 不运行，或者给 Worker 加"跳过正在删除的设备"的判断。

## 5. 前端（Mobile / Web 共同行为）

- Add：成功后回到对应列表（caged → Cages，free_range → Free-range）并重新拉数据；按 §2.1 的错误码给出提示。
- Edit：只显示名称输入框；Device ID 和 Farming Type 只读展示。
- Delete：弹窗两个选项：**Remove device（keep history）** / **Remove and delete all history**；后者再要求一次确认（例如输入 device code）。
- Cloud 模式（`VITE_DATA_SOURCE=cloud` / `EXPO_PUBLIC_DATA_SOURCE=cloud`）下隐藏 Add / Edit / Delete，不留点了没用的按钮。

Web 已实现：`web/src/services/deviceService.ts`、`pages/AddDevice.tsx`（编号属于自己已移除的设备时，提供“删除旧历史并添加”）、`pages/EditDevice.tsx`、`components/DeleteDeviceDialog.tsx`。

## 6. Mobile 接入要点

- **请求**：用 `services/apiClient.ts` 已有的 `apiPost` / 新增 PATCH、DELETE 封装；它会带 Token，失败时抛出带 `status`、`code` 的错误。请求体字段见 §2。
- **错误提示**：在 `lib/userMessages.ts` 中加入 §2.1 的错误码（`DEVICE_CODE_TAKEN`、`DEVICE_CODE_RETIRED`、`INVALID_DEVICE_CODE`、`INVALID_DEVICE_NAME`、`INVALID_FARMING_TYPE`、`FARM_NOT_FOUND`、`CLOUD_UNAVAILABLE`），否则 409 / 422 会落到通用提示。Web 的英文文案可直接复用。
- **页面**：Add Device 页面把本地 `deviceStorage` 调用换成真实请求；提交期间禁用按钮防止重复提交；成功后返回对应列表并刷新。
- **成功响应**结构与 `GET /devices/{id}` 相同；新设备状态为 `offline`，直到 Pi 第一次心跳。不要把响应直接塞进列表，重新拉一次列表即可。
- **cloud 模式**下写请求会报 “This action requires the local Backend.”，应隐藏入口。
