# 周 Agent 主副链路逐项执行核验

核验日期：2026-10-09。对象：PRD 第 3、4 节的 Z（B2B 零基础）、H（B2B 有基础）各 8 主环节、9 副链路，共 34 项。本文是代码静态审计，不代表真实租户视觉验收、供应商执行或生产部署完成；未触发扫描、发送、激活、重试或付费制作，也未重复运行已有测试。

## 判定口径与共用证据

- **已有真实任务闭环**：持久身份、真实输入、独立执行/人工命令、日历投影、实际入口和完成凭据同时存在。存在闭环仍需遵守权限、窗口和外部服务条件。
- **部分接通**：有真实服务/任务，但 PRD 某一交付或恢复命令未形成闭环。
- **仅缺口提示**：已有错误或配置面板不能当作独立任务已派发或已完成。
- Z/H 标签是已有真实任务的说明，不会自动生成 17 条任务。`weeklyExecutionCalendarPresentation.ts:7-18` 映射 M1–M6/M8 与部分 S 标签；M7 使用实际客服运行和销售交接投影。条件占位 `rework` 不等于已触发局部返工。

共同路径：`social_weekly_execution_tasks`（`server/socialPrograms/executionTasks.ts:36`），真实阶段工厂（同文件 `:258-403`）；`projectExecutionCalendar`（`src/components/socialProgram/weeklyExecutionCalendar.ts:7-57`）保留后台状态、身份与结果引用。实际矩阵挂点为 `src/components/smartBusiness/ConnectedAgentCalendar.tsx:141-152`，并非未渲染的 Workbench。普通生产卡进入真实内容任务，规划、复盘、模板卡分别使用严谨范围导航；没有生产身份不会伪造跳转。

## 八个主环节：两画像逐项核验

| PRD 项 | 真实触发/冻结数据与持久任务 | 日历与点击入口 | 完成凭据、边界与尚缺 |
|---|---|---|---|
| Z-M1 建立经营基础与对标需求 | 当前周包 objective、账号、产品/经营输入；`business_outline`。经营规划另存 `social_weekly_agent_planning`（`planningAuthority.ts:26`）。 | M1 真实规划卡 → WeeklyAgentPlanningPanel；来源配额/事实/承接补齐在实际 Controls（`AgentOperatingControls.tsx:31-48`）。 | 经营初排真实引用；配置就绪不能凭初排推断。独立配置补齐任务尚缺，见 Z-S2。 |
| H-M1 审计基线与经营目标 | 同一真实初排任务，但冻结 H 来源配额及历史需求；账号存在不证明历史就绪。 | H-M1 规划入口与明确 40/60、20/80 配额修订面板。 | 原配额保留；历史诊断由 M2 证据提供，M1 卡本身不证明审计全部完成。老客分层另走真实客服运行。 |
| Z-M2 外部参考采集与精确分析 | `benchmark_collection`、`benchmark_scoring`、`director_analysis`，冻结参考/immutable handoff；Z 仅外部。工厂 `executionTasks.ts:266-280`，来源读取 `planningAuthority.ts:189-208`。 | M2 三类真实任务 → 本周实际冻结参考/分析面板。 | 实际 discovery/account/handoff 引用及逐条分析；缺参考保留 directorGaps，不假造结果。采集/评分交付与编导分析并非三个可以任意完成的文本按钮。 |
| H-M2 双来源分析与调性提取 | H 槽位逐条 owned/external；owned 需真实播放赞转评和 handoff 调性证据；未观测不填零。 | H-M2 同入口显示每槽位分析、来源、缺口。 | 逐条保留合格结果和未结缺口；部分集合可以继续，不能改成全外。真实历史证据不足仍阻塞对应 owned 槽位。 |
| Z-M3 首周详细排期与派单 | `business_schedule`，冻结详细排期、用户确认、dispatch；`executionTasks.ts:306`；partial coverage 在共享合同 `socialProgram.ts:292-330`。 | M3 → 多选真实槽位，明确合并/确认/派单三个命令（`WeeklyAgentPlanningPanel.tsx:20-57`）。 | 同一 selectedSlotIds、确认人/时间与 dispatch ref；未知结果只读恢复。选定部分完成不代表整周目标兑现。 |
| H-M3 双来源排期与派单 | 同 M3，但保留原 source policy、selected/pending 槽位，自有和外部不互换。 | H-M3 同真实 partial 入口。 | `weeklyPlanningSubset.ts:2-3` 校同集合；其他路线缺口不阻止就绪独立条目。partial 已派单版本冻结，补齐需明确修订。 |
| Z-M4 企业化脚本与执行方案 | 母内容 `script/storyboard`、每发布版本 `material_readiness`（`executionTasks.ts:292-324`），冻结素材分类、需求映射。 | M4 普通卡 → 实际内容任务；真人素材卡 → 同页真实素材任务。 | locked baseline/director plan 和实际素材核验；`socialWeeklyProductionAdapter.ts:238-248` 等真实引用。unknown 不可凭手工“AI”标签绕过，事实缺口转人工配置/重分析。 |
| H-M4 双路线脚本与执行复核 | 同真实步骤，母版继承对应 owned/external、历史调性及创新边界。 | H-M4 显示实际主题和来源，不借其他发布/版本标题（`weeklyExecutionCalendarPresentation.ts:14-20`）。 | 冻结编导证据、逐镜材料合同；历史可分析不等于原片可用。无独立“历史调性审核卡”，验收依赖真实生产审核证据。 |
| Z-M5 首批复刻制作与验收 | `asset_generation/video_generation/quality_check/rework/user_approval`（`executionTasks.ts:330-350`）；真实内容任务及 artifact。 | M5 → 实际内容生产对象；人工验收单独确认。 | 实际完成渲染、技术/创意审核和 `user_content_approval`；没有有效媒体字节/来源不通过。占位 rework 尚非局部返工命令，见 S3。 |
| H-M5 迭代/探索制作与验收 | 同 M5，但真实 dispatch 主题、路线与历史调性边界冻住。 | H-M5 实际平台/账号/视频主题卡，状态不由标题推断。 | 同真实产物验收。两路线存在输入差异，尚无独立“自有调性偏差/探索失败”返工任务合同。 |
| Z-M6 首批发布与建立基线 | `publishing`；`social_publication_assignments/attempts`（`weeklyLineage.ts:26-27`）；发布前真实承接检查。 | M6 发布卡保留 production identity；账号/承接实际配置入口可操作。 | 仅 actual attempt 的 provider receipt、platform post、resolvedAt 可完成（`socialWeeklyPublicationAdapter.ts:122`）。计划数量、批准不算发布成功。首次基线观察见 S5。 |
| H-M6 发布与历史关联 | 同真实发布，保留原版本/来源；已验收库存和 continuation 不当新增制作。 | H-M6 卡与已核验原版本说明；不伪造新成片。 | 实际回执/原产物引用；来源不能作为客户归因事实。未知回执先 reconcile，见 S4。 |
| Z-M7 新询盘承接与知识补充 | 明确绑定 `social_weekly_customer_bindings`，实际分群/草稿/审批/发送任务：`customer_segmentation/customer_followup_draft/customer_followup_approval/customer_followup_dispatch`（`socialWeeklyCustomerBridge.ts:12-19`）。 | 实际客服卡投影 `weeklyCustomerCalendarProjection.ts:6-9`；真实 RunBinding/客服运行，不跳假 alias。 | 真实 segment/member、逐客草稿、approval 内容版本/hash、send receipt；new 需真实窗口内 buyer msg + 关系证据。真实无客群才 no_data；unknown 不能当无数据完成（bridge `:115-119`）。企业知识缺口回流不等于已形成独立补知识任务。 |
| H-M7 老客推进＋新询盘承接 | 冻结真实 relationship evidence，prior conversation 仅证明往来，不能证明采购；旧客不依赖本周发布。另实际 sales handoff。 | 真实关系确认/显式重新分群、客服卡、sales 领取/反馈卡。 | 发前复核关系/当前分群；销售有实际 owner、deadline 和会话反馈。新老来源不能用建档日期推断。通用转人工/发送异常尚未全闭环，见 H-S7。 |
| Z-M8 冷启动复盘与下周建议 | `weekly_review`；`social_weekly_review_snapshots`，真实观察窗口/metric refs。 | M8 → 只读 WeeklyReviewEvidencePanel，实际矩阵 `ConnectedAgentCalendar.tsx:151`。 | frozen_by、source_digest、真实周版本/window；缺指标保留 unknown，未到窗口等待（`weeklyReviewEvidence.ts:19-23`）。真实客户问题候选另有下一周明确引用，不自动派生产。 |
| H-M8 双来源复盘与配额调整 | 同真实报告，按 owned/external 与平台/窗口区分；历史基线只用真实证据。 | H-M8 同实际报告，来源配额修订和问题转选题是独立明确操作。 | 真实冻结报告及候选/确认引用，不凭播放高宣称获客强。完整销售质量归因只限可验证关联，未知保留未知。 |

## 九个副链路：两画像逐项核验

| PRD 项 | 实际触发与任务持久化 | 投影与真实入口 | 完成凭据、尚缺 |
|---|---|---|---|
| Z-S1 首批真人拍摄/上传 | 不可替代真实证据/指定镜头缺失；显式建 `social_weekly_material_requests`（`weeklyMaterialRequests.ts:17`），真实 assignee/reviewer、上传与核验截止、consumer。 | 上传/核验两个真实日历动作 → 精确 request panel。 | 文件版本/hash，逐 consumer facts/rights/visual 决定；提交只 pending_verification（`:145-162`）。上传逾期标红，核验延迟独立。已接通，不自动造真人/期限。 |
| H-S1 历史素材补齐/增量拍摄 | 同真实 request；可复用已核验资产，新增版本消费者必须重审（`:192-197`）。 | H 素材卡与原 request 身份；冻结新版本 binding。 | 保留原文件而不假继承新镜头核验。历史素材先盘点的自动差异化推荐仍有限，不能声称人人必须拍工厂。 |
| Z-S2 首次配置/事实/权利/预算补齐 | admission 的实际 code、directorGaps；另 `social_weekly_reception_bindings/checks`、`social_weekly_material_evidence_configurations`。 | 主任务 reason/S2 标签；真实 Controls 配置面板存在（`:34-48`）。 | **部分接通：无统一独立“配置补齐请求”身份、指定人、截止、消费任务映射及闭环完成卡。** 真检查通过只证明某 admission 条件；不等于 S2 整项已派发/完成。 |
| H-S2 历史证据/授权/事实/预算补齐 | 同上，另 owned 诊断缺口/原配额；不会自变全部 external。 | gaps、来源配额、真实历史/事实配置；仅对应父任务 blocker。 | **缺独立补证据任务图**。当前预算/授权/历史指标缺口不统一成为有期限的人工卡；逐条来源已可 partial，但 pending 不会自动转补齐任务。 |
| Z-S3 企业化审核与局部返工 | 工厂总有 `rework` conditional 占位（`executionTasks.ts:343-346`）；生产 adapter 只检查 actual artifact 审核通过（`:251-262`）。 | 普通 M5 rework 卡可打开内容对象，未标 S3 防假触发。 | **缺真实局部返工闭环**：且其依赖 quality_check 通过；质检失败不会自然解锁该占位。没有从审核 failure/changes_requested 冻结 affectedSceneIds+修改意见→独立新返工请求/命令→实际镜头执行/新产物→复验。`routeProductionReturn` 只有纯路由工具（`socialContentLineage.ts:184-197`），未发现生产调用；不能当已执行。 |
| H-S3 调性偏差/探索失败局部返工 | 同占位；现 artifact 技术/创意 review 无独立 owned tone deviation/external exploration failure 返工需求。 | 同 M5 普通入口，没有假造九副链卡。 | 同 S3 缺口；还需保留历史规范/探索目标与具体返工镜头，不应整条废弃探索路线或整片重付费。 |
| Z-S4 首发失败/未知回执 | 原 assignment/attempt status unknown/in_flight/failed。 | publishing 真实卡标错误/对账，adapter 原 attempt reconcile（`socialWeeklyPublicationAdapter.ts:79-94`）。 | 实际平台查询/回执，未确认失败不重发。**部分接通**：自动安全对账有，独立“人工发布补救”指定责任/截止卡与显式安全重试命令仍不统一。 |
| H-S4 双路线发布失败/对账 | 同实际单账号/单发布版本 attempt，不全周重试。 | 对应 H-M6 卡；就绪独立条目可继续。 | 同回执闭环；没有独立 S4 task type，也不能把 generic unblock 当平台可重试证明。 |
| Z-S5 首批数据观察 | `performance_monitoring`，真实 `social_metric_snapshots`，仅真实发布身份/窗口。 | 真实 S5/M8 卡 → 只读指标面板。 | actual metric refs；真零与未观测分开，不伪造历史增幅（publication adapter `:43-54` / review evidence `:19`）。进一步执行核查发现旧 adapter/validator 仅按账号和本周采样时间筛选，可误用历史视频本周采样；真实本周发布身份映射及完整分页正在修正，不能据此宣称观察闭环已全部通过。 |
| H-S5 历史与双来源数据比较 | 同 monitoring +冻结周报告历史/来源分组。 | H-S5 已有任务，不额外复制同一观察工作。 | 按 actual 平台/窗口/来源，质量与获客证据不足保留未知。不能把“有对比报告”当因果效果验证。 |
| Z-S6 从外部复刻到自有模板候选 | 每 publication 的 `template_extraction` directing / `template_performance_validation` review（`executionTasks.ts:388-403`）；实际成片、同周复盘、明确 selected candidate。 | 真 S6 卡 → WeeklyContentTemplatesPanel；scope/source/review/extraction dependency 严格导航（`templateCalendarNavigation.ts:8-10`）。 | 候选、确认、`social_weekly_content_template_execution_selections` 明确持久引用（`weeklyContentTemplates.ts:44-47`）；显式“用于当前模板任务”“核验凭据并继续”命令。不是外部爆款参考入库即自有模板；未确认不核验通过。 |
| H-S6 模板保留/修订/新增 | 同真实任务；保留/修订需原模板确认与真实结构/表现依据。 | 实际 taskId 缩窄候选来源，严禁 latest 猜（`WeeklyContentTemplatesPanel.tsx:16-58`）。 | 原 version/hash、确认人/时间、future binding+明确新周修订；不会改变母版参考来源配额。当前真实 S6 已接，不能将“模板数量”算视频交付数。 |
| Z-S7 首批客户转人工/发送异常 | `social_weekly_sales_handoffs/events`（`socialWeeklySalesHandoff.ts:10-11`），真实批准批次+msg_in、明确销售 owner/领取/反馈期限。 | 真 sales 领取/反馈/补资料卡（`weeklySalesCalendarProjection.ts:7-8`）→ 精确 SalesPanel（Connected `:141,149`）。 | owner claim 与真实 post-claim msg_in/msg_out_human 反馈（service `:61-68`）。**仅销售交接闭环**：知识缺口、报价承诺、供应商未知发送/部分发送未统一生成真人接待/异常处置任务，不能声称全 S7 完成。 |
| H-S7 既有客户/新询盘转人工 | 同 sales，真实 relationship/new-old 冻结，保留历史上下文。 | 同日历人工卡，旧周身份去重延续；销售反馈已接真实领取后会话选择器。 | 真实批准资料、处理证据/下一步。只读会话接口经原经营计划、交接版本、实际领取人和关系证据核验；反馈写入口同样核验真实 provider 消息和时间，不能由直接 POST 绕过。通用客服异常→指定人→知识沉淀→恢复对应逐客任务仍缺闭环。 |
| Z-S8 冷启动计划修订 | 显式 recovery/capacity proposal，`social_weekly_schedule_proposals/snapshots`（`weeklyScheduleSnapshots.ts:7`）；受信修订下一版本。 | Controls 真实 RecoveryPanel +显式确认；新任务 frozen schedule ref 才 S8。 | 真实 capacity inputs/leases、immutable新版本、用户确认、原Z全部外部。不是改卡片时间；旧 running/succeeded资源要真实封口/continuation证据，不能自动 activate。 |
| H-S8 双来源计划修订 | 同受信方案，冻结 source policy/inputs/hash，旧/外来源不互换。 | H-S8 实际重排/来源修订界面。 | 同明确新版本与确认；预算、产能假设必须真实填写/证据。副链标识只说明该卡读冻结重排，不等于整周修订所有流程已完成。 |
| Z-S9 跨周延续与画像升级建议 | `social_weekly_execution_continuations`（`weeklyExecutionContinuations.ts:10`），明确原task/version/inputhash，真实生产 observer。 | 已核验 continuation 才输出原 vN，不复制付费；材料/销售在当周轴保留原身份。 | 原产物/真实live resource/封口与唯一性。**部分接通**：同package跨版本衔接已有，标签刻意写“已核验原版本任务衔接”；不能因此宣称跨周自动库存编排或自动画像升级。 |
| H-S9 跨周库存/未结任务衔接 | 同真实 continuation，保持老素材/模板version；未成熟观察不重新制作。 | 实际原任务身份日历说明，旧销售deadline落入当前周轴。 | 同证据；跨不同package/跨周发布库存消费的统一显式任务/归因尚需逐路径核验，不能用 sourceVersion<currentVersion 冒充跨周。 |

## 下一明确开发点（建议按顺序）

1. **先补 S2 独立配置/证据请求图。** 从实际 admission/directory gap 建不可变 requirement identity，绑定 tenant/program/pkg/version/publication/consumer/缺口证据/hash；人工明确 owner、补齐截止和核验截止。提交后仍待验证，由原真实 port/handoff/授权/预算证据复查；通过才逐 consumer resume。覆盖历史诊断、事实/权利、承接、账号授权、预算，但不能把用户文本或“配置已提交”当可用性。未知结果只读恢复。现面板足够提供表单入口，欠缺的是持久任务/截止/核销合同。
2. **S3 真局部返工。** 将 actual failed review / changes_requested 转为明确 scene repair request（原artifact/version、affectedSceneIds、修改意见、原因/路线、预算、人审），执行现有真实scene服务后产生新artifact并重新技术/创意审查。旧 conditional rework占位不能自动算“无需返工已完成”，也不能先付费整片重做。
3. **S7 统一客服异常与人工处理。** 保留已完成销售交接；另建知识/报价/未知发送任务，引用原member/batch/send request identity，显式真人领取与会话证据；未知发送先对账，禁止重发。处理结果回到企业知识需要独立事实审查/版本，不凭自由反馈文本更新权威知识。

本审计结论：真实主链与多数必要接口已有，**34 项不能一概宣称全部实现**。S2 缺独立任务图、S3 缺真实局部返工执行、S7 仅销售交接子集完整；S4 和 S9 存在可工作的真实部分，但仍有范围边界。已有 S6 和 partial source UI 不改变这些缺口。

## 关键代码定位索引

以下链接用于直接查看代码，不是额外完成证明。

- [任务工厂与 conditional rework](../server/socialPrograms/executionTasks.ts#L343)
- [真实生产验收与返工节点读证据](../server/runtime/socialWeeklyProductionAdapter.ts#L251)
- [仅纯函数的局部返工路由](../server/starter198/socialContentLineage.ts#L184)
- [S2 当前仅映射错误标签](../src/components/socialProgram/weeklyExecutionCalendarPresentation.ts#L18)
- [真实配置工作区](../src/components/socialProgram/AgentOperatingControls.tsx#L34)
- [真实销售领取与证据反馈](../server/runtime/socialWeeklySalesHandoff.ts#L61)
- [真实销售卡片投影](../src/components/socialProgram/weeklySalesCalendarProjection.ts#L7)
- [实际矩阵挂点与导航](../src/components/smartBusiness/ConnectedAgentCalendar.tsx#L141)
- [partial 规划明确操作](../src/components/socialProgram/WeeklyAgentPlanningPanel.tsx#L20)
- [S6 明确选择、核验与逐任务恢复](../server/socialPrograms/weeklyContentTemplates.ts#L44)

### 审计后本轮 S2 增量（限定范围）

新增 `weeklySupplementRequests.ts` 与 `social_weekly_supplement_requests/events`：覆盖真实发布承接、逐镜证据分类及账号发布授权三类，actual consumer/input hash、真实原阻塞 code/复查来源 hash、指定真人、提交/核验双截止、明确 typedref、fresh 原模块检查，版本事件核销。相同完整意图幂等恢复同一任务；提交不算验收，verified 也不自动解锁。消费者执行前还必须 freshConsumerCheck，历史通过不能遮盖 provider/来源漂移。真实矩阵挂独立补齐面板与双动作卡。

账号授权补齐复用 `weeklyAccountAuthorizationSupplement.ts`：精确租户/账号/平台、已连接、可真实解密的凭据及当前 `provider_probe` 权限证据，缺失、过期、撤销、未知或重复证据均不能验收；提交 `publishing_account_identity` 只进入待核验，指定核验人复查后还需明确恢复原消费者，仅清原授权缺口，不修改其他阻塞、经营周包或 Z/H 来源配额。此路径不发布视频、不自动探测网络、不以配置状态或 token 字符串判授权通过。

这不补齐所有 S2 类型：预算、历史诊断和其他事实/权利缺口仍保留原阻塞。冻结输入或来源版本改变必须明确新周修订/新消费者与新补齐请求，不拿新引用核销旧请求；当前没有自动 transfer/关闭旧请求命令。上述 34 项审计表中的 S2 缺口已由“全无独立请求”缩小为“三个可信类型已有请求图，其余缺口仍未形成任务闭环”。

### 审计后本轮 S7 会话证据增量

销售反馈已用 `SalesConversationEvidenceSelector` 替代手填 interaction ID：指定 owner 明确领取后，只读选择当前原周交接版本、同客户、领取后真实 provider 的 msg_in / msg_out_human。接口先后复核实际 sales.get 的权限、关系证据、交接版本，完整分页并提供原记录 hash；没有供应商消息身份、未来时间、AI 出站、mock/synthetic 记录不作为反馈凭据。实际反馈 POST 同样执行此校验，不能绕过选择器直接提交伪记录。没有自动领取、发送或完成。

该增量改善已有销售交接证据体验，**仍不代表通用知识缺口/报价承诺/发送异常均已生成转人工任务**；这些 S7 子类型仍需独立真实任务与知识审查/恢复合同。

### 最新本地预览检查（2026-10-10）

通过安装的 Chrome 无头浏览器实际打开 `/smart-business-preview?view=matrix&scheduleView=board`：页面运行错误为零、异常兜底未出现，横向周一至周日分别显示 6/8/6/7/7/6/5 个任务卡按钮，没有 Agent 纵轴。点击“查看完整进度”后实际进入进度页面，未出现 `undefined` 或 `NaN`。缺失工期现在显示“工期待核验”，未完成节点不能因未知工期被显示为“已完成”；缺失负责人显示“待分配”。

该页面明确使用隔离的预览数据，以上检查只证明当前前端渲染和导航，不证明真实周包、供应商生产、付费执行或三渠道发信成功。Chrome 原生控制入口本次初始化失败，未将无头检查描述成用户前台验收。前述历史 34 项静态审计应结合后续库存、跨周素材、画像升级与客服补齐文档读取，不能把历史缺口或已修条目重复当作当前端到端证明。

### H-S2 自有历史视频指标补齐与原消费者恢复

补证据任务已扩展为 `owned_reference_metrics`：实际经营周/原编导槽位/原自有视频/原账号保持不变，提交人选择真实已入库的平台指标快照，核验人复查播放、赞、转、评四项；真实零值允许，未知、人工自由输入、跨账号/平台/视频或来源漂移不通过。提交与核验的双截止受原消费者实际 `latestStartAt` 限制；只有预计开始时间不足以承诺期限。

恢复时仅重新分析原槽位，原自有参考及冻结分镜凭据保留；不会把第二条视频换成第一条、调整 40/60 或 20/80 配额、自动确认/派单整周。规范 TikTok 渠道映射使用现有枚举规范化，不能将抖音证据当 TikTok 证据。恢复后前端读取实际周包的新编导分析及原任务状态，仍须明确合并、确认与派单。30 项组合测试及新增双截止负测通过，证据属于服务/HTTP/前端合同夹具，未执行真实平台采集或真人租户验收。

### 当前新增长链路的验证边界

下一周画像确认已增加新周目标、数量、日期时间与地区时区配置入口，使用目标周的新服务端规划快照；未知创建结果和页面重载只读查回原请求。逐镜人工验收已挂实际三栏生产页并接入真实 G4/返工/库存消费验证，硬检测失败不能人工勾选覆盖。G4 后独立 G5 编导整片审核服务与前端正在接入，实际服务及全链路集成验收尚未完成，整片质量任务缺少可信审核时继续保留真实阻塞；不以逐镜通过代替 G5 或最终审批。运行中资源承诺、完整供应商视频生产及三渠道客户发送仍未取得端到端完成证据。34 项目标不能依据这些局部绿色检查整体标记完成。


### 生产审核与返工血缘衔接增量（2026-10-10）

周任务执行器的 `quality_check` / `rework` 在不可变审核摘要尚未通过时，读取同一产物、版本及实际文件的独立 G4/G5 审核证据；缺少证据保持阻塞，不重启付费生产，也不替代最终用户审批。生产执行器、结果核销及质量门顺序基线联合 30 项测试通过，尚不证明新 G5 服务的真实模型执行。

每次局部返工已有独立 `productionResultId`，新实体现在使用合法初始版本 1，返工 operation、原产物及执行 run 继续保留在原有来源证据中。血缘建立拒绝非正整数生产版本，避免将旧 `rework:operation` 转成 NaN / null。周生产血缘版本增加实际产物身份，两个不同的版本 1 产物不会冲突；同产物重放不重复写入。实际血缘持久化及返工输出联合 13 项测试通过；未修改历史产物、旧审核结论或旧血缘记录，也未据此声称返工成片已真实发布。

G6 商业发布预检目前有合同及质量门读取，但真实发布适配器尚未写入独立 G6 回执，仍需以实际账号授权、媒体规格、承接入口、销售负责人及本周授权形成证据。真实租户浏览器当前停留登录页；隔离预览及 HTTP 夹具不能代替已登录租户的生产验收。


### 原生产血缘重放复核

实际已有 `productionResultId` 的血缘现在先核验记录完整性，再比较当前经营目标、周包、发布项、参考选择、企业事实和编导交接引用。相同身份重放保留原记录；目标版本或交接来源漂移时明确拒绝，不凭“旧血缘存在”继续执行，也不覆盖历史记录。生产执行器、返工输出和血缘实际持久化联合 33 项测试通过（包含两个版本 1 产物、原身份重放和经营目标漂移负测）。这些测试仍不包含真实供应商生成、发布或客户发送。


### G5 审核、恢复与最终审批的本地证据

独立 G5 服务已接真实成片文件的 SHA 校验和逐镜实际抽帧、冻结脚本/调性/事实/CTA要求。Agent 审核须有明确的模型、费用及本视频制作预算用途授权，实际执行仍使用现有标准工作流权限及费用账本；人工备选使用独立真人编导身份，不能伪装为 Agent。未知响应、未知 usage/缓存价格或超额费用不生成通过回执，真实原响应在后续校验和结算前持久保存。页面仅按服务端确认的原响应恢复标志显示恢复按钮，恢复使用原 request，不再次调用模型。

新执行在真实任务暂停/取消、周包撤回/新版取代/冻结、实际 weekly binding 丢失授权时拒绝；已返回的原模型响应保留，可对账真实支出和原审核结论。历史有效审核与当前新执行许可分开处理。

本地验证：G5 服务/生命周期联合 20 项通过；前端/API/实际 HTTP 联合 18 项通过；质量消费者、实际最终审批及安全成片转换组合 19 项通过。最后类型修复后，相关消费者与面板 4 项回归、全量 TypeScript 检查和 Vite 构建均成功（构建保留原大块体积提示）。这些验证使用实际持久化服务、owned MP4 和受控模型端口，真实付费模型调用、供应商生产、发布及客户发送均为零。

尚未证明完整生产 adapter 的默认权威持久化正向及 false 审核摘要库存的实际 assignment 闭环；G6 五项商业发布预检仍只有真实端口审计，尚无独立 writer/可信回执闭环。完整供应商视频端到端、运行中资源承诺及已登录真实租户界面验收仍未完成。上述局部通过不等于 Z/H 两套全部任务已接通生产环境。
### G6 新发布门禁（2026-10-10，本地）

新发布现在必须核验同一租户、program、周包版本、publicationTask、账号、真实产物和视频 SHA 的 G6 review 与持久化 receipt。客户端五个 passed 或缺失 receipt 不放行；发布包的 `artifactId:publicationTaskId`、operatingLineage、成片哈希及视频字节 SHA 同时校验。既有 unknown / in_flight attempt 继续只查询原回执，不能补发。

权限 probe 绑定原生账号身份和密文凭据指纹，返回后复读真实账号；凭据中途变化不生成可用证明。相同 scope 更新原唯一行，唯一索引冲突只重读同 scope。没有指纹的旧证明在 G6 中仍待核验。实际 owned bytes 用 FFmpeg 全解码提取媒体信息，不以模板参数替代成片数据。跨周库存按真实绑定读取旧周源成片。

27 项质量恢复、权限证明及真实 G6 受阻 HTTP 联调通过，类型检查与构建通过。另 8 项发布回归证明：没有 G6 时新发布为 0 次 POST，真实历史 unknown/in-flight 原请求继续只对账。G6 五项通过后的实际新发布、库存正向端到端仍待验证；没有向外部平台发布。

平台格式规则须分别核验。YouTube 官方证据：[支持格式](https://support.google.com/youtube/troubleshooter/2888402?hl=en)、[账号时长限制](https://support.google.com/youtube/answer/71673?hl=en)、[API 上传约束](https://developers.google.com/youtube/v3/docs/videos/insert)。这些证据用于后续规则补充，不表示所有平台已经完成。Meta 官方 reference 本次无法读取，未以第三方描述替代正式规则。
### G6 到默认发布执行的正向证据（2026-10-10，本地追加）

`weeklyPublicationG6Admission.integration.test.ts` 已使用真实本地合规 MP4、同源 G4/G5、真实平台权限 probe 记录和承接绑定，完成 G6 预检 → 默认生产适配器持久化血缘 → 最终人工审批 → 默认发布包扫描 → 实际 assignment/package → 当前发布适配器受控供应商执行。只有 provider 的边界响应受控，未注入假的审核、血缘或放行开关。默认承接端口改为从同一 DataStore 读取已确认企业事实、确认人员及渠道权限，不再混入全局数据读取。

原预检的 assignment 为 null，真实同输出派单生成后 sourceHash 保持一致；实际事实漂移仍拒绝。首次受控发布 1 次，重复执行增加 0 次。原成片技术和创意摘要 false 保留，审批及独立审核凭据各自持久化。这证明本地执行链和供应商接口接线，不证明外部平台真实发布或已部署生产。

库存 CTA 核对实际冻结编导交接中的原成片 CTA、目标发布 CTA 和承接绑定 CTA；缺失或改写时保留待核验，不把新目标文字当作旧成片已修改。跨周库存已通过真实绑定、确认修订激活、新周 G6、独立人工审批、实际唯一派单和发布包及再次 G6 核验。源任务和成片各 1 条，没有新增制作任务，没有外部发布；错误源成片、G5 证据损坏和事实漂移均拒绝。库存工作区已接入目标 G6：明确读取当前真实绑定及来源缓存后打开原成片对应的新周预检，不猜来源 run，不自动检查或审批。新增权限指纹字段使用 2047 前向迁移；已上传的 2045/2046 与 HEAD 字节及校验和一致，没有执行迁移。

YouTube 格式检查已独立实现，并通过真实小尺寸、低帧率 MP4 测试；不继承 TikTok 的尺寸和帧率要求。依据：[支持格式](https://support.google.com/youtube/troubleshooter/2888402?hl=en)、[时长限制](https://support.google.com/youtube/answer/71673?hl=en)、[API 上传约束](https://developers.google.com/youtube/v3/docs/videos/insert)。账号长视频权限未核验时继续显示 unknown，未实现 Meta 格式规则的部分仍保留缺口。
### 并发回执与库存前端核验（2026-10-10）

发布回调及状态查询的结果写入通过原 assignment 的短持久租约串行核验，写入前重读唯一实际 attempt。已确认 published 不被迟到 unknown 覆盖，failed 不被 unknown 降级；租约仅用于持久化阶段，不包含供应商网络调用。两项真实受控供应商竞态测试验证首次提交 1 次、其余原状态查询新增提交 0 次、attempt 唯一。

库存入口以当前真实绑定、成片哈希及实际缓存来源 run 为依据；错租户、任务、成片哈希、版本、未生效绑定及缺缓存均拒绝。13 项库存、完整发布及并发回执组合测试、全量类型检查和构建通过。这些本地测试不替代真实供应商执行、登录租户视觉验收或生产部署。
### 旧发布扫描器边界（2026-10-10）

旧扫描器读取实际正式任务图、经营包标记及生产血缘。正式 consumer 缺失、任务行与 payload 作用域不一致时不回退新发布；正常正式任务由其现有租约消费者执行。已有 unknown / in_flight attempt 在确认唯一实际身份后仅进入原状态查询，不计算新提交配额，也不调用 publish。真实 G6、最终审批、派单夹具验证缺失/损坏任务为 0 次 POST；原 accepted 回执转换为 unknown 后仍只查询并核销同一 attempt。旧 worker 的测试存储已实现真实 lease 删除，未取消或放宽生产租约。该集成与旧 worker 回归通过，正式边界版本类型检查通过。

### 内容生产周包身份复核（2026-10-10，本地）

实际内容生产 adapter 在读取唯一周包后，核对 payload 的 programId、packageId、version 与当前正式任务一致，且查询总数与返回唯一行一致。损坏或错绑定的周包不会进入规划读取、内容创建或付费启动。三个身份字段漂移负测均为 0 次创建、0 次启动；内容生产 adapter 21 项测试通过，真实 owned 成片 G6 → 默认血缘持久化 → 人工审批 → 发布包 → 受控发布正向回归 1 项通过。本轮改动尚未上传，也未调用真实付费供应商或部署生产。

### 下游生产截止与发布时刻分开（2026-10-10，本地）

实际新建内容任务、权威周生产工作流和编导经营上下文不再把发布时间或周结束日当作成片截止：三处均使用精确发布时间减去 24 小时的准备截止，与现有前置倒排原则一致。周一发布对应上周日；模糊窗口或非法时间保持 null，不伪造周末截止。发布时间字段仍保留真实发布时间，任务图中的更早素材、质检和人工审批截止仍各自生效。生产、截止规则、工作流及真实成片发布链联合 28 项回归通过。尚需真实任务工作台验收及供应商执行证明，不能据此承诺全部产能可达。

### 本轮补充：客服任务真实客户定位

指定 Messenger / Instagram 原跟进条目及异常任务入口已补实际服务端身份核验、原批次工作区和客户/账号定位；WhatsApp 既有成员路径核对原冻结手机号，不捏造缺失的账号授权。9 项受控真实 HTTP、前端解析与范围拒绝验证通过。外发与付费生产执行均为 0，未部署、推送、迁移或宣称 Chrome 视觉验收。完整范围、文件与证据见 [客服周任务真实客户定位核验](客服周任务真实客户定位核验.md)。

### 三渠道客服卡片的原客户定位（2026-10-10，本地）

客服派单与发送恢复卡使用原 run/task/item，鉴权只读接口核验实际批次、客群成员、客户与渠道；Messenger/Instagram 还核验冻结渠道选择及账号/会话身份。客户端不信任 URL 客户 ID，改用已核验的绑定选择客户并聚焦原批次条目；历史批次只读，身份变化或迟到回包不选择旧客户。真实存储 → HTTP → 客户端解析 → 原条目工作区及身份负测共 9 项通过。详见 [客服周任务真实客户定位核验](客服周任务真实客户定位核验.md)。本地验证没有对外发送，不替代已登录真实租户的 Chrome 视觉验收。

### 实际三维资源占用观测（2026-10-10，本地）

资源只读接口现在分别读取实际 tenant/account/task_type 持久限额和运行作业、持久租约；准确键优先于通配配置，依据与现有 durableQueue 的三个独立门禁一致。全量分页后再次复读，观测期间作业/租约/配置变化拒绝混合快照；缺失、过期或不一致租约使可用空位为 null，不以 0 或假空闲掩盖未知。实际 GET → 客户端严格解析 → 面板已显示三个独立池的上限、已核验占用、待核验占用和当次空位。10 项真实存储及接口/面板组合验证通过，覆盖 111 条作业分页和作用域/漂移负测。

快照空位不是未来资源预留。可信 ETA、全剩余操作及费用仍未知，主排期 resourceKey 仍 null，reservationEligible 仍 false；三维资源向量尚未接入未来预留求解器。本轮最终全量 TypeScript 检查与 Vite 构建通过（保留现有大块体积提示）。这些修改在此前 f7f6c4d 上传之后产生，尚未推送、部署或对外执行；完整目标仍未完成。

### 权威生产投影的截止与冻结发布项（2026-10-10，本地追加）

直接从已存权威上下文重建生产工作流时，现在统一以冻结发布时刻计算发布前 24 小时的成片截止，不能被旧 brief 的发布当天或周末截止覆盖。编导 brief、经营上下文和执行计划均沿用同一准备截止。相同 publication ID 但不同 CTA、账号、平台或发布时间的传入对象不再通过“只找到同 ID”核验，必须与冻结周包发布项内容一致（生命周期 status 不作为创作输入）。

新增核验揭示 G6 测试准备中单独 publicationTask 已更新而冻结 weeklyPackage 的对应项仍旧；修正夹具的实际准备数据后再通过真实 G4/G5/G6 服务，不移除生产校验或补假回执。生产/血缘/工作流/完整成片发布组合 31 项通过；补充的直接存储投影截止回归共 9 项通过。这里只证明本地实际接线与受控 provider 边界，尚不证明真实供应商生产或生产环境验收。

本轮浏览器视觉核验未完成：对现有 5181 预览 tab 的访问被工具拒绝，原因是管理员安全策略核验不可用（admin-enforced policy could not be verified）。没有通过其他浏览器或截图通道绕过限制。代码/存储/HTTP 证据与实际页面视觉验收继续分别记录。

### 本轮后续补充：三渠道客服转销售

原销售来源仅查 WhatsApp，真实 Messenger / Instagram 已审批成员无法进入销售链。现已补 native 原成员/渠道/账号/消息证据→持久交接→明确销售领取→领取后真实回执会话→反馈的实际分支。既有联系独立为 `existing_contact`，不冒采购证明；不变更 Z/H 配额。原 WA 10 项回归及新 native HTTP、日历组合 16 项通过；无外发/收费/部署推送。详细证据见 [客服周任务真实客户定位核验](客服周任务真实客户定位核验.md)。

### 真实三维资源约束进入修订（2026-10-10，本地）

倒排提案和确认已从同一 DataStore 读取 tenant/account/task_type 三个独立持久限额；未开工生产由服务端冻结的 weekly handler 清单提供排队类型和生产主体身份，已有真实 job 则核对其账号、run、task type 和来源权威。不会把当次 availableSlots 当作未来预留。一个整体生产作业跨多卡以同一主体计算，并保留最早开始至最后结束的连续占用，卡间隙不能借给另一作业。

确认前复读真实配置、占用和任务→生产主体映射；配置或映射哈希变化拒绝旧提案。运行中真实 ETA 和剩余费用仍缺时，对相关池保留未知占用，不从租约到期或客户端估算推断结束。提案仍是用户确认的条件规划，实际 queue 准入继续受真实限额约束。

实际存储、solver、修订、HTTP 与资源面板联合 45 项通过；最后共享池一致性局部回归 7 项通过。未执行迁移、付费调用、发布或部署；尚不证明完整真实生产的周发布目标可达。

### 默认供应商边界的新增反证（2026-10-10）

继续审读发现，受控 provider 正向虽然经过当前周发布适配器和实际 assignment，但没有执行默认 weeklyPublishingAdapter 的最终 source claim。该 claim 仍硬要求原生产技术/创意摘要 true，与独立 G4/G5 审核可通过的不可变 false 成片不兼容。因此此前受控正向不能证明默认供应商适配器已完整接通。正在补默认适配器到末端受控 transport 的真实 owned-file 测试，并以同成片独立审核证据接线；不会把摘要改成 true 或直接跳过校验。

产后 quality_check / rework 也已从生成队列资源预留分开：它们核验原产物和审核，仍保留人工工时、成本、窗口及依赖；已完成作业的生成卡未有结果证据时明确待核销，不启动新作业。实际存储和联合 36 项测试通过。
