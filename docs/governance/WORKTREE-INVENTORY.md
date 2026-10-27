# Git 工作树状态盘点

## 2026-10-27 智能问数版本安全集成

- 新建本聊天隔离候选 `/Users/julia1/Documents/ChatGPT/基线管理/analytics-safe-20261027` / `integration/analytics-safe-20261027`，以 `1f0ca7e3` 合入远端 `节节智能问数待优化` / `cdfbab8d`，源码合并 `ce83f310`。候选树保留；仅软链依赖，未复制业务数据库或凭据。
- 权威工作树及基线分支不变；原 26 项已跟踪改动和 15 个未跟踪文件保留。恢复分支 `backup/pre-analytics-20261027-1f0ca7e3`；无推送、部署、迁移或其他工作树清理。详见 [合并记录](ANALYTICS-INTEGRATION-20261027.md)。

最近盘点：2026-10-24（Asia/Shanghai）；下方旧章节保留当时的历史快照。
来源：`git worktree list --porcelain`、对应工作树的 `git status --porcelain` 和祖先关系检查。以下按时间记录专项隔离及历史归档；未重新逐项复核的旧状态不视为当前状态。

## 2026-10-26 企业知识库合入最新基线

本节后续：用户仅确认补入助手业务场景与多平台改写承接。新增隔离树 `/Users/julia1/.codex/worktrees/assistant-scenes-final-20261026` / `integration/assistant-scenes-final-20261026`，从072c343b合入ca40301f，源码58e10313。默认基线与本地版本分支快进至最终治理检查点；原视频排序未提交补丁哈希保留，来源功能树不动。干净候选保留作同版本复核，没有推送、部署、归档或运行数据迁移。见[最终本地合并记录](ASSISTANT-SCENES-FINAL-INTEGRATION-20261026.md)。

- 新增隔离树 `/Users/julia1/.codex/worktrees/enterprise-knowledge-integrated-20261026`，分支 `差图文创作加联调`，从a0d965ae合入企业知识库969665d7，源码ddd14683。该树仅软链已安装依赖，不迁入业务数据和凭据。
- 统一基线仅快进至集成结果，原视频排序未提交补丁保留；原企业知识库功能树969665d7保留。没有清理、重置或归档其他工作树，没有推送或部署。详见[整合记录](ENTERPRISE-KNOWLEDGE-INTEGRATION-20261026.md)。

## 2026-10-26 口播核心卖点安全合入

- 新增本聊天隔离候选 `product-highlight-safe-merge-20261026/1025灵小枢外部信息`，分支 `integration/product-highlight-safe-20261026`，从321f6dcc迁入卖点必要文件并验证，源码提交e61c3b68。原已附加的assistant-scene-capabilities工作树有未提交内容，不复用、不清理。
- 权威统一基线安全快进，原videoVisibilityMaintenance.ts未提交补丁前后不变；来源1025灵小枢外部信息的HEAD、index及16项未提交条目逐字保留。未操作保留的图片AIGC树。
- 恢复点与验证见 [安全合入记录](PRODUCT-HIGHLIGHT-INTEGRATION-20261026.md)。未同步业务数据库或既有预览，未推送部署。

## 2026-10-26 首页卡片收尾纳入小程序基线

- 复用托管隔离树assistant-home-integrated，源本会话3项未提交改动固定为4253dc2e；基于较新117933ac合并得到f4a95242，目标baseline/unified-20261026安全快进，原视频排序补丁哈希不变，未清理或覆盖源工作树。
- 本轮仅首页标题和删卡、测试与规范；其余本会话旧来源提交已包含，保留旧工作树不重复合并。独立图文分支新907e74d1及12项队列改动仍是另一会话开发现场，未纳入本轮。未推送或部署。
- 证据和检查见[收尾记录](HOME-CARD-FINAL-INTEGRATION-20261026.md)，恢复点117933ac保留。

## 2026-10-26 小程序功能合入统一基线（仅本轮关联树）

- 来源 `/Users/julia1/Documents/ChatGPT/1026小程序` / `feature/miniapp-fixes-20261026` 固定为 `64ba79a49de8a09ff3647d475c5cab515ba20869`，源码提交后干净；忽略的本地预览服务、数据和图片不迁入基线。
- 新建受管隔离候选 `/Users/julia1/.codex/worktrees/miniapp-baseline-integration/1026小程序` / `integration/miniapp-baseline-20261026`，以 `353879221169176cb26d97391ad6f4dc7367a9f3` 为起点，源码合并 `5f6e09f4fda1db8306cc07f3d3c4dd909c88ee03`；验证及治理提交后保留候选。
- 权威基线仍为 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026` / `baseline/unified-20261026`。仅在验证通过且旧指针未变化时快进；原视频排序脏改动逐字保留。恢复点 `backup/pre-miniapp-integration-20261026-35387922`。
- 本轮未清理、重置、归档其他工作树，未触碰保留的图片AIGC树；未复制运行数据、推送或部署。详见 [本次合入记录](MINIAPP-INTEGRATION-20261026.md)。

## 2026-10-26 灵小枢首页分叉整合

- 新增托管隔离树 `assistant-home-integrated/1026对话界面外部信息`，分支`integration/assistant-home-unified-20261026`，验证源码38d135f1。统一基线由86d855e1安全快进，恢复分支保留；源码与治理提交分开。
- 资讯、查询条件、图文来源分别固定独立index快照2ae05809、f46166be、182abf08，源HEAD/index/未提交内容未改。场景分支a3b66751全部6项提交合入；旧首页137项保留现场已在580913fe快照中，不重复整合。没有清理、归档、重置任何来源树，保留图片AIGC工作树未触碰。
- 共享基线原未提交视频排序修复原样保留，不纳入本轮提交；快进前后完整diff哈希一致。基线源码验收不等于工作树干净、运行数据或供应商Ready。
- quality既有M1受控测试失败在原86d855e1也复现，单列遗留；其他阶段分段验证通过。没有推送或部署。详见[首页整合记录](ASSISTANT-HOME-INTEGRATION-20261026.md)。

## 2026-10-26 两条分叉线统一为最新开发基线

- 新增隔离工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`，分支 `baseline/unified-20261026`，源码合并 `280b54973be6a8cf863cdef98183cf12fa88581f`，治理补记另记；这是本轮用户指定的后续默认开发基线。
- 从首页线 ff43ca61 合入图文线 7f8bd61c；两个来源及别名 xixi投流+卡片前端 的指针均保留。原 server/index.ts 文件与完整 diff 哈希一致，未切换、清理或重置原树。
- 仅软链复用已安装依赖，没有复制真实运行数据库/账号/素材。候选树新生成的未跟踪 finalization 测试缓存保全至本轮证据目录。
- quality 各阶段分段验证、图文管线与隔离浏览器通过，见 [统一基线记录](UNIFIED-BASELINE-20261026.md)。未推送/部署；以下各条为历史记录。

## 2026-10-26 灵小枢功能合入指定本地基线

- 指定目标 `xixi投流+卡片前端`，由新建隔离树 `home-cards-integration-20261026/1026灵小枢对话卡片` 承载；从 `8c7cc7d3` 快进至本轮验证源码及治理提交。
- 来源 `1026灵小枢对话卡片` / `feature/assistant-home-dialogue-20261026` 保留原 HEAD、index 与 137 项未提交条目；独立 index 快照分支 `codex/home-cards-source-20261026`。
- `xixi联合功能模块后端改` 及其脏改动未变；其他功能树与保留的图片 AIGC 工作树未同步/清理/归档。
- 恢复点、SHA、分段质量检查与限制见[集成记录](HOME-CARDS-INTEGRATION-20261026.md)。本轮仅本地，无推送/部署。

## 2026-10-26 图文爆款复刻合入与冒烟准备

- 功能树 `/Users/julia1/Documents/ChatGPT/1026图文创作版本` / `feature/image-text-viral-creation-20261026` 冻结为 `31dced92`，24 个本轮文件，提交后干净；不包含凭据、运行库或媒体文件。
- 复用干净候选树 `frontend-v2-safe-integration-20261025`，创建 `integration/image-text-smoke-20261026`，以 `6cbfd81b` 合并功能提交并完成定向、图文管线、浏览器、类型、架构、迁移只读及双端构建检查。原 `integration/cards-ads-20261025` 分支保留。
- 权威基线 `xixi-feature-integration-20261023` / `xixi联合功能模块后端改` 从 `8c7cc7d3` 安全快进；原 `server/index.ts` 未提交修改哈希前后一致。恢复分支 `backup/pre-image-text-smoke-20261026-8c7cc7d3` 保留，治理补记单独提交。
- 本轮没有清理、重置、归档或同步其他功能树，没有重启其服务或复制其运行数据库。真实冒烟的 5 元预算已确认，但供应商、存储及素材字节/授权准入未齐，未产生真实付费请求。

## 2026-10-25 卡片与投流合入本地基线

- 权威树 `xixi-feature-integration-20261023` / `xixi联合功能模块后端改` 从 `5f0b47a6` 推进至验证源码 `9be85a78`，治理提交另记；原 `server/index.ts` 未提交修改逐字保留。
- 复用干净候选树 `frontend-v2-safe-integration-20261025`，创建 `integration/cards-ads-20261025`；卡片 `f2ea282c` 与投流快照 `e130395e` 均成为合并祖先。
- `1025投流` / `feature/platform-ads-20261025` 保持原 HEAD `dfc9b0c8` 和全部原 index/未提交源码；独立 index 快照后完整 tree/status 核验一致，未清理、重置、切分支或暂存原树。其他功能树和预览未同步/重启/清理。
- 基线恢复分支 `backup/pre-cards-ads-20261025-5f0b47a6`，投流快照分支 `snapshot/platform-ads-20261025-for-baseline`，私有证据 `~/.codex/integration-evidence/20261025-cards-ads/`。详见[本轮报告](CARDS-ADS-INTEGRATION-20261025.md)。未推送或部署。

## 2026-10-25 服务器上传分支安全快进

- 权威工作树 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`、分支 `xixi联合功能模块后端改` 从 `b97265dc` 快进至 `181868f3f9bad2ff437f124018e9decf5ababb59`，后续仅本机治理记录。原 `server/index.ts` 未提交资源 404 修复完整保留，快进前后文件/补丁哈希一致。
- 本聊天复用已干净的 `/Users/julia1/.codex/worktrees/frontend-v2-safe-integration-20261025`，切到 `integration/server-upload-20261025` 固定来源验证；原 `integration/frontend-v2-20261025` 分支仍保留。没有新增工作树，没有复制业务或预览数据库；只复用已安装依赖软链。
- 恢复分支 `backup/pre-server-upload-20261025-b97265dc`。本机证据 `/Users/julia1/.codex/integration-evidence/20261025-server-upload-181868f3/` 保存原补丁、哈希及验证/浏览器记录；临时 53379 验收 Vite 已停止。
- 其他树未重新盘点、切换、清理、重置或归档。未推送、部署、目标库迁移或真实供应商调用。详见[本轮合入记录](SERVER-UPLOAD-INTEGRATION-20261025.md)。

## 2026-10-25 助手功能合入本地基线

- 权威工作树 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`、分支 `xixi联合功能模块后端改` 从7801dd0f快进至源码59d3fc06，后续单独提交治理记录。原server/index.ts未提交修复及其哈希保持一致；不宣称干净。
- 来源 `/Users/julia1/Documents/ChatGPT/1025灵小枢外部信息`、分支 `feature/assistant-reply-quality-20261025` 保留在59d3fc06；源码已提交，5265预览仍在原目录。仅将本轮测试新生成的4个未跟踪媒体缓存保全至私有证据目录，无业务数据同步。
- 合并前恢复分支 `backup/pre-assistant-quality-merge-20261025-7801dd0f`；证据 `/Users/julia1/.codex/integration-evidence/20261025-assistant-quality-merge-n7mBZ0`。其他树未重新盘点、切换、清理或归档；未操作mobile-dual-edition-20261012。
- 未推送、部署或建立真实供应商Ready。验证与首跑并发波动见[集成记录](ASSISTANT-QUALITY-INTEGRATION-20261025.md)。

## 2026-10-25 前端 2.0 安全集成

- 权威树仍为 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`，分支 `xixi联合功能模块后端改`；从 `dfc9b0c8` 快进接入已验证双亲合并 `78ba96c87366108aa3035d75dd5d60d323e19492` 及本轮治理记录。
- 新增独立候选树 `/Users/julia1/.codex/worktrees/frontend-v2-safe-integration-20261025`，分支 `integration/frontend-v2-20261025`；源码与治理提交保留用于复核。仅共享已安装依赖的软链，未复制原预览或业务数据库。
- 权威树原有 `server/index.ts` 未提交资源 404 修复保留，文件/补丁哈希均核对；不将它混入合并，也不宣称权威树干净。恢复分支 `backup/pre-frontend-v2-20261025-dfc9b0c8` 固定原基线。
- 本次测试产生的候选树未跟踪 finalization 缓存移至本机证据目录保留；测试 Vite 进程已结束。没有清理、归档、重置或切换其他来源工作树，没有更新预览数据、推送或部署。
- 本轮没有重新全量盘点其他工作树；以下旧计数仍仅为历史记录。验证与用户确认见 [前端 2.0 合并记录](FRONTEND-V2-INTEGRATION-20261025.md)。

## 2026-10-24 联合功能基线推进

- 本轮原盘点 23 棵工作树，新增独立候选树后共 24 棵。没有清理、归档、重置或删除来源工作树及业务数据。
- 权威工作树 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023` 已从干净 `974a665d` 快进至 `e98d7410337dbb411c5478c7f1caeefad2db27f2` 并切到 `xixi联合功能模块后端改`，后续开发以该基线为准。原基线恢复分支保留。
- 候选树 `/Users/julia1/.codex/worktrees/xixi-union-backend-20261024` 完成合并与验证后停在 detached `e98d7410337dbb411c5478c7f1caeefad2db27f2`；仅移走本轮新生成的未跟踪测试缓存、移除本轮依赖目录软链，原始证据保存在本机证据目录；没有删除源依赖或真实预览数据。
- 干净的 `/Users/julia1/Documents/ChatGPT/1024吴小姐最新前端预览` 从 `89b17510` 安全快进到同一验证版本，后续治理补记可继续快进。含未提交改动的内容创作、数字员工、投流、灵感和小程序等来源树保留原 HEAD/index/文件；13 棵源码树的固定快照已逐笔整合，不能因快照合并而把现场视为干净。
- 本机证据 `/Users/julia1/.codex/integration-evidence/20261024-all-branches/` 包含原分支 bundle、93 分支矩阵、13 源码快照清单、冲突选择、源码保全核验、失败/成功原始日志及最终验证摘要。详见 [联合整合报告](ALL-BRANCH-INTEGRATION-20261024.md)。

## 2026-10-24 客服功能合入当前开发基线

- 当前集成工作树 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`、分支 `xixi投流客服整合补齐基线v1`，在用户确认后从干净 `89b17510` 快进至客服验证提交 `6b5c3022`；本轮治理提交另行记录，无生产源码变化。已在此树重新跑完整候选客服功能/静态矩阵，见[集成报告](../qa/customer-baseline-integration-2026-10-24.md)。
- 来源 `/Users/julia1/Documents/ChatGPT/1024客服` 仍为 `feature/customer-service-20261024`，来源源码、归档和断言修复提交均保留。源码提交后工作区干净；本地预览、账号和运行库继续留在原位，不随源码合并迁移。
- 只更新上述基线分支，没有清理、重置、切换、删除或归档其他工作树；未推送、部署、执行目标库迁移或真实供应商调用。旧盘点中的其他树状态未在本轮重新验收。

## 2026-10-23 独立集成最终核验

独立集成树已完成投流→客服→用户追加测试版本→WhatsApp→视频→小程序→图片的串行集成，验证源码2e431ef5，最终记录另行提交推送。原治理树仍641d0b9且干净；投流25项和小程序43项来源冻结内容哈希复核未变，未由集成会话提交/清理；客服f764fa45、WhatsApp d78d4325、视频71df3157、图片c7f7c0fc来源树干净。未更新xixi架构清理c3355ee5，用户指定投流快照xixi改大合并（投流）固定b6e4b3e8。未归档/移除任何来源工作树，sources/未写入。[完整证据](FEATURE-INTEGRATION-20261023.md)。

## 2026-10-23 功能大合并独立树

集成会话从重新确认干净的治理 `641d0b9` 创建 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`、分支 `xixi功能大合并20261023`。原树和来源树由集成会话保持原状；来源负责人自行冻结/提交的交接见 [合并清单](FEATURE-INTEGRATION-20261023.md)。未移动、重置、清理或提交来源草稿，未更新 `xixi架构清理`。本次新树独立安装依赖，不共享来源运行数据。


<!-- 以下为吴小姐完成最终测试分支的来源机器历史证据，非本机工作树切换。 -->
## 2026-10-23 本机集成工作树切换

- `/Users/jiejie/Documents/lingshu-AI` 从旧本地基线切换到远端 `xixi改五个大文件结构治理` 的精确 `641d0b9e`，切换后工作区干净；后续人物认证源码提交为 `a2b37ae6`，治理文档另行提交。该目录现在是本机的源码集成位置，不代表旧预览进程已切换或真实供应商状态。
- 本机 `git worktree list --porcelain` 另列三棵停在 `62f85f8c` 的 detached 工作树，以及 `/Users/jiejie/.codex/worktrees/f82f/lingshu-AI` 的 `codex/jimeng-creator-ui-20261023`（`64bb6481`）。本次未对它们做合并、重置、清理或归档；此处只记录注册身份，不声称全面盘点其未提交或忽略文件。下方 `/Users/julia1` 路径是另一电脑的历史记录，不是本机当前路径。
## 2026-10-23 视频生产 P1 独立写入交接

- 主会话推进前端素材边界时，发现“定位灵枢AI基线代码”会话开始修改同一集成树。经用户明确授权协调，该会话创建 `/Users/julia1/Documents/ChatGPT/1023视频生成管线/lingshu-video-p1`，分支 `codex/video-production-p1-20261023`，起点 `ddeb731026eb515e2e482cc5470b89a043acb5e5`，完整迁出自己的后端工作后继续在新位置执行。此分支未合入本批前端源码 `befdda33b396963723f146ac823c3df0780e0256`。
- 已核对迁出 6 个已跟踪文件：`socialContentInitialSceneCache.ts`、`socialContentProductionAdmission.ts`、`socialContentProductionExecution.ts`、`socialContentProductionReadModel.ts`、`socialContentProductionRuntimeSupport.ts`、`socialContentReleaseQuality.ts`；3 个新增文件：`socialContentCacheFinalization.ts`、`socialContentPresenterRouteAdmission.ts`、`shared/contracts/presenterProductionRoute.ts`。前八个文件位于 `server/starter198/`。这是交接时快照，后续 P1 工作可继续增加差异，不能据此清理该树。
- 集成树 `server/`、`shared/` 差异已清空，前端及其测试/包脚本/架构预算差异完整保留。没有跨任务 reset、stash、clean 或混合提交。隔离后再次通过类型、架构/迁移只读、工作台及构建检查。此次仅核验隔离，不是其他工作树的全量再盘点；原图片 AIGC 等来源树维持原位。

## 2026-10-23 新会话承接再盘点（源码点 `630c4126`）

- 用户确认停止旧主会话后串行承接。Git 注册仍为 9 棵；集成树源码提交为 `630c4126`，本次盘点时仅两份治理文档待提交，不能将该临时文档状态混称为来源树脏改动。
- 非集成树只读状态快照：`local-preview-1002` 53 项、`local-integrated-flow` 91 项、`local-unified-20261010` 6 项、`mobile-dual-edition-20261012` 28 项、独立广告树 `xixi1021-full-integration` 12 项、`total-merge-langgraph` 20 项。广告树仍被其他会话推进，承接初查为 6 项，随后为 12 项，计数不是长期基线。
- 新图片树 `23b1bb93` 干净且有 1 个正向独有补丁提交；客服树 `18e8046b` 现已干净，但有 2 个正向独有补丁提交。两者均不可按“干净”等同于可删除；旧章节“广告树干净、客服树有 1 项修改”不再代表当前状态。
- 以上 8 棵来源树均保持原位，未重置、归档、提交、清理或覆盖。原 AIGC 来源树的未提交内容保留；新图片树的自动 GPT 复核行为仍不得整笔覆盖当前 Qwen→Gemini 降级及付费门禁。

## 2026-10-23 图片 AIGC 来源复核（集成点 `a8b53951`）

- 原 AIGC 来源树 `mobile-dual-edition-20261012` 仍在 `95b0bcc1`，有 28 个 Git 状态项；已跟踪的未提交源码仅 `RestoredAgentWorkCalendar.tsx`，另有 `AGENTS.md`、文档、演示组件及运行数据。没有证据可将这些未提交内容视作图片管线新版本，也不对该树做提交、清理或归档。
- 新图片树仍在 `23b1bb93`，其唯一正向独有提交的确定性图层蓝图、蒙版渲染、任务传递和前端证据展示已在集成代码中逐项找到对应实现。自动 GPT 图片复核的路由替换尚未合入：它会替换用户要求暂时保留的 Qwen→Gemini 行为，且新付费适配器尚无逐记录许可入口。因此保留该独有提交和原工作树，不把选择性合入称为整笔 cherry-pick。
- 当前集成点的 `test:social-image-pipeline` 离线回归通过（主组 55/55，路由及合同组亦通过），覆盖固定图层蒙版/顺序、GIF 多输出与 HTTP 幂等准入；这不证明真实供应商、登录后浏览器、目标数据库或部署环境验收。注册工作树仍为 9 棵。

## 2026-10-23 两棵干净来源树的可恢复归档

- 依用户选择，重新确认 `safe-all-modules-ui-20261009` 与 `colleague-handoff-20261019` 的 Git 状态均干净、相对集成点无正向独有补丁，且没有以原路径运行的进程。两树被忽略的数据不能随检出直接丢弃，因此先对各自除 `.git` 工作树指针外的**完整目录**创建私有压缩包，`gzip -t` 通过，并核对前者的 `data/materials.json`/`data/publishing-uploads/`、后者的 `data/bgm/shared/`/`data/content-execution-render/` 确实在包内。
- 归档清单与恢复说明分别在 `/Users/julia1/.codex/worktree-archives/2026-10-23/safe-all-modules-ui-20261009-40dba2c0.md` 和 `/Users/julia1/.codex/worktree-archives/2026-10-23/colleague-handoff-20261019-2d6c5a62.md`；压缩包同目录、权限 `0600`、SHA-256 写在清单中。核验后以 `git worktree remove --force` 仅移除两棵已备份检出。命名分支 `1009大合并` (`40dba2c0`) 与 `xixi数字员工架构待清理` (`2d6c5a62`) 仍保留，可重建后解包恢复被忽略的业务数据。未删除分支或提交。
- 现在 Git 注册 **9 棵**工作树：集成树、6 棵有未提交内容的来源树，以及独立广告树和 `1022图片生成模块` 两棵有独有提交的干净树。后 8 棵均原位保留。本次归档不会使其他工作树自动变干净，也不代表新图片提交已整笔合入。

## 2026-10-23 集成点 `20fe685f` 再盘点

- 复核起点的集成树为 `20fe685fa87c33680e3cc079fac62dcd07e0272a`、工作区干净；盘点时本批治理代码尚未提交，此 SHA 不是永久最新指针。Git 仍登记 11 个工作树；6 个非集成树有未提交项：`local-preview-1002` 53、`local-integrated-flow` 91、`local-unified-20261010` 6、`mobile-dual-edition-20261012` 28、`客服` 1、`total-merge-langgraph` 20，均未改动。
- 干净的独立广告树已前进至 `1026906d`，相对集成点仍有 16 个正向独有补丁；新图片树 `23b1bb93` 仍有正向独有提交。原图片来源 `95b0bcc1` 仍是集成祖先但有未提交内容。另两个干净树此前查明含被忽略业务数据。没有新证明可无损归档的工作树，本批未归档、重置或移动任何非集成树。

## 2026-10-23 集成点 `3b200a4d` 复核

- 复核时集成树干净，本地 HEAD 为 `3b200a4d58306ad25670cef792e21b045535e495`；此 SHA 是本批改动前起点。仍有 11 个注册工作树。6 个非集成树含未提交项，计数分别为 `local-preview-1002` 53、`local-integrated-flow` 91、`local-unified-20261010` 6、`mobile-dual-edition-20261012` 28、`客服` 1、`total-merge-langgraph` 20，均原位保留。
- 4 个干净非集成树无新增安全归档候选：`safe-all-modules-ui-20261009` 与 `colleague-handoff-20261019` 含被忽略业务数据，独立广告树已前进至 `4ef6f137` 且仍有独有补丁/运行数据，新图片树 `23b1bb93` 的正向独有提交仍未整笔合并。原图片树 `95b0bcc1` 是集成祖先，但有未提交源码/产物，未改动或归档。
- 新图片提交的图层蓝图和确定性合成能力在集成代码已有覆盖；其中自动 GPT 复核路由与用户要求保留的 Qwen→Gemini 降级冲突，不能直接 cherry-pick。LinkedIn 付费采集按用户最新决定暂不测试。本批未归档、重置、移动或更改任何非集成工作树。

## 2026-10-23 集成点 `6d5fb43a` 图片差异与工作树复核

- 复核时集成树 `xixi1021-governance-baseline` 为 `6d5fb43a77e0daff91da93f94f5ec56570d917b9`、Git 工作区干净；该点位不是永久 HEAD。共 11 个注册工作树。6 个非集成树有未提交项：`local-preview-1002` 53、`local-integrated-flow` 91、`local-unified-20261010` 6、`mobile-dual-edition-20261012` 28、`客服` 1、`total-merge-langgraph` 20，全部保留。
- 4 个非集成树虽干净，仍无新无损归档候选：`safe-all-modules-ui-20261009` 有被忽略的 `data/materials.json`、`data/publishing-uploads/` 等业务数据；`colleague-handoff-20261019` 有被忽略的媒体/运行数据；独立广告树 `xixi1021-full-integration` 当前 `20441982` 有 14 个正向独有补丁及忽略的账号/审计数据；`1022图片生成模块` 的 `23b1bb93` 仍有 1 个非等价独有提交（忽略项仅依赖缓存）。前两树相对集成点无正向独有补丁，但不能据此删除其业务数据。本批未归档、重置、移动任何树。
- 原图片管线提交 `6e2d2e4f` 与来源 HEAD `95b0bcc1` 均为集成祖先。逐文件对照 `23b1bb93` 后，图层蓝图、蒙版渲染、轮播/GIF 传递及前端图文证据在集成源码中存在，集成实现另有归一化与产品遮挡保护；有意未接线的是其自动 GPT 复核路由，因为用户要求暂留 Qwen→Gemini 现有行为，且真实逐记录付费许可尚未开放。保留该独有来源提交，不把“已选择性合入”误称为整笔合并。
- `test:social-image-pipeline` 及图文分析/GPT 付费边界聚焦测试 19/19 通过，均为离线验证。按用户决定未测试 LinkedIn 付费采集，也未执行真实供应商、目标库迁移、浏览器验收或部署。

## 2026-10-23 集成点 `f55296b8` 只读复核

- Git 仍登记 11 个工作树。集成树 `xixi1021-governance-baseline` 在本次复核时本地/远端同为 `f55296b80766864e4555325027adc637945777ef`，Git 工作区干净；此 SHA 是复核点，不是永久最新指针。
- 6 个非集成树仍有未提交项：`local-preview-1002` 53、`local-integrated-flow` 91、`local-unified-20261010` 6、`mobile-dual-edition-20261012` 28、`客服` 1、`total-merge-langgraph` 20。计数是 Git porcelain 条目，不代表文件数；均未移动、归档或清理。
- 4 个干净的非集成树仍被保留。新图片树的 `23b1bb93` 相对当前集成点仍是正向独有补丁；广告树当前 HEAD `20441982` 也有正向独有补丁。`safe-all-modules-ui-20261009` 与 `colleague-handoff-20261019` 的历史复核显示有被忽略业务/运行数据，本轮未重新证明其可无损归档，因此不执行删除。原图片 AIGC 分支 HEAD `95b0bcc1` 和用户列出的 `6e2d2e4f` 仍是集成祖先；这不包括来源树的未提交内容，也不证明真实供应商链路。

## 2026-10-23 集成点 `bbc4ed58` 只读复核

- 本轮代码提交后，集成树为 `bbc4ed583109986ac074d745df1bd0a87299688c`、工作区干净；Git 仍登记 11 个工作树。6 个非集成树有未提交内容：`local-preview-1002`、`local-integrated-flow`、`local-unified-20261010`、`mobile-dual-edition-20261012`、`客服`、`total-merge-langgraph`，全部保留原位。
- 其余 4 个非集成树虽干净，`safe-all-modules-ui-20261009`、`colleague-handoff-20261019` 含被忽略的业务媒体或运行数据，广告树 `xixi1021-full-integration` 含独有补丁及账号、任务和审计数据，`1022图片生成模块` 的 `23b1bb93` 仍有非等价独有补丁。没有新的无损归档候选，未归档、重置或移动任何工作树。
- 原图片 AIGC 已提交管线仍在集成祖先中；新图片分支的确定性图层改进已选择性合入，剩余自动 GPT 路由会改变用户要求暂留的 Qwen→Gemini 降级，且逐记录付费许可尚未完成。本轮不整笔合并、不做 LinkedIn 付费采集测试；只读盘点不等于其他工作树或目标环境已清理验收。

## 2026-10-23 集成点 `f0fce7f7` 再盘点

- 在集成树干净、HEAD 为 `f0fce7f72c7c2e32858bae586eb8662a48a1d0bb` 时逐一复核 11 个注册树。6 个非集成树有未提交项：`local-preview-1002` 53、`local-integrated-flow` 91、`local-unified-20261010` 6、`mobile-dual-edition-20261012` 28、`客服` 1、`total-merge-langgraph` 20；均保留原位。计数为 Git porcelain 条目，不代表文件数。
- 4 个干净非集成树中，`safe-all-modules-ui-20261009` 与 `colleague-handoff-20261019` 无正向独有补丁但有被忽略的业务媒体/账本；广告树 `xixi1021-full-integration` 有 14 个正向独有补丁及被忽略的广告审计/账号数据；`1022图片生成模块` 有 1 个正向独有补丁。没有“干净、无独有补丁、仅有可重建缓存”的无损归档候选，未清理任何树。
- 新图片提交 `23b1bb93` 的 Qwen 图层蓝图、蒙版/图层确定性能力已在集成实现中；剩余路由把 Qwen 失败或低置信复核改为自动 GPT，替换现有 Qwen→Gemini 行为且未具生产付费许可。遵守用户要求暂留旧行为，不整笔 cherry-pick。工作树盘点与补丁复核不等于真实供应商、目标共享卷或浏览器验收；本节只记录复核点，不表示当前永久 HEAD。

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
