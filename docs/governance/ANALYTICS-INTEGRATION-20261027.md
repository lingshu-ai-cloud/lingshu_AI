# 智能问数版本安全合入记录

日期：2026-10-27（Asia/Shanghai）。用户要求拉取并安全合入当前最新本地基线。

来源 `origin/节节智能问数待优化` 固定为 `cdfbab8dac65cb8c01be5995aea98635f6dc0fa7`，tree `e78e96bc30f25979857b96769cffa7bea68d6af8`。共同祖先 `bbe406a0`，目标实际 HEAD `1f0ca7e3`，合并源码 `ce83f310293e4c3df941ba5e10e315852e954cfd`。仅治理文件冲突，保留双方记录。没有修改来源源码来规避测试。

## 实际验证

- 功能定向：`node --import tsx --test --test-concurrency=1` 后接 `server/storage/localCollectionPersistence.test.ts`、经营总览及数字员工 UI 合同、`src/dev/businessOverviewSample.test.ts`、`src/lib/businessOverviewPresentation.test.ts`、系统公告前后端、客户目录及客服激活测试，共 26/26。
- 扩展回归：`node --import ./scripts/production-budget-offline-guard.mjs --import tsx --test --test-concurrency=1`，覆盖 pbStore 本地原子写、跨进程 CAS、锁回收、临时文件、本地权限/绑定策略、分页读取、图文买家文案/叠字与账号配置，共 47/47；离线保护禁止远程 socket。
- `pnpm run lint` 全量类型通过；`ARCHITECTURE_BASE_REF=1f0ca7e3 pnpm run check:architecture` 扫描 3030 文件通过；`pnpm run test:architecture-ratchet` 通过。
- `pnpm run check:digital-employee-migrations` 207 项只读清单及 `pnpm run test:migration-guard` 通过；`git diff 1f0ca7e3 -- pb_migrations scripts/pb-migration-checksums.json` 为空。
- `pnpm run check:container-contract`、`pnpm run build`、`pnpm run build:account-hub`、`git diff --check 1f0ca7e3 HEAD` 通过。构建有大 chunk 提示；Studio 预算通过。

## 保护与限制

证据 `/Users/julia1/.codex/integration-evidence/20261027-analytics/` 包含各命令日志、`before.patch`、`before.status`、`untracked-before.json` 与 `untracked-before.tar.gz`。恢复分支 `backup/pre-analytics-20261027-1f0ca7e3` 保留原 HEAD。推进前须确认权威 HEAD 未变化、补丁和 15 项未跟踪文件字节不变，再 `git merge --ff-only integration/analytics-safe-20261027`；推进后再次比对。未提交内容不纳入候选源码验收。

未执行全仓 quality/verify、真实浏览器业务验收、真实供应商、推送、部署或数据库迁移。没有复制真实运行数据或凭据，没有清理其他工作树。前述是源码及构建验证，不代表线上已更新。
