# 原片分镜时间与画面描述修复（本地）

后续说明：该记录中的客户端末端偏差已由 [实际裁剪片段预览](MINIAPP-PHYSICAL-CLIP-PREVIEW-20261023.md) 修复并重新实测；以下保留当时的检查事实。

日期：2026-10-23。工作树 `/Users/julia1/Documents/ChatGPT/1023灵枢小程序`，分支 `feature/lingshu-miniapp-20261023`，HEAD `f9cff15fcc4552747697b722ba0d418bdf659e72`。本次改动未提交、未推送、未部署。不是黄金环境或发布就绪验收。

## 修复

- `server/routes/videoFrameExtraction.ts`：移除 fps 重采样后按序号虚构时间的方式。所有采样路径使用解码帧整数 PTS 与 time_base，帧数/时钟缺失立即报错。相邻转场候选选择场景变化最强的一帧，避免将过渡起点误作切点。
- `server/routes/videoAnalysisTimelineProjection.ts`：物理拆镜后清除父镜头描述、分类及证据，丢弃跨边界动作；保留源时钟精度。
- `server/routes/videoSplitShotDescriptions.ts`、`server/routes/videos.ts`：Gemini 拆镜后分别解码有界片段、重新识别，不能继承父段描述或邻镜画面；不能确认时显式失败。
- `server/agents/qwen.ts`：每个服务端时间窗口独立请求，只接收该窗口的实际采样帧；独立 ASR 也不跨窗口。规范化/分类修复后重新绑定服务端原始时间，避免两位小数舍入使帧落到邻镜。
- 本次保持现有业务流程与接口；未新增供应商、自动付费重试或部署路径。

## 同一原视频复核

原片 `trend_videos_192e76d4b21244c4a2922e60672c95f2`，33.58 秒，SHA256 `501ec2c4d39ce67630448eff7001e2f911561e962533ca1bdb6aa10e6d2388e9`，与原分析指纹一致。

实际切点（秒）：5.1、5.966667、7.166667、8.633333、10、11、12.566667、14、15.066667、16.066667、17.3、20.766667、22.233333、23.766667、25.3、27.3，共 17 段。

44 张采样帧逐一按返回时间重新解码，比较完整解码像素，44/44 一致。额外检查 16 个切点的前后 32 张源帧。分镜 8 为 12.566667–14 秒实验室横向环绕；分镜 9 才是两名研究人员近景操作；分镜 15 为灌装线；分镜 17 在 27.3 秒后进入人物介绍。边界中的原片转场效果属于原素材，未凭描述强行移除。

审计目录：`tmp/miniapp-binding-acceptance-20261023/boundary-audit/`（忽略的本地文件）：

- `corrected-frame-clock-verification.json`、`corrected-17-shot-review.jpg`：逐帧指纹、时钟和 17 镜头联系表。
- `boundary-pairs.json`、`boundary-pairs-1.jpg`、`boundary-pairs-2.jpg`：切点前后原片画面。
- `recheck-frames.mts`、`recheck-cuts.mts`：可重复离线检查脚本。

## 真实千问调用及本地数据

用户明确授权发送本条原视频采样帧到现有千问视觉服务，并批准总预算 10 元。沿用现有 MaaS endpoint 和 `qwen3-vl-plus`，逐镜 3 张帧，共 17 次 HTTP 200 请求，0 次自动重试。每次发出前持久化请求摘要和费用预留；缺失/未知回执继续占用全额预留。收到可校验的 token 用量后，按同一已核验公开未折扣费率计算占用，累计 **0.590991 元**。这是用量对应的公开费率上界，不冒充供应商结算账单。

唯一执行账本：`visual-recheck-ledger.json`；17 个 responseId、请求摘要与 usage 均已留存。摘要 `provider-validation-summary.json`。原始返回 `reidentified-analysis.json`，没有因不确定项再次付费重试。

千问单镜识别已经排除邻镜内容，但仍有 OCR、运镜和空间判断不准确。例如实验室扫拍被返回为固定机位、实验室台面被判断为门店。逐帧复核后纠正了用于展示的 17 条描述及上述字段；没有将模型自评置信度当作准确性保证。复核稿保留 `needsReview:true`、`confirmed:false`，并标明模型调用与本地原帧复核来源，未冒充用户本人确认。

经现有 `PATCH videos/:id/analysis-corrections` 与版本化 `POST studio/projects` 保存到隔离本地 store，保留 originalGemini。项目 `studio_projects_ddaadba73418433cba3be82124179443` 标题 `[本地重识别复核] 分镜时间与画面对齐`。原账号黄金 store、原来的不完整任务和旧任务快照均未覆盖。网页恢复项目已显示 17 条复核描述。

## 小程序实测

本地服务 8793、网页 5188，使用既有本地测试账号正常 preview-session 登录。服务使用隔离 store 和 loopback，不依赖伪造任务返回；后台的非本次授权供应商请求被阻止。

实际网页创建并持久化：

| 任务 | 镜头 | 绑定时间 | 实测 |
| --- | --- | --- | --- |
| `studio_shooting_tasks_554504e25bbc49f9849894d19df81114` | 实验室环绕，slot-8 | 12.566667–14 | 首页真实卡片→详情→实验室视频→重播→相机，拍摄页带入 1.43 秒及对应要求 |
| `studio_shooting_tasks_bad00de6a4364ff0896cfea9eff5946f` | 灰盒/银袋，slot-2 | 5.1–5.966667 | 正常详情路由加载、实际播放器播放并复位，再次启动播放 |

实验室真实 timeupdate：12.771110、13.036950、13.301669、13.568721、13.834233、13.995193，然后复位 12.566667，playing=false。截图 `native-lab-preview.png`、`native-lab-replay.png`；相机页截图仅保留在忽略的本地目录，未公开。

包装片段真实事件：5.1、5.281864、5.549246、5.812695、5.989159，然后复位 5.1，playing=false。第二次播放已启动。只读事件观察包装器转发原处理函数，不伪造媒体时间或播放器成功。

**预览限制**：现有小程序使用完整源视频加客户端停止计时，包装短镜头测得末端事件晚约 22.5ms，不能据此宣称物理裁剪或逐帧无越界。实验室画面、重播及拍摄入口已实际验证；包装任务的独立相机入口没有重复验收。需要逐帧硬边界时，应复用已有物理分镜媒体能力另行完成预览接入。

微信工具存在两个同名项目窗口。通过完整 projectpath 区分了当前工作树；旧 `mobile-dual-edition-20261012` 的源码和服务配置未修改。独立调试器解决了主窗口坐标无法点击的问题。已恢复当前项目私有配置 `urlCheck:true`；本地 HTTP 后续会再次受合法域名校验限制。

## 验证结果及恢复点

- `node --import tsx --test`：videoFrameExtraction、videoAnalysisTimelineProjection、videos.referenceGrouping、videoSplitShotDescriptions、videoAnalysisCodec.quality、videoAnalysisSuccessPatch、qwenShotIsolation、exactQwenScope，20/20 通过；包括真实红蓝视频、独立片段像素、邻镜隔离及亚秒时间不被舍入回归。
- 小程序回归 119/119 通过，日志 `native-regression.log`。
- `node node_modules/typescript/bin/tsc --noEmit` 通过，日志 `final-typescript.log`。
- `node scripts/check-architecture.mjs` 通过，2455 个生产 TypeScript 文件；未设置 ARCHITECTURE_BASE_REF，跨基线棘轮检查未运行。
- `git diff --check` 通过。

保留本地服务与隔离数据以便继续查看。未执行生产迁移、发布、提交或推送。恢复点为原始视频指纹、originalGemini、独立本地 store 与持久化供应商账本；不要重复执行已完成的付费请求。
