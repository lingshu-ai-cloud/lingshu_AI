# 技术返工启动映射恢复专项

日期：2026-10-10（Asia/Shanghai）

源码基线核验：`local-integrated-flow`，HEAD `83a160b`。本机共享工作区；只提交本专项文件。

## 故障与结果

技术返工启动先持久化独立 run、intent 和 job，再保存任务卡的 `execution`。最后一次保存失败时，任务卡仍为 `ready`。如果原作业随后完成，旧启动路径要求 run 仍在 running，导致无法重新关联；完成复检入口又要求任务卡已有 execution，形成断点。

恢复路径先读取已经持久化的 intent/run/job，核验任务卡容量确认、租户、负责人、源任务、源 run、父成片哈希、缓存哈希、计划哈希、operation 和场景集合。严格状态读取还会核验独立 run 授权、唯一 job 和已有产物回执。验证成立后，只补回同一 `execution`。

恢复不会再创建 run、intent 或 job，也不把原作业重置为执行中。任务卡暂以 `running` 表示已绑定执行，真实作业状态仍由原 job/run 提供，后续复检服务负责进入 `awaiting_audit` / `resolved`。已启动作业的映射恢复可以在原启动窗口过期后进行；新作业仍受原期限和准入校验约束。

intent 已保存但 job 尚未存在时，继续原幂等准入路径。身份、范围或持久证据不匹配时拒绝恢复。

## 验证范围

使用内存存储和受控本地产物 fixture，禁止真实外部发布、消息发送和付费生产调用。专项故障测试覆盖启动任务卡保存失败、原 job/run 终态、重复重试、身份不匹配、原有真实本地产物重新关联及复检。

独立技术基线 13 文件共 37/37 通过。修复后运行下列三个文件，共 7/7 通过（新增 3 项、原任务卡 3 项、原完成复检 1 项），无失败或跳过：

```sh
node --import tsx --test --test-concurrency=1 \
  server/socialPrograms/weeklyTechnicalRepairAdmissionRecovery.test.ts \
  server/socialPrograms/weeklyProductionRepairCases.test.ts \
  server/socialPrograms/weeklyTechnicalRepairCompletion.test.ts
```

新增测试分别验证：一次任务卡失写后原 job 完成、窗口过期仍恢复原身份且禁止新增 run/job/intent；错误 actor/tenant/task/run 拒绝；已有真实本地子产物重新绑定后 `reconcile` 返回 `awaiting_audit`，子成片 ID 保持一致。第三项使用受控本地渲染 fixture，不是线上供应商实况。该专项不代表线上端到端验收完成。

全库 `tsc --noEmit -p tsconfig.json` 已完成，退出码 2，只有下列共享工作区错误；本次三个文件没有类型诊断，不据此声称全库通过：

```text
src/components/socialProgram/customerExecutionCalendarNavigation.test.ts(2,12): error TS2352
测试对象转换为 WeeklyExecutionTask 时缺少 workflowKind、scope、subjectId、accountId 等必需字段。
```

该前端测试不属于本专项，交由主集成分配其负责人处理。`git diff --check` 通过。

## 容量语义边界

当前技术返工 `ready` 表示成本授权和预计工期可落入截止窗口；不代表已预留真实队列并发容量。实际并发配额在生产准入时检查。本批仅记录此边界，不改变容量产品语义。
