# 普通客服回复区与隔离兼容验收

日期：2026-10-24（Asia/Shanghai）。工作目录 `/Users/julia1/Documents/ChatGPT/1024客服`，分支 `feature/customer-service-20261024`，HEAD `89b175109149d4551aeb3ce590fe9c42c46bf23c`。在原脏工作区上增量修复，保留其他修改；未提交、推送、合入基线、部署或迁移，未调用真实客户渠道。

## 修复与复用

根因已由源码与当前预览验证：普通草稿和翻译使用原接口，没有 QA 服务的 AI 作用域；原隔离会默认拒绝其 Qwen 出网。直接放行整个翻译插件或草稿路由会扩大权限，因此仅在本地预览中接入受限适配。

- 原 `/agents/conversion/draft` POST/GET 和 `/plugins/translate/run` 地址及前端原操作保留。新增 `localPreviewReplyCompatibility.ts`，仅开发环境、本地预览及模拟开关全部开启时接管这些请求；非预览继续进入原处理器。
- 复用 `createCustomerReplyRequests` 的持久请求认领、输入冲突、超时、原请求读取及结果信封；预览账本使用既有 `customerPreviewStore` 命名空间。复用现有模拟会话按租户/用户/客户保存生成审计和草稿，不替换全局 store。
- 生成调用原 `generateCustomerReplyResult`，保留请求的 timeline、instruction、intent/mode、语言和原校验/人工决策。翻译调用原共享 `translateCustomerText`，并复用既有 `withCustomerPreviewAi`；没有增加提供方、域名、方法、模型许可或发送通道。
- 仅本地数据身份、合法 loopback/Origin、模拟 customerId、明确 manualRequest 的请求能取得许可；支持只读与浏览器只读令牌不能执行。guard 缺失时失败关闭；额外 URL/字段及超长翻译输入拒绝。普通读请求仍按原租户/用户账本隔离。
- 普通回复框翻译携带当前 customerId 和手动标记。预览中的会话历史自动辅助翻译停止发起，不会因打开/切换页面批量消耗真实 AI；明确打开回复译文仍沿原预览交互执行。非预览的原自动翻译逻辑保留。
- 翻译缓存按原文、来源语言、目标语言匹配；重复查看复用结果，改变目标语言不串用。草稿变更继续使用原审批失效规则。已开始发送的模拟会话拒绝另起生成，避免覆盖冻结内容；原已送达会话未改动。

新增适配/测试之外，增量修改原 draftReply/plugins 路由、模拟组合服务、customerReplyPreparation 及其测试、草稿 Effect 和 package 的 pipeline 测试清单。没有新增队列、发送器、审批主流程、UI 入口或依赖。

## 普通预览实际验收

入口：<http://127.0.0.1:5225/?page=conversion>，没有 `customerSimulation=1`，沿用既有本地登录。使用原客户选择器 Omar 身份 `mock-export-lead-uae-vision`，本次之前没有后端入站会话。原入站适配新建模拟会话 `97e5d54cc5a5f9c10c21c55b`，输入为 75 ml 无香面霜、成分列表/质地照片及罐体/盖型资料准备问题。

1. 页面加载后仅显示新入站，未自动生成/翻译。点击普通右栏“生成建议”，原普通草稿接口完成真实 AI 链路：requestId `3ffe2724-68c3-44b8-8e0e-78534a08ed56`，`succeeded / provider_generated`，`verification=verified, issues=[]`；原服务共 5 次 qwen-plus HTTP 200。
2. 中文 AI 建议实际显示在普通会话中。点击“保存修改”，刷新并重新选择 Omar，全文恢复到主回复框，未伪装成新 AI 建议或重新生成。
3. 人工把结尾承诺改为具体适配性仍需核对，保存下列正文，再点击原“显示目标语言译文”：

> 针对您 75 ml 的无香型面部乳霜，请先发送成分列表和质地照片，并标注罐体高度、直径以及 B7 盖型。我们会据此了解需求，具体适配性仍需核对。

真实翻译结果：

> For your 75 ml unscented facial cream, please first send the ingredient list and a photo of the texture, and indicate the jar height, diameter, and B7 cap type. We will use this information to understand your requirements; however, final compatibility confirmation is still required.

4. 收起再打开同一译文，内容一致；读取原草稿接口也返回同一请求。累计仍为 6 次模型 HTTP 200（草稿 5 + 翻译 1）、4895 tokens，生成次数 1、客户传输次数 0，没有为了“恢复”重跑模型。
5. 普通页面始终显示模拟客户，发送按钮“通道未连接”禁用。guard installed=true、固定保留域探针 8/8 阻断、canAutoSend=false；真实客户收发和回执未启用。

企业知识仍为本地虚构美妆 Mock。Omar 前端原机器视觉画像未作业务迁移，不能把本次视为画像自动更新验收。另为报价样例王经理预先创建过一条隔离入站；因其原人工接管界面无生成建议操作，未调用模型或发送，随后选用上述原建议模式客户完成普通 UI 验收。该预备会话也保留，没有覆盖其他客户资料。

## 定向回归与检查

| 检查 | 实际结果 |
| --- | --- |
| 本次定向 5 文件 | 8/8，0 跳过：原模拟整链、普通接口/权限/幂等读取、前端真实译文/失败保留、原草稿身份/超时、AI 作用域 |
| `test:customer-isolation` | 启动 1 + 隔离 9，通过，0 跳过 |
| `test:customer-pipeline` | 最终 93/93，0 跳过；新增兼容测试已进入默认命令 |
| `test:customer-service` | 67/67，0 跳过；仍包括原完整 39 个文件 |
| `pnpm run lint` | 首次新增测试读取 unknown 的 `.length` 类型错误，已用 Array.isArray 收窄；最终 tsc --noEmit 退出 0，首次失败日志保留 |
| `ARCHITECTURE_BASE_REF=89b17510 pnpm run check:architecture` | 通过，2699 个生产 TS，原预算 ratchet 未放宽 |
| `pnpm run build` | 通过，Studio 368838/485000 字节，原 chunk 警告保留 |
| `git diff --check` | 通过 |

测试使用注入模型端口、保留域名与 guard/canary，不接真实渠道。测试覆盖同 requestId 重读不生成、改输入冲突、跨租户/用户不可读、翻译按语言缓存、失败不造替代话术、真实客户/自动调用/非本地身份/支持只读/外部 Origin/额外 URL 拒绝、REAL_AI 关闭不调用提供方、生产带预览标志拒绝、非预览进入原处理器。真正模型调用仅来自上述本地 UI 验收，不使用固定样例冒充提供方输出。

日志 `tmp/customer-service-preview/composer-compat-*.log`，运行快照 `composer-compat-runtime.json`，截图 `composer-compat-draft.png`、`composer-compat-translated.png`、`composer-compat-cached.png`。脱敏摘要、源码/日志/截图 SHA-256 和工作区保留检查见[证据索引](evidence/customer-composer-isolation-20261024.json)。原误触事故及无法追补的历史响应边界仍按[隔离审计](customer-channel-isolation-audit-2026-10-24.md)保留。

本次关闭普通回复区的草稿/翻译兼容缺口；没有宣称最终候选全仓 quality/verify、真实渠道/Meta 模板审批、真实企业或发布验收。最终候选冻结、完整证据归档及其他未决评审仍见[合入前清单](customer-premerge-review-checklist-2026-10-24.md)。
