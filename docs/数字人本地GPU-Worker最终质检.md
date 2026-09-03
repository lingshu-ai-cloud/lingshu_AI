# 数字人本地 GPU Worker 最终质检

## 执行顺序

1. Worker 先解析形象、配音和全部动作素材 URL。仅本机回环地址允许 HTTP，非本机输入必须 HTTPS 且命中 `DIGITAL_HUMAN_WORKER_INPUT_HOSTS` 白名单。
2. 下载使用手动 redirect 模式，每一跳都重新校验协议、白名单、端口、URL 凭据与 DNS 解析结果；私网、保留地址和云 metadata 地址全部拒绝。
3. 在第一次 GPU 推理前下载完全部 motion clip，用 ffmpeg 确认人物/动作视频可解码、配音有有效音轨，并保存 `input-manifest.json` 的大小与 SHA256。多节拍推理期间不再访问签名 URL。
4. MuseTalk 输出组合并重新编码为 1080x1920 `result.mp4`。中间分段的 sidecar 不能作为最终质检结果。
5. 对真正的 `result.mp4` 重新执行 ffprobe、MediaPipe 视觉门禁、官方 SyncNet 及 ffmpeg `freezedetect`，然后计算输出 SHA256。

## 报告与判定

最终报告保存为 `result.mp4.final-quality.json`，必须包含：

- `outputSha256`、`width`、`height`、`videoCodec`、`audioCodec`、`durationSeconds`；
- `lipSyncScore`、`avOffsetFrames`、`faceDetectionRate`、`mouthJumpP95`；
- 由 ffmpeg 实测的 `freezeSegments`；
- `validatorVersion`、`failures`、`validationStatus`和 `reviewRequired`。

任一必需指标缺失、`NaN`、检测器无法执行或阈值不通过，都不能得到 `passed: true`。`NODE_ENV=production` 及未声明环境始终使用 `strict`，未通过时任务直接失败，不回传成片。`review` 仅在 `development` / `test` 允许，且只会产生 `passed: false` 的待复核结果，不会降级为假通过。

## Worker 生产可靠性

- 生产 Hub URL 必须为 HTTPS；仅 development/test 的 loopback Hub 可使用 HTTP。Worker 监听非 loopback 地址时必须设置 `DIGITAL_HUMAN_API_KEY`。
- 完成、失败和取消通知均写入磁盘 durable outbox。完成结果去重包含远端任务、lease 和 SHA256，因此旧 lease 的 dead-letter 不会吞掉新 lease。
- 上传、finalize 与退避重试期间持续发送心跳。重试次数和 dead-letter 恢复次数均有限，失败交付不会永久阻塞领取新任务。
- 只有 Hub 已确认 `acked` 且超过保留 TTL 后才清理输入、中间文件和输出；成功传回前绝不删除。

关键配置：`DIGITAL_HUMAN_WORKER_INPUT_PORTS=443`、`DIGITAL_HUMAN_WORKER_RESULT_MAX_ATTEMPTS=8`、`DIGITAL_HUMAN_WORKER_DEAD_LETTER_MAX_RECOVERIES=2`、`DIGITAL_HUMAN_WORKER_JOB_RETENTION_MS=86400000`。
