# 加固后客服预览完整链路验收（2026-10-24）

位置 `/Users/julia1/Documents/ChatGPT/1024客服`，分支 `feature/customer-service-20261024`，HEAD `89b175109149d4551aeb3ce590fe9c42c46bf23c`。复用当前加固预览，后端 PID 67175，全程未重启或取消隔离；未提交、推送或合入基线。

入口：<http://127.0.0.1:5225/?page=conversion&mock=quote&customerSimulation=1>。本地登录账号 `beauty-showcase@local.test`，选择 Emma，再打开“本地模拟链路”。

## 新会话与输入

复用既有客户选择器的 Emma 身份 `mock-quote-debug-3`。开始前隔离会话集合不存在该身份；原入站服务本次新建独立模拟 Messenger 客户和会话，初始消息数为 1。没有复用上次 `mock-free-sandbox` 的 AI 请求、审批或发送记录。前端报价人物卡的旧产品/报价标签只是既有展示资料，没有进入本次后端草稿输入；本次后端 timeline 只有以下新输入，未使用卡片的固定报价聊天。

> We are a small UK skincare brand preparing a 50 ml fragrance-free moisturiser for dry skin. We have reference texture photos, a draft ingredient list, and a jar sketch. For a first sampling discussion, which of these should we send first, and what packaging details do you need? Please do not quote prices or confirm any certification.

企业事实仍来自本地虚构美妆企业资料（Mock），不代表真实企业能力或承诺。

## 实际操作与结果

| 步骤 | 实际结果 |
| --- | --- |
| 原入站 | 原 Messenger webhook 处理后持久保存本次咨询；没有旧报价历史混入生成输入 |
| 真实 AI 草稿 | 原草稿请求、企业检索、规划、候选和校验链路完成；6 次 qwen-plus HTTP 200；generationSource=provider_generated，verification=verified，issues=[] |
| 原人工闸门 | 原回复状态 waiting_human、decision.execution=human_required；保留该状态，没有强改为 succeeded，也没有为了取得“成功”状态再生成 |
| 原草稿恢复 | 页面读取同一 requestId，恢复中文编辑稿，生成次数仍为 1 |
| 真实翻译 | 对原中文草稿调用现有真实翻译服务，返回英文；随后人工接管、编辑并保存，再对编辑后的版本真实翻译一次 |
| 人工审阅编辑 | 保留 AI 主体，补充罐体尺寸、材质、盖型；把“精准呈现肌肤触感”改为了解目标肤感及可行性待核对，未作价格或认证承诺 |
| 原模板配置和审批 | 原模板变量使用本次实际译文；正文冻结，批次 v2 和审批版本/hash 一致，人工批准成功；本地 APPROVED 模板目录不是 Meta 审批证据 |
| 模拟发送和故障 | 开启一次会话记录写入失败；原发送账本 accepted，historyWritebackPending=true，deliveryStatus=unverified，本地传输次数 1 |
| 原账本恢复 | 原 repairHistory 补齐卖家消息，historyWritebackPending=false，传输次数仍为 1；没有新增发送请求或重传 |
| 模拟送达回执 | 原回执投影令 deliveryStatus=delivered，主会话显示已送达 |
| 释放与刷新 | 原人工接管释放成功；刷新后批准版本、完整正文和已送达状态恢复，持久消息数 2，生成/传输均为 1 |

人工编辑后经真实 AI 翻译、冻结审批及模拟发送的正文：

> Nice to meet you—very happy to collaborate with your UK skincare brand! Regarding your 50 ml unscented moisturizer, please first provide photos of the texture so we can understand the target skin feel; then send the ingredient list. The jar sketch can also be sent together—please mark the jar dimensions, material, and lid type. Specific feasibility still requires further verification.

## 请求、审批与提供方证据

- Session：`80cc9a44ddecb4ac11aa3ac2`
- 原草稿 requestId：`3a826e63-6126-415d-8a82-2e99cff249bc`
- 企业事实版本：`enterprise-facts-v9-d17ed0112911`
- Approval：`customer_preview_approval_requests_bdcbb9b3844a444d99a52c81ec57e354`，approved，v2
- 发送 requestId：`preview-8cb77297-024d-4000-946d-abfac73392ef`
- 真实 AI 共 8 次 qwen-plus HTTP 200：草稿链路 6 次、原稿英译 1 次、人工修改后英译 1 次；合计 7050 tokens。没有固定响应生成器，也没有重跑原草稿。
- 首次提供方 requestId：`97a73a18-882a-9f67-83b7-b5376cf7eb73`。全部 requestId、completionId、model、usage 和阶段快照保存在运行 JSON。

`tmp/customer-service-preview/hardened-full-chain-evidence.json` 保存入站、AI+接管、待审批、accepted+故障、恢复、送达、刷新等原接口快照及断言。最终确认：批准版本/hash 匹配、发送正文等于冻结正文、消息数 2、生成次数 1、传输次数 1、已送达、无待修复写入。

## 隔离及本次小修复

全程 guard installed=true、version=2，保持同一 PID；浏览器 CSP 保留。收尾固定保留域名自检 8/8 阻断，WhatsApp/Messenger/Instagram providerReady 与 backgroundWorkerEnabled 均为 false，canAutoSend=false。只有授权的 Qwen 精确接口在操作作用域内执行；客户收发和回执均为隔离模拟，没有访问真实渠道。后台有被 guard 拒绝的轮询请求，不能把这些拒绝记录当作成功出网或真实渠道回执。

仅修正 `LocalCustomerSimulation.tsx` 的验收提示和原稿恢复展示：provider_generated + waiting_human 应显示“真实 AI 草稿已生成，原流程要求人工接管并审批”，不应误归为降级；恢复时优先采用原 translatedDraft 供中文编辑。已经通过读取同一原草稿在实际页面确认，没有增加模型调用。没有修改原生成、接管、审批、账本或渠道业务规则。

## 验证和截图

- `pnpm run test:customer-isolation`：启动检查 1 项 + 隔离检查 9 项通过，0 跳过。
- `pnpm run test:customer-pipeline`：91/91 通过，0 跳过。
- `pnpm run lint`、`ARCHITECTURE_BASE_REF=89b17510 pnpm run check:architecture`、`pnpm run build`、`git diff --check`：通过。构建保留既有 chunk 提示。
- 日志：`tmp/customer-service-preview/hardened-full-chain-*.log`。
- 截图：同目录 `hardened-full-chain-ai.png`、`hardened-full-chain-approved.png`、`hardened-full-chain-history-failure.png`、`hardened-full-chain-delivered.png`、`hardened-full-chain-restored.png`。
- SHA-256 证据清单：`hardened-full-chain-manifest.json`。

本结论仅覆盖本次加固预览中的真实 AI + 模拟渠道完整链路，不是实际客户渠道、Meta 模板或生产发布验收。
