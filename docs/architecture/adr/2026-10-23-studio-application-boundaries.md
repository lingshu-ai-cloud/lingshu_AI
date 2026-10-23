# Studio 应用装配、生成与交付职责边界

日期：2026-10-23。状态：已实现，离线验证通过。

## 决定

从集成基线 `21a64ab5` 的 7,221 行 `server/routes/studio.ts` 迁出完整业务职责。主入口现为 187 行，只做统一认证、租户上下文中间件、原顺序挂载与旧入口委托；`server/studio/application.ts`（301 行）连接同一服务实例。移除 Studio 服务历史超限预算，没有新增豁免。最大新模块为首帧用例 628 行；模块按职责划分，未以 800 行机械切片。

## 责任划分

| 责任 | 主要模块 | 保持的边界 |
| --- | --- | --- |
| 共享装配与合同 | `application`、`applicationPorts`、`contracts`、`runtimeConfig`、`tenantContext` | 同一 AsyncLocalStorage、原数据/媒体路径；明确类型端口，装配不提交供应商工作 |
| 分镜资产与原请求恢复 | `storyboardReferenceAssets`、`storyboardOperationRecovery` | 当前租户/镜头/指纹/字节核验；已接收或不明请求只能核对原回执，不新增花费 |
| 首帧、动作与视频 | `studioStoryboardFirstFrameRoutes`、`studioStoryboardFrameReviewRoutes`、`studioStoryboardActionRoutes`、`studioStoryboardVideoRoutes`、`studioStoryboardQualityRoutes`、`generatedVideoRuntime` | 冻结镜头、素材授权、预算占用、原请求、QA 与逐段回执保留；质量未证实不冒充交付 |
| 脚本 | `studioScriptRoutes`、`studioScriptStrategy`、`studioScriptPrompt`、`studioScriptQualityPolicy` | HTTP/模型编排、策略编译、模式提示词、规范化/事实与质量规则各自持有完整职责；三个纯模块不执行供应商或存储操作 |
| 文案与图片 | 封面标题、海报策划、获客包、海报渲染、caption、editorial 各路由模块与 `posterReferenceAssets` | 原企业事实、配额、冻结图片单元、产品字节与付费许可；不新增图片生产通道 |
| 渲染 | `renderManifestApplication`、`studioRenderAdmissionRoutes`、`studioLocalRenderRoutes`、`studioPersistentRenderRoutes`、`localMediaRuntime` | 签名清单、私有资产读取、原本机/持久渲染路径；活动/已消费作业与持久作业集合各有唯一持有者 |
| 数字人及版本 | `digitalHumanRuntime`、`studioDigitalHumanJobRoutes`、`studioTransformationRoutes`、`studioVideoVersionRoutes` | 同一恢复计时器、刷新去重表与 HeyGen 创建队列；旧自动化入口复用它们 |
| 素材 | `materialUsageReadModel`、`materialUploadApplication`、`materialVideoAnalysis`、素材读取/上传/变更/分析 HTTP 模块、`materialRepository` | 云端流式上传、产品绑定、授权、媒体探针、原分析队列与使用证据保持原顺序；新增文件不转存本机历史素材库 |
| 语音与私有资产 | `studioTtsRoutes`、`studioVoiceSampleRoutes`、`audioAlignmentApplication`、`studioPrivateAssetRoutes`；复用已有 TTS Provider/Generation/VoiceAutomation | 同一音色/语音缓存、租户目录、逐请求付费上下文、音频字节与收据；不明结果禁重提 |
| 项目 | `projectEvidenceApplication`、`studioProjectWorkspaceRoutes`；复用原 Read/Save/Review、裂变和发布链接路由 | 当前输入与企业知识库核验、只读成本证据、CAS、冻结计划、托管作品禁止客户端伪造与发布审批失效 |

以 `studio` 开头的 HTTP 模块位于 `server/routes/`，其他新增模块位于 `server/studio/`。主入口按原位置逐一注册，保留订阅状态端点在订阅门禁之前、内容库和后续能力的原相对位置。内部端口延迟读取依赖，保留原共享实例；没有在多个领域各建一套上下文、计时器或队列。迁移后 `server/studio` 与原 `server/routes` 位于相同目录深度，归一化数据、TTS、样本、封面和媒体目录均与原位置一致。

## 跨模块依赖

此次完整审计不止检查直接导入，还沿运行时导入图追到生产与发布流程：

- 产品身份选择器原经 `contentProduction.ts` 大入口初始化整个生产执行器，再绕回 Studio。13 处只使用 `productIdentity` 的引用改为现有 `contentProductionPlanning.ts` 中的同一函数；原大入口转导出保持兼容。
- 社媒作品只读策略原与文件/工件接纳同处一模块。两个纯判断与管理标识迁到 `socialContentWorkspacePolicy.ts`，原模块转导出；Studio 保存/审阅与渲染入口直接依赖策略，不初始化生产工件链。
- 素材分析 Worker 原为调用分析函数而导入整个 Studio。原 `analyzeMaterialVideo` 迁到 `materialVideoAnalysis.ts`，Worker 与 Studio 共用；逐镜投影直接使用现有模块，旧公开入口兼容。
- 项目保存的审批失效原经发布执行器、来源核验和导演审阅绕回 Studio。原租户帖子读取、值解析及完整项目审批失效职责迁到 `publishingApprovalInvalidation.ts`，发布执行器继续转导出并复用同一实现；原运行锁、租户限定、任务版本和等待重新审批行为不变。

53 个新生产模块逐个独立进程加载成功，全部到 Studio 主入口的反向运行时路径为零。上述共享策略/仓储/失效的 7 个迁移语句也与原基线做 AST 对照，完全一致。

## 兼容与验证

分别实际加载未修改起点源码与新模块，**94 项 Router/中间件栈及顺序、69 个运行时导出完全一致**。**85 个原函数正文**经 AST 规范化比较一致；将三个纯脚本模块的实际迁移语句还原到调用处后，**81 个路由表达式**也一致。这一还原使用新文件中的实际语句，不以原始快照替代新实现。没有更改模型路线、付费重试、冻结事实或生成内容门禁。

新增 10 项隔离行为测试并纳入 `test:studio-workflow`：缺租户拒绝、并发作用域隔离、异常后恢复外层租户、无原请求不读取产物、处理中/不明请求只报告原回执、指纹冲突先拒绝、已完成产物读取失败保留恢复状态、已核验输出复用、跨租户预算证据先拒绝，以及当前脚本与商业字段的交付门禁。

旧源码合同改读组成模块或 AST 选择的真实函数/路由。项目读写门禁合同直接检查主入口装配顺序；托管作品身份合同检查实际 Save handler。两份旧复刻合同在未修改的 `21a64ab5` 导出目录同样失败：仍要求已不存在的提示词、强制 `needs_review` 形态与旧素材筛选位置。修正为检查现有 Qwen 复刻选择、不可信素材观察、闭合事实修复、原参考口播/CTA 槽位、最终质量阻断和当前企业知识库/素材证据准入，未更改生产实现或放宽规则。

实际通过：

- `pnpm run lint`；`ARCHITECTURE_BASE_REF=21a64ab5 pnpm run check:architecture`（2,546 个生产 TS、剩 1 个历史预算）；ratchet；193 项迁移清单只读检查。
- 完整 `test:studio-script`、`test:studio-workflow`、`test:studio-media`、`test:storyboard-aigc`（66/66）；新边界/合同组合 19/19；原生语音付费、HeyGen、素材分析、审批失效、社媒产物工作区及项目 CAS 调用方组合 21/21。
- 完整 `test:production-workflows`、`test:execution-gaps`、`test:digital-employees`、`test:tenant-isolation`、`test:material-import`（18/18）、`test:social-image-pipeline`；支持会话只读及爬虫安全。
- 生产构建与源码空白检查。Studio 页面 chunk 仍为 480,957/485,000 字节，本批没有改变前端生产代码。

上述测试使用隔离存储、假供应商、受控端口及本地 HTTP/FFmpeg，不代表登录后浏览器或真实供应商验收。未做真实付费调用、目标库迁移、发布或部署。原五项已完成灵感、数字员工、视频和 Studio 服务四项；`AiCreateStudio.tsx` 仍为 12,000 行，完整目标继续进行。
