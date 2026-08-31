# 数字人 GPU 服务接口与上线要求

灵枢 Web 服务不直接加载数字人模型。生产环境通过私网 HTTP 调用独立 GPU Worker，避免模型显存、推理超时和 Web 请求互相影响。未配置 `DIGITAL_HUMAN_API_URL` 时，产品会明确锁定生成入口，不产生占位或伪造结果。

## 接口约定

所有接口支持 `Authorization: Bearer <DIGITAL_HUMAN_API_KEY>`，请求和响应使用 JSON。

### 创建任务

`POST /v1/jobs`

请求包含：

```json
{
  "externalJobId": "灵枢任务 ID",
  "provider": "musetalk-v1.5-local",
  "avatarVideoUrl": "可下载的人物视频 URL",
  "audioUrl": "可下载的口播音频 URL",
  "script": "生成时的脚本快照",
  "language": "zh",
  "mode": "quality",
  "output": { "ratio": "9:16", "container": "mp4" }
}
```

返回 HTTP 202/200：

```json
{ "id": "worker-task-id", "status": "processing", "stage": "preprocess", "progress": 5 }
```

### 查询任务

`GET /v1/jobs/:id`

处理中返回 `status=processing|quality_check`、`stage` 和 0–100 的 `progress`。完成时必须返回：

```json
{
  "id": "worker-task-id",
  "status": "completed",
  "stage": "completed",
  "progress": 100,
  "outputUrl": "https://受信任主机/output.mp4",
  "quality": {
    "passed": true,
    "lipSyncScore": 4.86,
    "avOffsetFrames": 2,
    "freezeSegments": 0,
    "notes": []
  }
}
```

`quality.passed` 不是 `true` 时，灵枢只把任务标记为“待复核”，禁止自动进入成片。失败返回 `status=failed`，并附 `errorCode`、`error`。

### 取消任务

`POST /v1/jobs/:id/cancel`。Worker 应停止排队或推理，并使后续查询返回 `status=cancelled`。

## Worker 必须执行的质量门槛

- 输出固定为可播放的 H.264/AAC MP4，默认 9:16，文件不超过 110 MB。
- 使用实际音频执行唇形驱动；禁止把源视频原样返回。
- 检查双嘴、面部遮罩边缘、身份漂移、静帧、黑帧、音画偏移和音频完整性。
- `lipSyncScore`、`identityScore`、`avOffsetFrames` 等字段必须来自检测程序，不能写固定值。
- 当前本地门槛：官方 SyncNet 置信度 ≥ 3.0、绝对音画偏移 ≤ 3 帧、人脸跟踪率 ≥ 98%、嘴部 P95 单帧跳变 ≤ 0.085、静帧异常为 0；不满足则 `passed=false`。
- 输入、输出和日志按租户任务隔离；临时文件到期删除，不在日志中记录带签名的素材 URL。

## 本地 Worker 依赖

- MuseTalk 1.5 的 Python 环境需安装 `mediapipe==0.10.21`、`soundfile`、`python_speech_features` 和 `scenedetect==0.6.7.1`。
- 按顺序应用 `musetalk-face-box-only.patch`、`musetalk-mediapipe-crop.patch`、`musetalk-torch27.patch`。
- 将官方 `joonson/syncnet_python` 安装到 `/syncnet_python`，执行其 `download_model.sh` 下载 `syncnet_v2.model` 与 S3FD 权重。
- `run-musetalk.ps1` 会在复制结果前执行两道质量门禁，并把逐帧视觉报告和 SyncNet 报告保存在输出视频旁；任一道失败都会使任务失败且不写回素材库。

## 灵枢服务环境变量

```dotenv
DIGITAL_HUMAN_API_URL=https://digital-human-worker.internal
DIGITAL_HUMAN_API_KEY=replace-with-a-long-random-secret
DIGITAL_HUMAN_PROVIDER=musetalk-v1.5-local
DIGITAL_HUMAN_API_TIMEOUT_MS=30000
DIGITAL_HUMAN_OUTPUT_HOSTS=private-output.example.com
```

上线前还必须保证：灵枢服务地址能被 Worker 访问；输出域名加入允许列表；HTTPS、鉴权、限流和 GPU 任务队列已启用；使用一条已授权真人素材完成创建、轮询、质检、回流素材库和取消/重试验收。
