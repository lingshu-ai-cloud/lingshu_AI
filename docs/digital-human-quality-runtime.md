# 数字人成片独立质检运行与放行边界

## 运行拓扑

- 应用生产镜像内置 `person_replacement_visual_qa.py` 及固定的 OpenCV、MediaPipe、NumPy 和 scikit-image 依赖。镜像构建时执行 `--self-check`，运行时 `/api/overseas/ready` 会再执行同一检查。
- Qwen-VL 语义质检与 Seedance 生成分离，仅在人物授权明确包含 `quality_inspection` 时上传采样帧。它检查人物身份、动作序列、产品外形及品牌/文字，不检查口型。
- 口型仅接受独立安装的 official SyncNet 模型报告。应用镜像不捆绑上游模型权重；由独立 Worker 或只读挂载提供 `syncnet_v2.model`、`run_pipeline.py` 和 `run_syncnet.py`。供应商自报分数不作为证据。

## readiness 配置

1. 将 `digital_human_quality` 加入 `REQUIRED_CAPABILITIES`，要求镜像内视觉脚本及依赖真实可执行。
2. 只有当 Qwen-VL 质检和 official SyncNet 均已配置、独立验收过且希望启用自动放行时，才将 `digital_human_auto_release` 加入 `REQUIRED_CAPABILITIES`。
3. 设置 `DIGITAL_HUMAN_SEMANTIC_QA_ENABLED=true`、DashScope 凭据与 `QWEN_DIGITAL_HUMAN_QA_MODEL`。readiness 只能证明配置存在，不会为健康检查产生付费调用。
4. 设置 `DIGITAL_HUMAN_SYNCNET_QA_ENABLED=true`、`DIGITAL_HUMAN_SYNCNET_QA_PYTHON` 和 `DIGITAL_HUMAN_SYNCNET_DIR`。readiness 确认官方 checkpoint 和两个入口脚本存在。

生产 Compose 健康检查使用 `/api/overseas/ready`，不使用只证明进程存活的 `/health`。

## 自动放行条件

一个人物逐句镜头只有在下列七项全部为 `passed` 时才是 `accepted`：

| 检查 | 可自动通过的证据 | 不能证明时 |
| --- | --- | --- |
| 媒体 | 真实文件的画幅、时长、音轨入库检查 | 失败 |
| 人物身份 | 独立视觉模型置信度 `>= 0.85`，引用授权人物帧与候选帧 | 人工审核 |
| 动作 | 本地姿态/时序无异常，且独立语义模型置信度 `>= 0.85` 确认动作序列 | 人工审核 |
| 产品、品牌与文字 | 独立视觉模型置信度 `>= 0.85`，引用原片与候选帧 | 人工审核 |
| 背景 | 人物区域外 SSIM `>= 0.85` | 人工审核 |
| 口型 | official SyncNet 置信度 `>= 7`，绝对偏移 `<= 1` 帧，报告含 checkpoint SHA-256 | 人工审核 |
| 原片复用风险 | 整帧相似度 `< 0.92` 且音频相关度 `< 0.90` | 人工审核 |

任一独立检查明确返回高置信度失败，该镜头进入 `failedCueIds`，只重生失败镜头；其他已验收镜头按对象版本证据复用。检测不可用、置信度不足或源片无可识别文字时，结果为 `manual_review`，不进入自动放行，也不自动消耗一次重生费用。

## 验证命令

```bash
python3 scripts/person_replacement_visual_qa.py --self-check
pnpm exec tsx --test server/lib/sentenceCueQuality.test.ts server/lib/sentenceSemanticQuality.test.ts server/lib/sentenceLipSyncQuality.test.ts server/lib/personReplacementVisualQuality.test.ts
pnpm exec tsx server/runtime/readiness.test.ts
pnpm run test:production
pnpm run test:production-quality
```

Docker 环境可额外执行：

```bash
docker build -t lingshu-quality-local .
docker run --rm lingshu-quality-local python3 /app/scripts/person_replacement_visual_qa.py --self-check
```

## 仍需真实供应商/人工验收的边界

- readiness 不向 Seedance、DashScope 或 SyncNet 发送真实客户素材，所以不能证明供应商当前可用、账号有额度或模型未变更。
- MediaPipe 脸部颜色/纹理相关度只是外观代理，永远不单独证明人物身份或授权。
- 抽帧语义模型不能保证未抽到的瞬间帧无闪烁、手指/牙齿伪影或短暂文字错误；新人物、新品牌、敏感行业与重要活动仍应 100% 人工逐镜审片。
- SyncNet 是音画同步模型，不证明口播文字正确、声音授权、发音自然度或审美可接受性。
- 自动 `accepted` 只是制作质检放行，不是发布授权；发布仍受内容审批、平台账号授权与发布门禁约束。
