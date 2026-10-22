# Git 工作树状态盘点

最近盘点：2026-10-23（Asia/Shanghai）；下方旧章节保留当时的历史快照。
来源：`git worktree list --porcelain`、逐个 `git status --porcelain` 和祖先关系检查。本次只读复核未改写工作树、分支或运行数据；历史移除记录见下文。

## 2026-10-23 集成点 `ad4bf42e` 图片来源与归档复核

- 只读检查时集成树 `xixi1021-governance-baseline` 为 `ad4bf42ea4636b93f17662c5c0bf5e0e35a93b38`，工作区干净；该点位不是永久 HEAD。共 11 个有效注册工作树。6 个非集成树仍有未提交项：`local-preview-1002` 53、`local-integrated-flow` 91、`local-unified-20261010` 6、`mobile-dual-edition-20261012` 28、`客服` 1、`total-merge-langgraph` 20；计数是 `git status --porcelain` 条目，未触碰这些树。
- 4 个干净非集成树仍不可安全归档：`safe-all-modules-ui-20261009` 与 `colleague-handoff-20261019` 含被忽略的业务媒体／账本数据；广告树 `xixi1021-full-integration` 的 `20441982` 相对集成点有 14 个正向独有补丁及被忽略的账号、任务和审计数据；`1022图片生成模块` 的 `23b1bb93` 有 1 个非等价独有补丁，忽略项仅为可重建依赖缓存。没有满足“干净、无独有补丁、无不可丢失忽略数据”的新归档候选。
- 原 AIGC 提交 `6e2d2e4f`、来源 HEAD `95b0bcc1` 及新图片补丁的父提交 `8d4c6d46` 均是当前集成祖先；原来源树未提交的日历／视频进度代码和运行数据仍保留。新图片补丁的确定性图层／蒙版能力在集成代码中存在，且集成实现额外保留蓝图归一化、前景遮挡校验及颜色校验；其余自动 GPT 降级会替换用户要求暂留的 Qwen→Gemini 行为，且没有生产可用的逐记录许可，不整笔 cherry-pick，也不归档来源树。
- 本点位 `pnpm run test:social-image-pipeline` 与 `pnpm run test:video-source-boundaries`（75/75）通过；这些是离线源码回归，不证明真实付费供应商、目标共享卷、部署或浏览器端验收。本次未清理、归档、重置或合并其他工作树。后续需要先完成付费许可和来源差异的独立评审，或取得对剩余 GPT 路由行为的明确新决定。

## 2026-10-23 集成点 `481cfef6` 后复核

- Git 仍登记 11 个有效工作树。集成树在本次只读复核开始时本地/远端同为 `481cfef675c58be458d7791390e8a141f6b4a6cc`，工作区干净；此点位不是永久 HEAD。6 个非集成树仍有未提交源码、文档或运行项：`local-preview-1002`、`local-integrated-flow`、`local-unified-20261010`、`mobile-dual-edition-20261012`、`客服`、`total-merge-langgraph`，均未移动。
- 4 个干净非集成树中，`safe-all-modules-ui-20261009` 和 `colleague-handoff-20261019` 含被忽略的业务媒体/运行数据；广告树 `xixi1021-full-integration` 已前进至 `20441982`，相对集成点有 15 个独有提交且含广告审计与运行数据；`1022图片生成模块` 的 `23b1bb93` 仍有 1 个非等价独有补丁，仅有可重建依赖缓存并不足以归档。故本轮没有符合“干净、无独有补丁、无不可丢失忽略数据”条件的新归档候选。
- 原图片 AIGC 来源 `95b0bcc1` 仍是集成祖先；新图片分支 `23b1bb93` 的剩余自动 GPT 降级会改变用户要求暂留的 Qwen→Gemini 行为，且未满足逐记录付费许可，不整笔合入。上述判断只覆盖已提交补丁；来源树未提交的日历/视频进度代码继续保留，不当作已合并。

## 2026-10-23 图片 AIGC 与归档条件复核

- 当前仍有 11 个有效工作树。集成树在复核点 `d837f94f574ad60adbb3ac23e47eea5a4a07445b` 与同名远端一致，Git 状态干净；该 SHA 不是永久 HEAD。6 个非集成树仍有未提交项：`local-preview-1002` 53、`local-integrated-flow` 91、`local-unified-20261010` 6、`mobile-dual-edition-20261012` 28、`客服` 1、`total-merge-langgraph` 20。计数按 `git status --porcelain` 条目，不代表独立文件数；全部保留。
- 4 个干净的非集成树中，`safe-all-modules-ui-20261009`、`colleague-handoff-20261019` 有被忽略的业务媒体/账本数据；广告树 `xixi1021-full-integration` 还有独有补丁与被忽略的账号、任务及审计数据；`1022图片生成模块` 的 `23b1bb93` 是独有补丁。四者均不满足“补丁等价且只有可重建缓存”的安全归档条件，本轮未归档、重置或移动任何工作树。
- 原 `xixi图片AIGC管线` HEAD `95b0bcc16820e06fcc16ac75e040a6592abdc692` 是集成 HEAD 的祖先；其未提交源码仍是日历/视频进度 UI，不是新的图片管线补丁。`23b1bb93` 的确定性图层/蒙版部分已选择性合入；剩余自动 GPT 路由会替换用户要求暂留的 Qwen→Gemini 行为，且原补丁没有逐记录付费批准、预算认领、回执及结果不明恢复，不能整笔 cherry-pick。
- 当前集成代码的图片专项 55/55、隔离 HTTP 1/1、路由/工作台合同和隔离 GIF 浏览器流程通过；TypeScript、架构扫描、192 项迁移文件只读检查与生产构建通过。GIF 浏览器测试零写入；没有真实付费供应商、目标库迁移或部署验收。已提交源码覆盖不等于其他来源树可删除，也不等于付费 GPT 自动复核可用。

## 2026-10-22 集成提交 `ed83980d` 后只读复核

- 注册工作树仍为 **11 个**，集成树 `xixi1021-governance-baseline` 本地/远端同为 `ed83980d691677a160f201760a5f3153ea3f5617`，复核时工作区干净。该 SHA 是本次盘点点位，不是永久 HEAD。
- 6 个有未提交项的来源树按普通 `git status --porcelain` 计数：`local-preview-1002` 53、`local-integrated-flow` 91、`local-unified-20261010` 6、`mobile-dual-edition-20261012` 28、`total-merge-langgraph` 20、`客服` 1。计数中的未跟踪目录按 Git 默认汇总，不代表文件数；这些树均不整理、不合并未提交内容。
- 其余非集成检出中，`safe-all-modules-ui-20261009`、`colleague-handoff-20261019`、独立广告树 `xixi1021-full-integration` 与 `1022图片生成模块` 的 Git 状态干净。前三者存在被忽略的业务/审计或运行数据，不能按“仅可重建缓存”条件移除；图片模块的 `23b1bb93` 仍为相对集成分支的非等价补丁，保留原位。没有新增可安全归档候选。
- `23b1bb93` 的确定性图层/蒙版部分已选择性合入；剩余 Qwen 失败后转 GPT 的路由补丁既会改变用户明确要求暂留的 Gemini 降级行为，也缺少当前基线要求的逐任务付费认领、原始回执与结果不明恢复，不直接 cherry-pick。保留来源分支不等于该付费功能已合入。

## 2026-10-22 新增工作树后的只读复核

- 新图片模块树 `/Users/julia1/Documents/ChatGPT/1022图片生成模块` 已形成干净提交 `23b1bb93f18d0780b2cc668d7e3057531ab17789`。该提交相对集成基线有独有补丁；本轮只选择性接入参考图层/蒙版的确定性部分，自动 GPT 付费降级因缺少持久化许可与未知结果恢复仍未接入。因此此树不符合“无独有补丁”归档条件，保留原位。此前获授权且满足条件的干净工作树已按下文“后续处置更新”移除；其余含忽略业务数据或未提交内容的树未动。

- 当前注册工作树已由此前的 9 个增加到 **11 个**；本批起点集成分支为 `5c600cb96a618cda9ca67921620ee88eff9e3bb0`，工作区当时干净。新增 `/Users/julia1/Documents/ChatGPT/1022图片生成模块`（有未提交图片生成源码与测试）及 `/Users/julia1/Documents/ChatGPT/客服`（有未跟踪审计文档/证据）。二者可能由其他任务使用，未擅自归档、重置或混入本轮基线。
- 原图片 AIGC 提交 `6e2d2e4ffde42e8240750c950763b0b5dd2859ea` 与来源 HEAD `95b0bcc16820e06fcc16ac75e040a6592abdc692` 均仍是当前集成分支祖先，已提交管线不是待 cherry-pick 的新补丁。旧来源树仍含未提交日历/视频进度代码与运行数据；新图片模块树则有另一批未提交图层/生成改动，均未据祖先关系推断已合入。
- `xixi1021-full-integration` 广告工作树的 Git 状态现为干净，但有被忽略的广告审计图与运行数据；`safe-all-modules-ui-20261009`、`colleague-handoff-20261019` 亦含被忽略业务/媒体数据。没有新增可安全移除的“仅可重建缓存”工作树。原五个有未提交项的来源树继续保留。下文 9 树章节为历史快照，不再代表当前总数。

## 2026-10-22 后续只读复核

- 仍为 9 个有效注册工作树。集成检出保持 `xixi1021程永罗沟通前大整合`，本轮起点本地/远端同为 `cec714abad4b3115f44530e2af8550adf3d4d1ab` 且工作区干净；提交后须再次以 Git 命令核对新 HEAD。
- 原 `xixi1021-full-integration` 现位于独立广告分支 `feature/platform-ads-meta-workspace-20261022`，HEAD 已前进至 `38e780e5`，`server/platformAds/README.md`、`oauth.test.ts`、`oauth.ts` 有未提交改动，并含被忽略的业务/运行数据。与先前“干净”快照不同，**不得归档、重置或并入本轮基线**。
- 其余有未提交项的来源树仍为 `local-preview-1002`（53 项）、`local-integrated-flow`（91 项）、`local-unified-20261010`（6 项）、`mobile-dual-edition-20261012`（28 项）、`total-merge-langgraph`（20 项）；数量只反映当前 `git status --porcelain` 条目，不代表可删除。`safe-all-modules-ui-20261009` 与 `colleague-handoff-20261019` 的 Git 状态虽干净，仍有被忽略的业务/运行数据，继续保留。没有新增符合“干净、补丁等价且仅含可重建忽略项”的归档候选。
- 图片 AIGC 来源树仍在 `95b0bcc1`；此前已确认其已提交图片管线是集成祖先。此轮仅复核工作树状态，没有触碰来源树的未提交视频/日历代码、分析文件或业务数据，也没有进行真实供应商调用。

## 当前复核（2026-10-22，独立集成检出）

- 当前共有 **9 个**有效注册工作树。`/Users/julia1/.codex/worktrees/xixi1021-governance-baseline` 是 `xixi1021程永罗沟通前大整合` 的独立集成检出；2026-10-22 本批修改前本地/远端同为 `18e233c831655c0ec2b3b1365a9f76309dbc28ce`，Git 工作区干净。提交后须重新执行 `git rev-parse HEAD`、`git status --porcelain` 与 `git ls-remote`，不能把盘点起点当作最新指针。
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
