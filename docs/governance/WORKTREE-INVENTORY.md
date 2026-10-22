# Git 工作树状态盘点

盘点日期：2026-10-22（Asia/Shanghai）
来源：`git worktree list --porcelain`、逐个 `git status --porcelain` 和祖先关系检查。仅移除了两个目标路径已不存在的失效注册记录；未改写有效工作树、分支或运行数据。

## 当前复核（2026-10-22，独立集成检出）

- 当前共有 **9 个**有效注册工作树。`/Users/julia1/.codex/worktrees/xixi1021-governance-baseline` 是 `xixi1021程永罗沟通前大整合` 的独立干净检出；盘点起点本地/远端同为 `1270cfabfb83d51ad88d70f55f1b16e5a98cb7ba`，没有 Git 改动或被忽略文件。本次文档提交后以 `git rev-parse HEAD` 与 `git ls-remote` 重新确认分支指针。
- 原 `/Users/julia1/.codex/worktrees/xixi1021-full-integration` 已由另一任务切到 `feature/platform-ads-meta-workspace-20261022`，盘点时 `849cf0819c2fc2038f3e8cc076afdda1efc7a44d`、Git 工作区干净，但有被忽略的业务/运行数据；**不再是集成检出**，不归档或混入基线。
- 五个有未提交内容的来源树仍是 `local-preview-1002`、`local-integrated-flow`、`local-unified-20261010`、`mobile-dual-edition-20261012`、`total-merge-langgraph`，各含源码或运行数据，全部保留。`safe-all-modules-ui-20261009` 和 `colleague-handoff-20261019` 虽 Git 状态干净，仍有大量被忽略的业务/运行数据，保留不归档。此前移除的 11 个干净树未重新注册。
- 图片 AIGC 来源 HEAD `95b0bcc16820e06fcc16ac75e040a6592abdc692` 及用户列出的 `6e2d2e4ffde42e8240750c950763b0b5dd2859ea` 都是集成分支祖先。来源树未提交的产品代码仍集中在周任务日历改视频进度表及相关测试/演示，不是新的图片 AIGC 管线补丁；来源树的 `AGENTS.md`、文档、分析与视频运行产物也未动。本盘点仅确认已提交 AIGC 源码的祖先关系，**不**宣称来源树已清空或多输出真实供应商链路已验收。

以下旧章节保留当时的审计快照，不再表示当前注册树总数、当前分支或权威检出路径。

## 后续处置更新（2026-10-22）

下文其余章节保留处置前的 19 树历史盘点。用户随后明确选择归档 8 个干净且补丁等价的来源树。再次核验各树无已跟踪/未跟踪改动、相对集成分支 `git cherry` 无正向独有补丁，忽略项仅为可重建的 `node_modules/`。由于这些不是当前任务的 Codex 托管工作树，无法生成 Codex 归档快照；已用 `git worktree remove` 移除 `exact-qwen-no-redirect`、`exact-request-ceiling`、`exact-request-ledger-v2`、`phase3c-v2-carry-seam`、`weekly-budget-carry`、`weekly-exact-head-store`、`weekly-exact-v2-carry`、`weekly-exact-v2-settlement` 的检出目录和注册记录。分支及提交全部保留，可重新检出；依赖目录需重装。现余 11 个有效工作树；5 个含未提交内容的来源树完全未动。

再次按用户的归档选择复核后，另移除 3 个无已跟踪/未跟踪改动、相对集成分支无独有补丁的工作树：`merge-image-aigc-into-architecture`、`xixi-test-1015`、`safe-merge-wu-ui`。后两者的忽略项仅有可重建的 `dist/`、`node_modules/`；detached 的 `safe-merge-wu-ui` 在移除前以 `archive/safe-merge-wu-ui-20261010` 保留 HEAD 引用。现余 8 个有效工作树。`safe-all-modules-ui-20261009` 与 `colleague-handoff-20261019` 虽无 Git 未提交项，但含被忽略的业务/运行数据，未归档；5 个有未提交内容的来源树也未动。以上“移除”仅删除工作树检出目录和其中可重建的构建/依赖缓存，未删除命名分支。

## 图片 AIGC 来源树复核（2026-10-22）

- 集成分支当前 HEAD `0e5a3dc2664340c72fdd0b465bc915d8eb97cbd2` 与同名远端一致、工作区干净；来源树仍在 `95b0bcc16820e06fcc16ac75e040a6592abdc692`，其提交已是集成历史的祖先。
- 来源树当前已跟踪的未提交改动为 `AGENTS.md` 与 `src/components/smartBusiness/RestoredAgentWorkCalendar.tsx`；后者将周任务日历改为视频生产进度表。未跟踪代码含 `VideoProgressTable.tsx` 及其测试；其余未跟踪内容主要是用户文档、分析锁/输出、视频和 UI 截图。此轮未发现新的未提交图片 AIGC 管线代码，但不能因此把整个来源树称为“已清理”。
- 上述日历/视频进度改动与图片管线并非同一功能边界，且包含运行产物；未自动带入集成基线，也未删除、重置或归档来源树。若要合入，须单独验证 UI 需求、对照现行日历工作区并剔除运行数据。

## 权威集成点（历史盘点）

- `/Users/julia1/.codex/worktrees/xixi1021-full-integration` — `xixi1021程永罗沟通前大整合`，盘点时 HEAD `ce1105c21761c9d2d3755ffecd81ffe5ed822646`，远端同 SHA；本任务在此工作。
- `/Users/julia1/.codex/worktrees/colleague-handoff-20261019` — `xixi数字员工架构待清理`，HEAD `2d6c5a62d516c6eb5fc83d7dc19c17080aa31d98`；保留为上一稳定基线，不改写。
- `/Users/julia1/.codex/.chatgpt-projects/g-p-6ac46f113a0c8191968cd499b8c020f6/mobile-dual-edition-20261012` — `xixi图片AIGC管线`，HEAD `95b0bcc16820e06fcc16ac75e040a6592abdc692`；有用户未提交改动，作为 AIGC 来源保留且不清理。

## 其余已注册工作树（历史盘点）

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
