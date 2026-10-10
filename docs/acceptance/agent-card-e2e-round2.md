# 11 类任务卡 Chrome 第二轮验收

2026-10-10。本轮按同页真实面板、smartAssets 实际目标分支、conversion 实际目标组件三个子智能体并行执行，主智能体独立复跑。仅改验收文件和报告，没有改主功能，没有真实发布、外发、付费或部署。

## 合同复跑与统计更正

原 11 类合同矩阵共 **90 项**，本轮全部通过。第一轮合计写成 100 项是算术错误，逐类日志实际为 89 通过、1 失败；相关历史报告已更正。浏览器用例单独统计，不与合同测试混加。

已吸收共享当前分支提交 `4c536e6`（发布分流）、`096a4a9`（冻结知识/报价审批）、`6ad71cc`（实际 smartAssets 原周生产记录）、`c4cab2c`（完整 App 返回、工作区归属拒绝、真实聊天可见）。原双目标发布执行卡打开实际发布执行面板并发出详情 GET，库存审批卡仍定位原绑定库存面板；知识/报价审批 409 的合同回归通过。

## 逐类目标与证据

| 类别 | 实际路由与可见身份 | Chrome 结果 |
| --- | --- | --- |
| 发布执行 | Connected → publication-execution:t:p:week2:2:audit-publication-execution；原 task/account/publication，assignment/attempt GET | 通过 |
| 库存复用 | Connected → inventory-workspace:t:p:week2:2:45c59d520cf7a42；原 binding/publication | 通过 |
| 跨周素材 | Connected → cross-week-material:t:p:week2:2:inline-cross；原 request=original-material、新 consumer=new-consumer | 通过 |
| 客服知识/报价补齐 | Connected → weekly-customer-exception:t:p:week2:2:bound-run:inline-knowledge / inline-quote；提交与核验，原 request/run/item/member | 通过，4 子用例 |
| 发布恢复 | Connected → publication-recovery:t:p:week2:2:inline-publication；原 task/publication/attempt | 通过 |
| M/IG 恢复 | Connected → native-send-recovery:t:p:week2:2:inline-messenger / inline-instagram；原 run/task/request/channel | 通过，2 渠道 |
| WA 恢复 | Connected → customer-send-recovery:t:p:week2:2:inline-whatsapp；原 run/task/item/whatsapp | 通过 |
| 销售交接 | WeeklyCustomerCalendar → revealWeeklySalesAction → 实际 WeeklySalesHandoffPanel 领取按钮；原 handoff/version/run/member/customer/action | 通过，同页面板 |
| 内容生产 | Connected → 实际 App smartAssets/create 分支 TrafficPage → WeeklyContentProductionView；原 weeklyContentTarget | 通过，原 content task/run 可见且目标重新 GET 核验 |
| 人工素材 | Connected → 实际 WeeklyMaterialRequestsPanel；request=audit-manual-request、consumer=audit-content-consumer、week2 v2，上传与核验控件 | 通过，同页面板 |
| 客服运行 | WeeklyCustomerCalendar → 实际生产深链 → ConversionPage / CustomerWorkflowPanel；run-original/workflow-original/item-original/customer-original | 通过 |

同页面板 11 个用例覆盖 7 类，身份 dataset、可见性、焦点和请求均记录在 `work/agent-card-inline-evidence.json`。人工素材两动作及内容目标证据在 `work/agent-card-smartassets/evidence.json`，销售/客服证据和截图在 `work/agent-card-conversion/`。真实目标组件没有被替换，周包/项目选择及 GET 读集受控；这些不是实际平台回执或客户活动证据。

## 归属负测

`CUSTOMER-WORKSPACE-IDENTITY` 最小负测保持原 run/task GET URL，返回异源 run/member/customer。发现时真实目标组件显示异源草稿；已通知对应功能会话。本轮最新工作树独立复跑已拒绝异源草稿，显示“客服工作区与原运行、批次或客群成员身份不一致。”回归保留在 `--mismatched-workspace`，通过标准是异源不可见且拒绝提示可见。该发现不能推断真实后端跨租户漏洞。

`AC-SMARTASSETS-PRODUCTION` 首次失败：Connected 正确发出冻结周包 target（week2 v2、execution audit-content-consumer、content audit-content-task、run audit-original-run），实际目标却没有原周视图和重验。通知功能会话后最新稳定工作树独立复跑已通过：原 region=1、原运行可见=1、production-navigation 两次（前置和目标重验）。最小命令为 `--case content`，原断言保留；验收会话没有改主功能。

## 可复现命令

```sh
cd /Users/julia1/.codex/.chatgpt-projects/g-p-6ac46f113a0c8191968cd499b8c020f6/local-integrated-flow
export PATH=/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
node scripts/agent-card-acceptance-contracts.mjs
node scripts/agent-card-click-connected-ui.mjs
node scripts/agent-card-inline-ui.mjs
node scripts/agent-card-smartassets-ui.mjs
node scripts/agent-card-smartassets-ui.mjs --case content
node scripts/agent-card-conversion-ui.mjs
node scripts/agent-card-conversion-ui.mjs --mismatched-workspace
node scripts/agent-card-chrome-audit.mjs --strict-return-position
```

## 完整 App 严格返回

真实 App / DigitalEmployeePage / ConversionPage 加载只读 API fixture，在 `c4cab2c` 后三渠道主智能体独立复跑严格入口 exit 0：原会话标题和消息实际可见，原日期/周偏移、周包/筛选、卡片焦点、实际 DOM 横纵滚动均在 Back 和刷新后恢复，旧详情不重开，登录身份漂移拒绝旧上下文。实际 DOM `{left,top}`：WhatsApp `{173,392}`、Messenger `{173,991}`、Instagram `{173,1276}`。失败/阻断请求/页面与控制台错误均为空。

原严格命令已转发到真实 App 脚本及默认三渠道 fixture；可以单独运行：

```sh
AGENT_CALENDAR_AUDIT_FIXTURES=scripts/fixtures/agent-calendar-return-api.json node scripts/agent-calendar-return-chrome-audit.mjs
```

最新独立证据为 `work/agent-card-audit/strict-after-commit.json`。不是用户真实账号或外部平台验证；API 是明确受控读集，真实 App 和源页面组件保持原实现。目标组件控制壳的 11 类测试与此完整 App 返回测试分别报告。

加强版检查曾暴露 WA/Messenger 真实聊天区域被布局挤压、缺失报价能力夹具、重复客户 key；均通知功能会话后由其修复并复跑。真实 App 冷编译曾超过全局 10 秒启动等待，本验收只将启动 goto/module-ready 增至 60 秒并等待 DOMContentLoaded，保留所有会话/身份/滚动断言及超时，不筛除错误来制造通过。

脚本创建隔离本地 Chrome profile 和临时 Vite，阻断外网与非 GET/HEAD。源文件 SHA256 固定实际被测工作树。共享其他线程修改和提交不在本验收提交中；没有 reset、覆盖或合入无关工作树。
