# Z/H 周任务逐链本地执行覆盖审计

日期：2026-10-10。读取基线 HEAD：`02e33a59f2d854a6f2f7e3b635e4890659973c35`。范围为 PRD 的 Z/H 主链 M1–M8、副链 S1–S9。本文只记录本地证据，不证明外部账号生产回执。

## 本轮运行证据

命令（使用桌面 bundled Node 加入 PATH）：

```sh
./node_modules/.bin/tsx --test server/socialPrograms/weeklyScheduleTargetGraph.integration.test.ts server/runtime/weeklyEstablishedReferenceSource.integration.test.ts server/runtime/socialWeeklyResultValidation.test.ts server/socialPrograms/weeklyReviewEvidence.test.ts server/socialPrograms/weeklyTemplateRevisionCarryover.test.ts server/runtime/socialWeeklySalesHandoff.test.ts
```

结果：**26 项，25 通过，1 失败**，退出码 1。日志 `/tmp/zh-local-coverage-tests.log`。失败为 `weeklyReviewEvidence.test.ts:6`：有指标引用的监测读视图期望 `monitoring_evidence`，实际 `blocked`。此处不应靠放宽指标/发布归属门禁修成绿色，应补齐对应正向来源证据并重跑。

定位：该测试 fixture 的 pkg 仅包含 program/package/version/status/weekStart/weekEnd，缺 `socialContentPackage.publicationTasks`。`validateWeeklyExecutionResults` 调用 `validateWeeklyPublicationMetricRefs` 后进入 `readWeeklyPublicationMetricEvidence`，读取缺失的 publicationTasks 产生异常，被只读视图 catch 转为 blocked。进一步还缺 metric 的 `platform`、正式 `social_publication_assignments`、`social_publication_attempts` 与 `starter_publication_packages`；单独补 package 字段不能使测试合法完成。必须构建冻结 manifest/assignment、已验证平台回执以及内容身份与采集窗口一致的指标。真实零 views=0、未知 shares/comments=null 应继续断言。

此前记录的83a160b性能adapter返回pending失败与此处属于同一发布归属严格校验领域，但不是同一测试或相同异常：这里是旧只读fixture缺完整package和发布身份，不能直接以“已知基线”忽略。

本轮随后修复该**测试fixture**，复用 `prepareWeeklyInventoryG6Fixture`，经正式 `executeWeeklyPublication` 产生受控 published attempt、manifest/assignment，加入匹配 TikTok post 与采集窗口的指标，再构建独立监测任务。单文件复跑 **5/5通过**（日志 `/tmp/zh-review-fixed.log`）；views=0、likes=2、shares/comments=null 和跨租户指标 blocked 均保留。没有修改业务验证门禁。最初26项失败记录保留，避免将修复前结果覆盖掉。

最终同一六文件组合复跑：**26/26通过，退出码0，3.67秒**；日志 `/tmp/zh-local-coverage-tests-fixed.log`。本次自有两文件 diff-check 通过。未运行全库类型检查，交统一集成执行。

H40/60、H20/80 的五母版规划来源冻结正向各通过；销售交接十项通过；正式发布结果引用的冻结 manifest/assignment/时间戳校验通过；模板跨版本下一周绑定通过；旧图和新排期保存并经真实规划/产能服务生成通过。它们是独立局部服务测试，不能合并宣称五母版全周逐卡完整执行。

## 主链覆盖

执行代码的主链映射位于 `server/socialPrograms/executionTasks.ts` 的 `MAIN_CHAIN_BY_STEP`、`chainIdentity`；来源差异冻结为 Z external_cold_start、H owned_history_iteration / external_incremental_exploration，包含配额及输入/交付契约。

| 主链 | 已存在代码/测试证据 | 本轮证据与限制 |
| --- | --- | --- |
| M1 经营基础/历史基线 | business_outline；weeklyM1ContinuousProduction.integration.test.ts | 连续测试源码覆盖新周、capacity、派单至受控单视频发布。本轮未重跑该重型测试，不把历史通过计入本轮26项。 |
| M2 参考采集分析 | benchmark_collection/scoring、director_analysis；weeklyEstablishedReferenceSource.integration.test.ts | H40/60与20/80冻结各自owned/external来源通过；外部与历史输入仍是本地受控输入，不证明联网采集。 |
| M3 排期派单 | business_schedule；weeklyScheduleTargetGraph.integration.test.ts | 真实planning/capacity服务升级图并保留旧图通过；不证明整周所有排期能成功产出。 |
| M4 脚本、分镜、素材 | script/storyboard/material_preparation/readiness；ResultValidation、M1连续测试 | 逐步骤真实媒体及证据校验负向通过；M1只覆盖一条生产分支；H双路线全周流水线缺证据。 |
| M5 成片质检验收 | asset/video_generation、quality_check/rework/user_approval；M1、creative/technical repair E2E | 本轮空/伪造引用与实际内容证据边界通过；G4/G5受控审核不能证明人工质量，数字人路径不由非presenter测试证明。 |
| M6 发布与回执 | publishing；ResultValidation、weekly publication adapter/worker tests | 本轮正式assignment/manifest/provider时间戳引用验证通过；真实TikTok/Instagram外发未执行。 |
| M7 客服与销售 | customer_channel_readiness/inquiry_handoff；socialWeeklySalesHandoff.test.ts | 新客/老客分流、领取、反馈、去重、HTTP权限和消息证据十项通过；三渠道实际接入应由worker组单独提供受控HTTP证据。 |
| M8 监测复盘 | performance_monitoring、weekly_review/template_extraction/validation；ReviewEvidence、ResultValidation | 旧fixture失败已按正式发布归属补齐，单文件5/5通过；全周数据采集→复盘→下周建议仍未由单一连续测试证明。 |

## 副链覆盖

副链标签由 `SIDE_CHAIN_BY_STEP` 挂到相应主任务；标签出现不能证明异常已经触发并成功恢复。

| 副链 | 实现/专项测试入口 | 本次结论 |
| --- | --- | --- |
| S1 真人上传/历史素材补交 | weeklyMaterialRequests、weeklyMaterialNewConsumerAcceptance、weeklyMaterialConsumerRecovery | 存在专项源码；本轮未运行，逾期红标与消费者恢复须提供单独运行证据。 |
| S2 事实/账号/权利/预算/历史指标补证 | weeklySupplementRequests、weeklyOwnedMetricSupplement、weeklyAccountAuthorizationSupplement | 存在Z/H配额保留及历史指标补交测试；本轮H来源冻结通过不替代全部补证链执行。 |
| S3 创意/技术局部返工 | weeklyCreativeRepairE2E、weeklyTechnicalRepairAdmissionRecovery、creativeRepairApproval.integration | 专项源码存在；应核对child批准后同publication真正发布，不只resolved标签。 |
| S4 发布失败/未知回执 | weeklyPublicationRecovery、weeklyPublicationRetryIsolation、ReceiptRace | 专项源码存在；本轮只验证完成引用，lost-response原attempt恢复需对应受控provider运行。 |
| S5 数据观察/历史比较 | performance_monitoring、weeklyReviewEvidence、socialWeeklyPerformanceAdapter | 正式发布归属下监测视图、零/未知指标读测试通过；历史比较、采集adapter与全周复盘连续执行仍需证据。 |
| S6 模板候选/保留/修订 | weeklyContentTemplates、weeklyTemplatePreSupply、weeklyTemplateRevisionCarryover | 跨周模板确认绑定及真实脚本结构应用通过；不代表模板效果已经经真实观察窗口验证。 |
| S7 客服异常/销售转人工 | socialWeeklySalesHandoff、weeklyNativeSendRecovery、weeklyCustomerKnowledgeReview | 本轮销售交接正负向通过；原生/WhatsApp unknown发送恢复由客服专项提供。 |
| S8 计划修订 | socialWeeklyScheduleRevisions、weeklyScheduleTargetGraph、weeklyBackwardSchedule | 本轮真实图升级保留旧图通过；完整版本漂移、配额改变重新确认需专项覆盖。 |
| S9 跨周延续/画像建议 | weeklyContinuationCalendar、weeklyExecutionContinuations、weeklyProfileUpgrade、TemplateRevisionCarryover | 本轮模板下一周绑定通过；同任务跨周去重和画像升级需专项，不自动把Z切换H。 |

## 优先补齐

1. M8/S5只读正向旧fixture已修复；继续验证采集adapter→归属监测→复盘冻结的连续链，保留真实零与未知指标语义。
2. 增加 H40/60、H20/80 各五母版连续执行，包含自有/外部脚本差异、素材准备、独立G4/G5/G6、逐条批准、assignment、原子attempt、受控provider回执与周末监测。现在只有规划五槽和单视频生产分别通过，缺整合证据。
3. Z全外部首周五发布目标与共享素材提前完成/24h约束逐卡执行，应证明卡片执行服务而非fixture完成状态。当前M1连续测试仅一条视频。
4. 把异常矩阵串到同一原任务：人工上传逾期、返工child、未知发布、未知私信、跨周观察；检查taskId/runId/attemptId不重复。
5. 本地HTTP鉴权与真实durable绑定的卡片导航验收；预览中的task卡和来源比例展示不能替代真实scope下的点击执行。

本审计不修改运行实现、不执行付费调用、外部发送或部署。上述缺口属于本地可继续开展的验证，不应被生产凭据缺失掩盖。
