# 灵枢 AI 仓库工作约定

本仓库是中国厂家出海营销 AI Agent，包含前端工作台、Node/TypeScript 服务、持久化任务、队列、社媒/供应商接入和本地预览工具。以当前代码、Git 状态与实际命令输出为事实依据；计划、会议记录和历史 PRD 不是完成证据。

## 当前工作位置与基线

- `docs/governance/BASELINE.md` 记录已确认的集成基线和验证证据；`docs/governance/WORKTREE-INVENTORY.md` 记录工作树处置状态。
- 任何会写入仓库的任务，先确认绝对路径、Git 根目录、分支、HEAD SHA 与工作区是否干净。若这些事实与基线文件冲突，报告冲突并停止基线/合并判断；不得按目录名、时间戳或“最新”字样猜测。
- 源码提交、运行/预览数据、真实供应商 Ready 状态是三种独立状态。源码通过测试不等于真实链路可用，更不等于可上线。
- 基线验收应逐项记录提交 SHA、代码与迁移状态、`git diff --check`、TypeScript、迁移清单只读检查及受影响领域回归；缺项要明示，不能把局部通过写成整体验收。
- `mobile-dual-edition-20261012` 是保留的图片 AIGC 来源工作树，不是默认集成基线；不得清理、重置、归档或把其未提交内容混入当前任务，除非获得明确授权。

## 按任务读取最少必要文档

- 架构边界或大模块重构：`docs/architecture/ARCHITECTURE.md`，以及相关 `docs/architecture/adr/`。
- 真实外部联调或付费供应商：`docs/runbook/EXTERNAL-E2E-READINESS.md`。
- UI/交互：`docs/product/PRD-灵枢AI全系统UI设计规范-v2-2026-10-09.md`。
- 基线推进、工作树整理或跨分支集成：上述 governance 文档。

不要要求每个小改动通读全部 PRD、历史文档或完整 Git 日志。历史材料仅作证据；若它和当前实现或已确认 ADR 矛盾，明确指出，不要静默采用。

## 范围、状态与外部操作

- 一个任务只解决一个明确问题；先复用现有契约、队列、任务状态和错误模型，不复制一条平行主流程。
- 路由/界面负责输入输出和展示；业务规则、外部适配、持久化和队列应保持在各自的现有领域模块中。边界输入先校验并转为明确类型，不把松散对象、隐式默认值或字符串猜测传入业务层。
- 可预期失败必须有稳定状态/错误码和可检索证据。不要吞掉异常、把未知付费结果标记为失败、或用假成功让流程继续。
- 本地预览出现“服务暂时不可用”或任务写入超时，先查后端进程/错误日志、原任务与 `data/local-store/*.json.lock` 的 owner；健康接口 200 不证明持久化写入可用。写锁异常应返回 `local_store_reconciliation_required`，保留原任务和幂等键，按 `scripts/local-store-lock-recovery.md` 只读审计并在唯一写入权确认后恢复；不得删锁、重建任务或盲重试付费调用。详见 `docs/runbook/SOCIAL-IMAGE-PRODUCTION-RECOVERY.md`。
- 真实供应商调用、付费请求、OAuth、发布、生产数据写入、迁移、恢复、部署和任何不可逆外部操作，必须有当前任务的明确授权。缺少账号、资产、配额、预算、回执或唯一写入权时，记录为阻塞；不要靠重试或新增旁路绕过。
- 真实 E2E 只验证已合并的稳定基线。发现问题时记录最小复现和证据，修复在正常开发路径完成后再验收；不要在联调现场扩展架构。
- 代码完成、定向测试通过、集成检查通过、真实 E2E 通过与发布就绪是不同结论；交接时只声明已有证据直接支持的结论。

## 改动、验证与交接

- 保留不属于当前任务的脏改动；不使用 reset、checkout、clean、stash 或覆盖式操作处理它们。
- 代码、测试、依赖、配置、迁移与文档只改本任务必要范围。跨模块重构、删除/归档、分支合并、提交、推送和工作树操作须在执行前说明影响与验证方案。
- 架构预算由 `architecture.config.json` 和 `pnpm run check:architecture` 执行：普通生产 TypeScript 文件上限为 800 行；历史超限文件只能下降，不能增加预算或新增豁免。
- 先运行与改动相称的定向测试，再运行 `pnpm run check:architecture` 和必要的领域测试。仅在基线、发布候选或跨域改动时考虑更大范围的验证，且不得运行会触发全量 TypeScript 检查的脚本。
- 本仓库禁止运行 TypeScript 全量检查（包括 `pnpm run lint`、全仓 `tsc --noEmit`，以及会间接触发它们的脚本）；只运行与任务相称的定向测试和不含全量 TypeScript 检查的专项验证。即使基线或发布候选验收也不得自行解除此限制，必须如实报告未进行全量类型检查。
- 报告实际执行的命令和结果。不要将“未运行”“局部通过”“构建通过”写成真实 E2E、供应商验收或发布就绪。
- 基线真正推进后，再更新 `docs/governance/BASELINE.md`：分支、SHA、验证命令、已知限制与下一步。影响多个阶段的架构/产品决定写入一个 ADR；外部操作步骤写入 runbook。
- 交接至少包含：改动文件、当前 SHA、实际验证、外部 run/task 标识（如有）、已知阻塞、未决问题和安全恢复点。

## Frontend design policy

- Every frontend change must follow `docs/product/PRD-灵枢AI全系统UI设计规范-v2-2026-10-09.md` as the sole product design authority, including motion, transitions, typography, accessibility, and component behavior. Reuse the shared theme, design tokens, and UI components; historical design documents are reference only.
- If the product design specification does not cover a component or interaction, consult the official Ant Design documentation at `https://ant.design/components/overview-cn/` and its design guidance before implementation. Adapt the official pattern to the product tokens and document reusable decisions in the specification.
- Current visual baseline: pure-white page surfaces, black/neutral body text, neutral sidebar navigation, blue–violet gradients for primary actions and outgoing conversation bubbles, and coordinated colored highlights/charts. Keep success, warning, error, and platform-logo semantics distinct.
- Do not introduce page-specific palettes or a parallel component system when the existing shared components or Ant Design cover the need.

## Deployment policy

- This repository is development-only unless the user explicitly requests deployment in the current task.
- Do not deploy, publish, release, promote, update production, or trigger a deployment workflow by default.
- Building, testing, committing, merging, and pushing are not deployment authorization.
- Before pushing to a branch that may auto-deploy, verify whether the push triggers deployment. If it may, stop and ask the user first.
- Do not run production migrations, production restores, production container pushes, or production infrastructure commands without explicit current-task authorization.
- Do not modify or bypass the global deployment guard for ordinary development.
- Local commands such as `npm test`, `npm run build`, and development servers are allowed and are not deployments.

## Repository baseline and session handoff

- The shared integration baseline and latest verification checkpoint are recorded in `docs/governance/BASELINE.md`; update it when advancing the branch.
- `mobile-dual-edition-20261012` is an experimental image-AIGC worktree, not the canonical integration checkout; it may contain valuable uncommitted work and must not be cleaned, reset, or archived without explicit review.
- Keep source baseline, preview/runtime data, and real-provider readiness as separate states. A source commit does not establish a runtime or provider baseline.
- Update `docs/governance/BASELINE.md` when the integration baseline moves. Do not infer a new baseline from recency alone.

## Canonical deployment path

- When the user explicitly requests deployment, use only an interactive SSH terminal to the existing Ubuntu server, then update the existing server checkout over GitHub HTTPS, and run `bash deploy/update.sh` from that checkout.
- Do not use CloudBase, a GitHub Actions deployment, GHCR/release-image deployment, `deploy/release.sh`, PM2, `scp`, `rsync`, or another deployment path unless the user explicitly overrides this rule in the current task.
- The canonical Git remote is `https://github.com/lingshu-ai-cloud/lingshu_AI.git`. Verify the server checkout's `origin`, branch, cleanliness, and divergence before pulling. Do not stash, reset, overwrite, or silently deploy an older revision.
- Use an interactive PTY and `git pull --ff-only`. Disable credential caching for the pull and pause at GitHub's credential prompt so the user can type the GitHub username and personal access token in the SSH terminal. GitHub's `Password` prompt requires a personal access token, not the account password.
- Never ask the user to paste a GitHub credential into chat, put a credential in a command or URL, echo it, save it, or cache it. Do not continue through an alternate path if interactive authentication is unavailable.
- On failure, preserve the current state, identify the first failing command and its specific log evidence, fix that cause, and resume from the failed checkpoint. Do not restart the whole procedure or revisit a previously failed path unless its blocking condition changed.
- A deployment is complete only after reporting the deployed commit, `docker compose` service state, and the exact `/api/overseas/ready` result.
