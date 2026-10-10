# WhatsApp / Messenger / Instagram 消息渠道生产准备

审计日期：2026-10-10。结论：**生产授权与外发保持 blocked**。本轮仅源代码审计、官方资料查阅和完全受控内存测试；未加载真实 secret、未执行 OAuth、未监听本地端口、未调用平台、未发送消息或运行迁移。配置存在、connected 标志及本地测试通过均不能替代真实租户授权、平台审核或消息回执。

## 配置与持久化合同

| 配置 | 当前实现与验收要求 |
|---|---|
| `TENANT_PLATFORM_APP_KEY` | production 必填；tenant app secret、access token、social account credential 经 AES-256-GCM 加密。禁止把值写进本报告、fixture、日志或命令。`PLATFORM_TOKEN_ENCRYPTION_KEY` 并非当前 `accountCredentials.ts` 的加密配置。 |
| `PUBLIC_BASE_URL` | 生产必须给明确 HTTPS origin；缺省代码使用请求 host / forwarded proto，不能把这种回退当生产回调已注册。 |
| `META_SOCIAL_APP_ID` / `META_SOCIAL_APP_SECRET` | 仅无 tenant 的全局配置；租户 OAuth 不允许 fallback。别名为 `WHATSAPP_EMBEDDED_SIGNUP_APP_ID` / `WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET`。tenant app 优先，不能只配置全局而假称已绑定客户 WABA/Page。 |
| `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` | Instagram Login 无 tenant 时的全局配置；租户须有完整唯一 `platform=instagram` app；不同于 Meta/Facebook Login app。 |
| `META_GRAPH_VERSION` | 后端缺省 `v25.0`；Embedded Signup 前端当前固定 `v25.0`，需按平台审核后的实际版本核对。 |
| `FOLLOWUP_WORKER_ENABLED` | 仅精确 `true` 开启定时跟进；不是租户消息授权。客户配置还须 active、正整数 config_version、customer workflow enabled、`allowRealCustomerMessages=true`。 |
| `OAUTH_STATE_SECRET` | 仅非 production tenant-key 缺失时的回退；production 不能依赖开发默认密钥。 |

`tenant_platform_apps`：`tenant_id, platform, app_id, app_secret, wa_config_id, business_id, waba_id, phone_number_id, wa_public_number, page_id, ig_user_id, webhook_verify_token, token_type, access_token, token_expires_at, status, last_checklist`。WhatsApp 的正式账号就是该记录，不制造 `social_accounts` 行。canonical proof 绑定 tenant、record ID、app ID、WABA、phone、状态、过期时间与凭据 hash。

`social_accounts`：`tenantId, userId, platform, providerAccountId, accessToken, refreshToken, tokenExpiresAt, scope, parentPageId`；Messenger 另有 `messengerSubscribed, messengerSubscriptionError`；IG 另有 `oauthProvider, instagramWebhookSubscribed, instagramWebhookSubscriptionError`。IG native `/me.id` 写 `providerAccountId`，OAuth 返回 `user_id` 不能直接替换；webhook messaging ID 通过受控身份查询映射，且再次核对 Graph ID。schema/migration 文件存在不代表目标数据库已应用，本轮没有迁移。

代码依据：`server/lib/tenantPlatformApps.ts`、`oauthConfig.ts`、`accountCredentials.ts`、`server/whatsapp/canonicalAccount.ts`、`server/routes/social.ts`；迁移包括 `1783000000_created_tenant_platform_apps.js`、`1783900000_extend_tenant_platform_apps_delivery_fields.js`、`1782656654_created_social_accounts.js`、`1791072007_fix_publishing_schedule_and_messenger_status.js`、`1791535000_add_instagram_tenant_app.js`、`1791535001_extend_social_accounts_instagram_login.js`。

## 授权入口与权限

| 渠道 | 入口、平台对象与权限 |
|---|---|
| WhatsApp | 前端 `/api/oauth/whatsapp/config` 与 `/api/oauth/whatsapp/exchange`；需要 tenant Meta app 的 app ID / secret / `wa_config_id`。FB SDK 使用 `response_type=code`、`override_default_response_type=true`、`featureType=whatsapp_business_app_onboarding`、`sessionInfoVersion=3`。仅接收 Facebook 可信 origin 的 `WA_EMBEDDED_SIGNUP` FINISH / FINISH_ONLY_WABA 数据。code 与 WABA/phone session 必须齐全；正式父路由已挂载；受控测试覆盖实际路径和资产门禁。平台侧应复核 WhatsApp messaging / management 权限、客户业务资产、号码注册、订阅和收费账户；不是填写配置即可完成。 |
| Messenger | 已登录用户 POST `/api/overseas/social/oauth/facebook/start`，body `purpose=messenger`；callback `${PUBLIC_BASE_URL}/api/overseas/social/oauth/facebook/callback`。请求 scopes：`pages_show_list, pages_read_engagement, pages_messaging, pages_manage_metadata`。使用所选 Page 的 Page token，保存 tenant/user/Page ID，并调用 Page `/subscribed_apps`。Meta 官方 Send API 要求 Page token、MESSAGE task 及 `pages_messaging`，普通回复受标准 24 小时窗口限制。[Meta Send API](https://www.postman.com/meta/messenger-platform-api/folder/vilwbh4/send-api) |
| Instagram Login | POST `/api/overseas/social/oauth/instagram/start`；callback `${PUBLIC_BASE_URL}/api/overseas/social/oauth/instagram/callback`。基础 scopes 为 `instagram_business_basic, instagram_business_manage_messages`；发布及评论 flag 另加各自权限。token 经 Instagram OAuth/长期 token exchange，核对 `/me`，必须实际返回 messages 权限后才保存；订阅失败保留 connected 但 `instagramWebhookSubscribed=false`，消息 readiness 关闭。native send 使用 `graph.instagram.com/{version}/{IG Graph ID}/messages`，recipient 是 verified inbound 的 IG scoped user。官方文档把 native messages endpoint 与该消息权限配对。[Meta Instagram API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-1ff01566-3509-48bd-a0f4-8571a91ccfdf) |
| Instagram Facebook Login 兼容 | `oauthProvider=facebook_login`，使用 Page token、`parentPageId`、`instagram_manage_messages` 与 Facebook Graph messages endpoint。当前新 Instagram OAuth 默认 native；legacy 消息功能只有显式 `META_INSTAGRAM_MESSAGING_FEATURES_ENABLED=true` 才请求 `instagram_basic,instagram_manage_messages,pages_manage_metadata`，不得把 publishing 授权当 messaging 授权。 |

OAuth state HMAC 绑定 tenant/user/platform/returnTo/purpose 与精确 callback URI，10 分钟 TTL；callback 在 exchange 前原子消费持久 nonce。生产复用既有 `durable_operation_leases` 的唯一原子约束，缺乏该能力则拒绝；本地开发使用 exclusive 文件与 fsync，跨进程与重启重放受控测试通过。tenant app 缺失或不完整不回全局配置，生产 origin 只接受合法 HTTPS PUBLIC_BASE_URL，不借 Host/Forwarded header。

Meta 官方样例覆盖 Embedded Signup 与客户 WABA/号码管理，本轮未执行其 onboarding。[Meta business messaging sample](https://github.com/fbsamples/business-messaging-sample-tech-provider-app)。官方 Embedded Signup implementation 页面本次读取返回 429，具体审核/权限等级需在 Meta 控制台及当前官方文档人工复核，不从第三方文章推定已批准。

## Webhook 安全与证据

公开 callback 为 `${PUBLIC_BASE_URL}/api/webhooks/meta/{tenantId}`、`${PUBLIC_BASE_URL}/api/webhooks/instagram/{tenantId}`。GET 仅在 tenant app 的非空 verify token 匹配且 `hub.mode=subscribe` 时返回原 `hub.challenge`；挑战完成只证明 callback 可验证，不能证明消息权限或租户账号归属。Meta 官方 SDK文档说明 GET challenge 与 POST `x-hub-signature-256` 的不同验证职责。[Meta WhatsApp webhook SDK](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/)

POST 由 `server/index.ts` 的 JSON verify 保存原始 Buffer，`webhooks.ts` 严格检查 sha256 header，然后按 tenant-owned app secret HMAC 原始 bytes。无 rawBody 返回 503、签名错 403、未配置 app 404、unsupported object 400。IG webhook 可使用同 tenant 的 IG secret 或 Meta secret；这个兼容分支仍不能跨租户认证。签名通过后必须进一步绑定账号：WA 同 WABA + phone；Messenger 同 connected tenant Page；IG 同 connected Graph ID /已核验 messaging ID，legacy Page payload 还匹配 parent Page 与消息参与者。

发送策略按实际 channel 读取配置；WhatsApp 授权不能开启 Messenger，Facebook Page 授权不能开启 IG。过期 token、错 tenant、错 platform、未订阅或无消息 scope 都关闭相应 readiness。Messenger/IG 普通消息实际发送入口再次检查 verified buyer 最近互动的 24 小时窗口。

消息 API 接受不等于 delivered/read：`customer_channel_send_requests` durable intent 绑定 tenant/channel/requestId、actor/customer/account、recipient/body hash 和 account authority hash。accepted 需真实 provider message ID、exact recipient，并先持久化再写历史；重复请求返回原 receipt，intent 改变拒绝，unknown/sending 相同意图不可用新 requestId 重提。signed delivery/read/echo 后续证据再绑定 tenant/native account/recipient/message ID、event hash、signed body hash 与 occurredAt；错误账号或收件人拒绝。WA message/status也按 verified tenant WABA/phone入口处理。不要把合成 ID 或本轮受控 port receipt 当真实 provider 证据。

## 生产阻塞与验收清单

当前代码阻塞：

1. 已修复并受控验证：正式父路由挂载前端实际 Embedded Signup config/exchange 路径。
2. 已修复并受控验证：token app/scopes、WABA phone 归属、号码精确 ID、订阅成功、本地 foreign owner 与配置版本 admission。真实号码注册、真实业务收费资格、真实 app review 仍未外部验证。
3. Messenger 内部门禁已实现：实际 token/debug scopes、Page identity、订阅 success=true 与当前 app 订阅回读，再生成有限时效的账号凭据绑定 proof。旧 connected/subscribed/requested scopes 不授予消息能力；真实权限/app review 尚未外部验证。
4. OAuth 持久 nonce与 callback fallback 内部合同已实现；legacy IG 消息 scope 已作为显式功能 flag 加入请求合同。真实用户是否授予权限仍需平台证据。

外部及运行证据尚未观察：租户业务授权、平台 app review/advanced access、真实 Page/WABA/IG token scope与任务授权、号码/专业账号条件、HTTPS exact callback注册、真实 challenge、签名真实入站、账号归属及唯一绑定、持久化 DB/lease/schema、worker heartbeat、限定授权收件人和消息窗口、真实 provider ID、signed delivery/read、token撤销/过期与禁止重发恢复。**所有 live 验收需要另行明确授权，当前不得外发。**

本轮测试 `scripts/platform-messaging-readiness.controlled.test.ts`：hard fetch/socket block，纯 HMAC/state/challenge/helper，WA WABA/phone过滤，IG entry选择，正式消息策略读取，内存 durable send-intent idempotency与signed receipt绑定；只有一个注入内存 send callback，无网络/平台发送。它不启动API服务、不证明OAuth浏览器流程/真实challenge路由可达，也不证明Postgres唯一索引与跨进程锁。

脱敏机器可读清单：`fixtures/platform-production-readiness/messaging.json`。其中 placeholders 仅表示待取证字段，不能作为可执行真实凭据或生产 passed 状态。

## WhatsApp runtime correction (controlled evidence)

The production parent now mounts the actual frontend `/api/oauth/whatsapp/config` and `/exchange` paths. Existing production customer execution remains mounted at `/api/overseas/digital-employees`, `/api/overseas/quote-skill` (draft send-card), and `/api/webhooks` (signed inbound/status). OAuth mounting alone does not authorize customer content or sending.

Exchange requires valid app-bound token with both WhatsApp scopes, WABA phone membership, exact phone identity, successful WABA subscription, unchanged local account configuration, and no foreign tenant owning the phone. Only then does it persist a credential-bound asset proof in the existing checklist. Canonical content/receipt account authority and sending require that proof. Legacy active records require verified re-authorization; configuration metadata remains observable but supplies no message authority. No migration or real authorization was performed.

Each text bubble and the image send after upload re-read canonical account version, tenant consent and signed native inbound recipient evidence. Text/image require inbound within 24 hours. Templates conservatively require a historical verified native inbound recipient; this does not establish template approval or current external eligibility. Provider responses must contain exactly one message and one recipient matching the intended number. Unknown recovery continues to inspect original signed intent/status and never submits a replacement.

Controlled evidence: `server/whatsapp/productionBoundary.integration.test.ts` executes the actual parent-mounted router without TCP, mocks only provider transport and datastore, blocks fetch/socket access, and checks foreign tenant, foreign local asset, failed identity/subscription, credential rotation, revoked consent and wrong-recipient response. `canonicalAccount.test.ts` and `verifiedInbound.test.ts` cover verified account reading and real signed ingress persistence. This is controlled evidence, not live tenant authorization, provider review, or delivery verification.

Messenger capability correction: provider admission reads actual Page token grants and exact native `/me` identity, rejects invalid/expired/foreign-app tokens and granular grants for other Pages, requires `success=true` and subscribed-app readback. A distinct `messenger-proof-v1:` marker in existing scope storage binds tenant, local account, native Page, app and current token; it is not a permission. Its validity is at most ten minutes and no longer than provider token/data-access expiry. Legacy flags or requested scopes cannot create it. Shared selection, readiness, manual account and send contracts require the current proof. The concrete sender additionally probes using current tenant app credentials immediately before message HTTP and checks account authority again after probing. Expired evidence requires renewed verified capability; it is never revived by replaying an old signed marker. Controlled helper/admission/send-intent tests pass without real network or sends. Live app review, granted production permissions, connected tenant assets and delivery evidence remain unverified.

Expired Messenger proof can be renewed through authenticated `POST /api/overseas/social/accounts/:id/messenger/capability-refresh`. This performs provider GETs for token grants, native Page identity and subscribed-app readback; it neither subscribes nor sends. Successful revalidation signs a new bounded proof for the same account, after rechecking tenant app and account credential versions. Failed grants close Messenger capability. Existing old conversations lacking signed native account/recipient provenance remain excluded; a legacy flag or locally edited history does not become verified buyer evidence. No live refresh was executed.
