# 周 Agent 生产接入执行单

基准提交：`f2c70c9`（包含 `ff8be09` 生产门禁基线及后续库存、渠道授权、企业事实导航修复）
复核日期：2026-10-10

这份执行单把当前代码门禁、生产配置、平台授权和真实运行证据收束为一条操作路径。它不包含 secret，也不授权发布、发送、迁移或部署。

## 当前结论

代码侧受控门禁已通过：平台生产准备测试 54/54，通过；基础设施与六类证据合同 61/61，通过。当前运行生产 readiness 仍为 `ready: false`，共有九项明确缺口。因此本版本可以进入生产接入准备，尚不能声明已接通生产环境，也不能把本地受控回执当作真实平台回执。

周任务到既有业务页面的内部路由已经补齐：11 类业务合同全部通过；内容、发布、库存、客服、素材等卡片保留原任务身份；渠道授权卡进入既有 ChannelsPage 并绑定平台、账号和消费者；企业事实卡进入既有 EnterprisePage 并绑定企业、产品、字段、版本、原请求和消费者。Chrome 只读夹具已实际点击后两类卡并确认目标页面可见身份，外网与 mutation 均被阻断。该证据证明本地路由和页面消费，不代表真实账号或平台连通。

复核命令：

```sh
node scripts/platform-production-readiness.controlled.mjs
node --test scripts/runtime-evidence-collector.test.mjs scripts/runtime-evidence/scope.test.mjs scripts/runtime-evidence/customer.test.mjs scripts/runtime-evidence/provider.test.mjs scripts/infra-prep-*.test.mjs
node --import tsx scripts/check-weekly-agent-production-readiness.ts
```

前两条必须退出 0；第三条只有在真实生产配置、依赖和平台批准全部满足后才能返回 `ready: true`。

## 九项生产门禁

| readiness reason | 责任域 | 需要完成的实际动作 | 通过证据 |
| --- | --- | --- | --- |
| `postgres_business_store_not_configured` | 基础设施 | 配置专属 PostgreSQL、TLS、业务 schema 与迁移清单 | 只读 catalog/索引/全量 ID 与当前数据 hash 校验 |
| `publication_atomic_store_unavailable` | 数据与发布 | 验证正式 publication lease 唯一索引和 prior-effect guard | 多客户端争用仅一个赢家，未知回执沿原 attempt 恢复 |
| `durable_worker_queue_not_configured` | 队列 | 配置专属 Redis、BullMQ DB/prefix 和生产角色拆分 | 配置审计、隔离 namespace、持久化策略 |
| `production_auth_fallback_enabled` | 身份 | production 禁止本地身份 fallback，保留真实 PB 身份依赖 | 未授权与身份服务故障均 fail closed |
| `meta_social_oauth_not_configured` | Meta | 为租户配置完整唯一 Meta app 和精确 HTTPS callback | 一次性 OAuth state、真实 grants 与资产归属回读 |
| `instagram_login_oauth_not_configured` | Instagram | 配置 Instagram Login app，不混用 Facebook Login token/host/scope | 专业账号身份、token kind、scope 与账号 hash 一致 |
| `instagram_publication_disabled` | Instagram | 完成平台审批和账号授权后，按批准范围启用发布 | 原 container 与 final media 回执、目标账号 membership |
| `tiktok_direct_post_not_approved` | TikTok | 完成 Direct Post audit、creator 授权和产品审核 | 当前 creator proof、显式 privacy/interaction/commercial 选择及原 publish receipt |
| `durable_worker_queue_unavailable` | 运行环境 | 启动经批准的独立 worker 并验证 Redis 连接和心跳 | `/ready` 的 Redis 与 worker heartbeat 同时通过 |

不得删减 `REQUIRED_CAPABILITIES`、降低 TLS、开启本地 fallback、写假心跳或伪造 capability row 来消除上述原因。

## 唯一执行顺序

1. 运维先从 `deploy/production-infrastructure.env.example` 和 `fixtures/platform-production-readiness/shared.env.example` 建立 secret-manager 配置；模板文件不能直接 source。
2. 在独立目标验证 PostgreSQL、Redis、PB、对象存储和备份恢复点；先运行默认零连接检查，再在获授权环境运行只读预检。
3. 进入批准的停写窗口，备份 PB/data、PostgreSQL、Redis 与对象存储引用；任何 active job、unknown provider attempt 或不一致恢复点都必须停止切换。
4. 按 `docs/acceptance/production-infrastructure-runbook-73c78766.md` 执行 schema、数据复制和全量核对。迁移命令会写数据，不能由本执行单自动触发。
5. 仅在迁移和回滚条件成立后启动 web；随后启动一个经批准的 worker，检查 `/api/overseas/health` 与 `/api/overseas/ready`。ready 503 即失败。
6. 分平台完成 App Review、Business Verification、TikTok Direct Post audit、真实管理员 OAuth 和原生资产归属回读。租户配置不允许回退到全局 app。
7. 使用同一租户、周包、账号和版本采集下列六类证据。任何版本、账号或 recipient 漂移都要重新采集。
8. 由业务责任人明确批准一个最小真实任务，再执行一次发布或消息端到端验收；付费、外发和发布逐项开放，不做批量试跑。
9. 对账任务、数据库/outbox、队列、原 attempt 和 provider receipt。结果未知时只读查询原 attempt，禁止重新初始化或盲重发。

## 六类必须留存的真实证据

| evidence key | 最小权威来源 | 不可替代项 |
| --- | --- | --- |
| `tenant_authenticated_scope` | 正式身份服务和同租户 DataStore 只读导出 | 本地 token、手填 tenant ID |
| `weekly_package_and_execution_graph` | 正式周包、版本固定的执行图、依赖与任务状态 | `succeeded` 文本、样例 JSON |
| `whatsapp_connected_account_and_approved_recipient` | WABA/phone identity、当前授权、同账号 recipient 与真实送达回执 | connected 标记、旧授权、模拟 MID |
| `messenger_connected_page_and_scoped_recipient` | 实际 grants、Page 归属与订阅回读、同 Page PSID 和真实回执 | 请求过的 scope、旧订阅布尔值 |
| `instagram_connected_professional_account_and_scoped_recipient` | 专业账号只读回执与签名入站 webhook | 用户名、发布 post、手填 verified |
| `publication_account_token_and_provider_capability_receipt` | 当前 token authority、provider probe、原 attempt/receipt | operator review、自造 capability、重试产生的新 attempt |

采集规范与脱敏约束见 `docs/acceptance/real-runtime-evidence-spec.md`。`runtime-evidence-collector.mjs` 的 dry run 永远返回 `runtimeVerified: false`，只用于检查输入契约。

## 上线停止条件

出现下列任一情况立即停止新写入并对账：生产 readiness 非 200、身份 fallback 生效、worker 无心跳、租约出现多赢家、账号/版本/recipient 漂移、平台返回未知结果、备份后仍有写入、无法证明原 attempt、或真实证据缺少权威来源。不得用重新发送、重新发布或修改状态字段绕过停止条件。

## 生产验收完成定义

只有同时满足以下条件，才可把周 Agent 标记为生产可执行：九项 readiness 全部通过；六类证据均来自当前正式范围；B2B 零基础、B2B 有基础 40/60 与 20/80 三套周计划各完成一次同版本真实执行；每个任务卡能进入既有生产页面并绑定其真实 task/run；五条视频按倒排节点完成、发布与回执可追溯；WhatsApp、Messenger、Instagram 的当前授权和 recipient 关系通过；未知结果恢复不产生第二次外部副作用。
