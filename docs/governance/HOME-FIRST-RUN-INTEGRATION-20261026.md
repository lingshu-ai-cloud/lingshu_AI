# 新人首页双卡与导览合并记录（2026-10-26）

- 基线：`baseline/unified-20261026` / `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`，合并前 `7cb757c10c9857ed7c0fbbda2b84396021e6bcd0`，源码快进后 `71c5cecba007b211133d876154198683fd9c33f8`。恢复点 `backup/pre-home-first-run-20261026-7cb757c1`。
- 来源：`/Users/julia1/Documents/ChatGPT/1026灵小枢对话卡片` / `feature/assistant-home-dialogue-20261026` / HEAD `8c7cc7d304ffd268fcd5f20deeabf68fb5f8b10d`。该 HEAD 已是基线祖先；新人功能当时仍未提交。仅选取首页首登、企业资料问答、键盘实景导览及相应设计规范，隔离候选提交为 `71c5cecba007b211133d876154198683fd9c33f8`。来源树的其他脏改动和独立图文线均未迁入。
- 集成方式：在基线 HEAD 隔离候选上逐项移植，保留基线 `ContentCreationHome.tsx` 的企业报告、查询和图片复刻入口；只增加新人状态、两张卡与弹层。`CreationTaskWorkspace.tsx` 只加导览定位标记，不替换较新的日历/任务实现。复用现有 `OnboardingPanel` 和 `completeOnboarding`，没有新增执行器、迁移或后端接口。
- 验证：`pnpm exec tsx --test src/lib/homeFirstRun.test.ts src/components/HomeGrowthTour.test.ts src/components/ContentCreationHome.contract.test.ts`（4/4），`pnpm run lint`（通过），`pnpm run check:architecture`（2957 文件通过），`pnpm run check:digital-employee-migrations`（204 项只读通过），`pnpm run build`（通过，保留大 chunk 警告），`git diff --check`（通过）。未跑全仓 quality/verify 或合并后浏览器操作；不能据此判定真实 E2E 或发布就绪。
- 基线原有 `server/videos/videoVisibilityMaintenance.ts` 未提交排序补丁 SHA-256：合并前后均为 `ed50ec18853d813c6307d1c7dd9ff1c7d020ec37735282d44ea368ff334a289b`。恢复时可回到上述恢复分支重新检视差异；不得直接重置或覆盖该未提交文件。未推送、未部署、未操作运行数据。
