# 单条内容任务接入真实执行队列

> 最新：用户已同意六个辅助镜头使用AI示意。原任务已更新到版本8，37/37有候选且规划审核通过；预算估算45.45元，原预算19元未变，尚无run/job。详情见文末“用户确认AI场景后”。


本次检查：2026-10-25（Asia/Shanghai）。工作树 `/Users/julia1/Documents/ChatGPT/1025新建1条内容`，分支 `feature/content-creation-20261025`，HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`，工作区含本会话未提交修改。本次没有推进共享集成基线，不以预览运行状态代替源码或供应商验收。

## 本次实际接入结果

以下为首次接入时的诊断快照；后续根因与修正见文末。来源条目数量不等同于素材候选数量，现有执行器会直接读取企业素材库。

- 目标为原任务 `socialtask_b56302033c31e2ca5d08ee38`（云朵泡沫卸妆蜜 · 99），英语、TikTok、9:16、38 秒，已有单片预算上限 19 元。
- 已通过现有认证会话调用 `POST /api/overseas/starter-198/social-content/tasks/:taskId/start`，携带原版本及稳定幂等键 `connect-real-queue-20261025-b56302033c31`。
- 返回 HTTP 409，错误 `social_content_execution_director_review_required`。原任务重算至版本 7，仍为 `plan_review`，`runId=null`；没有成功入队，不得显示为制作中。
- 参考分析为 ready；首次检查时导演审核 37 个分镜均无可执行推荐候选，汇总原因 `capability_mismatch`。虽无显式 material 来源，原执行器仍会读完整企业库存；不能仅凭来源为空归因于缺素材衔接。
- `GET /api/overseas/ready` 返回 503/degraded，角色 web。问题包括 `pocketbase_unavailable_or_unmigrated:isolated_test_network_blocked`、`social_operating_worker_unready:heartbeat:version_mismatch`。前者是当前本地隔离运行设置造成的正式存储检查失败，不能据此认定实际数据库缺迁移，也不能擅自迁移。
- 人物/生成能力的配置项 ready 不证明允许真实生成、配额足够或供应商端到端成功。当前预览仍只允许真实 HeyGen GET；数字人视觉质检报 `visual_qa_python_missing`，自动交付报 `automatic_release_requires_visual_and_semantic_qa`，素材清理工具未配置。仅按实际路线要求处理，不能将所有可选能力一概设为必需。
- 本机脱敏证据：`tmp/content-preview/real-queue-admission-check.json`。没有调用付费生成、开启全局消费者、创建重复任务、部署或修改数据存储边界。

## 复用链路与输入输出

| 阶段 | 现有实现 | 输入 | 输出与成功依据 |
| --- | --- | --- | --- |
| 确认并保存 | singleContentCreationRouter / socialContentTasks | 产品、目标、语种、参考、人物、交付目标、企业偏好 | 原 taskId、版本、来源；本地预览仅保存 |
| 启动准入 | startSocialContentTask | 原 taskId、expectedVersion、幂等键、认证租户 | 重算来源、参考与导演审核；拒绝必须返回原错误，不能假入队 |
| 派发 | createStarter198OrchestratorQueue → scheduleSocialContentWork | 冻结 subject/source/package、commandId | workflow run、冻结派发回执，绑定原任务 |
| 持久入队 | enqueueSocialContentAutoProduction | 同一 store 的 taskId/runId、执行计划 | content_execution_jobs 中唯一 durable job 及 checkpoint |
| 消费执行 | DurableContentExecutionWorker / socialContentProductionQueue | durable job、租约、并发额度、运行上下文 | 可检索阶段、供应商回执、退避/阻塞/对账状态 |
| 制作 | socialContentProductionExecution / ProductionAdmission | 已审核执行方案、产品素材身份、人物音色、预算 | 实际镜头/音轨/渲染产物，沿用既有制作与渲染器 |
| 质检交付 | 原 graph/completion/artifact 服务 | 真实文件、技术与内容检查、必要审核 | artifact、质检结果、验收或交付状态；不得把文件存在当成正式交付 |

数据库 durable job 是执行事实；BullMQ/Redis 负责唤醒，Redis 故障后原数据库扫描仍可恢复。开发环境已有 local 后端，不需要为本地接通新建队列。正式 production 环境已有强制 BullMQ 的政策，本次不更改。

## 待补与接通顺序

1. **先补原任务的执行方案。** 使用既有 source-options/素材路由和人物能力注册，绑定当前产品的有效资产与版本，核实逐镜候选和实际能力。不能以任意库存填满 37 个分镜，也不能强制批准导演审核。目标“99”已原样保存，需在真正生成前确认它是否表达了预期内容，不能代用户改写。
2. **核对实际路线与成本。** 公共授权人物不需重复人物授权，但仍要核验既有 avatarId/voiceId、对象存储、生成开关、供应商配额及报价。19 元是已保存的任务预算上限，不是供应商成本测量或可随意提高的金额。
3. **准备独立执行实例。** 复用原 web/worker 分工，同一代码版本、同一明确 store 和媒体根目录，先修正心跳/数据权威检查。本地预览隔离模块会强制 web；不能只改 PROCESS_ROLE=all，更不能关闭隔离后扫描历史队列。
4. **原任务重新准入。** 读取最新版本，以新的、稳定的启动命令调用原 start；若前一命令已有不确定回执先查询，不盲目重提。只有拿到真实 runId 和 content_execution_jobs 记录才算入队。
5. **只消费该 job。** 已有 `createScopedSocialContentProductionWorker([jobId], store)` 可复用，无须新消费者或全局后台任务。此前只读 HeyGen 许可不包含真实生成；在具备本次实际路线和预算授权后再启动供应商调用。
6. **验证并回传。** 逐步记录供应商 requestId、job 状态、镜头/音轨路径、渲染文件、质检与交付回执；未知结果先对账，沿用原重试与恢复。预计交付时间仍是目标，不能提前保证到点拿片。

真实 E2E 仍按 [外部准入手册](EXTERNAL-E2E-READINESS.md) 使用已合并冻结的代码验收。当前未提交功能修改不能宣称稳定基线真实 E2E 通过。

## 本次验证与恢复点

- `node --import tsx --test server/contentExecution/durableQueue.test.ts server/starter198/socialContentProductionQueue.scoped.test.ts server/starter198/socialContentManagedRecovery.test.ts`：39/39 通过，0 跳过；使用测试 store，不代表当前业务任务已生产。日志 `tmp/content-preview/real-queue-foundation-tests.log`。
- `git diff --check`：通过。本次仅新增本手册，无生产源码改动，未重复类型检查/构建；此前验证不冒充本次执行。
- 原任务、来源、人物和既有任务未删除。新的恢复参照为原任务版本 7、runId 空；本次准入操作记录保留。若后续任务版本再变化，以 API 实读为准，不覆盖回版本 7。
- 仍未完成：原任务真实入队、真实消费者启动、真实供应商生成、成片及正式交付验收。

## 手动与自动差异复核、门槛修正

用户指出手动素材匹配顺利、自动门槛过高后，复查同租户原任务与库存，确认：

1. 旧成功任务采用 `type-aware.v1`，部分已冻结产品 I2V 路线；新任务采用现有默认 `type-aware.v2`。不能简单复制旧任务审核结果，也不能把新路径的额外元数据要求解释为用户所有素材都没有授权。
2. 库存有 11 条视频明确记录 `commercialUseApproved/derivativesApproved/rawLibraryUseApproved/mayUseInProduction=true`。其旧分析有真实镜头与范围，但 `boundaryConfidence=0/cleanEntry=false/cleanExit=false`。原 profile 将这种缺少精修剪辑点的情况硬拦，导致已授权片段全部无法进入自动召回。
3. 产品主图同时有 `product:GUIANFA-RS-001` 和中文产品名；原产品图筛选要求所有别名等于一个显示名，错误排除了与任务同 SKU 的真实主图，随后连产品生成候选也无法形成。

修正继续复用原素材召回、SKU 绑定、供给计划和预算规划器：

- SKU 与已确认显示名视为同一产品的合法别名，显式 OTHER SKU、其他租户、未哈希或合成参考图继续拒绝。
- 缺精修剪辑点降为 `editingWarnings`，保留 `cleanEntry/cleanExit=false`，不伪造已核验；使用原已观察时间范围裁切，后续渲染与质检继续核验。授权、版本、真实时间区间、明确需人工复核等原检查仍保留。
- GET `tasks/:taskId/queue-inspection` 只读输出原任务审核、分镜候选与当前 run 对应的持久 job；已有 run 不提供新原始启动。页面“检查并启动”调用原 `startTask`，不另建派发主流程。
- 未选用候选的拒绝原因放入折叠诊断，不作为要求用户清理整个素材库的待办；必须处理的是当前方案缺口。
- 显式更小预算在解析、默认 brief 和周上下文转换中保留，不能被按时长计算的默认上限扩大。同步旧 3 秒禁止断言为用户已要求的无产品时长门槛；0 或非有限时长仍无效。

只读实测同一原任务版本 7：修正前 0/37 个镜头形成候选，修正后 19/37（16 个产品生成候选、3 个本地工厂片段）。尚有 5 个数字人镜头等待生成运行环境、13 个本地路线镜头没有匹配候选。生成候选不等于通过整片真实报价、已付费或成片；`runId=null`，仍未入队。没有改写素材授权、改产品、补造工厂/消费者证据或开启全局消费者。

验证：素材/产品身份/编导/只读检查专项 64/64；队列/预算/恢复/原启动/API 回归最终 60/60（组间有重叠）。首次回归暴露两条过时/不一致断言（旧时长门槛、显式预算扩大），保留失败日志，并修复较小预算不能被扩大这一实际问题后重跑。TypeScript、架构、构建通过，保留已有 chunk 大小提示；完整 quality/verify、真实供应商 E2E 未运行。

本机证据均位于 `tmp/content-preview/`：`material-threshold-final-tests.log`、`queue-material-final-regression-rerun.log`、`queue-material-threshold-live.json`、首次回归的 `queue-material-final-regression.log`。最终只读结果另存 `queue-handoff-final-inspection.json`。


## 2026-10-25：按实际画面用途匹配与源区间贯通

本轮继续使用 HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd` 上的未提交功能修改，没有推进集成基线。

- 包装设计、门店选购、商务洽谈按企业场景匹配，不再当作产品使用演示强求同 SKU；真正的持有、使用、效果展示仍保留产品身份要求。正向当前画面优先，负面提示和相邻镜头不参与用途判定。
- 真实工厂片段允许同时存在工人、机器、环境和产品的标注；仍核对当前生产动作，装箱不能代替灌装，口播人物不能冒充工厂镜头。手持产品的参考镜头不再因旧标签误入工厂路线。
- 同源文件允许分配多个互不重叠的已分析区间；不同分析 segment ID 也不能重复消耗同一源区间。区间随原候选、执行选择、已有 customer asset adapter、production plan 和 render timeline 逐段传递。执行资产采用窗口派生 ID，原素材、哈希和来源不改；越界、无效或不足镜头时长的区间继续拒绝。
- CONTACT ME 收尾图形走已有 system_safe_motion_graphics.v1 模板路线，包括历史叙事标签为 value 的真实联系卡片。只生成本任务 CTA，不借用参考人物头像、联系方式，不将产品功效画面转成卡片。
- 原任务 `socialtask_b56302033c31e2ca5d08ee38` 版本7只读检查由上一阶段19/37增加至26/37：17个产品生成候选、8个本地工厂片段、1个收尾模板。候选数量不代表最终报价、生产审核或成片验收通过。
- 仍缺6个设计/选购/洽谈画面（26、27、31、32、33、34），当前库无对应的已授权、已分析可用视频；另5个数字人镜头（1、2、30、35、36）生成运行能力未就绪。未用无授权图库补齐，未将静态图片适配器冒充动态场景制作。
- 原任务仍 `runId=null`、`job=null`、预览隔离开启。未启动付费生成、全局消费者、迁移或部署；不保证已保存的预计交付目标。

验证实际命令（node 指向本机缓存运行时，未安装依赖）：

1. `node --import ./scripts/customer-isolated-test-guard.mjs --import tsx --test server/starter198/socialContentPurposeMatching.test.ts server/starter198/socialContentSelectedWindow.test.ts server/starter198/socialContentMaterialRoutingRequests.test.ts shared/socialContentAssetSupplyTypeRouting.test.ts shared/contracts/localMaterialSegmentProfile.test.ts`：46/46通过。
2. `node --import ./scripts/production-budget-offline-guard.mjs --import tsx --test server/starter198/socialContentAssetSupplyExecution.test.ts server/starter198/socialContentProductionPlan.test.ts server/starter198/socialContentAgentWorkflow.test.ts server/starter198/socialContentRecordsCandidates.test.ts server/starter198/socialContentTypeAwareAdmission.test.ts server/starter198/socialContentMaterialRoutePlanning.test.ts server/starter198/socialContentProductionExecution.test.ts server/starter198/socialContentProductionMaterialPreparation.test.ts server/starter198/socialContentQueueInspection.test.ts`：30/30通过。该组需要本机 FFmpeg 生成测试色块；第一次使用禁止所有子进程的 guard 导致3项环境阻断，另1项旧断言要求原资产ID，改为验证派生ID与原sourceId后，使用现有离线远端 socket guard重跑通过。保留失败日志，不更改预览隔离策略。
3. `node node_modules/typescript/bin/tsc --noEmit`、`ARCHITECTURE_BASE_REF=HEAD node scripts/check-architecture.mjs`、`node node_modules/vite/bin/vite.js build`、`node scripts/sync-mobile-shared.mjs --check`、`node scripts/check-studio-chunk.mjs`、`git diff --check`：通过。构建保留已有 chunk 大小提示。完整quality/verify和真实供应商E2E未运行。

本机证据：`tmp/content-preview/material-purpose-final-tests.log`、`material-purpose-final-regression-rerun.log`、`material-purpose-final-regression.log`、`tsc-material-purpose-final.log`、`architecture-material-purpose-final.log`、`build-material-purpose-final.log`、`material-purpose-final-inspection.json`、`material-purpose-inventory-diagnosis.jsonl`。安全恢复点仍为原任务版本7且没有run/job；素材原文件未修改。后续版本变化以实际API为准，不能覆盖回旧版本。


## 2026-10-25：导出前完整检查、本地链路联调与剩余外部条件

### 本轮结论

源码 HEAD 仍为 `dfc9b0c8af85175485cf39370eed92c4be3daedd`，工作分支 `feature/content-creation-20261025`，修改未提交、合并、推送或部署。没有改写业务任务、素材授权、预算、来源或供应商权限。原任务 `socialtask_b56302033c31e2ca5d08ee38` 版本7、runId/job仍空。

已完成的是开发泳道的本地集成：原 start → durable job → LangGraph → 素材选择 → 本机语音 fixture → FFmpeg 实际渲染 → 原质检 → 人工审核暂停/恢复 → 文件归档 → 交付包。该测试使用临时 store、测试素材与本机语音，不是当前业务任务的付费成片，也不是黄金供应商 E2E。

本轮修复：

1. 分段资产的派生ID不再被预算证明误拒绝；仍核对原来源、已分析区间、文件哈希和租户。原源素材ID与sourceId不同的别名同时保留，执行器只接受可回溯同一文件、同一路径和同一选定区间的派生输出。
2. 容器时基亚毫秒误差沿用已有1ms容差，不扩大真实素材时长或允许越界。最终时间线仍落在原文件实际时长内。
3. 联系卡片的本地模板路线贯通到原执行器，规范化冻结路由不会将它改回缺素材的真实视频路线；它允许系统图形合成，不扩大真实工厂、产品效果或消费者证据的生成范围。
4. 联系卡使用本任务确认的“联系获取产品目录与报价”，不读取参考的头像、品牌或联系方式。新增真实FFmpeg输出测试贯通规划→原适配器→最终剪辑。
5. 原概念视觉适配器增加视频输出约束：视频路线不调用静态图备用，不接受缺少字节、时长或供应商taskId的“视频”结果。已接到原生产适配器装配；尚未将本任务6个本地素材缺口自动改成此路线。
6. 按原 requirements 安装独立的本地视觉质检环境，并运行原Python脚本自检。路径为 `tmp/content-preview/visual-qa-venv/bin/python`；未改共享Python或依赖锁。提供仅含质检参数的 `tmp/content-preview/execution-quality.env` 供后续独立执行实例使用，没有密钥。

### 37个分镜的实际供给状态

“候选”不是成片。下表来自当前业务任务的只读投影；没有把假设运行环境或fixture结果写回业务任务。5个人物镜头另用原selectPresenterExecutions作只读路线模拟：在HeyGen与预算就绪的假设下均选择heygen_talking；模拟不代表真实供应商执行。

| 分镜 | 类型 | 已确定输入或候选 | 剩余执行条件 |
| --- | --- | --- | --- |
| 1 | 数字人口播 | 企业首选Brody，原avatarId/voiceId绑定与HeyGen公共库授权 | 独立执行实例、真实报价与生成回执 |
| 2 | 数字人口播 | 企业首选Brody，原avatarId/voiceId绑定与HeyGen公共库授权 | 独立执行实例、真实报价与生成回执 |
| 3 | 产品 | 1个同SKU产品场景生成候选 | 首帧、生成视频、逐镜QA的正式报价与实际执行 |
| 4 | 产品 | 1个同SKU产品场景生成候选 | 首帧、生成视频、逐镜QA的正式报价与实际执行 |
| 5 | 产品 | 1个同SKU产品场景生成候选 | 首帧、生成视频、逐镜QA的正式报价与实际执行 |
| 6 | 产品 | 1个同SKU产品场景生成候选 | 首帧、生成视频、逐镜QA的正式报价与实际执行 |
| 7 | 产品 | 1个同SKU产品场景生成候选 | 首帧、生成视频、逐镜QA的正式报价与实际执行 |
| 8 | 产品 | 1个同SKU产品场景生成候选 | 首帧、生成视频、逐镜QA的正式报价与实际执行 |
| 9 | 产品 | 1个同SKU产品场景生成候选 | 首帧、生成视频、逐镜QA的正式报价与实际执行 |
| 10 | 产品 | 1个同SKU产品场景生成候选 | 首帧、生成视频、逐镜QA的正式报价与实际执行 |
| 11 | 产品 | 1个同SKU产品场景生成候选 | 首帧、生成视频、逐镜QA的正式报价与实际执行 |
| 12 | 产品 | 1个同SKU产品场景生成候选 | 首帧、生成视频、逐镜QA的正式报价与实际执行 |
| 13 | 工厂 | `54f36b44-5f99-487e-b3fd-caaa7623589c` [0.000, 1.600]秒 | 原文件版本复核、正式制作与质检 |
| 14 | 工厂 | `owned-6dd5fdb9-fdee-4803-977c-9d749f39fad4` [5.760, 6.460]秒 | 原文件版本复核、正式制作与质检 |
| 15 | 工厂 | `owned-9a603c5a-5ad6-4010-b4e5-4faf9c08b7ed` [3.000, 3.670]秒 | 原文件版本复核、正式制作与质检 |
| 16 | 工厂 | `248f1e24-3e56-4196-ae55-7f22be4ae6c6` [0.000, 1.230]秒 | 原文件版本复核、正式制作与质检 |
| 17 | 产品 | 1个同SKU产品场景生成候选 | 首帧、生成视频、逐镜QA的正式报价与实际执行 |
| 18 | 产品 | 1个同SKU产品场景生成候选 | 首帧、生成视频、逐镜QA的正式报价与实际执行 |
| 19 | 产品 | 1个同SKU产品场景生成候选 | 首帧、生成视频、逐镜QA的正式报价与实际执行 |
| 20 | 产品 | 1个同SKU产品场景生成候选 | 首帧、生成视频、逐镜QA的正式报价与实际执行 |
| 21 | 产品 | 1个同SKU产品场景生成候选 | 首帧、生成视频、逐镜QA的正式报价与实际执行 |
| 22 | 产品 | 1个同SKU产品场景生成候选 | 首帧、生成视频、逐镜QA的正式报价与实际执行 |
| 23 | 产品 | 1个同SKU产品场景生成候选 | 首帧、生成视频、逐镜QA的正式报价与实际执行 |
| 24 | 工厂 | `ae92bfa6-3434-42ec-a3c1-ae097b3cff1f` [0.000, 1.330]秒 | 原文件版本复核、正式制作与质检 |
| 25 | 工厂 | `owned-6dd5fdb9-fdee-4803-977c-9d749f39fad4` [3.000, 4.470]秒 | 原文件版本复核、正式制作与质检 |
| 26 | 包装设计 | 暂无已授权且已分析的同用途可用视频 | 待用户选择AI示意或补充实拍；不能标记已匹配 |
| 27 | 包装设计 | 暂无已授权且已分析的同用途可用视频 | 待用户选择AI示意或补充实拍；不能标记已匹配 |
| 28 | 工厂 | `ae92bfa6-3434-42ec-a3c1-ae097b3cff1f` [11.430, 12.160]秒 | 原文件版本复核、正式制作与质检 |
| 29 | 工厂 | `owned-9a603c5a-5ad6-4010-b4e5-4faf9c08b7ed` [3.670, 4.640]秒 | 原文件版本复核、正式制作与质检 |
| 30 | 数字人口播 | 企业首选Brody，原avatarId/voiceId绑定与HeyGen公共库授权 | 独立执行实例、真实报价与生成回执 |
| 31 | 门店选购 | 暂无已授权且已分析的同用途可用视频 | 待用户选择AI示意或补充实拍；不能标记已匹配 |
| 32 | 门店选购 | 暂无已授权且已分析的同用途可用视频 | 待用户选择AI示意或补充实拍；不能标记已匹配 |
| 33 | 商务洽谈 | 暂无已授权且已分析的同用途可用视频 | 待用户选择AI示意或补充实拍；不能标记已匹配 |
| 34 | 商务洽谈 | 暂无已授权且已分析的同用途可用视频 | 待用户选择AI示意或补充实拍；不能标记已匹配 |
| 35 | 数字人口播 | 企业首选Brody，原avatarId/voiceId绑定与HeyGen公共库授权 | 独立执行实例、真实报价与生成回执 |
| 36 | 数字人口播 | 企业首选Brody，原avatarId/voiceId绑定与HeyGen公共库授权 | 独立执行实例、真实报价与生成回执 |
| 37 | 联系收尾卡 | 原系统图形适配器＋任务确认CTA | 真实本地视频输出测试已通过，业务任务尚未执行 |

### 从输入到成片导出的全部检查项

| 项目 | 现有入口/实现 | 本轮证据与判断 | 尚需处理 |
| --- | --- | --- | --- |
| 任务身份、租户、版本、唯一启动 | 原任务服务/start/幂等 | 业务任务版本7无run/job；隔离测试验证幂等与恢复 | 生产时使用同一原任务，不新建重复任务 |
| 内容目标、产品、语言、平台、画幅、截止目标 | 原brief、企业知识与产品绑定 | 产品GUIANFA-RS-001、en、TikTok、9:16、38秒、预算19元均可读 | 目标原文仍“99”，未擅自改写；它是否为实际内容要求尚不明确 |
| 参考精确分析、ASR、冻结分镜、37镜时间线 | 原reference/replication/Director合同 | replicationExecutionGaps只读检查无缺口；保持38秒结构 | 真正生成前再核对当前分析版本与原字节 |
| 产品参考图身份 | 原产品库存投影 | 同SKU主图可形成候选，未借其他SKU | 产品首帧和生成镜头尚无真实回执 |
| 工厂素材、源文件区间与授权 | 原库存召回/segment/adapter | 8个片段有候选；不重叠分段传到最终时间线及预算证明测试通过 | 实际任务最终逐镜检查未执行 |
| 6个设计/门店/洽谈场景 | 原用途分类 | 确认实际库无合格同用途视频 | AI示意选择仍待回复；未越权改成实拍或复用未授权来源 |
| 企业首选人物与声音 | 原企业默认/HeyGen公共库license | Brody Living Room 8，avatarId=f95a106c3b7e4ef3a1fd2ca1e067992f，voiceId=79f5fa6497474234a5d01764efc96e13；不重复办理HeyGen授权 | 5个镜头的HeyGen执行开关、独立实例和真实回执待验证 |
| 概念视频路线 | 原controlled_ai_visual.v1/Seedance gateway | 有视频适配器，已阻止静态图假充视频 | 6镜头尚未切换；整片正式付费计划仍不支持non_evidentiary_ai_visual，不能用适配器自身预算冒充整片预算 |
| 逐镜/整片真实报价与预算预留 | 原paidOperationPlan/Preflight/permit | 原流程可拒绝未规划的付费路线；预算和恢复回归通过 | 当前0.14元是计划建议估算，不是37镜真实报价；19元未更改。产品视频、口播、ASR和QA需取得同一run的正式报价与预留 |
| 供应商账户/模型/配额 | 原环境及真实回执接口 | 密钥存在仅为配置事实，HeyGen只读权限保留 | 未提交真实生成，不声明配额、计费路线或任务成功 |
| 对象存储与供应商可读媒体 | 原objectStorage/签名访问 | 本地文件链路验证通过；预览使用local driver | 独立真实执行需核实实际供应商可读地址、到期和下载；不能仅看到COS配置就认定Ready |
| Web/worker/store/代码一致性 | 原数据权威和worker心跳 | 当前预览web单独运行；ready返回503含PB隔离探测及旧心跳版本问题 | 准备同版本、同明确store的独立执行实例；不能关闭预览隔离或消费历史队列 |
| 唯一durable job及定向消费 | 原durableQueue/scoped worker | scoped worker、恢复和原队列专项通过 | 原业务任务仍未通过准入，无job；不能先开全局worker |
| 幂等、未知结果对账、断点恢复 | 原provider receipts/checkpoint | durable与graph暂停恢复本地验证通过 | 真实供应商超时/未知结果尚未演练；先查回执，不重提付费请求 |
| 全片声音、人物声音绑定、ASR/字幕对齐 | 原Studio voice/whole voice/HeyGen | 本地集成使用say与受控音轨，实际合成视频带音轨 | 真实voiceId、文本、音频hash与时间轴、字幕实际输出尚未验收 |
| 配乐及授权 | 原BGM选择与锁定 | 本地集成使用本机合成测试配乐 | 业务任务实际BGM选定、授权与音量混合待执行，不能拿测试音调当业务交付 |
| 联系收尾卡片 | 原system_safe_motion_graphics.v1 | 使用当前CTA、实际字节/哈希/时长和剪辑测试通过 | 业务任务尚未执行，不计作已经生成的37镜之一 |
| 渲染、封面、导出、文件哈希 | 原desktop/render.cjs/ProductionPlan/artifact | 本地集成真实FFmpeg MP4及归档/交付包通过 | 当前业务素材的正式渲染、文件可读性、时长、音轨、字幕和封面待验收 |
| 本地视觉质检 | 原person_replacement_visual_qa.py | 独立环境自检通过：OpenCV4.10、MediaPipe0.10.14、NumPy1.26.4、scikit-image0.22 | 该自检不是当前成片的人物/动作/产品视觉验收；预览未启用外部生成 |
| 独立语义质检与自动交付 | 原digitalHumanQualityRuntimeReadiness | 提供执行实例用配置；离线检查能识别视觉依赖与语义配置 | 未执行付费语义QA；配置ready不等于内容QA通过。SyncNet仍为可选诊断，不能新增为全片硬门槛 |
| 人工审核、交付状态及下载 | 原graph/completion/artifact/file | 本地验证审核暂停→确认→恢复→交付包 | 业务任务产物不存在；不能标正式交付或承诺截止时间 |
| 发布/社媒账号 | 原发布模块 | 本任务目标止于制作和导出 | 不属于本次成片导出阻塞，不要求OAuth或自动发布 |
| 稳定源码与黄金E2E | 仓库AGENTS/外部E2E手册 | 当前是未提交开发分支 | 真实供应商E2E前先按规则集成并冻结源码、store、实例与唯一run；本轮未冒充黄金E2E通过 |

Seedance用量不能以尺寸与时长估算式冒充硬计费上限：[官方计费说明](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh)明确将公式结果称为估算值，以实际usage.completion_tokens为准。这里继续沿用原计费准入，不把建议成本当正式预留。

### 验证、失败证据与安全恢复点

- 原本地图生产集成最终7/7通过（含实际渲染主链、素材预算证明、分段窗口和原适配器）；日志`tmp/content-preview/export-chain-local-integration-rerun4.log`。主链耗时约89.6秒，不代表业务片交付时间。
- 首次/前两次联调分别暴露派生ID、sourceRef别名和执行器原ID检查；均保留失败日志并修复对应实际原因。第三轮运行到渲染子进程后暴露CLI相对--import随测试cwd改变的问题，改用绝对预加载路径后通过，没有关闭远端socket隔离。
- 收尾卡首次真实执行暴露typed local_only只认真实视频的旧分支，增加只针对真实联系卡片的模板路线后8/8相关测试通过；第一次失败记录`contact-card-chain-test.log`，最终`contact-card-chain-final-tests.log`。
- 最终领域/队列/预算/API/素材/视频约束回归135/135（组间与前述有重叠，不累加为独立总数），日志`export-chain-final-regression.log`；早期合同组16/16见`export-chain-contract-tests.log`。
- 视觉依赖自检：`visual-qa-self-check.json`。`execution-quality-readiness.json`只是本地依赖自检及语义配置审计，`paidSemanticCallExecuted=false`，不是供应商/当前视频QA验收。
- TypeScript、架构/HEAD ratchet、构建、共享同步、Studio边界和diff检查的最终日志以同目录`*-export-chain-final.log`及命令完成结果为准。完整quality/verify和真实供应商E2E未运行。
- API快照`export-audit-task.json`、`export-audit-ready.json`和`presenter-export-audit.json`均是本地证据，后者明确标注假设环境的只读路线模拟。账号、密钥未输出到文档。
- 恢复点：原业务任务版本7、runId/job空，预算19元，原来源和素材文件未改变；新质检环境仅位于忽略的tmp目录。若业务版本已被用户更新，应读新版本，不回滚业务数据。

尚未完成的工程工作不是已验收事实：6镜头的AI视频规划与整片付费permit交接、正式报价、独立执行实例、业务任务真实入队和供应商生成。这些仍需在用户选择补充方式之后继续完成，不得把本轮本地集成写成全部37镜实际匹配与成片成功。


## 2026-10-25：用户确认AI场景后，原任务版本8

用户明确允许第26、27、31、32、33、34镜使用带标识的“AI场景示意”，不作为企业真实客户/现场证明。通过原鉴权PATCH `/tasks/:taskId` 和原版本/幂等更新保存 `illustrativeSceneIds`，没有直接改JSON业务记录。幂等键为`approve-six-illustrative-scenes-20261025-b563-v1`；原任务版本7→8，runId/job仍空，预算19元及其他设置不变。

只读API实测：37/37个分镜有候选，executionPlanReview.approved=true。分别为17个产品候选、8个真实工厂片段、5个原HeyGen人物路线、6个AI场景视频路线、1个本地联系模板。这里的审核是规划审核，不是供应商生成、整片正式报价或成片QA验收。

### 本轮接通的工程链路

- `illustrativeSceneIds` 经过原task输入白名单、严格ID数组校验、默认brief、持久化读取和原任务更新。更新只允许当前方案里明确为general且非证明性的design/shopping/meeting场景；工厂、产品使用/效果、客户证明、未知镜头不因这次同意而获得生成权限。
- 请求到原type-aware分镜选择器后形成`illustrative_video`路线，冻结用途、Seedance、供应商5秒输入与“AI场景示意”标识。最终剪辑仍使用原约0.5–1.8秒等具体分镜区间，保持原37镜/38秒结构；供应商输入时长与编辑槽位分别核对。
- 原能力注册、候选选择、执行选择与规范化冻结路由支持该路线，没有另起派发/执行队列。已保留本地匹配优先，当前任务无本地同类才使用已同意的AI路线。现有生成和HeyGen开关仅在忽略的本地预览启动器配置；web角色和预览网络隔离保留。
- 原whole-film paid planner新增`concept_video`操作，沿用原scope、planHash、operationId、账户绑定、预算预留及paid permit。实际提交必须先调用原permit，供应商完成后记原operation结果，幂等键包含该operation身份；恢复必须核对原claim/回执，不重新付费或切换供应商。
- 适配器的独立2元预算只用于旧独立路线，不能成为已正式预留整片预算的第二个门槛。typed概念视频仍必须取得原整片许可；新scope时长、模型、账户、usage单位变化会拒绝。没有因移除此重复门槛扩大本任务19元预算。
- 原Seedance视频适配器接收冻结时长与beforeSubmit钩子。拒绝静态图备用、无字节/时长/供应商taskId的“成功”；只允许当前明确选择的视频供应商。用途与相机语言以通用主体生成，不借参考身份、品牌或企业真实客户关系。
- “AI 场景示意”直接经现有Sharp和FFmpeg烧录到镜头文件，随后重算实际文件哈希；最终编辑、归档或下载保留标识。测试检查了输出帧上的可见标识区域，不仅检查文字元数据。
- 检查窗口继续显示37镜候选和预览状态，另用原Ant Alert显示计划估算、任务预算和“整片正式报价尚未完成”。六个镜头显示为“AI场景示意”。估算提示不新增第二个启动门槛，真实预算准入仍由原Preflight负责。

### 当前费用与剩余条件

- 修复了概念视频建议成本被执行耗时比例压低的问题：按实际供应商5秒输入估算，而非按最终短剪辑槽位或220秒处理耗时折算。现有本地成本配置是5秒约7.5元；6次调用建议45元，规划总建议45.45元。它是配置估算，不是正式报价或已发生费用。
- 原任务预算仍19元。正式报价、整片reservation、供应商账户用量上界/配额、可交付媒体、真实语义QA尚未取得本业务run的实际证据。没有自动加预算、自动预留/扣费或发起生成。
- 概念视频已接入原预算接口；`readFrozenConceptVideo` 要求可信的账户/模型/输入hash/时长/用量上界证据。默认没有该证据就返回null，使原Preflight报告计费绑定缺口。不能用价格估算公式或环境常量伪造计费上界。因此目前不能声称真实报价和付费执行已就绪。
- 其他产品/人物镜头也仍需本业务任务的正式整片报价。源码仍未提交/集成冻结，独立真实worker与同一明确store尚未验收；真实供应商E2E仍受仓库外部手册的冻结要求约束。没有关闭预览隔离、打开全局消费者、执行迁移、发布或部署。

### 验证与恢复点

- 供应商适配器/场景选择/整片permit和真实视频标识烧录受控联调通过；测试使用fixture provider及本机FFmpeg，没有外部生成。`illustrative-scene-chain-tests.log`首次4/4；含正式计划/费用路由的`illustrative-budget-chain-tests.log`35/35；与前后回归有重叠，不累加。
- 原本地图执行器真实渲染/审核恢复/归档/交付包再次1/1通过，约81.4秒；`illustrative-full-local-integration-final.log`。首次本轮主链预加载使用相对路径，测试切换cwd后的渲染子进程无法加载guard；保留`illustrative-full-local-integration.log`，改为绝对预加载后通过，未减少隔离。
- `illustrative-verified-regression.log`133/133（领域、API、原队列、预算、素材、现有路径）；随后时长/幂等/恢复输入约束与最终提示改动的验证以最终日志为准。
- TypeScript首次暴露3处新增fixture的隐式any，补齐类型后按最终`tsc-illustrative-release-check.log`及本轮最终类型命令结果验收。架构、构建、共享同步、Studio和diff结果同样按最终命令记录；不冒充完整quality/verify或真实供应商E2E。
- 本机业务证据：`illustrative-task-before.json`、`illustrative-task-after.json`、`illustrative-queue-inspection.json`。恢复点为原任务版本8、同一来源/首选人物/产品/预算/截止目标、无run/job；未删除任何原素材。取消六镜AI选择应走原PATCH的新版本，不能覆盖回版本7或手改数据。

后续应先完成当前路线的正式报价及计费依据，再在预算授权范围内准备同一冻结版本/明确store/唯一job的独立执行实例。当前不存在可承诺交付时间的业务成片。


最终验证补记（同一未提交工作区）：

- `node --import '/Users/julia1/Documents/ChatGPT/1025新建1条内容/scripts/production-budget-offline-guard.mjs' --import tsx --test server/starter198/socialContentIllustrativeScene.test.ts server/starter198/socialContentConceptBudgetRoutes.test.ts server/starter198/socialContentPaidOperationPlan.test.ts server/starter198/socialContentProductPaidContext.test.ts server/starter198/socialContentProductionBudgetPreflight.test.ts server/starter198/socialContentAiVisualAdapter.test.ts server/starter198/socialContentProductionExecution.test.ts server/starter198/socialContentAssetSupplyExecution.test.ts server/starter198/socialContentTypeAwareAdmission.test.ts server/starter198/socialContentAgentWorkflow.test.ts server/starter198/socialContentRecordsCandidates.test.ts server/starter198/singleContentCreationRouter.test.ts server/starter198/socialContentQueueInspection.test.ts server/starter198/socialContentProductionQueue.scoped.test.ts server/contentExecution/durableQueue.test.ts shared/socialContentAssetSupplyTypeRouting.test.ts server/starter198/socialContentPurposeMatching.test.ts`：133/133，`illustrative-final-state-regression.log`。
- `node node_modules/typescript/bin/tsc --noEmit`：退出0，`tsc-illustrative-final-state.log`。
- `ARCHITECTURE_BASE_REF=HEAD node scripts/check-architecture.mjs`：2763个生产TS文件通过，历史预算/HEAD ratchet通过，`architecture-illustrative-final-state.log`。
- `node node_modules/vite/bin/vite.js build`：退出0，已有chunk提示保留，`build-illustrative-final-state.log`。
- `node scripts/sync-mobile-shared.mjs --check`、`node scripts/check-studio-chunk.mjs`、`git diff --check`：通过；Studio367212/485000字节。
- 原本地图主链命令 `node --import '/Users/julia1/Documents/ChatGPT/1025新建1条内容/scripts/production-budget-offline-guard.mjs' --import tsx --test --test-concurrency=1 scripts/langgraphLocalProduction.test.ts`：1/1，`illustrative-full-local-integration-final.log`。代码在任务26文件的合同传播/原流程接入中修改，未增加平行流程；未运行完整quality/verify。

主要改动文件：任务合同/输入/读取/默认/原PATCH（`socialContentTaskContract.ts`、`socialContentValidation.ts`、`socialContentRecordProjection.ts`、`socialContentTaskSupport.ts`、`socialContentTasks.ts`）；场景批准与原规划（`illustrativeScenePolicy.ts`、`socialContentIllustrativeSceneApproval.ts`、`socialContentAssetSupplyContracts.ts`、`socialContentMaterialRouting.ts`、`socialContentRecords.ts`、`socialContentAgentWorkflowContext.ts`、`socialContentAgentWorkflowPlanning.ts`、`socialContentAgentWorkflow.ts`）；原执行/预算/视频（`socialContentAssetSupplyExecution.ts`、`socialContentExecutionPlan.ts`、`socialContentPaidOperationPlan.ts`、`socialContentProductPaidContext.ts`、`socialContentProductionBudgetRoutes.ts`、`socialContentProductionBudgetPreflight.ts`、`socialContentProductionExecution.ts`、`socialContentAiVisualAdapter.ts`、`socialContentIllustrativeVideoDisclosure.ts`）；只读展示（`socialContentQueue.ts`、`socialContentQueueInspection.ts`、`SingleContentQueueDialog.tsx`），相应专项测试、ADR/QA/设计规范与本手册。此前脏改动保留，没有reset/stash或混入其他工作树。

## 2026-10-25：指定任务接入实际消费者与 ¥100 授权

本节更新运行状态，不推进源码基线。目录 `/Users/julia1/Documents/ChatGPT/1025新建1条内容`，分支 `feature/content-creation-20261025`，HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`；本会话源码仍未提交，保留全部既有脏改动。不是黄金供应商 E2E 或发布验收。

### 已落地与真实回执

- 新增 `server/runtime/localContentExecutionPolicy.ts`、`localContentExecutionRuntime.ts` 和 `scripts/start-local-content-execution.mjs`：显式 loopback/development/web 会话只消费指定租户/任务原 run 的唯一 job。每次扫描重新进入 local 数据权威，复用原 CAS、durable worker、图、预算、回执、审核和交付流程；不启动全局生产/发布/消息消费者，不改变预览默认隔离。
- 运行服务仍为 `127.0.0.1:9035`，前端 `127.0.0.1:5235`。不再是隔离预览；实际返回 `runtime.mode=execution`。浏览器原登录继续有效；本地预览免密发 token 端点在执行模式保持关闭。
- 首次原启动在版本 8 被 `social_content_order_program_selection_required` 拒绝；未建立运行。修复新单条入口遗漏的项目关联，使用已有 `createSocialProgramService` 和企业已确认品牌/市场/受众，只在没有项目时创建一份，复用租户级 subject lease；多个项目仍要求明确选择，不为每条任务另建额度池。
- 原任务 `socialtask_b56302033c31e2ca5d08ee38`，唯一 run `648dbf215df1a6d`，唯一 job `a279d9bdcdc80b2`；原 start HTTP 202，任务版本 11，消费者实际认领。第一次认领遇到正常短 mutation lease；原队列退避后暴露图冻结差异，未提交供应商请求。
- 图执行筛选遗漏了已冻结的产品参考图，导致重建 Director 丢失产品验收项。`socialContentProductionGraph.ts` 纳入被冻结 generation.productImageRefs / productIdentity.referenceImageIds；实际业务数据只读复查的差异日志为空。没有删除业务一致性检查或放开整个素材库。
- 用户明确批准本条成片累计上限 **¥100，包含生成、质检和重试**。通过原 PATCH 接口保存 `perItemBudgetCny=100`，原任务版本 **13**，run 不变；没有把它设为其他任务/企业全局授权。原解析、投影、成本血缘、正式预算、paid planner、ledger、permit、质量和交付证据保持这一明确额度。每 30 秒 ¥15 保留为缺省目标/兼容默认，不再裁剪本条明确授权。已存在 ledger 不会因为默认值变大而自动升额；未知结果仍占额，原历史 correction grant 保留原范围约束。
- 尚未花费的 blocked 图恢复使用原 `refreshUnspentContentExecutionCheckpoint`，同时更新 executor 和 bridge；只允许没有供应商状态/回执、输出或付费检查点的任务。保存原 checkpoint 快照，核对本任务 ledger 不存在后才刷新。原 retry HTTP 200，同一 run/job 继续，未重新 start 或另建任务。
- 当前消费者已执行到生产准入，job 为 **blocked**。确切错误 `presenter_speech_route_unavailable`：`shared/contracts/presenterProductionRoute.ts` 默认禁止所有生成式口播；`presenterMotherSpeechQa.ts` 的独立 SyncNet 路线也缺商业可用验收能力。不是 HeyGen 人物授权或 API Key 的二次授权问题。已向用户单独确认是否采用 HeyGen 原生口播并在成片人工验收；**该策略尚未获得答复，未修改或伪造口型检测结论**。
- `socialContentQueueInspection.ts` 显示安全、可理解的原阻塞原因，不把供应商错误正文/路径返回浏览器。Chrome 实际刷新确认队列 ID、¥100 以及口型验收问题；截图 `tmp/content-preview/selected-execution-runtime-final.png`。

### 仍未完成的真实制作条件

1. 口播验收策略待用户选择；不能把已授权 HeyGen 人物与独立口型检测商业能力混为一谈，也不能将未检测写为 passed。
2. 整片正式报价尚未完成。当前 Seedance 概念视频的默认 `readFrozenConceptVideo` 仍无可信用量上界；产品 Seedance 也不能把公开估算公式当成保证的计费上界。现有受信任目录只找到 Seedream 首帧报价。¥100 授权本身不构成供应商报价、用量证明或已扣款。
3. 当前业务任务没有供应商生成产物、正式成片或业务导出包；不能把以下本地 fixture 整链写成该任务真实成片已完成。

### 验证与恢复证据

- `pnpm run lint`：通过，`selected-execution-final-lint.log`。
- `ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`：通过，2766 个生产 TS，`selected-execution-architecture-validated.log`。
- `pnpm run build`：通过；既有 chunk 提示，Studio 367212/485000，`selected-execution-build-final.log`。
- Node + `--import ./scripts/production-budget-offline-guard.mjs --import tsx --test` 运行预算/账本/permit/planner/preflight/release、图/队列、指定消费者、项目、单条入口和检查读模型：**146/146**，`selected-execution-final-regression-v2.log`。后续安全阻塞文案组 **6/6**，`selected-execution-block-display-tests.log`；与前组重叠，不相加。
- 原完整本地链：`node --import '/Users/julia1/Documents/ChatGPT/1025新建1条内容/scripts/production-budget-offline-guard.mjs' --import tsx --test --test-concurrency=1 scripts/langgraphLocalProduction.test.ts`：**1/1**，约 83.2 秒，`selected-execution-local-full-chain.log`。实际 FFmpeg 渲染、审核恢复、归档和交付包；全部远端 socket 禁止，不是付费供应商 E2E。
- 首轮预算回归暴露仍断言旧时长硬上限的测试，按明确授权上限的产品语义修订；保留 `selected-budget-domain.log` / `selected-budget-domain-fixed.log` 的失败证据。最终预算组 69/69，`selected-budget-domain-final.log`。预留 100、未知占额、重试追加第 0.01 元被拒绝、已存在上限不能被新默认放大均有验证。
- 未运行全仓 quality/verify，未提交、合并、推送、部署或迁移。当前未对该业务任务提交付费供应商生成请求，job.providerState=none / providerReceipts=[]；并停在生产准入，尚无 funded 检查点。
- 源码恢复点为当前 HEAD；本地运行数据恢复副本 `tmp/content-preview/execution-store-recovery-before-start` 是首次开工前版本 8 的只读保留副本。不要覆盖当前版本 13/新授权/运行记录。原 job 快照 `selected-job-before-budget-refresh.json`、启动与额度 PATCH/retry 回执均在同目录；临时凭据文件受 0600 保护，交接不得输出其内容。
- 继续时恢复同一 job，先处理明确策略及报价缺口；不要再调用 original start。停止执行消费者使用对应 9035 服务的 SIGTERM；不能通过删除回执/ledger、清理锁或重置 store 恢复。

本地执行启动命令（不含凭据值）：

```sh
node --import tsx scripts/start-local-content-execution.mjs \
  --tenant local_tenant_customer_1b2913131e2c46deab66172228c4df0a \
  --task socialtask_b56302033c31e2ca5d08ee38 \
  --auth-secret-file tmp/content-preview/auth-secret --port 9035
```

如需本机视觉 QA，沿用 `tmp/content-preview/execution-quality.env` 已验证的 Python/模型配置。该启动器不会创建 auth secret，也不会使普通预览自动变为真实生产。恢复浏览器登录优先沿用现有会话/正常本地登录；不在真实执行模式开放预览免密入口。

补记：最终检查读模型的 ¥45.45/¥100 预估已不再错误标为超额；原 unspent refresh 将同一 job 的冻结检查点更新到当前预算展示语义，仍为 blocked，未再 retry。最新 hash `7ddd38d71ebc7898cd755ac2fc01687d8cd4ffa690ce10f0683d5230a076a399`，见 `selected-final-identity-refresh.log`。

## 2026-10-25：用户选定 HeyGen 原生口播后的恢复检查

本节取代上节“口播策略尚未答复”的状态，不改变源码集成基线。当前开发分支 `feature/content-creation-20261025`，HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`，修改未提交。没有合并、推送、部署或迁移，也未把开发运行声明为黄金 E2E。

### 已保存授权与原任务身份

- 用户明确选择“采用 HeyGen 原生口播，成片人工验收”。通过原任务 PATCH 保存 `presenterSpeechReviewPolicy=heygen_native_human_review`，版本 **14**；累计预算仍为 **¥100**，不改企业全局额度。
- tenant `local_tenant_customer_1b2913131e2c46deab66172228c4df0a`，task `socialtask_b56302033c31e2ca5d08ee38`，run `648dbf215df1a6d`，durable job `a279d9bdcdc80b2` 均保持不变。没有再次 original start。
- 经无付费/产物/未知回执检查后，刷新原 executor/bridge 冻结输入；hash `19d71f58eced7fea2dbd020b7b5fbdb9a6ddb8733d0847050ed47167977ad739`。恢复证据 `native-heygen-job-before-policy-refresh.json`、`native-heygen-freeze-receipt.log`；不要用旧 store 副本覆盖版本 14。

### 复用原链路的改动

- 契约/校验/投影/冻结输入贯通原生口播策略；实际选择为就绪 HeyGen 时才放行。`socialContentProductionMaterialPreparation.ts` 的第二处旧准入也使用相同策略，没有放开其他人物供应商。
- `presenterMotherSpeechQa.ts`、`presenterMotherSegmentExecution.ts` 和原 supply bridge 保留 PCM、时差、身份、裁剪与字节恢复检查。口型报告为 `pending_human_review`，没有自动分数、阈值或假 SyncNet 凭据；技术完成与人工口型验收分开。产物强制人工审核，托管自动审核不放行。原预览审核窗口显示人工口型提示。
- 修复预算路由遗漏：仅明确批准并标记的 AI 场景示意、原联系卡可进入原整片报价；不得把工厂/真实客户证明伪装为示意图。
- `socialContentProductReplacementEnvironment.ts` 从当前租户权威产品读取 SKU/显示名别名并冻结重读，修复名称与 SKU 不一致的误报；不信任任意输入别名。
- `qwenMaaSModelCatalog.ts` 允许标准 `/models` 仅返回 ID 时，将精确 `qwen3-vl-plus` 的官方视觉能力与当前账号列表结合；未知模型或明确 text-only 元数据仍拒绝。实际 GET 返回 HTTP 200 / 180 个模型，已确认 Plus 存在；`qwen-vl-max` 不在该列表。证据 `native-heygen-model-catalog-read.json`。视觉能力来源为 https://platform.qianwenai.com/docs/developer-guides/getting-started/vision-models ，不据此混用阿里云与 MaaS 的价格。

### 实际恢复结果与剩余缺口

2026-10-25 **14:10:25 北京时间**，原 job 再次停为 **blocked**，`provider_state=none`、`provider_receipts=[]`，未提交付费生成。原 retry 回执 `native-heygen-catalog-retry-receipt.json`，日志 `native-heygen-backend-catalog.log`。此前的人物禁用、产品身份与 Qwen QA 路由错误已不再出现在本次阻塞结果中。

当前错误为 `whole_film_budget_preflight:provider_usage_bound_missing`，指向 **17 个产品 Seedance 视频阶段**及 **6 个概念视频阶段**。队列 last_error 长度限制会截断后续镜头，不能把其截断文本当作全量检查清单。默认 `readFrozenConceptVideo` 未接可信计费用量上界，产品 Seedance 同样缺上界；整片正式计价凭据仍待齐全。火山官方价格文档明确公开 token 公式/表格为估算、准确用量以生成后 usage 为准（https://docs.volcengine.com/docs/ark/model-pricing?lang=zh）。不能把 ¥45.45 计划估算、环境变量每秒成本或用户 ¥100 上限写成供应商保证报价。未静默换模型、放大预算或发送试扣费请求。

下一步是补齐当前账号/模型的可信计价和可执行限额证据，并接入原两个预算读取端口；若当前供应商没有单请求计费上界，需要明确调整预算策略或经确认改用已有可限额路线，不能伪造 `maximumOutputTokens`。仍无业务成片、导出包或可承诺交付时间。

### 实际验证与安全恢复点

- 定向 Node 离线测试：`native-heygen-final-regression.log` **39/39**，覆盖原生口播、母片、原执行器、预算、分配、审核及前端摘要；`native-heygen-product-final-tests.log` **34/34**；最新目录/队列读模型/原生口播/预算路由与预检组 `native-heygen-last-regression.log` **32/32**。各组重叠，不相加。
- `pnpm run lint` 通过：`native-heygen-final-lint.log`。
- `ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture` 通过，2766 个生产 TS：`native-heygen-final-architecture.log`。
- `pnpm run build` 通过，Studio 367212/485000，既有大 chunk 提示：`native-heygen-complete-build.log`。后续仅服务端目录/读模型与文档变更，再次类型检查通过。
- `git diff --check` 通过。未运行全仓 quality/verify，未把离线用例当真实供应商生成验收。
- 服务仍使用单租户/单任务 scoped 原消费者，9035 仅 loopback；最后日志 `native-heygen-backend-final.log`。job blocked，无定时自动重试。修复当前计费缺口后继续原 job；不要另建 run、删除 ledger/回执或重复启动。

## 2026-10-25：本地素材复用机制调整

按用户最新明确要求，仅参考分镜明确锁定单个 SKU 时限制素材 SKU；其他分镜按用途、动作、场景匹配。规则及历史兼容见本任务 ADR 最新节。

改动位于 `shared/socialMaterialReusePolicy.ts`、原 `socialContentMaterialRoutingRequests.ts`、`localMaterialSegmentProfile.ts`、`fixedYieldMaterialRegistry.ts`、供片/本地裁切/预算读取合同及原候选投影；没有复制素材匹配或队列主流程。当前 branch/HEAD 仍为 `feature/content-creation-20261025` / `dfc9b0c8af85175485cf39370eed92c4be3daedd`，全部增量未提交，保留原脏改动。

当前任务版本 14 的**只读重算**：17 个产品镜头均为 `unrestricted`；本地匹配仍为 **8/37**。当前未匹配候选的理由包括类型、原型、角色不兼容及时间窗已占用，不再归因为 SKU 不同；不能把“解除 SKU 限制”写成“已补齐 17 个镜头”。审计结果 `tmp/content-preview/local-reuse-current-task-audit.json` / `.log`。原 run/job、预算和已保存的执行冻结输入没有被覆写，没有供应商请求、付费或新的执行尝试。

验证：离线原匹配、候选召回、供片本地执行、预算、原型/profile、V2/历史合同及前轮人物读模型/预览回归 **94/94**（`local-reuse-complete-regression.log`）；`pnpm run build` 通过，Studio 367212/485000（`local-reuse-build.log`）。首轮测试保留旧“600 元强制裁成 15 元”的断言，本次按先前已确认的明确额度语义修正；本地匹配成功不再准备付费升级的旧断言也已更新。类型检查另发现前轮人物路由的 talking/talking_head 枚举比较和两个测试夹具类型问题，一并修正并回归，日志保留。未运行全仓 quality/verify，未提交、合并、推送、部署或迁移；本次不构成真实供应商 E2E。

最终 `pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2767 个生产 TS）与 `git diff --check` 通过，日志 `local-reuse-final-lint.log`、`local-reuse-architecture.log`。本地前后端重新启动于 5235/9035，仍为同一 scoped 任务消费者，原 blocked job 未重试；日志 `local-reuse-frontend.log` / `local-reuse-backend.log`。未更新集成基线。

## 2026-10-25：用户要求修改规则并重新匹配

源码仍为同一开发分支/HEAD、未提交增量，保留原工作区。复用原 profile、原型规则、匹配器和 readSocialTaskDetail，未引入第二套匹配队列。新规则见 ADR“同功能匹配与历史草稿时窗补齐”。

发现并修复：普通展示相似度硬门槛、对实际手持展示一律排除 person_usage 的角色限制、刷睫毛镜头误分为产品包装，以及历史脚本缺少 materialRouting 时未传递剪辑槽位、0.4 秒镜头占用整段 1 秒源视频。未降低授权/租户/来源/版本检查，未将普通面部涂抹当刷睫毛匹配，未伪造时长或循环填充。

原 task `socialtask_b56302033c31e2ca5d08ee38` 版本 14，run `648dbf215df1a6d`，job `a279d9bdcdc80b2` 的本轮结果：

| 类别 | 数量 | 结果 |
| --- | --- | --- |
| 已匹配本地片段 | 11 | 3、4、8 新增；13–16、24、25、28、29 保留 |
| 仍缺本地产品片段 | 12 | 5、9–12、17–23，候选类型/角色或实际可用窗口不足 |
| 仍缺真实使用片段 | 2 | 6、7；旧包装分类已修正，不以面部使用替代刷睫毛 |
| 已批准的 AI 场景示意 | 6 | 26、27、31–34，保持原计划，尚未生成 |
| HeyGen 口播 | 5 | 1、2、30、35、36，保持原人物/声音路线，尚未生成 |
| 本地结尾模板 | 1 | 37 |

8/37 → **11/37 为本地匹配数量**，不是 11 个新生成产物或已交付成片。详细源资产、选中时间窗、SKU 范围、替换类型和剩余原因保存在 `tmp/content-preview/rematch-functional-result.json`，匹配运行日志 `rematch-functional-current-task.log`。本轮沿原任务重算，不覆写原执行冻结快照，不新建 run/job，不重试付费制作，预算仍 ¥100。

离线定向回归 **76/76**：`rematch-functional-final-tests.log`，覆盖展示功能兜底、手持正向证据、事实证明拒绝、刷睫毛动作、防跨类、槽位分配与 V1 兼容。首次发现旧 V1 测试期望完整源片段，已将时窗推断限定为 V2 后重新通过。未运行真实供应商生成或全仓 quality/verify。

最后验证：`pnpm run lint` 通过（`rematch-functional-lint.log`）；`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture` 通过、2767 个生产 TS（`rematch-functional-architecture.log`），曾触发的 800 行限制通过复用已有 helper、修正过时分类注释解决，未提高预算；`pnpm run build` 通过、Studio 367212/485000（`rematch-functional-build.log`）；`git diff --check` 通过。确认原 job blocked、provider_state=none、回执为空后仅重启本地后端载入规则（`rematch-functional-backend.log`），未 retry。真实本地 HTTP GET 再次确认原 task/version/run 和 11 个本地匹配，回执 `rematch-functional-http-receipt.json`。

新增产品片段使用真实源视频的 0.40、0.53、0.60 秒时间窗；保留源内容及最终审核，匹配不代表品牌文字、画面质检或交付已通过。原冻结执行快照仍保留，不以 GET 重算覆盖或启动制作。该轮剩余 12 个产品展示槽位和 2 个使用槽位是匹配缺口，不能全部作为付费生成许可。

## 产品化的失败恢复与产物复用（2026-10-25）

恢复从“内容制作任务 → 队列状态”进入，继续同一 task/run/job。前端只显示候选操作，服务端重新校验真实凭据、授权、版本和预算。

| 原状态 | 页面及服务端行为 | 保留的记录 |
| --- | --- | --- |
| 已受理且正在处理 | 显示供应商制作中，自动只读刷新 | 原操作及供应商 task ID |
| 提交结果未知 | 先核对原回执，不重新生成 | 未知请求和原预留 |
| 供应商明确失败、条件已恢复 | 检查并恢复制作；GET 原 task 确认失败，在原预算内新增可审计 attempt | 失败回执、原 accepted 预留和完整修订历史 |
| 已完成音视频、后续处理失败 | 继续后续制作；复用完成产物，只恢复原队列 | 原生成任务、媒体字节、字幕及声音身份 |

正式 HTTP 为原 social-content 路由下的 `POST /tasks/:taskId/recover-execution`，要求 start 权限、Idempotency-Key、jobId、runId、expectedVersion。重试明确失败的原生语音还需 failedOperationId；复用产物指定 `action=resume_existing_execution`。不接收客户端费用、预算、人物或租户字段。响应未知时保留同一幂等键，不自动重写请求。

弹窗在页面可见、任务活跃且没有其他操作时每 15 秒只读刷新；终态、卸载、身份切换停止。StrictMode 的 setup/cleanup/setup 也必须能完成初次加载，旧读取不能覆盖新身份。列表优先显示当前 run 的队列状态，不能用历史 plan_review 盖住真实执行状态。

供应商 SRT 是短语时间，不是词级测量或独立 ASR。多个短语组成一句是正常格式；校验规范化全文强一致性、真实时间单调性及范围，不要求字幕行数等于句子数。整轨准备、证据回读及分镜裁音必须使用同一短语校验。口型仍按人工验收。

本轮钱包只读返回 USD 34.40；旧 HeyGen `f99332f51d792b1a97b119069ed5eeea` 重新 GET 确认额度失败后，由页面恢复的新任务 `de586d3a5aff8d4afd468002d4df7d44` 已完成。母片时长 41.5869 秒、27 个 SRT 短语，已持久化音视频和字幕。字幕修复后从页面继续时，原生整轨生成回执仍仅 2 条（旧失败、已完成），账本 14 条（12 reserved、1 accepted、1 completed），未因后续恢复重发整轨生成。

这条母片不等于完整 37 镜头导出。当前仍是 HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd` 上的隔离开发联调，未提交、合并、推进集成基线或部署；最终状态以当前队列、供应商回执及 QA 证据为准。

### 后续处理恢复检查点（2026-10-25 22:45，北京时间）

- 原 task/run/job 不变，从产品弹窗“继续后续制作”恢复；原整轨母片及人物组 1 `7674d91e975f3b3f3b6ef1361f4eb6df`、组 2 `28dc2fb7a533f236dc364c8fedc62308` 均复用，未重发这些已完成的生成请求。组 3 `2d231e23b25bf433b5d9f0e11a801299` 已受理，完整导出尚待后续结果。
- 组 2 的原视频 52 帧、2.11 秒，旧本地首帧派生文件被输出层 `-shortest` 截成 21 帧，造成技术质检误拒。现仅移除输出层截断参数，保留 overlay 的原视频结束语义；派生缓存策略升级为 `approved-four-frame-intro-full-timeline.v2`。原供应商视频、旧派生文件和回执保留，新派生必须实测解码帧数与源视频相等，不补黑帧、不降相似度或技术阈值。
- 52 帧和 180 帧回归保留全部帧，音轨解码字节相等；首帧、审批及母片执行组合测试 21/21，证据 `tmp/content-preview/intro-timeline-final-tests.log`。声音与分组契约组合 13/13，证据 `tmp/content-preview/product-speech-contract-final-tests.log`。不同组合存在重叠，不累加为独立测试总数。
- 人物组 1、2 的账本与原付费许可均 completed，实际 providerSeconds 为 4.9/2.1，分别未超冻结 5/3 秒；提交指纹、输入契约、受理和完成回执关联一致。此检查点账本 14 条（10 reserved、1 accepted、3 completed），累计保留 ¥47.776004/¥100；旧失败母片的 accepted 预留仍保留。actualInvoiceCny 为空表示未取得精确结算，不代表零费用。
- `pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,785 生产 TS）及 `git diff --check` 通过；日志 `product-integration-final-lint.log`、`product-final-architecture.log`。这些源码检查与已完成的供应商片段不构成完整影片 E2E 或发布就绪。

### 单条任务归档与预览的产品衔接

- 单条任务的制作交接使用原 `adHocBusinessContext`，验证 task 派生 ID、版本、事实、平台和语言绑定，保存原上下文及哈希。周任务仍核验周包和账号；单条制作不伪造周包或发布账号，G6 发布授权保持独立。旧校验把单条上下文当作 G3 缺失，造成 `social_production_handoff_g3_incomplete`；该确定性失败现阻塞一次并保留渲染结果，不再按系统错误重复执行。
- 原生字幕来源从供应商证明推导为 `heygen_native_subtitles`，旧音轨缓存的 `audio_ai` 不覆盖真实来源。音轨字节保持不变；此来源不代表独立 ASR 或口型通过。
- 技术 `approved` 与 GraphGate 共用最终媒体硬失败判定。完整媒体检测复用原队列 checkpoint，键包含实际 MP4/主音轨/字幕基线/ASS 字节、manifest、声音时间轴、渲染证据、任务 scope 及策略版本；输入变化或篡改重新检测，失败/未知报告保持原义。检测策略变化必须同步提升 `SOCIAL_MEDIA_PROBE_CACHE_POLICY`。
- 首页预览复用原 task artifact 的授权媒体接口，将最近 50 条内容任务的真实归档视频接入现有阅览组件。测试占位、需修改和口型待人工验收分别标识；不要求先通过质量门禁才能看见已有文件，也不因预览改变验收/发布状态。没有周计划时仍可展示单条产物。
- 此检查点真实视频已渲染，SHA256 `aee4ffec588de46715ed1f76bfb03801384439482bbc4e4c9df5da98ff6556fe`，测得 37.966667 秒，包含完整 37 镜头。原任务 technical 检测记录 10 处重复镜头，来自本次授权测试占位；全片 visual、audio/BGM 检查通过。不能将测试占位替代视为正式客户素材匹配或发布验收。
- 实际验证：`node --import ./scripts/production-budget-offline-guard.mjs --import tsx --test` 对 retryPolicy、ProductionHandoff、ProductionTechnicalQuality、PreviewProjection、ExecutionRecovery、QueueProjection、MediaProbeCache、NativeWholeVoice integration、EmployeeDeliveries 九个测试文件运行 **38/38**，证据 `tmp/content-preview/product-delivery-final-tests.log`。`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`、`git diff --check` 通过，日志 `product-delivery-final-lint.log`、`product-delivery-final-architecture.log`。未运行全仓 quality/verify，未提交、部署或推进集成基线。

## 2026-10-25：用户批准仅本次测试的单一产品占位

用户明确要求用一条产品素材补齐全部产品缺口，仅测试通路；以后客户上传素材，不要求系统供应。这不构成修改正式客户匹配、SKU、授权或发布规则的要求。

本次只新增手动测试脚本 `scripts/singleContentProductPlaceholder.test.ts`，复用 `existingAssetSupplyAdapters()`、`executeSocialAssetSupplyPlan()` 和 `desktop/render.cjs`，没有新增生产队列、付费接口或企业默认素材。原分支/HEAD 不变，增量未提交。

- 原任务版本 14 的只读 HTTP 快照：`tmp/content-preview/product-placeholder-task-input.json`（0600）。原 tenant/task/run/job 身份均不变，业务 store 和 job 文件在测试前后逐字节相同；没有覆盖原执行冻结快照或新建任务。
- 选定本地已授权手持护肤品素材 `8a48f712-f6e6-400f-8008-3632e820a70f`，SHA256 `dbae1538f1cac698d2097633972981d1f7a677f8fdd416f2b5d5340c60a30a0a`，从现有 `/media/tenants/{tenant}/...mp4` 读取并核对字节。仅取 10.37–11.02 秒，按本次测试许可重复成 4 秒占位；不冒充本企业 SKU 或原分镜动作、品牌、构图一致。
- 中文“仅测试占位 · 非客户产品”和英文 TEST ONLY 水印烧录进画面。独立测试快照强制标记 `testOnly=true`、`publishable=false`、`productionMode=concept_preview`；测试输入和输出只在 `tmp/content-preview/product-placeholder/`，没有登记进客户素材库，服务器不导入该测试脚本。
- 测试覆盖产品缺口 **12/12**：5、9–12、17–23；保留原 3、4、8 的真实匹配，故测试方案产品槽位为 **15/15 有输入**。不把占位说成正式语义匹配、真实企业素材或客户成片。
- 原供片 adapter 对 12 个槽位全部返回 completed，原 compositor 已导出约 9.47 秒的产品缺口验证片。回执 `test-only-execution-receipt.json`，测试计划 `test-only-supply-plan.json`；最终输出 `studio-test-only-product-fedbd4f7af4b.mp4`，SHA256 `bec303c661b591432969d41710129c4a19b70d9e329e07f38f1fd74d467b1563`。这是产品供片与渲染验证，不是完整 37 镜头成片或真实供应商 E2E；两条使用演示缺口、HeyGen 和六条 AI 示意不属于本轮产品占位测试。

实际命令：

```sh
LINGSHU_RUN_PRODUCT_PLACEHOLDER_TEST=1 NODE_ENV=test ENABLE_LOCAL_DEV_FALLBACK=true \
PB_URL=http://127.0.0.1:1 OBJECT_STORAGE_DRIVER=local \
node --import ./scripts/production-budget-offline-guard.mjs --import tsx \
  --test scripts/singleContentProductPlaceholder.test.ts
```

结果 **1/1、无跳过**，真实 FFmpeg、供片、合成导出约 4.8 秒，日志 `product-placeholder-test-final.log`；网络 guard 禁止远端 socket，本轮付费请求为 0。默认测试没有上述显式标志会跳过，避免 CI 使用私人运行数据。脚本还要求 NODE_ENV=test、已装载离线 guard、原任务快照版本一致、源文件哈希一致、原业务数据/队列不变。初轮 providerId 断言误写为 local_material_library，按原 adapter 的实际 ID existing_customer_asset.v1 修正后通过；未改 adapter。水印预览后缩短英文防裁字并重跑，保留失败日志 `product-placeholder-test.log`。

`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2767 生产 TS）、`git diff --check` 通过，日志 `product-placeholder-lint.log` / `product-placeholder-architecture.log`。未改变生产源码或依赖清单，未执行迁移、提交、推送或部署。用户后续提供素材时继续原客户素材上传/匹配链路，不能把本测试占位作为自动兜底。

### 生命周期恢复回归检查点

- 已定位归档拒绝的根因：队列恢复推进了 LangGraph，但业务任务仍停留在 `plan_review`。新增 `socialContentProductionState.ts`，在原 mutation/reconcile 中核验当前 task/run/job、冻结执行器、完整审核快照及实时业务身份后同步生产状态；不放宽 artifact 的审核限制。
- 媒体检测缓存升级 `scene-media-hard-probe-cache.v2`，与渲染共享字节身份规范化；同一媒体换临时路径可复用，内容、语义、字幕、证据或 scope 变化仍重新测量。7 项缓存测试通过。
- 本轮 20 项状态、媒体缓存、字幕及重试回归通过，`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2789 生产 TS）、`git diff --check` 通过。日志 `product-archive-tests.log`、`product-archive-final-lint.log`、`product-archive-ratchet.log`。
- 从页面恢复原 job 后，正常状态投影将任务版本推进，暴露测试占位授权与生命周期版本的耦合：`content_test_input_plan_changed`。原任务进入 attention、原队列 blocked，四个已完成 HeyGen 任务保持 completed，没有重新生成。正在修复该授权身份耦合；本检查点尚未宣称首页归档联调通过。

- 后续修复已通过：测试 fixture 从原 `social.executor` 快照读取冻结业务版本，生命周期版本变化仍需原 run、原业务 hash 与完整 approved review 一致；普通页面读取同样适用，不能借此接受真实业务修改。attention 的原队列恢复也通过同一状态准入核验，paused/cancelled 仍拒绝。页面再次恢复后任务真实进入 producing、版本 17。
- 最终组合 `localContentExecutionFixture`、`socialContentGraphContextSnapshots`、`socialContentProductionState`、`socialContentProductionGraph`、`socialContentPreviewProjection`、`retryPolicy` **27/27** 通过；lint、基于 HEAD 的 architecture budget ratchet、diffcheck 通过。日志 `product-lifecycle-final-tests.log`、`product-lifecycle-final-lint.log`、`product-lifecycle-final-architecture.log`。预览还修复了正式人工验收通过后残留口型待验收提示的问题；测试占位不可发布规则保持。

- 23:45 的真实检测完成并写入 v2 checkpoint，随后 `social_content_idempotency_conflict` 阻止归档；已通过原 pause API 停止自动重试，原 job 排空。检测证据不能写成全通过：最终 MP4 解码 1139 帧，与冻结 38 秒/30 fps 的 1140 帧不符，首帧 PTS 0.0230469；字幕/基底完整 PTS 对照为 unknown。将继续修复本地渲染时间轴与归档操作版本，不重发已完成的供应商生成、不降低媒体硬检测要求。

### 渲染时间轴与归档重放修复

- `desktop/render.cjs` 在字幕/基底分流前统一 30 fps、零 PTS、冻结帧数；最多补 1 帧边界取整。移除 AAC mux 的 `avoid_negative_ts=make_zero`，共用显式 MP4 edit-list 配置。真实 FFmpeg 回归验证 final/base 1140 帧、逐帧 PTS 一致且首帧 0、完整 38 秒主音轨；明显短片仍不足帧数，不伪造完整性。渲染缓存提升 `social.graph_render` v2 + `social-render-timeline.v2`，保留旧字节并由正常 pipeline 本地重渲染。
- `socialContentArtifactSubmission.ts` 在原队列 checkpoint 冻结完整 artifact 提交与规范化身份，按原 run、媒体 SHA、真实审核证据修订；只忽略 adoptedAt/createdAt 两个明确观察时间。相同证据恢复使用原完整 value；真实 QA 变化产生可审计的新 revision。旧工作目录删除仍可重放，正式播放依旧读取受权 socialfile，而不是证据路径。原 mutation 的严格 hash 校验及旧失败操作不变。
- 实际回归：`node --test desktop/render.timeline.test.cjs` **2/2**；offline guard + tsx 对 render cache/frame contract/subtitle/retry **11/11**，artifact submission/retry **8/8**（组合有重叠，不累加）。日志分别 `product-render-timeline-tests.log`、`product-render-contract-tests.log`、`product-archive-submission-tests.log`。lint、基于 HEAD 的 architecture（2790 生产 TS）及 diffcheck 通过，日志 `product-render-archive-lint.log` / `product-render-archive-architecture.log`。原任务已从产品按钮再次恢复，等待实际归档验证。

- 10 月 26 日 00:01，新渲染 SHA256 `141f327666a1b4defea415a09bb79386ced6ed75ce1dfba92d142a5f5a0da231` 实测 38 秒、1140 帧、首 PTS 0，完整解码覆盖为 observed。字幕空间检查尚 unknown：旧实现把累计解码流量当内存上限，在启动前因超过 350 MiB 拒绝；正在改为有界逐帧流处理，保持检测阈值。归档 submission 的完整 value+identity 超出队列 checkpoint 上限，原队列已暂停排空，继续复用原内容寻址快照机制缩小 checkpoint 引用，不提升上限或丢失证据。

- 上述两项已修复：归档复用 `persistGraphEvidenceSnapshot/readGraphEvidenceSnapshot` 的原 `data/social-content-graph-contexts` 哈希/fsync机制，checkpoint仅约数百字节引用，原完整证据不可变。大于4MiB载荷、完整回放、篡改拒绝与旧graph快照组合回归通过。
- 字幕空间扫描改为固定一帧缓冲，保留原尺寸/帧数/120秒超时/像素阈值；373MB真实流量测试通过且external内存增量小于96MiB。mask与缓存组合11/11通过（`product-caption-stream-tests.log`），缓存策略升为v3使旧unknown重新实测；复杂字幕的简单像素证明适用边界不变。compact archive+graph snapshot+retry组合10/10通过（`product-compact-archive-tests.log`）。原队列再次从产品入口恢复，无供应商重发。

### 2026-10-26：归档完成与产品验收边界

本轮目标是正常客户任务可复用的生产链路；本次影片仅是回归样本。测试占位授权限定当前任务，不作为产品自动兜底，不改变正常素材匹配、支出、人物授权或发布规则。

- HEAD 仍为 `dfc9b0c8af85175485cf39370eed92c4be3daedd`，分支 `feature/content-creation-20261025`，增量未提交；不是已合并基线的正式 E2E。
- 原 task `socialtask_b56302033c31e2ca5d08ee38` / run `648dbf215df1a6d` / job `a279d9bdcdc80b2` 成功归档 `socialart_0445b51c9d8f9845c30c8be6`。视频 SHA `141f327666a1b4defea415a09bb79386ced6ed75ce1dfba92d142a5f5a0da231`，37 镜头、38 秒、1140 帧、首 PTS 0。提交 checkpoint 为 610 字节；原租户授权媒体接口实际返回 `200 video/mp4`。
- 归档为 `review_required`、`testOnly=true`、`publishable=false`。visual/audio 检查通过，11 处重复测试素材仍有分镜检查记录；口型为 `pending_human_review`，没有独立自动口型通过证据。字幕空间检查仍为 unknown，不能将解码完整性当作字幕、隐私或全部质检通过。
- 队列在归档后的原质量门禁 blocked：`social_graph_quality_failed:technical_quality_unverified,creative_quality_unverified,reference_hard_blocker,reference_identity_rights_fact_unverified,reference_factor_evidence_invalid,review_admission_unverified`。这不再是无法导出或无法归档；仍需处理技术/内容/参考证据与验收，不应仅反复点击恢复。
- 四个已完成 HeyGen 任务保持原 ID，本轮恢复没有重复生成。账本保留 ¥47.776004/¥100；精确结算未知，旧 accepted 预留未释放。安全恢复点为原 blocked job、已归档文件、原回执及不可变检测快照，不能清空任务重做来绕过它们。
- 浏览器当前显示登录页，首页播放尚未完成交互验收；媒体 API 成功不等于浏览器播放验收。没有新增认证旁路或改写浏览器会话。
- 最后一次已完成源码检查：`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2790 生产 TS）、`git diff --check`；日志 `product-streaming-final-lint.log` / `product-streaming-final-architecture.log`。机器证据在 `tmp/content-preview/product-archive-final-evidence.json`。后续字幕字体修复需独立记录验证，不追改此次 artifact 的检测结果。

产品回归关注点：

| 产品能力 | 本轮实现和证据 | 尚未完成的验收 |
| --- | --- | --- |
| 状态与恢复 | 原任务、冻结业务输入和当前 run 校验；生命周期推进不误作业务变更 | 不等于任意旧任务可无条件恢复 |
| 支出与幂等 | 保留供应商回执、未知支出预留，复用完成产物；归档修订有证据哈希 | 供应商精确结算仍待原账本核对 |
| 渲染与长片检测 | 冻结帧数/PTS、字幕基底一致；有界流处理、大载荷内容寻址 | 字幕字体及复杂场景检测适用边界仍需回归 |
| 预览与验收 | 已归档文件可授权预览，测试、需修改、待口型验收分别展示 | 恢复正常登录后完成首页播放与状态交互验收 |
| 正式交付 | 沿用原质量与发布门禁，未将预览成功当作交付通过 | 正式客户素材、质量证据及人工验收；当前测试片不可发布 |

### 共享字幕字体契约修复

- 根因有实际 FFmpeg 日志证据：渲染器使用 bundled Source Han Sans SC，检测器漏传 fontsdir，落到 Helvetica/PingFang。新增 `socialCaptionRendererFonts.ts` 复用原 `desktop/automatic-subtitles.cjs` 字体目录和模板清单，逐次校验当前字体字节 SHA；空间扫描与简单模板证明均使用该目录。缺失或篡改返回 unknown，不接受系统替代字体。`socialSceneMediaProbeCache.ts` 提升 v4 并纳入已验证字体哈希，字体环境变化不复用旧通过记录。
- `socialCaptionRendererFonts.test.ts`、`socialCaptionMaskFrameAudit.test.ts`、`socialSceneMediaProbeCache.test.ts` 离线组合 **13/13**，含中英 bundled 字体真实 FFmpeg 样本、缺失/篡改拒绝；日志 `product-font-contract-tests.log`。状态、归档、预览、队列投影与缓存组合 **29/29**，日志 `product-contract-final-tests.log`。组合有重叠，不累加。
- 原 MP4 仅抽 3 帧只读诊断：首帧缺失区域由 21 变为 0；另外两帧仍有不足，亮背景使部分字幕像素差低于原阈值。此修复解决通用字体契约错误，不构成复杂字幕全面自动验收；没有降低阈值，没有全量重测或更改已归档 artifact。现有人工口型验收也不能自动替代未完成的字幕技术检查。
- 改动文件集中在上述共享 helper、mask/simple checker、缓存及定向测试；原任务保持 blocked、旧检测证据保留，未重启执行器或发起新生成。后续使用新代码进行受控检测时应产生新的证据修订，不能直接把旧 unknown 改成通过。
- 冻结上述源码后，`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2791 生产 TS）及 `git diff --check` 通过；日志 `product-font-frozen-lint.log`、`product-font-final-architecture.log`。未运行全仓 quality/verify，未部署；字体修复尚未在运行中的原任务执行器上重新验收。

### 产品级检查与恢复语义回归（2026-10-26 后续）

- `socialCaptionMaskFrameAudit.ts` 将黑底字形假设改为在同次无字幕基底重建 ASS 的预期变化区域，兼容亮背景深色描边；80/40/35% 等阈值保持，低对比不可见字幕不视为成功。`socialSceneMediaProbeCache.ts` 升为 v5。正常亮暗、缺字、遮挡、不可见低对比以及原缓存/字体检查 **14/14**，日志 `product-caption-background-tests.log`。独立 `simplePixelProof` 仍保留原窄适用范围，mask 观察不能替代复杂画面的正式字幕验收。
- `socialContentPreviewProjection.ts` 区分字幕未知、字幕与冻结文案不一致、口型待人工验收；不泄漏底层诊断、不让口型确认覆盖技术问题。预览投影、成片列表及组件组合 **14/14**，日志 `product-preview-admission-tests.log`。
- `socialContentQueueProjection.ts` 对稳定 `social_graph_quality_failed` 展示“质量检查待处理”，不因已有 completed 回执误推荐直接重新入队；引导既有“查看任务”。未知供应商回执核对优先级、其他执行故障恢复和原领域恢复接口不变。队列投影、恢复、检查及前端状态组合 **25/25**，日志 `product-quality-routing-tests.log`。已有 artifact reevaluate 只覆盖参考评价，未伪装成全技术重测，也未另建平行重评流程。
- `pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2791 生产 TS）、`git diff --check` 通过；日志 `product-quality-routing-lint.log` / `product-quality-routing-architecture.log`。PRD 第 17 节同步展示规则。HEAD/原 task/run/job 不变，未提交、合并或部署。
- 确认原 job blocked、无 worker/lease、provider completed 后，仅重启本会话 9035 服务（PID 28119）。首次读取发生在监听建立前，连接拒绝；服务报告监听就绪后再次 GET 成功。真实 GET tasks 返回新 label，无误导 recovery 建议，原 artifact 的字幕未知和口型待验收分别显示；证据 `product-quality-routing-runtime.json`。仅只读核验，attempt 仍为 3，未重测或覆盖原 artifact、未发起供应商请求。
- 用户改用 Chrome 后，新建本会话 5235 标签页仍为登录页，已保留供用户登录；其他 5276 页面不替代本会话验证。页面交互/播放未验收，截图 `chrome-product-login.png`。下一步在正常会话恢复后验证当前页面；复杂字幕完整自动证明及技术重评接入仍是独立工程缺口，不能用本轮检测观察或测试占位代替完成证据。

### 成片画幅、选段与文字风险修复（2026-10-26）

- 源码仍为 `feature/content-creation-20261025` / `dfc9b0c8af85175485cf39370eed92c4be3daedd` 上的未提交修改；未推进集成基线。保留其他工作区改动。
- 新任务将 brief 目标比例传入原首帧运行器，经 Seedream、原 Qwen 首帧 QA、审批后交给原 HeyGen imageAssetId 路线；比例进入缓存及审批身份，校验真实图片宽高，提示铺满画布并保持人物完整。旧无目标比例调用与已付费快照保留。主要文件：`socialContentPresenterFirstFrameRuntime.ts`、`socialContentPresenterFirstFrameApproval.ts`、`socialContentProductionExecution.ts`；决定见既有人物语音 ADR。
- 修复 `socialContentMaterialRoutingRequests.ts` 中审核绑定绕过时长与窗口分配的问题；审核过的素材也必须提供足长且尚未分配的选段，不足时回退到其他合格候选。保留审核语义优先与用户要求的开放 SKU 规则。更新 PurposeMatching 旧测试中与开放 SKU 规则冲突的断言。选段可传递到导演候选和最终执行选择；没有宣称标签评分等同于独立的最终业务语义证明。
- `studioMaterialAnalysisSegments.ts` 保留明确 onScreenText 来源；`socialSourceTextReview.ts` 按实际裁切和变速映射到输出时间，在新增字幕同时出现时向原 manifest/技术报告/预览投影传递风险。位置尚未测量，不自动擦字、不改变质量通过判定、不把模糊字幕/音频字段当画面文字。
- `socialSpokenCopyReview.ts` 将可识别的英语重复虚词与重复介词接入既有导演摘要及脚本审核上下文，原始转写、时间码和已付费输入不变。此为窄范围校对提示，不是通用语法认证或自动改稿。
- 合并后执行离线 guard 下的 14 个测试文件，**93/93 通过**，日志 `tmp/content-preview/product-composition-final-tests.log`。覆盖首帧/审批/原生目录/HeyGen桥接、素材路由/窗口/用途、画面文字分析/投影、口播校对/导演/脚本审核。`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture` 通过（2793 生产 TS），日志 `product-composition-final-architecture.log`；`git diff --check` 通过。没有运行全仓 quality/verify 或真实供应商 E2E。
- 当前 task `socialtask_b56302033c31e2ca5d08ee38`、run `648dbf215df1a6d`、job `a279d9bdcdc80b2`、artifact `socialart_0445b51c9d8f9845c30c8be6` 未修改；没有重启服务、重新入队、重复生成或扣费。原 38 秒测试片仍需质量处理，不可发布。
- 已知缺口：当前目录人物缺少跨供应商人物处理授权，不能直接用作 Seedream 输入；构图实际效果尚待具备原授权的输入验收。素材充足不保证全部业务语义正确；文字冲突尚无坐标级自动避让；英语提示不替代完整校对。旧运行数据没有自动补写分析证据。本轮按用户要求不处理品牌归属。
- 安全恢复点为原供应商已完成回执、未变更的冻结任务/归档视频和现有预算账本；后续不得以源码通过代替成片验收，也不得直接覆盖旧审核证据。
- 最终 `pnpm run lint`（`tsc --noEmit`）退出 0，日志 `tmp/content-preview/product-composition-final-lint.log`；文档更新后再次 `git diff --check` 通过。源码、运行时与真实供应商验收仍分别记录，未部署。

### 本轮文案与字幕避让、GPT-Image-2 选型（2026-10-26）

- OpenAI Docs 核实 `gpt-image-2` 支持 `/v1/images/edits`、自定义 9:16 有效尺寸。官方 1024×1536 输出示例低/中/高分别 US$0.005 / US$0.041 / US$0.165，编辑图片另计输入图与提示词 token；参考：https://developers.openai.com/api/docs/guides/image-generation 。现有 Seedream 5.0 Pro 的 Ark 官方单图输出为 ¥0.30（≤261 万像素）或 ¥0.60（更高），第二张起输入图 ¥0.02；参考：https://docs.volcengine.com/docs/ark/model-pricing?lang=zh 。币种、画幅、输入数量不同，不能将示例输出价直接当整条成片或当前账号结算价。
- 模型转换尚未入生产代码：原首帧与付费许可绑定 Seedream/Ark 的 provider、模型、账号、报价和回执。换 GPT-Image-2 需原付费意图/已验证报价、独立适配器与账号凭据、供应商回执和跨供应商人物授权核查；不可只改模型字符串或复用 Ark 许可。若生成人物完全虚构且不复刻真实面孔，具体人物授权路径可不同，但仍需输入图和使用范围的权利。现有目录人物的 HeyGen 许可不自动扩展到 OpenAI。
- 新参考任务在原脚本来源处理时，只对可机械确认的英语重复虚词和重复介词进行修订（例如 `based on only on` → `based only on`）；原始 ASR、词/句时间码留存，修订稿进入配音与字幕，并记录 `copy_edit_revision`。复杂语病继续由已有导演/脚本审核提示处理；旧已冻结、已付费任务不重写。
- 沿用 `sourceTextReview` 的真实选段时间映射，对与原画面文字同时间段的新增字幕设置上方版位。`desktop/render.cjs` 保留其余字幕的原版位及文本，风险预览仍提示位置未测量。此为无坐标时的有界避让，不宣称上方一定安全或彻底消除冲突；未加入新阻断、未擦除原文字。
- 本轮定向脚本/来源/渲染测试 **7/7**（`product-copy-caption-final-tests.log`）；邻接领域 **37/37**（`product-copy-caption-domain-tests.log`）；`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2793 生产 TS）、`git diff --check` 均通过，日志 `product-copy-caption-lint.log` / `product-copy-caption-architecture.log`。没有运行真实供应商请求、付费操作或重新渲染原片；原任务与成片状态保持原样。
