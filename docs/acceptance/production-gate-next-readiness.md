# 下一阶段生产 readiness 只读审计

2026-10-10；审计基于 HEAD `72281e6877616ffabb41bd589ff9179b6d859218` 及当前源码。未连接生产、未启动 server/index/workers、未调用平台或付费 provider、未部署迁移；仅新增本文和隔离测试。保留其它工作区改动。本报告中的本地 fixture 结果不代表生产状态。

## 九项门禁的准确分类

父会话提供的当前基线为 ready=false、九项阻塞。本轮以空配置、不可用基础设施的隔离输入复现九项结构，未重新观测生产。源码 `weeklyProductionEnvironmentReadiness.ts` 提供八项，`weeklyProductionEnvironmentProbe.ts` 加第九项。

| 检查 | 精确条件 | 分类与未证明内容 |
|---|---|---|
| postgres_business_store | DATA_BACKEND=postgres 且 DATABASE_URL非空 | 配置；不证明连接、schema、租户数据完整 |
| atomic_publication_lease | supportsAtomicOperationLease()为true | 已有代码；生产索引运行证据未提供。Postgres检查 idx_lingshu_durable_operation_lease_subject 的唯一/有效/ready/immediate、三列与collection谓词，PB返回false |
| durable_worker_queue | QUEUE_BACKEND=bullmq 且 REDIS_URL非空 | 配置；不证明worker消费 |
| production_auth_fail_closed | DISABLE_LOCAL_AUTH_FALLBACK=true 且 ENABLE_LOCAL_DEV_FALLBACK不为true | 静态发布策略。localFallbackPolicy在NODE_ENV=production无条件返回false；缺flag不是实际生产认证fallback漏洞 |
| meta_social_oauth | META_SOCIAL_APP_ID + META_SOCIAL_APP_SECRET非空 | 配置；不是平台审核/权限批准。OAuth运行解析还支持持久化配置及部分别名，env-only门禁与解析配置面不同 |
| instagram_login_oauth | INSTAGRAM_APP_ID + INSTAGRAM_APP_SECRET非空 | 配置；不证明专业账号、实际授予scope或token有效 |
| instagram_publication_scope | INSTAGRAM_CONTENT_PUBLISH_ENABLED trim/lower后为true | 请求权限开关；不代表平台授予。Login请求scope与发布实现有下述兼容缺口 |
| tiktok_direct_post | TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET非空且TIKTOK_DIRECT_POST_RELEASE_MODE严格为approved | 配置标记；不是TikTok批准权威记录，必须另外提供平台审批和账号provider权限证据 |
| durable_worker_queue_connection | checkBullMq成功且QUEUE_BACKEND=bullmq | 连接运行证据；不证明消费者持续运行、任务恢复或副作用成功 |

本机无PG/Redis设施。本轮没有发现上述数据库、lease或队列实现缺失；尚缺真实既有环境证据。probe.ready即使为true也仅表示这九项通过，其函数只列出以下六类运行要求，不消费/验证其证据。

## 六类运行证据仍需取得

1. `tenant_authenticated_scope`：实际认证租户、操作者权限与数据隔离。
2. `weekly_package_and_execution_graph`：持久化周包及执行图、版本和绑定关系。
3. `whatsapp_connected_account_and_approved_recipient`：真实连接账号、批准收件人及渠道约束。
4. `messenger_connected_page_and_scoped_recipient`：真实Page连接、收件人与允许会话范围。
5. `instagram_connected_professional_account_and_scoped_recipient`：专业账号、授予的消息权限及收件人范围。
6. `publication_account_token_and_provider_capability_receipt`：账号/租户/身份绑定、有效token、最新有期限的provider权限探测；发布后的真实回执及恢复链。fixture、operator_review、开关和登录Chrome都不能代替。

生产worker还需按现有 `server/runtime/readiness.ts` 的实际角色、队列及worker heartbeat检查观测；静态 capability 配置、一次Redis连接、隔离消费者合同均不证明活跃生产worker。外部模型/媒体provider、工具可执行性、长期队列恢复需另外验证，不能从九项推导。

## 确认的 Instagram Login 发布代码路径缺口

`server/routes/social.ts:401` 的connectInstagramLogin交换IG User token，保存 `oauthProvider=instagram_login`、`scope=tokens.permissions`、空parentPage；`server/lib/socialOAuthScopes.ts:54` 请求 `instagram_business_content_publish`。

但 `server/publishing/platformCapabilities.ts:223` 仅接受旧 `instagram_content_publish`，默认provider在128行通过Facebook Graph账号和 `me/permissions` 判断旧scope；`server/integrations/social.ts:246,564` 均使用 `graph.facebook.com`。实际 `platformPublisher.ts:623` 无oauthProvider分派调用 `publishInstagramReel`；`integrations/social.ts:737` 的容器创建/发布使用Facebook Graph，`platformPublisher.ts:426,433` 回执恢复也固定Facebook Graph。

这不是可以直接放宽scope的单点门禁。新Login token与旧Page token路径不能随意互换。737ea81已新增oauthProvider明确边界，发布探测、能力缓存使用、提交与回执恢复均对Instagram Login拒绝。更新后的隔离测试即使混入旧scope也被边界拒绝且provider调用为0；这是fail-closed PASS、原生发布路径仍不支持的证据。旧Facebook/Page绑定路径不能由此断言失败。本轮未修改共享provider功能。建议owner完整按oauthProvider区分host、token、scope、身份权限探测、发布及容器/回执恢复，再验证错host/错token类型/错scope/身份变化负例。

本地文档 `docs/release/四平台首版预发布验收与运行手册.md` 明确登录不等于API授权；`docs/instagram-archive-and-container-local-verification-2026-10-10.md` 已记录归档/容器恢复的本地改进，不能继续沿用旧G6缺失结论，但也不代表实际平台接受或批准。未发现本地资料提供本部署TikTok审批或Instagram实际权限批准的权威证据。

## 复现命令与结果

仓库根目录本地只读隔离运行（不读生产env，不联外）：

```sh
export PATH=/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
pnpm exec tsx --test scripts/production-gate-next-readiness.test.ts server/socialPrograms/weeklyProductionEnvironmentReadiness.test.ts server/socialPrograms/weeklyProductionEnvironmentProbe.test.ts
```

结果：8/8 PASS；其中新增3项覆盖九阻塞、配置ready不消费六类运行证据、新Login provider边界拒绝且零provider调用。

下列仅供获得生产只读诊断授权后在既有部署容器复现，本轮未执行；不启动主server或worker，不展开compose配置/不打印env。该脚本会访问既有DB/Redis，但不会发布消息/媒体。选择实际已部署compose文件，不混用：

```sh
docker compose -f docker-compose.yml exec -T app pnpm exec tsx scripts/check-weekly-agent-production-readiness.ts
# 若既有部署确实使用release compose，则使用这一条代替：
docker compose -f deploy/compose.release.yml exec -T app pnpm exec tsx scripts/check-weekly-agent-production-readiness.ts
```

常规compose含worker service；release compose仅app，不能假定worker存在。服务名称/运行角色及worker心跳应依实际部署确认；不得为了诊断启动worker。脚本报告为结构化boolean/reason，不打印连接串或密钥；九项通过仍需上述六类实际证据。任何审批标记修改都不能替代平台批准。

## 平台批准的权威要求（2026-10-10公开文档复核）

[TikTok官方 Direct Post 入门](https://developers.tiktok.com/docs/en/content-posting-api-get-started)要求应用获得 video.publish 批准，目标用户另行授权该scope，并提供对应access token/open ID；未经审计客户端只能私密可见。URL拉取还要求验证域名/URL前缀。TIKTOK_DIRECT_POST_RELEASE_MODE=approved无法证明上述批准、用户授权或域名验证。本轮未取得本部署的批准记录，未执行任何TikTok请求。

Meta官方Instagram Login发布文档地址为 https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing ，本轮公开读取工具无法访问，不能声称已由该页面实时确认本应用审批。上述IG代码缺口来自可复现的本地账号/权限/Graph host分支调查；正式平台准入仍需该应用控制台实际审查状态、专业账号授权及对应provider证据。

生产边界修复版本：`737ea81c3368101ba21f344b55d0acb20c435347`。首轮诊断发现旧scope门禁后，发布owner已提交显式fail-closed修复；本报告不再把明确拒绝边界列为未修。原生Instagram Login发布能力与实际平台授权仍是未完成项。
