# 当前架构摘要

更新时间：2026-10-23（Asia/Shanghai）

## 边界

- `src/components/socialContent/`：工作台与用户交互；不得自行绕过服务端租户鉴权或供应商成本控制。
- `src/components/ConversionPage.tsx` 与 `src/components/customers/`：页面持有会话状态和三栏视图；客户定位/加载、草稿翻译副作用与渠道发送适配分别落在客户子模块，真实发送仍经过现有服务端出站接口和回执边界。
- `src/components/assistant/AssistantConversationBubbles.tsx`：只承载对话滚动区内已准备好的决策摘要、欢迎语、消息、加载态、任务卡及周计划入口展示；滚动、草稿、身份栅栏与持久化仍由 `GlobalAssistant.tsx` 持有，发送由 `useAssistantSend.ts` 编排。
- `src/components/assistant/AssistantConversationPanel.tsx`：承载既有单列对话面板、快捷入口、周动作与输入区的渲染及展示回调；`GlobalAssistant.tsx` 连接当前线程、身份范围、消息保存与业务动作，不在展示组件中重建任务或付费主链。
- `src/components/assistant/useAssistantDecisionDialog.ts` 与 `useAssistantPanelControls.ts`：分别持有外部决策详情的状态、一次性结果反馈和关闭焦点恢复，以及浮层收起、返回对话、Escape 与视口监听；外部详情关闭不得重置对话，导航不得抢回旧页焦点。
- `src/components/assistant/AssistantLauncher.tsx`：只展示完整入口、贴边恢复入口、待办数量和手动收起按钮；收起偏好、焦点交接和打开对话动作仍由 `GlobalAssistant.tsx` 控制。
- `src/components/assistant/useAssistantPageSignals.ts`：按可见页面过滤业务上下文事件，并在助手关闭时按当前周目标低频读取权威待办数量；事件、定时器和请求中止在 hook 内成对清理，浮层保留页面与身份范围的状态所有权。
- `src/components/assistant/useAssistantSend.ts`：编排单轮消息发送、当前身份范围栅栏、明确生产请求与签名动作分流、附件持久上传、周计划确认分流以及模型流式答复；浮层继续拥有对话与草稿状态、身份栅栏实例和持久化生命周期，hook 不绕过现有付费或生产门禁。
- `src/components/assistant/useAssistantQuickExecution.tsx` 与 `useAssistantTaskCardActions.ts`：分别编排带原任务版本和幂等键的快捷生产操作，以及后端签名卡片动作与运行暂停/继续；确认、返工、任务深链、回执和身份范围仍沿用原主流程，不另建付费或生产旁路。
- `src/components/assistant/assistantProductionRequest.tsx`：明确的内容生产指令在企业中心产品身份核验后，要求用户确认交付截止时间，再通过现有周任务 API 创建并按真实回执生成任务卡及任务深链；登录/租户作用域栅栏由浮层传入，不在对话文本里冒充脚本生成成功，也不绕过既有生产付费门禁。
- `src/lib/assistantActionRequest.ts`：确定性助手动作请求的鉴权 HTTP 适配与错误卡映射；409 冲突、422 缺输入、超时结果待确认和无效响应都保持可见，不将请求故障伪装成可回退通用聊天的 `not_handled`。浮层仍负责仅从当前后端签名动作构造变更请求与呈现结果。
- `src/components/GlobalAssistant.tsx` 与 `src/components/assistant/`：浮层负责对话、任务入口和请求编排；`assistantChatPrompt.ts` 纯组装当前页面、企业、附件和有界历史的问答上下文，策略主路由只传用户原文并由服务端做权威经营事实注入，不把导航提示升级为已核验事实；`src/lib/assistantChatStream.ts` 负责模型首响应/流式空闲超时、SSE 完整性和文件内容完成后生成，浮层保留身份栅栏、消息状态和错误提示；`useAssistantFeatureGuides.ts` 持有功能引导的本地记忆、冷却、企业页一次性提示、指针/焦点触发与计时器清理，浮层只接入展示和点击动作；`useAssistantNotifications.ts` 持有后台任务卡、等待状态、短消息及首次入口提示事件，按通知策略保持日常进度静默，浮层保留用户主动动作结果的展示决定；`useAssistantThreadHydration.ts` 在限定租户/用户范围内恢复线程展示状态、合并本地输入与服务端 CAS 版本，并对旧聚焦卡重新读取权威状态/签名动作，不把旧消息正文带进新会话；`AssistantFloatingReminders.tsx` 只展示右侧提示气泡，入口收起、已打开对话时不显示，等待/短消息/周计划/功能引导优先级由组件投影，状态与回调仍由浮层持有；`AssistantCustomerTodoView.tsx` 仅承载已有客户待办的展示，浮层保留选择客户事件与返回对话回调；`AssistantDecisionDialog.tsx` 承载对话面板之外共用的 Ant 决策详情弹窗，仅接收页面的当前周目标、权威卡和动作回调，关闭/导航焦点栅栏仍由浮层控制；`useAssistantThreadSaveQueue.ts` 负责已限定身份范围内的串行 CAS 保存、冲突合并与退避，浮层仍拥有身份栅栏和生命周期触发；`assistantProductionIntake.ts` 负责明确生产请求识别及从企业中心核验已确认产品，不得仅凭对话文本虚构产品身份；`assistantActionProjection.ts` 负责聚焦卡自然语言动作、后端签名目标与参数、响应卡身份和跨对象动作过滤。页面只调用这些规则，不自行推断业务对象或放行跨对象操作。
- `src/components/InspirationDashboard.tsx` 与 `src/components/inspiration/inspirationFrameMatching.ts`：灵感页负责展示、交互和素材读取，逐镜素材评分、硬条件、可复制性与替代路线由纯匹配模块负责；图片证据面板由 `ImageEvidenceSummaryPanel.tsx` 承载，展示轮播节奏、可复用模块和图层蓝图。`imagePostAnalysisPresentation.ts` 与 `inspirationAnalysisProjection.ts` 投影图文排队、处理中、结果不明的可见状态和禁重提边界。未核验的产品主体或真实性证据不得靠软评分提升为可复用片段。
- `src/components/inspiration/InspirationImageCrawlDialog.tsx`：只展示关键词补充采集的现有平台、关键词、数量和忙碌/错误状态；`InspirationDashboard.tsx` 继续持有请求、状态、错误清理与采集结果刷新，不在弹窗中建立独立付费或持久化链路。
- `src/components/inspiration/InspirationVideoResults.tsx`：承载灵感结果的首次加载、真实空态、卡片/列表及服务端分页展示，共用卡片操作准入。页面继续提供已筛选记录、来源/收藏状态、分页页码和选择/创作/预览/收藏/管理回调；展示组件不读取租户数据或执行供应商请求。
- `src/components/inspiration/InspirationWatchModal.tsx`：原视频预览弹窗独立承担鉴权视频、原站嵌入回退、加载/失败/重试与高于详情 Drawer 的层级；灵感页仍拥有选中视频和打开/关闭动作。`inspirationShootingNeeds.ts` 从已有分析及素材匹配结果汇总拍摄缺口和优先级；`InspirationShootingPanel.tsx` 持有待拍清单的排序、筛选与可选拍摄入口展示，页面继续拥有视频/素材读取、上传状态和任务回写，不把元数据兜底冒充真实镜头证据。
- `src/components/inspiration/inspirationProductMaterialInventory.ts`：按稳定产品 ID 读取完整素材库存、去重并受控逐页汇总；页面仍决定何时读取、筛选和打开详情，不能把未返回或属于其他产品的素材补成已就绪。`inspirationReferenceTarget.ts`：解析周任务导航中的参考目标，并按记录、URL 或标题匹配已取得的灵感记录；明确的精确参考审核仍走独立审核链，不降级为模糊匹配。
- `src/components/inspiration/inspirationMaterialGalleryProjection.ts`：只根据页面已读取的租户素材与产品摘要投影镜头功能选项、筛选、用户上传优先排序、产品集合卡和普通素材分页。页面继续持有素材请求、过滤状态、产品详情与交互；产品集合卡仅在首页出现，限制条件下必须有真实摘要素材匹配。
- `src/components/inspiration/MaterialLibraryCardMedia.tsx` 与 `MaterialUsageHistory.tsx`：前者持有素材卡真实宽高比、封面→视频首帧回退、短期地址刷新和操作按钮；后者只展示成品使用履历与有证据的表现回流。页面仍负责素材目录请求、产品归属、预览选择与动作执行，旧 `materialPreviewImageSources` 导出保持兼容。
- `src/components/inspiration/DirectorVideoDetailPanel.tsx`：编导视频详情 Drawer 持有分析进度、图文证据、逐镜 Tab 与交接状态的展示及受租户鉴权的交接读取；灵感页继续持有选中对象、重分析/取消/收藏/创建动作与页面级身份边界，旧公开导出转发新组件。该职责迁移不放宽图文结果不明或逐镜证据未完成时的创作准入。
- `src/components/inspiration/inspirationVideoProjection.ts`：爬虫/发现记录投影为前端视频、元数据兜底、发现评分、来源标签及账号基线推荐；页面保留请求、鉴权、排序编排和展示，旧的页面导出继续转发以兼容消费者。
- `src/components/inspiration/InspirationMedia.tsx`：灵感缩略图、鉴权图片和视频的加载/播放边界；平台卡直接依赖该媒体模块与发现投影，避免反向导入整页。签名 HTTPS 图片直载，受保护媒体经鉴权取回；视频解析有超时、代际失效与一次媒体重试。页面保留旧公开导出以兼容消费者。
- `src/components/studio/studioVoiceoverRules.ts`：工作台的纯口播规则，包括时间码解析、分镜台词抽取、字幕/音效区分、完整时间线覆盖与译文逐句对齐；`AiCreateStudio.tsx` 保留草稿状态、供应商请求和原公开函数转发，不把模型译文在规则校验失败时冒充已覆盖原片。
- `src/components/studio/studioSubtitleCues.ts`：按已确认口播时间范围选句、生成/归一化字幕 cue、限制最终渲染时长并输出 SRT/VTT 文本；桌面下载动作只处理本地 Blob。`AiCreateStudio.tsx` 继续持有语言版本、配音结果和预览/导出的触发时机，并转发旧公开口播范围导出；分镜画面是否有人物的判断仍留在工作台原路径，不由字幕逻辑推断。
- `src/components/studio/studioReferenceSpeechPlan.ts` 与 `studioVideoKickoff.ts`：基于冻结原片视觉切点、来源 ASR 行和明确产品/品牌映射构造复刻口播，人工删改不得丢失保留镜头；缺原片 ASR 时仅生成企业自有字幕或无口播方案，不伪造原片台词。前者负责纯规则，后者保存工作台原参考输入类型；页面仍决定何时展示、确认或持久化，并转发旧公开导出。
- `src/components/studio/studioTimelineFitting.ts`：定义稳定分镜槽位类型，按真实配音时长或已采纳数字人成片时长扩展分镜时间线，不压缩已批准的较长画面；页面继续持有素材选择、语言版本、制作请求和原公开时间线导出。
- `src/components/studio/studioSourceMaterial.ts`：定义 Studio 素材片段合同、产品素材转换、历史快照恢复及冻结原片身份隔离。短期签名 URL 比对忽略查询串；历史原片快照和仅供分析素材不能进入企业成片素材池，来源身份不一致时不能只凭标题复用旧草稿。页面仍持有项目读取、素材状态和请求动作，旧公开类型与准入函数从页面转发。
- `src/components/studio/studioLanguageRules.ts`：工作台语种目录、原口播语种判定、企业语言代码解析、已有译稿按语种筛选及脚本时间码格式归一化的纯规则；页面继续决定翻译/配音请求与保存时机，旧公开口播语言函数由页面转发。
- `src/components/studio/ExistingSourceDraftDialog.tsx`：仅在发现同源历史草稿时按需加载，展示继续编辑或新建作品集两种显式选择；`AiCreateStudio.tsx` 保留源草稿校验、冻结引用清理和项目加载动作。未挂载的旧产品预览已删除，当前产品筛选与信息读取不经该旧视图。
- `src/components/studio/studioStoryboardMaterialMatching.ts`：分镜素材的画幅偏好、可定位片段证据、视觉语义评分及本地自动分配纯规则。`AiCreateStudio.tsx` 继续拥有任务草稿、素材请求、人工确认及原公开函数转发；时长和宽高比只能影响排序，不能替代片段真实性证据。
- `src/components/inspiration/inspirationAnalysisProjection.ts`：分析文本清洗、精确分析准入、展示资格、粗结构与逐镜摘要构建；当前选中视频由灵感页挂载 `DirectorVideoDetailPanel` 展示。原参考的六段结构、镜头和口播人工复核归 `DirectorReviewWorkspace.tsx`，其登录身份栅栏、显式 ASR 许可和结果不明禁重提交不由页面替代。旧 `ScriptPanel`/`AnalysisPanel` 及其 Seedance 脚本侧栏没有挂载，已清理；不将策略级或不确定文本标成通过的全片证据。
- `src/components/inspiration/inspirationMaterialLibrary.ts`：素材库入口参数、企业通用/产品归属、可见标签与语义、分类徽标、产品/方向/图库筛选；权威媒体比例计算在 `src/lib/materialAspectRatio.ts`，规则模块不反向依赖 React 组件。页面保留素材加载、用户操作和展示，原页面导出继续转发。
- `src/components/EnterprisePage.tsx` 与 `src/components/enterprise/`：页面持有可编辑企业资料和导航；资料默认值/快照、服务端读写校验、FAQ/销售风格控制器及业务视图由企业资料模块负责。保存成功必须以服务端读回和产品身份校验为依据。
- `src/components/DigitalEmployeePage.tsx` 与 `src/components/smartBusiness/WeeklyGoalPanel.tsx`：数字员工页负责新周目标的提交、冲突恢复与运行导航；独立周目标面板持有草稿、预设方案、平台配额重算、视频计划校验和排期确认，不直接调用生产 API。`DigitalEmployeeFormField.tsx` 是页面与周目标面板共用的表单字段样式。
- `src/components/smartBusiness/digitalEmployeeConfigRules.ts`：数字员工首次配置的安全默认值、旧发布节奏配额换算、配置补全及发布/跟进人工审批校验；页面仍持有引导交互、企业资料读取、用户确认和现有保存接口，不在规则模块中执行真实发布或消息发送。
- `src/components/smartBusiness/onboardingProductImport.ts`：首次引导产品资料的文件类型/大小校验、PDF/DOCX/TXT/表格解析、明确归属的图片上传、未归属页留在素材库、按稳定产品 ID 合并及现有鉴权企业档案写入。页面只保留选择、忙碌与结果反馈；未核验图片不得自动绑定产品。
- 数字员工首页实际挂载 `BusinessHealthOverview`、`SmartBusinessDashboard` 和 `DigitalEmployeeTodayFocusPanel`；旧的未挂载“今日经营快照”、指标卡与转化图表脚手架已移除。源码契约测试必须检查实际挂载路径，不以死函数存在证明界面已交付。
- 选中数字员工任务的当前生产详情由 `ProductionTaskScene` 挂载，并用 `buildTaskDeepLink` 进入业务工作台；历史 `ProductionScene`、事件流、截图、纠偏与跳过/人工完成按钮链从未挂载，已移除。页面的 `SmartBusinessDashboard` 仍提供原任务重试入口；`skipTask`/`completeTask` 的服务端 API 存在不等于当前页面有相应按钮，后续需求须在真实入口单独设计和验收。
- `src/components/smartBusiness/DigitalEmployeeTodayFocusPanel.tsx`：首页“本周进度/需要你处理”的可达视图，依据真实任务、待审批项与计划状态展示至多三项关注动作。页面继续提供执行导航和状态文案；旧的 `TodayNextAction`、`BusinessLoopMap`、`ResourcePreflightPanel`、`NextActionBanner` 和 `DraftPlanPreview` 从未挂载，已移除，不能用其文案证明界面已交付。资产就绪跳转仍由实际挂载的 `OnboardingPanel` 使用。
- `src/components/smartBusiness/BatchFollowupTruthPanel.tsx`：承载客户转化工作区内逐客草稿、整批人工批准、真实发送预检/回执及手动派发按钮的展示。仅以服务端任务输出中的租户/渠道授权事实启用按钮；页面仍持有已登录身份、批次派发 API、忙碌状态和业务跳转，组件不自行发送消息。
- `src/lib/studioApi.ts`、`src/lib/socialImageApi.ts`：前端 API 适配层。
- `shared/contracts/`：跨端任务、内容与交付合同；字段变更需检查旧任务兼容性。
- `server/routes/`：HTTP 鉴权、输入规范化、租户上下文和响应编排；业务算法逐步下沉到领域模块。
- `server/routes/studioMaterialLibraryProjection.ts`：在路由完成租户库存与企业产品读取后，统一投影产品归属、用途/来源可见性、生成素材过滤、分类 facets、排序与分页；`studio.ts` 保留租户读取、鉴权响应、素材 URL 签名、使用证据聚合和产品场景准备，不把 `purpose=all` 的内部素材混入普通图库。
- `server/digitalEmployees/taskEvidenceProjection.ts`：数字员工任务的执行元数据、依赖与业务引用范围、工作流归属、项目完成/渲染证据的纯规则；路由仅在租户范围内读写记录并调用这些规则，不能用历史草稿或可变引用覆盖托管项目的索引血缘。
- `server/digitalEmployees/taskCorrectionSafety.ts`：任务纠偏的传递性下游范围和已发送/已发布回执判定；路由注入租户限定的存储及跟进发送回执读取，缺少可证明安全的外部动作仍保守拦截。拆分不改变外部发送、发布和重试许可。
- `server/digitalEmployees/taskCorrectionSupersession.ts`：任务纠偏后按影响范围使生产 job、冻结内容批次、托管 Studio 项目、客户分群、跟进草稿及审批失效；路由持有运行锁并注入存储/队列/跟进项目读取。已发送或已送达的跟进项目不被回写为草稿，旧业务回执拦截仍先于失效操作执行。
- `server/routes/videoCrawlerOpsTaskState.ts`：视频来源爬虫任务的纯状态规则，包括中断恢复、显式重试、耗尽终止、待处理优先级、重试退避与失败分类；`videos.ts` 保留原导出并负责持久化、租户可见性与执行编排。
- `server/routes/videoAnalysisRecovery.ts`：视频级失败保留已有证据、显式重试清空旧终态、供应商错误脱敏及用户恢复提示的纯规则；`videos.ts` 保留旧导出并负责租户数据读写、队列与 HTTP 响应。该拆分不改变供应商调用或付费许可。
- `server/routes/videoCrawlerProviderProjection.ts`：TikTok、Instagram、Facebook 的 Apify 视频行转候选、媒体封面 URL、标题与指标的纯投影；原路由继续负责 Actor 请求、付费门禁、账号范围、队列和持久化，图片帖投影可复用这些基础规则。
- `server/routes/videoCrawlerPublicProjection.ts`：公开视频检索日期/查询、候选元数据、URL 去重、缩略图和失败类别的纯投影；`videos.ts` 保留网络请求、付费准入、租户边界和持久化，并继续转发既有公开函数。
- `server/routes/videoCrawlerPublicDiscovery.ts`：YouTube Shorts 平面检索失败后的 HTML 回退、Bing 公开视频 URL 读取及限时 HTTP 文本传输；路由注入现有 yt-dlp 入口并保留租户筛选、下载、付费准入与持久化。未被生产调用的旧 YouTube 日期过滤辅助函数已删除，不把搜索结果当作已完成媒体分析。
- `server/routes/videoPipelineStatsProjection.ts`：按路由已限定租户可见性的记录、已取得的爬虫运维快照及供应商配置事实，纯投影抓取、下载、分析和精修队列统计；`videos.ts` 保留租户鉴权、分页读取、测试租户可见性判定与运维数据采集。投影不执行分析、重试或付费请求。
- `server/routes/videoCrawlerImageProjection.ts`：Instagram、TikTok 与 Facebook 的 Apify 图片帖纯投影，保留来源 URL、图片、互动数据与视频排除规则；`videos.ts` 继续负责 Actor 调用、付费准入、账号范围、队列和持久化。
- `server/routes/videoCrawlerSeedCatalog.ts`：按平台及关键词选择历史静态公开 URL 和兜底候选的纯目录；`videos.ts` 保留实时检索、下载、资格筛选和失败处理。目录项不是当前可访问性或素材授权证明，不得直接升级为已验证媒体。
- `server/routes/videoCrawlerMetadataFallback.ts`：仅在真实视频分析未完成时，根据标题、标签、公开热度与时长生成原有策划提示；不读取媒体、不调用供应商，也不产出已观察到的逐镜证据。`videos.ts` 继续决定何时使用兜底、何时恢复真实分析，并负责租户数据与付费边界。
- `server/routes/videoAnalysisTimelineProjection.ts`：精确视频分析的纯时间线规则，包括物理剪辑点选帧、观察窗口合并、跨镜头语义片段切分及局部时间标签平移；`videos.ts` 保留原有公开导出，并继续负责帧提取、模型请求、分析状态和回执。
- `server/routes/videoDownloaderArgs.ts`：按显式传入的代理、浏览器、User-Agent 与 Node 可执行路径纯组装 yt-dlp 参数和平台 Referer；`videos.ts` 负责读取运行环境、执行下载及旧公开函数转发，不让伪搜索 URL 中的中文关键词进入 HTTP Referer。
- `server/routes/videoCrawlerRuntimeConfig.ts`：本地爬虫代理轮换与日志脱敏、子进程环境、Cookie 文件和浏览器候选的运行配置；路由仅执行已选尝试的下载。逗号分隔的浏览器配置按实际候选拆分，单浏览器参数只取首项，不能把整串作为 yt-dlp 浏览器名。
- `server/routes/videoCrawlerNormalization.ts`：视频来源及供应商元数据归一化、Apify 候选窗口等纯规则；`videoCrawlerSourceUrls.ts` 负责规范来源 URL 与平台账号/帖子链接，`apifyTikTokInput.ts` 负责纯 Actor 输入组装；`videos.ts` 保留既有兼容导出。LinkedIn 公司帖的冻结输入、许可范围校验与受控传输在 `linkedinCompanyPostPaidCollection.ts`；内部视频/图文入口缺少受信任许可时仍明确报 `linkedin_company_paid_collection_permit_required`，手工 HTTP 不开放。当前没有生产许可签发器，不能将模拟许可或离线解析视为付费采集已开放；见 [`2026-10-23-linkedin-company-paid-collection.md`](./adr/2026-10-23-linkedin-company-paid-collection.md)。
- `server/socialDiscovery/linkedinCompanyReceiptStore.ts`：LinkedIn Actor POST、run GET 和 dataset GET 的原始 HTTP 响应以批准/任务/Actor/请求/Token 指纹绑定的只写一次文件保存；受控传输在解析和账本终态更新前等待持久回执。存储模块本身不是许可或预算签发器，缺少部署共享卷、可信报价和数据集读取许可时仍不开放真实采集。
- `server/socialDiscovery/linkedinCompanyCollectionQuote.ts`：以逐 run 批准、服务端账号/Token 指纹和受信任费用证据计算 Actor 与全部非 Actor 费用的人民币最坏情况报价，并复核来源未变。离线报价不预约资金、不认领操作或签发付费许可；真实账号费率、汇率和非 Actor 费用凭据仍未接入生产权威。
- `server/socialDiscovery/linkedinCompanyCollectionPermit.ts`：接收服务端可信报价端口，重验逐 run 批准与费用证据，在共享目录持久预约最坏费用并唯一认领 Actor POST 和数据集 GET；运行、结算和数据集完成状态只接受绑定原始响应的回执。当前无生产可信报价适配、目标共享卷证明或普通发现 worker 签发接线，因此真实 LinkedIn 付费采集仍默认关闭。
- `server/routes/studioCoverSvg.ts`：封面图的尺寸、换行、图层和 SVG 文本转义纯渲染；`studio.ts` 保留鉴权、租户限定的帧读取、文件保存和对象存储，不把客户端传入的路径直接交给渲染模块读取。
- `server/routes/studioStoryboardSpeechRules.ts`：分镜口播时长估计与语义压缩、CTA 语义、字幕同步、字段规范化与重复/不一致检查纯规则；`studio.ts` 保留模型生成、租户素材读取、修复编排与旧公开导出，不让脚本文字后处理接触供应商或持久化。
- `server/routes/studioProductScriptRules.ts`：产品与目标买家/合作路线的保守口播计划、完整 CTA、锁定分镜、素材证据与时间线检查的纯规则；依赖前述口播规则与已有产品事实/质量合同，`studio.ts` 保留模型生成、资料读取、租户状态及原公开导出，不将没有来源的素材画面或商业数字补写成事实。
- `server/routes/studioProductSceneProvenance.ts`：产品预制素材的稳定槽位绑定、上传校验凭证解析、关联产品变更和检索标签纯规则；`studio.ts` 保留租户产品查询、上传媒体探针、素材持久化及原公开导出，不因投影拆分放宽上传或复用授权。
- `server/routes/studioProductSceneProjection.ts`：产品场景来源图、素材可制作性、空槽位与素材/产品范围的只读投影；`studio.ts` 仍负责租户鉴权、签名媒体 URL、素材写回与 HTTP 响应，不把投影结果当作持久化素材或供应商验收。
- `server/routes/studioProductSceneUpload.ts`：产品场景上传意图与企业产品身份校验、完整视频探针结果封装、错误到 HTTP 状态映射和复用授权元数据；`studio.ts` 仍持有上传请求生命周期、租户素材写入与对象存储。非视频、缺失或未知槽位在读取企业资料前拒绝，上传探针不可用不生成复用授权。
- `server/routes/studioMaterialAnalysisSegments.ts`：将素材逐镜分析结果投影为片段的纯规则，供云端素材写回和自动生产共用；`studio.ts` 保留原公开导出、供应商选择、租户素材读写及 HTTP 编排。
- `server/routes/studioReferenceTimelineQuality.ts`：参考逐镜文本和结构化镜头时间线的纯完整性规则；只识别行首物理镜头范围，检查片头、空档、重叠与真实片段缺失，`studio.ts` 保留生成流程与失败响应编排。
- `server/routes/studioRenderManifestProjection.ts`：从路由提供的租户素材名称→URL 与已选配乐 URL 投影冻结渲染清单，保留逐镜显式 URL 优先、特效及强调计划标准化和签名清单字段；`studio.ts` 仍负责租户素材/配乐读取、清单安全校验、令牌、配额与本机导出。
- `server/routes/studioTtsStyle.ts`：配音风格输入归一化、MiniMax 确定性停顿与发音词典、Qwen/MiniMax/macOS 音色及语言映射纯规则；`studio.ts` 保留语音文件、供应商请求、付费许可与回执编排，不因音色选择绕开现有付费门禁。
- `server/routes/studioVoiceoverLanguageRules.ts`：口播文本的目标语种文字系统判定、逐句修复输入切分和配音句子边界纯规则；`studio.ts` 保留旧公开导出、模型译文校验与 TTS 供应商/文件编排，语种不符时仍按原合同停止生成。
- `server/routes/studioLocalTtsAdapters.ts`：Piper、XTTS 与本机 `say` 的可选本地语音执行；从路由显式注入租户目录、样本查找、签名资产 URL 和转码接口。无可用引擎时不触碰租户文件；付费 Qwen/MiniMax/HeyGen 路径仍留在原有许可和回执边界内。
- `server/socialDiscovery/imagePostEvidenceAnalysis.ts`：公开图片下载和现有 Qwen 主分析/Gemini 旧降级。`imagePostMediaPersistence.ts`：图文缩略图与 COS 图片来源持久化。`imagePostImport.ts` 与 `imagePostRefresh.ts`：新增和既有图文先持久化来源及状态。`imagePostReanalysis.ts`：显式重分析先记录尝试，写回时校验同一尝试和来源快照。`imagePostAnalysisQueue.ts`：延迟分析先把输入和来源哈希存入记录，再由后台 worker 在可证明的数据库唯一租约下领取；已开始但未写回的尝试不自动重发。`imagePostLeaseCapability.ts` 只为此路径只读核验远端 PocketBase 租约索引，不放宽其他付费 worker。`videos.ts` 保留 HTTP 鉴权、爬取入口和图片 URL 规范化。上述路径仍未具备统一的逐记录付费批准、供应商原始回执与人工核对流程。
- `server/routes/videoPublicRecordProjection.ts`：公开视频响应中的进度投影、私有逐镜对象键清除、已受理后台任务排队编号和关键词匹配纯规则；`videos.ts` 保留租户读取、签名缩略图及 HTTP 筛选编排。对象与 JSON 字符串两种持久证据形态都必须在响应前清除私有对象键。
- `server/routes/videoRecordVisibility.ts`：公开视频/图文记录的来源资格、完成/排队/暂停展示与内容类型投影纯规则；`videoAnalysisSuccessPatch.ts`：完整 Gemini 视频证据的终态写回补丁，清除旧失败字段并保留精准分析人工复核标记。`videos.ts` 继续拥有租户权限、数据库写入和任务执行，不把未完成的分析伪装成可见成功。
- `server/socialImage/`：图片任务、参考画布、首版策划、图层合成、修订和质量判定。参考图层蓝图在任务创建/更新和合成入口均规范化；蒙版层级不能绕过产品遮挡上限。
- `server/starter198/socialContentProductionExecution.ts`：社媒自动生产 worker 的阶段编排；`socialContentProductionAdmission.ts` 在制作前验证周任务授权、冻结路线、复刻证据与幂等。素材路由和预算前核对分别由 `socialContentProductionRouting.ts`、`socialContentProductionMaterialPreparation.ts` 负责。`socialContentProductionPlanAndDirector.ts` 管理安全素材方案、零素材真实性边界和编导冻结；`socialContentProductionVoicePreparation.ts` 负责配音检查点、一次性提交与结果不明保护、超时长修订；`socialContentProductionRenderManifest.ts` 校验人物声音绑定并冻结渲染/特效清单；`socialContentProductionTechnicalQuality.ts` 将独立媒体探针与技术检查点绑定到成片字节；`socialContentProductionFinalDelivery.ts` 负责成片归档和终审状态，`socialContentProductionArtifact.ts` 组装含成本、来源、质量与审阅证据的最终工件。非渲染代拍清单由 `socialContentShootingPlan.ts` 和 `socialContentShootingPlanExecution.ts` 负责；冻结脚本由 `socialContentProductionScriptBaseline.ts` 管理。原 worker 导出维持兼容，其下阶段仍通过原有检查点与付费门禁，未授权的真实供应商请求不得因结构拆分而开放。
- `server/lib/translationCues.ts`：时间戳配音翻译的纯文本解析、cue 完整性校验和响应形态归一化；Express 超时/连接生命周期保留在路由 adapter。
- `server/lib/imageGen.ts`、`server/agents/qwen.ts`：供应商适配；调用由服务端显式选择并受预算/回执边界约束。
- `server/socialDiscovery/imageEvidenceReviewApproval.ts`：图片证据 GPT 复核的逐记录人工批准权威，持久冻结租户、来源快照、精确请求和人民币上限；每次读取都复核批准、来源、有效期及撤销。批准记录不是付费许可，也不签发报价。
- `server/socialDiscovery/imageEvidenceReviewPreparation.ts`：仅在可信图片记录需要复核时，从服务端图片字节、主分析和受信任账号模型构造精确请求哈希。先返回不写入批准的报价指纹；人工批准时重新读取同一来源、图片字节、请求、可信模型感知输入 token 上界及有效账号费率，指纹不符或报价超过人工上限均拒绝。公开图片 token 计算器只提供估算，不能代替该上界；准备模块尚未挂到 HTTP/worker，报价或批准都不是付费发送许可。
- `server/agents/imageEvidencePaidContext.ts` 与 `imageEvidenceReceiptStore.ts`：图片证据 GPT 复核的冻结记录/租户绑定、现有预算账本与一次性许可复用，以及原始响应的共享卷持久回执。它们不从浏览器参数推导批准，不以 `trend_videos` 的非原子普通更新认领付费请求；当前爬取与重分析路由尚未接线，Qwen→Gemini 现有降级行为未改变。

## 图片管线数据流

工作台输入 → 租户任务合同 → 企业素材准入 → 策划与确认字段 → 图像生成 → 素材持久化 → 确定性预检 → 多模态复核/人工审阅 → 交付。

确定性失败不可被模型复核覆盖；多模态服务不可用时状态保持不确定，不得推断通过。多输出轮播/GIF 使用冻结计划、逐单元原子认领和持久化回执；结果不明时停止后续付费提交，只能核对已有素材。GIF 的产品与文字在背景底图持久化后由固定图层合成，最终动图单独登记与质检。工作台接线及本地合同测试不等于真实供应商、浏览器交互或发布验收。

## 依赖方向

共享合同不得依赖 React、Express 或供应商 SDK。领域模块不得依赖页面组件。路由只做边界校验和编排；新的复杂逻辑应先落独立领域模块，并保持租户身份从认证上下文向下传递。

## 架构治理

机器门禁由仓库根目录 `architecture.config.json` 和 `scripts/check-architecture.mjs` 执行。普通生产 TypeScript 文件上限 800 行；历史超限文件使用精确预算，只允许持平或下降。每个治理批次最多拆分 1–2 个热点文件，并单独记录行为验收。
Studio 的静态支撑模块由 `vite.config.ts` 中的 `studio-support` 分组拆出主控制器 chunk，保持执行顺序；`scripts/check-studio-chunk.mjs` 只约束 `AiCreateStudio` 主 chunk 上限 485,000 字节。拆包不改变模块调用时机，也不代表首屏总传输量或工作台源码结构债务已解决。
