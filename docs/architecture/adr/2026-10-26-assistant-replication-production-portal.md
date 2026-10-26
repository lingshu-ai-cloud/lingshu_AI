# 爆款复刻自动校验与生产门户

日期：2026-10-26。状态：功能分支实现中。

用户确认逐镜方案和审核由系统完成，入队后以对话门户链接原任务详情。

## 决策

复用原任务确认命令，增加服务端限定的系统审核调用；保留参考覆盖、产品身份、真实执行审核、任务版本和哈希约束。系统审核身份不能通过公共请求体注入。启动重试仅认可同操作且任务版本未变化的系统记录。

队列真实接受后在原任务 brief 内存储私有回执，读接口校验队列及运行身份；聊天记录仅存任务指针。队列尚未分配运行 ID 时允许显示已入队门户，之后状态仍从原任务读取。

明确任务深链直接读取该任务，不依赖默认任务详情，也不以最新任务兜底。保持原生产节点、成片验收及发布边界。

## 限制

本轮承接已有周任务。任意新准备任务纳入经营周包须通过真实周授权服务，不能由前端构造周关联。自动修订闭环与真实供应商验证尚未完成。


## 2026-10-26 门户承接页修订

门户统一承接到内容创作的任务表和原任务右侧详情，取代独立执行队列页。发布日历和任务表共用只读聚合投影：明确生产任务 ID 才去重，不以标题或“最新任务”猜测关联。周包计划与手动确认的发布时间分别保留来源，不能通过前端视图构造周执行授权。

任务列表独立返回不可解析的历史记录身份及稳定错误码，展示待确认读取项，保留正常任务；存储读取失败仍失败。封面仅来自当前原任务真实成片归档文件，缺少时回退明确产品照片。该读取能力不创建任务、不生成封面、不启动生产或批准发布。


## 2026-10-26 自动启动接线与入队契约

首页爆款确认复用 `/assistant-actions/create`，新增可选 `initialSource: AddSocialTaskSourceInput`，严格调用现有来源解析器。领域组合依次调用 `createSocialContentTask(entry=assistant)`、`addSocialTaskSource`、`startSocialContentTask`；缓存参考由原来源服务核对租户可见性、URL、分析 ID/哈希与产品身份，不从备注推导可信来源。其他首页创作场景保留原任务/来源写入回执，再调用已有 `/assistant-actions/:taskId/start`，失败后只重试原任务未完成阶段。创建请求幂等键不变，启动键绑定任务 ID 与当前版本。

原启动命令继续负责系统审核、执行可行性、套餐能力、预算、订单额度预留、冻结派发及 outbox；原 `createStarter198OrchestratorQueue → scheduleSocialContentWork → enqueueSocialContentAutoProduction` 承担调度与持久化生产任务。没有新增队列、定时器、执行器或供应商调用旁路。修复原调度器先写运行后、启动命令提前返回时漏存 `_executionQueueReceipt` 的问题；同一 outbox 恢复路径也补存真实返回回执。

启动前失败沿用 `_managedStart.status=blocked` 与任务 `attention`，只在任务详情标为待处理；参考分析待就绪沿用 `queued` 准备意图和原恢复 Worker。已冻结 dispatch 的未知结果保留给原 outbox，不能标记为已失败或再建运行。只读 `executionAdmission` 映射这些现有证据：preparing / blocked / queued。queued 必须校验实际 queueItemId、runId 与任务记录一致。

当前本地客户预览由隔离模块固定 `PROCESS_ROLE=web`，日志显示 `backgroundJobs=false`。本次不改隔离策略，不启动历史草稿，不发起真实付费模型请求；测试中的生产 runner 为替身。源码接线通过不代表本地 Worker 已消费、成片已生成或供应商 Ready。

### 本次接线交接

工作树：`/Users/julia1/Documents/ChatGPT/1026灵小枢对话卡片`；分支 `feature/assistant-home-dialogue-20261026`；HEAD `8c7cc7d304ffd268fcd5f20deeabf68fb5f8b10d`。本次未提交、推送或推进基线；安全检查点为原 HEAD，全部已有未提交工作继续保留，不应整树回滚。没有真实外部 run/task 标识，也没有启动既有本地历史任务。

主要改动文件：

- 后端组合、失败证据和投影：`server/starter198/socialContentAssistantStart.ts`、`socialContentAssistantActionsRouter.ts`、`socialContentRecordProjection.ts`。
- 原调度回执补存：`server/starter198/socialContentTasks.ts`、`socialContentOrderDispatchRecovery.ts`。
- 契约：`shared/contracts/socialContentTaskContract.ts`、`assistantCreationPortal.ts`；现有企业产品绑定结构导出为类型别名，未复制字段或改变其业务含义。
- 前端接线：`src/components/assistant/AssistantReplicationDetails.tsx`、`AssistantReplicationScene.tsx`、`AssistantScenarioPlanner.tsx`；`src/lib/socialContentApi.ts`、`assistantSceneTaskBatch.ts`。
- 状态显示：`src/lib/creationTaskWorkspace.ts`、`creationProductionNodes.ts`。工作区同步出现的可读错误文案改动继续保留。
- 回归：`socialContentAssistantStart.test.ts`、`socialContentAssistantActions.test.ts`、`socialContentAssistantDelivery.integration.test.ts`、`socialContentWorkflow.test.ts`、`assistantSceneTaskBatch.test.ts`、`creationProductionNodes.test.ts`。旧测试期望“证据不完整也确认脚本”已改为要求系统拒绝确认，并断言没有入队。

实际验证（2026-10-26）：

```sh
pnpm exec tsx --test server/starter198/socialContentAssistantStart.test.ts server/starter198/socialContentAssistantActions.test.ts server/starter198/socialContentAssistantDelivery.integration.test.ts server/starter198/socialContentCachedReferenceSource.test.ts server/starter198/socialContentManagedRecovery.test.ts server/starter198/socialContentOrderAdmission.test.ts server/starter198/socialContentWorkflow.test.ts server/starter198/socialReplicationSystemReview.test.ts server/runtime/socialContentOrderOutboxRuntime.test.ts server/starter198/socialContentProductionQueue.scoped.test.ts server/starter198/socialContentExecutionPortal.test.ts src/lib/assistantSceneTaskBatch.test.ts src/lib/creationProductionNodes.test.ts src/lib/creationTaskWorkspace.test.ts
pnpm run lint
ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture
pnpm run build
git diff --check
```

结果：46/46 定向测试通过；TypeScript 通过；架构检查 2859 个生产 TypeScript 文件通过；构建及两项 Studio 预算/边界检查通过，存在既有大 chunk 提醒；diff 检查通过。初次 TypeScript 检查发现同步新增产品绑定模块引用了尚未导出的类型，复用现有绑定契约补导出后复查通过。供应商与真实 Worker 消费未验收，当前预览 `role=web / backgroundJobs=false`；多产品正式逐镜身份映射、正式周包授权仍是独立未决项。

### 2026-10-26 本地阻塞修复检查点（真实制作尚待核验）

用户要求沿用正常产品预算，不再逐条询问。生产预算继续由 `productionBudgetPolicy.ts` 计算；未提高上限、未更改供应商授权规则。

- 新建爆款任务在规划前后保留当前企业产品绑定，将已确认产品 ID 和事实引用传入逐镜 visualContract；不修改已确认脚本，不替代系统审核。
- 首页助手创建任务时复用企业已保存的默认出镜人物。仅在该人物通过现有授权校验、且任务未指定人物或账号身份时使用；不从其他人物中任意选择。
- 精确分析中的初步分类仍输出策略结构，但采用精确分析模型。实际诊断发现该子调用曾落到旧通用模型并收到 HTTP 404 `Model not exist`，现已修正，独立策略分析配置保持原样。
- 前端执行阻塞统一展示中文说明和“待介入”；不将受阻状态标为制作中。

本地修复对象：`socialtask_3a278e52d51feeee578debb9`。参考：`trend_videos_192e76d4b21244c4a2922e60672c95f2`。原始任务和参考记录备份保存在忽略目录 `logs/replication-task-before-product-binding*.json`、`logs/reference-before-exact-repair*.json`，仅用于定向比对恢复，不能覆盖运行中的新状态。

验证：本轮 20 项定向测试和 11 项助手组合/供应商作用域回归通过；`pnpm run lint`、`ARCHITECTURE_BASE_REF=8c7cc7d304ffd268fcd5f20deeabf68fb5f8b10d pnpm run check:architecture`、`git diff --check` 通过。另一次扩展回归中，已有预算测试仍期望显式值 10，而当前统一按时长计算返回 15，该项未通过，不能宣称全部回归通过。

参考重新分析正在执行，尚未取得该内容任务的生产入队回执。本检查点不表示供应商验收或上线就绪。分支及 HEAD 未变，未提交、推送或部署。

后续定位到第二处阻塞：18–24 秒分块的末尾观察区间为 23.766667–24 秒，已有抽帧仅到 23 秒，分析器正确拒绝借用相邻镜头。新增 `referenceWindowFrames.ts` 在模型调用前对缺帧区间从原视频补采实际 PTS 帧；本地原片验证获得 23.8 秒帧，测试验证补帧在原区间内且不会修改调用者帧列表。人物或参考版本变化同时使旧导演计划失效，要求重新规划。原片真实词级转写缓存已有 83 个词，ASR task `022447df-83b0-4f14-aafd-5ccb8a5839df`；这不是内容生产 run。

### 本地真实结果（2026-10-26，本任务未完成生产准入）

- 全片精确分析已完成，analysis run `1e604b58-621f-4751-845f-500ee9894a99`。关键字级 ASR 83 词；开场补检得到 10 个真实时间点和 4 段动作，审核原因清空。模型输入增加逐图源时间标签，输出时间必须匹配输入采样时间，防止图片序号冒充秒数。
- 关键镜头抽帧修正短镜头尾部 seek 越界，保留实际 PTS 并去重；源证据策略升为 `decoded-source-pts-frames-v3-short-shot`。真实检测到的首帧封面闪片保留在分析证据内，生产投影沿用既有排除封面规则；完整分析覆盖证明成立时，保真校验允许这一不足 0.2 秒的已分析前缀，其他缺口继续阻塞。
- 审核必须读取租户内原始 trend 视频记录，不能被素材库中同 ID 的简略副本遮蔽。修正后“缺少分镜/口播/授权”的旧缺口消除；导演方案已就绪，但执行候选仍不足。
- 关键镜头分类请求超时，台账 `data/analysis-output/critical-shots/101194ffda3c78dab353bfd3d27347aebdea9b56199525a3a35771ffab5f8822.json` 为 `uncertain`。没有可供恢复查询的供应商任务回执，未重复提交该未知结果请求。另有工厂/人物动作等镜头未找到满足原要求的可执行素材候选，素材台账存在商用/衍生使用证据缺口，未伪造授权。
- 参考版本已通过原任务更新命令重新关联；原 taskId 和发布时间保留。重新调用真实启动命令仍被系统审核阻止。任务没有生产 run ID、没有成功入队回执；当前详情为“待介入：关键镜头分析请求超时，调用结果待核对”。不得把此检查点描述为“已进入制作”。
- 本地原始任务/参考快照仍在 `logs/`，修改均位于功能分支，HEAD `8c7cc7d304ffd268fcd5f20deeabf68fb5f8b10d` 未变。回退仅按本任务 diff 定向处理，不整树覆盖。

最终代码检查：`pnpm exec tsx --test server/starter198/socialContentReferenceFidelity.test.ts server/starter198/socialContentWorkflow.test.ts server/agents/qwenExactPreliminary.test.ts server/lib/referenceCriticalShotProduction.test.ts server/routes/videoAnalysisCodec.quality.test.ts server/routes/hookMotionEvidence.test.ts src/lib/creationProductionNodes.test.ts` 为 23/23 通过；最终 `pnpm run lint` 通过；架构检查 2862 个生产 TypeScript 文件通过；`git diff --check` 通过。检查过程发现帧数组隐式类型问题，补充明确类型后类型检查通过。前述预算旧断言失败仍单独保留，没有把这一轮定向通过等同于全仓回归通过。页面证据：`logs/replication-current-intervention.png`。
