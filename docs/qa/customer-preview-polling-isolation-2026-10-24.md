# 客服预览后台恢复与隔离诊断

- 工作树：`/Users/julia1/Documents/ChatGPT/1024客服`
- 分支：`feature/customer-service-20261024`
- HEAD：`89b175109149d4551aeb3ce590fe9c42c46bf23c`
- 本次保留全部既有未提交改动；不提交、不合并、不部署，不发起真实模型或渠道请求。

## 已确认来源与影响

1. 历史 backend.log 有大量固定 `[plugin-translate]` 错误标签。当前 `useConversionDraftEffects.ts` 已在本地预览跳过消息自动翻译；这条旧路径不能被当作当前仍在发生的问题。手动翻译属于另一个按用户动作授权的路径，本次未调用。
2. HTTP 启动仍会启动 `startMessengerContextTagRecovery`：立即扫描原 Messenger 持久会话，随后每 30 秒恢复未完成标签分析。它与隔离模拟服务的 `analyzeTags:false` 入站不同；会尝试授权数据读取或标签模型请求，后者被隔离拦截。当前用户仅要求模拟客服操作，无需启动原会话自动恢复。
3. web 角色还会启动 `localWeeklyExecutionRuntime`：读取已登记的独立周任务 opt-in，随后每 15 秒恢复。这是营销周任务恢复，非客服会话功能。不能因为原来有 opt-in 就在当前客服模拟预览自动恢复其他领域操作。
4. 客服客户列表 5 秒、可见时客户恢复读取，保留；它读取同源 `/customers` 和 `/customer-simulation/drafts`，用于客户/草稿状态恢复。全局通知与助手的低频本地状态读也保留。浏览器同源读取本身不等于真实渠道出网；后端仍按原授权/隔离边界处理。

## 改动

- `server/runtime/customerPreviewRecoveryPolicy.ts` 提供共同启动门禁，仅在 `LINGSHU_LOCAL_PREVIEW=1` 且 `CUSTOMER_SIMULATION_ENABLED=1` 时跳过两个恢复启动器，并返回可安全调用的空停止函数。
- `server/index.ts` 在原两处恢复启动入口使用门禁。普通本地预览（未开启客服模拟）和正式运行保留原启动/停止行为。
- `scripts/customer-isolation-diagnostics.mjs` 为拒绝事件提供固定 `targetClass` 和 `purpose` 标签；guard 不保存 URL、主机名、路径、凭据、消息正文或原始堆栈。未知调用明确记为 `unattributed`，不猜测具体业务。
- 诊断不改变任何允许/拒绝规则，不添加目标白名单。队列、发送账本和供应商状态均未改动。

## 验证及边界

定向命令（Node 由工作区 runtime PATH 提供）：

```sh
CUSTOMER_ISOLATION_CANARY=1 node --import ./scripts/customer-isolated-test-guard.mjs --import tsx --test scripts/customer-isolation.test.mjs scripts/customer-isolation-diagnostics.test.mjs server/runtime/customerPreviewRecoveryPolicy.test.ts
```

- 新增 5 项先行测试通过：隐私字段不保留、请求仍拒绝、两个恢复器不启动、其他环境保留启动/停止、HTTP 入口接线。
- 完整隔离定向 13/13 通过，canary 无逃逸；结果见 `tmp/customer-service-preview/polling-isolation-targeted.log`；统一 TypeScript/架构和功能矩阵由主任务执行。
- 本子任务未重启共享服务。原已运行进程不会热更新后端模块；需主任务统一重启后，使用已有本地登录态读取 `GET /api/overseas/customer-simulation/isolation`，仅汇总 `blocked` 的传输类型/固定分类，不输出认证信息。
- 旧记录只有时间和传输类型，无法追溯补齐具体用途。新的固定分类仍可能有 `unattributed`；不据此声称所有辅助功能已完整验收。
- 无真实外部 run/task 标识；没有真实供应商、真实发送回执或发布就绪结论。

恢复点：门禁为当前未提交的最小源码改动；本地会话/草稿及客户纠正数据未删除、未改写。停止/重启本地预览服务不会推进 Git 基线。
