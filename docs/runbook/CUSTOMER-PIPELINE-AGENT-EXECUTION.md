# 数字员工客服管线执行说明

适用代码：`0c994b3c88c1ccb06b39a4a96811cfc60d329aec`。分支：`xixi智能客服隔离测试`。整理日期：2026-10-22。

本说明供数字员工或外部编排器执行客服排查、草稿生成、按标签筛选、老客唤醒和新客管理。覆盖 46 个业务节点及草稿查询入口 A6R，内部帮助函数不单独算业务节点。每次执行必须保留原对象 ID、版本、内容哈希和结果状态；草稿完成、人工批准、平台受理、发送和送达分别记录。

当前结论是源码及隔离链路通过，不能据此向真实客户发送。本说明不授权真实模型调用、客户联系、生产迁移、合并或部署。需要真实调用的步骤，只有在具体任务已明确授权、目标环境满足条件时才执行；否则完成只读核对并报告阻塞。

## 一 执行前检查

1. 核对运行环境对应上述代码。部署中的接口若返回 404，先核对版本和挂载，不猜测其他 URL，也不把仓库内函数名当作远端接口。
2. 使用既有登录流程得到 `Authorization: Bearer <TOKEN>`；租户和操作者由登录态决定。不要在 body 中补写 tenantId/userId 试图切换身份，不记录令牌或账号密钥。
3. 确认环境已具备既有业务集合，以及新增的 `customer_reply_requests`、`customer_classifications`。本次仅在临时数据库演练迁移，没有迁移现用数据库；缺集合应停止并交环境负责人处理。
4. 获取已存在、归本租户的 `runId`，该运行必须有唯一的 `agent_role=customer`、`task_key=customer_segmentation` 任务。不要临时创建一个空 run 代替业务上下文。新批量入口拒绝 cancelled/paused/failed/succeeded 运行。
5. 若要进入周任务发送，另取得真实的 programId、packageId、packageVersion，并核对该周包与 run 的显式绑定。单纯筛选不代表已经绑定周包。
6. 读客服状态与能力发现；若渠道授权、具体会话范围、语言、时区、知识或审批缺失，按相应原因停止，不扩大客群或发送范围。

全文 URL 使用以下缩写；实际 HTTP 客户端必须展开，不把缩写发送给服务端：

| 缩写 | 实际前缀 |
| --- | --- |
| API | `/api/overseas` |
| DE | `/api/overseas/digital-employees` |
| CB | `/api/overseas/customer-batches` |
| WK | `/api/overseas/social-programs/:programId/operating-packages/:packageId` |
| WC | `/api/overseas/wecom-customer-service` |

除平台签名回调外，使用登录态；JSON 写请求带 `Content-Type: application/json`。所有 `:id` 都取自上游真实返回。批量管理权限为 admin/super_admin/customer_service；支持会话只读约束继续生效，浏览器只读令牌不能执行分类、冻结、资料确认或发送。

### 验证标记

- **隔离**：对应模块或场景有受控依赖测试，不表示整条生产 HTTP 链路已经运行。
- **存储**：一次性 PocketBase 0.39.5 中实测，仅覆盖新增请求/分类集合及既有 CAS 依赖。
- **界面**：真实组件配合内存 API 完成浏览器操作。
- **源码**：路径、输入输出和挂载由本提交源码核对，没有单独声称该节点的真实 HTTP 验收。
- **待真联**：真实账号、真实模型、签名回调、平台回执及目标环境仍需另行联调。

以下节点凡涉及供应商，均另有“待真联”条件；表中“隔离”不能解除它。

## 二 接待与单客回复节点

A6 到 A14 是同一个草稿请求内部的分支和中间节点，不能分别 POST 调用，也没有逐阶段断点恢复接口。持久账本保存请求身份及最终结果；模型结果尚未落库就丢失时，只能报告未知，不能承诺还原候选或继续供应商原会话。

| 节点及接口 | 输入 | 输出与下一步 | 异常恢复及验证 |
| --- | --- | --- | --- |
| A1 客服配置与授权，GET `API/enterprise/customer-service/status` | 登录态、当前企业配置与渠道授权 | enabled、入站/跟进权限、`ingressMode`、`inboundAutoReplyConnected`、`canAutoSend` 等；继续 A2/A5 | 权限不足先补授权；正式 WhatsApp 为 persist_and_qualify_only，自动接待未连接。隔离、源码；待真联 |
| A2 平台入口，GET/POST `/api/webhooks/meta/:tenantId` 或 `/api/webhooks/instagram/:tenantId` | 平台验证请求或原始请求体、有效签名、账号归属 | 校验后的本租户渠道事件，进入 A3 | 签名或账号不符拒绝；Agent 不伪造回调测试真实环境。源码及相关隔离；待真联 |
| A3 消息标准化和去重，内部 webhook/historyInbound/conversations | 已验证平台消息 ID、账号、recipient、正文与时间 | 持久 interaction/conversation/timeline、去重信息 | 以原平台 ID 核对，不能重建假消息；WhatsApp 正式入口保存与资质更新后停止，不自动生成/发送。隔离；待真联 |
| A4 画像与上下文，内部 businessProfile/contextTags/qualification | 当前账号准入买家消息、会话指纹、有效分类证据、限制标记 | BANT、intentScore、stage、标签证据、classificationStatus、businessFacts | 无证明资料为 unknown/pending；分类不能清除退订、黑名单及人工处理。转 D4/D5，不恢复旧正向标签。隔离 |
| A5 客户读取，GET `API/customers?source=whatsapp`，或 messenger/instagram | 登录态、可选 source | `{items,source}`；取客户 ID/会话供草稿或筛选 | 列表可能含本地预览或历史资料，不能直接当发送授权；批量应走 D3 的准入源。空列表先查渠道就绪。隔离、源码 |
| A6 草稿受理，POST `API/agents/conversion/draft` | 严格请求 schema、稳定 requestId、customerId、timeline | 先创建 pending 请求；再返回统一结果或 202；见第六节 | 输入错误 400；同 ID 不同输入 409；存储不可用 503。始终保留 ID，恢复只查 A6R。隔离、存储 |
| A6R 原草稿查询，GET `API/agents/conversion/draft/:requestId` | 原 requestId、同租户同操作者 | 原结果；pending 或明确未知/failed | 202 继续有限查询；超过总时限仍 pending 则 409/outcome_unknown，停止重复生成。非原身份 404。隔离、存储 |
| A7 确定性短回复，内部 conversationTone/fastProductInquiry/directConversationPayload | 意图、会话阶段、问候/感谢/延后/首轮产品询问、可用事实 | 短草稿、气泡及确定性验证标记，进入 A14 | 不匹配则继续检索/生成；不能把确定性分支称为模型生成。统一外层契约受隔离测试；规则细节见源码 |
| A8 企业知识，内部 retrieveContext | 租户企业资料、最新消息、产品与已审核知识 | RetrievedContext、事实版本、规则/FAQ/产品证据、knowledgeMiss | 歧义澄清，知识不足转 A9/B14；不能编造价格交期。源码、现有客服测试链；待真联 |
| A9 销售动作与人工分流，内部 actionLibrary/handoff/decision | 当前事实、客户意图、风险、fallbackCount | 澄清、承接草稿或 `decision.execution=human_required` | waiting_human 时交负责人；不能因有草稿就自动发送。统一契约及接管相关隔离；待真联 |
| A10 策略和记忆，内部 strategyRetrieve/customerMemory/styleMemory | 租户、客户、场景、可信会话 | 策略证据、客户记忆、表达提示块 | 无匹配不是接口不存在；失败按返回状态/日志留痕，风格记忆不充当业务事实。源码、现有客服测试链；待真联 |
| A11 回复计划，内部 replyPlanning | 会话、企业事实、策略、目标 | ReplyPlan 或 fallbackPlan，交 A12 | 本阶段无独立查询/重启 API；外层超时按 A6R。源码、现有客服测试链；待真联 |
| A12 候选生成和排序，内部 LLM/rankReplyCandidates | 计划、语言、可信会话、企业事实、表达风格 | 候选、选中正文与排名信号 | 解析无候选时用安全承接并标记 degraded；不把兜底当 provider_generated。源码及降级契约隔离；待真联 |
| A13 事实校验，内部 verifyGeneratedDraft | 候选、知识证据、数字、禁用承诺和风险 | verification.status/issues；verified/revised/safe_fallback 等 | 降级或高风险转人工审核；不抹掉 issues。源码、现有客服测试链；待真联 |
| A14 气泡和中文对照，内部 mobileChatStyle/draftReplyLanguage/replyEnvelope | 已校验客户语言正文、事实版本、decision | draft/messages、translatedDraft/translatedMessages 和完整 envelope | 缺中文对照保留原文，不制造中文摘要；空草稿为 blocked。隔离；真实翻译待真联 |
| A15 前端投影，内部 requestDraft/CustomerReplyRecovery | 外层 HTTP、状态、原文、中文稿、验证和事实版本 | 可编辑稿与状态提示、读取原结果入口 | HTTP 错误显示空草稿和原因；pending 不存成有效草稿；不能把原失败改成本地成功话术。隔离 |
| A16 编辑后翻译，POST `API/plugins/translate/run` | `{text,source:"简体中文",target:<客户语言>}` | translatedText；保留客户语言正文 | 前端 6 秒超时/无有效译文则保留原文并阻止本次发送，不用关键词话术替代。源码；真实模型待真联 |
| A17 接管，GET/POST `API/customers/:id/manual-active`，POST `.../release` | hold：minutes，可带 expectedVersion/ownerUserId；release：expectedVersion | hold、owner、expiresAt、版本；停自动发送 | 先 GET 读取当前版本；冲突重新读，只有授权人释放，不擅自解除人工接管。隔离 |
| A18 通用原生发送，GET `API/customers/:id/outbox/context` 后 POST `.../outbox` | context 返回的账号范围；正文、requestId；明确发送授权 | 原生渠道发送账本及平台身份，交 A19 | 仅 Messenger/Instagram；WhatsApp POST 返回不支持，不换 URL 绕行。结果未知只查原请求。隔离；待真联 |
| A19 回执和历史修复，GET `API/customers/:id/outbox/:requestId`；POST `.../:requestId/reconcile` | 原 requestId；reconcile body `{}` | item.status/deliveryStatus/providerMessageId/historyWritebackPending；修复返回 messagesSent=0 | reconcile 只补本地历史，不重发；unknown/sending 留待签名回执或恢复流程，不伪称送达。隔离；待真联 |
| A20 反馈和复用，内部记忆审计及周反馈模块 | 已发正文、人工修改、后续真实会话 | 风格/客户记忆、知识缺口及销售反馈证据 | 记忆写入失败与发送结果分开；不为补记忆重发客户消息。源码及现有测试链；完整闭环待真联 |

通用 outbox 的 `localPreview:true` 仅表示本地模拟；禁止将其状态 sent 当作真实平台发送。`accepted` 也不等于 delivered/read。真实发送必须保留 providerMessageId 及原账号/recipient 证据。

## 三 批量管理入口节点

D 节点是 Agent 推荐使用的新增公开入口；不要用旧的 `POST DE/runs/:runId/customer-segments` 替代 D3+D7。旧入口无 previewHash 冻结协议、返回运行总览，也不提供同样的批量客户证据投影。

| 节点及接口 | 输入 | 输出与下一步 | 异常恢复及验证 |
| --- | --- | --- | --- |
| D1 能力发现，GET `CB/capabilities` | 登录态 | criteriaSchema/criteriaFields、reply schema、actions、presets、endpoints、unsupportedActions | 不支持字段停止调用，不猜测；此结果只证明代码能力，不证明账号/模型 Ready。HTTP 隔离 |
| D2 准入资料汇总，内部 readCustomerBatchSources/profiles | run/goal、授权 WA/Messenger 客户、已选原生会话、订单/报价/知识异常 | 当前客户及 businessFacts：relationship/purchase/waitingFor、时间和证据 | Instagram 批量源来自已选择会话，不保证枚举全部 IG 客户；缺可用渠道明确阻塞。历史资料不制造新客或成交。隔离 |
| D3 预览，POST `CB/runs/:runId/preview` | `{criteria}` | schemaVersion/runId/criteria/previewHash/capturedAt/counts/rows/messagesSent=0 | 不创建分群、不发送；逐客 included/inclusionReasons/exclusionReasons/evidence。unknown 先补资料，不能改成 no_data。HTTP 隔离、界面 |
| D4 标签复核，POST `CB/runs/:runId/classify` | `{customerIds:[...]}`，1 至 10 人 | `{items:[{customerId,status,tags或code,retryable}],messagesSent:0}` | 逐客判定；同账号同会话已完成模型结果可复用；failed/unknown 不自动再次调用供应商。成功后重新 D3。隔离、界面；真实分类待真联 |
| D5 资料确认，POST `CB/runs/:runId/customers/:customerId/profile` | expectedFingerprint；profile.language/timeZone，可选 countryName | customerId/profile/reviewedBy/messagesSent=0 | 时区须为有效 IANA 时区；指纹变化先重读；确认是业务人工输入，不能按姓名猜语言或时区。隔离、界面 |
| D6 新询盘确认，POST `CB/runs/:runId/customers/:customerId/confirm-new-inquiry` | firstMessageId/expectedFingerprint/reason | classification=new_inquiry，保存当前账号/run/goal 证据 | 需本周首条真实买家消息；已有往来冲突拒绝。WA 复用既有关系确认；原生确认不产生发送授权。隔离 |
| D7 冻结，POST `CB/runs/:runId/segments` | 原 criteria、expectedPreviewHash | segment/members/purpose/messagesSent=0，可有 created；交 B5 或结束筛选 | preview_changed 重新 D3；同一已完成范围读回原结果。building/写入不确定先只读核查，按第九节处理，不承诺任意 POST 自动修复。HTTP 隔离、界面 |

### 条件字典

以 D1 返回的 schema 为准；以下是本提交语义。未知 key、错误类型、越界分数、最小值大于最大值会被拒绝，不做静默放宽。

| 字段 | 语义和范围 |
| --- | --- |
| match | all 或 any；默认 all。any 下未知证据仍保守排除，不以 OR 绕过未知 |
| stages/excludeStages、handlingModes、bantLevels、sources | 字符串数组；排除项是硬限制。stage 不是新老客关系 |
| minIntentScore/maxIntentScore | 0 至 100；默认周跟进条件有独立阶段与意向门槛，批量场景不暗中添加业务阈值 |
| tags/tagsAny、tagsAll、tagsNone | tags/tagsAny 为任一；tagsAll 为全部；tagsNone 为排除。值须来自真实标签，不是自由关键词全文搜索 |
| activeWithinDays | 1 至 3650；近期活跃 |
| inactiveDaysMin/inactiveDaysMax | 0 至 36500；按最近买家互动计算沉默天数，资料未知则 unknown |
| countries/languages/productIds | 对应已证明或人工确认的资料、产品 ID；缺字段不当作不匹配的确定事实 |
| relationships | new_inquiry、existing_contact、unknown；既有往来不等于买过产品 |
| purchase | recorded_paid、none_verified、unknown。默认资料投影只产生 recorded_paid 或 unknown；不能用“未发现订单”证明 none_verified |
| waitingFor | seller、customer、quote_review、knowledge_review、unknown；报价/知识状态取真实业务记录。卖家历史不完整时待谁回复可为 unknown |
| includeCustomerIds/excludeCustomerIds | 显式允许/排除名单，不绕过退订、授权或未知证据 |
| purpose | screen、followup、reactivate、new_inquiry、repurchase；指定草稿业务目的 |
| managementAction | screen 只冻结筛选结果；draft 才准备原草稿任务。purpose=screen 不等于 managementAction=screen，二者都应显式提供 |

不支持任意自然语言自动编译筛选条件、任意嵌套规则、批量指派负责人或批量覆盖人工标签。人工接管客户可供业务筛选，但不因此解除发送门禁；退订和黑名单直接排除。

## 四 周任务跟进节点

| 节点及接口 | 输入 | 输出与下一步 | 异常恢复及验证 |
| --- | --- | --- | --- |
| B1 周运行绑定，WK/customer-run-candidates、customer-run-binding | GET 带 version；POST binding 带 packageVersion/runId | 候选或 `{item}` 绑定/日历状态 | 先读取再显式绑定，不能将其他 run 偷换到旧周包。隔离 |
| B2 渠道范围，GET/POST `WK/customer-channel-scope` | GET version/runId；POST packageVersion/runId/channel/accountId/customerId/inboundMessageId/classification/reason | `{item}` 当前选项或确认收据/哈希 | 全部来自真实选项；原生私信未选择只能筛选，不能 draft/dispatch；权限证明过期需重新核验。隔离；待真联 |
| B3 条件筛选 | D2 当前准入资料和 D3 criteria | 每客纳入/排除/未知、解释与证据 | 走 D3，不按客户名或 stage 猜关系。隔离、界面 |
| B4 快照持久化 | D7 确认的范围、成员、criteriaHash | customer_segments/customer_segment_members；building 完整后 generated | 内部 completeAggregate 使用冻结 manifest/确定性 ID 补齐；公开 HTTP 恢复限制见第九节。隔离故障注入 |
| B5 逐客草稿，POST `DE/customer-segments/:segmentId/followup-batches` | body `{}` 或可选 name；运行冻结企业事实和已冻结成员 | **HTTP 201 返回运行总览**；随后读 customer-workspace 取得 batch/items | 不是 `{batch,items}` 直返。结果不明先读，不能盲重 POST。screen 客群拒绝生成。隔离内部链，HTTP 接线源码；真实模型待真联 |
| B6 准入与排期冻结，内部 customerWorkflow | 各客正文、时区、最后入站、频率、风险、渠道 | item draft/blocked、具体 last_error、send_mode、scheduled_at、content_hash；父批次 building→draft | 任何 blocked 先补具体条件；不得跳过时间/人工门禁。中断按原冻结计划恢复，不改正文排期。隔离 |
| B7 WA 模板，GET `DE/followup/templates`，PUT `DE/followup/batches/:batchId/items/:itemId/template` | 正式模板名 templateName、language、variables | 渲染后的新批次版本/哈希及审批失效 | 窗外不能改普通文本强发；只能用真实审核通过模板；配置后重新读取、审批。相关隔离；模板供应商待真联 |
| B8 审批与修订 | 当前批次版本/内容/请求哈希、审批人；必要时 revise | 审批记录、批准版本和逐客状态，或新修订批次 | 不用聊天中的“批准”代替接口；不自行批准，发送范围改变必须重新审。写失败明确报错。隔离 |
| B9 预检，GET `DE/followup-batches/:batchId/dispatch-preflight`；原生另读 native-dispatch/sources | 当前批次、审批、worker、渠道与最新证据 | authorized/batchApproved/blockers/future 等，或原生逐项候选 | 预检是只读，不是发送；future 等待原 scheduled_at；blocks 处理原因。隔离；待真联 |
| B10 领取与派发，WA 的 DE dispatch 或原生 WK/native-dispatch | 当前审批、到期项、scope、版本/hash | claim、原生请求身份、逐气泡平台回执 | 必须明确发送授权；原生到期前拒绝；严禁改时间、换请求 ID 绕重放保护。隔离模拟派发；待真联 |
| B11 回执与恢复 | 原 item/request ID、签名平台回执、原 authority | sent/partial_sent/blocked、delivery/read、恢复任务 | unknown/partial 不计全部成功，禁止自动重发；进入 send-recoveries/native-send-recoveries。隔离；待真联 |
| B12 证据投影，GET `WK/customer-run-binding/:runId/steps/:step?version=...` | 四种 step、原绑定版本、真实分群/批次/审批/回执 | `{item}` 中阶段证据、resultRefs、succeeded/blocked/no_data 等 | 不用 workflow metadata、草稿数或 HTTP 2xx 替代业务完成。隔离 |
| B13 无数据与重新入场，内部 customerReentry/运行编排 | 完成的空分群、新客户、当前窗口和既有发送证据 | 真 no_data 或重新激活下游任务 | unknown、渠道未授权、building 都不是 no_data；不要重复绑定、伪造新客户或重发旧项。隔离 |
| B14 知识报价补齐，WK/customer-knowledge-quote-requests | 原 scope、批次/单客、负责人/审核人、期限、版本和真实证据引用 | requested→submit→verify→apply/审核及新批次证据 | 不能直接替换原批准正文；按明确负责人及 expectedVersion 流转，详见第八节。相关隔离；真实业务闭环待真联 |
| B15 日历和反馈，binding/steps、既有销售移交与反馈模块 | 前述真实结果、预约、异常、销售反馈 | 日历状态、异常、移交和反馈主题 | 将“到期未执行”“未知结果”“已送达”分别呈现；本说明不提供自动发起销售联系的授权。源码、相关隔离；完整闭环待真联 |

### 批次读取和审批的具体接口

1. GET `DE/runs/:runId/customer-workspace`：返回 scope、tasks、readOnly、segment、members、batch、items。读取 `task_key=followup_batch_approval` 的 taskId。
2. GET `DE/customer-segments/:segmentId`：返回 `{segment,members}`。GET `DE/followup-batches/:batchId`：返回 `{batch,items,bulkWorkerStatus,messagesSent}`。此处 messagesSent 可包含有 provider ID 的 partial_sent，不代表全批所有气泡已完成。
3. GET `DE/runs/:runId/customer-task-navigation/approval?taskId=:taskId`：返回 `{item}`；从 item 取 approvalId、batchVersion、contentHash、requestHash、canDecide 和逐项内容。canDecide=false 时停止。
4. 审批人核对后 POST `DE/approvals/:approvalId/decide`：

```json
{"decision":"approved","note":"<审批人确认的说明>","expectedSubjectVersion":"<batchVersion字符串>","expectedContentHash":"<contentHash>","expectedRequestHash":"<requestHash>"}
```

该接口返回运行总览；再 GET 原批次核对批准状态。被拒则保持 rejected，由负责人修订，不把 rejected 改成 approved。

5. 需要修订时 POST `DE/followup-batches/:batchId/revise`。手工修改示例为 `{"version":<当前数值版本>,"drafts":{"<customerId>":"<有效正文>"},"note":"<原因>"}`；须提供所有客户的有效正文。`regenerate:true` 是新的生成动作，不是未知结果的恢复。批准或执行中的批次不可直接覆盖。
6. GET `DE/followup-worker/status` 确认 scheduled/manual_only 等实际状态。读取或审批操作可能推进既有运行；执行前应理解原 worker 授权，不能以“我只调用了审批”断言后续不会按既定规则派发。

## 五 三个场景的执行顺序

### 按标签批量筛选

1. 执行前置检查，GET `CB/capabilities` 和 `DE/runs/:runId/customer-workspace`。
2. 使用业务负责人给定的条件，先 POST preview。下面只是示例值，不是自动适用的经营规则：

```json
{"criteria":{"purpose":"screen","managementAction":"screen","match":"all","tagsAll":["索取样品"],"tagsNone":["<业务明确排除的已有标签>"]}}
```

3. 检查 counts 与逐客 evidence；tags 未分类时每组最多 10 人调用 classify，再重新 preview。HTTP 200 下 items 也可能部分失败，必须逐客查看。
4. 只有业务确实确认的语言、时区或新客关系才调用 profile/confirm-new-inquiry。每人单独请求；批量部分成功后重新预览，不假称原子批量成功。
5. 记录 `previewHash` 和原 criteria；POST segments，body 为 `{"criteria":<原criteria>,"expectedPreviewHash":"<原previewHash>"}`。
6. 确认 segment.status=generated、成员与预览一致，记录 segment ID/version/hash。managementAction=screen 到此结束，**不要调用生成、审批、dispatch**。

### 老客批量唤醒

1. GET 能力与工作区；确认“老客”究竟指 existing_contact 还是 recorded_paid，沉默天数和意向门槛由业务明确给定。
2. 如只是列名单用 managementAction=screen；若授权生成待审草稿，用 draft。已有往来唤醒示例：

```json
{"criteria":{"purpose":"reactivate","managementAction":"draft","match":"all","relationships":["existing_contact"],"inactiveDaysMin":30,"minIntentScore":40,"tagsNone":["<明确排除的已有标签>"]}}
```

已记录成交复购改为 purpose=repurchase、purchase=recorded_paid；不把 existing_contact 当付费，不因旧会话存在就认定已买过。

3. 若原生渠道缺 weeklyChannelSelection，先用 screen 预览，再按 B1/B2 确认具体周包/会话范围，重新用 draft 预览。当前选择是具体会话能力，不保证任意规模的所有原生客户都可同时群发。
4. 完成资料复核与重新 preview，按原 hash 冻结，再按 B5 生成逐客待审草稿。
5. 只读工作区取真实 batch/items；逐项审查 blocked/last_error。老客沉默常超过 24 小时：WhatsApp 需要正式模板；Messenger/Instagram 没有 WA 模板豁免，消息窗口不满足就保持阻塞。
6. 经当前版本人工审批、预检、到期和渠道授权后，才进入已授权发送；查询回执并读周任务证据。发送未知进入恢复，不重新生成一个批次避开异常。

### 新客管理

1. 先 `purpose=new_inquiry,managementAction=screen,relationships=["unknown","new_inquiry"]` 做资料盘点，或仅选择 unknown 核查。unknown 不是已确认新客。
2. 对待核实客户读取 D3 的 buyerMessages、fingerprint 和 facts，确认是否本周首次真实询盘、是否有周前往来或订单；不得按创建日期或 stage=inquiry 自动分类。
3. 业务确认后调用 D6：

```json
{"firstMessageId":"<真实首条买家消息ID>","expectedFingerprint":"<preview返回的64位fingerprint>","reason":"<确认本周首次询盘的具体依据>"}
```

原生此步只证明关系；继续 draft 仍需 B2 具体渠道选择。资料确认示例：

```json
{"expectedFingerprint":"<preview返回的64位fingerprint>","profile":{"language":"English","timeZone":"Europe/Paris","countryName":"France"}}
```

4. 对确认证据后的客户重新 preview，使用下列严格条件；不把未确认 unknown 并入正式新客批次：

```json
{"criteria":{"purpose":"new_inquiry","managementAction":"draft","match":"all","relationships":["new_inquiry"]}}
```

5. 依次冻结→生成逐客草稿→逐项资料/风险检查→人工审批→预检/到期→授权派发→读回执/周证据。知识或报价待处理转 B14，不能用“先联系再说”绕过缺口。

### Agent 必须保存的执行上下文

```json
{"codeCommit":"0c994b3c88c1ccb06b39a4a96811cfc60d329aec","runId":"<真实ID>","scope":{"programId":"<周任务才需要>","packageId":"<真实ID>","packageVersion":1},"criteria":{},"previewHash":"<预览hash>","segmentId":"<返回ID>","batchId":"<工作区返回ID>","batchVersion":1,"approvalId":"<导航返回ID>","requestIds":[],"state":"awaiting_review","lastResultCode":null}
```

数值 1 是占位示例，必须替换为真实版本。另保存 HTTP 方法/路径/状态、时间、逐客原因、事实版本、消息指纹、itemHash 与 providerMessageId；不要保存 Authorization。更换租户或操作者前停止原流程，不能拿新身份访问旧请求并当作未提交。

## 六 单客草稿调用与结果判定

### 创建

先在调用方持久保存 UUID requestId；同一输入、同一请求只用一个 ID。请求至少包含 customerId、timeline：

```json
{"requestId":"fc97d333-9b1a-4447-85d5-07d170c07022","customerId":"<授权客户ID>","timeline":[{"id":"<真实消息ID>","actor":"buyer","body":"Please send the product specifications","timestamp":1792627200000}],"language":"English","intent":"reply","manualRequest":true}
```

时间和消息内容仅为示意，必须换成客户真实会话，不向现用环境发送示例客户。timeline 最多 100 条，生成内部使用最近 20 条。intent 仅支持 reply/opener/followup/reactivate/post_call/polish/handoff_summary；mode 仅 draft/polish。可选字段及嵌套 schema 从 capabilities.reply.requestSchema 读取，未知顶层字段报错；单段文本最多 12000 字符。不要为请求加入 tenantId、autoSend 或其他未定义字段。

### 完成结果

成功生成的统一结果包含 schemaVersion/requestId/status/generationSource、enterpriseFactVersion、draft/messages、translatedDraft/translatedMessages、verification、decision、code/retryable，并可能保留 handoffRequired、category 等分支字段。

| 情形 | Agent 动作 |
| --- | --- |
| HTTP 2xx，status=succeeded | 只表示草稿结果可读，检查 verification/decision，再送审核；不代表已发 |
| status=degraded 或 generationSource=degraded | 标明安全兜底/来源受限，保留问题与事实版本，人工核对 |
| status=waiting_human、handoffRequired 或 decision.execution=human_required | 转负责人；即使有正文也不自动发送 |
| status=blocked、空 draft | 停止草稿后续，记录 code 与原因；不能制造本地成功正文 |
| POST/GET 为 202、status=pending | 保存原请求，有限查询 GET；本次没有发送许可 |
| 409 且 customer_reply_generation_outcome_unknown | 原生成已过总时限仍未确认，只读查询或交人工，不换 ID 重生成 |
| 400 | 修正 schema/取值，确认旧请求是否已受理；输入校验失败本身不生成 |
| customer_reply_request_conflict | 同 ID 对应其他输入，停止核对，不能覆盖原账本 |
| 503/storage/claim/result_save 错误或网络断开 | 可能已受理/已调用模型，先 GET 原 ID；不得按 HTTP 失败断定无外部效果 |
| GET 404 | 核对原租户、操作者、ID、环境及存储；不自动生成新 ID |

外层生成总时限为 120 秒；前端 POST 超时 125 秒、查询超时 15 秒只是客户端等待预算。查询可以等到晚到结果落库，不能恢复已丢失供应商结果；建议编排器每 3 至 5 秒查询一次，限定等待次数后交人工，不无限轮询。这是调用方执行策略，不是服务端自动调度承诺。

生成错误、pending/unknown 返回体不保证有完整成功 envelope；解析器先读取 HTTP、error/code/status/requestId，再按成功 schema 解析完成结果。真实发往客户的是客户语言 draft/messages，translatedDraft 是卖家对照；中文编辑后须重新忠实翻译并审核，不能互换字段直接发送。

## 七 发送适配顺序

本节是接口说明，不是发送授权。已有审批、渠道权限与具体任务授权缺一即停止。

### Messenger 与 Instagram 单客工作台

1. GET `API/customers/:id/outbox/context`，确认 item.channel/accountId/accountAuthorityHash 与当前客户一致。
2. 持久保存本次 send requestId，人工确认正文；POST `API/customers/:id/outbox`，body 使用 `{requestId,body}`。不要加 auto=true 试探自动授权。
3. 查询 `.../outbox/:requestId`，分别保存 status、deliveryStatus、providerMessageId。返回 unknown/sending 时不重发。
4. 仅 `historyWritebackPending` 时 POST `.../outbox/:requestId/reconcile`，body `{}`；这是历史补记，不会补发丢失的消息。

### WhatsApp 周派发

1. 当前批次逐项通过模板/窗口、人工接管、频率、资料、版本与审批检查。
2. GET `DE/followup-batches/:batchId/dispatch-preflight`；若有 future，等原 scheduled_at。
3. 获得明确派发授权后 POST `DE/followup-batches/:batchId/dispatch`，body `{}`。返回 202 的 result/worker/overview 不是最终送达。
4. GET 原批次及 WK 阶段证据，异常读 `WK/send-recoveries/sources?version=:v` 并按第九节流转。

### Messenger 与 Instagram 周派发

1. B1/B2 已绑定并明确具体会话，当前版本已审批。
2. GET `WK/native-dispatch/sources?version=:v&runId=:runId`，取实际 batch/item/version/hash。
3. 明确人工派发授权后 POST `WK/native-dispatch`：

```json
{"packageVersion":1,"runId":"<原runId>","batchId":"<原batchId>","itemId":"<原itemId>","expectedBatchVersion":1,"expectedItemHash":"<原itemHash>"}
```

4. 只用返回/来源给出的当前版本；窗口关闭、未到期、会话证据变化则阻塞，不修改版本绕过。
5. 查原批次/outbox/周步骤；unknown 进入 `WK/native-send-recoveries`，不使用 WA dispatch 当作通用原生发送接口。

四个周步骤名为 customer_segmentation、customer_followup_draft、customer_followup_approval、customer_followup_dispatch。完成依据取各自证据，不以运行已推进替代派发完成。

## 八 企业微信和知识报价分支

### 企业微信节点

企业微信使用独立会话/草稿/outbound 模型，不纳入 CB 的 WA/Messenger/已选 IG 标签批量源，也不复用通用 outbox。

| 节点及接口 | 输入 | 输出 | 异常恢复及验证 |
| --- | --- | --- | --- |
| C1 入站，GET/POST `/api/webhooks/wecom/:tenantId`；GET `WC/connection/status` | 平台 msg_signature/timestamp/nonce、echostr 或加密 XML、企业连接 | challenge 明文或先落库后的 success ACK；异步同步消息/游标 | 签名、解密、corp 校验由既有服务执行；POST `WC/callbacks/recover` body `{limit:25}` 恢复待处理回调。隔离；待真实加密回调联调 |
| C2 读取和草稿，GET `WC/conversations`、GET `.../:id/messages`、POST `.../:id/draft` | 查询 status/openKfId/page/perPage；生成 instruction | 会话详情/messages/drafts/outbound；生成返回 `{draft}` | draft 带风险和 requires_human_review；此入口没有通用草稿 requestId 查询协议，超时先读会话，不盲重生成。隔离、源码；真实模型待真联 |
| C3 人工批准发送，POST `WC/conversations/:id/send` | draftId、humanApproved=true、稳定 Idempotency-Key 请求头或 idempotencyKey | outbound ID/provider_msg_id/status；常为 202 accepted_unconfirmed | 必须真实人工批准；五条回复窗口等原门禁保留。受理未确认不是送达；只查原 outbound。隔离；待真联 |
| C4 转接和查询，POST `WC/conversations/:id/handoff`、GET `WC/outbound/:id` | reason，可选 servicerUserId；原 outbound ID | 转接状态或原发送记录 | 发送结果不明先查询；转接失败留原状态，不能伪称客服已接手。隔离；真实客服坐席待真联 |

### 知识报价人工依赖

前缀为 `WK/customer-knowledge-quote-requests`。GET 带 version/runId，返回 `{item}` 及当前请求信息；先核对 read 结果再执行对应动作。

- POST 根路径创建：packageVersion、runId、batchId、itemId、kind=knowledge/quote、ownerUserId、reviewerUserId、submissionDueAt、verificationDueAt。
- POST `/:requestId/submit`：packageVersion、runId、expectedVersion、ref。报价引用是 `{type:"confirmed_quote",id,version}`；知识引用为 `{type:"approved_faq",id,version,factVersionId,factContentHash}`。
- POST `/:requestId/verify`：packageVersion、runId、expectedVersion，由当前授权审核人处理。
- 按当前请求允许动作执行 `apply`，或 `review-knowledge-item`（另需 expectedBatchVersion、expectedItemContentHash），不得跳过审核直接更改派发正文。
- `request-approval` / `reopen-for-approval` 另需当前证据构造的 expectedIdentity，后者还需 expectedRunStateHash。对已 applied 且存在 application 的真实请求 r，可复用 `shared/contracts/weeklyCustomerKnowledgeQuote.ts` 的 `weeklyCustomerExceptionApprovalIdentity(r,action)`，action 分别是 request_approval/reopen_for_approval。它复制原 scope、requestId、version→requestVersion、recordHash→requestRecordHash、kind、batchId/itemId/memberId/customerId/consumerInputHash、application.batchId→applicationBatchId、application.batchVersion→applicationBatchVersion；不重新计算或编造哈希。expectedRunStateHash 取 GET 返回的 approvalRunState.stateHash。缺规范对象或合法负责人时停止，转原工作台处理。

这条分支复用原业务模块；本轮只对报价/知识进度筛选及相关链路做隔离回归，没有证明真实报价审批、知识入库和客户联系闭环全部可用。

## 九 异常恢复决策表

| 错误或状态 | 查询及恢复顺序 | 禁止动作 |
| --- | --- | --- |
| customer_batch_input_invalid / customer_criteria_invalid | 对照 capabilities 的 schema 修正原请求；范围最小值不能大于最大值 | 删除错字段后悄悄扩大客群 |
| customer_batch_authorization_unavailable / customer_batch_channels_not_ready / customer_batch_run_inactive | 先核对角色、渠道真实授权及运行；交相应负责人 | 换租户、旧账号、历史资料或只读令牌绕行 |
| customer_batch_preview_changed / customer_batch_classification_source_changed / customer_profile_source_changed | 重新 preview，重新核对证据并确认，使用新 hash/fingerprint | 沿用旧批准范围或编造 hash |
| included=0 且存在 unknown / customer_batch_classification_required | 复核标签、关系和资料；保留待核实清单 | 报告“本周无客户”或完成派发 |
| D7/B4 分群 building 或写入不确定 | GET customer-workspace、GET 原 segment，记录 parent ID/status/成员数；停止下游。内部默认幂等 createCustomerSegmentSnapshot 可按原 manifest 恢复，由现有编排/维护入口处理 | 直接重复 D7 并宣称必定修复同一 parent；D7 当前没有独立 HTTP resume 地址 |
| B5/B6 批次 building、HTTP 生成请求中断 | GET workspace/batch，保存原批次和成员；内部默认幂等 createFollowupBatch 可恢复已保存 manifest | 盲重 POST followup-batches；公开该路由传 idempotent=false，可新建版本/废弃旧批次，不是通用恢复端点 |
| 逐客生成/分类 failed 或 outcome_unconfirmed | 保存 last_error/逐客 code 及持久请求 ID；读取已保存结果，由维护人员核对原账本 | 新增身份字段或换 requestId 规避原请求保护，反复调用模型 |
| customer_aggregate_child_content_changed / customer_aggregate_manifest_invalid / customer_aggregate_incomplete | 保持 building，交数据维护核对冻结 manifest 和子记录 | 手改数据库完成状态、删除记录后重发 |
| customer_batch_existing_external_receipt / followup_batch_has_external_receipt | 查原批次、原 outbox 和回执，处理发送异常 | 重分群覆盖已发生外部效果的批次 |
| 审批版本/hash 冲突或 approval 写回失败 | 重读审批导航和 batch，核对实际逐项状态；由负责人按当前证据继续 | 使用旧 approvalId、文本批准或 manual_complete 代替正式审批 |
| sending/unknown/partial_sent/accepted_unconfirmed | 查原 request/outbound/item 和签名回执；使用对应恢复模块 | 按超时当失败、发送整批剩余不明消息、把受理当送达 |
| historyWritebackPending | 原 outbox reconcile 只补历史；回执身份不符交人工 | 再调用平台发送来“修复历史” |
| knowledge_review/quote_review/human_needed/opted_out | 走负责人补齐、审批或人工接管流程；退订不发送 | 删除标签或清除限制后继续自动发 |
| 401/403/404/502/503 且具体原因不清 | 先保存原 ID/HTTP/error/code；核对版本、挂载、身份和存储，再升级处理 | 猜 URL、盲重有副作用接口，或笼统声称“接口不存在” |

### 周发送恢复的明确接口

WhatsApp：GET `WK/send-recoveries/sources?version=:v`；创建 POST `WK/send-recoveries`，输入 packageVersion/runId/itemId/ownerUserId/deadlineAt/reason。

原生私信：GET `WK/native-send-recoveries/sources?version=:v`；创建 POST `WK/native-send-recoveries`，输入 packageVersion/channel/requestId/ownerUserId/deadlineAt/reason。

两者都可 GET 根路径或 `/:id`（带 version）查询；由当前授权负责人 POST `/:id/resolve`，body `{packageVersion,expectedVersion}`。deadlineAt 必须含 Z 或时区偏移。服务端核对真实签名回执，resolve 不接受调用者自填 provider proof；无证据仍阻塞，不代表“强制完成/重新发送”。

## 十 已验证和真实联调清单

| 范围 | 已有证据 | 仍需验证 |
| --- | --- | --- |
| 代码与契约 | 主回归 80 项、补充渠道回归 54 项，共 134 项通过；原客服脚本链通过；类型、架构、192 个迁移完整性、生产构建通过 | 目标运行环境的精确代码/配置/迁移状态；不是“所有生产 API 已联通” |
| 草稿恢复 | 隔离 HTTP 输入/响应、事实版本、跨身份隔离、请求重放、超时和晚到结果、不重复模型调用 | 真实模型质量、供应商超时/限流/计费和多阶段等待行为 |
| 标签和客户管理 | 当前账号指纹、撤销标签、限制标记保留、部分分类复用、关系确认、订单与进度区分、筛选冻结 | 真实历史数据完整性、业务标签准确率、人工确认流程和真实账号覆盖 |
| 聚合与派发 | 半途写入/冲突子记录/完整读回故障；内部新询盘→分群→草稿→审批→到期模拟派发→持久模拟回执→周证据；重放不重发 | 所有外层路由及目标 worker 的完整真实 E2E；平台实际收信、分气泡回执、跨进程恢复 |
| 存储 | 临时 PocketBase 0.39.5 应用新增迁移+既有 CAS 迁移，验证请求重放/CAS/事实版本/分类 JSON | 精确目标数据库备份升级、完整 schema、数据保留和回退；未在现用库执行 |
| 工作台 | 浏览器实际预览、选客分类、标签筛选、语言时区确认、展开证据和冻结；内存 API，未发消息 | 登录后的真实服务、真实权限、真实大客群分页/性能；不是全生产界面验收 |
| WeCom | 路由注册、受控回调 ACK/重复处理、既有处理恢复及门禁 | 真实企业签名加密回调、游标、客服坐席、五条窗口、真实模型和平台失败事件 |
| 自动接待 | 正式 WhatsApp persist_and_qualify_only 及未连接状态已明确 | 自动接待本轮未启用，不存在“上线后自然自动回复”的承诺 |

真实联调应另有明确任务、测试客户/账号和发送范围；先核对目标迁移与授权，再用最小单客闭环验证草稿、审批、窗口、发送和签名回执，最后扩展批量。没有真实模型/平台回执，验收结论保持“隔离通过，真实联调待完成”。

## 十一 交接输出模板和源码索引

Agent 每次停止或完成时输出：执行代码版本及环境、run/周包范围、criteria/previewHash、segment/batch/approval 版本和 ID、逐客纳入/排除/未知数量、原请求 ID、实际外部效果、阻塞码、下一负责人/动作及可查询入口。不得输出令牌，也不得将示例记录 ID 当真实证据。

建议最终状态仅使用明确业务结论，例如“筛选已冻结，未生成消息”“草稿待人工审批”“等待原排期”“平台受理未确认”“结果未知待核对”“已收真实签名送达回执”“已完成空分群但仍待周证据核验”；不要统一写成“任务成功”。

- 契约：[customerSegmentation.ts](../../shared/contracts/customerSegmentation.ts)、[customerReply.ts](../../shared/contracts/customerReply.ts)、[customerChannelSendRequest.ts](../../shared/contracts/customerChannelSendRequest.ts)。
- 批量入口：[customerBatches.ts](../../server/routes/customerBatches.ts)、[customerBatchService.ts](../../server/customerService/customerBatchService.ts)。
- 草稿与恢复：[draftReply.ts](../../server/routes/draftReply.ts)、[replyRequests.ts](../../server/customerService/replyRequests.ts)、[aggregateRecovery.ts](../../server/customerService/aggregateRecovery.ts)、[durableFollowupDraft.ts](../../server/customerService/durableFollowupDraft.ts)。
- 周任务：[customerWorkflow.ts](../../server/digitalEmployees/customerWorkflow.ts)、[digitalEmployees.ts](../../server/routes/digitalEmployees.ts)、[socialPrograms.ts](../../server/routes/socialPrograms.ts)、[socialWeeklyNativeDispatch.ts](../../server/routes/socialWeeklyNativeDispatch.ts)。
- 企业微信：[wecomCustomerService.ts](../../server/routes/wecomCustomerService.ts)、[wecomCustomerIngress.ts](../../server/routes/wecomCustomerIngress.ts)。
- 验证范围：[隔离验收报告](../qa/customer-service-isolated-acceptance-2026-10-22.md)、[134 项验证记录](../qa/evidence/customer-service-validation-20261022.json)、[隔离集成测试](../../server/customerService/customerPipeline.integration.test.ts)。

本文件仅整理当前提交的可执行路径和剩余边界；没有改变源码、接口行为、集成基线、环境迁移或发布状态。
