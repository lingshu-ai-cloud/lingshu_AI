# 本地 Qwen3-TTS 中英西三语部署与许可

更新日期：2026-09-03

## 结论

本机已跑通 `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` 的完全本地推理，并接入工作台既有 TTS 路由作为显式启用的 fallback。中、英、西三语统一使用 Ryan 男声；工作台的 `v2 / James` 通过配置映射到 Ryan。模型未启用、文件缺失、GPU 忙、运行超时或音频校验失败时，接口明确失败，不生成占位 WAV，也不把估算时长伪装成真实时长。

当前实现适用于 Node 后端与 Windows GPU/WSL 位于同一台机器的本地版。未来把 Web 后端部署到服务器而 GPU 留在客户本机时，服务器不能直接使用这里的 `D:` 或 `/mnt/d` 路径；应把同一个 runner 接入受认证的本地 Pull Worker/任务队列。此文档不代表该远程调度链路已经完成。

## 许可与来源

- 官方代码：<https://github.com/QwenLM/Qwen3-TTS>
- 官方模型：<https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice>
- Python 包：`qwen-tts==0.1.1`
- 固定模型 revision：`85e237c12c027371202489a0ec509ded67b5e4b5`
- 代码包和模型卡均声明 Apache License 2.0；当前 wheel 内也包含完整 Apache-2.0 `LICENSE`。

Apache-2.0 允许商业使用、修改和分发，但上线发行物仍须保留许可证和版权/NOTICE 要求。声音输出还需遵守业务素材授权、广告合规、隐私和当地关于合成媒体标识的法律；不得据此推导为真人代言或未获得的个人授权。

本方案没有使用许可标记为 `Unknown` 的 Piper `zh_CN-huayan` 模型。以后如启用 Piper，每个声学模型都必须单独完成许可核验，不能只依据 Piper 引擎本身的许可证。

## 本机落盘与资源

| 项目 | 路径 | 当前体积 |
| --- | --- | ---: |
| 独立 Python venv | `D:\LINGSHU_models\qwen3-tts\.venv` | 283 MB（含声学验收用 Praat） |
| 模型与 speech tokenizer | `D:\LINGSHU_models\Qwen3-TTS-12Hz-0.6B-CustomVoice` | 2.4 GB |
| 离线安装包 | `D:\LINGSHU_models\qwen3-tts\wheelhouse` | 176 KB |
| 共享 CUDA Torch 运行层（只读） | `/root/digital-human-lab/repos/MuseTalk/.venv/lib/python3.10/site-packages` | 既有 7.9 GB，不重复占盘 |

独立 venv 的 `site-packages` 始终优先。开发机为节省空间，只在进程内把 MuseTalk venv 的 Torch/CUDA 依赖追加为只读搜索路径；安装、升级和卸载都不会写入 MuseTalk venv。正式部署建议在 TTS venv 内独立安装兼容的 Torch 与 torchaudio，随后删除 `LOCAL_QWEN3_TTS_SHARED_SITE_PACKAGES`，实现物理上的完全隔离。

当前实测组合：Python 3.10.12、Torch 2.7.1+cu128、torchaudio 2.7.1+cu128、Transformers 4.57.3、Accelerate 1.12.0、RTX 5060 8 GB。推理使用 `bfloat16 + SDPA`，无需 flash-attn；缺少系统 `sox` 只会产生上游包的提示，本 runner 的时长处理使用 `/usr/bin/ffmpeg`。

## 配置

将以下内容写入本机仓库的 `.env.local`，再重启后端。项目会在加载时用 `.env.local` 覆盖同名进程变量，因此只在临时 PowerShell 会话中设置同名变量并不可靠。

```dotenv
LOCAL_QWEN3_TTS_ENABLED=true
LOCAL_QWEN3_TTS_WSL_DISTRO=Ubuntu-22.04
LOCAL_QWEN3_TTS_PYTHON=/mnt/d/LINGSHU_models/qwen3-tts/.venv/bin/python
LOCAL_QWEN3_TTS_SCRIPT=D:\LINGSHU_逐分镜数字人开发\scripts\qwen3-tts-local.py
LOCAL_QWEN3_TTS_MODEL_DIR=/mnt/d/LINGSHU_models/Qwen3-TTS-12Hz-0.6B-CustomVoice
LOCAL_QWEN3_TTS_SPEAKER=Ryan
LOCAL_QWEN3_TTS_SPEAKER_V2=Ryan
LOCAL_QWEN3_TTS_DEVICE=cuda:0
LOCAL_QWEN3_TTS_DTYPE=bfloat16
LOCAL_QWEN3_TTS_ATTENTION=sdpa
LOCAL_QWEN3_TTS_FFMPEG=/usr/bin/ffmpeg
LOCAL_QWEN3_TTS_LOUDNESS_LUFS=-18
LOCAL_QWEN3_TTS_TRUE_PEAK_DB=-1.5
LOCAL_QWEN3_TTS_LOUDNESS_RANGE=7
LOCAL_QWEN3_TTS_PITCH_SEMITONES_ZH=0
LOCAL_QWEN3_TTS_PITCH_SEMITONES_EN=0
LOCAL_QWEN3_TTS_PITCH_SEMITONES_ES=-3
LOCAL_QWEN3_TTS_TIMEOUT_MS=180000
LOCAL_QWEN3_TTS_MIN_FREE_VRAM_MB=4300
LOCAL_QWEN3_TTS_LOCK_FILE=/mnt/d/LINGSHU_models/qwen3-tts/inference.lock
LOCAL_QWEN3_TTS_LOCK_TIMEOUT_SECONDS=3
LOCAL_QWEN3_TTS_SHARED_SITE_PACKAGES=/root/digital-human-lab/repos/MuseTalk/.venv/lib/python3.10/site-packages
LOCAL_QWEN3_TTS_ALLOW_CPU_FALLBACK=false
```

`LOCAL_QWEN3_TTS_ENABLED` 默认关闭，必须显式设为 `true`。8 GB 显存机器默认要求推理前至少有 4300 MB 空闲显存，并通过 D 盘文件锁强制单任务串行；MuseTalk 正在推理时会返回 `GPU_BUSY`，而不是争抢显存。CPU fallback 只在明确配置为 `true` 且捕获到 CUDA OOM 时尝试，默认关闭，避免一次请求长时间占满内存。

Windows PowerShell 启动后端示例：

```powershell
Set-Location 'D:\LINGSHU_逐分镜数字人开发'
$env:NODE_USE_ENV_PROXY = '1'
.\node_modules\.bin\tsx.cmd watch --exclude data server\index.ts
```

## API 合同

以下路由继承工作台鉴权，调用时需要有效 Bearer token：

- `GET /api/overseas/studio/tts/capabilities`：静态配置与本机文件能力；启用成功时 `localQwen.enabled/configured/available` 都为 `true`，并返回模型、许可、语言、音色、设备和隔离方式。
- `GET /api/overseas/studio/tts/local-qwen/health`：实际启动 WSL Python，验证依赖导入、完整模型文件和 CUDA；健康返回 200，不健康返回 503。
- `POST /api/overseas/studio/tts`：单段生成。
- `POST /api/overseas/studio/tts/batch`：中英西多段按顺序生成。现有路由先尝试配置的在线服务，失败/未配置时进入本地 Qwen fallback。

本地 runner 强制返回 24 kHz、单声道、PCM16 WAV，并重新读取真实帧数计算 duration。时长处理后执行两遍 EBU R128 `loudnorm`，默认目标为 -18 LUFS、LRA 7、True Peak -1.5 dBTP；第一遍测量，第二遍把实测参数固定写回，因此同一输入处理可复现。归一化结果超出 1 LU 或 True Peak 超限会直接失败。接口还会再次读取 WAV 头核对时长；文件不存在、少于 4 KB、短于 0.2 秒、非有限采样、静音、样本峰值超过 0.95、归一化改变时长或时长声明不一致都会失败并清理文件。

Ryan 的首轮三语样片经 Praat 自相关与互相关两种基频算法复核：中文/英文基频中位数约 139 Hz，西语约 184–189 Hz，西语确实高约 5.3 个半音，并非只有 pYIN 的八度误判。当前仅对 Ryan 西语做保守的 -3 半音校准，使用 FFmpeg Rubber Band 的 `formant=preserved` 与高质量模式，不改变目标时长；中文、英文不移调。此参数与 Ryan 绑定，替换 speaker 后必须重新做三语测量并把三个值恢复为 0，不能继承旧校准。

目标时长先根据真实音频计算 tempo，只允许 `0.75–1.35x` 的安全范围；超过该范围不会谎称达到目标，`targetDurationSatisfied=false`。工作台可据此改写过长文案或调整剪辑时长，而不是把声音过度拉伸成机械音。

## 实测结果

2026-09-03 在 RTX 5060 8 GB 上，先以真实鉴权中间件和真实 `POST /studio/tts/batch` 路由确认三语 `source=qwen3_tts_local` 全部成功；随后使用相同 helper/runner 参数完成 EBU R128 和 Ryan 西语音高校准回归。三语统一 `voice=v2 -> Ryan`，目标时长均为 4.5 秒：

| 语言 | 最终文件 | 实测时长 | 独立复测 LUFS / dBTP | RMS dB | Praat AC / CC 中位基频 |
| --- | --- | ---: | ---: | ---: | ---: |
| 中文 | `D:\LINGSHU_models\qwen3-tts\smoke\final-zh-ryan.wav` | 4.517 s | -18.01 / -2.12 | -19.01 | 138.9 / 138.7 Hz |
| 英文 | `D:\LINGSHU_models\qwen3-tts\smoke\final-en-ryan.wav` | 4.514 s | -17.94 / -1.99 | -18.89 | 138.0 / 139.6 Hz |
| 西语 | `D:\LINGSHU_models\qwen3-tts\smoke\final-es-ryan.wav` | 4.458 s | -18.01 / -1.93 | -18.54 | 164.6 / 159.2 Hz |

三条均为 24 kHz、mono、PCM16。最终 RMS 差为 0.47 dB；西语相对中英 Praat 参考值偏差为 AC +3.00 半音、CC +2.33 半音，不超过 3 半音门禁。pYIN 对这些短句只保留了较少高置信帧且仍偏向高音区，因此报告它但不单独用于身份门禁；Praat 两种独立算法的有效有声帧均超过 200，更适合作为本轮判断依据。

健康检查同时确认：`runtimeImportable=true`、模型文件无缺失、CUDA 可用、空闲显存 7019/8151 MB。一次中文直出实测模型载入约 11.7 秒、生成约 5.7 秒、总耗时约 17.5 秒，Torch 峰值分配约 2186 MB；HTTP 批量链路目前每段都会重新载入模型，因此首版吞吐量低于常驻 Worker。

重复验收命令：

```powershell
npm run test:local-qwen-tts
npm run lint
npm run smoke:local-qwen-tts
```

`smoke:local-qwen-tts` 是显式重型集成测试，运行前需提供上述 `LOCAL_QWEN3_TTS_*` 环境变量；它会启动随机端口的隔离 Express 服务，调用能力、健康和真实三语批量 API，并对每个 WAV 的 RIFF/PCM、采样率、声道、真实时长、峰值和 RMS 进行断言。

## 上线前风险与下一步

1. Ryan 是官方的英语母语男声。模型明确支持中文和西语，同一音色已能生成三语，但中文与西语口音自然度仍应由对应母语审核员试听通过后再作为商业默认音色。若三语都要求近母语，可改成“同一人物、不同授权母语音色”，不要用音色一致性掩盖口音问题。
2. 0.6B 模型满足 8 GB 显存与本地 fallback。当前 `qwen-tts==0.1.1` 的实现对 0.6B CustomVoice 会忽略 `instruct`，因此本版不承诺细粒度情绪提示；语气主要由文本标点、措辞、固定音色和有限速度控制。需要更强表演力时再评估 1.7B，但应先做显存和延迟压测。
3. 当前每个请求冷加载约 10–12 秒。上线应把模型常驻在独立 TTS Worker 中，用单消费者队列串行推理，并保留相同的显存预检、锁、超时、任务取消和 WAV 双重校验。
4. 服务器/本地 GPU 分离时，不得把 WSL 或本地推理端口直接暴露到公网。应复用带专用密钥、租户隔离、任务租约、心跳、结果哈希和限流的 Pull Worker 模式；传输的输入输出均需 HTTPS 或对象存储短时签名 URL。
5. 当前开发机通过只读共享 Torch 降低 D 盘占用。生产镜像必须使用独立锁定依赖、保存 Apache-2.0 许可证副本，并在部署前做离线启动测试，确保模型缺失时返回 503 而不是在线下载。
