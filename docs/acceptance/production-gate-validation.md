# 本地生产门禁与 Agent 卡片独立验收

2026-10-10；起始 HEAD `55a489f2da3b46cee0e7eb2313ac2bc0d6f53a74`。针对共享工作树本地验证，API 使用隔离 fixture，不是生产服务可运行或可部署的证明。没有启动业务 worker、真实发布、外发、付费、部署或迁移。

## 结果

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| 全量 TypeScript | `pnpm exec tsc --noEmit` | 首轮 exit 0；readiness 修改冻结后最终复验 exit 2：他组新增/修改测试有 7 条类型错误，见失败清单（不得据首轮通过称最终工作树通过） |
| 主站构建 | `pnpm run build` | exit 0；保留大 chunk 提示，无构建错误 |
| Account Hub 构建 | `pnpm run build:account-hub` | exit 0 |
| 11 类业务 fixture/合同 | `node scripts/agent-card-acceptance-contracts.mjs` | 首轮和共享相关模块变化后的最终复跑均 90/90 通过、exit 0 |
| 安全运行门禁 | `pnpm exec tsx --test server/runtime/processRole.test.ts server/runtime/durableLease.test.ts server/runtime/httpSafety.test.ts server/runtime/readiness.test.ts server/auth/inviteRegistration.test.ts server/starter198/runMutationLease.test.ts` | 首轮 6 文件通过、exit 0；文件级统计包含多个内部断言 |
| 最终安全运行门禁 | 上述 6 文件再加 `scripts/production-gate-readiness-keyfile.test.ts` | readiness 文件冻结后最终复验 exit 0，TAP 8/8（6 个文件级用例与 2 个 key-file/audit 用例）；临时假凭据，无供应商请求 |

实际命令 PATH：`/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin` 与 `.../dependencies/bin/fallback`。所有日志与原始证据保存于 `work/production-gate-validation/`。

## Chrome 目标覆盖

Chrome `154.0.8037.98`。11 类目标由 **16 个实际组件 positive case** 覆盖，按类别去重统计，不与合同 90 项或下面额外用例相加：

| 脚本 | 实际目标用例 | 范围/结果 |
| --- | --- | --- |
| `agent-card-inline-ui.mjs` | 11 | 7 类：发布执行、库存复用、跨周素材、客服知识/报价补齐、发布恢复、M/IG恢复、WA恢复；原 panel dataset/可见/焦点检查，exit 0 |
| `agent-card-smartassets-ui.mjs` | 3 | 2 类：内容生产、人工素材（上传/核验）；真实 TrafficPage → AiCreateStudio 与真实素材消费者 panel，exit 0 |
| `agent-card-conversion-ui.mjs` | 2 | 2 类：销售交接、客服运行；销售为同页真实领取 panel，客服为真实 ConversionPage/CustomerWorkflowPanel，fixture 修复后 exit 0 |

额外验证分别统计：

- `agent-card-click-connected-ui.mjs`：历史双目标卡的库存和发布执行真实 Connected 路由，2 路径、exit 0。
- `agent-card-click-ui.mjs`：12 条真实日历点击→modal→callback 身份路径，exit 0；只能证明 callback 合同，不能计入真实目标业务通过。
- `agent-card-conversion-ui.mjs --mismatched-workspace`：异源工作区必须拒绝、草稿不可见且错误提示可见，同正向完整 fixture 基线，exit 0。
- `agent-card-chrome-audit.mjs --strict-return-position`：包装真实完整 App、DigitalEmployeePage、ConversionPage 的只读验收，WhatsApp/Messenger/Instagram **3 渠道**全部通过，exit 0。真实会话空间可见；真实历史 Back 与刷新保持原日历日期偏移/原卡片/账户筛选/横向与纵向 DOM 滚动；登录身份漂移拒绝旧快照与旧任务历史。没有 gaps/pageerror/非预期外网或写请求。

目标组件用例使用受控导航壳、SocialProgramContext 与只读 GET fixture；目标组件/导航 handler 来自真实源代码。只有 strict 返回测试挂载完整 App。没有用户真实账号或平台连通性验收。客服运行导航携带 run/task，成员与客户关系由原工作区响应和生产 validator 校验，仍不是单独带 tenant/member/customer 的导航目标。

## 唯一修复：旧 Conversion fixture 缺失身份

最初 `chrome-conversion.log` exit 1：原 item 等待超时。不是通过降低验证器解决：已提交 `c4cab2c` 的 `assertCustomerWorkspaceIdentity` 要求 scope、task.run_id、segment/batch/member/item 的 tenant/run/segment/batch/member 关联，旧脚本 fixture 没有这些字段。

本轮只修改 `scripts/agent-card-conversion-ui.mjs` 补完整身份，并将验证器纳入 sourceHash；生产主功能未由本验收修改。正向实际原草稿通过，负向同基线异源响应被拒绝。保留初始失败和后续复验独立日志，成功证据为 `chrome-conversion-evidence.json` 与 `chrome-conversion-negative-evidence.json`。

## 最终类型失败清单

`types-final.log` 保留 7 条诊断，均位于他组本轮新增/修改测试：

- `server/runtime/weeklyCreativeRepairStageRecovery.test.ts:29`：patch union 缺 recordHash 属性。
- `server/runtime/weeklyM1ContinuousProduction.integration.test.ts:171`：WeeklyScheduleSnapshot 没有 scheduleHash。
- `server/socialPrograms/weeklyScheduleTargetGraph.test.ts:3`：executionGraphVersion 推断为 number，4 处不能赋给 2/3 类型。
- `server/socialReview/weeklyReviewWorker.test.ts:146`：list wrapper 未保持 DataStore.list 泛型返回类型。

本验收未覆盖或修改这些 owner 文件。已将完整诊断报告协调会话；需对应 owner 修复后重新全量类型检查。

## 源版本与共享工作树限制

`source-before.json` / `source-after.json` 保存 HEAD、tracked source SHA256、drift 与完整 dirty 文件列表。检测到他组并行修改 durableQueue、weekly 执行/素材/参考来源/复盘和 readiness 等源码；本验收唯一既有文件修改是上述 fixture 脚本。这些变化不能全算成本轮审查或修复，也不能称整个 dirty checkout 已被全面审核。

Chrome 目标组件测试各自输出源哈希，inline/smartAssets/conversion 还断言前后源一致。runtime/readiness 冻结后的最终 types/runtime 结果单独记录；不因 unrelated backend drift 重复 UI。业务合同涉及变化模块，因此已额外复跑。构建结果针对首轮当时工作树，不能替代未来新增源码变更后的重新构建。
