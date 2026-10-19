# Repository working agreements

## Workspace coordination and baseline ownership

- The canonical integration worktree is this checkout: `mobile-dual-edition-20261012`, on branch `xixi数字员工联调v3`. Other worktrees and branches are evidence or isolated development inputs, not a newer baseline merely because their files have a later timestamp.
- The chat titled `定位最新工作区代码` is the baseline owner. When it issues a freeze, checkpoint, file-scope assignment, or handoff request, finish only the current atomic write and comply before starting another change.
- Only one chat may own real provider calls, paid-operation writes, migrations, golden-package state, or run/task/shot mutations at a time. Read-only audits and tests may run concurrently.
- Before editing, declare the exact file set and confirm it does not overlap another active chat. Do not broaden the file set without handing the lease back to the baseline owner.
- Do not switch branches, create commits, push, reset, checkout, stash, or alter another worktree while shared integration work is active unless the baseline owner explicitly assigns that operation.
- A handoff must report: files changed, live processes and external run identifiers, last passing and failing commands, persisted business state, unresolved decisions, and the exact safe resume point.

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
