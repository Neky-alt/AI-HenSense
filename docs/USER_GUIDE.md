# 用户操作手册

[返回 README](../README.md) · [部署与连接](DEPLOYMENT.md)

本手册用中文解释操作，保留实际英文界面名称。下文以 Web 为准；Mobile 由 Mobile 组维护，功能以其实际版本为准。数据模式（Local / Cloud）由维护人员设置：Cloud 模式只读，设备管理、设置保存、Run Detection Now 和删除按钮都会隐藏。

## 1. 登录、注册与密码恢复

1. 打开 Web 登录页或 Mobile，填写 Email 和 Password，点击 `Sign in`。
2. 新用户选择 `Create account`/注册入口，按页面要求填写并提交；是否需要邮件确认取决于 Supabase 项目配置。
3. 新注册账户不会自动拥有 Demo Farm。登录成功后监测为空不一定是故障。
4. 忘记密码时点击 `Forgot Password?`，填写邮箱并发送。成功提示不确认邮箱是否已经注册。
5. 在邮件中打开最新恢复链接，等待链接验证，输入新密码和确认密码再提交。Web 回到 `/reset-password`，Mobile 通过 `hensense://reset-password` 打开 App。更新后按提示重新登录。
6. 频率限制时等待后重试；失效/过期链接需重新申请，不能直接重用旧链接。
7. 切换账户前使用 `Sign out`。页面应清空旧账户数据；直接打开他人的详情或图片不会获得授权。

App 自身错误提示为英文；iOS 系统权限弹窗语言由手机系统决定。不要把密码恢复邮件或链接转发给他人。

## 2. Home 与状态

- `Home` 展示监测摘要和 `Quick Monitoring`。摘要按当前在线监测规则统计，不是历史总量。
- `Online`/`Offline` 是连接状态；`Normal`/`Warning` 是记录对应的监测判断，不是同一个维度。
- Offline 仍可显示最后一条有效记录，标为 `Last Recorded Result`，同时保留检测时间。不能把它当作当前现场画面。
- 卡片优先显示同一 Detection 的标注图，无标注图才显示原图；均缺失时显示占位，不用其他照片代替。
- 没有记录显示空值；有效的零目标检测显示 0/0/0，比例可能没有意义，应显示空值而非编造百分比。
- Mobile 首页相机图标进入 Quick Detection，提醒图标进入告警相关界面。

**Web 顶部提醒：** 信封图标显示当前 Active 告警数量和列表，数据来自 Backend。在 `Alert Settings` 关闭 In-app alerts 后，这个图标会隐藏；`Alerts` 页面不受影响。

## 3. Cage Monitoring

进入 Web `Cage Monitoring` 或 Mobile `Cage`，查看设备名称、Code、连接状态、Normal/Low/Total、比例和检测时间。列表提供的筛选/排序只改变展示，不会重算 AI 分类。

点击设备查看详情、历史和趋势。当前正式演示 CAGE-01 有 5 条、CAGE-02 有 4 条、CAGE-03 无记录。CAGE-03 无图/无历史是预期，不应添加 Mock 来填满。

Warning 使用服务端连续两次达到阈值的规则；单次低产比例较高不一定立即 Warning。页面不依据照片文件夹名重新分类。

## 4. Free-range Monitoring

- `Latest Snapshot` 只使用正式 `free_range_snapshot` 记录。
- 没有正式快照、但有手动检测时，显示 `Latest Manual Detection`，可打开 `Detection Detail`。
- Manual Detection 不替代正式快照、不参与该正式监测告警或 Home 快照统计。
- 正式演示 FREE-01 的 6 条记录均为单帧 Manual Detection，目前没有正式 Snapshot。这不是数据丢失。
- 单张 Free-range 图片不代表整个鸡群，也不表示不同图片中的鸡已去重。

## 5. Device History 与图片详情

1. 从设备卡片进入设备详情，再打开 `Detection History`。
2. 记录按时间倒序显示。点击一条记录，核对检测时间、Normal/Low/Total、比例和记录类型。
3. 有标注图时默认 `Annotated`，点击 `Original` 查看原图；旧记录无标注图时只显示原图，无图则保留占位。
4. 标注中 Normal 为绿色框，Low 为红色框；`p(Normal)` 是模型分类概率，不是实际产蛋概率或校准后的置信度。
5. 使用 `Previous`/`Next` 切换相邻记录；刷新页面后仍应保持该 Detection 的图片和数字一致。

**删除（`Detection History` 页面，每行右侧）：**

- `Delete image`：删除这条记录的原图和标注图（本系统和云端都删），数量、比例、时间保留。
- `Delete record`：把这条记录从历史中删除，并删除其图片。
- 两者都要在弹窗中确认，无法通过界面恢复。

**图片只保留 30 天**：超过 30 天的检测图片会自动删除（Pi、Backend、云端副本），记录和数量保留，页面显示占位图。这是固定规则，不能在界面上修改。

设备记录与 Quick Detection 历史分开，互不影响。

## 6. Alerts

进入 `Alerts`，用 `All`、`Active`、`Resolved` 筛选。告警由系统条件产生，用户不手动标记解决；底层条件恢复并经相应处理逻辑更新后转为 Resolved。当前演示不是持续运行的硬件采集系统，等待页面本身不会触发现场检测或保证告警定时更新。

`Alert Settings`（Profile → Alert Settings）只有一个开关 `Show alerts in the app`：关闭后隐藏顶部信封图标，告警本身照常产生和恢复。系统没有邮件或 Push 通知。

## 7. Profile

Web `Profile`、Mobile `Profile`/编辑入口可查看账户、修改显示名称、选择或移除头像并退出登录。姓名和头像信息通过 Supabase 账户 metadata 保存，头像在私有 `hensense-avatars` bucket，正常情况下可在同账户 Web/Mobile 间读取。

按页面 `Save`/照片操作提交，等成功提示后检查另一端；上传失败不要假定旧头像已经删除。Web 头像支持 JPEG/PNG/WebP、限制 2 MB；手机使用选图器处理。更改显示名称不是更改登录邮箱或 Farm 所有权。

## 8. 设备管理

### 添加设备

1. `Cage Monitoring` 或 `Free-range Monitoring` 页面右上角点 `+`。
2. 填 `Device ID`（Raspberry Pi 机身上的编号，3–32 位字母、数字或连字符，自动转大写）、`Device Name`，选择 `Caged` 或 `Free-range`。**养殖类型添加后不能修改。**
3. 点 `Add Device`。成功后新设备显示为 Offline，等 Pi 配置好 `device_id` 并发出第一次心跳后变为 Online（配置见 [PI_WORKER](PI_WORKER.md)）。

常见提示：

| 提示 | 含义 |
|---|---|
| This Device ID is already registered. | 编号已被使用（任何账户） |
| This Device ID belongs to a device you removed… | 编号属于你以前移除的设备，历史还在。页面会提供 `Delete old history and add this device`，确认后永久删除旧历史并添加新设备 |
| You need a farm before adding devices. | 账户没有 Farm，请联系管理员 |
| Unable to reach the cloud right now… | 云端暂时不可达，没有做任何修改，稍后重试 |

### 改名

设备卡片 `Edit`：只能修改 `Device Name`；Device ID 和养殖类型只读。

### 删除设备

设备卡片 `Delete`，弹窗中二选一：

- `Remove device`：停止监测并从列表隐藏，**历史保留**，这个编号以后不能再用。
- `Remove and delete all history`：永久删除设备及其全部检测、告警和图片（包括云端副本）。需要输入设备编号确认，之后编号可以重新使用。

### Run Detection Now

设备详情页点 `Run Detection Now`：Pi 立即拍一张照片并检测，完成后出现在历史中。设备 Offline 时按钮不可用；重复点击不会重复排队。Pi 5 分钟内没有结果时，这次命令自动标为失败。

## 9. Settings

| 页面 | 入口 | 作用 |
|---|---|---|
| `Cage Settings` | Cage 页面 `Settings` 或 Profile | 监测开关、时间窗、定时 / 间隔、Low-production Ratio 阈值；Pi 按此自动采样 |
| `Free-range Settings` | Free-range 页面 `Settings` 或 Profile | 监测开关、时间窗、快照间隔、Low Count 阈值 |
| `Alert Settings` | Profile | In-app alerts 开关 |

设置保存在 Backend，对该 Farm 的所有设备生效；刷新页面或换浏览器后仍然存在。保存失败会显示错误，不会假装成功。

## 10. Mobile Quick Detection

1. 首页右上角点击相机图标。
2. 默认 `Caged`；需要时选择 `Free-range`。Free-range 页面说明仅是单张图片结果。
3. 点击 `Take Photo` 或 `Choose from Gallery`；权限只在主动使用时申请。取消选择不产生检测。
4. 检查图片预览，必要时重新选择，然后点击 `Analyze Photo`。
5. 等待 `Uploading photo...` 和 AI 分析状态，处理中不重复点击。
6. 完成后查看原图、标注图、数量、比例、时间和 `Phone Upload / Quick Detection` 类型。

支持 JPEG/PNG，上传不超过 10 MB，图片不超过 24 megapixels；HEIC 不能直接交给 Backend，需通过手机选图流程输出兼容图片或另行转换。0/0/0 是有效检测，不能人为加框。

失败处理：权限拒绝后可去系统 Settings 开启；断网/上传停滞约 20 秒会报错，分析总期限约 190 秒。保留原照片、模式和 request ID，先到 History 检查是否已完成，再重试同一请求；超时不等于服务端一定取消。不要为了重试换图或新建请求导致额外记录。

Cloud 监测模式不会把 Quick Detection 变成纯云端功能。外出时必须仍能安全访问 Backend，且 Backend 能连接 AI；只连 Supabase 不够。查看已有 Quick 历史不需要 AI 重新推理，但必须连接原 Backend。

## 11. Quick Detection History 与删除

在 Quick Detection 页面右上角点击 `History`。只显示当前用户的手机记录，按创建时间倒序，状态为 `Completed`、`Analyzing` 或 `Failed`。

- 点卡片进入详情，使用 `Original`/`Annotated` 和 `Previous`/`Next`。
- 超过一页显示 `Previous Page`（较新一页）、`Next Page`（较旧一页）和页码；不足一页不显示分页。点击 `Refresh` 刷新。
- 卡片右上角垃圾桶图标弹出 `Delete detection?`；`Cancel` 放弃，`Delete` 确认永久删除自己的该记录及专属媒体。
- 删除后列表自动刷新，空的末页会退回；全部删除后显示 `No phone detections yet.`。
- 正在处理的记录不能直接删除；失败提示时不要假定成功，可刷新后安全重试。

删除不可通过界面恢复，不影响 Device History、Farm 统计或告警。确认前核对时间和照片，不把正式数据当作删除测试对象。
