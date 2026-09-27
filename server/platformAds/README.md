# 广告平台执行接入

## 当前可执行范围

- Meta：OAuth 授权发现账户，或开发者令牌验证连接；账户与 campaign 读取；网站视频引流与有效视频观看广告完整暂停创建；启用、暂停和广告组日预算调整；平台读回与未知结果对账。
- Meta 创建按任务渠道限制 Facebook / Instagram；按排期设置 start_time / end_time；campaign spend_cap 使用任务总预算。平台计费存在延迟，spend_cap 不是即时扣费保证。
- Meta 支持 USD / CNY，必须与任务币种一致；两者预算偏移均为 100（美分 / 分）。TikTok、Google 执行仍要求任务与账户均为 USD。
- TikTok：访问令牌验证账户、读取 campaign；人工创建 VIDEO_VIEWS / ENGAGED_VIEW / CPV 的 Spark 视频广告，TT_USER 身份与既有可推广帖子必填；支持完整暂停创建、启停、未知状态对账。尚不支持审批和自动执行。
- Google：访问令牌验证账户、读取 campaign；人工创建 YouTube-only Demand Gen / Target CPA 转化广告，必须引用账户已有视频和 Logo 资产；完整原子暂停创建、启停、对账；任务绝对排期转换为账户本地时间。标准 Video 类型为 API 只读，不以 Demand Gen 替换视频观看目标。尚不支持审批和自动执行。
- 每任务限制一个已创建或待核对 campaign。跨平台预算拆分、平台导入计划接管、令牌刷新尚未实现。Meta 首版素材上传范围见下文。
- Meta API 调用已通过模拟传输和本地持久化测试，未通过真实广告账户验收。

## 配置

`META_ADS_API_VERSION` 必填，例如部署时核验仍受支持的 Graph 版本；不内置未经核实的默认版本。

OAuth 另需 `META_ADS_APP_ID`、`META_ADS_APP_SECRET`、`META_ADS_REDIRECT_URI`。固定回调地址为 `{站点}/api/overseas/platform-ads/oauth/meta/callback`，需登记到 Meta 应用。申请 `ads_read,ads_management` 及对应生产访问权限。应用密钥保留服务端，授权令牌加密入库。

`GOOGLE_ADS_API_VERSION` 必填；如经过经理账户访问，配置 `GOOGLE_ADS_LOGIN_CUSTOMER_ID`。Google Ads API 自 2026-09-09 起以 OAuth 所属 Cloud 项目的访问等级鉴权，本实现不再要求或发送 developer-token。

生产使用现有 `TENANT_PLATFORM_APP_KEY` 加密令牌。

## 执行保护与 worker（代码核对：2026-09-27）

以下描述的是代码能力和启用条件，不代表真实账户验收通过，也不构成投流或生产部署授权。

- 任务锁已使用共享数据库 `durable_operation_leases` 租约，作用域为 `platform-ad-task`，按租户与任务区分。进程内集合仅减少竞争；跨实例互斥依赖数据库集合及其唯一约束，不能用文件系统锁或进程内锁替代。实现见 `taskLock.ts`、`../runtime/durableLease.ts`。
- 租约默认 30 分钟，`PLATFORM_AD_TASK_LEASE_MS` 限定在 30 秒至 2 小时；持有期间续租，平台写入前再次续租和校验租约代次。租约丢失或数据库不可用时阻止后续写入；这不能撤回已发送的平台请求，未知结果仍须对账，不能盲目重建资源。
- `../runtime/externalEffectLeaseStore.ts` 拒绝以本地 JSON 回退充当外部写入的租约权威。开启 `ENABLE_LOCAL_DEV_FALLBACK=true` 或旧兼容开关 `DISABLE_LOCAL_AUTH_FALLBACK=false` 时，相关操作会被阻止；仅隔离测试可同时设置 `NODE_ENV=test` 与 `TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK=true` 使用测试回退。普通开发默认也不启用本地回退。
- `PLATFORM_ADS_RELEASE_MODE` 有 `disabled`、`paused_only`、`full` 三档。生产未配置时为 `disabled`，非生产未配置时为 `full`，非法值按 `disabled` 处理。`paused_only` 仅允许 Meta 暂停创建和暂停；启用、恢复、调预算及自动优化均被阻止。`full` 仍须经过平台能力、账户、版本、预算及授权校验，不是对真实投流的授权。
- `../runtime/backgroundJobs.ts` 已接入 `startAdAutomationWorker()`；仅 `PLATFORM_ADS_AUTOMATION_ENABLED=true` 时启动，启动后立即运行一次，此后每 5 分钟运行。每轮先处理投放启动队列，再在发布策略为 `full` 时处理自动规则。worker 的进程内防重入之外，启动和规则执行仍使用数据库任务租约。
- 当前自动优化仅适用 Meta 网站访问目标的 CPC 规则：检查授权、样本、冷却期和预算边界，再决定观察、暂停或调整预算。平台预算与最近已验证回执不一致时停用规则；存在未知执行时停止优化。运行记录不等同于持续运行的健康证明，worker 心跳和运维验收仍需补齐。
- TikTok 仍仅支持人工 Spark 创建及启停，不支持审批、自动优化或调预算；Google 同样未开放审批和自动执行。已有计划可只读导入，导入不会生成执行回执或授予控制权。
- `schemaReadiness.ts` 只检查广告业务集合，不包含共享租约集合及其唯一约束；报告 `ready` 不证明租约基础设施、worker 或平台权限可用，真实验收须另外核对这些前置条件。

## 已核验官方来源（2026-09-12）

- Meta 官方 SDK：https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/README.md
- Meta AdSet 字段与枚举：https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adset.py
- Meta 币种偏移：https://developers.facebook.com/documentation/ads-commerce/marketing-api/currencies （主 agent 在 Chrome 核验 USD / CNY 偏移均为 100）
- Meta 官方 Marketing API 参考页读取遇到 HTTP 429，实际参数组合须通过目标账户验证。
- TikTok advertiser info v1.3：https://ads.tiktok.com/gateway/docs/index?doc_id=1739593083610113
- TikTok adgroup create：https://business-api.tiktok.com/gateway/docs/index?doc_id=1739499616346114 。当前 VIDEO_VIEWS 应使用 ENGAGED_VIEW 或 ENGAGED_VIEW_FIFTEEN，VIDEO_VIEW 优化目标已废弃；对应计费 CPV。
- Google Cloud 项目鉴权变更：https://developers.google.com/google-ads/api/docs/api-policy/developer-token
- Google REST 查询：https://developers.google.com/google-ads/api/rest/common/search
- Google Demand Gen 创建：https://developers.google.com/google-ads/api/docs/demand-gen/create-campaign
- Google 总预算：https://developers.google.com/google-ads/api/docs/campaigns/budgets/overview

## 测试

`npx tsx server/platformAds/metaAdapter.test.ts`

`npx tsx server/platformAds/execution.test.ts`

`npx tsx server/platformAds/oauth.test.ts`

`npx tsx server/platformAds/tiktokExecutionAdapter.test.ts`

`npx tsx server/platformAds/googleExecutionAdapter.test.ts`

`npx tsx server/platformAds/currencyExecution.test.ts`

`npx tsx server/platformAds/taskLock.test.ts`

`npx tsx server/platformAds/releasePolicy.test.ts`

完整投放隔离测试：`node scripts/test-platform-ads.mjs`。

三页及管理表单浏览器测试：`node scripts/test-platform-ads-ui.mjs`。默认使用本机 Google Chrome，可通过 `PLATFORM_ADS_TEST_CHROME` 指定可执行文件；全部 API 模拟，外部网络阻断，不连接应用后端。

测试不会发起真实广告平台写入。


## P1 成片绑定、上传与预检（2026-09-27）

- `/creative-sources` 列出当前租户社媒内容中已持久化的视频 artifact；目录尚不覆盖工作室全部导出。分页按原 artifact 集合，过滤后可能出现空页。
- `GET/POST /tasks/:taskId/creatives` 查看 / 绑定成片。仅同平台、同币种账户的人工草稿可绑定，已有执行或启动记录时拒绝换绑。拒绝任意 URL、路径或手填平台视频 ID；保存来源及 SHA，更新计划版本并清空旧方案 / 授权。
- `POST /tasks/:taskId/creatives/:creativeId/upload` 将已绑定的 MP4 发送到 Meta 账户；64 MiB 是本产品首版限制，不是平台最大值。上传前验证归属与字节 SHA、租约和持久化回执；未知结果阻止重传。
- 同路径 `/reconcile` 只读取已保存视频 ID 的平台状态并更新本地回执。仅 `video_status=ready` 可用；处理中不算成功。平台已接受但视频 ID 未能持久化时，需要账户管理员人工核对，当前不提供盲目重传或任意 ID 恢复。
- 上传需要现有平台写入开关允许 Meta create，但不会创建或启用广告。接口权限、人工模式、计划版本和账户状态仍需通过。绑定、上传和平台广告执行分别产生独立操作。
- `POST /tasks/:id/preflight` 是本地只读预检，需要操作角色，不解密令牌、不调用平台、不写库。通过只代表当前保存信息和输入没有已知阻塞，不能替代线上账户 / 审核 / 预算验证。
- Meta 人工创建可传 `creativeId`（本地素材绑定 ID）。服务端核对任务、版本、账户、源绑定与上传回执，再取平台 videoId；执行回执同时保存 `creativeBindingId`、`creativeSha256`、`creativeVideoId` 和 Meta 自身的 `creativeId`。绑定成片的直接创编目前不接审批或自动启动路径，原手填平台 ID 路径保留。
- TikTok 仍用既有 Spark 帖子人工投放；成片绑定只记录来源，不提供 TikTok 上传、帖子授权或自动投放。

新集合：`platform_ad_creatives`。已添加 `pb_migrations/1790640001_create_platform_ad_creatives.js`、本地初始化定义和只读 schema 检查。本任务没有执行数据库迁移；使用前需在目标开发环境完成数据库变更并验证共享租约基础设施，不能把代码测试通过视为目标环境已就绪。

官方接口核验：Meta 官方 Business SDK 的 [AdAccount.create_ad_video](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py) 定义 `POST /advideos` 与 `source:file`；[AdVideo](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/advideo.py) 和 [VideoStatus](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/videostatus.py) 定义视频状态读取。依据官方 SDK 实现，未用真实账户验证权限及参数组合。

新增隔离测试包括 `creativeChain.integration.test.ts`：源成片 → 绑定 → mock 上传 → 状态核对 → 本地预检 → mock 暂停创建，全程不接触真实平台。

### P2 evidence and metric history

`GET /automation/status` reads tenant-scoped persisted worker checks. Configuration alone is not liveness; stale or absent evidence stays unknown. Automatic rule decisions persist a structured `decision` with plan/rule versions, measured samples, proposed budget and execution linkage before provider effects. Budget-after is a proposal, not proof of success.

`POST /tasks/:id/metrics/sync` (write role) explicitly reads the existing recent-seven-day platform report and saves resource/day snapshots under a tenant lease with readback verification. `GET /tasks/:id/metrics/history?since=YYYY-MM-DD&until=YYYY-MM-DD` reads local snapshots only (max 366 days). Resource identity includes provider/account/campaign/date/currency/metric definition; repeated syncs correct values, shared tasks do not create duplicate resource rows. No missing-value zero fill, arbitrary historical backfill, timezone conversion or cross-currency totals. Partial persistence can be repaired by retry; an empty report does not erase old rows.

Schema artifact: `1790640002_platform_ad_evidence.js`. It is not applied by these tests. Worker activation, production migration and real advertising acceptance are separate operations; this change does not authorize them.
