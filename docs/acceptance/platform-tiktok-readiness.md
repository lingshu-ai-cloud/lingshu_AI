# TikTok Direct Post 接入准备审计

2026-10-10；仅源码、官方文档和受控端口验证。生产状态 **blocked**。没有读取或记录凭据，没有授权、真实发布、迁移或付费。配套机器可读模板为 `fixtures/platform-production-readiness/tiktok.json`，不是生产批准证据。

## 配置与租户身份

`server/lib/tenantPlatformApps.ts` 从 `tenant_platform_apps` 按租户和 `platform=tiktok` 读取 `app_id`（client key）和加密 `app_secret`；不完整时回退共享 OAuth 配置。必须事先确认该回退与租户应用审批身份一致。共享字段 `tiktokClientKey/tiktokClientSecret` 最后回退 `TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET`。生产需 `TENANT_PLATFORM_APP_KEY` 加密租户应用秘密，`PLATFORM_TOKEN_ENCRYPTION_KEY` 保护账号凭据。秘密必须在安全配置界面/secret store填写，本文模板不接收值。

配置 `PUBLIC_BASE_URL` 后，回调为 `https://PUBLIC_ORIGIN/api/overseas/social/oauth/tiktok/callback`。门户登记值必须与运行时完全一致；OAuth state 应一次性核对租户、用户、过期时间。官方 Login Kit 要求注册 redirect URI、CSRF state、安全存储及 token 到期前刷新。[Login Kit Web](https://developers.tiktok.com/docs/en/login-kit-web)

`socialOAuthScopes.ts` 默认只请求 `user.info.basic`；`TIKTOK_DIRECT_POST_RELEASE_MODE=approved` 才请求 `video.publish`；`TIKTOK_READ_FEATURES_ENABLED` 增加 profile/stats/video.list。设置 approved 只打开本地 scope 请求，不能证明供应商批准。连接后 `social_accounts` 保存 tenantId/platform/providerAccountId(open_id)/sealed accessToken/refreshToken/tokenExpiresAt/scope/status，不能把 connected 视为发布可用。

## 供应商审批与用户体验

需分别取得 Login Kit、Content Posting API Direct Post、`video.publish` 及 Direct Post audit 的门户证明。目前全为未核验，不能只凭 keys 或能力 probe 宣告生产就绪。未审查客户端仅 SELF_ONLY，最多五名用户/24h且账户须私密；公开首发必须获审查批准。各客户端还受活跃创作者和共享每日发帖上限约束。产品不能只面向团队自管账号上传；需为真实创作者提供广泛可用的原始内容分享。审核材料须展示账号昵称、手动无默认隐私、互动选择、商业内容披露、音乐同意与明确提交授权。[Content Sharing Guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines)

渲染发布页时必须获取最新 creator_info：合法隐私选项、互动禁用状态、最长时长；返回发帖限制时停止。该接口需要 video.publish，限20请求/分钟。[Query Creator Info](https://developers.tiktok.com/docs/en/content-posting-api-reference-query-creator-info)

## 现有合同与实际缺口

`platformCapabilities.ts` 核对账户 open_id、scope，并通过 creator_info 端口探测；成功证据短期缓存并记录账户 identity hash；当前 TikTok 缓存读取未强制用该 hash 判失效，所以每次真实 publish 仍重新核验 userinfo、token 与 creator，不能仅依赖缓存。probe 现在必须收到 error.code=ok，但仍只作为权限探测，不能代替每次发布的完整创作者校验或外部 audit。

本轮正式 runtime 增加 `tiktokPostOptions`：用户明确选择隐私、互动、商业披露、AIGC 和音乐/发送同意，无选项时拒绝，不默认公开。每次发布读取同 token creator_info，按可用隐私/时长/互动验证；在准备回执持久化后再次核对 creator 设置，变化则不 init。实际视频时长用本地 ffmpeg 测量，单chunk限制至64MiB且上传有界。userinfo与账户重新读取核对租户、账号、open_id、token hash。

canonical 元数据写在已有 `posts.stats.publishResults[accountId]`，无需新 migration。先保存同一 attempt 的版本化 creator/settings/options/video SHA/身份 hash 回执，再 init；响应返回 publish_id 与上传 URL hash 后原子保存，最后 PUT。raw token 和带签名上传 URL 不进入该回执。PUT失败保留原publish_id；init响应丢失没有真实远端ID，只保留原attempt未知，禁止伪造查询ID或重发。外部 weekly/scheduled 使用同attempt callbacks；正式 weekly worker 的丢失外层回执恢复仅从同 tenant/account/attempt 的 canonical 已持久真实 publish_id 修复，再走原回执状态查询；没有真实 ID 保持 unknown，不重新提交。回执 ID 允许官方示例中的 `~` 与 `.`，仅拒绝空值、控制字符和过长值。creator/preinit/receipt持久化失败均不能越过对应effect。HTTP200非ok也拒绝，所有TikTokHTTP禁止重定向。

当前只支持 FILE_UPLOAD，URL pull尚未实现/证明域名所有权。用户操作页已接完整选择、披露、音乐与发送同意及预览编辑合同；creator展示HMAC和choices纳入审批hash，创建/审批fresh查询及真实发布prepared callback再重验。供应商 audit与真实grant仍需独立证据；自动token刷新未开放，失效凭据拒绝并要求重新授权。本轮后端保护不能自动生成用户选择或供应商批准。init需明确用户授权和合法privacy；官方限6请求/分钟，URL pull另需域名所有权。[Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post)

成功上传只表示 provider_accepted，publish_id不是公开帖子ID。现 status/fetch仅查询原publish_id；PUBLISH_COMPLETE且publicaly_available_post_id非空才计公开终态，空ID保持unknown；PROCESSING_*保持处理中，FAILED失败。官方状态接口限30请求/分钟，公开post ID需审核完成；私密帖子可能没有公开ID。[Get Post Status](https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status)

weekly/direct/scheduled层已有accepted receipt恢复与重复提交阻断，本轮补齐init断点及HTTP200 envelope，自动token刷新仍未核验。unknown不得通过重复init猜测恢复，需按同租户、账号、attempt、原publish_id查询；无法获取原receipt则人工对账。受控测试不能代替门户批准或用户授权。

## 验证与后续证据

运行 `node --import tsx --test scripts/platform-tiktok-readiness.controlled.test.ts`；可叠加主任务的全出站阻断runner。测试只mock axios，未监听本地端口，默认拒绝未登记请求。它验证scope gate、token请求合同、creator探测、异步accepted语义和原receipt状态查询，并验证准备/原回执持久化、creator变化拒绝以及上传失败窗口；不把后端受控通过当作供应商合规批准。

后续需填写门户审批reference（无secret）、回调截图/登记证明、当前账户scope/身份probe、审核UX证据、正式修复测试及明确批准的单次验收记录。保持 productionReady=false，直到每项真实证据齐备。

内部UX受控覆盖：`src/lib/tikTokPostSettings.test.ts`、`src/components/publishing/TikTokPostSettings.test.tsx`、`server/publishing/tiktokCreatorConsent.test.ts` 和 publisher display-hash mismatch 集成负例。真实平台审核结论仍未取得。
