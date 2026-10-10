# 销售与客服真实目标组件验收

2026-10-10，本地 Chrome 154.0.8037.98。仅新增测试/文档，无业务主功能改动或暂存提交。

## 命令

```sh
cd /Users/julia1/.codex/.chatgpt-projects/g-p-6ac46f113a0c8191968cd499b8c020f6/local-integrated-flow
/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/agent-card-conversion-ui.mjs
/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/agent-card-conversion-ui.mjs --mismatched-workspace
```

正向命令 exit 0。负向命令初测 exit 1；通知功能会话后，最新工作树主智能体独立复跑 exit 0：异源草稿不可见、归属拒绝提示可见。负测通过标准是拒绝异源响应，不要求被拒绝后仍展示原草稿。

## 已验证真实链路

| 类别 | 生产链路 | 证据 |
| --- | --- | --- |
| 销售交接 | WeeklyCustomerCalendar 从只读 API 结果生成日历卡片 → 真实详情弹窗 → forwardCalendarSales → revealWeeklySalesAction → 真实 WeeklySalesHandoffPanel 的领取按钮 | 完整租户/项目/周包版本/handoff版本/run/member/customer/action 身份一致，目标按钮可见且实际获得焦点；不点击领取写操作 |
| 客服运行 | WeeklyCustomerCalendar 从原绑定运行生成日历卡片 → 真实详情弹窗 → openCustomerCalendarTask → dispatchDigitalEmployeeDeepLink → useDeliveryHandoff → 真实 ConversionPage → 真实 CustomerWorkflowPanel | 事件和 sessionStorage 原 run/task 一致；真实组件 GET 原 run 的 customer-workspace；原任务标题、原 item、原 customer 名和只读草稿实际可见 |

销售生产路由为**同页面板定位**，并非跳转 conversion。客服路由才是跨页 conversion。

证据输出：`work/agent-card-conversion/evidence.json`、`sales.png`、`customer.png`。正向测试断言八个生产文件 SHA256 在浏览器验收前后相同；输出哈希记录测试时工作树，不能认为这些文件等同于干净 HEAD。

## 缺口与失败复现

`CUSTOMER-WORKSPACE-IDENTITY`：`--mismatched-workspace` 保留原 GET URL、原 run/task 导航，却回传异源 run/member/customer 的工作区。初测真实 CustomerWorkflowPanel 显示异源草稿，拒绝断言失败；最新复跑拒绝显示，提示“客服工作区与原运行、批次或客群成员身份不一致。”负向 JSON 位于 `work/agent-card-conversion/mismatch-evidence.json`。这不是已证实的后端越权或跨租户漏洞；服务端实际保证需要单独验收。

`CUSTOMER-NAVIGATION-SCOPE`：客服运行导航仅携带 run/task/taskKey，没有 tenant/member/customer 独立目标范围。正向测试只证明原 URL 的 fixture 成员与展示条目一致，不能据此宣称已完成独立的 member/customer 授权校验。

## 真实与受控边界

真实：WeeklyCustomerCalendar、AgentWeeklyCalendar、卡片详情与按钮、生产销售与客服导航 handler、销售目标 panel、ConversionPage 和 CustomerWorkflowPanel，全由仓库实际源代码导入，不 mock 目标组件。

受控：Shell 承接 `lingshu:navigate` 并切换挂载 ConversionPage，代替完整 App 的路由壳；销售 shell 使用 ConnectedAgentCalendar 相同的导出 reveal handler。只读 API 返回隔离 fixture，非后端真实业务数据。`executionTasks` 仅提供周包租户推导身份，不能算 ConnectedAgentCalendar 完整上游加载。

未覆盖：完整 App 登录/权限/布局、ConnectedAgentCalendar 全部上游数据、客服会话选中与真实客户列表（客户列表 fixture 为空，仍真实渲染原任务草稿工作区）、领取/发送/审批等 mutation、真实外部平台。所有非同源请求和非 GET/HEAD 请求阻断，未知只读 API 返回 404 且记入失败；正向运行无外网或写请求、无未知 API、无 pageerror。没有发布、外发、付费或部署。
