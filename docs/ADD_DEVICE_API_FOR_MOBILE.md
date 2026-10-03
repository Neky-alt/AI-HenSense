# Add Device 接口说明（给 Mobile）

[完整设备管理契约](DEVICE_MANAGEMENT_API.md) · [API 参考](API_REFERENCE.md)

状态：**接口已定稿，Backend 正在实现**。请先按本文写页面，用下面的错误码表做 mock；Backend 合并后字段不会再变。

---

## 1. 结论先说

| 问题 | 答案 |
|---|---|
| 路径 | `POST /api/v1/devices` |
| 请求字段 | `device_code`、`device_name`、`farming_type`，以及可选的 `farm_id` |
| 要不要 pairing code？ | **不要。**第一版没有配对码，`device_code`（印在 Pi 机身上的编号）就是设备身份，并且**全局唯一** |
| "已绑定"怎么判断？ | Backend 判断。编号被任何人占用都返回 `409 DEVICE_CODE_TAKEN`；属于你自己已移除的设备则返回 `409 DEVICE_CODE_RETIRED` |
| 成功后 | 返回新设备对象（状态 `offline`），前端回到列表并**重新拉数据** |

> 为什么不用 pairing code：Pi 没有屏幕，没法显示一次性配对码；用 `device_code` 全局唯一来保证"一台 Pi 只能被一个账户添加"，效果相同，实现简单。Pi 端后续会用同一个 `device_code` 自动找到自己的 `device_id`，Mobile 不用管这部分。

## 2. 请求

```http
POST /api/v1/devices
Authorization: Bearer <Supabase access token>
Content-Type: application/json
```

```json
{
  "device_code": "PI-005",
  "device_name": "Cage C-05",
  "farming_type": "caged"
}
```

| 字段 | 类型 | 必填 | 规则 |
|---|---|---|---|
| `device_code` | string | 是 | Backend 会 `trim` 并转成大写后保存。格式 `^[A-Z0-9-]{3,32}$`（字母、数字、连字符，3–32 位）。**创建后不能修改** |
| `device_name` | string | 是 | 去掉首尾空格后 1–64 字符。之后可以改名 |
| `farming_type` | `"caged"` \| `"free_range"` | 是 | **创建后不能修改** |
| `farm_id` | string (UUID) | 否 | 用户只有一个 Farm 时省略即可；有多个 Farm 时必须传。目前 Demo 用户都只有一个，Mobile 第一版可以不传 |

前端可以先做同样的格式校验（提交前转大写、检查正则），但**以 Backend 返回为准**。

## 3. 成功响应 `201`

统一格式（03 §18）：

```json
{
  "success": true,
  "data": {
    "device_id": "3f1c9a2e-8b7d-4e21-9c55-2a6f0d1b7e44",
    "farm_id": "a0b1c2d3-....",
    "device_code": "PI-005",
    "device_name": "Cage C-05",
    "farming_type": "caged",
    "device_status": "offline",
    "last_seen_at": null,
    "is_active": true,
    "created_at": "2026-10-03T04:30:00Z",
    "updated_at": "2026-10-03T04:30:00Z",
    "latest_detection": null
  },
  "error": null
}
```

- 结构和 `GET /devices/{id}` 一样（`serialize_device`）。新设备没有心跳，所以一定是 `offline`；Pi 发出第一次 heartbeat 后才会变成 `online`。
- Mobile 的 `Device` 类型是展开后的格式（`normal_count`、`total_count` 等）。**不要直接把这个响应塞进列表**，成功后重新调用现有的设备列表加载函数就行。

## 4. 错误码

失败格式：

```json
{ "success": false, "data": null, "error": { "code": "DEVICE_CODE_TAKEN", "message": "Device code is already registered" } }
```

| HTTP | `error.code` | 何时出现 | 建议提示（英文 UI） | 前端动作 |
|---|---|---|---|---|
| 409 | `DEVICE_CODE_TAKEN` | 编号已被注册（任何账户，包括你自己正在使用的设备） | This Device ID is already registered. | 停在表单，高亮 Device ID |
| 409 | `DEVICE_CODE_RETIRED` | 编号属于**你自己已移除**的设备（历史还在，所以编号仍被占用） | This Device ID belongs to a removed device. Delete its history to reuse it. | 提示即可。删除历史的入口（`GET /devices/removed` + `DELETE ...?purge_history=true`）属于 P1，第一版可以只提示不跳转 |
| 422 | `INVALID_DEVICE_CODE` | 编号为空或格式不对 | Device ID must be 3–32 letters, numbers or hyphens. | 高亮 Device ID |
| 422 | `INVALID_DEVICE_NAME` | 名称为空或超过 64 字符 | Enter a device name (up to 64 characters). | 高亮 Device Name |
| 422 | `INVALID_FARMING_TYPE` | 不是 `caged` / `free_range` | Choose a farming type. | — |
| 422 | `VALIDATION_ERROR` | body 不是合法 JSON 或缺字段（兜底） | Check your input and try again. | — |
| 404 | `FARM_NOT_FOUND` | 账户没有 Farm，或 `farm_id` 不属于你 | You need a farm before adding devices. | 返回上一页 |
| 401 | `UNAUTHORIZED` | Token 缺失或过期 | 沿用现有提示 | 走现有重新登录流程 |
| 503 | `CLOUD_UNAVAILABLE` | Backend 暂时无法向云端确认编号是否唯一 | Unable to verify the Device ID right now. Please try again. | 允许重试 |
| 5xx | 其他 | 服务异常 | 沿用现有 5xx 提示 | 允许重试 |

**注意：**为了不泄露其他账户的信息，别人已移除的设备也只返回 `DEVICE_CODE_TAKEN`。

## 5. Mobile 接入建议

现有代码几乎都能复用：

1. **请求**：用 `services/apiClient.ts` 里已有的 `apiPost`。它已经会带 Token，失败时抛出 `serviceError(status, code)`。

   ```ts
   // services/deviceService.ts（新建）
   import { apiPost } from './apiClient';
   import type { FarmingType } from '../types/device';

   export interface CreateDevicePayload {
     device_code: string;
     device_name: string;
     farming_type: FarmingType;
     farm_id?: string;
   }

   export function createDevice(payload: CreateDevicePayload) {
     return apiPost<{ device_id: string; device_code: string; farming_type: FarmingType }>(
       '/devices',
       payload,
     );
   }
   ```

2. **错误提示**：在 `lib/userMessages.ts` 的 `messages` 表里加上 §4 的错误码。否则 409 / 422 会落到现有的通用提示（422 的通用提示还是关于照片的，不合适）。

3. **页面**：`app/device/add.tsx` 里已经有一个 `LegacyAddDevice` 表单。把默认导出从 `ReadOnlyNotice` 换回表单，把 `services/deviceStorage.ts` 的 `addDevice(...)` 换成 `createDevice(...)`；提交期间禁用按钮，防止重复提交；成功后 `router.replace` 回 `/cage` 或 `/free-range`，并触发列表刷新。

4. **Cloud 模式**：`EXPO_PUBLIC_DATA_SOURCE=cloud` 时 `apiPost` 会直接报 "This action requires the local Backend."。这种模式下建议隐藏 Add Device 入口，或者显示这句话，不要留一个点了没用的按钮。

## 6. 本页范围之外（之后补）

- 改名：`PATCH /api/v1/devices/{id}`，body 只有 `{ "device_name": "..." }`
- 移除设备（保留历史）：`DELETE /api/v1/devices/{id}`
- 移除并删除全部历史：`DELETE /api/v1/devices/{id}?purge_history=true`
- 已移除设备列表：`GET /api/v1/devices/removed`

详见 [DEVICE_MANAGEMENT_API.md](DEVICE_MANAGEMENT_API.md)。
