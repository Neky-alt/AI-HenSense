# Supabase 云端与账号交接

[返回 README](../README.md) · [数据与同步](DATABASE_AND_SYNC.md)

## 1. 两种权限必须分开

| 权限 | 控制什么 | 不代表什么 |
|---|---|---|
| Supabase Dashboard 团队/项目成员 | 控制台、配置、运维与数据库管理能力 | 不会自动拥有 HenSense Farm |
| HenSense 应用账户 | Supabase Auth 用户、当前 Token | 注册成功不自动获得 Demo 数据 |
| `farms.user_id` | 当前实现的 Farm owner | 没有已交付的多成员 Farm 角色系统 |
| 服务端高权限密钥 | Worker/可选代理的服务器能力 | 不能给前端当用户身份或用于绕过权限 |

由项目负责人在 Supabase 管理端邀请队友使用自己的管理账户，按职责授予所需权限。具体可用角色名称及项目权限由管理员在实际组织设置中确认，文档不假定所有成员都应是最高权限。

队友在 HenSense 注册自己的应用账户并完成项目要求的邮箱确认。没有 Farm 时看到英文空状态是预期，Quick Detection 仍按其自己的 user_id 保存。不得共享原 owner 的密码、Token 或恢复邮件。

## 2. Demo Farm 与新用户授权

当前正式 Demo Farm 的 owner 不变。若队友需要同一份演示数据，必须由负责人决定受控演示方式；当前没有直接授予第二用户同 Farm membership 的已交付流程，不能仅加入 Dashboard 团队就期望 App 显示 Demo。

若要为队友建立自己的 Farm，管理员应先审核云端建档及本地 UUID 对齐方案，在独立数据范围实施，不重新分配原 Demo Farm。Worker 的 BE04_FARM_ID/BE04_OWNER_USER_ID 必须是真实批准的对应关系。现有代码拒绝云端 owner 不匹配，不能通过改本地假用户或固定 Demo 身份解决。

多用户共享同一 Farm 若需要 membership 表、RLS 或 API 改造，属于后续设计/审批，本交接不宣称已支持。

## 3. 环境和项目资料

负责人需提供项目标识/URL、公钥、私有 bucket 名称及策略说明、认证邮件与重定向配置、Schema/RLS/触发器版本、管理权限联系人。实际配置通过私下安全渠道交接，不写入公开文档。

客户端使用 `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` 和 `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`。Backend 使用 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` 验证真实用户；`SUPABASE_KEY` 仅供服务端。

同一个项目的 public key 与服务端高权限 key 用途不同。前端公钥可打包但仍需正确 RLS；本文件不包含任何实际 key。不要把整个 `.env`、终端环境、数据库导出或 signed URL 放入工单截图。

新 Supabase 项目不能只设置 URL 就复制全部功能：仓库目前没有覆盖所有表、RLS、触发器和 Storage policies 的完整基线。`HenSense_V4_3_Avatar_Storage.sql` 只是头像相关脚本，不是全量建库。需管理员交付审核后的完整迁移/策略资料；缺少时停止新项目初始化，不猜测 SQL。

## 4. 邮件与 Storage

Web 密码恢复根据当前 origin 生成回调，默认应按使用情况配置：

- `http://localhost:5173/reset-password`
- `http://127.0.0.1:5173/reset-password`
- Mobile：`hensense://reset-password`

LAN/后续正式域名要添加其精确回调；不要用个人 IP 示例或无必要的全域通配。邮件确认、SMTP、发送限额及项目 URL 配置由管理员核实，不能把旧邮件恢复测试成功视为新项目邮件已配置。

`detection-images` 保存设备媒体，`hensense-avatars` 保存用户头像，两者应按实际策略保持私有。Cloud 读使用用户权限和短期签名 URL。新项目必须验证未登录/其他用户不能获取记录或签名，而不是只验证 owner 能显示图片。

## 5. 安全交接与轮换

1. 清点仍在使用的 Backend、Worker、自动化和可选云代理；记录密钥使用位置但不记录明文。
2. 管理员通过组织认可的密码管理/秘密管理渠道交付服务端凭据，不发在聊天、GitHub 或客户端配置中。
3. 轮换前备份配置并确认回滚及维护窗口；按 Supabase 当前密钥类型支持的方式生成替代凭据，不擅自更改 JWT signing 配置。
4. 在隔离环境验证用户认证、Farm 过滤、Worker 状态和受控同步，再更新批准的服务端配置并协调重启。
5. 核对无旧消费者后撤销旧凭据，记录操作人、时间和验证结果。密钥轮换不意味着迁移 Demo Farm 所有权。
6. 项目移交后审查团队成员、强认证、最小权限、备份恢复和日志脱敏。退出成员的应用会话、管理权限和服务密钥需分别处理。

本阶段未访问或修改 Dashboard、RLS、Farm owner 或云端数据，也未验证团队当前角色和订阅备份能力；这些是人工交接事项。
