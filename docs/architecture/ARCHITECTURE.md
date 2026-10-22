# 当前架构摘要

更新时间：2026-10-23（Asia/Shanghai）

## 边界

- `src/components/socialContent/`：工作台与用户交互；不得自行绕过服务端租户鉴权或供应商成本控制。
- `src/components/ConversionPage.tsx` 与 `src/components/customers/`：页面持有会话状态和三栏视图；客户定位/加载、草稿翻译副作用与渠道发送适配分别落在客户子模块，真实发送仍经过现有服务端出站接口和回执边界。
- `src/components/GlobalAssistant.tsx` 与 `src/components/assistant/`：浮层负责对话、任务入口和请求编排；`AssistantCustomerTodoView.tsx` 仅承载已有客户待办的展示，浮层保留选择客户事件与返回对话回调；`AssistantDecisionDialog.tsx` 承载对话面板之外共用的 Ant 决策详情弹窗，仅接收页面的当前周目标、权威卡和动作回调，关闭/导航焦点栅栏仍由浮层控制；`useAssistantThreadSaveQueue.ts` 负责已限定身份范围内的串行 CAS 保存、冲突合并与退避，浮层仍拥有身份栅栏和生命周期触发；`assistantProductionIntake.ts` 负责明确生产请求识别及从企业中心核验已确认产品，不得仅凭对话文本虚构产品身份；`assistantActionProjection.ts` 负责聚焦卡自然语言动作、后端签名目标与参数、响应卡身份和跨对象动作过滤。页面只调用这些规则，不自行推断业务对象或放行跨对象操作。
- `src/components/InspirationDashboard.tsx` 与 `src/components/inspiration/inspirationFrameMatching.ts`：灵感页负责展示、交互和素材读取，逐镜素材评分、硬条件、可复制性与替代路线由纯匹配模块负责；图片证据面板由 `ImageEvidenceSummaryPanel.tsx` 承载，展示轮播节奏、可复用模块和图层蓝图。`imagePostAnalysisPresentation.ts` 与 `inspirationAnalysisProjection.ts` 投影图文排队、处理中、结果不明的可见状态和禁重提边界。未核验的产品主体或真实性证据不得靠软评分提升为可复用片段。
- `src/components/inspiration/inspirationVideoProjection.ts`：爬虫/发现记录投影为前端视频、元数据兜底、发现评分、来源标签及账号基线推荐；页面保留请求、鉴权、排序编排和展示，旧的页面导出继续转发以兼容消费者。
- `src/components/inspiration/InspirationMedia.tsx`：灵感缩略图、鉴权图片和视频的加载/播放边界；平台卡直接依赖该媒体模块与发现投影，避免反向导入整页。签名 HTTPS 图片直载，受保护媒体经鉴权取回；视频解析有超时、代际失效与一次媒体重试。页面保留旧公开导出以兼容消费者。
- `src/components/studio/studioVoiceoverRules.ts`：工作台的纯口播规则，包括时间码解析、分镜台词抽取、字幕/音效区分、完整时间线覆盖与译文逐句对齐；`AiCreateStudio.tsx` 保留草稿状态、供应商请求和原公开函数转发，不把模型译文在规则校验失败时冒充已覆盖原片。
- `src/components/studio/studioStoryboardMaterialMatching.ts`：分镜素材的画幅偏好、可定位片段证据、视觉语义评分及本地自动分配纯规则。`AiCreateStudio.tsx` 继续拥有任务草稿、素材请求、人工确认及原公开函数转发；时长和宽高比只能影响排序，不能替代片段真实性证据。
- `src/components/inspiration/inspirationAnalysisProjection.ts`：分析文本清洗、精确分析准入、展示资格、粗结构与逐镜摘要构建；当前选中视频由灵感页挂载 `DirectorVideoDetailPanel` 展示。原参考的六段结构、镜头和口播人工复核归 `DirectorReviewWorkspace.tsx`，其登录身份栅栏、显式 ASR 许可和结果不明禁重提交不由页面替代。旧 `ScriptPanel`/`AnalysisPanel` 及其 Seedance 脚本侧栏没有挂载，已清理；不将策略级或不确定文本标成通过的全片证据。
- `src/components/inspiration/inspirationMaterialLibrary.ts`：素材库入口参数、企业通用/产品归属、可见标签与语义、分类徽标、产品/方向/图库筛选；权威媒体比例计算在 `src/lib/materialAspectRatio.ts`，规则模块不反向依赖 React 组件。页面保留素材加载、用户操作和展示，原页面导出继续转发。
- `src/components/EnterprisePage.tsx` 与 `src/components/enterprise/`：页面持有可编辑企业资料和导航；资料默认值/快照、服务端读写校验、FAQ/销售风格控制器及业务视图由企业资料模块负责。保存成功必须以服务端读回和产品身份校验为依据。
- `src/components/DigitalEmployeePage.tsx` 与 `src/components/smartBusiness/WeeklyGoalPanel.tsx`：数字员工页负责新周目标的提交、冲突恢复与运行导航；独立周目标面板持有草稿、预设方案、平台配额重算、视频计划校验和排期确认，不直接调用生产 API。`DigitalEmployeeFormField.tsx` 是页面与周目标面板共用的表单字段样式。
- `src/components/smartBusiness/DigitalEmployeeTodayFocusPanel.tsx`：首页“本周进度/需要你处理”的可达视图，依据真实任务、待审批项与计划状态展示至多三项关注动作。页面继续提供执行导航和状态文案；原页面内受现有合同保护的业务流转图定义未随本批移除。
- `src/lib/studioApi.ts`、`src/lib/socialImageApi.ts`：前端 API 适配层。
- `shared/contracts/`：跨端任务、内容与交付合同；字段变更需检查旧任务兼容性。
- `server/routes/`：HTTP 鉴权、输入规范化、租户上下文和响应编排；业务算法逐步下沉到领域模块。
- `server/digitalEmployees/taskEvidenceProjection.ts`：数字员工任务的执行元数据、依赖与业务引用范围、工作流归属、项目完成/渲染证据的纯规则；路由仅在租户范围内读写记录并调用这些规则，不能用历史草稿或可变引用覆盖托管项目的索引血缘。
- `server/routes/videoCrawlerOpsTaskState.ts`：视频来源爬虫任务的纯状态规则，包括中断恢复、显式重试、耗尽终止和待处理优先级；`videos.ts` 保留原导出并负责持久化、租户可见性与执行编排。
- `server/routes/videoCrawlerNormalization.ts`：视频来源及供应商元数据归一化、Apify 候选窗口等纯规则；`videoCrawlerSourceUrls.ts` 负责规范来源 URL 与平台账号/帖子链接，`apifyTikTokInput.ts` 负责纯 Actor 输入组装；`videos.ts` 保留既有兼容导出。LinkedIn 公司帖的冻结输入、许可范围校验与受控传输在 `linkedinCompanyPostPaidCollection.ts`；内部视频/图文入口缺少受信任许可时仍明确报 `linkedin_company_paid_collection_permit_required`，手工 HTTP 不开放。当前没有生产许可签发器，不能将模拟许可或离线解析视为付费采集已开放；见 [`2026-10-23-linkedin-company-paid-collection.md`](./adr/2026-10-23-linkedin-company-paid-collection.md)。
- `server/routes/studioCoverSvg.ts`：封面图的尺寸、换行、图层和 SVG 文本转义纯渲染；`studio.ts` 保留鉴权、租户限定的帧读取、文件保存和对象存储，不把客户端传入的路径直接交给渲染模块读取。
- `server/routes/studioMaterialAnalysisSegments.ts`：将素材逐镜分析结果投影为片段的纯规则，供云端素材写回和自动生产共用；`studio.ts` 保留原公开导出、供应商选择、租户素材读写及 HTTP 编排。
- `server/routes/studioTtsStyle.ts`：配音风格输入归一化、MiniMax 确定性停顿与发音词典、Qwen/MiniMax/macOS 音色及语言映射纯规则；`studio.ts` 保留语音文件、供应商请求、付费许可与回执编排，不因音色选择绕开现有付费门禁。
- `server/routes/studioLocalTtsAdapters.ts`：Piper、XTTS 与本机 `say` 的可选本地语音执行；从路由显式注入租户目录、样本查找、签名资产 URL 和转码接口。无可用引擎时不触碰租户文件；付费 Qwen/MiniMax/HeyGen 路径仍留在原有许可和回执边界内。
- `server/socialDiscovery/imagePostEvidenceAnalysis.ts`：公开图片下载和现有 Qwen 主分析/Gemini 旧降级。`imagePostMediaPersistence.ts`：图文缩略图与 COS 图片来源持久化。`imagePostImport.ts` 与 `imagePostRefresh.ts`：新增和既有图文先持久化来源及状态。`imagePostReanalysis.ts`：显式重分析先记录尝试，写回时校验同一尝试和来源快照。`imagePostAnalysisQueue.ts`：延迟分析先把输入和来源哈希存入记录，再由后台 worker 在可证明的数据库唯一租约下领取；已开始但未写回的尝试不自动重发。`imagePostLeaseCapability.ts` 只为此路径只读核验远端 PocketBase 租约索引，不放宽其他付费 worker。`videos.ts` 保留 HTTP 鉴权、爬取入口和图片 URL 规范化。上述路径仍未具备统一的逐记录付费批准、供应商原始回执与人工核对流程。
- `server/socialImage/`：图片任务、参考画布、首版策划、图层合成、修订和质量判定。参考图层蓝图在任务创建/更新和合成入口均规范化；蒙版层级不能绕过产品遮挡上限。
- `server/starter198/socialContentProductionExecution.ts`：社媒自动生产 worker 的阶段编排；`socialContentProductionAdmission.ts` 在任何制作前验证周任务授权、冻结路线、复刻证据、已有成品幂等与人物技术栈。素材路线重绑定与动态主持人背景锁由 `socialContentProductionRouting.ts` 负责，`socialContentProductionMaterialPreparation.ts` 在预算认领前读取任务素材、核对已批准本地路线并记录重绑定证据。非渲染代拍清单投影由 `socialContentShootingPlan.ts` 负责，工件创建、重复运行收口与审核完成状态由 `socialContentShootingPlanExecution.ts` 负责；这条路径不进入视频渲染或发布终结器。`socialContentProductionScriptBaseline.ts` 负责已冻结脚本快照校验、兼容重建和原任务持久化；不能在恢复时悄悄采用更新的企业事实或模板。`socialContentProductionDirectorPreparation.ts` 负责编导方案检查点恢复、历史版本兼容封存、当前版本落库和交接快照；`socialContentProductionVoicePreparation.ts` 负责配音检查点恢复、一次性付费提交与结果不明保护、过长口播的编导压缩修订和声音证据封存。`socialContentProductionTechnicalQuality.ts` 将独立媒体探针、复刻忠实度、技术失败原因和质量检查点绑定到成片字节；成片文件持久化、复刻评估、终审状态和最终素材归档由 `socialContentProductionFinalDelivery.ts` 负责；其中参考视频只从任务素材或租户路径、来源和哈希均匹配的缓存读取，由 `socialContentProductionReplicationEvaluation.ts` 校验。原 worker 导出维持兼容。
- `server/lib/translationCues.ts`：时间戳配音翻译的纯文本解析、cue 完整性校验和响应形态归一化；Express 超时/连接生命周期保留在路由 adapter。
- `server/lib/imageGen.ts`、`server/agents/qwen.ts`：供应商适配；调用由服务端显式选择并受预算/回执边界约束。
- `server/agents/imageEvidencePaidContext.ts` 与 `imageEvidenceReceiptStore.ts`：图片证据 GPT 复核的冻结记录/租户绑定、现有预算账本与一次性许可复用，以及原始响应的共享卷持久回执。它们不从浏览器参数推导批准，不以 `trend_videos` 的非原子普通更新认领付费请求；当前爬取与重分析路由尚未接线。

## 图片管线数据流

工作台输入 → 租户任务合同 → 企业素材准入 → 策划与确认字段 → 图像生成 → 素材持久化 → 确定性预检 → 多模态复核/人工审阅 → 交付。

确定性失败不可被模型复核覆盖；多模态服务不可用时状态保持不确定，不得推断通过。多输出轮播/GIF 使用冻结计划、逐单元原子认领和持久化回执；结果不明时停止后续付费提交，只能核对已有素材。GIF 的产品与文字在背景底图持久化后由固定图层合成，最终动图单独登记与质检。工作台接线及本地合同测试不等于真实供应商、浏览器交互或发布验收。

## 依赖方向

共享合同不得依赖 React、Express 或供应商 SDK。领域模块不得依赖页面组件。路由只做边界校验和编排；新的复杂逻辑应先落独立领域模块，并保持租户身份从认证上下文向下传递。

## 架构治理

机器门禁由仓库根目录 `architecture.config.json` 和 `scripts/check-architecture.mjs` 执行。普通生产 TypeScript 文件上限 800 行；历史超限文件使用精确预算，只允许持平或下降。每个治理批次最多拆分 1–2 个热点文件，并单独记录行为验收。
