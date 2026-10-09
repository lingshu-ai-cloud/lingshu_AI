# 客服 Agent 三渠道执行核验

客服 Agent 的经营范围包含 WhatsApp、Messenger 和 Instagram 私信。它仍是原四个主负责 Agent 之一，不因渠道增加而拆成三个展示 Agent。

## 任务与经营交付

每天的客服任务按实际会话和截止生成，卡片交付是“处理这些询盘”“核验这些发送回执”“交接这些销售机会”，而不是每天重复一张空的渠道卡。卡片必须保留渠道、企业账号、客户、会话、原执行任务及主负责人。零基础关注首次真实询盘；有基础同时处理老客户未结事项和新增询盘。

三渠道均要求接收、回复建议、实际授权发送、人工接管、询盘转销售和异常恢复。平台窗口、身份及回执协议分别读取对应端口；不能将 WhatsApp 号码、模板或 claim token 套到 Messenger/Instagram。

## 当前代码依据与边界

| 范围 | 当前依据 | 尚未核销的范围 |
|---|---|---|
| Messenger 接收与发送 | `server/messenger/conversations.ts`、当前 Meta 验签 Webhook | 与真实周客服分群、审批及任务绑定的完整交付 |
| Instagram 接收与发送 | `server/instagram/conversations.ts`、`server/instagram/send.ts`、当前 Meta/Instagram 验签 Webhook | 与真实周客服分群、审批及任务绑定的完整交付 |
| WhatsApp 未知发送恢复 | `weeklyCustomerSendRecovery.ts`、`followupDispatchWorker.ts`、Meta Webhook 的 WABA/号码筛选 | 真实平台投递及周看板恢复的环境验收 |
| Messenger/Instagram 防重复发送 | `customerChannelSendRequests.ts` 在发送前持久保存请求，绑定企业、账号、用户、客户、收件人与正文 hash | 客户端稳定请求恢复、历史写回、Webhook 回执对账和完整周绑定的联合验收 |
| 人工处理看板 | 周包作用域 `/send-recoveries` 路由及指定负责人/截止 | 三渠道任务卡到真实会话与处理结果的完整浏览器验收 |

既有直接私信功能与新持久请求是代码接入依据，不是三个渠道的完整周经营链路证明。WhatsApp 的恢复合同明确是该渠道，不能据此将 Messenger/Instagram 卡片标成完成。

## 已取得的局部证据

本地 HTTP 测试实际通过原始请求体 HMAC 验签、企业 WABA 与号码匹配、持久发送回执更新，再由指定真人恢复原发送任务。伪签名、其他业务账号和号码不导入该回执。与 Instagram Webhook 回归联合 7 项通过。

该测试使用隔离存储及平台事件样本，无真实外部发送，不能替代实际渠道授权、客户私信和真实平台投递验收。

## 完成门槛

逐渠道核验真实账号和客户入站会话、已确认回复意图、持久发送请求、平台回执、人工接管及销售交接，并保持原周包和原请求身份。结果未知时保留原请求，只读对账；无 provider identity 时显示缺口，不按文本、时间接近或重复点击制造成功。已解决卡片须读取服务端重新核验的原任务恢复凭据，不能仅凭 `resolvedAt` 或截止时间完成。
