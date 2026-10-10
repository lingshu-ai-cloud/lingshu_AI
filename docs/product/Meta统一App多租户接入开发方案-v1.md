# Meta 统一 App 多租户接入开发方案 v1

更新日期：2026-10-10

## 1. 目标与边界

目标是让灵枢使用一套受管 Meta App，为多个租户提供 Facebook Page 与 Instagram 专业账号的评论、私信接入。普通租户只执行“连接账号、选择资产、确认授权”，无需自行创建 Meta App。

本方案不承诺绕过 Meta App Review、Advanced Access、主体核验、账号资格或消息窗口政策。Meta Verified 付费订阅不属于本方案的依赖；Meta Business Portfolio、企业验证、Access Verification 和 App Review 是否需要，以 Meta 控制台对目标权限的实际要求为准。

## 2. 当前事实与问题定位

### 2.1 已验证事实

- 当前 Meta App 处于 Development 模式。
- `pages_messaging`、`pages_manage_metadata`、`pages_read_engagement`、`pages_show_list` 当前均为 Standard Access。
- `pages_messaging` 的 Advanced Access 申请入口当前不可用。
- 已用一个用户确认“不属于应用、主页或商务资产角色”的外部账号完成一次真实 Messenger 来信与送达回复；这证明该具体链路可工作，但不能证明对所有公众账号开放。
- OAuth、Page 订阅、Webhook 签名验证、真实来信持久化、送达回执、客户标签和知识库报价已经在本地临时 HTTPS 隧道跑通。
- 当前 Meta OAuth 与 Webhook 仍依赖临时隧道；固定生产域名尚未部署并复验本次修复。

### 2.2 为什么审核或高级权限一直无法通过

当前最可能的阻断是以下条件没有形成闭环，而不是某一个 API 调用写错：

1. **平台主体资格未完成**：统一 App 面向不属于应用角色的客户资产时，需要申请相应 Advanced Access。控制台当前直接表现为申请入口不可用，说明申请前置条件尚未满足或尚未被 Meta 识别。
2. **App 仍在开发模式**：开发模式适合管理员、开发者、测试者和有限测试资产，不能作为公众多租户可用性的证明。
3. **审核环境不稳定**：回调使用 `trycloudflare.com` 临时地址，审核员之后无法稳定复现；正式产品域名、OAuth 回调、Webhook、隐私政策和数据删除入口应使用同一套长期在线环境。
4. **生产版本无法证明**：固定后台健康接口没有返回构建版本，无法证明审核员访问的是含当前 Meta 修复的版本。
5. **审核材料可能无法复现完整链路**：审核视频和说明必须从登录灵枢开始，依次展示授权、选择 Page/IG 账号、收到真实评论或私信、在灵枢回复、平台端看到回复、断开授权和删除数据。
6. **权限请求需要按实际用途最小化**：Facebook Page 私信、Facebook 评论、Instagram 私信、Instagram 评论应分别说明用途和界面位置。申请了界面中无法演示的权限，或界面使用了没有申请的权限，都会降低通过率。
7. **资产与授权主体关系可能不清楚**：审核账号必须对用于演示的 Page 或 Instagram 专业账号拥有足够权限，且该资产、应用角色和授权用户的关系能被审核员复现。

以上第 1 至第 4 项已有当前环境证据；第 5 至第 7 项是提交下一轮审核前必须逐项核验的审核风险，不能在未看到 Meta 拒绝说明时假定为已确认原因。

## 3. 为什么不同客户会出现权限差异

同一个 OAuth 按钮不会让所有账号获得完全相同的能力，差异来自：

- Facebook 个人主页不能作为 Messenger Platform 的企业收件箱目标，必须是 Facebook Page。
- 授权用户对 Page 可能拥有完全控制、任务权限或没有所需权限。
- Instagram 可能是个人账号、Creator 或 Business；消息和评论 API 需要受支持的专业账号。
- Instagram Login 与 Facebook Login 的资产模型不同；前者不要求绑定 Facebook Page，后者通常通过 Page 找到关联的 Instagram 专业账号。
- 用户可以只同意 OAuth 请求中的部分权限，也可以稍后撤销权限。
- Page/IG 账号可能尚未完成 Webhook 订阅，或授权 Token 已过期、失效、被密码修改或安全检查撤销。
- 私信能力受到“由客户先发起会话”、消息窗口、账号消息设置、地区和平台风控限制。
- App 角色用户、测试资产和公众用户适用的访问级别不同。
- 账号受限、Page 未发布、IG 账号类型错误或资产归属变化都会改变可用能力。

因此产品必须显示“当前资产实际能力”，不能只显示一个笼统的“已连接”。

## 4. 可行性评估

### 4.1 结论

技术可行性高，平台准入风险中高。现有代码已经覆盖约三分之二的工程基础，主要剩余工作是把当前“每租户 App/回调配置思路”收敛为真正的共享 App 路由，并补齐连接诊断、权限状态机、撤销与审核证据。

### 4.2 已有基础

- `tenant_platform_apps`：租户级平台配置和加密凭据存储。
- `social_accounts`：租户与 Facebook Page / Instagram 账号的绑定记录。
- Facebook、Instagram OAuth 与账号发现。
- Meta/Instagram Webhook 签名验证、资产归属检查和事件接收。
- Messenger 消息持久化、幂等、送达/已读回执。
- Facebook/Instagram 评论读取和回复接口。
- Token 监控与部分自动续期能力。
- 管理端配置、Webhook 检查和平台连接页面。

### 4.3 核心架构缺口

当前回调 URL 包含 `tenantId`。一套共享 Meta App 通常配置一套固定 Webhook Callback，因此正式多租户模式需要改为：

```text
Meta App
  → /api/webhooks/meta
  → 校验共享 App Secret 签名
  → 从事件提取 Page ID / IG Account ID
  → 查询 social_accounts 的唯一资产归属
  → 定位 tenantId
  → 写入该租户的会话或评论收件箱
```

不得仅相信 URL 中的 `tenantId`；路由必须以平台事件里的资产 ID 和服务端绑定表为准。

## 5. 目标数据模型

### 5.1 平台应用注册表

新增或明确 `platform_app_registrations`：

- `id`
- `provider`: `meta` / `instagram_login`
- `mode`: `managed` / `customer_owned`
- `app_id`
- `app_secret_ciphertext`
- `webhook_verify_token_ciphertext`
- `graph_version`
- `status`: `draft` / `configured` / `review_pending` / `live` / `restricted`
- `access_levels_json`
- `verified_at`
- `last_probe_at`

灵枢统一 App 只保存一条 `managed` 注册；企业客户自有 App 使用 `customer_owned`，并绑定具体租户。

### 5.2 租户资产绑定

扩展 `social_accounts`：

- `tenant_id`
- `platform_app_registration_id`
- `platform`: `facebook` / `instagram`
- `provider_account_id`
- `parent_page_id`
- `account_type`
- `granted_scopes_json`
- `capabilities_json`
- `token_ciphertext`
- `token_expires_at`
- `webhook_subscription_status`
- `connection_status`
- `status_reason_code`
- `authorized_by_user_id`
- `authorized_at`
- `last_probe_at`

`platform + provider_account_id` 在有效绑定范围内必须唯一，禁止同一个 Page 或 IG 账号静默归属多个租户。

### 5.3 Webhook 事件账本

新增 `platform_webhook_events`：

- `provider_event_id` 或稳定事件幂等键
- `platform_app_registration_id`
- `provider_account_id`
- `tenant_id`
- `event_type`
- `received_at`
- `signature_verified`
- `routing_status`
- `processing_status`
- `attempts`
- `last_error_code`
- `payload_digest`

原始敏感载荷按最小必要原则保存，日志禁止记录 Token、App Secret 和完整私信正文。

## 6. 连接状态机与权限体检

连接页面不再只有“已连接”，应使用以下状态：

- `oauth_required`
- `authorized_no_assets`
- `asset_selected`
- `missing_scopes`
- `webhook_pending`
- `ready_comments`
- `ready_messaging`
- `ready_comments_and_messaging`
- `token_expiring`
- `reauthorization_required`
- `asset_permission_lost`
- `platform_review_required`

每次 OAuth 完成后自动执行：

1. 获取用户实际授予的权限。
2. 枚举可管理的 Page 或 IG 专业账号。
3. 验证目标资产类型和授权用户权限。
4. 订阅 Page/IG Webhook 字段。
5. 探测评论读取能力。
6. 在不向真实客户发送消息的前提下验证消息能力配置。
7. 保存能力矩阵和失败原因。

页面要把“平台 App 未获 Advanced Access”和“当前客户账号没有资产权限”分开显示。

## 7. Token 隔离与生命周期

- 所有 Access Token、Refresh Token、App Secret 使用应用级密钥加密，数据库只保存密文。
- 解密只发生在服务端平台适配器内，不返回前端。
- 每个租户和资产独立保存授权版本、scope、到期时间和最后探测结果。
- Token 监控任务提前告警，并在平台允许时续期；不能续期时生成重新授权任务。
- 用户撤销授权、离职、Page 权限变化、密码修改和平台安全检查都必须转成明确状态码。
- 断开连接时停止订阅、吊销可吊销的 Token，并保留最小审计记录。
- 支持 App Secret 轮换；轮换期间可短期校验当前与上一版本 Secret，完成后删除旧版本。

## 8. Webhook 路由与安全要求

- 使用固定 HTTPS 域名，例如 `/api/webhooks/meta` 和 `/api/webhooks/instagram`。
- 验证 `X-Hub-Signature-256`，签名失败直接返回 403。
- 先持久化幂等事件，再异步处理，避免平台重试产生重复会话或重复回复。
- 根据 Page ID / IG Account ID 查询租户归属；找不到或存在冲突时进入隔离队列，不猜测租户。
- 入站、echo、delivery、read、comment、mention 分开建模。
- 回复必须检查账号连接状态、消息窗口、人工接管状态和租户发送策略。
- 记录平台对象 ID、发送尝试 ID 和回执，结果不明时禁止自动重发。

## 9. 分阶段开发计划

### 阶段 A：共享 App 路由基础

- 建立平台应用注册表。
- 新增不含租户 ID 的固定 Meta/Instagram Webhook。
- 实现资产 ID → 租户唯一映射。
- 迁移现有租户级回调，同时保留兼容读取期。
- 为签名错误、未知资产、资产冲突和重复事件补齐测试。

验收：两个测试租户连接不同 Page；同一固定回调能准确分流，交叉事件不能进入另一租户。

### 阶段 B：标准 OAuth 与连接向导

- “连接 Facebook Page”和“连接 Instagram 专业账号”拆成独立入口。
- OAuth state 绑定租户、用户、连接意图和一次性 nonce。
- 授权后选择资产并显示实际 scope。
- 自动订阅 Webhook，生成能力体检结果。

验收：新租户无需填写 App ID/Secret，完成 OAuth 后可看到 Page/IG 账号、权限状态和明确错误说明。

### 阶段 C：统一互动收件箱

- Facebook 私信、Instagram 私信、Facebook 评论、Instagram 评论统一为 Interaction Thread。
- 保留平台、账号、内容、客户身份和消息窗口元数据。
- 复用客户标签、翻译、企业知识库回复和人工确认流程。
- 评论回复与私信回复分别执行平台策略检查。

验收：四类事件能正确进入所属租户；AI 草稿不会自动越权发送；回执可追踪。

### 阶段 D：运维与失效恢复

- Token 到期和权限丢失监控。
- Webhook 积压、未知资产、签名失败和发送结果不明告警。
- 重新授权、资产重新绑定和 App Secret 轮换流程。
- 管理员只读诊断包，默认脱敏。

验收：模拟撤销权限、Token 失效、Page 转移、Webhook 重放和服务重启后均能给出确定状态，不重复发送。

### 阶段 E：Meta 审核准备

- 固定生产域名部署当前版本。
- 公网隐私政策、用户协议、数据删除说明长期可访问。
- 为每项权限准备单独用途说明与界面路径。
- 录制从授权到真实收发、撤销和删除数据的完整视频。
- 准备审核账号、Page、IG 专业账号和可复现数据。
- 先申请最小权限集合，通过后再增加评论或洞察能力。

验收：由一名未参与开发的人按审核说明从零操作成功；所有 URL 和测试账号在审核周期内保持稳定。

## 10. 测试矩阵

至少覆盖：

- 两个租户、两个 Page、两个 IG 专业账号的交叉隔离。
- 同一资产重复授权、转移租户和冲突处理。
- 用户拒绝部分 scope。
- App 只有 Standard Access、App 获得 Advanced Access 两种状态。
- 非应用角色客户发起 Messenger/IG 会话。
- 评论、私信、echo、delivery、read 和重复 Webhook。
- Token 到期、主动撤销、Page 权限丢失。
- 服务重启、队列重试和未知发送结果。
- 数据删除请求和租户断开连接。

## 11. 上线门禁

满足以下条件前不得标记为“对所有客户可用”：

- Meta App 已进入适合公众使用的模式。
- 目标权限在控制台显示所需访问级别已批准。
- 固定生产域名和 Webhook 连续在线。
- 当前部署版本可从健康接口核验。
- 至少两个彼此独立、非应用角色的真实客户账号完成收发。
- 评论与私信分别完成入站、人工确认回复和回执验收。
- 租户交叉隔离、签名校验、幂等和撤销测试通过。
- 隐私政策、数据删除和授权撤销流程可用。

## 12. 不做 Meta 主体验证时的产品策略

可以继续开发阶段 A 至 D，并把功能标记为“邀请测试”。这能完成架构、产品体验和少量客户验证，但不能保证所有新客户都能授权或收发。

如果短期内 Meta 主体验证持续失败，建议同时保留两条交付路径：

1. 灵枢统一 App：等待平台准入，作为最终标准路径。
2. 已获准入的 Meta 技术服务商：作为临时生产通道，灵枢继续负责租户、客户、标签、知识库和报价。

不建议把“每客户创建一个 App”设为默认路径；它会把审核、Secret、Webhook 和权限维护成本复制到每个客户，仅适合作为企业版 BYOA 选项。
