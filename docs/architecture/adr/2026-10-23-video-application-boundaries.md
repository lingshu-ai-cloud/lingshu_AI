# 视频应用、执行管线与 HTTP 职责边界

日期：2026-10-23。状态：已实现，离线验证通过。

## 决定

从 `f9cff15f` 的 7,823 行 `server/routes/videos.ts` 迁出完整职责，入口现为 281 行，仅负责统一鉴权、原顺序注册与公开入口委托。`server/videos/application.ts`（296 行）装配共享实例；最大新实现 `sourceAnalysisExecution.ts` 为 627 行。移除视频历史超限预算，没有新增豁免或放宽门禁。文件规模是职责划分结果，800 行不是切片依据。

| 职责 | 实现 | 约束 |
| --- | --- | --- |
| 采集与发现 | `videoCollectionApplication`、`imagePostCollectionApplication`、`videoDiscoverySearch` | 租户来源、冻结范围与付费许可先验；原发现节流状态只持有一份 |
| 供应商与下载 | 视频/图文/账号 Provider、`apifyFallbackRuntime`、`videoDownloadFallbacks`、`videoDownloaderTransport` | 复用现有输入验证、Apify 许可与传输；不新增重试或真实付费入口 |
| 来源分析 | `sourceAnalysisSubmission`、`sourceAnalysisExecution`、`videoAnalysisProvider`、`exactVideoAnalysis` | 同一原运行、租约、精确证据、视觉限定与口播授权边界；保留 Qwen→Gemini 旧降级 |
| 素材 | `materialAcquisitionApplication`、`materialAnalysisExecution`、`queuedMaterialAnalysis`、`referenceImportApplication` | 原素材归属、下载/分析及上传流程；文件存储与媒体处理各自独立 |
| 运行维护 | `videoDownloadRuntime`、`videoBackgroundWorkers`、`crawlerOpsApplication`、`videoVisibilityMaintenance` | 下载槽位、Worker 计时器/状态、运行代理、采集队列和修复/回填任务分别保持唯一所有者 |
| HTTP | `videoCollectionRoutes`、`videoSourceRequestRoutes`、`videoOpsRoutes`、`videoRecordMutationRoutes`、`videoReferenceImportRoutes`、`videoReferenceReviewRoutes`、`videoAssetRoutes`、`videoAnalysisControlRoutes` | 按原位置注册，参数/响应和认证租户传递保留；原列表适配继续复用 |
| 基础合同 | `contracts`、`applicationPorts`、`runtimeConfig`、`crawlErrors` | 类型端口不初始化实现；错误类共用身份；路径和并发配置沿用原值 |

表内未带目录的模块属于 `server/videos/`，HTTP 模块属于 `server/routes/`。每个服务只接收所需的明确类型端口。装配通过延迟读取端口连接原有相互调用，不在模块初始化时启动后台任务。缩略图持久化、图文分析队列、列表实例、活动与持久分析租约复用同一实例；迁移后归一化数据/锁目录与原目录相同。

## 依赖修复与兼容

完整运行时导入图发现：采集预算/候选评估原本经 `weeklyReviewEvidence` 的结果扫描依赖，沿内容生产/素材分析绕回视频主入口。将原 `readWeeklyReviewActor` 正文原样迁到独立 `server/socialPrograms/weeklyReviewActor.ts`，23 个只需身份能力的生产调用方改为直接依赖它，原入口继续转导出同一函数。40 个新生产模块逐个在独立进程加载成功，所有新领域到视频主入口的反向运行时路径为零。

另有一项明确的行为修复：扩展身份测试在未修改的 `f9cff15f` 基线上复现，本地排期确认会在本地权威明确不认识用户时继续读取应用用户库。`weeklyScheduleActor` 现先拒绝该身份，再执行原查询；已停用用户仍按原规则拒绝，正式权威查询保持原流程。这不是迁移等价性声明的一部分。

旧主入口的实际 58 个运行时导出、47 项 Router/中间件栈与顺序均和起点相同；184 个原视频函数正文、44 个直接路由表达式经 TypeScript AST 规范化比较完全一致。后台、生产/分析适配、移动与旧路由调用方继续使用兼容入口；未复制运行锁、下载槽位或 Worker。

## 验证与限制

新增 6 项隔离端口行为测试，覆盖 LinkedIn 视频/图文无许可拒绝、周 TikTok 无许可拒绝、同一原运行限制、下载并发上限与失败释放、危险来源在租约前拒绝。视频来源领域共 167 项、深入下载/分析回归 124 项、身份/发现/周流程组合 216 项通过。

原源码合同改读实际组成模块，并使用 AST 选择真实函数/路由。扩大验证还在未修改起点复现四处旧测试问题：口播测试要求已不存在的直接调用、灵感页直接卡片导入、费用夹具缺冻结预算、测试权威夹具缺 `NODE_ENV=test`。前两项改为检查现有组合/授权边界，后两项补齐夹具；没有放宽生产预算、许可、未知结果或 ASR 门禁。

实际通过 TypeScript、架构门禁（2,493 个生产 TS、剩 2 个历史预算）、预算 ratchet、193 项迁移清单只读检查、完整生产工作流、执行缺口、数字员工、租户隔离、支持会话只读、爬虫安全、图片管线和生产构建；源码暂存空白检查通过。Studio chunk 仍为 480,957/485,000 字节。

未运行真实供应商/付费请求、目标数据库迁移、登录后浏览器验收、发布或部署。原五项现完成灵感页、数字员工、视频三项；Studio 服务与创作页面仍须按完整职责继续拆分，架构门禁通过不代表整体目标完成。
