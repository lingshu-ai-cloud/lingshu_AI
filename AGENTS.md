# Repository working agreements

## Workspace coordination and baseline ownership

- The canonical integration worktree, branch, exact commit SHA, phase, and owner are recorded only in `harness/CURRENT_BASELINE.md`. Do not infer a baseline from timestamps, directory names, a chat title, or a branch name. If that record is stale, ambiguous, or conflicts with the live repository, stop and report the conflict.
- Before any write, report and verify: absolute worktree path, Git root, current branch, HEAD SHA, clean/dirty status, upstream relationship, active phase file, and file-scope ownership.
- The integration worktree is for verification and approved merges, not ordinary feature development. Create one registered feature worktree per approved phase; do not develop directly in integration.
- Only one chat may own real provider calls, paid-operation writes, migrations, golden-package state, or run/task/shot mutations at a time. Read-only audits and tests may run concurrently.
- Before editing, declare the exact file set and confirm it does not overlap another active chat. Do not broaden the file set without approval from the integration owner.
- Do not switch branches, create commits, push, reset, checkout, stash, or alter another worktree while shared integration work is active unless the baseline owner explicitly assigns that operation.
- A handoff must report: files changed, live processes and external run identifiers, last passing and failing commands, persisted business state, unresolved decisions, and the exact safe resume point.

## Governance sources and task order

Read only the minimum sources needed for the task, in this order:

1. `harness/CURRENT_BASELINE.md` — live integration identity and known blockers.
2. Applicable `harness/build/phase-*.md` — this task's approved scope, non-goals, and acceptance gate.
3. `docs/product/PRODUCT_BASELINE.md` — currently effective product rules.
4. `PLANS.md` and `GOALS.md` — roadmap, outcomes, and non-goals.
5. `docs/governance/DOCUMENT_AUTHORITY.md` — document ownership and historical-reference rules.

Historical PRDs, discussion notes, handoff documents, and `混合架构点.md` are evidence and context unless explicitly promoted by `PRODUCT_BASELINE.md` or a phase file. Do not silently treat a historical document as a newer requirement.

- One approved need equals one phase, one feature branch, and one registered worktree.
- Do not create a parallel workflow, asset library, budget ledger, approval system, or execution path when an existing one can be extended.
- Product-rule conflicts, missing external prerequisites, baseline ambiguity, and file-scope conflicts are stop conditions, not invitations to guess or broaden scope.
- Completing code, passing a focused test, passing integration, completing a real E2E run, and being release-ready are distinct claims. State exactly which claim evidence supports.

## Baseline acceptance gate

- A reproducible baseline requires a named commit, a clean code-and-migration status, `git diff --check`, a passing TypeScript check, migration checksum/preflight verification, and the targeted recovery tests for the changed domain.
- Runtime data, locks, downloaded media, credentials, local environment files, generated artifacts, and provider receipts are never committed as source baseline. Record their hashes or durable identifiers in the handoff instead.
- Do not call a dirty worktree, an uncommitted snapshot, a passing narrow test, or a live local runtime a release candidate.
- Before handing work back, run `node scripts/workspace-baseline-report.mjs` and include its JSON output. A nonzero exit is an explicit handoff blocker, not permission to bypass the gate.

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

## Canonical deployment path

- When the user explicitly requests deployment, use only an interactive SSH terminal to the existing Ubuntu server, then update the existing server checkout over GitHub HTTPS, and run `bash deploy/update.sh` from that checkout.
- Do not use CloudBase, a GitHub Actions deployment, GHCR/release-image deployment, `deploy/release.sh`, PM2, `scp`, `rsync`, or another deployment path unless the user explicitly overrides this rule in the current task.
- The canonical Git remote is `https://github.com/lingshu-ai-cloud/lingshu_AI.git`. Verify the server checkout's `origin`, branch, cleanliness, and divergence before pulling. Do not stash, reset, overwrite, or silently deploy an older revision.
- Use an interactive PTY and `git pull --ff-only`. Disable credential caching for the pull and pause at GitHub's credential prompt so the user can type the GitHub username and personal access token in the SSH terminal. GitHub's `Password` prompt requires a personal access token, not the account password.
- Never ask the user to paste a GitHub credential into chat, put a credential in a command or URL, echo it, save it, or cache it. Do not continue through an alternate path if interactive authentication is unavailable.
- On failure, preserve the current state, identify the first failing command and its specific log evidence, fix that cause, and resume from the failed checkpoint. Do not restart the whole procedure or revisit a previously failed path unless its blocking condition changed.
- A deployment is complete only after reporting the deployed commit, `docker compose` service state, and the exact `/api/overseas/ready` result.
