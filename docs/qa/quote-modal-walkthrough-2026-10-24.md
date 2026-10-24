# 报价弹窗浏览器验收

2026-10-24，Asia/Shanghai。目录 `/Users/julia1/Documents/ChatGPT/1024客服`，分支 `feature/customer-service-20261024`，HEAD `89b175109149d4551aeb3ce590fe9c42c46bf23c`。保留既有未提交改动；本轮没有生产逻辑修改、提交、推送或基线合并。

## 实测范围与结果

当前预览 `http://127.0.0.1:5225/?page=conversion&mock=quote`，使用已有 Alex 模拟询价客户 `mock-quote-debug-1`。后端保留 HTTP 网络隔离；没有点击发送或调用真实渠道。

| 步骤 | 实际结果 |
| --- | --- |
| 整理需求 | 点击回复区“智能报价”再点击“整理报价”；提取产品 CNC aluminum bracket、数量 500、Los Angeles、FOB、目标交付 30 days、包装 Export cartons、图纸 B2。企业目录未匹配且设置仅人工报价，单价保持待补充。企业 Mock 默认交期、付款条款需要人工核对，不能视为客户原始要求。 |
| 编辑报价 | 使用原编辑表单，SKU 填 LOCAL-QA-BRACKET，材料 6061 aluminum，单位 pcs，币种 USD，单价 12.50，交期 Within 30 days，付款 30% deposit, 70% before shipment，图纸 B2。保存后总额 USD 6,250，状态待确认。 |
| 人工确认 | 点击人工确认，状态变成已确认，版本 V1，revision 3。重新打开弹窗后确认状态、数量、金额及条款仍在。 |
| 卡片预览 | 点击预览卡片，实际图片正常呈现客户 Alex、产品、SKU/材料、500 pcs、USD 6,250、15 days、FOB/Los Angeles/Within 30 days。未点击发送到 WhatsApp。 |
| 插入回复 | 点击插入报价回复，弹窗关闭，主回复框含完整英文报价：单价、总额、交期、付款、贸易术语、图纸、包装、有效期及运税/交付说明。二次打开原版本后重复插入也成功。 |

主报价操作链路已走通，但不应登记为全部功能无问题：完整报价插入主回复框的同时，现有 pendingDraft Effect 又将其显示为 AI 建议；AI 气泡的 `draft.split(...).slice(0, 3)` 只展示前三段，遗漏后续交付/付款等条款。当前真实发送按钮禁用，未发生实际遗漏发送。此问题需修复后再对“AI 建议直接发送”路径验收，本轮未用真实发送验证。

验收中一次页面状态重置后，主回复框清空；重新打开报价时持久已确认版本正常，再次插入后持续观察全文保留。未对这次重置的原因作无证据归因，也不将本轮作为刷新后回复草稿恢复验收。

## 持久证据

- 报价号 `QT-20261024-127AB9`；记录 ID `quote_skill_drafts_ac4ca0b0e2e549aa9911f038a41aa0be`。
- 本地记录 confirmed，revision 3，version 1，500 × USD 12.5 = USD 6250，delivery 为 null。
- 审计含 created、updated、confirmed 和两次 reply_generated；该报价无 card_sent 事件。
- 脱敏摘要：`tmp/customer-service-preview/quote-walkthrough-durable.json`。
- 截图：`tmp/customer-service-preview/quote-walkthrough-card.png`、`tmp/customer-service-preview/quote-walkthrough-inserted.png`。

本轮执行浏览器交互和本地持久记录只读核对，`git diff --check` 通过；未重跑上一轮类型/构建或完整客服测试，不声明真实供应商或发布验收。没有外部 run/task/receipt。
