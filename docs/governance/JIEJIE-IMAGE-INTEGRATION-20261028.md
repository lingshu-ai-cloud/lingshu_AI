# 节节图片联调完成：本地统一基线合并记录

日期：2026-10-28（Asia/Shanghai）。本记录只确认本地源码集成；完整验收存在下列未解决失败。

## 来源、合并与恢复

- 原基线：`baseline/unified-20261028` / `21a9fb948ad807c0edcb50c5a4399745c343d3fb`，目录 `/Users/julia1/Documents/ChatGPT/基线管理/image-text-baseline-20261028`，操作前工作区干净。
- 用户指定来源：GitHub `节节图片联调完成` / `453ef28b204130e8c90f5a1b30dd3638345ec264`。通过 `git ls-remote` 实时核对并定向 fetch；同名本地分支已建立远端跟踪。没有拉取或合并来源工作区的未提交内容。
- 隔离工作树：`/Users/julia1/Documents/ChatGPT/基线管理/jiejie-image-safe-20261028`，分支 `integration/jiejie-image-safe-20261028`。
- 合并前双方独有提交为基线侧 2、来源侧 27。双亲合并提交 `378a7a64d9248527595e32af494c119ac3c74cf0`；父提交依次为精确旧基线与精确来源。仅 `docs/governance/BASELINE.md` 冲突，双方历史记录均保留，无生产代码文本冲突。
- 最小兼容修复：`e67e0c5d50f303ce473fab46a382d2e9e0164186`。删除周计划中仍引用已移除状态和导入的人物硬门残片，遵循来源 ADR 的纯产品计划规则；评分预览改用已有四维度数据结构及详情入口；更新两处过时合同断言，继续检查首页导航目标和私有素材的租户/授权库存约束。
- 验证后原干净基线通过 `git merge --ff-only e67e0c5d...` 推进；本治理记录随后单独提交。原基线分支、源码提交与已核对来源均为合并结果祖先。
- 安全恢复点：`backup/pre-jiejie-image-20261028-21a9fb94`。需要旧版本时新建工作树检出该引用，不重置现有开发现场。
- `baseline/unified-20261026`、`1028视频联调` 和其他旧工作树未推进、未清理、未重置。没有复制运行数据库、账号凭据或私有素材；隔离工作树只软链已有依赖。

## 实际纳入范围

除图片参考画幅与人审交互外，来源还包括统一周计划、内容生成队列、助手恢复/可读回复、账号四维度评分、worker 就绪和部署配置。来源的已采纳 ADR 将内容生成改为“不限额计量”，金额预测不再作为创作准入上限；生成授权、计价、幂等、身份、未知供应商结果和发布授权仍分别管理。此次仅合并源码，没有启动本地预览、真实生产 worker 或真实供应商调用。

相对旧基线没有 `package.json`、锁文件、AGENTS.md 或迁移变化。部署模板变更随来源保留，未执行部署命令。

## 验证与限制

所有命令、退出码和完整日志保存在 `/Users/julia1/.codex/integration-evidence/20261028-jiejie-image`。

- 58 个本次变化的 TypeScript 测试文件：最终 `node --import ./scripts/production-budget-offline-guard.mjs --import tsx --test --test-concurrency=1 ...`，267/267 通过；准确文件列表见 `changed-tests-final.json`。首轮 265/267 的两个过时合同断言已修正并复测。
- 3 个变化的脚本测试文件：`node --test ...` 通过；`contract-fixes` 3/3、`ui-compatibility` 20/20 通过。
- `pnpm run test:social-image-pipeline`：102/102，加 HTTP 集成、工作台及治理合同通过。
- `pnpm run test:assistant`、`pnpm run test:weekly-start-feedback`（69/69）、`pnpm run test:frontend-security` 通过。
- `pnpm run lint`：首轮 6 个错误，最小兼容修复后通过（`typescript-fixed.log`）。
- `ARCHITECTURE_BASE_REF=21a9fb94... pnpm run check:architecture`：3067 个生产 TypeScript 文件及预算棘轮通过；quality 内再次通过。没有放宽预算。
- `MIGRATION_BASE_REF=21a9fb94... pnpm run check:digital-employee-migrations`：207 项、零阻塞，只读检查；quality 中迁移完整性与 checksum guard 同样通过。
- `pnpm run build`：修复后通过，Studio 373232/485000 字节；`pnpm run build:account-hub` 通过。保留 Vite 大 chunk 提醒。
- `git diff --check` 通过；无未解决冲突。后续治理文档不改变受测源码。

**完整验收未通过，不能据此声明发布就绪：**

1. `pnpm run test:video-production-budget` 为 80/93，通过同一命令在原始来源 `453ef28b` 的独立干净源码工作树复现完全相同的 13 项失败（`source-video-budget.log`、`budget-failure-comparison.json`）。失败集中在仍要求旧金额上限/质量门的测试契约，也包括 G5 预占错误预期差异；没有通过放宽断言或改变预算策略消除这些失败。这是来源已有验收缺口，不是本次双亲合并新增差异。
2. `PB_BIN=/Users/julia1/.local/share/lingshu/pocketbase/pocketbase pnpm run quality` 在 `test:gap-v1-release` 的 `scripts/social-operating-release.integration.ts:548` 失败：`a real worker heartbeat must satisfy split-web readiness`，`false !== true`。在精确原始来源独立运行 `node --import tsx scripts/social-operating-release.integration.ts` 复现同一位置与同一断言（`source-worker-readiness.log`）。没有移除或绕过 worker readiness。
3. quality 在失败处停止，后续阶段未整体运行；未运行全仓 verify。前置依赖、容器、运维合同、架构/棘轮、固定产出、迁移、生产治理和生产编排检查已通过；隔离 PocketBase 的测试使用临时测试数据，不是生产迁移。
4. 未运行真实供应商 E2E、生产迁移、推送、部署、发布或付费请求；既有预览未切换。此基线是保留上述已知验收缺口的本地开发源码集成点。

下一步：独立修复来源的预算回归与 worker 集成验收；发布前重跑完整 quality/verify，并按独立授权执行真实链路验收。
