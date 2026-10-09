# Agent 完整视频端到端验收

2026-10-09，Asia/Shanghai；本地开发工作区只读审计及独立测试。业务代码正在多会话整合，本记录是当前检查点，不覆盖历史记录，也不宣称部署完成。

## 验收结论

**首条完整真实视频 E2E：未通过，已证明通过的完整实例为 0。** 未找到同一 tenant/program/package/version/publication/content/run/artifact 串起冻结周包、明确派单、授权素材、可解码成片、独立 QC、真人审批、真实平台发布回执、当周指标及未来计划的完整证据。

真实媒体 `artifacts/e2e/topfeelpack-2026-09-27/topfeelpack-viral-remix-final.mp4` 存在；[既有实测记录](product/E2E-爆款复刻完整链路实测-2026-09-27.md)第5–21、74行明确技术通过、创意未通过、不可发布、未发布，使用授权图片本地合成，未调用 Seedance/Seedream/HeyGen。它证明本地产出及审核阻断，不能核销完整周经营链。

真实浏览器页面此前停在登录页，未提供会话凭据。本轮只读 HTTP GET `http://127.0.0.1:5181/` 返回200；探测 `http://127.0.0.1:3001/api/overseas/ready` 无连接（HTTP000），仅说明该端口探测失败，不能推断实际后端整体离线。本轮未读取浏览器存储、构造 token、接受协议、发布、付费、部署或执行迁移。

## 同一视频的证据矩阵

| 必需段 | 当前合同/证据定位 | 实际验收 |
|---|---|---|
| frozen周包/来源/explicit dispatch | `server/runtime/weeklyProductionCoverageAdmission.ts:11-26,35`：确认、selected/pending、原quota、全集、最新持久规划 | 合同及本地测试有；真实贯穿实例缺 |
| locked脚本/分镜/授权供应 | `server/runtime/socialWeeklyResultValidation.ts:146-147,225-246`；实际handoff/事实/素材来源需复核 | 未取得对应完整周视频产物集 |
| rendered媒体/独立QC | 同文件234–246核字节及审核；独立FFmpeg解码必须另外证明 | 9/27媒体存在但创意拒绝；fixture媒体不可代替 |
| humanreview | 同文件252–263：同视频实际成功审批卡、同approved产物及productionResult | 未取得真人通过凭据 |
| 发布准入/receipt | `server/runtime/socialWeeklyPublicationAdapter.ts:63-71,82-84,111-114`：unknown仅对账，成功需provider receipt/post/resolvedAt | 未发布，缺真实receipt |
| 当周metrics | `server/runtime/weeklyPublicationMetricEvidence.ts:19-29,32`：实际发布identity、窗口、完整分页、真实数值 | 缺该成片发布后的平台观测；发布时间语义见下 |
| feedback→futureplanning | `server/socialPrograms/customerFeedbackTopics.ts:26-31`、明确未来草稿及冻结双向引用 | 未取得同一真实链实例 |
| 第3镜deep-link | `src/lib/socialSceneReworkNavigation.ts:5-11`精确镜头映射 | 缺登录后正确视频/三栏/第3镜浏览器证据 |
| failed scene重制/passed保留 | `server/starter198/socialContentSceneRework.ts:62-63`；worker33–35 | 服务/fixture有；完整第3镜实跑未证 |
| unknownpaid先reconcile | worker33；publication adapter82–84 | 防重提代码及fixture有；真实未知回执对账未证 |
| 双截止/时间推进/晚完成历史 | PRD§5.4及§6；素材/补齐/销售独立截止 | 由截止会话整合；本视频中无贯穿实际时序证据 |

## Z/H 八主九副逐项覆盖

下列每行分别对应 Z 和 H 两个要求，共34项。列出的代码是接入依据；**任何一行都没有本轮真实整周交付验收通过凭据**。S3等在并发整合，不能继续沿用历史文档“完全没有服务”的结论，也不能提前标完成。

| Z要求 | H要求 | 当前接入依据 | 尚需真实证据/剩余缺口 |
|---|---|---|---|
| Z-M1 首周基础 | H-M1 历史基线/配额 | `server/socialPrograms/planningAuthority.ts:53-61,142`；planning runtime19–36 | Worker只对账已dispatched规划；实际资料/历史审计及自动前置工作未证 |
| Z-M2 外部分析 | H-M2 双来源/调性 | `executionTasks.ts:268-280`、planningAuthority196–242 | 实际外部合格参考、H owned指标/调性；本轮partial worker测试失败 |
| Z-M3 确认排期派单 | H-M3 原quota部分独立派单 | planningAuthority270–350；coverageAdmission11–26 | 真实确认/dispatch；任务图schedule在storyboard后与M3→M4不符 |
| Z-M4 企业化脚本方案 | H-M4 保留调性/创新边界 | executionTasks287–324；productionAdapter90–154,238–240 | 两路线锁定脚本/逐镜/事实权利及编导复核 |
| Z-M5 首批成片验收 | H-M5 迭代/探索验收 | executionTasks326–351；resultValidation225–263 | 实际媒体独立QC、人审；S3正在整合 |
| Z-M6 首发/基线 | H-M6 发布/新旧关联 | publicationAdapter82–114 | 实际平台receipt；库存不得算新增母版 |
| Z-M7 新询盘/知识 | H-M7 老客+新询盘 | customerBridge118,134–147；salesHandoff61–68 | 真实分群/草稿/审批/回执/反馈；no_data只可真实无客群 |
| Z-M8 首批复盘 | H-M8 双来源复盘/下周quota | weeklyReviewEvidence19–23；metricEvidence12–32 | 当周真实发布观测→冻结复盘→明确下周订单 |
| Z-S1 首批上传 | H-S1 历史盘点/补拍 | weeklyMaterialRequests17,145–162,192–197 | 真实提交/双截止/逐消费者核验、只恢复满足者 |
| Z-S2 配置事实权利预算 | H-S2 历史证据授权预算 | weeklySupplementRequests9,12 | 仅reception/material_classification两类；其他缺口无统一请求图 |
| Z-S3 企业化局部返工 | H-S3 调性偏差/探索失败 | sceneRework31–85；worker29–35；新增read/router/execution | 第3镜失败→独立run/job→只重制失败镜→passed保留→新媒体→独立复验 |
| Z-S4 首发失败/unknown | H-S4 单路线失败/对账 | publicationAdapter82–84,112–114 | 真实对账；人工责任/截止/安全重试任务仍不统一 |
| Z-S5 首批观察 | H-S5 历史/新增分开比较 | metricEvidence9,19–29,32 | 回执及平台真实发布时间、采样窗口；不拿历史帖当本周交付 |
| Z-S6 企业模板候选 | H-S6 保留/修订/新增 | executionTasks386–403；weeklyContentTemplates44–47 | 真成片+表现+明确选择/确认+未来周消费实例 |
| Z-S7 新客转人工 | H-S7 新老客异常转人工 | customerBridge147；salesHandoff61–68 | 销售交接子集有；知识/报价/unknown或partial send通用闭环缺 |
| Z-S8 修订保持全外部 | H-S8 修订保持原quota | weeklyScheduleSnapshots7；coverageAdmission18–27 | 可信资源池、剩余操作全集成本/完工区间；容量假设不证明可达 |
| Z-S9 延续/升级建议 | H-S9 跨周库存/未结 | weeklyExecutionContinuations24–27 | 同package跨版本不等于跨不同周包；库存消费/画像升级需明确凭据 |

表中简写文件均位于 `server/socialPrograms/` 或 `server/runtime/`；sceneRework相关位于 `server/starter198/`。具体原始定位见[逐项执行核验](周Agent主副链路逐项执行核验.md)，其历史结论须结合本轮增量阅读。

来源审核：`referenceSourcePolicy.ts:4-19`强制Z0/100；`weeklyReferenceSources.ts:3-6`按唯一母版分配，平台版本继承。H40/60五母版为2owned+3external；20/80为1+4。缺owned保留pending，不改原quota。coverageAdmission18–27重核allocation、母版及发布全集、confirm/dispatch相同选择。40/60服务fixture与20/80政策测试均不能代替两路线真实生产发布。

## 本轮独立测试与边界

新增 `tests/agent-video-e2e/media-evidence.test.ts`。先核对源 `weeklyContentTemplates.fixture.ts` 的DataStore、不可变计划、file注册契约，再直接调用现生产结果验证器及独立FFmpeg。

该测试实证：源fixture的文本`.mp4`能通过持久字节/hash验证，但FFmpeg无法解码；实际FFmpeg生成H.264/AAC测试图及正弦音轨后，按content-addressed路径注册可通过原验证和独立音/视频解码；随后损坏同文件两者均拒绝。**它是媒体证据审核回归，不是业务完整E2E；DataStore、授权、QC标记、发布和指标仍来自源fixture；音轨不是自然人声。** 无任何平台/provider成功声明。

命令（本机shell无node PATH，使用已提供runtime）：

```sh
PATH=/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node_modules/.bin/tsx --test tests/agent-video-e2e/media-evidence.test.ts server/socialPrograms/weeklyIndependentPlanning.test.ts server/runtime/weeklyProductionCoverageAdmission.test.ts server/runtime/socialWeeklyPublicationAdapter.test.ts
```

首次组合11项：9通过、2失败。新增测试首次因测试自己未更新content-addressed文件路径失败，已只修独占新增文件，重跑新增测试通过。源 `weeklyIndependentPlanning.test.ts:86` 连续两次失败：business_outline succeeded，benchmark_collection queued，3external评分卡继承采集阻塞，预期queuedExternal/completedExternal不成立；不修改其断言或业务实现来隐藏失败。独立来源准入4项、发布5项通过。最终当前证据为10项通过、1项源回归失败（来自上述两轮，未宣称全套green）。

现 `socialContentSceneReworkOutput.test.ts:19-20`虽有实际蓝色FFmpeg，QC对象直接构造并删除_weeklyAuthority；它只证明输出存储/恢复契约。`:22`新产物review_required且technical/creative=false，正确保持待审。worker测试unknown只reconcile、未选镜manifest保留、render重试复用供应checkpoint是fixture证据。原scene fixture只有两镜，不能核销PRD第3镜。

## 给主会话的精确修改建议

1. `executionTasks.ts:287-307`改图：business_schedule依赖director_analysis；script依赖明确确认派单schedule；storyboard依赖script。现productionAdapter95–97要求dispatched而工厂schedule在storyboard后。人工前置merge/confirm/dispatch可以运行，仍不能证明未派单包自动按计划推进。
2. `socialWeeklyExecutionRuntime.ts:19-36`明确区分规划证据对账与真实规划命令执行。若需Agent按时间自动初排/分析/合并，应调用实际命令及保存证据；真人confirm保持显式，不能自动代签。
3. `weeklyPublicationMetricEvidence.ts:20,26,29`核对真实platform publishedAt合同：resolvedAt是对账完成，submittedAt是人工提交，均不自动等于平台发布时间。观察起点应读取verified receipt中的实际发布时刻；缺时刻保持pending。此项为静态风险，应由主会话确认现receipt合同后实施。
4. 优先查本轮可复现H40/60 worker失败。保留原quota、selected/pending及原断言，核采集卡的claim/defer、nextAttemptAt和真实依赖刷新；不可通过删掉owned或伪造采集完成绕过。
5. 新S3 queue/预算/HTTP/output整合后验独立run/job结束时间、原run状态保留、newartifact再次修复cache及G4未知状态。通过服务集成后才作真实第3镜浏览器和付费供应验收。

最关键外部证据缺口：真实租户登录后取得审核通过成片、真人批准、实际授权平台发布receipt、该视频当周真实metrics，再明确绑定下周计划。在当前禁止付费/发布且无凭据条件下保持未通过，不制造成功记录。独立本地HTTP/actualstore完整周包贯穿测试仍应补齐；本轮新增媒体测试不替代该工作。

## 新返工接入复审检查点

主会话增量的静态复核（仍未宣称实际付费返工通过）：

- `server/starter198/socialContentProductionQueue.ts:144-148`专用dispatcher先于152行普通asset_review skip，因此repair不会被普通待审状态跳过。
- `socialContentSceneReworkAdmission.ts:73-77`创建独立execution run；`socialContentSceneReworkExecution.ts:54`仅更新该run的completed_at，原run未覆盖。原`socialContentProductionRuntimeSupport.ts:329-335`保留原completed_at；managed未accepted的waiting_external原run由admission54–56终态gate拒绝。
- `socialContentInitialSceneCache.ts:21`实际失败才failed，其余review_required；格式/时长/同步/字幕/敏感项仍false。`socialContentSceneReworkOutput.ts:35,39-40`技术/创意false、qualityPassed false，G4未知未被当passed。
- **Status投影缺口**：execution34–37已保存sceneReworkOutput，54保存run结束；`server/contentExecution/durableQueue.ts:400-402`保存job结束，但`socialContentSceneReworkRead.ts:82-85`及`shared/contracts/socialSceneRework.ts`状态合同没有新artifact/file/SHA/G4/实际结束时间。建议核hash及run/job/operation映射后只读投影，不按最近产物猜。
- **二次局部repair缺口**：output39没有新initialSceneCacheInput/initialSceneSourceHashes或新immutable cache；service35,40–43严格核cache.runId==task.run_id及媒体证明，read16–19固定原run。因此新产物尚不能作为下次parent。建议验证artifact.sceneRework实际source→execution→output lineage，封存新cache，不改写原task.run_id兼容。
- **完成回调恢复窗口**：durableQueue540–543先将job置succeeded再调用completion callback，run写入失败需幂等恢复已验证输出；应新增实际存储失败恢复测试，不能退回供应或重复计费。

此复审没有修改主会话、分镜或调度会话持有的业务文件。

最终完整组合复跑：11项，10通过、1失败，退出1。源weeklyIndependentPlanning同一失败第3次复现，新增媒体审核测试及9项来源/发布测试全部通过。无需据此重跑全量构建，也不把失败缩小成整周完成。

## 2026-10-10 最新整合复核（替代上述对应旧缺口）

本轮重新读当前文件并协调两个原审计子Agent；未改业务代码。

1. **任务图顺序已修复**：`executionTasks.ts:283-306`实际依赖为director_analysis→business_schedule→script→storyboard。上文“排期在分镜后”的建议已落实，不再列为当前未修缺口。
2. **H40/60源回归本轮通过**：新增媒体测试、weeklyIndependentPlanning、返工Read两项、Resume两项、Router一项共7项，7通过/0失败/退出0。旧三次失败仍保留为历史证据，不声称当前仍失败；该本地通过不等于真实全周执行。
3. **Status已补输出及结束时间**：`socialContentSceneReworkRead.ts:93-121`和共享DTO返回artifact/file/SHA/parent/review/QC/savedAt及job/run完成时间，校持久输出hash和operation/run/job/parent，并读取精确artifact hash。因此原“DTO无输出/时间”缺口已缩小。
4. **Status尚缺持续交叉核验**：read未核artifact自身`content.sceneRework`的operationId/executionRunId/sourceRunId/operationHash与当前intent；未校mediaStorage.video.sha256与返回sha一致；qualityReceiptIds仅核非空字符串列表，未逐项核G4作用域/去重/全镜覆盖。执行完成路径57–73另核媒体真实bytes，但不替代后续只读投影的作用域校验。建议复用worker实际输出校验，允许真实review状态演进，不允许同parent另一operation产物或漂移回执借用。
5. **unknown恢复顺序已修复**：Resume40–50存在providerWork时跳过新报价/预占，沿用原job；Execution24–27先恢复已有checkpoint预算；无checkpoint时worker33先reconcile并阻塞，34才新预算及供应。SupplyPorts16对submitting/unknown保持阻塞；仅qwen accepted/completed及HTTPS output恢复实际媒体后保存checkpoint，下一次调度再render。未知本身尚无真实provider查询成功证据，不能称一次resume已完成或真实对账通过。
6. **二次新产物cache仍缺**：Output39未封存initialSceneCacheInput/sourceHashes及新cache，Service41–42仍要求这些证据，Availability Read17–20仍固定原task.run_id。此项继续未通过。job succeeded后completion写失败的独立幂等恢复证据也仍待补。

当前完整真实视频E2E仍0条通过；不宣称付费provider、真人验收、真实发布、平台指标或完整未来规划成功。

H领取恢复门补核：`server/runtime/socialWeeklyPlanningReconciliation.ts:7-15`仅五类正确workflow规划步骤，排除人工/未来retry/scheduleRevisionRef及冻结snapshot，唯一scope周包且planning adapter及真实结果validator均通过才准提前领取。Worker99、119在锁前及锁内重读，117–125仍要求全部依赖succeeded；production/publishing不在白名单。该例外解决已有真实规划被预计顺排时间阻挡，不自动创建初排/分析/合并；runtime18–35的未派单规划自动执行缺口仍在。

## 2026-10-10 OutputPort→Read 独立正向集成与完成恢复

新增独占 `tests/agent-video-e2e/output-status.fixture.ts`、`output-status.test.ts`，fixture仅复用源OutputPort测试的存储/授权/供应合同，无源测试或业务文件修改。通过真正`createSocialSceneReworkOutputPort`持久新FFmpeg产物、handoff、逐镜G4及新cache，再保存执行器同形状持久output receipt，调用真实`readSocialSceneReworkStatus`，不再只测output:null。

四个新用例已通过：

1. 实际OutputPort产物精确非空投影，artifact/file/SHA/parent/review/G4/savedAt全部吻合；job/run完成时间投影正确；读取前后存储不变；原task.run_id保留；新cache可按新run读取，所有未知审核仍review_required。
2. 即使重算artifact content hash，operationHash篡改、media SHA漂移均拒绝；即使重算output receipt hash，缺一镜G4仍拒绝。
3. 新成片实际字节注册至content-addressed本地file，job succeeded时首次run完成写入返回失败；真实complete函数拒绝并保留job/output。直接再调用只完成原run；第三次幂等不变完成时间、不新增artifact、不改原run。
4. 真DurableContentExecutionWorker完成execute后，onSucceeded抛完成写入错误；job保持succeeded及completed_at、run仍running、原output可读、execute和callback各一次。该用例运行时已读到主会话新独立callback catch。

修复核验：`server/contentExecution/durableQueue.ts:541-550`已将post-success callback错误隔离为reconciliation日志，不进入finishFailed。上文“回调失败降级成功job”的风险不再是当前实现；过去代码路径的证据保留为历史。**job成功/run尚未完成的无人值守恢复入口仍需独立验证**：主会话已分配其他会话实现CompletionRecovery，本会话未重复开发。直接complete函数幂等已证，不等于恢复器已挂后台且自动可达。

Read111–135现在核recursive lineage、实际媒体SHA、真实G4去重/全部镜头、handoff版本和productionResult hash。`socialContentSceneCacheSource.ts:12-13`核新旧handoff、intent/祖先cache/supply checkpoint及循环；Output39–42保存新initial fingerprint/sourceHashes并persist cache，service/availability改用实际血缘resolver。因此旧“Status缺交叉校验”和“新产物无二次cache”结构缺口已补。第二次真实局部制作仍要求新审核产生实际failed证据；review_required不能当可直接返工/审核通过。

扩大回归命令：

```sh
PATH=/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node_modules/.bin/tsx --test tests/agent-video-e2e/media-evidence.test.ts tests/agent-video-e2e/output-status.test.ts server/contentExecution/durableQueue.test.ts server/starter198/socialContentSceneReworkOutput.test.ts
```

日志最终21tests/pass21/fail0/exit0：独占5项、durableQueue10项、源Output6项。回调失败及receipt写入中断日志均为故意注入，相关断言通过。没有采用主会话曾口头估计的15项计数。

边界：实际FFmpeg蓝色媒体、OutputPort、只读投影、cache和直接完成函数是真实本地执行；DataStore/授权/provider供给及QC输入是隔离fixture，完成时间投影用例的时间显式设置，未证明实际完整周包、独立自然人声/创意审核、真人验收或平台成功。全目标真实视频E2E仍0条通过。

### 完成扫描器增量验证

其他会话新增`socialContentSceneReworkCompletionRecovery.ts`后，本会话仅新增第5个独立output-status用例：实际OutputPort产物和本地真实字节、已持久succeeded job＋running run，调用真实recoverSocialSceneReworkCompletions，recovered1/failed0；再扫recovered0/skipped1，完成时间及artifact/file/G4/job数均不变，Status仍精确指向原输出。新5项整体pass5/fail0/exit0（此前21项扩大组合不包括这个新增用例，不能相加冒充一次全量日志）。后台挂点尚未在本会话独立验收，故只声称恢复服务本地可达，不声称无人值守后台完整通过。

本轮全量`tsc --noEmit`退出2，唯一输出：`server/lib/referenceSpeechAnalysis.ts(56,5)` TS2353，`speechAlignmentSummary`不属于`VideoAiAnalysis`。这是本会话只读范围的其他文件，不修改；已告知主会话。因此不能引用此前其他会话的全TS绿作为当前检查通过。

### 后台恢复挂点与正确视频身份边界（最新）

本会话已独立读到`server/runtime/socialSceneReworkCompletionRuntime.ts`：初始化立即tick、30秒扫描、running防重入、保留分页cursor，并只调用完成恢复，不领取生产。`server/runtime/backgroundJobs.ts:45`在真实worker/all启动路径调用该init，web角色拒绝启动背景任务。故“尚无后台挂点”旧结论已撤销；这是实际代码接入证据，未单独证明当前本地进程已触发定时扫描。

主会话最新联合日志`/tmp/completion-recovery-final-joint-tests.log`记录durable10＋本会话output5＋recovery5，共20tests全通过。该计数区别于本会话此前21项组合，不混算为完整业务通过。

**第3镜正确视频定位仍未验收**：自动`ProductionExecution`尚未产生精确studio project—parent artifact producer binding，负责会话正在补真实producer snapshot及经核验DTO映射。前端收紧project×artifact准入是正确阻断；同task/project存在、同任务的最新项目、镜头序号一致或页面可打开均不能证明目标视频身份。必须同时核真实tenant/program/周包版本/execution task/content task/project/parent artifact/scene及生产映射，缺映射应显示真实缺口，不降级打开任意同task项目。报告没有也不新增“同task即可正确视频”的完成推断。

S2账号授权请求由其他会话开发中，本轮未独立验收；真实完整生产/发布/指标E2E仍0条通过。

## 客服统一 WhatsApp／Messenger／Instagram 后台私信审计（首次快照）

2026-10-10新增硬要求；本会话协调两个子Agent分别只读审Messenger及Instagram，自己核周customer bridge和渠道授权。没有外发消息、付费、登录或修改主会话send recovery/webhook文件。视频原验收不取消，仍未完成。

**结论：统一客服目标尚未完成。** 以下是首次快照的历史记录；M/IG无requestId的旧缺口已修，当前状态以文末“新台账后复核”取代。共用页面及授权policy已覆盖三渠道，但周分群/草稿/批次派送及新增unknown恢复仍主要是WA；M/IG直接会话收发不能核销完整周客服链。

| 环节 | WhatsApp现有范围 | Messenger实际范围 | Instagram实际范围 |
|---|---|---|---|
| 授权/账号身份 | `customerMessagingPolicy.ts:105-156` tenant Meta app配置 | 同文件按Facebook Page/token/subscription检查 | 同文件分别IG Login/Page Login scope、订阅及账号检查 |
| 私信接收/会话 | 已有WA独立history/import/inbound链，本轮不代替M/IG审计 | `messenger/conversations.ts:248-265`匹配Page/PSID、mid去重；webhooks118–145签名、174–188租户Page | `instagram/conversations.ts:218-274`核canonical账号/IGSID、mid去重；webhooks102–145,168–190签名/已连接账号 |
| provider delivered/read | WA followup有逐消息receipt/claim/status | conversations226–244更新已有出站mid | conversations231–249更新已有mid/watermark |
| AI回复 | WA有专属自动回复链，未据此推断其他渠道 | UI `ConversionPage.tsx:349-369`可要AI草稿；webhook265仅触发标签分析，无持久自动回复派送任务 | suggestions221–250读IG会话；conversations147–215,270标签/BANT分析，未见完整webhook→持久AI回复派送 |
| 人工接管 | WA派送runtimeSafety核human_needed | `customerSuggestions.ts:19,96-106,181-186`进程Map暂停auto，无持久owner/领取/跨重启状态 | 同Map，仅暂时暂停，不能冒充持久接管 |
| 审核 | WA批次真实version/content hash及审批，发送前再次核 | suggestions169–175核auto授权；UI confirmedByHuman不是后台批准版本/hash合同 | 同outbox边界；普通手动发送无独立审批版本/hash回执 |
| 真实发送 | followupWorker545/550调用WA template/text | conversations272–290核24h/Page/PSID后POST，返回mid后写timeline | send38–67核24h/account/scope后POST；send18–35区分graph.instagram.com及Page graph.facebook.com，须message_id |
| request幂等/unknown | WA followup提交前claim/冻结正文，unknown阻塞；新增周恢复仅WA | outbox159–205直接发送，无durable requestId/claim/提交前状态，超时统一502，重新点击可能双发 | 同样先POST后保存，没有durable requestId及unknown恢复；provider已成功但保存失败不可盲重发 |
| 周任务接入 | bridge读取实际segment/batch/approval/receipt；真实执行在digitalEmployees/worker | 未接M实际dispatcher或M专属周receipt恢复 | 未接IG实际dispatcher或IG专属周receipt恢复 |

### 周 customer_bridge 实际是否调用三渠道

`server/runtime/socialWeeklyCustomerBridge.ts:66,95-149`明确binding不启动/审批/发送，仅读取已有运行四阶段，要求真实冻结分群、逐客正文hash、批准批次及provider receipt；unknown/partial不能完成。路由`server/routes/socialPrograms.ts:344`调用该只读reader，日历183同样只读。未发现周桥接直接调用Messenger/IG send。

实际默认数据和执行仍WA：`server/digitalEmployees/customerWorkflow.ts:11,314,491`默认getWhatsAppCustomers；`server/routes/digitalEmployees.ts:43-45,1571,1908`分群/no_data重开也读取WA；followupWorker359默认WA客户、545/550实际WA模板/正文发送，routes digitalEmployees3456调用该worker。模型customerWorkflow91/621只有wa_number，未冻结channel、Page/IG account、PSID/IGSID及原会话身份。即使reader接受通用provider_message_id，也不能据此认为三渠道已真正执行。

`server/socialPrograms/weeklyCustomerSendRecovery.ts:29,35,38`使用WA claim callback、wa_number数字归一，并明确channel:'whatsapp'。签名收据核验和指定人恢复是WA改进，不覆盖M/IG，也不能把它改标签就核销其他渠道。

### 真实证据与本轮测试边界

Messenger并非没有真实收发证据：既有`artifacts/customer-smoke/real-messenger-results.json`、`messenger-reauth-send-results.json`、`messenger-persistent-roundtrip-results.json`记录真实inbound/outbound/provider receipt及delivery/read摘要。本轮未重发，未复核平台在线状态；这些特定收发证据不包含完整批准、unknown恢复和周计划贯穿。IG本轮找到的是接口及隔离测试，未取得等价真实平台完整私信链凭据。

本轮用已提供Node runtime运行两个独立组合，均不向provider外发：

- customerMessagingPolicy＋weeklyCustomerBridge：16tests/pass16/fail0/exit0。授权按实际渠道隔离、桥接scope/审批/unknown拒绝合同通过，不等于M/IG执行通过。
- integrations/messenger、messenger/conversations、instagram/send、instagram/conversations、integrations/instagramWebhook、routes/webhooks.instagram：25tests/pass25/fail0/exit0。发送和subscription全部注入fetch，入站会话测试用隔离临时文件及analyzeTags:false；HMAC/去重/租户/账号/回执投影通过，未验证实际Meta webhook连通或消息成功。

两份日志分开报告，不称一次41项真实渠道E2E。子Agent首次执行因node未在PATH未启动，主会话本次已用bundled runtime真正补跑上述25项。

### 具体剩余缺口与建议（业务文件仍只读）

1. 三渠道共享不可变发送意图：tenant/channel/channelAccountId/providerRecipientId/customerId/conversationId/原入站mid、正文/hash、批准版本、人审/自动授权、requestId。在任何POST前持久claim；同意图并发/丢响应只读恢复，不能重新POST。
2. 保留各渠道实际窗口及身份差异：WA号码和模板不能套给Page/PSID或IGSID；IG Login与Page Login分别核scope/account；渠道授权不得互借。未知结果保持unknown，只有原请求可证明未发送才安全重试。
3. M/IG echo/delivery/read需绑定原request/account/recipient及provider mid，补provider接受后本地保存失败恢复；有mid不等于已送达，无mid/fallback本地ID不能当真实provider凭据。
4. 人工接管持久保存指定owner/领取/暂停/截止/处理结果，跨重启仍阻止auto；统一客服异常与周S7恢复任务，同时保留客服关系和会话原身份。
5. 真实周M/IG消费者需从渠道正确客户集合创建冻结分群/草稿/审批/dispatcher，并保留逐渠道receipt、unknown任务及反馈futureplanning；当前WA默认集合不能用source标签兜底。AI草稿、标签分析和可点击发送分别验收，不能互代。

三渠道统一客服尚未通过；完整真实视频E2E仍0，授权平台发布与当周指标目标继续保留。

### 新台账后复核（当前边界，替代首次快照对应结论）

已重新读`customerChannelSendRequests.ts`、真实M/IG ports、customerSuggestions、webhooks及周bridge，并由两子Agent独立交叉检查。

**旧“没有requestId/持久发送台账”的缺口已修，不再作为当前未修项。** 迁移2035新增台账；Messenger conversations278–284、IG send46–56实际调用service；outbox185–186必须requestId并传actor，GET167–171、恢复174–178实际可达。客户端稳定意图保存与账号context已落。台账冻结tenant/channel/actor/customer/accountAuthority/recipient/body hash；同requestId并发唯一创建，sending/unknown禁止重提，accepted重放只返回原receipt并修本地history。这里证明接入代码，不宣称迁移已部署或真实平台全部验收。

本轮源台账5项＋签名/账号webhook4项共9tests/pass9/fail0/exit0；发送和平台返回均隔离stub。已接受receipt的本地history repair无transport，恢复入口返回messagesSent:0。主会话另报告WA真实本地HTTP HMAC→tenant WABA/phone→ingest→humanresolve7项及最新全TS退出0；这与本会话早前TS失败为不同时间检查点，不能将WA结果替代M/IG signed ledger。

当前仍未通过的三渠道边界：

- **Signed M/IG webhook没有接发送台账对账**：webhooks188–190仍仅调用handleMessengerWebhook/handleInstagramWebhook；全仓库生产调用搜索未找到signed ledger ingest。ledger当前只有get/repairHistory/execute，repairHistory24–25要求已保存accepted receipt。因此signature验证后的echo/delivery/read能更新timeline，但不能解除unknown、或恢复provider response保存失败后的sending fence。恢复接口名称reconcile不代表具备provider未知结果对账。
- **不同fresh requestId同意图并发存在已复现竞态**：ledger33先scan unresolved，再35按requestKey唯一create。纯内存DataStore及transport stub并发执行同tenant/channel/account/recipient/body、两个fresh IDs，实际结果2次stub调用、2条unknown、两者provider_identity_gap、外部调用0。现源test只覆盖相同ID并发及不同ID顺序。需同意图scope持久互斥/唯一fence；客户端稳定ID改进不能替代服务端此边界。
- **人工接管仍进程Map**：customerSuggestions21/107/205，未发现跨重启持久owner/领取/暂停证明。
- **周M/IG仍未接真实批准派发**：bridge16–19,149只读原followup链，worker545/550仍WA，callback674/713数字化recipient；周恢复35/38明确whatsapp。直接outbox新台账不等于approved batch/version/hash核销，需真实三渠道周消费者/dispatcher及回执绑定。负责会话正在开发，不能提前报完成。

旧无request缺口已闭合，当前验收分三项：直接outbox同ID幂等已本地验证；signed webhook unknown对账未接；周计划M/IG审批派发未接。视频完整真实E2E仍0；独立offset/restart测试不等于全后台真实业务重启已验收。
