# Meta Social / Instagram Login 生产准备清单

核查日期：2026-10-10。范围为当前源码、官方文档及 controlled tests 合同；没有读取部署密钥、启动真实授权、调用真实平台发布、执行迁移或打开生产开关。本文件和 JSON 是待填证据模板，不是生产通过证明。

状态：`implemented` 表示源码已有；`livevalidationmissing` 表示尚无该部署/租户的真实证据；`productionapproval` 表示需要明确生产授权及平台资格，不能由本地测试替代。

## 1. 两种 Instagram 合同不得混用

| 路径 | 应用配置 | 账号保存 | API host / token | 发布权限 |
| --- | --- | --- | --- | --- |
| Facebook / 旧 Instagram | `tenant_platform_apps.platform=meta` | Facebook Page ID；旧 IG 的 Page-linked professional account ID；IG `oauthProvider=facebook_login`（缺省值兼容） | `graph.facebook.com`；Facebook Page token | Facebook `pages_manage_posts`；旧 IG `instagram_content_publish`，授权流程还请求 `instagram_basic/pages_show_list/pages_read_engagement` |
| Instagram Login | `tenant_platform_apps.platform=instagram` | `/me.id` 写 `social_accounts.providerAccountId`；`oauthProvider=instagram_login` | `graph.instagram.com`；IG User token | `instagram_business_basic` 与 `instagram_business_content_publish` |

`implemented`：共享 `server/publishing/instagramPublishingContract.ts` 固定 host/token/scope；未知 provider 拒绝。Instagram OAuth 返回的 `user_id` 与 Graph `/me.id` 可不同：源码通过 `getInstagramLoginAccount` 的 `id` 保存发布账号，不改用 OAuth `user_id`。官方两套登录/权限合同见 [Meta 官方 Instagram Login 集合](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login) 和 [Meta 官方 Instagram API 文档](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-15c537cd-a773-4b40-a87c-27829e49a439)。

## 2. 确切配置名与租户 schema

以下只填写“已安全配置/缺失”及脱敏证据编号，禁止填写实际 secret/token。

| 配置 | 用途 / 准备要求 | 状态 |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | 实际公共 HTTPS origin；避免按不受信任 host/proxy header 推导回调；需与平台白名单精确相同 | livevalidationmissing |
| `TENANT_PLATFORM_APP_KEY` | production 强制必填；AES-256-GCM 租户 app secret/账号 token 加密及 OAuth state HMAC 共用 key；需持久且所有实例一致 | implemented / livevalidationmissing |
| `OAUTH_STATE_SECRET` | 只在非 production 且没有上述 key 时作为 fallback；不能替代 production 的 `TENANT_PLATFORM_APP_KEY` | implemented |
| `META_GRAPH_VERSION` | 未填源码使用 `v25.0`；需与平台应用支持的实际版本核对，不将默认值当批准 | livevalidationmissing |
| `META_SOCIAL_APP_ID`, `META_SOCIAL_APP_SECRET` | 仅无 tenant 的全局调用可用；租户不可 fallback。全局别名为 `WHATSAPP_EMBEDDED_SIGNUP_APP_ID/SECRET` | implemented / livevalidationmissing |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | 仅无 tenant 的全局调用可用；租户不可 fallback，与 Meta app 配置分离 | implemented / livevalidationmissing |
| `INSTAGRAM_CONTENT_PUBLISH_ENABLED` | `1/true/yes/on/enabled` 才在新 OAuth 请求中加入 native publish scope；不是发布批准 | implemented / productionapproval |
| `INSTAGRAM_COMMENTS_FEATURES_ENABLED` | 可选 native comments scope，发布不依赖它 | implemented |
| `META_COMMENTS_FEATURES_ENABLED`, `META_INSIGHTS_FEATURES_ENABLED`, `META_WEBHOOK_FEATURES_ENABLED`, `META_BUSINESS_ASSET_FEATURES_ENABLED` | 各自增加额外旧 Meta scopes；只开获批用途 | implemented / productionapproval |
| `SOCIAL_WEEKLY_REAL_PUBLISHING_ENABLED` | 必须精确 `true` 才启用正式 weekly 发布；默认不打开 | implemented / productionapproval |
| `R2_PUBLIC_URL` | 当前发布器生成公网视频 URL 的配置名（即使底层对象存储使用 COS，仍需核实该 URL 与实际返回资源是否匹配）；也可在获准 direct 路径传入视频 URL | livevalidationmissing |
| `OBJECT_STORAGE_DRIVER=cos` 与 `COS_REGION/COS_BUCKET/COS_SECRET_ID/COS_SECRET_KEY` | production 对象存储要求；可用源码支持的对应 `OBJECT_STORAGE_*` aliases；密钥只进安全配置系统 | livevalidationmissing |
| `COS_PUBLIC_URL` 或 `OBJECT_STORAGE_PUBLIC_URL` | 对象存储公网资源入口，需真实 HTTPS 可读取并匹配上面的发布 URL | livevalidationmissing |
| `SOCIAL_MAX_UPLOAD_MB` | 本地发布文件大小上限，未填为 2048；平台真实格式/大小限制仍由 G6/交付检查核验 | implemented / livevalidationmissing |

租户 app：`tenant_platform_apps`，唯一键 `(tenant_id, platform)`。本范围 `platform=meta|instagram`；核心字段 `app_id`, 加密 `app_secret`, `webhook_verify_token`, `page_id`, `ig_user_id`, `access_token`, `token_expires_at`, `token_type`, `status`。`status` 为业务配置状态，不能代替 provider OAuth/capability 证据。`token_type` 旧字段仅 `user_60d|system_user_permanent`，没有 native publishing adapter 依赖该字段；实际发布读取 `social_accounts` 的加密 `accessToken`。

配置接口：`GET/PUT /api/overseas/platform-integrations/oauth-config`（requireAuth，按 `res.locals.tenantId`）；删除 `DELETE .../oauth-config/:platform`。提交字段 Meta 为 `metaSocialAppId/metaSocialAppSecret/metaWebhookVerifyToken`，native 为 `instagramAppId/instagramAppSecret/instagramWebhookVerifyToken`。公开读响应只使用 secret-set/length 元数据。

源码 migration 存在：`1783000000_created_tenant_platform_apps.js`、后续 delivery/schema 扩展、`1791535000_add_instagram_tenant_app.js`、`1791535001_extend_social_accounts_instagram_login.js`，另有发布/attempt/receipt/交付集合迁移。`livevalidationmissing`：尚未验证目标部署已经应用全部迁移与唯一索引。本阶段不执行迁移。

`implemented`: Tenant-specific OAuth config must be unique, owned by that tenant/platform and complete. Missing, foreign, ambiguous or incomplete config fails closed without global fallback.

## 3. Callback、state 与 scopes

- `implemented`：`POST /api/overseas/social/oauth/facebook/start` 与 `.../instagram/start` 需要登录态。`GET .../oauth/:platform/status` 返回当前租户配置、回调和请求 scopes。callback 在 `socialRouter.use(requireAuth)` 前接收 provider 回跳。
- 白名单精确地址：`${PUBLIC_BASE_URL}/api/overseas/social/oauth/facebook/callback`、`${PUBLIC_BASE_URL}/api/overseas/social/oauth/instagram/callback`。授权请求和 code exchange 使用同一 `redirectUri`。Meta 用户授权 host 为 `www.facebook.com/{version}/dialog/oauth`，native 为 `www.instagram.com/oauth/authorize`。
- `implemented`：state HMAC-SHA256，包含 tenantId/userId/platform/returnTo/随机 nonce/10 分钟过期；签名恒定时间比较，callback 比对 platform，returnTo 只允许本地 `/` 路径且拒绝 `//`。
- `implemented`: Durable issued/consumed nonce is consumed once before token exchange and never released after failure. Production requires the existing atomic durable_operation_leases uniqueness capability; otherwise it fails closed. Local exclusive files + fsync reject replay across processes/restarts. PUBLIC_BASE_URL requires a strict HTTPS origin, and exact redirectUri plus client credential identity are bound to state. Controlled tests: 10/10; real deployment storage and platform allowlist remain livevalidationmissing.
- Meta base scopes `pages_show_list/pages_read_engagement`；Facebook default 再请求 `pages_manage_posts/pages_messaging/pages_manage_metadata`；Facebook `purpose=messenger` 只走 messaging 组合。旧 IG 由 Meta 账号绑定流程产生，普通 `/oauth/instagram/start` 已使用 native Login。
- native base scopes `instagram_business_basic/instagram_business_manage_messages`；开启发布 flag 再加 `instagram_business_content_publish`。当前 callback 强制消息权限，即使仅发布权限已获准，缺消息权限也不能完成这条现有连接流程。用户重授权后保存实际返回 `tokens.permissions`，开 env 本身不会升级旧 token。
- `implemented`：native code exchange `api.instagram.com/oauth/access_token`，long-lived exchange `graph.instagram.com/access_token`；账号查询 `graph.instagram.com/{version}/me`。60 天 token 续期路径已有：未过期且进入 14 天窗口时尝试 refresh，过期标记 `expired` 需要重连。`livevalidationmissing`：真实续期、撤回权限、真实 token expiry 尚未本次验证。

## 4. Capability 与 durable receipt

`implemented`：native publishing probe 不使用旧 Meta probe；先验证存储的两项 native scopes，再用 IG User token GET `/me` 精确核对 ID，以及 `/{id}/content_publishing_limit?fields=quota_usage,config` 作实际只读 publishing permission observation。响应须为唯一 quota record，usage/total 为有效整数；quota 是否够用仍需独立实际配额门禁。不能仅凭 `connected`、env、scope 文本或 operator review 开发布。probe 固定官方 host，`maxRedirects=0`；native fake port 未提供则拒绝，绝不回落 legacy。当前 OAuth provider、native ID、scope、加密 token 纳入 account identity hash，旧证据不能跨 provider 复用。

`implemented`：创建 Reel 容器 POST `/{ig_id}/media` 后先持久化 `ig-container:{container_id}`；poll 同容器 GET，提交 `/{ig_id}/media_publish` 前再次验证 source/lease；成功返回原媒体 ID后立即持久化。`finalizeTracking:false` 必须提供两种持久化 callbacks。weekly attempt 绑定同 tenant/assignment/package/provider/attempt 唯一 in-flight；stored container/media ID 不得被换掉。

`implemented`：恢复只 GET 原容器/已保存媒体 ID，不重新 create/publish。native 原媒体还核对目标账号 `/media` 列表内的精确 ID，最多 5 页只消费 cursor、不跟随 provider next URL。容器 `PUBLISHED` 却没有原媒体 ID仍为 unknown，不扫描最近媒体猜结果。content_publish 撤回后 basic 尚在可尝试只读恢复；不把成功查询当新发布权限。定时发布 unknown 恢复不增加 publishAttempts；多账号有未发目标时不进入 unknown 恢复。错误后已有容器/媒体身份保留，后续沿原 attempt 查询。

`livevalidationmissing`：真实 Meta app 的 callback/token/grant、实际 professional account 身份、quota、公开媒体取回、真实容器状态、真实回执到账/故障恢复均未验证。controlled tests 的成功只说明本地合同与幂等边界，不是生产交付证据。

## 5. 生产批准清单

- `productionapproval`：负责人确认实际 app、实际租户与目标账号；客户授权范围、账号所有权及发布内容批准留证。
- `productionapproval`：对应 Meta App 产品/权限的 App Review、适用 access level、应用 Live mode、所需 business verification 与隐私政策/数据删除设置以真实 dashboard 记录核对。Standard/tester 能通不等于外部客户可用。
- `productionapproval`：最终用户批准、G4真实同源媒体检查、独立 G5导演审核、G6账号能力/配额/格式/真实 assignment/接待能力检查全部通过；Instagram还需 packaged technical/creative review。不能用 pending boolean 或 controlled fixture 替代。
- `productionapproval`：确认正式发布窗口、tenant bounded authorization、未知结果处理负责人，才允许另行批准首次真实授权/发布/开关。此次任务没有这类授权。

官方参考：[Meta Instagram Login 概览](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/)、[Meta native 内容发布](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing/)、[Meta Facebook Login 流程](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/)、[Meta Permissions Reference](https://developers.facebook.com/docs/permissions/)、[Meta 官方旧登录集合](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-ab559ffb-8e2c-4b0a-b43a-5737b6d2f672)。本次 browse 对 developers 页面遇到不可访问/429，Meta 官方 Postman 的检索可核权限合同；productionapproval 项仍须获准后在实际 dashboard 核对，不宣称已在线验证审核状态。

## 6. 建议的 controlled 检查（不执行真实网络）

现有测试：`server/lib/socialOAuthScopes.test.ts`、`server/lib/tenantPlatformApps.oauthCredentials.test.ts`、`server/security/oauthConfigPersistence.test.ts`、`server/integrations/instagramLogin.test.ts`、`server/publishing/instagramPublishingContract.test.ts`、`server/publishing/platformCapabilities.test.ts`、`server/publishing/instagramContainerPersistence.test.ts`、`server/publishing/instagramNativePublishing.test.ts`、`server/publishing/instagramWeeklyReceiptIsolation.integration.test.ts`、`server/publishing/scheduledPublisher.test.ts`、`server/publishing/weeklyProviderRecoveryAcceptance.test.ts`。

补充建议：用假 OAuth provider+禁止未声明 network 出口测试 callback replay/过期/platform串用/跨租户app fallback；续期与撤权模拟；强制断网与持久化失败后多周期 same-attempt 只查原 receipt、POST计数始终1；native↔legacy 切换不得复用 capability hash；公开视频 URL 与存储对象字节/hash重验。文档模板变更只检查 JSON 解析、必填证据字段和无 secret 值；本阶段已执行受控 runtime 回归，结果见独立提交的证据记录。
