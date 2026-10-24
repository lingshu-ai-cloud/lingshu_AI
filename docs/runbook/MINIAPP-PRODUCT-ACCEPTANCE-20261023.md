# 小程序分镜产品验收

日期：2026-10-23（Asia/Shanghai）。结论：**产品完整验收暂不通过**。抽帧与实际裁剪的已测机械链路通过；新增边界场景复现两项代码缺陷，自动描述准确性也未达到可取消复核的标准。

## 验收对象

工作树 `/Users/julia1/Documents/ChatGPT/1023灵枢小程序`，Git 根目录相同，分支 `feature/lingshu-miniapp-20261023`，HEAD `f9cff15fcc4552747697b722ba0d418bdf659e72`。现有功能源码、测试和文档未提交改动均保留。本轮仅新增验收脚本及本记录，未修改业务代码、提交、推送或部署。

HEAD 是本地开发起点，不冒充 governance 中已集成稳定基线。本次属于本地开发验收，不是黄金环境、生产环境或发布就绪验收。

## 不通过项

### 1. 首镜极短时硬切漏检

- 实际构造 30fps 原片：前 5 帧为红色，后续为蓝色，真实硬切发生于 0.166666667 秒。
- 实际调用 `detectVideoSceneCuts`，结果为 `[]`，遗漏应有切点。
- 原因位置：`server/routes/videoFrameExtraction.ts:25`，`strongestSceneCuts` 一律过滤 `time <= 0.2` 的候选，实际画面差异强弱无法改变这个结果。
- 影响：前 0.2 秒内真实存在的独立镜头可能被并入下一镜，后续单镜识别和预览再精确，也无法恢复已遗漏的分镜边界。
- 复现：`tmp/miniapp-product-acceptance-20261023/fast-opening.mts`；证据 `fast-opening-result.json`、`fast-opening.mp4`。
- 关闭标准：对实际存在且拥有解码帧的短开场镜头保留边界；与闪白、渐变转场的去重规则分别验收，不能只移除阈值后以当前样例通过代替通用验证。

### 2. 无关短镜头阻断正常待拍任务预览

- 实际构造 2 秒、60fps 原片及三个分镜：0–0.5 秒、0.5–0.683333 秒、0.683333–2 秒。
- 请求的是第三段正常时长任务，而非中间 0.183333 秒短插镜；调用真实预览服务返回 `reference_shot_timecode_invalid`，未返回裁剪片段。
- 原因位置：`server/lib/referenceExactShotMaterialization.ts:27` 对整条分析的每个分镜要求至少 0.2 秒；`server/routes/shootingReferencePreview.ts` 为单个任务调用整片物化流程。任意一镜不满足条件就阻断其他正常镜头。
- 检测器却会保留相距 0.183333 秒的内部切点：`strongestSceneCuts([{time:0.5,score:0.9},{time:0.683333,score:0.9}])` 实际返回两个切点，说明检测和物化的最短镜头规则不一致。
- 影响：快节奏产品混剪中存在短插镜时，可用的正常待拍分镜也可能完全无法预览。
- 复现：`tmp/miniapp-product-acceptance-20261023/matrix.mts`；证据 `matrix-results.json` 的 `unrelated-183ms-shot`。
- 关闭标准：统一检测与可裁剪区间规则；合法正常分镜的预览不能被无关短镜头阻断，必须以真实媒体和任务接口复验。

### 3. 自动描述准确性仍需复核

本轮没有重新发起付费调用，而是复核前次真实千问回执及源画面记录：

- 分镜 8：原片为实验室横向环绕扫拍，模型 `camera` 返回“固定机位”，`needsReview:false`。
- 分镜 11：原片为实验室台面及玻璃隔断，模型 `environment` 返回“现代美妆集合店室内，玻璃隔断+弧形墙+吊灯”，同样 `needsReview:false`。
- 当前显示稿已通过源帧复核纠正上述字段，保留 `needsReview:true`、`confirmed:false`。这些纠正证明本条展示稿经过复核，不能证明自动识别产品质量已经达到同等准确性。
- 证据：前次审计目录 `tmp/miniapp-binding-acceptance-20261023/boundary-audit/reidentified-analysis.json` 和 `qwen-and-frame-reviewed-descriptions.json`。
- 关闭标准：建立多种真实视频的独立画面与运镜标注，分别评价切点、画面描述、场景和运镜；模型自报 `needsReview:false` 不能替代验收。当前本地只有一条独立原视频，17 个派生片段不计为 17 条独立真实样本。

## 本轮通过的验证

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| 24fps 无声横屏 | 通过 | 独立解码源 PTS 与裁剪帧序列比对 |
| 25fps 带音频竖屏 | 通过 | 同上 |
| 29.97fps 无声方屏 | 通过 | 同上，分数帧率标签一致 |
| 30fps 带音频方屏 | 通过 | 同上 |
| 60fps 无声竖屏 | 通过 | 同上 |
| 可变帧率带音频横屏 | 通过 | 选择性丢帧构造 VFR，按原帧时钟而非帧号比对 |
| Gemini 重新识别的独立片段裁剪 | 通过 | 1.033333–2.066667 秒窗口的 31 帧均为蓝色，不混入相邻红/绿画面；回调仅检查媒体，不调用模型 |
| 本条真实原视频 17 片段 | 通过 | 本轮重新解码全部 1007 帧，独立源 PTS 区间和片段帧数全部对应；文件 SHA256 一致，16×16 RGB 最大单帧平均有损误差 0.878/255 |
| 服务端现有定向回归 | 24/24 通过 | 不能覆盖上述新增失败边界 |
| 小程序与原生包回归 | 121/121 通过 | 包含自然结束、重播、失败处理、拍摄入口的自动化回归 |
| TypeScript、架构扫描、diff 检查 | 通过 | 跨基线架构棘轮未运行，未做生产构建和生产迁移验收 |

新增媒体场景共 9 组：7 组通过、2 组失败。原视频复验另计，不能用 145 项既有回归通过抵消新增失败。

原视频 SHA256：`501ec2c4d39ce67630448eff7001e2f911561e962533ca1bdb6aa10e6d2388e9`。

本轮证据均位于 `tmp/miniapp-product-acceptance-20261023/`：`matrix.mts`、`matrix-results.json`、`fast-opening.mts`、`fast-opening-result.json`、`gemini-window.mts`、`gemini-window-result.json`、`recheck-original.mts`、`original-results.json`、`server-regression.log`、`native-regression.log`、`typescript.log`。

实际执行：

- `node --import tsx tmp/miniapp-product-acceptance-20261023/matrix.mts`
- `node --import tsx tmp/miniapp-product-acceptance-20261023/fast-opening.mts`
- `node --import tsx tmp/miniapp-product-acceptance-20261023/gemini-window.mts`
- `node --import tsx tmp/miniapp-product-acceptance-20261023/recheck-original.mts`
- `node --import tsx --test`：videoFrameExtraction、videoAnalysisTimelineProjection、videos.referenceGrouping、videoSplitShotDescriptions、videoAnalysisCodec.quality、videoAnalysisSuccessPatch、qwenShotIsolation、exactQwenScope、shootingReferencePreview、shootingTasks、referenceExactShotMaterialization、routes/referenceExactShotMaterialization，24 项。
- `node --test apps/shooting-miniapp/*.test.cjs scripts/mobile-shared-package.test.mjs`，121 项。
- `node node_modules/typescript/bin/tsc --noEmit`、`node scripts/check-architecture.mjs`、`git diff --check`。

## 验收边界与下一步

前次模拟器实际两次播放、复位及进入拍摄的证据见 [物理片段预览验收](MINIAPP-PHYSICAL-CLIP-PREVIEW-20261023.md)。本轮没有再次操作模拟器或真机，不将自动化回归写成新的 UI 实测。未改变网络放行设置，没有新的外部模型调用或费用，没有生产数据写入。

先修复上述两项可复现的短镜头缺陷并固化回归，再扩大独立真实视频的描述准确性验收。修复前，不将当前结果认定为“产品完善、不会再出现类似问题”。安全恢复点仍为原始视频、独立本地 store、前次供应商账本和当前未提交源码；本轮验收未改动这些业务事实。
