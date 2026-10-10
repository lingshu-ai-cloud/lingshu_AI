# Chrome 本地可用性与返回位置审计

2026-10-10；只审计本地开发代码，不调用业务后端、外部平台、发布、外发、付费、部署。主功能与既有脏文件未修改。

## 可复现命令

```sh
cd /Users/julia1/.codex/.chatgpt-projects/g-p-6ac46f113a0c8191968cd499b8c020f6/local-integrated-flow
/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/agent-card-chrome-audit.mjs
/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/agent-card-chrome-audit.mjs --strict-return-position
```

默认 Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`；可用 `AGENT_CARD_CHROME_PATH` 指定本地安装路径。脚本创建隔离 headless profile，启动临时 127.0.0.1 Vite 服务器，结束时关闭两者。所有非同源、`/api/`、非 GET/HEAD 请求均阻断；若组件意外发出这些请求，测试失败。脚本不连接用户现有 Chrome profile。

## 已运行的证据

- Chrome `154.0.8037.98` 可启动，真实浏览器加载生产 `dispatchDigitalEmployeeDeepLink` 与 `consumeDigitalEmployeeReturnContext`。
- 11 类输入依次验证 run/task 显式归属、deliveryId 保存、openedPage、消费一次后清空。无 pageerror，无阻断网络尝试。
- 控制壳使用与 App 同样的 React Activity 隐藏/显示方式。离开再返回 11 次，任务 `task-other`、日期 `2026-08-31`、scrollTop `700` 全部保留。
- 源码合同确认真实 App 的数字员工 Activity，以及真实 DigitalEmployeePage 在新挂载时匹配 run/task 并恢复 selectedTaskId 的实现。
- 默认命令 exit 0；严格返回位置命令 exit 1，明确保留待验收缺口，不把缺口记成通过。

## 失败/未完成项

| ID | 结果与影响 | 复现 |
| --- | --- | --- |
| RETURN-RELOAD-DATE-SCROLL | 持久化 returnContext 没有 productionPeriod / startsAt / endsAt / scrollTop。控制壳刷新后日期回到 `2026-09-14`，scrollTop 回到 `0`。真实 App 新挂载默认 productionPeriod 是 week，恢复代码只恢复视图、任务、交付焦点，没有日期/滚动恢复。属于持久化能力缺口；不能把控制壳结果称为真实 App 刷新回归。 | 严格命令，读取 JSON gaps |
| FULL-APP-RETURN-UNVERIFIED | 未在完整认证 App 内操作真实数字员工页面与真实目标业务面板；真实 App 同会话任务/日期/滚动实际保留仍需完整 UI 验收。当前 Activity 控制壳通过只能证明该机制。 | 配合真实 App 测试补充 |
| DESTINATION-ROUTING-UNVERIFIED | 11 类目的页面是显式输入，未由生产卡片自动生成，不能用本脚本证明卡片路由正确。真实日历点击由 `agent-card-click-ui.mjs` 独立覆盖，其 callback seam 同样不是完整目标面板。 | 点击脚本与合同测试 |

## 真实 / 控制 / 未覆盖边界

真实：已安装 Chrome、Vite/React runtime、生产 handoff helper、sessionStorage/event 实际运行、生产源代码合同。

控制：任务选择器、日期输入、700px 滚动容器、业务目的页面占位、React Activity 控制壳，11 类 link 的目的页面参数。没有模拟业务 API 成功，也没有生成虚假发布/消息回执。

未覆盖：真实 App 认证与完整 overview、真实目的页面加载、App 浏览器 Back 历史栈、真实业务 mutation、Messenger/Instagram/WhatsApp 平台、后端任务恢复、刷新后完整 App 的任务与滚动恢复。不得将 11 条机制用例汇总为 11 类端到端业务通过。

## 工作树事实

本轮测试所在 HEAD 为 `37784717d3f82de5f90b19461bc2c492a2e94bd9`。`src/App.tsx`、`src/components/DigitalEmployeePage.tsx`、`src/lib/digitalEmployees.ts` 在审计结束时均为其他工作中的修改，未由本审计修改或暂存。实际测试针对当时工作树，不代表该 HEAD 的干净树。脚本每次输出 `sourceHashes` 用于固定实际被审计的版本，后续主功能变化需重跑。本文不把这些脏文件纳入验收提交。
