# WhatsApp 平台应用与企业授权分离

日期：2026-10-23（Asia/Shanghai）
状态：本地实现；未完成 Meta 真实账号验收。
工作分支：`feature/whatsapp-setup-flow`；来源：客服工作树 `f764fa4503a394611e06df1abe39d8977e1aaa65`。

## 决定

灵枢使用一个专用 Meta 应用承接多家企业的 Embedded Signup。平台凭据来自服务端环境，企业只授权自己的 WABA 和业务号码。当前每个租户只支持一个 Meta 绑定和一个 WhatsApp 号码，同一个 WABA 不跨租户共享。

复用 `tenant_platform_apps`、现有消息收发、客户持久化、回执处理和人工接管边界。企业记录的 `app_secret` 保存固定引用 `ref:whatsapp-platform-app-secret`，在服务端解引用；每家企业的 access token 仍独立加密。平台应用密钥不复制进企业数据库或前端。旧记录保留原行为，不自动迁移；不同 Meta App、换号码、换 WABA 都明确阻止，需要单独迁移方案。

统一回调 `/api/webhooks/whatsapp` 先验证原始请求 HMAC，再按已验证的 `(WABA ID, Phone Number ID)` 查询唯一企业归属。批次全部归属预检后才开始消费，重复归属拒绝整批，未绑定/已断开资产忽略。入站和回执继续走原来的领域入口。

授权准备通过已认证管理员的 POST 创建十分钟有效的一次性会话，绑定租户、用户、平台配置摘要；交换前原子消费，失败也不恢复。复用 durable_operation_leases 的数据库唯一约束串行化平台绑定/断开，最终更新采用 CAS。当前全平台绑定串行锁优先保证正确性，繁忙时返回可识别错误；后续有真实吞吐需求再缩小锁粒度。

业务集成令牌直接使用授权码交换结果，类型为 `business_integration`，不再套用 60 天用户令牌交换。有效期由 Meta debug_token 的 expires_at 与 data_access_expires_at 取最早正值；零代表没有预定到期时间，缺失/异常/过期拒绝。每日沿用现有 token monitor 检查业务授权，不自动刷新成用户令牌；管理员也可主动检测。检测失效将状态降为 token_expired/error，阻止后续发送。监控不是即时撤销通知。

平台密钥轮换或 App ID 更改使已有资产证明失效，要求重新验证授权。停止灵枢接入通过 CAS 清除令牌和证明并停用绑定，保留号码归属和历史记录；它不删除企业资产、不远程取消整个 WABA 的应用订阅，也不等于撤销 Meta 企业后台授权。

## 实现范围与运行前提

- 不新增数据库表，不执行迁移、部署、OAuth 或真实发送。
- 依赖已有数据库原子锁和 CAS 能力证明。当前 PostgreSQL 适配器具备相应能力检查；默认 PocketBase 适配器的 atomic lease 返回 false，因此不得宣称该后端真实接入就绪。
- 仅在 Meta 确认号码状态 CONNECTED 后保存 active 绑定。新号码的 Cloud API 注册先由 Meta 后台完成；本批不自动调用 `/register` 或处理 PIN，避免把不可逆注册/迁移混进重新授权动作。
- standard 与 coexistence 由平台配置选择；共存资格及正式注册配置需在 Meta 后台确认。未实现历史同步、自动号码迁移、多号码管理、即时撤销回调和平台计费代付。
- 前端增加到现有渠道页面，使用已有样式和平台图标。两次明确点击分别准备会话、打开官方授权窗口，以保留浏览器弹窗许可。

验收步骤与 Meta 配置清单见 `docs/runbook/WHATSAPP-PLATFORM-ONBOARDING.md`。
