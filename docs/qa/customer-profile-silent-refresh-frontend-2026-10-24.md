# 客服画像静默刷新：前端恢复验证

工作树 `/Users/julia1/Documents/ChatGPT/1024客服`，分支 `feature/customer-service-20261024`，HEAD `89b175109149d4551aeb3ce590fe9c42c46bf23c`。改动仍未提交或合入基线。

## 结果与显示

- 服务端明确返回成功分析后，前端直接恢复成功画像，不再无条件用“待分析”投影覆盖。
- 新消息分析中或失败时，保留上次成功结果；当前买家指纹与成功结果指纹分别记录，失败不能宣称当前分析已成功。
- 首次没有有效结果时显示未评估，零分不被呈现成 AI 结论。
- 轮询按分析状态更新时间拒绝旧快照倒退，同时按人工纠正更新时间保留最新纠正。不覆盖正在编辑的草稿；刷新恢复持久草稿；同一消息原文未变时保留译文。
- 不增加常驻提示区。既有“客户画像与跟进依据”展开区轻量展示分析状态、更新时间；失败码可通过该状态文字的 title 查看。沿用共享文字 Token。
- UI 设计规范第 16.11 节已同步“新消息后台更新、保留上次有效画像”的新规则。

## 实际验证

```sh
CUSTOMER_SIMULATION_REAL_AI=0 node scripts/run-customer-isolated-tests.mjs src/hooks/localCustomerProfile.test.ts src/components/customers/CustomerProfileAnalysis.test.tsx
```

13/13 通过，日志 `tmp/customer-service-preview/profile-silent-frontend-tests.log`。包含成功结果轮询/刷新、失败/分析中保留、首轮未分析、旧轮询不覆盖成功或人工纠正、指纹不符不得宣称成功，以及侧栏 SSR 的轻量状态语义。

本子任务没有调用真实模型或渠道，没有浏览器交互验收，没有重启共享服务。TypeScript、架构和完整功能矩阵由主任务统一执行；不能把这里的纯函数与 SSR 结果写成真实模型、真实渠道或浏览器 E2E 通过。

改动文件：`shared/contracts/localCustomerProfile.ts`、`src/types/customer.ts`、`src/hooks/localCustomerProfile.ts` 及测试、`src/components/customers/ConversionCustomerRail.tsx`、`src/components/customers/CustomerProfileAnalysis.test.tsx` 和 UI 规范。数据持久化与后台分类由原本地模拟服务负责，无第二条发送/审批流程。

## 即时模拟操作快照

`LocalCustomerSimulation.Snapshot` 已携带服务端 `profile`，操作响应及主动读取立即应用状态/时间/指纹与画像，再使用该响应的权威 timeline。恢复时读取最新 customer ref，避免等待期间的更新被旧闭包覆盖。新增 `LocalCustomerSimulation.profile.test.ts` 2 项测试与 11 项恢复测试合计 13/13 隔离通过，日志 `profile-snapshot-tests.log`；不依赖 5 秒轮询才显示新入站或成功结果。
