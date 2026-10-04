# AIGC 分镜逐镜验收矩阵

本目录对应产品方案第 7 节。`matrix.json` 定义十个需要验证的镜头：三类场景各覆盖爆款复刻与自由创作，并覆盖桌面、手持、产线、设备、工人、单步与连续操作，以及多产品镜头。

美妆数据包中的图片和片段只作为**输入参考**。其中公开来源视频与图片的权限状态须沿用原数据记录；有文件不代表有商用生成授权，也不代表该镜头已完成精确分镜分析。矩阵不包含任何模型生成结果或人工评分。`product-clone-tabletop` 使用参考视频 5 中约 2–4 秒的桌面产品画面；`usage-clone-single-step` 使用参考视频 1 中约 20–21 秒的单步上脸画面。两段时间仅用于寻找素材，须逐帧复核物理镜头边界、动作和目标产品适配后才能填写 `sourceShot`；视频 1 的棉片使用动作不能直接套用于喷雾产品。

在仓库根目录运行本地预检：

```bash
pnpm exec tsx scripts/storyboard-aigc-acceptance.ts --out /tmp/storyboard-aigc-acceptance-report.json
```

退出码 `2` 表示证据不完整，不是工具故障。输出报告中 `inputAssetsPresent` 只证明输入文件及其数据包 SHA-256 一致；`complete` 需要精确分镜 ID／原片首帧、生成首帧、视频候选、QA 报告、人工评分及费用记录齐备。空样本指标返回 `null`。

真实验收时，把证据清单保存为一个 JSON 文件并运行：

```bash
pnpm exec tsx scripts/storyboard-aigc-acceptance.ts --evidence /absolute/path/to/evidence.json --out /absolute/path/to/report.json
```

`evidence.json` 的 `schemaVersion` 为 `1`，`cases` 中按 `matrix.json` 的 `id` 填写：

```json
{
  "schemaVersion": 1,
  "cases": [
    {
      "caseId": "product-clone-tabletop",
      "shotId": "项目中的稳定分镜 ID",
      "sourceShot": {
        "id": "原片精确分镜 ID",
        "startSeconds": 0,
        "endSeconds": 4,
        "firstFramePath": "相对 evidence.json 的原片首帧图片路径",
        "sha256": "该图片的 64 位 SHA-256"
      },
      "firstFrames": [],
      "videos": []
    }
  ]
}
```

每个 `firstFrames`、`videos` 候选需记录相对于 `evidence.json` 的 `artifactPath`、`sha256`、`qaReportPath`，以及 `createdAt`、`latencyMs`、`estimatedCostCny`、可得时的 `actualCostCny`、人工 `humanReview`。人工复核记录包含 `reviewer`、`reviewedAt`、`decision`、1–5 分的 `scores` 和 `failureReasons`；被分镜采用的视频标记 `adopted: true`。QA 报告须是 `storyboard-aigc-qa-v1`，且人工接受的候选须已通过 QA。镜头证据不足时不计入成功率分母。

测试：

```bash
pnpm exec tsx scripts/storyboard-aigc-acceptance.test.ts
```
