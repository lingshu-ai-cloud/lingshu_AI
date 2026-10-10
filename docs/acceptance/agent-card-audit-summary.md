# 智能体卡片验收汇总

2026-10-10，本地 `local-integrated-flow`。三路子智能体并行审计业务合同、实际卡片点击、Chrome 可用性与返回位置；主智能体复跑基线和失败项。仅新增验收脚本/文档，未执行真实发布、外发、付费或部署。

## 业务合同

11 类、100 项：99 通过，1 失败。另有日历/导航基线 7 项和发布/消息恢复/真实性基线 12 项通过，统计独立，不将重复覆盖相加为业务总数。

阻断项 `KNOWLEDGE-QUOTE-APPROVAL`：知识/报价补齐的新审批请求交给已有审批处理时，返回 `weekly_customer_approval_frozen_request_required`（409），栈在 `server/digitalEmployees/approvalDecision.ts:323`。单独复跑同样失败，未改主功能绕过检查。

```sh
cd /Users/julia1/.codex/.chatgpt-projects/g-p-6ac46f113a0c8191968cd499b8c020f6/local-integrated-flow
export PATH=/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
node scripts/agent-card-acceptance-contracts.mjs
pnpm exec tsx --test server/socialPrograms/weeklyCustomerKnowledgeQuote.test.ts
```

逐类命令和范围见 [业务合同报告](../product/agent-card-acceptance-contracts.md)。原始业务日志写入 `work/agent-card-acceptance/`。

## 浏览器与返回

Chrome 154.0.8037.98 本地可用。生产 handoff helper 在受控 React Activity 壳内通过 11 类显式输入；同会话任务、日期、滚动位置保留。它不代表真实 App 或卡片自动路由已通过。

`RETURN-RELOAD-DATE-SCROLL`：数字员工持久化返回上下文缺少日期范围/滚动字段。受控壳重挂载重置日期与滚动，完整 App 刷新回归未验证。严格验收命令以退出码 1 明示该缺口。

```sh
node scripts/agent-card-chrome-audit.mjs
node scripts/agent-card-chrome-audit.mjs --strict-return-position
node scripts/agent-card-click-ui.mjs
```

卡片动作与目的面板范围见 [点击报告](agent-card-click-audit.md)，返回证据与完整 App 缺口见 [Chrome 报告](agent-card-chrome-audit.md)。不能将回调身份通过、受控壳返回通过或 API 合同通过替代目的面板/App 完整验收。

完整 Connected 日历使用隔离库存服务生成的 v2 周包和绑定，挂载真实面板，GET 响应受控，Context 提供受控项目：库存审批卡成功聚焦原库存绑定面板。发布执行卡同时带库存目标时，点击“查看真实发布安排与平台尝试”仍聚焦库存面板；发布面板数量为 0，发布详情 GET 未发起。`AC-PUB-ROUTE` 为实际浏览器失败，测试保留退出码 1。其他 9 类真实目的面板/App 仍缺浏览器证明，详见专项报告。

```sh
pnpm exec tsx scripts/agent-card-connected-fixture-build.ts
node scripts/agent-card-click-connected-ui.mjs
```

builder 在临时隔离 store 中确认库存与修订周包，再清理临时资源；浏览器不调用真实业务写接口。发布尝试字段是手工受控读集，不是真实平台回执。

## 复现边界

审计始于 HEAD `37784717d3f82de5f90b19461bc2c492a2e94bd9`，运行中共享工作树有其他线程持续更新主功能。验收 commit 只包含本任务新增文件，不包含原有或其他线程的改动。浏览器脚本输出实际被测源码 SHA256；结果针对当时工作树，干净 HEAD 或新主功能版本需重跑。Node 不在默认 PATH，以上使用 Codex 本地运行时。
