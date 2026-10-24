# 客服真实 AI 草稿与翻译、本地模拟渠道复验

日期：2026-10-24。目录：`/Users/julia1/Documents/ChatGPT/1024客服`。分支：`feature/customer-service-20261024`，未提交、未合入基线。

本轮使用新输入实际调用现有 qwen-plus 草稿及翻译服务，未以固定回答替代模型。入站、人工接管、模板配置审批、发送账本、失败恢复和送达投影继续复用原实现，客户传输及回执为本地适配器。此结果不代表 Meta 真实模板审批或真实客户渠道 E2E 通过。

## 实际预览结果

入口：<http://127.0.0.1:5225/?page=conversion&customerSimulation=1>，本地账号 `beauty-showcase@local.test`，选择“空白海外客户”。普通页面不显示模拟工具。

本次新客户输入：

> We are a UK skincare startup developing a fragrance-free serum for sensitive skin. We have a draft ingredient list and prefer a 30 ml bottle. What information should we prepare for an initial sample discussion? Please avoid quoting prices or promising certifications.

知识来自当前本地虚构美妆企业资料（澄光美研 Mock），不是实际客户或真实企业承诺。

| 环节 | 复验结果 |
| --- | --- |
| 原入站 | 原 Messenger webhook 处理后保存买家咨询，刷新可见 |
| 真实草稿 | 原 `generateCustomerReply` 经企业事实检索、回复规划、候选选择和校验返回；原请求账本 `succeeded`、`generationSource=provider_generated`、`verification=verified`，问题列表为空 |
| 真实翻译 | 原草稿自带中文译文；再次调用共享的原翻译服务，将中文草稿译为英文，没有固定样例匹配 |
| 人工接管 | 原接管服务 hold 成功，最终 release 成功 |
| 模板审批 | 本地模板目录的 `{{1}}` 使用本次实际英文译文，原模板配置冻结正文、版本及 hash，再经原审批应用批准 |
| 模拟发送故障 | 注入一次会话记录写入失败；原发送账本 accepted、historyWritebackPending=true，本地传输次数 1 |
| 原账本恢复 | repairHistory 补齐同一条卖家消息，historyWritebackPending=false，没有再次传输 |
| 模拟回执 | 原签名回执入口投影后 deliveryStatus=delivered，主会话显示已送达 |
| 重连与刷新 | 期间前端组件改名热更新及后端重启造成读取中断；恢复原会话后继续完成，最终刷新仍显示完整买卖双方消息和送达状态，生成、传输次数均为 1 |
| 译文缓存重放 | 刷新后再次点翻译，返回相同已保存译文；模型审计仍为 7 条，没有新增调用 |

## 可核对证据

- Session：`103a063f39b5fb0916ffdcd7`
- 草稿 requestId：`25fbcf3d-8157-4332-97e2-cf1d1c591f7c`
- 企业事实版本：`enterprise-facts-v9-d17ed0112911`
- 模型：`qwen-plus`，7 次 HTTP 200（原草稿链路含中文翻译共 6 次，独立英译 1 次），合计 5801 tokens。
- 实际提供方 requestId、completionId、model、usage 保存在 `tmp/customer-service-preview/real-ai-runtime-evidence.json`；不保存或输出密钥。
- 首次模型请求：`5a9b229d-b375-907b-8783-63646b539671`。
- 最终主会话截图：`tmp/customer-service-preview/real-ai-conversation-restored.png`。
- 翻译、故障及恢复截图：`real-ai-translation.png`、`real-ai-history-failure.png`、`real-ai-delivered.png`（同目录）。

批准及模拟送达的实际正文：

> Understood—UK-based skincare startup specializing in fragrance-free serums for sensitive skin, 30 mL bottle. The preliminary ingredient list is ready. Regarding sample discussions, please send me this ingredient list directly and let me know if you require assistance with packaging solutions (bottle, cap, label) or formula adjustments. I’m available anytime!

## 隔离及修复

- 草稿复用原 `createCustomerReplyRequests` 账本和原生成函数；翻译从 `/plugins/translate/run` 提取成共享函数，两处使用同一实现。
- 本地实际 AI 仅在开发、本地预览及显式 REAL_AI 开关下按操作开放既有 Qwen chat/completions HTTPS POST；精确端点校验、禁止重定向、单次操作最多 16 个请求。操作结束即关闭这项许可。
- 所有模拟业务记录仍在 `customer_preview_*` 集合；与正式账号、接管、审批、发送账本隔离，不替换全局 store。新真实 AI session 不复用此前固定样例 session。
- 译文按原文和目标语言缓存，重复读取不重新调用；编辑草稿后清除旧译文并使旧审批失效。异常调用保留已发生的模型请求审计，未知结果不伪装成成功。
- 最终正式客服 status：enabled=false、canAutoSend=false；WhatsApp/Messenger/Instagram providerReady、tenantAuthorized、backgroundWorkerEnabled 均为 false。证据见 `real-ai-channel-status.json`。

隔离测试发现并修复一项启动缺陷：旧的 `node --import guard tsx/cli --test` 启动器未将 guard 传入测试子进程，一次负例 POST 因此到达 `graph.facebook.com/v25.0/messages`。请求没有凭据、收件人或消息正文，没有发送客户消息，不能将本轮描述为“零渠道地址请求”。已将测试入口改为 `node --import guard --import tsx --test`，负例请求前先断言 guard 已安装；修复后验证渠道请求被阻止。实际预览后端一直直接预加载 guard。

后续隔离复核更正：当时 guard 尚未完整覆盖底层 socket、任意子进程和启动 curl/nc 探测，因此“预加载 guard”不足以证明完整进程隔离。历史没有渠道响应/抓包，不能补造服务端结果。当前自动安装、后代进程、浏览器及真实 AI 保留证据见 [渠道隔离复核](customer-channel-isolation-audit-2026-10-24.md)。

## 验证

- `pnpm run test:customer-pipeline`：83/83 通过，无跳过。包含真实 AI 出网作用域、失败审计、译文缓存、编辑使审批失效、跨身份隔离、原账本恢复防重传等测试。单元/集成测试模型端口注入仅用于隔离测试，与上述实际提供方调用证据分开。
- 预加载隔离 guard 后运行 `pnpm run test:customer-service`：退出 0；覆盖原客服知识、草稿安全、回复规划、UI、资格、接管、记忆及历史持久化。日志中的 `isolated_test_network_blocked` 是预期出网拒绝，不是渠道成功证据。
- `pnpm run lint`、`pnpm run check:architecture`、`pnpm run build`、`git diff --check`：通过。构建保留既有 chunk 大小提示。
- 客服回归中的草稿恢复和外部演示 UI 契约已对齐当前 PRD 16.10：检查草稿恢复至编辑框、紧凑画像和聊天入口打开原报价组件，保留模拟隔离、语言、记忆及发送边界检查。
- 日志：`tmp/customer-service-preview/real-ai-*.log`。

保留同工作区其他客服 UI 与标签任务的修改；本轮没有提交、推送、合并或生产部署。
