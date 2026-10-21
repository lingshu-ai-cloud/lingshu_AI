# Git 工作树状态盘点

盘点日期：2026-10-22（Asia/Shanghai）
来源：`git worktree list --porcelain`、逐个 `git status --porcelain` 和祖先关系检查。仅移除了两个目标路径已不存在的失效注册记录；未改写有效工作树、分支或运行数据。

## 权威集成点

- `/Users/julia1/.codex/worktrees/xixi1021-full-integration` — `xixi1021程永罗沟通前大整合`，盘点时 HEAD `ce1105c21761c9d2d3755ffecd81ffe5ed822646`，远端同 SHA；本任务在此工作。
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
- 与集成 HEAD 存在独有提交的干净候选工作树：`exact-qwen-no-redirect`（1）、`exact-request-ceiling`（1）、`exact-request-ledger-v2`（2）、`phase3c-v2-carry-seam`（2）、`weekly-budget-carry`（2）、`weekly-exact-head-store`（1）、`weekly-exact-v2-carry`（2）、`weekly-exact-v2-settlement`（1）。括号是 `git rev-list --count 集成分支..候选分支`，不代表这些提交应自动合入；需逐个审阅补丁和业务归属。
- 对上述 8 个候选的提交标题与补丁范围做了只读审阅：它们集中在 Qwen exact 请求限制、每周内容费用账本/托管/结算及动态 head 存储，不属于本轮图片 AIGC 多输出合并。尤其 `weekly-exact-head-store` 包含新的 PocketBase migration 和校验和清单，不能作为工作树清理的附带动作直接合入。
- 其他有效工作树 HEAD 均是集成 HEAD 祖先；但五个有未提交改动的来源树不能以祖先关系判定为可清理。其余干净祖先树可以进入归档评估，仍需检查忽略文件和持有者用途。
- 除当前集成工作树以外，清理/归档及任何运行数据整理仍需逐项备份与用途检查。本盘点没有删除任何有效工作树、分支或运行数据。

## 失效注册记录与后续处置

- `/private/tmp/lingshu-emphasis-push-20261008` 和 `/private/tmp/lingshu-emphasis-shot-aware-20261008` 的目标路径不存在；经 `git worktree prune --dry-run --verbose --expire now` 精确确认后，已清理这两条失效的 Git 注册记录。对应命名分支仍保留，未删除实际目录或文件。
- 存在 detached 工作树；应先确认其提交是否已保存到命名分支或是否仍有人依赖。
- 当前有 19 个有效注册工作树（含集成树）；5 个脏来源树保留，8 个独有提交候选待审，6 个干净祖先树（含集成树）可逐项评估。没有将来源树的未提交内容当作已合并成果。
