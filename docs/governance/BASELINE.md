# 工程基线（阶段 0 核验）

更新时间：2026-10-21（Asia/Shanghai）

## 当前集成基线

- 仓库：`lingshu-ai-cloud/lingshu_AI`
- 集成分支：`xixi1021程永罗沟通前大整合`
- 上游冻结点：`62f85f8cc00a41a4e492261d92e227f2786592fd`
- 阶段一治理提交：`69813195277028455b6cc0a0c675de01d66217d5`
- 上一稳定基线：`xixi数字员工架构待清理` / `2d6c5a62d516c6eb5fc83d7dc19c17080aa31d98`
- 本地集成工作树：`/Users/julia1/.codex/worktrees/xixi1021-full-integration`
- 工作树只读盘点：[`WORKTREE-INVENTORY.md`](./WORKTREE-INVENTORY.md)（21 个注册项；不代表其他工作树已逐一验证干净）。
- 阶段 0 核验时工作区干净；图片 AIGC 工作树 `mobile-dual-edition-20261012` 有未提交改动，明确不属于本基线。

## 本阶段范围

阶段一仅处理基线可读性与低风险架构治理：基线声明、旧治理文档的权威边界、架构债务 ratchet 和运行产物隔离。业务规则、付费供应商调用、生产数据、部署、历史工作树/分支清理均不在本阶段范围内。

## 当前治理事实

- `architecture.config.json` 使用 schema v2，普通生产 TypeScript 文件上限为 800 行；本次核验记录 49 个历史超限文件的精确行数预算。
- CI 当前在 `build-release-images.yml` 的 `main` PR 校验步骤中调用架构检查，并以 PR base commit 为 ratchet 基线；其他 feature 分支 push 不会执行这条流水线。
- 本次新增的一次性债务快照仅适用于精确基线 `62f85f8cc00a41a4e492261d92e227f2786592fd` 和 ID `2026-10-21-stage1-verified-inventory`；后续 schema 或债务 ID 变更不能豁免预算上升。
- 快照后历史预算只能保持或下降；新增文件仍受 800 行限制。
- 工作流 `build-release-images.yml` 仅对指向 `main` 的 PR 运行验证；tag 或手动触发才进入镜像发布 job。环境部署/回滚工作流均为手动触发。
- 推送分支不等于部署授权；本项目仍遵守仓库 `AGENTS.md` 的部署限制。

## 独立状态，不混为一谈

1. 源码集成基线：本文件记录的 commit 和分支。
2. 图片 AIGC：已选择性集成分支 `xixi图片AIGC管线` 的提交 `95b0bcc16820e06fcc16ac75e040a6592abdc692`。本轮不包含该工作树未提交文件。轮播/GIF 多输出服务端链路仍未完成，不视为已可用。
3. 运行/预览数据：不由源码 commit 代表；需单独记录 store、服务实例和 run/package/version。
4. 真实供应商联调：需单独满足账号、资产、配额、授权、预算和唯一写入会话要求。

## 后续接手规则

- 新开发从明确指定的集成分支/commit 创建隔离工作树，不根据“最新”字样推断权威状态。
- 每次基线推进，更新本文件的分支、commit、工作树及验证结果。
- 未合入内容只记录来源与状态，不清理其工作树、分支或运行数据。
- 外部依赖未 Ready 时记录阻塞，不以扩大架构或真实付费重试绕过。

## 阶段一验证记录

- 架构 ratchet 回归：通过（含 schema 升级不能扩大/新增超限豁免）。
- 迁移仓库只读完整性：通过，191 项，无 blocker；不代表数据库升级已演练。
- 生产构建：通过；Vite 报告若干既有大 chunk 提示。
- TypeScript：通过。清理了不再被客户端使用、且将供应商成本映射为客户积分的旧 `/agent-usage-costs` 路由。
- 全量架构扫描：通过，2112 个生产 TypeScript 文件；49 个历史超限文件被冻结在准确基线预算内。
- ratchet 回归：通过，覆盖 schema 变更不能作为预算增长/新增历史豁免的后门。
- 这一提交建立清晰的债务快照，不代表 49 个超限文件已拆分；阶段一剩余工作应按每次 1–2 个业务热点文件拆分并降低预算。

## 阶段二：AIGC 与剩余基线治理

- 集成范围：关键词智能规划与测试、参考文案传递、图片任务合同/图层工具、单图质量参数、Qwen 多模态复核基础；详情见 `docs/architecture/adr/2026-10-21-aigc-merge-boundary.md`。
- 明确未完成：轮播多图生成与任务恢复、GIF 编码/交付、真实供应商端到端验收。对应内容继续保持 UI 不可选。
- 四层文档入口已建立：`docs/product/PRODUCT_BASELINE.md`、`docs/architecture/ARCHITECTURE.md`、`docs/architecture/adr/`、`docs/runbook/`。旧 PRD 暂不批量归档；未逐篇核对引用和权威关系前保留原位。
- 外部联调与产品开发已拆为两条泳道，准入清单见 `docs/runbook/EXTERNAL-E2E-READINESS.md`。
- 架构检查通过：2121 个生产 TypeScript 文件；49 个历史超限文件仍不超过冻结预算。TrafficPage 删除重复图文导航分支并下调其预算 71 行；studio.ts/AiCreateStudio.tsx 的预算随已确认的行数下降 1 行。
- 架构 ratchet 回归通过；迁移仓库只读预检 191 项通过、无 blocker；图片 AIGC 专项测试 31/31 通过。
- 全量 TypeScript 检查通过；生产前端构建通过（保留既有大 chunk 警告）。
- 该阶段验证只代表本地自动化/构建结果；不代表外部账号、真实供应商或线上部署验收。本次没有调用真实付费供应商、部署或推送。
