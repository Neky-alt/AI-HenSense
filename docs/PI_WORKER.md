# Pi Worker

[返回 README](../README.md) · [API 参考](API_REFERENCE.md) · [部署](DEPLOYMENT.md)

`pi_worker/` 运行在 Raspberry Pi 上：定时发心跳、领取 Run Detection Now 命令、按监测设置自动采样、拍照、本地推理（YOLO + ProtoMIL），把图片和结果上传给 Backend。Pi 不直接连接 Supabase，也不需要 AI 服务。

## 1. 安装

```sh
cd pi_worker
python3 -m venv --system-site-packages .venv   # 让 venv 能使用系统安装的 Picamera2
.venv/bin/python -m pip install -r requirements.txt
```

- Picamera2 由 Raspberry Pi OS 提供（未预装时 `sudo apt install python3-picamera2`）。
- 依赖：`requests`、`torch`、`torchvision`、`ultralytics==8.2.103`、`numpy`、`Pillow`。
- 权重放在 `pi_worker/weights/`（不进 Git）：`detector_yolov8n_head_best.pt`、`caged_protomil_best.pt`、`free_range_protomil_best.pt`，由 AI 组提供。

## 2. 配置（环境变量）

| 变量 | 必填 | 说明 |
|---|---|---|
| `HENSENSE_BACKEND_URL` | 是 | Backend origin，例如 `http://192.168.1.20:8006`（不含 `/api/v1`；必须是 LAN IP，不能是 localhost） |
| `HENSENSE_DEVICE_ID` | 是 | 这台 Pi 对应的 Backend `device_id`（UUID） |
| `HENSENSE_HARDWARE_API_KEY` | 是 | 与 Backend `.env.runtime` 的 `HARDWARE_API_KEY` 相同 |
| `HENSENSE_POLL_INTERVAL_SECONDS` | 否 | 轮询间隔，默认 5 |
| `HENSENSE_REQUEST_TIMEOUT_SECONDS` | 否 | 单次请求超时，默认 10 |
| `HENSENSE_TEST_IMAGE` | 否 | 开发用：在没有摄像头的电脑上用这张图片代替拍照 |
| `CAGED_DET_WEIGHTS` / `CAGED_CLS_CKPT` / `FREE_RANGE_DET_WEIGHTS` / `FREE_RANGE_CLS_CKPT` | 否 | 覆盖默认权重路径 |
| `CAGED_CONF_THRESHOLD`（0.25）/ `FREE_RANGE_CONF_THRESHOLD`（0.5）/ `FREE_RANGE_TOP_K`（1） | 否 | 推理阈值，由 AI 组决定，不随意修改 |
| `HENSENSE_INFERENCE_DEVICE` | 否 | 推理设备，默认 CPU |

### 怎么拿到 `HENSENSE_DEVICE_ID`

1. 在 Web 上 `Add Device`，Device ID 填 Pi 机身上的编号（例如 `PI-005`）。
2. 打开该设备的详情页，浏览器地址栏 `/devices/<uuid>` 中的 `<uuid>` 就是 `device_id`。
3. 填进 Pi 的 `HENSENSE_DEVICE_ID`，启动后第一次心跳成功，设备即变为 Online。

设备被移除（软删除）或彻底删除后，心跳和领取命令返回 404，Pi 会持续报错但不会再执行任务。

## 3. 运行

```sh
cd pi_worker
export HENSENSE_BACKEND_URL=http://192.168.1.20:8006
export HENSENSE_DEVICE_ID=92000000-0000-0000-0000-000000000001
export HENSENSE_HARDWARE_API_KEY=...        # 不要写进 Git
.venv/bin/python main.py
```

在电脑上联调（无摄像头）：再设置 `HENSENSE_TEST_IMAGE=/path/to/test.jpg`。

开机自启（systemd）尚未提供，是待办项。

## 4. 每个轮询周期做什么

1. 每小时清理一次 `pi_worker/captures/` 中超过 30 天的图片（固定保留期，与 Backend 一致）。
2. `heartbeat`：Backend 更新 `last_seen_at`，同时检查超时命令和 30 天图片保留。
3. `monitoring-config`：读取设备类型和监测设置。
4. `commands/claim`：有手动命令就优先执行：拍照 → 推理 → 上传结果。
5. 没有命令时问 `monitoring-due`；到点就采一个自动样本并上传。

## 5. 可靠性规则

| 情况 | 行为 |
|---|---|
| 多个 worker 同时领取同一命令 | Backend 用条件更新，只有一个成功 |
| 上传失败（网络错误 / 5xx） | Pi 重试 3 次（2 s、5 s、10 s） |
| 上传返回 409 | Backend 已关闭该命令（已完成或已超时），Pi 停止重试 |
| 拍照 / 推理 / 上传最终失败 | Pi 调用 `fail` 回报失败 |
| Pi 中途断电或进程退出 | 命令 running 超过 300 秒被 Backend 判为失败（“Device did not report a result in time”） |
| 命令一直没人领 | pending 超过 600 秒判为失败（“Device did not pick up the command in time”） |
| 两次询问同一个监测时段 | 第一个调用者得到 `due=true` 并占住该时段 300 秒；其他人得到 `sample_in_progress`，样本提交后释放 |

超时值在 Backend 配置：`COMMAND_RUNNING_TIMEOUT_SECONDS`、`COMMAND_PENDING_TIMEOUT_SECONDS`、`MONITORING_SAMPLE_LEASE_SECONDS`。如果真机上“加载模型 + 拍照 + 推理”超过 5 分钟，需要调大 running 超时。

## 6. 硬件接口

全部在 `/api/v1/hardware` 下，认证用请求头 `X-Hardware-Key`（不是用户 Token）。设备不存在或已移除返回 404。

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/devices/{device_id}/heartbeat` | 更新 `last_seen_at`；返回 `device_status` |
| GET | `/devices/{device_id}/monitoring-config` | 设备类型与监测设置 |
| GET | `/devices/{device_id}/monitoring-due` | 是否到采样时间：`due`、`reason`、`due_at`、`farm_timezone` |
| POST | `/devices/{device_id}/commands/claim` | 原子领取最早的 pending 命令；没有时 `data=null` |
| POST | `/devices/{device_id}/commands/{command_id}/detection` | multipart：`file`（JPEG / PNG）+ `result_json`；保存检测并完成命令 |
| POST | `/devices/{device_id}/commands/{command_id}/complete` | 手动完成命令 |
| POST | `/devices/{device_id}/commands/{command_id}/fail` | `{"error_message": "..."}` |
| POST | `/devices/{device_id}/monitoring-samples` | multipart：自动样本；Cage 直接生成检测，Free-range 进入快照聚合 |

## 7. 待真机验证

模型只加载一次（缓存）、Pi 重启后的状态恢复、systemd 自启、摄像头方向 / 分辨率、长时间运行的资源占用、断网重连。
