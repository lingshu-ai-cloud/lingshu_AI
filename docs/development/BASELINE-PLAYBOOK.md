# Integration baseline playbook

## Single source of truth

The canonical integration checkout is `mobile-dual-edition-20261012` on `xixi数字员工联调v3`. A different worktree is never promoted by file modification time. Promotion requires an explicit merge or cherry-pick into this branch followed by the acceptance gate below.

## Write lease

Every active development chat receives one bounded file set. Paid provider operations, database or migration writes, and golden-package execution use a separate exclusive runtime lease. The baseline owner records both leases before work starts. Overlapping work stops at the next atomic boundary and hands off; it does not continue based on assumed compatibility.

## Required handoff

1. Objective and invariant being protected.
2. Exact files changed.
3. External provider calls and durable run, task, package, operation, and receipt identifiers.
4. Last passing tests and the full failing command.
5. Current persisted state and safe resume point.
6. `node scripts/workspace-baseline-report.mjs` output.

## Promotion sequence

1. Freeze writers and collect handoffs.
2. Separate source, migrations, generated artifacts, runtime data, and credentials.
3. Run `git diff --check` and the TypeScript check.
4. Run migration checksum/preflight and domain recovery tests.
5. Review the staged file list; never use a broad `git add .` on the integration worktree.
6. Create a local checkpoint commit with the verified evidence in its message or accompanying handoff.
7. Re-run the gate from the commit. Only then may the commit be called a baseline candidate.
8. Pushing and deployment remain separate operations and require their own authorization and safeguards.

## Rollback rule

Rollback targets a named checkpoint commit and preserves runtime evidence. Do not use destructive reset or checkout against a dirty shared worktree. First create a recoverable snapshot or move the affected work into an isolated worktree, then perform a reviewed revert or forward fix.
