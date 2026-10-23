# WhatsApp 多企业接入准备与验收

日期：2026-10-23（Asia/Shanghai）
代码分支：`feature/whatsapp-setup-flow`，基础提交 `f764fa4503a394611e06df1abe39d8977e1aaa65`。
本文件记录本地实现和下一步外部配置，不代表已经获得 Meta 权限或真实收发通过。

## 现有缺口与本批处理

| 原有缺口 | 本批处理 |
| --- | --- |
| 每企业依赖填写 App ID/Secret/Config ID | 新增平台级服务端配置，企业只保留授权资产和独立加密令牌；旧凭据编辑/删除接口禁止覆盖平台托管绑定 |
| 新企业必须先有平台配置记录 | 通过首次成功授权创建绑定，使用稳定记录 ID；已有不同 App 的记录阻止自动覆盖 |
| 按 URL tenantId 接回调 | 新增统一回调，先验签、后按 WABA + phone 分发，保留旧回调兼容 |
| 授权交换缺少企业/用户一次性会话 | 管理员 POST 创建会话；租户、用户、配置、期限绑定与原子防重放 |
| 查询后写入可能并发抢占号码 | 已有数据库唯一锁 + CAS，禁止跨企业共享号码/WABA |
| 强制 Business App 模式、固定 60 天令牌 | 支持 standard/coexistence；直接业务集成令牌，读取 Meta 实际有效期 |
| 号码 ID 被误当作注册就绪 | 查询号码 status，非 CONNECTED 明确要求先注册 |
| 授权函数未接到产品页面 | 现有“发布渠道”页面增加 WhatsApp 连接、重新授权、检测及停止接入 |
| 缺少业务令牌失效检测 | 接入现有每日 monitor；可手动检测；失效后阻止继续发送 |
| 平台应用清单仅扫描前 200 家 | 分页读取，避免后续企业漏检 |

## 需要你在 Meta 后台完成

1. 使用灵枢的企业主体准备 Meta Business Portfolio，按后台要求完成企业验证、双重认证和 Tech Provider onboarding。
2. 准备灵枢的专用平台应用，添加 WhatsApp，并按产品当前要求完成 Tech Provider onboarding。Meta 官方更新日志 2025-10-03 明确说明，成为 WhatsApp Tech Provider 不再要求独立 Access Verification；旧版应用基本设置仍可能显示该验证卡片，不据此推断 WhatsApp 的准入要求。不要将各客户的号码全部建在灵枢自己的 WABA 下。
3. 配置 Facebook Login for Business 的 WhatsApp Embedded Signup，获取 Configuration ID。选择适合实际业务的配置版本、资产和权限；将应用域名、允许的 HTTPS JavaScript 来源/重定向地址与真实灵枢域名匹配。具体输入格式以当前后台向导为准。
4. 申请所需权限高级访问：`whatsapp_business_management`、`whatsapp_business_messaging`；如果所选流程还要求其他权限，按后台及官方文档补充。准备审核账号、使用说明、创建/管理模板及收发消息的真实演示材料，完成 App Review 后确认应用可供外部企业授权。
5. 在 WhatsApp Webhook 配置中填写：
   - Callback URL：`https://<灵枢实际域名>/api/webhooks/whatsapp`
   - Verify Token：与服务器 `WHATSAPP_PLATFORM_VERIFY_TOKEN` 完全一致。
   - 订阅 `messages` 字段，覆盖来信和消息状态。代码在企业授权成功后订阅该企业的 WABA。
6. 确认企业账号的号码注册和计费路径。首次试点选两家独立测试企业及各自 WABA、号码；先完成号码验证及 Cloud API 注册，确保 status=CONNECTED。短信验证码与 Cloud API 两步验证 PIN 不是同一概念；本批没有自动注册或改 PIN。
7. 若需保留客户 WhatsApp Business App 使用方式，另行确认 Coexistence 资格、地区与后台配置，再启用共存模式；不承诺任意号码都能共存，不要求客户先删除原账号。
8. 按实际数据处理方式填写隐私政策和数据删除/解除授权信息。即时撤销回调与删除请求工作流尚未实现，不能填写不存在的回调或声称已经满足审核。

App Secret、Access Token、验证码和 PIN 不需要发在聊天里；App Secret 只进入服务端密钥配置。

## 需要服务器/数据库准备（不属于 Meta 配置）

`.env.example` 已列出占位项，本地没有填入真实密钥：

```dotenv
WHATSAPP_PLATFORM_APP_ID=
WHATSAPP_PLATFORM_APP_SECRET=
WHATSAPP_PLATFORM_CONFIG_ID=
WHATSAPP_PLATFORM_VERIFY_TOKEN=
WHATSAPP_PLATFORM_SIGNUP_MODE=standard
META_GRAPH_VERSION=v25.0
PUBLIC_BASE_URL=https://<灵枢实际域名>
TENANT_PLATFORM_APP_KEY=<服务端加密密钥>
```

- `coexistence` 仅在后台资格与配置完成后设置。
- 需要公网可达的 HTTPS 回调、可信 PUBLIC_BASE_URL，以及可访问 Meta 的服务器网络。
- `/config` 返回配置缺项、storageReady 与本企业绑定状态，不返回共享密钥或客户令牌。
- 接入写入需要 `supportsAtomicOperationLease`、`supportsAtomicCompareAndSwap` 和 CAS 实现。已有 PostgreSQL 适配器可检查数据库约束；默认 PocketBase 适配器不满足。应先通过既有数据库切换/验收流程，或单独补齐 PocketBase 的原子能力，不能通过本地 JSON 降级绕过。本批没有切换数据库或执行生产迁移。
- 不同 App 的旧 Meta 绑定、已有 Page/Instagram 等其他用途的 Meta 授权、同企业换号码/换 WABA、多企业共享同一 WABA 都明确阻止；需要单独评审迁移。
- 每日 monitor 沿用服务端现有初始化方式；断网检测会将连接降为 error，下次有效检测可恢复；被确认撤销/过期后需重新授权。密钥轮换后资产证明失效，不自动重建。

## 用户操作与 HTTP 契约

现有“发布渠道”页 → WhatsApp 企业消息接入 → 开始连接 → 前往 Meta 授权 → 选择企业/WABA/号码 → 返回灵枢。接入不自动开启 AI 自主发送。

| 接口 | 用途 |
| --- | --- |
| GET `/api/oauth/whatsapp/config` | 当前租户的配置、存储准备和绑定状态，connected 仅代表本地授权证明有效 |
| POST `/api/oauth/whatsapp/session` | 管理员准备十分钟一次性会话；不调用 Meta |
| POST `/api/oauth/whatsapp/exchange` | 管理员提交 state、code、sessionInfo.waba_id、sessionInfo.phone_number_id；服务端验证并绑定 |
| POST `/api/oauth/whatsapp/verify` | 管理员检测令牌和号码；不发送客户消息 |
| POST `/api/oauth/whatsapp/disconnect` | 停止本地接入，清空令牌/证明，保留历史与归属 |
| GET/POST `/api/webhooks/whatsapp` | Meta 回调验证及统一签名入口 |

停止接入不远程注销号码或撤销整个 WABA 订阅；完整撤销授权由企业管理员在 Meta 后台操作。已有执行中的外部请求仍需要凭回执核对，不能把断开操作当成撤回消息。

## 本地验证与真实验收

本地专用回归：`pnpm run test:whatsapp-onboarding`。所有 Meta 请求由模拟响应替代，网络防护阻止访问真实供应商；涵盖双企业绑定、独立令牌、会话绑定与防重放、管理员权限、签名、混合回调、重复归属、注册未完成、令牌失效、停止接入、密钥轮换及浏览器授权事件生命周期。

另运行 `pnpm run lint`、`pnpm run check:architecture`、`git diff --check`，以及 WhatsApp 领域回归。源代码通过不等于 Meta 审核通过、真实链路可用或可上线。

完成外部配置后，真实验收应在授权的稳定环境进行：

1. 两家企业各自管理员授权各自 WABA/号码；确认跨企业复用资产被拒绝。
2. 给两个号码分别发送不同真实询盘，验证统一回调按企业归属写入，互不可见；记录 provider message ID，不保存秘密。
3. 在对应企业由人工回复并核对 Meta 接受、送达/已读回执；验证不同企业令牌没有串用。
4. 停止一家接入，确认该企业后续处理/发送被阻止，另一家继续工作；重新授权后再测。
5. 在 Meta 撤销测试授权，手动检测并确认 token_expired 与后续发送阻断；另测到期和平台密钥轮换。
6. 分别验证 standard 与有资格的 coexistence 流程。模板审核、计费、历史同步、号码迁移和数据删除流程另行验收。

截至本批没有执行真实 OAuth、注册、发送、迁移、部署或推送，外部 run/task ID 不适用。恢复点是基础提交；本批改动仅在功能分支工作区中，原客服工作树未改。

## 参考

- [Meta/WhatsApp 官方开发入口](https://whatsappbusiness.com/developers/developer-hub/)
- [Meta Embedded Signup implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
- [Meta Tech Provider onboarding](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider)
- [Meta Business App coexistence](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- [WhatsApp 消息政策](https://whatsappbusiness.com/policy/)

查阅日期为 2026-10-23；Meta 文档抓取遇到 429/登录限制，资格、配置版本和审核要求须在已登录后台核实。本批未用抓取失败来推断后台已配置成功。

## 本批实际检查结果

- `pnpm run test:whatsapp-onboarding`：12 项通过、0 失败，包含最终接入保护改动。
- `node --import ./scripts/customer-isolated-test-guard.mjs --import tsx --test --test-concurrency=1 server/whatsapp/*.test.ts server/routes/webhooks.whatsapp.test.ts server/lib/oauthNonceStore.test.ts`：20 项通过、0 失败。与专用回归有重叠，不能累加为独立测试数；旧持久化测试有预期的网络阻断/失败注入日志。
- `node --import ./scripts/customer-isolated-test-guard.mjs --import tsx --test server/lib/tenantPlatformApps.oauthCredentials.test.ts server/routes/socialOAuthSupport.test.ts`：7 项通过、0 失败。
- `pnpm run lint`：通过（TypeScript noEmit）。
- `pnpm run check:architecture`：通过，2287 个生产 TypeScript 文件；未设置 ARCHITECTURE_BASE_REF，因此预算跨提交 ratchet 检查未执行。
- `pnpm run build`：通过，含共享移动端检查、Vite 构建及 studio chunk 预算检查。
- `git diff --check`：通过。
- 没有运行完整 quality/verify、真实数据库集成、真实 Meta OAuth/收发、Coexistence、生产迁移或部署；浏览器授权生命周期使用模拟 SDK 测试，没有把构建/模拟测试当作真实弹窗和页面视觉验收。
- 检查时 HEAD 仍为基础提交 `f764fa4503a394611e06df1abe39d8977e1aaa65`，改动未提交、未推送，原客服分支干净。

## Chrome 后台继续检查（2026-10-23）

### 已核实与已保存

- 专用应用：`Lingshu Customer Connect`，App ID `29622131917389142`，业务类型，开发模式。
- 当前应用归属：Robert，Business ID `3124707611058974`；应用基本设置显示未验证，安全中心显示符合认证资格。
- 用户已确认运营主体为灵小枢（杭州）科技有限公司，并说明同事已通过另一个个人账号提交企业认证、尚待结果；用户认为大概率未覆盖当前 Robert 资产组合。尚未取得同事提交的 Business ID，不能将“同事已提交”写成当前应用主体正在审核。
- 本次只打开认证向导查看要求，选择中国后在公司类型步骤退出；没有填写公司资料、上传证明或提交重复认证。
- 已添加企业版 Facebook 登录产品。通用配置创建向导只提供常规登录，未出现 WhatsApp 登录方式；模板页有旧版只读/60 天 WhatsApp 模板，但不能据此证明 WhatsApp 产品已启用。未创建不适用的 Config ID。
- 已添加 Webhook 产品，已打开 `Whatsapp Business Account` 对象。可见 `messages` 等字段，但没有验证回调或订阅生产数据；后台提示未发布应用只能收到面板测试 Webhook。
- Chrome 已确认以下页面无需登录可访问，运营主体与用户确认一致，已填入应用基本设置并保存，刷新后核实：
  - 隐私政策：`https://app.lingshu.site/privacy`
  - 服务条款：`https://app.lingshu.site/terms`
  - 数据删除：选择“数据删除说明网址”，填 `https://app.lingshu.site/data-deletion`。这是邮件申请说明，不能称为自动删除回调。
- 应用类别已保存为“商家和公共主页”。没有更改应用归属、申请新权限、生成令牌或上线应用。
- `GET https://app.lingshu.site/api/webhooks/whatsapp` 在 Chrome 中显示灵枢登录界面（URL 增加 `?page=digitalEmployees`），没有得到本分支的回调验证响应。现有公网服务不能认定已部署该端点。没有将此地址填写为已验证回调，没有部署本地分支。

### WhatsApp 测试入口缺失：结论边界

1. 应用“可用产品”没有 WhatsApp；此前两个权限列表搜索 whatsapp 都无结果。此应用是业务类型，不能归因为建成了个人/消费者应用。
2. Webhook 对象列表存在 WhatsApp Business Account，只说明通用 Webhook 支持该对象，不代表已经获得测试号码、WABA、访问令牌或高级权限。
3. 官方快速入门将开发者注册、账号和 WhatsApp 测试设备列为前置条件，没有将完成公司验证列为获取测试资源的前置条件。因此不能保证企业认证通过会自动恢复测试入口。
4. Twilio 官方接入说明将访问地区列为 WhatsApp 产品卡片缺失的一种原因；没有取得本账号被限制的具体说明，不把大陆注册公司、个人账号或访问地区中的任一项直接判为确定根因。
5. 正式配置前，先核对同事认证的业务资产组合与当前应用的归属。认证属于业务资产组合，不会因公司同名或由同事提交自动覆盖另一个组合。当前未进行资产转移或权限分配。

### 除企业认证之外的待办

| 待办 | 当前状态 / 下一步 |
| --- | --- |
| 应用归属与管理员 | 取得同事正在认证的 Business ID，与 `3124707611058974` 对比；再确定使用哪个组合及应用，避免重复开户。若需邀请或转移，先核对实际接收主体和权限 |
| 账号安全 | 当前组合的双重验证要求为“不要求任何人开启”；这不证明个人账号没有 2FA。应在正确的组合和管理员账号核实并完成 2FA；本次未修改认证凭据、安全策略或添加管理员 |
| 应用基本资料 | 三个公开政策链接、类别已保存；图标未上传，网站平台、应用域名尚未配置；正式授权域名待确认，不能把公开政策所在域名直接当作客户授权来源白名单 |
| WhatsApp 产品及测试资产 | 测试/API Setup 入口仍缺失；未获得测试消息账户 ID、电话号码 ID、测试令牌或收件人验证。先解决产品可用性，不能通过普通登录 Config ID 代替 |
| Embedded Signup | 获取正确的 WhatsApp Configuration ID，按当前 v4/v5 文档选择版本及资产。当前前端没有显式指定流程版本，仍传 `sessionInfoVersion: '3'`；需与最终配置核对，不能把该字段视作流程 v3。v5 的多消息账户会话结构尚未适配/验收，不盲目切换 v5 |
| OAuth 来源与回调 | 在正式域名确认后配置 HTTPS 来源、允许的 JS SDK 网域等；本次没有扩大域名白名单或开放授权 |
| Webhook 与部署环境 | 本地统一回调已有实现，公网尚不可用；在明确授权的稳定测试环境准备 HTTPS 端点、服务器密钥和验证口令，再验证并订阅 messages。生产发布另行授权 |
| App Review | 申请 WhatsApp 管理/消息权限高级访问；准备审核专用企业账号、登录步骤、发送消息并在 WhatsApp 收到的录像、管理模板等实际功能说明。当前无真实录像和测试账号；不要提交占位凭据或声称已通过 |
| 数据处理 | 公开说明已存在；需核实 support@lingshu.ai 确实有人处理、数据保留及 AI 处理说明与实际一致。邮件删除请求、即时撤销回调和删除执行是不同能力；自动回调尚未实现 |
| 多企业数据存储 | 默认 PocketBase 原子能力仍是本地接入阻塞；沿既有数据库流程解决，不以后台配置完成代替存储验收 |
| 生产号码与结算 | 测试完成后再准备客户自有号码、验证/注册、模板、消息同意和费用承担方式；测试成功不代表可以向外部客户正式开放 |

### 可用于准备材料的产品描述（草稿，未提交）

> Lingshu AI is a customer service platform operated by 灵小枢（杭州）科技有限公司. Each business customer will authorize its own WhatsApp business assets through Meta Embedded Signup. The platform is intended to receive customer messages, show conversations to authorized staff, assist with replies, and report delivery statuses within the customer's tenant. Business customers retain ownership of their WhatsApp assets and can disconnect the integration. The application is currently being prepared for testing and review; production onboarding is not yet enabled.

权限说明需在真实功能可演示后填写，不能将上面的产品意图当作已有外部联调证据。

### 本次证据与恢复点

- 公开链接保存截图：`/Users/julia1/.codex/visualizations/2026/10/23/01a167e6-5f62-75f1-92a7-1b5bc7118f2b/meta-app-policy-links-saved.png`
- Webhook 准备截图：`/Users/julia1/.codex/visualizations/2026/10/23/01a167e6-5f62-75f1-92a7-1b5bc7118f2b/meta-whatsapp-webhook-prepared.png`
- 官方更新日志：<https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog/>，已在已登录 Chrome 实际读取 2025-10-03 的 Access Verification 变更，以及 2026-10 的注册流程版本变更。
- 官方测试步骤：<https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started/>，已在 Chrome 实际读取。
- 本次只有后台产品/公开元数据配置和 runbook 更新，未运行源码测试；文档修改执行 `git diff --check`。既有测试结果仍只适用于前述本地实现。
- 本地恢复点仍为 `f764fa4503a394611e06df1abe39d8977e1aaa65`；改动保留在功能分支，未提交、推送或部署。后台变更可在相应应用设置页修改；若最终采用同事组合下的其他应用，需要重新核对这些配置。

## 集成交接冻结（2026-10-23）

此前“未提交”的记录描述各自检查时点；以下为本次冻结状态，尚未推送或部署。

- 来源树：`/Users/julia1/Documents/ChatGPT/1023WhatsApp`。
- 来源分支：`feature/whatsapp-setup-flow`。
- WhatsApp 源码增量提交：`18ed6f0e4bbfc56f6903006cea440857dd029e8f`，21 文件，843 行新增、393 行删除。文档以单独提交交付，最终文档提交 SHA 见本会话交接回复。
- 该源码提交的父提交为客服来源基线 `f764fa4503a394611e06df1abe39d8977e1aaa65`。不要把整个分支相对治理基线的所有差异当作 WhatsApp 增量。
- 已继承客服功能提交 `0c994b3c88c1ccb06b39a4a96811cfc60d329aec`，以及客服说明 `18e8046b242f02cab8d429f300a872c087b263be`、合并前检查说明 `f764fa4503a394611e06df1abe39d8977e1aaa65`。
- 本地只读核对：`merge-base(641d0b9, f764fa45)` 为 `43892e74f828b97ad51401cd96d48936553464a2`；`git merge-base --is-ancestor 0c994b3c 641d0b9` 返回 1，证明客服提交不在该治理起点祖先中。本次不判断集成树随后是否已合入客服，也不修改治理或集成树。

### 完整源码范围

```text
.env.example
package.json
server/lib/tenantPlatformApps.ts
server/routes/platformIntegrations.ts
server/routes/tenantPlatformTokenMonitor.ts
server/routes/webhooks.ts
server/routes/whatsappOAuth.ts
server/routes/whatsappSharedWebhook.ts
server/whatsapp/assetAuthority.ts
server/whatsapp/connectionHealth.ts
server/whatsapp/onboarding.ts
server/whatsapp/platformConfig.ts
server/whatsapp/platformOnboarding.test.ts
server/whatsapp/productionBoundary.integration.test.ts
server/whatsapp/tokenAuthority.test.ts
server/whatsapp/tokenAuthority.ts
server/whatsapp/webhookPayload.ts
src/components/ChannelsPage.tsx
src/components/WhatsAppConnectionPanel.tsx
src/lib/whatsappEmbeddedSignup.ts
src/lib/whatsappEmbeddedSignup.test.ts
```

文档增量仅为本 runbook 和 `docs/architecture/adr/2026-10-23-whatsapp-platform-onboarding.md`；不包含治理文件、截图二进制、账号密钥、本地运行数据或构建产物。

### 集成和迁移顺序

1. 集成方先完成客服批次及验证，再单独应用 WhatsApp 源码提交，随后应用文档提交。若采用 cherry-pick，只挑 WhatsApp 两个增量提交；不要再次 cherry-pick 上述客服祖先。若采用合并，须审核实际内容冲突，不能仅以祖先关系作为增量验收证据。
2. 优先核对共享触点：`tenantPlatformApps.ts` 的服务端 secret 引用和新令牌类型、`platformIntegrations.ts` 对托管绑定的保护、`tenantPlatformTokenMonitor.ts` 的业务令牌检测、`webhooks.ts` 的原始签名及统一入口挂载、`whatsappOAuth.ts` 的路由契约，以及 `ChannelsPage.tsx` 的接入面板。不得覆盖集成树中其他批次的路由或 UI 改动。
3. 依赖已有 `tenant_platform_apps` 持久化、OAuth nonce、`durable_operation_leases` 唯一锁与 CAS，以及客服消息领域的入站、回执、人工接管入口；不新增数据库迁移文件。本地没有执行任何目标库迁移。旧租户不自动改成共享应用模式，资产冲突由明确错误阻止，不能批量重写凭据消除冲突。
4. 运行前必须验证存储支持原子 lease/CAS。默认 PocketBase 尚不满足；已有 PostgreSQL 适配器具备能力检查，但本次未切换或验证真实目标数据库。
5. 服务端配置 `WHATSAPP_PLATFORM_APP_ID/APP_SECRET/CONFIG_ID/VERIFY_TOKEN`、`PUBLIC_BASE_URL`、`TENANT_PLATFORM_APP_KEY` 与真实 Meta 配置一致后，再在授权的稳定环境验证。现有接口为 `GET /api/oauth/whatsapp/config`，管理员 `POST /session`、`/exchange`、`/verify`、`/disconnect`（均在 `/api/oauth/whatsapp` 下），统一回调 `GET/POST /api/webhooks/whatsapp`。不向前端发送 secret 或客户 token。
6. 本次不触发真实 OAuth、消息发送、付费、广告、生产迁移或部署；生产权限、号码、计费与多企业实测另行完成。

### 冻结时重新运行的验证

使用桌面自带 Node 路径。首次命令因当前 shell 缺少 `node` 失败；设置 bundled Node 的 PATH 后重新运行成功。测试临时使用客服目录的 `node_modules` 只读依赖软链接，交付前移除；没有安装或升级依赖。

| 命令 | 实际结果 |
| --- | --- |
| `pnpm run test:whatsapp-onboarding` | 12 通过，0 失败，包含浏览器 SDK 事件模拟 |
| `node --import ./scripts/customer-isolated-test-guard.mjs --import tsx --test --test-concurrency=1 server/whatsapp/*.test.ts server/routes/webhooks.whatsapp.test.ts server/lib/oauthNonceStore.test.ts server/lib/tenantPlatformApps.oauthCredentials.test.ts server/routes/socialOAuthSupport.test.ts` | 27 通过，0 失败；与专用回归重叠，不累计为 39 个独立用例。既有测试含预期网络阻断及持久化失败注入日志 |
| `pnpm run lint` | TypeScript noEmit 通过 |
| `pnpm run check:architecture` | 2287 个生产 TypeScript 文件通过；未设 `ARCHITECTURE_BASE_REF`，跨提交 ratchet 未运行 |
| `pnpm run build` | 通过，含移动端共享检查和 studio chunk 预算检查 |
| `git diff --cached --check` | 新文件暂存后发现 webhookPayload.ts 末尾空行，已仅修正空白；再次检查通过 |

没有运行完整 quality/verify、真实数据库集成或 Meta 端到端。源码冻结不代表外部链路已就绪。

### 未交付项与阻塞

Meta 测试产品入口、认证组合与应用归属核对、Config ID、正式授权来源、公网回调、权限审核录像和审核账号仍缺；当前公网回调显示登录页。没有交付号码自动注册/PIN、号码或 WABA 迁移、多号码管理、历史同步、即时撤销及自动删除回调、平台代付、v5 多消息账户适配、PocketBase 原子能力补齐或数据库切换。不能在集成验收中把这些标为完成。

推送状态：本会话此前用户授权开发及 Meta 配置，没有直接的 GitHub 推送授权证据；本次只形成可审计本地提交，暂不执行远程写入。未向其他会话回发消息。
