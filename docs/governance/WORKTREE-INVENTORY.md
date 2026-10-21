# Git 工作树盘点（只读快照）

盘点日期：2026-10-21（Asia/Shanghai）
来源：`git worktree list --porcelain`、`git branch -vv`、逐个 `git status --porcelain` 只读检查；未改写各工作树内容。

## 权威集成点

- `/Users/julia1/.codex/worktrees/xixi1021-full-integration` — `xixi1021程永罗沟通前大整合`，盘点时 HEAD `69813195277028455b6cc0a0c675de01d66217d5`；本任务在此工作。
- `/Users/julia1/.codex/worktrees/colleague-handoff-20261019` — `xixi数字员工架构待清理`，HEAD `2d6c5a62d516c6eb5fc83d7dc19c17080aa31d98`；保留为上一稳定基线，不改写。
- `/Users/julia1/.codex/.chatgpt-projects/g-p-6ac46f113a0c8191968cd499b8c020f6/mobile-dual-edition-20261012` — `xixi图片AIGC管线`，HEAD `95b0bcc16820e06fcc16ac75e040a6592abdc692`；有用户未提交改动，作为 AIGC 来源保留且不清理。

## 其余已注册工作树

以下均保留原位。5 个有未提交内容的工作树全部保留；其余有效路径工作树在盘点时干净。干净只表示没有未提交内容，不代表可删除或归档：

- `local-preview-1002` — `codex/integrated-operations-content-20261008`，`0f3bbed6`。
- `local-integrated-flow` — `xixi`，`737484c9`。
- `local-unified-20261010` — `合并后JJ修前端`，`9a4595d9`。
- `safe-all-modules-ui-20261009` — `1009大合并`，`40dba2c0`。
- `worktrees/exact-qwen-no-redirect` — `codex/exact-qwen-no-redirect`，`c0f6b5f0`。
- `worktrees/exact-request-ceiling` — `codex/exact-request-ceiling`，`6604f46b`。
- `worktrees/exact-request-ledger-v2` — `codex/exact-request-ledger-v2`，`0b396e1d`。
- `worktrees/phase3c-v2-carry-seam` — `codex/phase3c-v2-carry-seam`，`59cce0a7`。
- `worktrees/weekly-budget-carry` — `codex/weekly-budget-carry-20261019`，`093a2445`。
- `xixi-test-1015` — `xixi测试服1015`，`d4ec99e4`。
- `worktrees/merge-image-aigc-into-architecture` — `codex/merge-image-aigc-into-architecture`，`2d6c5a62`。
- `worktrees/weekly-exact-head-store` — `codex/weekly-exact-head-store`，`4f927e67`。
- `worktrees/weekly-exact-v2-carry` — `codex/weekly-exact-v2-carry`，`f5e71428`。
- `worktrees/weekly-exact-v2-settlement` — `codex/weekly-exact-v2-settlement`，`11f140b8`。
- `/Users/julia1/Documents/Codex/2026-10-10/d/work/safe-merge-wu-ui` — detached HEAD `62373483`。
- `/Users/julia1/Documents/Codex/2026-10-11/new-chat/work/total-merge-langgraph` — `xixi改数字人认证`，`3eac6674`。

## 工作区状态分类

- 有未提交改动，必须保留：`local-preview-1002`（含代码、运行数据/备份和分析产物）；`local-integrated-flow`（小程序工作台代码/测试）；`local-unified-20261010`（周历 UI 及新工作台模式代码/测试）；`mobile-dual-edition-20261012`（AIGC 来源工作树，含用户文档、日历改动、锁/分析文件和其他未跟踪目录）；`total-merge-langgraph`（数字人策略改动及运行数据/回执）。
- 工作区干净：`safe-all-modules-ui-20261009`、`exact-qwen-no-redirect`、`exact-request-ceiling`、`exact-request-ledger-v2`、`phase3c-v2-carry-seam`、`weekly-budget-carry`、`xixi-test-1015`、`colleague-handoff-20261019`、`merge-image-aigc-into-architecture`、`weekly-exact-head-store`、`weekly-exact-v2-carry`、`weekly-exact-v2-settlement`、当前集成工作树、detached `safe-merge-wu-ui`。
- 两个 `/private/tmp` prunable 项目标不存在，因此未能检查文件状态；注册记录和分支仍保留。
- 除当前集成工作树以外，清理/归档及任何运行数据整理仍需单独授权和逐项备份检查。本盘点没有改动 `.git/worktrees`、分支、运行数据或任何工作区。

## 需人工处置但本次未触碰

- `/private/tmp/lingshu-emphasis-push-20261008` 和 `/private/tmp/lingshu-emphasis-shot-aware-20261008` 在 Git 注册表标记为 `prunable`，gitdir 指向失效位置。需先确认无未备份内容，再单独批准移除注册记录。
- 存在 detached 工作树；应先确认其提交是否已保存到命名分支或是否仍有人依赖。
- 共盘点 21 个注册工作树（含当前集成树）；仅确认三个权威/来源角色。其余逐项分类（合并、候选 cherry-pick、证据、保留或可归档）仍是待办；本次不归档、不删除、不移动分支。
