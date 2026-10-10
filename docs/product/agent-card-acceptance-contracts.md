# 智能体卡片逐类业务合同验收

2026-10-10，本地仓库验收。11 类共 100 项：99 项通过、1 项失败；10 类通过、1 类失败。执行入口：

```sh
export PATH=/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
node scripts/agent-card-acceptance-contracts.mjs
```

入口集中列出 11 类现有隔离 fixture 与接口/投影合同，逐类执行，全部完成后用退出码报告失败。可在命令后指定一个或多个类别 id。结果和原始日志写入 `work/agent-card-acceptance/`。这些用例使用内存数据、受控供应商回调、临时文件或回环 HTTP；没有运行应用服务器入口、真实发布、外发、付费或部署。

| 类别 id | 业务 | 本次结果 | 检验范围 |
|---|---|---|---|
| publication-execution | 发布执行 | 通过 | 受控发布扫描、冻结版本操作合同 |
| inventory-reuse | 库存复用 | 通过 | 真实服务绑定、身份/来源漂移和素材冲突、API |
| cross-week-material | 跨周素材 | 通过 | 原请求复用、消费者独立审核、截止时间保留 |
| knowledge-quote | 客服知识/报价补齐 | **失败** | 冻结事实/报价、新审批请求、API |
| publication-recovery | 发布恢复 | 通过 | 原发布尝试和原收据恢复、API |
| native-recovery | M/IG恢复 | 通过 | 原生消息收据恢复、身份漂移和阻塞保留、API |
| wa-recovery | WA恢复 | 通过 | 原 WA 请求与既有证据恢复、API |
| sales-handoff | 销售交接 | 通过 | 销售日历投影与会话证据 API |
| content-production | 内容生产 | 通过 | 历史成品导航、实际回环 HTTP 与生产视图 |
| manual-material | 人工素材 | 通过 | 新消费者验收和冻结素材绑定 |
| customer-runtime | 客服运行 | 通过 | 精确周包运行绑定、通道范围和登录漂移 |

## 失败清单

- `server/socialPrograms/weeklyCustomerKnowledgeQuote.test.ts:11`：`new real approval request is consumable by existing approval decision application with exact new hash/version`。新补齐审批请求提交既有审批处理时返回 `weekly_customer_approval_frozen_request_required`，状态 409，栈指向 `server/digitalEmployees/approvalDecision.ts:323`。知识/报价组 12 项中 11 项通过、1 项失败。
- 最小复现：`pnpm exec tsx --test server/socialPrograms/weeklyCustomerKnowledgeQuote.test.ts`；运行整个对应组：`node scripts/agent-card-acceptance-contracts.mjs knowledge-quote`。

本入口复用现有 substantive fixture，没有改主业务或原有测试，也没有把供应商受控回调当作平台能力证据。这是业务/API 合同层；通过不证明浏览器卡片可点击或正确返回。销售交接仅覆盖投影与证据读取，客服运行仅覆盖绑定与通道合同，不声明完整外发流程已通过。卡片点击和 Chrome 返回位置由独立 UI 审计报告。

## Connected 日历隔离读集

`pnpm exec tsx scripts/agent-card-connected-fixture-build.ts` 调用既有 `inventoryFixture`，在其隔离存储执行库存确认、周包修订及绑定读取，生成 `scripts/agent-card-click-connected-fixture.mjs`。该静态模块提供周包 v2、已绑定库存记录、库存审批/发布执行任务以及 GET mock 读集，供真实 `ConnectedAgentCalendar` 与真实库存面板的浏览器测试使用。生成器最后清理原业务 fixture 的临时文件。

库存绑定来源于隔离业务服务；供页面渲染的两个 execution task 是手工控制任务。发布 assignment、attempt、`audit-readonly-receipt` 等字段也是手工控制读集，仅满足发布详情读取合同，**不是真实平台回执，也不是发布完成或平台能力证明**。辅助无关面板返回空读集，未绑定客服运行，因此没有声明知识补齐面板已获得浏览器验证。

生成后纯合同检查通过：库存记录解析状态为 `bound`，执行投影产生库存审批卡及发布执行卡；后者同时具有库存和发布导航 target。浏览器审计需确认真实点击选择哪个分支，不能将这个投影检查当作点击成功。

## 本次逐类命令与统计

- `pnpm exec tsx --test server/publishing/weeklyPublicationExecutionWorker.test.ts src/lib/agentOperatingControlActions.test.ts`：4 项，4 通过，0 失败。
- `pnpm exec tsx --test server/socialPrograms/weeklyInventoryReuse.integration.test.ts src/lib/weeklyInventoryReuseApi.test.ts`：13 项，13 通过，0 失败。
- `pnpm exec tsx --test server/socialPrograms/weeklyCrossWeekMaterialContinuations.test.ts`：9 项，9 通过，0 失败。
- `pnpm exec tsx --test server/socialPrograms/weeklyCustomerKnowledgeQuote.test.ts src/lib/weeklyCustomerKnowledgeQuoteApi.test.ts`：12 项，11 通过，1 失败。
- `pnpm exec tsx --test server/socialPrograms/weeklyPublicationRecovery.test.ts src/lib/weeklyPublicationRecoveryApi.test.ts`：11 项，11 通过，0 失败。
- `pnpm exec tsx --test server/socialPrograms/weeklyNativeSendRecovery.test.ts src/lib/weeklyNativeSendRecoveryApi.test.ts`：5 项，5 通过，0 失败。
- `pnpm exec tsx --test server/socialPrograms/weeklyCustomerSendRecovery.test.ts src/lib/weeklyCustomerSendRecoveryApi.test.ts`：9 项，9 通过，0 失败。
- `pnpm exec tsx --test src/components/socialProgram/weeklySalesCalendarProjection.test.ts src/lib/weeklySalesConversationEvidenceApi.test.ts`：7 项，7 通过，0 失败。
- `pnpm exec tsx --test src/lib/weeklyContentProductionView.test.ts src/lib/weeklyContentNavigationApi.test.ts`：5 项，5 通过，0 失败。
- `pnpm exec tsx --test server/socialPrograms/weeklyMaterialNewConsumerAcceptance.test.ts src/lib/weeklyMaterialBinding.test.ts`：7 项，7 通过，0 失败。
- `pnpm exec tsx --test src/lib/weeklyCustomerRunApi.test.ts src/lib/weeklyCustomerChannelScopeApi.test.ts`：8 项，8 通过，0 失败。
