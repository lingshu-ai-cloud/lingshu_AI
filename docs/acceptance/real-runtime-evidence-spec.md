# 六类真实运行证据采集规范

适用于租户、周包与执行图、WhatsApp、Messenger、Instagram 和发布权限的验收人员。采集器只读取已经授权的本地最小字段导出，不连接平台、不发送消息、不发布内容。dry run 检查字段契约和范围一致性，所有报告的 `runtimeVerified` 固定为 false；不得将报告回灌到正式可信证据集合。

## 可信来源与防伪边界

本地 JSON 中的 `trusted`、`verifiedSignature`、provider 名称、ID、hash 或时间戳都可以被编辑，不能单独成为不可伪造证据。验收必须独立核对已鉴权只读采集主体、同租户正式 DataStore 记录、原始 provider 响应或经过正式签名验证的 webhook。字节 hash 检测漂移，不能证明来源；采集器签名只有在公钥由独立运维固定且采集主体可信时才有意义。证据缺少可信来源时结论保留未验真。

六类共同绑定 tenant ID；周包绑定 program、package 与 graph 的版本；渠道绑定内部 account、原生账号、采集 authority revision 和正式 identity hash；recipient 绑定同账号原生收件人关系。重新授权、账号更换、版本变化或回执过期后必须重采，不能复制原验证结果。

## 本地采集命令

先复制空模板，再由授权操作者在受控本地目录中填入最小字段。不要导出数据库整表、消息正文、access token、refresh token、Authorization header、cookie、密码或私钥。`expectedScope` 来自独立选定的当前租户与周包上下文，不能由待验证回执自行决定。

```sh
cp scripts/runtime-evidence-input.template.json work/runtime-evidence-input.json
node scripts/runtime-evidence-collector.mjs --input work/runtime-evidence-input.json --out work/runtime-evidence-dry-run
```

`expectedScope` 的结构为 `{tenantId, programId, programVersion, packageId, packageVersion, accountVersions:{内部账号ID:采集authority版本}}`。对应 section 的预期 scope 必须一致。输入示例中占位字段必须替换为已有正式记录的值，不能当作运行证据。报告只输出固定校验代码、布尔值和计数。新输出文件使用 0600，已有报告不会被覆盖；输入不符合 schema 或含 secret 时非零退出且不回显内容。

每类单独采集使用相同只读命令，独立输出目录防止混淆：

```sh
node scripts/runtime-evidence-collector.mjs --input work/runtime-evidence-input.json --out work/evidence-tenant --section tenantScope
node scripts/runtime-evidence-collector.mjs --input work/runtime-evidence-input.json --out work/evidence-week --section weeklyPackage
node scripts/runtime-evidence-collector.mjs --input work/runtime-evidence-input.json --out work/evidence-whatsapp --section whatsapp
node scripts/runtime-evidence-collector.mjs --input work/runtime-evidence-input.json --out work/evidence-messenger --section messenger
node scripts/runtime-evidence-collector.mjs --input work/runtime-evidence-input.json --out work/evidence-instagram --section instagram
node scripts/runtime-evidence-collector.mjs --input work/runtime-evidence-input.json --out work/evidence-publication --section publication
```

这些命令不从 live provider 采集新证据。真实环境采集须在另行授权的只读服务上下文中完成，不得通过真实发送、真实发布或运行 release 脚本制造证据。

## 脱敏与验收

精确 recipient 与身份等值校验需要可信采集上下文中的原值；若先掩码再验证，不能宣称身份绑定通过。输出应完全移除这些原值，而非写一个可被反推的短 hash。保留原始证据引用的受限审计位置、人工验收人及时间；公开报告只保留校验结论。

本地 `missing` 或 `unverified` 表示真实验真未完成，`failed` 表示已提供字段违反契约或范围。进程成功退出仅表示生成报告成功。真实验收必须同时满足下述各类条件，并在实际运行入口重新验证当前 credential、capability、消息窗口和 scope；历史已送达或已发布不保证未来仍有权限。


## 租户和周包图证据

本组模块 `scripts/runtime-evidence/scope.mjs` 导出 `validateScopeEvidence(input)` 与 `validateWeeklyEvidence(input)`。它们只验证离线身份投影合同。通过全部 checks 仍返回 `missing`，且 `runtimeVerified/provenanceVerified/completionVerified:false`；JSON 中声称 authenticated、succeeded 或 mode=evidence 均不能证明真实认证或完成。不调用网络、不发送、不读取密钥、不落盘凭证。缺少顶层 envelope 为 missing，完整 envelope 内矛盾、缺字段或不完整分页为 failed。

统一运行命令：

```sh
node scripts/runtime-evidence-collector.mjs --input work/runtime-evidence-input.json --out work/runtime-evidence-dry-run
node --test scripts/runtime-evidence/scope.test.mjs
```

collector 输入 `sections.tenantScope` 和 `sections.weeklyPackage` 分别直接传下面的 envelope。collector 强制 mode=dry-run、dryRun=true、now=系统时间。不要用样例冒充真实采集。下例字段值只是说明结构。

```json
{
  "mode":"dry-run",
  "dryRun":true,
  "now":"2026-10-10T01:01:00Z",
  "scope":{
    "tenantId":"TENANT",
    "programId":"PROGRAM",
    "programVersion":2,
    "accountVersions":{"ACCOUNT":3},
    "packageId":"PACKAGE",
    "packageVersion":4,
    "executionGraphVersion":3
  },
  "collection":{
    "source":"tenant_filtered_datastore",
    "tenantId":"TENANT",
    "requestId":"READ_REQUEST",
    "collectedAt":"2026-10-10T01:00:00Z",
    "codeRevision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "readOnly":true,
    "complete":true,
    "authority":{"authenticated":true,"actorId":"ACTOR","tenantId":"TENANT"}
  },
  "evidence":{
    "programs":{"totalItems":1,"items":[{
      "id":"OPAQUE_PROGRAM_ROW","tenant_id":"TENANT","program_id":"PROGRAM","version":2,
      "payload":{"programId":"PROGRAM","version":2,"status":"active"}
    }]},
    "accounts":{"totalItems":1,"items":[{
      "id":"OPAQUE_ACCOUNT_ROW","tenant_id":"TENANT","program_id":"PROGRAM","account_id":"ACCOUNT","version":3,"status":"active",
      "payload":{"programId":"PROGRAM","accountId":"ACCOUNT","version":3,"status":"active"}
    }]},
    "packages":{"totalItems":1,"items":[{
      "id":"OPAQUE_PACKAGE_ROW","tenant_id":"TENANT","program_id":"PROGRAM","package_id":"PACKAGE","version":4,"status":"active",
      "payload":{
        "programId":"PROGRAM","packageId":"PACKAGE","version":4,"status":"active","executionGraphVersion":3,
        "executionTaskRefs":[{"type":"weekly_execution_task","id":"TASK","version":1}],
        "socialContentPackage":{"operatingPackageId":"PACKAGE","version":4,"publicationTasks":[{"publicationTaskId":"PUBLICATION","accountId":"ACCOUNT"}]}
      }
    }]},
    "tasks":{"totalItems":1,"items":[{
      "id":"OPAQUE_TASK_ROW","tenant_id":"TENANT","program_id":"PROGRAM","package_id":"PACKAGE","package_version":4,
      "task_id":"TASK","workflow_kind":"publishing","status":"queued","idempotency_key":"PINNED_KEY",
      "payload":{
        "taskId":"TASK","tenantId":"TENANT","programId":"PROGRAM","packageId":"PACKAGE","packageVersion":4,
        "workflowKind":"publishing","status":"queued","idempotencyKey":"PINNED_KEY",
        "accountId":"ACCOUNT","publicationTaskId":"PUBLICATION","dependsOnTaskIds":[]
      }
    }]}
  }
}
```

tenantScope 使用 scope 的 tenantId/programId/programVersion/accountVersions 和 evidence.programs/accounts；weeklyPackage 还要求 packageId/packageVersion/executionGraphVersion 与 evidence.packages/tasks。允许传完整正式 rows；示例展示验证器所需身份投影字段，不是可用于创建正式业务记录的完整 payload。两 section 和 collector expectedScope 的身份、账号版本必须一致；不得从被验数据反推预期身份。version 必须正安全整数；账号键必须非空且无首尾空格。executionGraphVersion 仅接受 2/3，未声明的 legacy graph 不能被自动提升为新版。task ref 的版本是正式图固定版本 1，不是 packageVersion。

可信采集来源：服务认证中间件 `res.locals.tenantId/userId` 所绑定的只读 API，或同等认证上下文中按 tenant_id/program_id 与精确版本过滤的 datastore。不得用 body/query/x-tenant 覆盖认证租户。`collection.source` 可为 authenticated_api 或 tenant_filtered_datastore，但此字符串不建立信任。未来真实采集器需独立验证认证上下文、完整分页和不可篡改来源回执；当前离线验证器没有此能力。

建议正式只读采集步骤：固定当前代码 SHA 和预期 scope，先读认证 identity，再读取 `GET /api/overseas/social-programs/:programId`、`/:programId/accounts`、`/:programId/operating-packages/:packageId`、`/:programId/operating-packages/:packageId/execution-tasks?version=N`（当前 mount 见 `server/index.ts:226`，后续路径均在 `/api/overseas/social-programs` 下）。执行任务 API 返回展示投影；只有获得对应正式 row header，或可信采集器经审计映射后，才可形成这里的 raw-row envelope。直接 datastore 收集来自 social_programs、social_owned_accounts、social_weekly_operating_packages、social_weekly_execution_tasks；必须按精确 tenant/program/package/version 过滤，所有分页完整、总数匹配、记录 id 唯一，采集前后版本不变。不得在生产写入 fixture，不得把自动生成 id 当业务 id。

验收失败包括：跨 tenant/program；账号清单或版本漂移；row header 与 payload 身份/状态不一致；旧包或未知图版本；task 包版本/幂等键不一致；重复任务、失联依赖、自依赖、环；任务账号越界、publication 账号归属不符；package taskRefs 与图不一致；分页不完整；采集时间未来或超过 30 分钟；缺完整代码 SHA；输入含 token/password/authorization/cookie/private key。缺凭证不应通过输入密钥解决。

脱敏：报告只输出固定 check code、布尔值、计数和验证边界，不输出 tenant/account/actor/request/publication/task 的原值，不输出 payload、密钥、错误原文。采集端应按身份字段 allowlist 生成投影，剔除客户内容、消息、账户 handle、联系方式与凭证，原始资料保留在既有受控系统。不要复制 accessToken/refreshToken/clientSecret/Authorization/cookie/password/privateKey 到 JSON 或日志。

图检查只证明输入内部一致；不证明实际节点执行、原片质量、资产存在、真实发布回执、询盘或成交。statuses=succeeded 无法关闭这些验收门。要验证真实周执行仍需各正式 worker 的持久 job、canonical content/run、真实 provider 回执与产物证据分别核验。

## WhatsApp 与 Messenger 证据

模块：scripts/runtime-evidence/customer.mjs，导出 validateWhatsAppEvidence(input)、validateMessengerEvidence(input)。返回 status verified/failed/missing、逐项 checks、脱敏 summary。输入为 {expected,evidence,dryRun,signature}；expected 是调用者从当前正式租户账号/版本上下文读取的预期身份，不能用回执自身复制代替当前上下文。

expected：tenantId/accountId/version/accountHash/customerId/recipientId/nativeAccountId；WhatsApp 另需 wabaId。version 是采集快照 authority revision，不宣称 social_accounts 有统一 version 字段。accountHash 要来自正式账号 authority 读取，不能现场自造。

evidence：channel/tenantId/version/accountHash/capturedAt/expiresAt/requestId/requestStatus/deliveryStatus/historyWritebackPending/account/customer/providerReceipt。account 必须包含 tenantId/accountId/status，WhatsApp phoneNumberId/wabaId，Messenger pageId/providerAccountId。customer 包含 tenantId/customerId/recipientId；WhatsApp waNumber，Messenger pageId/messengerUserId。receipt 使用真实 integration 的 messageId/recipientId/raw；WhatsApp raw.messaging_product/messages[0].id/contacts[0].wa_id，Messenger raw.message_id/recipient_id。仅 accepted + delivered/read + historyWritebackPending=false、24小时内有效证据可通过合同。返回不包含任何输入 ID、原始 body、token 或号码。

本地 JSON、trusted:true、自带公钥、provider 名称、MID 字符串均不能建立可信性。signature 是独立可信只读采集器对 customerEvidenceSigningPayload(evidence) 的 Ed25519 签名；执行环境 CUSTOMER_EVIDENCE_TRUSTED_PUBLIC_KEY 必须由运维独立固定可信公钥，不能接受提交者随 JSON 设置。该模块不提供签名者、不生成线上签名、没有网络请求和消息外发，也不落盘密钥。若环境公钥也可由提交者改写，verified 只能代表被选中密钥的签名，不能代表真实 Meta 可用，应视为未建立信任。

采集器尚未接入，本次没有真实客户 channel 可用性结论。未来采集必须通过已授权只读 DataStore/现有正式 service 获取：WhatsApp readCanonicalWhatsAppAccount、whatsapp_customers 及 verified_meta_webhook 交互；Messenger social_accounts 的 tenantId/platform facebook/providerAccountId/status connected 与非 mock 客户 pageId/messengerUserId；对应持久化发送 request、provider receipt 与签名 webhook delivered/read 记录。只导出白名单字段与 authority revision/hash，再由独立采集器签名。不能运行 scripts/verify-whatsapp-real-send.ts 或 messenger-release integration 来“只读采集”，它们可能真实外发。

安全本地只读检查命令（无生产、网络或外发）：

    node --test scripts/runtime-evidence/customer.test.mjs
    rg -n 'WhatsAppSendReceipt|sendReceipt' server/integrations/whatsapp.ts
    rg -n 'message_id|recipient_id|pageId' server/integrations/messenger.ts
    rg -n 'recordSignedChannelReceipt|accountAuthorityHash|providerReceipt' server/digitalEmployees/customerChannelSendRequests.ts

dryRun:true 最多返回 missing，即合同验证通过但缺真实验真；正常模式缺可信签名同样 missing。错误租户/账号/预期版本/hash、不同 recipient/Page/WABA、原始 provider 回执不匹配、mock、过期、unknown/failed/unverified delivery 均 failed。签名被修改或没有可信公钥不能通过；历史 delivered/read 并不保证未来发送权限、消息窗口或 recipient 持续可达。

统一离线命令（root collector，仅 local 读取授权导出、输出脱敏报告）：

    node scripts/runtime-evidence-collector.mjs --input work/runtime-evidence-input.json --out work/runtime-evidence-dry-run

完整输入 shape（以下仅结构例子，不是可信 provider evidence）：

```json
{
  "sections": {
    "whatsapp": {
      "dryRun": true, "mode": "dry-run",
      "expected": {"tenantId":"tenant", "accountId":"account", "version":2, "accountHash":"64-character-sha256", "customerId":"customer", "recipientId":"digits", "nativeAccountId":"phone-number-id", "wabaId":"waba"},
      "evidence": {
        "channel":"whatsapp", "tenantId":"tenant", "version":2, "accountHash":"64-character-sha256",
        "capturedAt":"ISO date", "expiresAt":"ISO date", "requestId":"durable-request", "requestStatus":"accepted", "deliveryStatus":"delivered", "historyWritebackPending":false,
        "account":{"tenantId":"tenant", "accountId":"account", "status":"active", "phoneNumberId":"phone-number-id", "wabaId":"waba"},
        "customer":{"tenantId":"tenant", "customerId":"customer", "recipientId":"digits", "waNumber":"digits"},
        "providerReceipt":{"messageId":"provider-mid", "recipientId":"digits", "raw":{"messaging_product":"whatsapp", "messages":[{"id":"provider-mid"}], "contacts":[{"wa_id":"digits"}]}}
      },
      "signature":"optional-base64-trusted-collector-signature"
    },
    "messenger": {
      "dryRun":true, "mode":"dry-run",
      "expected":{"tenantId":"tenant", "accountId":"account", "version":2, "accountHash":"64-character-sha256", "customerId":"customer", "recipientId":"psid-digits", "nativeAccountId":"page-digits"},
      "evidence":{
        "channel":"messenger", "tenantId":"tenant", "version":2, "accountHash":"64-character-sha256", "capturedAt":"ISO date", "expiresAt":"ISO date",
        "requestId":"durable-request", "requestStatus":"accepted", "deliveryStatus":"read", "historyWritebackPending":false,
        "account":{"tenantId":"tenant", "accountId":"account", "status":"connected", "pageId":"page-digits", "providerAccountId":"page-digits"},
        "customer":{"tenantId":"tenant", "customerId":"customer", "recipientId":"psid-digits", "pageId":"page-digits", "messengerUserId":"psid-digits"},
        "providerReceipt":{"messageId":"provider-mid", "recipientId":"psid-digits", "raw":{"message_id":"provider-mid", "recipient_id":"psid-digits"}}
      }
    }
  }
}
```

输入须仅包含最小授权字段，移除原始文本、访问 token、手机号显示名称等非必需敏感内容；scope ID 的精确等值校验须在可信只读采集上下文执行。若已脱敏导出改变 recipient 格式或 identity，合同应失败，不能用掩码冒称原始 receipt verified。输出始终全脱敏。collector 强制 dryRun:true/mode:dry-run，runtimeVerified:false；checks.passed 仅指相应合同条件。模块采用系统时钟，不接受输入 now 绕过过期检查。

## Instagram 与发布权限证据

运行统一采集器：

```sh
node scripts/runtime-evidence-collector.mjs --input work/runtime-evidence-input.json --out work/runtime-evidence-dry-run
node --test scripts/runtime-evidence/provider.test.mjs
```

采集器只读取已有、本地、获得授权的脱敏导出。不得调用 provider、发消息或发布。合同全部通过仍返回 `status=missing`，因为离线运行没有 provider 验真；checks 全通过仅表示 dry-run 合同满足，不表示生产可用或发送授权。输出 `summary.providerVerified=false`，collector 将 missing 呈现为 unverified。顶层 collector 应保持 `runtimeVerified=false`，强制 dryRun/mode 并以系统 now 覆盖输入时间。

输入分别放在 `sections.instagram` / `sections.publication`，由 collector 调用 `validateInstagramEvidence` / `validatePublicationEvidence`。共同最小结构：

```json
{
  "now": "系统当前 ISO 时间（collector 覆盖）",
  "scope": {"tenantId":"租户","accountId":"内部账号","accountVersion":1,"accountIdentityHash":"64位小写SHA256"},
  "account": {
    "tenantId":"租户","accountId":"内部账号","accountVersion":1,"accountIdentityHash":"同scope",
    "platform":"instagram","providerAccountId":"平台原生账号","status":"connected",
    "oauthProvider":"instagram_login","tokenKind":"instagram_user","graphHost":"https://graph.instagram.com",
    "scopes":["instagram_business_basic","instagram_business_manage_messages"],
    "tokenRef":"不可逆64位凭据引用hash","tokenExpiresAt":"未来ISO时间"
  }
}
```

accountVersion 是采集 envelope 的版本绑定，不能伪称现有 capability row 原本含该字段；必须由同一次可信只读导出关联账号版本，并保留原始 row hash。accountIdentityHash 必须来自正式 `platformAccountIdentityHash`，不可用占位hash或对脱敏账号重算冒充原hash。tokenRef 不含 token，不替代真正 credential 的运行时解析。

Instagram 增加：

```json
{
 "professionalAccount":{"tenantId":"同scope","accountId":"同scope","accountVersion":1,"accountIdentityHash":"同scope","providerAccountId":"同account","source":"provider_read","provider":"meta","accountType":"BUSINESS或MEDIA_CREATOR","receiptRef":"可信原始读取引用","rawReceiptHash":"原始回执SHA256","observedAt":"最近30分钟ISO"},
 "recipient":{"tenantId":"同scope","accountId":"同scope","accountVersion":1,"accountIdentityHash":"同scope","providerAccountId":"同account","source":"signed_webhook","verifiedSignature":true,"signedBodyHash":"原始签名body SHA256","eventHash":"正式事件hash","inboundMessageId":"真实入站mid","recipientId":"IG-scoped发送方ID","direction":"inbound","inboundAt":"过去24小时ISO"}
}
```

专业账号类型来自真实 provider 只读账号响应；recipient 只能来自原始经过签名验证的 inbound webhook 和对应 native account/customer 关联。不能以发布 post、用户名、任意ID或出站回执代替入站关系。`verifiedSignature` 必须引用已有正式验证记录，手工填true不产生真实性。Facebook Login 必须使用 facebook_page token、graph.facebook.com、parentPageId 以及 instagram_manage_messages；Instagram Login 使用 instagram_user / graph.instagram.com / instagram_business_manage_messages。发布权限独立：Instagram Login 还需 instagram_business_content_publish；Facebook Login 需 instagram_content_publish。

Publication 增加 `capabilityReceipts`（唯一 publishing.official；TikTok 另需唯一 publishing.receipt_lookup）和 TikTok `receiptId`：

```json
{"capabilityReceipts":[{"tenant_id":"同scope","account_id":"同scope","account_version":1,"account_identity_hash":"同scope","platform":"tiktok","capability":"publishing.receipt_lookup","status":"verified","evidence_source":"provider_probe","evidence_ref":"provider:tiktok:receipt:精确receiptId","provider_receipt_id":"精确receiptId","verified_at":"最近30分钟ISO","expires_at":"未过期且不超过verified_at加16分钟","raw_receipt_hash":"可信原始回执SHA256","receipt_ref":"可信原始回执引用"}],"receiptId":"精确receiptId"}
```

同时提供 publishing.official row。权限：TikTok video.publish、Facebook pages_manage_posts、YouTube https://www.googleapis.com/auth/youtube.upload。非TikTok lookup依照正式 native token authority，不伪造 provider_probe lookup row。

可只读确认源码（无网络、无密钥输出）：

```sh
rg -n 'resolveInstagramPublishingContract|requiredScope' server/publishing/instagramPublishingContract.ts server/instagram/send.ts
rg -n 'platformAccountIdentityHash|platformCapabilityEvidenceIsCurrent' server/publishing/platformCapabilities.ts
cat server/publishing/weeklyReceiptLookupAuthority.ts
```

原始 receipt 必须来自已有正式 provider probe/signed webhook 存储，绑定原始字节hash、租户、账号、版本及身份hash；不可伪造、由 operator_review 升格或复制他账号/他receipt。不得把 accessToken、refreshToken、clientSecret、Authorization、密码、原始body或完整recipient写入采集产物。校验器检测直接凭据键并失败；输出只包含固定check代码与布尔值、平台及计数，不返回任何输入身份、receipt、recipient、hash或错误原文。

缺必需section/block为 missing；已有证据但越租户/版本/身份漂移、重复capability、签名缺失、超响应窗口、失效token、权限/host错配、过期/非providerprobe、receipt不精确或包含秘密为 failed。即使dry-run通过，也必须在正式运行入口重新做 live credential/capability/recipient authorization，不能将此结果导入 runtime 可信证据集合。
