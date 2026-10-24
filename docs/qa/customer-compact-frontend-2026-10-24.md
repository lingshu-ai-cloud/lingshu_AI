# 客服前端收拢与报价弹窗

工作目录 `/Users/julia1/Documents/ChatGPT/1024客服`，分支 `feature/customer-service-20261024`，HEAD `89b175109149d4551aeb3ce590fe9c42c46bf23c`。在已有未提交工作区上继续，只修改本轮界面与相关验收；已有模拟服务、草稿恢复及发送账本改动保留。未推进基线，未提交、推送或合并。

## 用户确认后的界面

- 保留共享顶部积分管理及本地账号栏。
- 移除客服资料订单、批量审批、微信客服和本地模拟链路入口。
- 右栏仅保留客户信息和 AI 回复；头像改为 32px，紧凑展示名称、地区、语言、当地时间、跟进、意向、需求、归因和标签，完整画像与依据可展开。
- 移除媒体文件、隐私支持及原侧栏报价工作区。用户已明确确认这两组侧栏功能和模拟入口均移除。
- 待报价画像、标签、跟进目标或现有询价识别命中时，在回复区发送按钮左侧提供智能报价。历史与只读客户不提供入口。
- 报价弹窗复用原 `QuoteSkillCard` 和 API，既有确认、版本、预览及发送约束保留；关闭弹窗返回触发按钮，切换客户重建弹窗身份。
- 会话中人工接管、草稿恢复和发送结果未知提示仍保留。页面入口移除不删除后端能力。

## 本轮主要文件

`ConversionPage.tsx`、`ConversionChatThread.tsx`、`ConversionCustomerRail.tsx`、`QuoteSkillCard.tsx`、新增 `CustomerQuoteLauncher.tsx` 及其测试，相关布局/报价位置合同测试。产品规范增加 16.10，记录本次用户修订取代原大头像、多 Collapse 布局要求。

## 浏览器实测

使用当前 Vite 预览 `http://127.0.0.1:5225`，后端 `127.0.0.1:9025` 保持网络隔离。

1. 普通外贸会话：顶部四个工作区入口消失；右侧紧凑客户信息和 AI 回复可见；无原侧栏报价、媒体或隐私组。
2. 使用已有 `?page=conversion&mock=quote` 询价样例：Alex 的待报价信息可见，智能报价位于保存草稿后、发送按钮前。
3. 点击智能报价：Ant Modal 展示原报价工作区，无既有报价时显示“整理报价”。未点击生成或发送。
4. 关闭弹窗：返回原会话，焦点回到智能报价按钮。

截图：`tmp/customer-service-preview/frontend-compact-workspace.png`、`tmp/customer-service-preview/frontend-quote-modal.png`。当前预览标签保留用于查看修改。

## 验证

- 网络隔离下 5 个定向测试文件：13/13，通过询价识别、只读/历史禁止操作、布局、发送边界及原报价安全约束。
- `pnpm run lint`、以 `89b17510` 为参考的 `pnpm run check:architecture`、`pnpm run build` 和 `git diff --check` 执行结果见本轮 `tmp/customer-service-preview/frontend-refresh-*-final.log`；大 chunk 提示是构建警告，不代表构建失败。
- 不声明完整客服链路、供应商 Ready 或真实发送验收；本轮没有真实外部 run/task/receipt。

恢复点为当前 HEAD 及保留的未提交差异；没有使用 reset、checkout、clean 或 stash 处理已有工作。
