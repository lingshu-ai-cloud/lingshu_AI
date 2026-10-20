# 周内容生产端到端联调手册

## 目标

联调只推进一个明确作用域：`tenantId + programId + packageId + packageVersion`。代码修复可以并行验证，但同一耐久周包只能有一个写入者。Codex 负责诊断和修代码，产品中的 durable queue、worker 与 LangGraph 负责业务编排；聊天上下文不作为任务状态、授权或供应商回执。

最终完成条件是同一运行的真实成片通过硬质量门禁并进入 `waiting_review`。这不等于用户验收、发布或部署。

## 开始前的硬检查

1. 当前工作区必须存在目标周包的耐久记录、媒体字节及 sidecar 回执。只有代码和说明文档，不算拥有黄金状态。
2. 运行 `pnpm diagnose:weekly -- --program <programId> --package <packageId> --version <version>`。
3. 若返回 `scope_not_found`，停止联调。先恢复同源快照，禁止新建平行周包或根据说明文档补造记录。
4. 若返回 `diagnostic_unavailable`，先修基础设施；不得用 mock 或人工 JSON 伪装生产结果。
5. 只有明确、未过期且绑定当前作用域的授权才能触发付费调用。提示词中的金额描述不是新的授权回执。

## 每轮只做一件事

每一轮联调按以下固定顺序执行：

1. 只读诊断，取得唯一 `nextStop`。
2. 将问题归入四类之一：`product_runtime`、`external_evidence`、`user_input`、`engineering_review`。
3. 只修这个停点对应的接口、数据适配或节点缺陷。
4. 运行该边界的合同测试。
5. 使用同一周包、同一版本、同一 operation/idempotency key 重放该阶段。
6. 对比重放前后的状态清单，证明旧停点消失，并记录新的唯一停点。

禁止在一次循环里同时清理架构、补多个阶段、调用多个供应商和改产品需求。不能推进的外部证据应直接形成 `blocked_external`，而不是让主会话继续搜索代码。

## Agent 间输入输出合同

节点之间只能传持久化、可校验的 envelope，至少包含：

```json
{
  "schemaVersion": 1,
  "scope": {
    "tenantId": "...",
    "programId": "...",
    "packageId": "...",
    "packageVersion": 7
  },
  "stage": "candidate_exact_analysis",
  "runId": "...",
  "operationId": "...",
  "idempotencyKey": "...",
  "inputRefs": [],
  "inputHash": "...",
  "outputRefs": [],
  "outputHash": "...",
  "authorizationRefs": [],
  "budgetLedgerRef": "...",
  "status": "blocked_external",
  "blockerCode": "...",
  "retryable": false,
  "nextAction": "..."
}
```

生产者写入前验证输入 schema 与 hash，消费者领取前再次验证。自由文本只能作为说明，不能决定是否扣费、重试、结算或进入下一阶段。

## 并行工作的边界

- 可以并行：只读代码审查、互不相关的合同测试、隔离临时库中的复现。
- 不可并行：同一黄金周包扫描、供应商调用、operation 结算、预算占额、任务状态修复。
- 正式重放由主会话串行执行；其他会话只提交代码和测试，不接触黄金状态。

## 快照交接

黄金状态不进入 Git。交接必须包含：

- 明确的作用域四元组和导出时间；
- 相关耐久 collection 的一致性快照；
- 媒体文件、对象引用和 sidecar 回执；
- 每个文件的 SHA-256 清单；
- 不包含 API key、登录令牌、管理员密码或浏览器凭证。

导入时先落到独立目录，校验清单和引用完整性，再切换本地预览。缺媒体或回执时保持阻塞，不根据文档重建“看起来一样”的证据。

## 精简的 Codex 工作提示

> 只处理指定周包的当前唯一停点。先运行只读诊断；若作用域缺失就停止并报告快照缺口。若存在，修复 `nextStop` 对应的一个产品缺陷，运行该边界合同测试，再以原 operation 和幂等键重放一次。不得新建平行链、补造证据、扩大付费授权、代用户验收、发布或部署。输出前后状态差异和新的唯一停点。

这段提示只规定工作纪律；真实身份、预算、许可和供应商回执必须来自产品的耐久数据。
