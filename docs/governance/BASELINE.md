# 工程基线（阶段二集成）

## 外部资讯四卡隔离验收候选（2026-10-29）

- 追加源码提交 `831a27fb3a863e052e8cf9f7243ba560d848c7e1`：过滤联盟营销导购并使不足来源时进入既有补充检索；恢复社媒素材封面三分之一宽度、左对齐。相关定向测试 60 项及架构检查通过；该版本未做真实供应商验收。
- 隔离分支 `integration/external-cards-20261029`，源码合并提交 `ecda09febb1551f880faca4dfb716463e7ac18ff`，合并 V2 提交 `8470bba4` 与验收版本 `7e370e14`；今日资讯检索词采用 `skincare`，移除中国美妆专用检索分支。
- 107 项资讯、企业报告、社媒及前端定向测试通过，`pnpm run check:architecture` 与 `git diff --cached --check` 通过。未运行全量 TypeScript 检查。
- 本记录仅冻结隔离验收候选，并非共享基线或发布就绪；真实供应商报告质量、隔离数据与服务配置仍需逐项验证。原 V2 工作区未提交改动未纳入。

## 功能分支：外观合并 V2 周计划与素材匹配（2026-10-29）

- 本次仅推进 `xixi外观合并V2`，不重新指定共享统一基线。初始 `28a9bfaf`，来源远端核对为 `6d022a61`；兼容合并 `4520e796`，再保留其他会话新增的 `f4506055`、`cbc8d51b`，源码检查点 `bcc7e695`。
- 保留 V2 共享场景、报告展示和侧栏周任务包，接入周计划数量/参考、图片队列、对话补录、素材匹配与成本进度行为。235 项主回归、37 项补充回归、3149 文件架构预算、208 项迁移只读检查和前端构建通过；两组测试有重叠。
- 按约定未运行全量类型检查，未做真实供应商验收、推送或部署。详见 [本轮合并记录](APPEARANCE-V2-WEEKLY-INTEGRATION-20261029.md)。下方“当前”章节保留原历史语义。

## 外部资讯场景最小修复（2026-10-29）

- 从 `7f88cf2d` 快进至源码 `ebc5c2ec`：企业报告仅剔除没有原文摘录编号的完整章节，仍要求至少三个有效章节，并保留原有引用、数字与交付校验。复用现有模型、检索与报告链路；未改其他场景实现。
- 用真实失败回执离线回放后保留三节与八项指标；90 项相关定向测试、3133 文件架构检查和差异检查通过。按仓库当前约定未运行全量 TypeScript 检查。原基线五项未提交文件的变更和未跟踪清单哈希未变。
- 合并前恢复点 `7f88cf2d`。源码修复尚未证明真实生成稳定；今日资讯和行业资讯原文召回、社媒采集配置及真实端到端验收仍待完成。未部署、未推送，未执行数据库迁移。

## 场景卡片兼容补丁（2026-10-29）

- 在 `c2d808ed` 场景合并基线上，保持外部资讯提示词、场景界面与检索报告处理沿用本地保存点；修复周计划引导可能截获其他场景请求的问题。
- 场景及供应商模拟定向测试 53 项通过；千问检索 16 项通过（固定历史样本时钟）；TypeScript、架构和差异检查通过。未切换运行预览，未做真实供应商验收；今日资讯原文读取问题仍待解决。

## 当前本地统一开发基线：场景卡片兼容恢复（2026-10-29）

- 统一基线 `e7f3c250` 与旧预览现场保存点 `8982a037` 合并为 `795aa509`；用户确认首页周计划进入对话、方案和预算分步确认、保留回复入口、保留经营总览新样式，并兼容场景及图片工作流。
- 隔离工作树执行 62 项场景、首页和对话定向测试通过；TypeScript 检查无诊断，架构检查通过 3133 个生产 TypeScript 文件（未设置 ratchet 基线），207 项迁移文件只读检查通过，差异空白检查通过。未进行完整全仓质量检查或真实供应商端到端验收。
- 统一工作树原有未提交文件保持原样；旧预览现场及恢复点 `refs/backup/scene-work-snapshot-20261028-8982a037` 保留。未切换运行中的预览、推送或部署。今日资讯此前真实验收未通过，不因本次合并而视为已修复。

## 2026-10-28 经营页面与图片链路版本集成

- 原基线 `874237dafd53b1232ff2965aef9eb64e84b55add` 与 GitHub 分支 `经营页面待优化，图片链路已完成` 的 `6aba5de4e6606410c1b20c155d9340f117e413ae` 为祖先关系，采用快进集成；授权开关按用户选择保留新版本的移除方案。
- 兼容修复 `2da8efdd` 更新发布合同测试并澄清已有授权状态，保留后端发布及客服授权检查。
- 隔离检出中 TypeScript、3083 文件架构检查、207 项迁移只读检查、图片链路145项、发布及经营页面5项、客服授权2项与 diff 检查通过。数字员工宽回归 361/365；其中3项在原基线同样失败，另一项发布开关合同已按用户确认修复。未运行完整 quality/verify、真实供应商E2E或部署。
- 原基线的5项未提交文件与本次版本变更不重叠，推进时保留；独立预览工作区的未提交变更未纳入本次源码基线。

## 当前窗口本地基线：灵小枢周计划与图文生产闭环（2026-10-28）

- 当前真实工作树为 `/Users/jiejie/Documents/lingshu-AI`，分支 `节节图片联调完成`；本会话源码基线提交为 `b53d551f2c5cc3f1044b536ecf90dfd7f7c23454`，起点为 `b4ef968f35403fe5a8ad04ad355fcf2bc58e35af`。
- 灵小枢首页周计划链路改为留在当前会话内依次补充资料、提供经营目标选项并分阶段确认；相关工作区改为当前窗口内的周计划／任务视图。图文复刻确认费用上限后才可入队，内部生产节点由系统自动推进，错误码不再被笼统压成策划失败。
- 发布平台和图文语言选择值恢复可见；图文制作进度只展示当前节点及运行状态，不再暴露完整内部流水线。参考图策略、确定性图层渲染和可读助手回复同步纳入本地源码快照。
- 实际执行 `pnpm run test:assistant`，全部组成测试通过；图文执行、预算门禁、参考策略、首页及回复合同定向测试 47/47 通过；`pnpm run check:architecture` 通过 3069 个生产 TypeScript 文件，`git diff --check` 通过。没有迁移、依赖或锁文件变化。
- 已知限制：现有历史图文任务 `e9c24628916ae02` 因创建时未确认单条费用上限而保持 `blocked`，没有供应商回执或付费提交；本次未擅自补预算或重试。按用户此前约束未运行全量 TypeScript、全仓 `quality` / `verify`、完整构建或真实供应商 E2E，因此不能声明发布就绪。
- 本次仅建立本地 Git 基线；未推送、部署、执行迁移、写入生产数据或触发真实供应商调用。

## 当前窗口本地基线：周计划修复与 1028 阶段汇报（2026-10-28）

- 当前真实工作树为 `/Users/jiejie/Documents/lingshu-AI`，分支 `节节图片联调完成`。现有周计划、助手会话和统一任务区改动先封装为安全检查点 `2e2ce1cb`。
- 已核对并合入 GitHub 分支 `1028阶段汇报` / `874237dafd53b1232ff2965aef9eb64e84b55add`，合并提交 `3b07fef1`。唯一冲突位于 `GlobalAssistant.contract.test.ts`；按用户选择保留“新建单条内容跳转首页爆款素材区”及“不恢复重复创建弹窗”的约束。
- 首页已有会话中的输入栏裁切修复为 `4c87201c`：会话管理和“回到最新消息”改为对话区内悬浮控件，消息区继续滚动，底部附件、输入与发送保持可见。
- 实际执行助手首页、内容创作、经营总览及租户隔离定向测试 8/8，`pnpm run check:architecture` 通过 3068 个生产 TypeScript 文件，`git diff --check` 通过；浏览器实测输入栏完整位于外框内。
- 按用户要求未运行全量 TypeScript、完整构建、全仓 `quality` / `verify` 或真实供应商 E2E。未推送、部署、执行迁移或写入生产数据。

## 当前本地统一开发基线：合入节节图片联调完成（2026-10-28）

- 分支仍为 `baseline/unified-20261028`，目录 `/Users/julia1/Documents/ChatGPT/基线管理/image-text-baseline-20261028`；下方各“当前”段落均为历史检查点。
- 旧基线 `21a9fb94` 与用户指定 GitHub 来源 `节节图片联调完成` / `453ef28b204130e8c90f5a1b30dd3638345ec264` 合并为 `378a7a64`，最小兼容修复为 `e67e0c5d`，本治理记录单独提交。源码验证后已通过 ff-only 推进原干净基线。
- 变化测试 267/267、图文主回归 102/102 加 HTTP/合同、周计划启动 69/69、助手与前端安全、修复后 TypeScript、3067 文件架构/棘轮、207 项迁移只读检查及双端构建通过。没有依赖、锁文件或迁移变化。
- **保留来源已有验收缺口**：视频预算回归 80/93；完整 quality 停在 worker split-web 就绪断言。两者均已在精确原始来源独立复现。此处是本地开发源码集成点，不能声明完整验收或发布就绪；未运行 verify 或真实供应商 E2E。
- 来源包含“不限额计量”预算策略及 worker/部署模板变更。未推送、部署、发布或切换预览；旧工作树和其他分支保留。恢复点 `backup/pre-jiejie-image-20261028-21a9fb94`。完整证据与边界见 [本次合并记录](JIEJIE-IMAGE-INTEGRATION-20261028.md)。

## 当前本地统一开发基线：图文联调安全合并（2026-10-28）

- 新本地基线：`baseline/unified-20261028`，目录 `/Users/julia1/Documents/ChatGPT/基线管理/image-text-baseline-20261028`。后续开发从此分支开始；下方“当前”章节均为历史检查点。
- 用户确认的旧基线 `0ca19acf4641826612a94471c7da70765d19d229` 与远端核对的图文来源 `ac12a04187a5d0e9a8afcdf7645ae11dec2fd9f0` 无冲突合并为 `0bc495bdd75925437b86231188de3727a50b66ee`。本治理补记单独提交，仅修改文档。
- 图文主回归 102/102、HTTP/合同、新界面 5/5、快捷卡片 40/40、TypeScript、架构及棘轮、207 项迁移只读检查、构建与 diff 检查通过；无新增迁移。
- 宽范围 quality 未整体通过：周任务 M1 受控测试拦截 HeyGen 后断言失败，已在旧基线干净副本复现。完整验收范围、环境修复与限制见 [合并记录](IMAGE-TEXT-BASELINE-20261028.md)。未运行全仓 verify 或真实供应商 E2E。
- 原 `baseline/unified-20261026` 及其 55 项未提交内容保留，分支仍在旧 SHA；没有把这些内容并入新基线。未推送或部署，现有预览未切换。

更新时间：2026-10-28（Asia/Shanghai）

## 当前本机集成基线：统一周计划与图文人工验收（2026-10-28）

- 本机工作树 `/Users/jiejie/Documents/lingshu-AI`、分支 `1027代码封装`。先将现有周计划、统一内容生成队列、会话恢复和首页爆款素材跳转改动封装为安全检查点 `4246243e`，再整体兼容合入本地分支 `codex/social-image-takeover-20261028` / `0d2339b8`；合并提交为 `77657bd8`。
- 四处内容冲突按用户确认的兼容方案处理：周计划入口保留当前统一状态判断及唯一内容队列；图文爆款复刻保留返回 `hi，灵小枢` 首页和参考素材传递，同时采用新分支的一句可执行短提示，不重复发送长原帖标题。目标分支的人审质量门、版本预览、自然语言修复、参考图比例处理和相关 ADR 完整接入。
- 本机实际执行服务端与共享图文契约 30/30、图文人审与预览等前端定向测试 8/8，以及首页、周计划、快捷提示、场景补齐和“新建单条内容任务 → 首页爆款素材”五组兼容性测试；`pnpm run check:architecture` 通过 3067 个生产 TypeScript 文件，`git diff --check` 通过。没有迁移、锁文件、依赖或部署流程变化。
- 按用户要求未运行全量 TypeScript、完整构建、全仓 `quality` / `verify` 或真实供应商 E2E。未推送、部署、执行数据库迁移或写入生产数据；安全恢复点为 `4246243e`。

## 当前本机集成基线：美妆展示预览与可读回复（2026-10-27）

- 本机工作树 `/Users/jiejie/Documents/lingshu-AI`、分支 `节节1025服务器上传`，从提交 `e75b386775452c2704a86427c5ab3ab155694356` 兼容合入本地分支 `codex/beauty-showcase-preview-20261027` / `dd410a470e4a9ec4098b04ee13c763898669f6e6`；本合并提交另记。
- 七处冲突按兼容方案处理：保留当前快捷卡片、导航门户、周计划真实生成、明确生成授权和本地美妆经营数据映射；接入可读回复展示、首页快捷提交上下文、账号经营评分及精简的周计划编辑界面。新建草稿启动使用本次来源计划的精确修订号，不依赖旧页面快照。
- 本机实际执行美妆展示、可读回复、周计划、数字员工、经营评分及快捷卡片相关定向测试 48/48；相对合入前提交的架构预算检查通过 3061 个生产 TypeScript 文件，暂存差异检查通过。没有迁移文件、迁移清单、锁文件或依赖变化。
- 按用户要求未运行全量 TypeScript、完整构建、全仓 quality/verify 或真实供应商 E2E。未部署、执行数据库迁移或写入生产数据；安全恢复点为 `e75b386775452c2704a86427c5ab3ab155694356`。

## 当前本机集成基线：周内容生成运行与预算契约（2026-10-27）

- 本机工作树 `/Users/jiejie/Documents/lingshu-AI`、分支 `节节1025服务器上传`，从提交 `4e88053e414d050b9acc6adef179365e8fb23a46` 兼容合入本地分支 `codex/session-baseline-5341ac4c-20261027` / `d677b0e4ceabf13678cc2005349104d465399a77`；本合并提交另记。
- 五处冲突按用户确认的兼容方案处理：经营总览、客户漏斗及其契约保留当前快捷卡片后的拆分结构；灵小枢对话同时保留导航门户与周计划卡；产品规范同时保留工作排期、客户跟进、投流对话和周运营计划确认规则。其余周内容生成运行状态、计量式不限额预算契约、worker 心跳与部署配置按来源分支接入。
- 本机实际执行周计划授权、生成预算、运行心跳、生产适配、灵小枢及经营总览相关定向测试 70/70；相对合入前提交的架构预算检查通过 3056 个生产 TypeScript 文件，暂存差异检查通过。没有迁移文件、迁移清单、锁文件或依赖变化。
- 按用户要求未运行全量 TypeScript、完整构建、全仓 quality/verify 或真实供应商 E2E。未推送、部署、执行数据库迁移或写入生产数据；安全恢复点为 `4e88053e414d050b9acc6adef179365e8fb23a46`。

## 当前本机集成基线：兼容合入 xixi 快捷卡片（2026-10-27）

- 本机工作树 `/Users/jiejie/Documents/lingshu-AI`、分支 `节节1025服务器上传`，从干净提交 `7479897d345529a3f3c73ef0a1011fef138e3fd8` 合入远端 `xixi快捷卡片` / `0ca19acf4641826612a94471c7da70765d19d229`；本合并提交另记。远端 SHA 与用户提供值一致。
- 只读预检发现 6 个冲突并按用户确认的兼容方案处理：保留当前系统公告、客户目录和周计划控制；经营总览采用来源分支已拆分的 `BusinessOverviewAnalytics` 新结构，接入快捷卡片、每日五位重点客户、可编辑跟进回复、分析门户与对话式投流计划；两边治理记录均保留。没有遗留冲突标记。
- 本机实际执行相关定向测试 53/53，通过快捷卡片、导航门户、客户跟进、投流计划创建、经营总览、系统公告和客服开关；`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture` 通过 3052 个生产 TypeScript 文件及预算棘轮；暂存差异检查通过。相对合入前基线没有迁移文件、迁移清单、锁文件或依赖变化，因此未重复迁移检查。
- 按用户要求未运行全量 TypeScript、完整投流回归、生产构建、全仓 quality/verify 或真实供应商 E2E。未推送、部署、执行数据库迁移、改广告状态或写入生产数据；来源分支记录的既有验证保留为来源证据，不替代本机运行验收。安全恢复点为 `7479897d345529a3f3c73ef0a1011fef138e3fd8`。

## 当前统一开发基线：首页快捷卡片与对话投流计划（2026-10-27）

- 权威工作树及 `baseline/unified-20261026` 从 `8cecbd02` 快进至源码 `0e9872a05fa3f4f5959f65269f3429e844db4095`；本治理补记单独提交后继续快进。仅纳入当前快捷卡片任务 54 个文件，43 个任务外脏文件逐字节保留。
- 每批五位重点客户与可编辑推荐回复、分析报告与导出、确认后门户、对话式投流计划创建及经营总览裁切完成。隔离候选 67/67 定向测试、76 个投流测试文件、TypeScript、构建、3052 文件架构棘轮、207 项迁移只读检查和 diff 检查通过；无新增迁移。
- 用户指定远端分支 `xixi快捷卡片`，使用非强制推送并核对远端 SHA；未部署。未运行全仓 quality/verify 或真实供应商 E2E。详见 [合入记录](QUICK-CARDS-INTEGRATION-20261027.md)。

## 当前统一开发基线：背景同色文字衬底与空质检回执封存（2026-10-27）

- 权威工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`、分支 `baseline/unified-20261026`，从 `9270b79b3609e2f50c8578c1b4bb9d777f14857c` 依次快进到取色提交 `0e4f19166ab57d71737731277fbf94ddbba87b0c` 和质检提交 `0a9ba67ca51f676b513f7a9e981393c35a002ade`。本治理记录另行提交。前一次快进保留了原 72 项未提交内容，已跟踪补丁 SHA-256 `8fa26b8f53be146c270426c47a3d522f731e66c98a93c9bf34409e9ea1a76ef7`、未跟踪路径清单 SHA-256 `2f40491c6175a4a00b04971afb754b78d252c1a7026e22477628a34b10012f42` 均不变。第二次快进期间其他开发现场继续新增未提交内容，已跟踪补丁 SHA-256 前后仍为 `5d0c564d62e36d7a51181e3248f4cffb8c0a2f40dfcdea86c667f4411bd9861d`；未跟踪路径清单由 `e3152dc424cdd5c6e7a9fd0a1a4d0d45dadaec276cabc263d28b94d35387c9e0` 变为 `e2707c67a6f3f0d0f6012e78ad4df03578c9a598a5d0dc4799be141b5175b439`，数量 78→79，未纳入本次提交。该并行变化不作为本次来源内容。
- 确需文字衬底时，从真实底图文案区取中位背景色并保留色相，只提亮到深色文字可读程度；局部 OCR 修复沿用同一颜色，不再贴纯白卡。上一条 RS-016 底图的免费离线重排 `~/.lingshu-ai/image-b2b-e2e-20261027/rs016-offline-v4-background-card.png` 本地 OCR 通过，属于排版验证，不是新任务验收。
- 基于 `0e4f1916` 的隔离 Web/正常 worker，同版运行。用户通过正常会话选择历史 Apify 参考 `history-image-4e4496cdadb6b43e8af7b695` 第 1 张、RS-016 御龄紧致青春面霜、Facebook／英语／1:1，设置单任务上限 5 元后提交；内容任务 `socialtask_766293976499fb5bd6e767fc`、图片 `img81f01cbc132a`、作业 `ca6c97f3c81cf4a`。worker 领取并完成一次 GPT Image 2 底图出图、原产品合成和 OCR；候选素材 `c0df68ac-8fcc-567e-932f-543a8698f307` 的卡片为背景暖米色，标签来自原图，文字 OCR 为 `pass`。任务自然停在 `blocked` / `user_input_required:social_image_quality_requires_review`；无人工推进、重试或发布。精确供应商费用回执未取得，不推断剩余额度。
- 断点是付费 Qwen 视觉质检记录 `completed` 却返回空检查列表，导致产品身份等硬检查维持 `uncertain`，候选 `repair_required`。参考爆点软检查也返回 `fail`，仍需正常视觉证据与用户验收；不能将此图称为已交付。随后源码 `0a9ba67c` 缩短视觉质检响应格式要求，并把空/缺项结果封存为未决、明确错误码，禁止假完成和自动重试。该源码修复尚无新付费 E2E，旧任务不回写、不补质检。
- 取色版图文管线 100/100、HTTP 1/1、合同／治理 2/2、TypeScript、架构检查 3042 个生产 TypeScript 文件、207 项迁移清单只读检查、`git diff --check` 通过；质检版定向 19/19、图文管线 101/101 加 HTTP／合同／治理、TypeScript、相对 `0e4f1916` 的架构检查和 `git diff --check` 通过。未新增迁移；未运行全仓 `quality/verify`、推送、部署或发布。较大前端 `test:social-content-frontend` 在此前已知的 `socialContentManualBridge.contract.test.ts:75` 产品绑定断言未通过，本轮未重跑，不把局部回归写为整体验收。

## 当前统一开发基线：图文参考画幅与局部文字复核（2026-10-27）

- 权威工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`、分支 `baseline/unified-20261026`，从 `a614c71053e73a2a6c58cc2b987826d3e2772f8d` 分两次快进至源码提交 `9fb7cb2e`；提交 `a970222e` 先修复会话参考图画幅，`9fb7cb2e` 再修复质检与排版。合入前后另一个开发现场的 44 项未提交内容均未纳入；已跟踪补丁 SHA-256 均为 `6276409689a978ab0578fe2c0f875f1cfad0a973c298288638ba8d6475fe85a3`，未跟踪路径清单 SHA-256 均为 `e94212b6b855e502add040c13fb47fee4aa3fe05ed4d2884b34e9740e6c58735`。
- 第一条 RS-016 正常会话任务 `socialtask_b0fb7f7906110147b5418a64`、图像 `imgd140962eca0b`、作业 `f9074c9ce2e3cbb`：参考图实际 590×590，会话误用默认 4:5，免费预检以 `social_image_reference_ratio_unsupported` 阻塞，未进入出图。修复后会话读取选定参考图的真实尺寸并自动匹配 1:1，异常和手动改成不匹配画幅均在入队前提示。
- 第二条在单任务 5 元上限内经同一产品入口入队：`socialtask_64d4f2f6a4589015934344b2`、`img714c8cebf174`、作业 `53fb0903764d1bd`，RS-016 御龄紧致青春面霜、历史采集参考 `history-image-4e4496cdadb6b43e8af7b695` 第 1 张、Facebook／英语／1:1。正常 worker 完成策划、一次 GPT Image 2 底图出图和一次本地文字修复后，因全图 OCR 漏读 `50 g` 自然停在 `blocked` / `user_input_required:social_image_quality_requires_review`；没有发布或人工推进生产节点。正式候选 `03fb9d45-dc52-529c-8690-8e6f39ba4fc1` 保留产品原包装与背景细节，但修复态有两块白卡接缝；不能视为合格成片。精确费用回执尚未取得，不推断剩余额度。
- 在第二条任务停止后，源码将局部修复改为一块半透明文案衬底，净含量同时显示在 SKU 信息行；质检从最终候选像素分别读取全图与确定性左侧文案区域，不用策划文字代替实图证据。同一付费底图的离线副本 `~/.lingshu-ai/image-b2b-e2e-20261027/rs016-offline-v3.png` 已通过本地 OCR，仅为免费设计回归，不是新源码的真实调度验收。该任务保持原状态且未重试；新源码的再次付费 E2E 尚待独立预算确认。
- 定向画幅测试 5/5、图文执行／合成／质量 39/39、完整图文管线 99/99 加 HTTP 1/1、合同／治理 2/2、`pnpm run lint`、相对 `13e7c666` 的架构检查（3042 个生产 TypeScript 文件）、207 项迁移清单只读检查和 `git diff --check` 通过。较大前端回归脚本 `test:social-content-frontend` 停在 `socialContentManualBridge.contract.test.ts:75` 的既有产品绑定断言，未把该脚本写为通过；未运行全仓 `quality/verify`。没有新增迁移、推送、部署或发布。

## 当前统一开发基线：图文身份保真与文字衬底自适应（2026-10-27）

- 权威工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`、分支 `baseline/unified-20261026`，从 `13e7c666217498dfce33c3da559e260be415cd3e` 快进至源码提交 `0ccec34b39a46be176b9b94c42ec2157a9faafc2`。快进前，另一开发现场新增一项未提交的经营总览 CSS，故实际为 42 项而非较早记录的 41 项；这些脏改动均未纳入提交。快进前后已跟踪补丁 SHA-256 均为 `ddac517c23ca19f9e9cf229234df2c334416d584acca71dace9d655002e7f580`，未跟踪路径清单 SHA-256 均为 `e94212b6b855e502add040c13fb47fee4aa3fe05ed4d2884b34e9740e6c58735`。
- B2B 单图只让 GPT Image 2 生成无产品、无包装、无文字的场景底图；冻结企业产品原图在本地羽化合成，模型不再接收产品与对标原始像素。左侧根据底图亮度和细节选无卡、局部衬底或实底，已确认文案、徽章和 CTA 仍由确定性合成器绘制。旧任务不变；决定记录在 [ADR](../architecture/adr/2026-10-27-social-image-identity-locked-composition.md)。
- 图文主回归、HTTP 集成与合同、执行队列定向 20/20、`pnpm run lint`、相对 `13e7c666` 的架构检查（3041 个生产 TypeScript 文件）、207 项迁移清单只读检查和 `git diff --check` 均通过。RS-016 原图在隔离数据中已核对字节；免费本地排版预览为 `~/.lingshu-ai/image-b2b-e2e-20261027/rs016-identity-locked-free-layout.png`，仅说明静态合成版式，不是供应商或真实任务验收。本节记录时新 SKU 真实联调尚未开始；无新增迁移，未推送、部署、发布或运行全仓 `quality/verify`。

## 当前统一开发基线：智能经营与灵小枢周任务视图（2026-10-27）

- 权威工作树与 `baseline/unified-20261026` 不变；实际起点 `40a35534`，功能来源 `feature/intelligent-analytics-page-20261027` / `4fcaed5d`，源码候选 `0b72de2c`，本治理补记另行提交。旧 `cd5222e6` 是祖先，后续图文修复完整保留。
- 经营总览布局及 Meta 统计、企业目录本地补充、原灵小枢对话框展开周任务视图与扇形返回按钮合入；展开隐藏侧边书签，返回保留草稿。私有目录数据、媒体、数据库及凭据不纳入 Git。
- 干净候选 28/28 定向测试、全量 TypeScript、相对 `40a35534` 的架构预算（3041 文件）、207 项迁移清单与 checksum guard、双端构建、diff 检查通过；无迁移变更。原 41 项未提交内容在快进前后逐字节复核，不纳入提交。
- 未运行全仓 quality/verify、真实供应商 E2E、推送、部署或数据库迁移；基线源码不等于预览/生产环境已更新。详见 [本轮合入记录](BUSINESS-OVERVIEW-INTEGRATION-20261027.md)。

## 当前统一开发基线：图文背景细节保留（2026-10-27）

- 本轮新 SKU 真实联调基于 `2c5d71ab49dc014906c0c9252658efc41c7833cd`、独立本地数据、同版 Web/worker，经正常会话入口选取历史 Apify 参考 `history-image-4e4496cdadb6b43e8af7b695` 第 1 张和另一款产品 `GUIANFA-RS-006` 蜜桃冰雪霜，Facebook／英文／1:1，单任务上限 5 元。用户经界面确认后正常入队：内容任务 `socialtask_55ba41a32afb2715293ee51e`、图片任务 `img32295a0a7e7f`、作业 `58a10bc7ff58fdf`。观察期间未改任务、手动推进、重试或发布；作业自然停于 `blocked` / `user_input_required:social_image_quality_requires_review`，图片任务 `review_required`，候选图不可视为合格交付。供应商精确费用回执未取得，不能确认剩余预算，也未追加付费请求。
- 真实候选图卡片外背景保留花枝与台面细节，原先大面积白雾问题改善；仍发现左上标题越出卡片、底图字样透出、瓶身品牌生成错误，硬质检未全部通过，参考结构软指标也有不确定项。本轮仅在该任务停止后修复标题按宽度自适应、单卡不透明底和包装可核实的 `FROST` 英文名；源码提交 `f74197a9712e98367061cd908a97eb5e9fdfaf5f`。使用已生成底图免费重排的 `~/.lingshu-ai/image-b2b-e2e-20261027/rs006-title-layout-local-preview.png` 只证明版式修复，未经过新一轮真实模型与质检，不是任务成片。瓶身品牌漂移仍为待解决质量断点。
- 后续版式修复的定向 buyer-copy 5/5、图文管线 95/95、HTTP 集成 1/1、路由／工作区／治理合同、`pnpm run lint`、相对 `2c5d71ab` 的架构检查（3030 个生产 TypeScript 文件）、207 项迁移清单只读检查、`git diff --check` 通过。没有新迁移；未运行全仓 `quality/verify`、再次付费复验、推送、部署或发布。源码通过不代表真实 E2E 通过。
- 权威工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`、分支 `baseline/unified-20261026`，从 `5881f498` 分步快进至源码提交 `f74197a9712e98367061cd908a97eb5e9fdfaf5f`。原有 41 项未提交改动未纳入；每次合入前后已跟踪补丁 SHA-256 `2f8bbbec2c100c85c6ae68916819b6ff08325f57490751a7bd8adde96c683d93`、未跟踪路径清单 SHA-256 `e94212b6b855e502add040c13fb47fee4aa3fe05ed4d2884b34e9740e6c58735` 均不变。
- B2B 单图的标题、企业信息和产品事实改为同一块紧凑白卡；删除覆盖画面上方 44% 的渐变白雾。出图提示保持场景细节，卡片外背景像素回归验证通过。图文管线 94 项及其路由/合同/治理检查、TypeScript、相对 `5881f498` 的架构检查（3030 个生产 TypeScript 文件）、207 项迁移清单只读检查、`git diff --check` 均通过。没有新增迁移。
- 原 RS-003 底图的免费本地合成预览在 `~/.lingshu-ai/image-b2b-e2e-20261027/rs003-single-copy-card-local-preview.png`，仅用于前一阶段版式检查；后续 RS-006 真实联调结果见本节首段。未推送、部署或发布。
- 正常对话入口还发现历史图文图片走受保护媒体路由，未带鉴权的 `<img>` 被判不可用。工作区的共享 `ReviewImage` 改为对同源 `/api/` 图片鉴权读取、生成临时预览 URL 并在卸载时释放；浏览器中同一历史图已从“暂不可用”变为可选。图文复刻 26/26、工作区合同、TypeScript、相对 `a31a737d` 的架构扫描（3030 个生产 TypeScript 文件）及 `git diff --check` 通过。此时仍未新建本轮付费任务。

## 当前统一开发基线：图文 B2B 构图与 RS-003 真实联调（2026-10-27）

- 权威工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`、分支 `baseline/unified-20261026`，从 `cd5222e6` 快进至源码提交 `53e8ba20cc86d23618e48a859a883140e77ce8c2`。原有 41 项未提交变更未纳入，合入前后已跟踪补丁 SHA-256 `2f8bbbec2c100c85c6ae68916819b6ff08325f57490751a7bd8adde96c683d93`、未跟踪路径清单 SHA-256 `e94212b6b855e502add040c13fb47fee4aa3fe05ed4d2884b34e9740e6c58735` 均不变。
- 图文 B2B 版式在付费出图前由已确认文案计算左侧占位及产品目标位置；同一布局规则驱动确定性合成。右上徽章移到外角，避免遮住瓶盖；提示词用一句话约束产品与场景的光线、反射和接触阴影。隔离分支在最新基线上通过图文管线（93 项主用例及路由/合同/治理）、`pnpm run lint`、`ARCHITECTURE_BASE_REF=cd5222e6 pnpm run check:architecture`（3030 个生产 TS 文件）、207 项迁移清单只读检查和 `git diff --check`。未运行全仓 `quality/verify`。
- 独立本地数据与同版 Web/worker 在先前源码 `1f0ca7e3` 下执行新产品 `GUIANFA-RS-003`：任务 `socialtask_af525e2eb8ddbb86d254ab72`、图像任务 `imgb4dd3cb203b4`、作业 `0d120eaff90b22d`。获批单任务上限 5 元；一次 Qwen 策划、一次 GPT Image 2 低质量出图、一次视觉质检均完成。成片 `1349a707-058d-5976-8c27-f740bce46ab9` 因视觉统一硬检查失败，停在 `review_required`，不视为合格成品；参考结构软检查为 uncertain，待用户验收。原作业与回执保留，未自动重试。用已付费底图做的徽章修复预览 `~/.lingshu-ai/image-b2b-e2e-20261027/rs003-revised-badge-local-preview.png` 未发生新付费请求，亦未取得正式质检。
- 精确供应商账单及余额尚未核实，不能断言 5 元实际消费或再购买一张图。新构图规则 `53e8ba20` 尚未经过同版真实付费出图验收；源码验证、本地预览与真实供应商质量状态分别记录。未推送、部署、发布、采用成品或运行目标库迁移。

## 当前统一开发基线：智能问数版本安全合入（2026-10-27）

- 权威工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`、分支 `baseline/unified-20261026`。用户明确要求合入 GitHub `节节智能问数待优化`；拉取核对来源提交 `cdfbab8dac65cb8c01be5995aea98635f6dc0fa7`、代码树 `e78e96bc30f25979857b96769cffa7bea68d6af8`，均与用户提供前缀一致。
- 本轮以实际最新 HEAD `1f0ca7e36d52db5736bc3dcc33fec501c6eb7124` 为起点，包含页面分页优化及后续 B2B 图文文案/可读布局改动；旧治理首节停在 `5b531400`，本节补齐该差异。独立候选 `/Users/julia1/Documents/ChatGPT/基线管理/analytics-safe-20261027`、分支 `integration/analytics-safe-20261027`，双亲源码合并 `ce83f310293e4c3df941ba5e10e315852e954cfd`；本治理补记另行提交。
- 合入经营总览与明细、仅本地开发可启用的示例数据、客户目录、维护公告及环境配置、本地心跳集合保留上限和原子写入清理。源码无冲突；唯一冲突为本文件并行新增记录，两边完整保留。以下其他机器的“当前”章节仅作历史来源，不改变本机权威工作树。
- 干净候选验证：功能定向 26/26、存储/CAS/锁/原基线分页与图文/账号配置回归 47/47；`pnpm run lint` 全量 TypeScript、`ARCHITECTURE_BASE_REF=1f0ca7e3 pnpm run check:architecture`（3030 个生产 TS）、`pnpm run test:architecture-ratchet`、`pnpm run check:digital-employee-migrations`（207 项）、`pnpm run test:migration-guard`、`pnpm run check:container-contract`、`pnpm run build`、`pnpm run build:account-hub`、`git diff --check 1f0ca7e3 HEAD` 全部通过。迁移及 checksum 清单相对起点无变化。构建仍有大 chunk 提示，Studio 预算 373271/485000 字节通过。
- 未执行全仓 `quality/verify`、浏览器真实业务验收、付费供应商、推送、部署或数据库迁移；源码合并通过不代表这些项目已验收。原基线 26 项已跟踪改动及 15 个未跟踪文件不纳入本次提交；快进前后核对补丁与未跟踪字节哈希，保护开发现场。
- 恢复分支 `backup/pre-analytics-20261027-1f0ca7e3`；证据和原补丁/未跟踪文件备份位于 `/Users/julia1/.codex/integration-evidence/20261027-analytics/`。来源分支保留；候选树保留供复核。具体命令和边界见 [本次合并记录](ANALYTICS-INTEGRATION-20261027.md)。

## 当前统一开发基线：页面大库存读取优化（2026-10-27）

- 权威工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`、分支 `baseline/unified-20261026`，从 `505afce8` 合入隔离提交 `2c8d164c`，源码提交 `5b531400c0c8d85b1e752ee479a619563b91f5e4`。原有 26 项已跟踪改动及未跟踪文件均保留；合入前后的已跟踪补丁与未跟踪路径清单哈希一致。
- 素材库首屏与翻页只读当前普通素材 20 条，服务端返回整库计数和产品场景封面；复杂筛选、产品详情和爆款收藏关联仍可按需读取完整素材。待拍页面改为服务器按租户汇总缺口，前端只接收汇总结果，每 60 秒刷新。成片库空闲轮询降为 60 秒，素材图片懒加载。
- 隔离树定向 12/12、视频领域 171/172（旧主墙全量读取断言与新目标冲突，更新后该文件 5/5）、TypeScript、架构扫描 3017 文件、207 项迁移清单只读检查、生产构建与 `git diff --check` 通过。基线合入后定向 17/17、架构扫描 3024 文件及 207 项迁移清单只读检查通过；正式站新版本的实际时延和浏览器主线程耗时仍需部署后量化验收。
- 本次源码不含生产数据迁移。服务器现有 Git checkout `/opt/lingshu_AI` 位于 `xixi做小程序` / `bbe406a0`，已跟踪文件干净，存在不与本次路径重叠的未跟踪文件，远端分支落后本地 1029 个提交。部署仅按仓库交互 SSH、GitHub HTTPS 快进拉取和 `bash deploy/update.sh` 执行；完成前不可声明正式站已更新。

## 当前生产部署：前端冒烟修复 v0.5（2026-10-27）

- 权威开发分支 `baseline/unified-20261026`；实际部署源码 `bbe406a08c7fdf394b364794f993e179d299c7af`。用户指定存档分支 `xixi1027部署v0.5、` 指向同一源码。原有 WorkBuddy 素材准入和视频维护脏改动保留，未纳入本次发布。
- 修复会话新建/保存、清空/删除与撤销，以及恢复后的空焦点字段再写入失败；正式站仅用冒烟草稿完成删除→撤销→编辑保存→新建→历史读取→清空→撤销→再删除，原有六条消息会话保留。对话输入框默认高度实测 36px，附件、输入、发送同排。
- 正式站验证账号健康可打开真实平台/账号配置表单，残缺历史任务可进入现有新建计划表单，Messenger 文案对应实际 App ID/App Secret。此前同批 3986917a 已验证鼠标视频播放（readyState=4、播放时间推进）、时长补零、素材首批加载提示和工厂筛选、8 个客服历史会话；本次未付费生成、对外发送或更改广告投放状态。
- 干净验证工作树 `bbe406a0`：56/56 定向测试（含真实 PocketBase 会话回归）、类型检查、生产构建、架构预算与相对 3986917a 的 ratchet、207 项迁移清单只读检查通过。本次补发没有新增迁移；此前 3986917a 的新增迁移在生产库副本演练并确认 274 张业务表数量一致、完整性正常后上线。以上不是全部供应商真实 E2E 验收。
- 经用户批准使用已连接腾讯云交互终端，现有 `/opt/lingshu_AI` HTTPS `git pull --ff-only` 后运行 `bash deploy/update.sh`。低并发构建成功；数据库冷启动超过脚本 180 秒上限，实际健康后从管理员初始化及服务启动检查点继续，`deploy-final-resume.exit=0`。最终 app、worker、PocketBase、Redis、Caddy 均 healthy。
- 公网 `/api/overseas/ready` HTTP 200，`status=ready`、`issues=[]`，web `build.commitSha` 与 worker `buildSha`、`expectedBuildSha` 均为上述完整 SHA，worker `ready=true`。自动数字人发布、语义质检、清理 worker 等既有未配置能力仍不可用，不能用整体 ready 代替真实供应商验收。
- 备份 `/opt/lingshu_AI/backups/smoke-fixes-20261027/` 保留 `data.before.db`、`data.before-final.db`、环境与业务 JSON、发布及恢复日志；上线后数据库 `integrity_check=ok`，素材/客服历史 JSON 的 SHA256 与发布前相同。用户明确批准删除未使用的 21287c57、pre-assistant-save-20261027 两组运行镜像；3986917a、53492e0f 回滚镜像及全部业务备份保留。构建缓存释放后根分区约 3.0GB 可用。
- 已知待核对：名称含“仅草稿”的广告计划仍由平台报告为投放中（CNY 6.72 日预算），页面显示“投放状态待核对”；本轮未启动、暂停或修改它。历史残缺任务的原记录继续保留，新入口不会凭空恢复原制作记录。断网重试仅做源码/定向验证，未主动断开生产连接。
- 本地证据目录 `/Users/julia1/.lingshu-ai/deployment-validation/`：`smoke-fixes-final-ready.json`、`smoke-fixes-final-tests.log`、`smoke-fixes-final-lint.log`、`smoke-fixes-final-build.log`、`smoke-fixes-composer-final-production.png`、`smoke-fixes-account-editor-final-production.png`、`smoke-fixes-task-recovery-final-production.png`。
## 当前本机集成基线：三分支顺序合入（2026-10-27）

本节指定 `/Users/jiejie/Documents/lingshu-AI` / `节节1025服务器上传` 为本机源码基线；以下其他工作树的“当前基线”与部署记录均为当时来源历史。起点 `5341ac4c3527d2462fc4d2e56d715d1b8ff695d4`，合入前工作区干净。三个来源都以该提交为共同祖先，且各来源工作树的已跟踪文件没有未提交修改。

- 第一条 `codex/session-baseline-5341ac4c-20261027` / `94a5ae895c9c54d6cdddd3f32f47d33e4d468553`：`git merge-tree --write-tree --name-only` 无冲突，基线快进至来源提交。本地心跳持久化有界处理及对应测试一并纳入。
- 第二条 `codex/business-overview-20261027` / `5d0af57144f0f012c51567482b867b66cc7c3a76`：在第一条合入后预检无冲突，合并提交 `1529e51f25cf79a7973148bad8ccbf01d59dcd20`。经营总览交互、示例数据边界和相关测试纳入。
- 第三条 `codex/baseline-5341ac4c-dev` / `1a78c512934480f3df7bbe473fa53fd3ad4f7399`：在第二条合入后预检无冲突，合并提交 `1b5be96bd95cfbba7703686ec1bfa3750b2f6972`。客户目录、维护公告及相关配置/文档纳入。UI 规范由 Git 自动合并，无人工冲突取舍。三个分支提交均为当前 HEAD 祖先；本治理记录另行提交。
- 本机实际检查：受影响领域定向回归 26/26、`ARCHITECTURE_BASE_REF=5341ac4c3527d2462fc4d2e56d715d1b8ff695d4 pnpm run check:architecture`（3028 个生产 TypeScript 文件，预算棘轮通过）、`pnpm run check:digital-employee-migrations`（207 项清单，只读）、`pnpm run test:migration-guard`、`git diff --check 5341ac4c3527d2462fc4d2e56d715d1b8ff695d4 HEAD` 均通过。迁移文件与清单相对起点没有变化。
- `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit` 已启动；因本机执行耗时，用户要求不做复杂检查后主动中止（退出 130），本轮不声明 TypeScript 全量通过。未运行全仓 quality/verify 或构建。
- 定向回归命令：`node --import tsx --test --test-concurrency=1 server/storage/localCollectionPersistence.test.ts src/components/smartBusiness/BusinessOverviewLanding.contract.test.ts src/components/smartBusiness/BusinessHealthOverview.contract.test.ts src/components/SmartBusinessWeeklyCommandCenter.contract.test.ts src/components/DigitalEmployeePage.contract.test.ts src/components/ContentCreationHome.contract.test.ts src/dev/businessOverviewSample.test.ts src/lib/businessOverviewPresentation.test.ts server/runtime/systemAnnouncement.test.ts src/components/SystemAnnouncementBanner.test.tsx src/components/customers/CustomerServiceSwitch.test.tsx server/security/customerServiceActivation.test.ts`。
- 只合并源码；未推送、部署、执行数据库迁移或运行真实供应商调用。本机预览/运行状态未在本轮验证，不将源码集成结果视为线上就绪。安全恢复点为原本机提交 `5341ac4c3527d2462fc4d2e56d715d1b8ff695d4`；三个来源分支与其他工作树保持原样。

## 当前本机集成基线：合入 xixi1027 部署 v0.5 来源（2026-10-27）

本节指定本机工作树 `/Users/jiejie/Documents/lingshu-AI`、分支 `节节1025服务器上传`。下方其他机器的统一基线、部署状态和既往本机记录保留为来源历史，不改变本机工作树归属；本节只确认源码集成，不确认本机运行数据或真实供应商 Ready。

- 合入前 HEAD 为 `0cc3ebbcc25cb44ce42fb0f74f90208909136ef5`，工作区干净，与原 v2 基线记录一致。规范 origin 为 `https://github.com/lingshu-ai-cloud/lingshu_AI.git`；精确拉取远端分支 `xixi1027部署v0.5、`，核对提交为 `bbe406a08c7fdf394b364794f993e179d299c7af`。
- 来源已包含本机全部 v2 提交；merge-base 即原 HEAD，`git merge-tree --write-tree --name-only` 退出 0。通过 `git merge --ff-only bbe406a08c7fdf394b364794f993e179d299c7af` 无冲突快进，未做冲突取舍。合入后源码与来源提交完全一致；本治理记录另行提交。
- 来源包含会话保存/清空/删除/撤销与恢复修复、输入栏收紧、账号配置及历史任务恢复入口、素材展示、小程序和图文生产链改动，共 92 个文件。新增 `1793062800_assistant_pending_content_binding.js`、`1793066400_assistant_conversation_recovery.js` 及对应清单只作为源码合入，没有执行数据库迁移或恢复脚本。
- 本机实际检查：以下定向回归 48/48、TypeScript、3017 个生产 TypeScript 文件架构检查及相对原 HEAD 的预算 ratchet、207 项迁移清单只读检查、checksum guard、来源差异空白检查全部通过。

```sh
node --import tsx --test --test-concurrency=1 server/routes/assistantThreads.actions.test.ts src/components/assistant/globalAssistantRuntime.hydration.test.ts src/components/assistant/useAssistantThreadSaveQueue.test.tsx src/components/smartBusiness/DigitalEmployeeOnboardingPanel.accounts.test.tsx src/components/smartBusiness/onboardingMarketOptions.test.ts src/lib/assistantSourceLinks.test.ts src/lib/customerPriority.test.ts src/lib/mediaDuration.test.ts src/components/DigitalEmployeePage.contract.test.ts server/socialImage/socialImageExecution.test.ts
NODE_OPTIONS=--max-old-space-size=4096 pnpm run lint --pretty false
ARCHITECTURE_BASE_REF=0cc3ebbcc25cb44ce42fb0f74f90208909136ef5 pnpm run check:architecture
pnpm run check:digital-employee-migrations
pnpm run test:migration-guard
git diff --check 0cc3ebbcc25cb44ce42fb0f74f90208909136ef5 HEAD
```

- 按用户要求只做必要检查，未执行全仓 quality/verify、构建、真实 PocketBase 生命周期回归、供应商或付费 E2E；未推送、部署、改广告状态或重启本地预览后端。来源提供的线上健康回执不是本机运行状态验证，本轮没有外部 run/task 标识。“仅草稿”命名广告实际投放中的问题沿用来源提醒，未在本轮核实或修改。
- 安全恢复点：保留的本地分支 `快捷卡片回复优化v2` / `0cc3ebbcc25cb44ce42fb0f74f90208909136ef5`，以及来源提交 `bbe406a08c7fdf394b364794f993e179d299c7af`。未触碰其他工作树或图片 AIGC 保留树。后续如需本机运行验收，须单独核对本机数据库迁移状态并加载新后端源码，不能直接把源码合并等同于运行环境更新。

## 当前统一开发基线：前端冒烟问题修复候选（2026-10-27）

- 权威分支仍为 `baseline/unified-20261026`，本批源码候选 `f55aebb70472b5c6e00429ada45824af61e01bfe`；用户要求按冒烟清单修复并部署，追加对话状态底部输入栏收紧。原有 WorkBuddy 素材准入和视频维护的未提交改动保持原样，未纳入候选。
- 修复会话写入时 PocketBase 对空字符串的规范化与严格 CAS 比对；清空/删除可撤销、历史已删除会话可恢复，恢复继续沿用版本和所有权校验。旧写入 claim 恢复脚本默认只读，仅在完整快照和指纹完全匹配、已过期且二次复核后允许备份并释放 claim，不改写会话内容。
- 修复视频鼠标播放、时长格式、账号健康入口与 Messenger 字段说明；素材库首批立即展示并限制后台并发，未完成加载与失败均不显示伪零结果，普通素材和工厂筛选前置。断网支持原地重连；历史残缺任务提供既有新建计划入口，投放名称与运行状态不符只作提示，不自动修改广告。
- 对话模式输入栏默认单行，随文字增长至上限。真实组件本地浏览器实测外栏 70px、单行文本区 36px；六行文本时为 114px / 88px。截图 `/Users/julia1/.lingshu-ai/deployment-validation/smoke-fixes-composer-local.png`。尚未将本地视觉验证写成线上验收。
- 合并并行生产修复 `d77192bf`，合并提交 `ee097a7a`；已发布来源的 `1793062800_assistant_pending_content_binding.js` 保持原字节，恢复快照单独使用新增 `1793066400_assistant_conversation_recovery.js`，迁移清单同步核验，未放宽 checksum guard。
- 独立干净检出 `/Users/julia1/.lingshu-ai/deployment-validation/quick-card-v2-20261027`：真实 PocketBase 0.39.5 HTTP/生命周期、CAS、恢复脚本及受影响 UI 定向回归 45/45 通过；最终候选 TypeScript/lint、生产构建与容器可重现合同通过。相对 `d77192bf` 的架构扫描（3017 个生产 TS）及 207 项迁移清单只读检查通过。构建仍有大 chunk 提示，Studio 专项预算 373270/485000 字节通过。日志位于同目录父级 `smoke-fixes-*.log`。
- **部署未完成**：另一用户会话“对已部署服务网站做前端冒烟测试”正在处理 `d77192bf` 的生产更新及无响应恢复，腾讯云已受理重启。本会话未并发运行生产部署、恢复或清理；尚未取得本批线上 SHA、容器状态和 ready 回执。待现有发布完成后再备份、从既有 `/opt/lingshu_AI` 快进拉取并执行 `bash deploy/update.sh`，然后验证页面。真实客户发送和付费供应商未执行。

## 当前统一开发基线：快捷卡片回复优化 v2 与本地基线（2026-10-27）

本节指定当前工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`、分支 `baseline/unified-20261026` 为本次集成与部署来源；下方其他机器的“当前基线”段落保留为来源历史。

- 用户明确要求合并远端 `快捷卡片回复优化v2` / `0cc3ebbcc25cb44ce42fb0f74f90208909136ef5` 与本地 `55aa6d8b`，并部署既有服务器。客服历史待办修复先提交为 `429b94c5`，一并纳入。
- 源码自动合并；唯一冲突为本文件并行新增的检查记录，两侧内容均保留。其他会话尚未提交的 WorkBuddy 素材联调文件与原视频维护改动保留，不纳入本次提交或部署。
- 合并源码提交 `775a5f5871f0e81cda0f132f27cbbd05b93fe0fc`；在独立干净工作树 `/Users/julia1/.lingshu-ai/deployment-validation/quick-card-v2-20261027` 完成定向回归 67/67、图文主回归 90/90、HTTP 1/1、图文路由/界面合同与治理 2/2、`pnpm run lint`、相对 `55aa6d8b` 的架构预算检查（3015 个生产 TS）、205 项迁移只读检查、checksum guard、生产构建与 `git diff --check`，均通过。主站构建 5.34 秒，Studio chunk 373270/485000 字节。真实供应商与付费链路未执行。
- 已部署生产运行源码 `9b55428fd655cfb99d5a778bd34924686dc8f9ea`。用户在说明 SSH 认证失败、当前连接为腾讯云 TAT 后明确回复“继续部署”，授权本次连接方式例外；仍在既有 `/opt/lingshu_AI` 从规范 GitHub HTTPS `git pull --ff-only` 拉取，并执行 `bash deploy/update.sh`。本次记录提交仅更新本文件，不改变生产运行源码。
- 使用原数据库镜像版本 PocketBase 0.39.5 在备份副本演练新增 `1793059200_assistant_conversation_lifecycle.js`，274 张既有表记录数一致、完整性检查通过；正式库新增会话清空/删除字段已核验，复用原 `lingshu_ai_pb_data_managed` 卷，未重置数据或轮换密钥。
- 构建与视觉质检运行时自检通过。浏览器中断后先核对已有进程和镜像；新镜像已完成导出，通过关键源码哈希后复用缓存完成构建。PocketBase 冷启动约 119 秒，超过原健康检查窗口；初次脚本退出 1，回收 3.831 GB 临时构建缓存并确认数据库健康接口返回 200 后，从管理员校验检查点继续原脚本的剩余命令，`deploy-resume.exit` 为 0。原健康窗口偏短的问题已记录；后续更新须等待真实健康响应，不能把提前失败当作数据库损坏。
- 应用、PocketBase、Redis 健康，worker、Caddy 运行，app/worker 重启计数为 0；容器角色分别为 web/worker，关键源码与目标提交一致。外网 `https://app.lingshu.site/api/overseas/ready` 实测 HTTP 200、`status=ready`、`role=web`、`issues=[]`；旧 worker 缺少配置导致的重启循环已随正确环境重建消除。真实供应商或付费链路未额外执行。
- 素材登记文件 2383 条、目标账号历史客户 8 个/消息 50 条；素材及历史会话 JSON 的 SHA-256 与部署前完全一致。完整回执、迁移演练、部署日志和数据校验在服务器 `/opt/lingshu_AI/backups/quick-card-v2-20261027/`；原版 `21287c57` 的 app/worker/PocketBase 镜像以 `lingshu-recovery/*:21287c57` 保留。原环境和数据库/应用数据备份已校验；旧分支与其他未提交改动未清理。

## 当前统一开发基线：小程序真机素材与选择器修复（2026-10-27）

- 权威分支 `baseline/unified-20261026`，源码提交 `265134bd3da6d9f91bcf46103eed4073e47e494b`，前序 `1afac60e`。素材相册选择不再传非法的 `maxDuration:600`；两个拍摄入口使用兼容的 30 秒。四张助手快捷卡片收紧内边距、卡片间距及与输入栏的间距。
- 企业图片改用现有鉴权请求读取二进制并保存到小程序私有文件区；缓存路径保持原样，不再次按服务端相对地址处理。HTTP/内容类型/落盘失败保留可见反馈，避免整页图片空白且原因被吞。外部图片不附加凭据，文档下载流程不变。
- 小程序既有与回归测试 163/163、TypeScript `tsc --noEmit`、架构检查（3003 个生产 TS；未指定 ratchet base）及 `git diff --check` 通过。生产连接的独立预览包主包 375096 字节、总包 591809 字节，微信预览编译通过；仅复制本次五个原生运行文件到冻结的 `21287c57` 预览目录，没有混入其他后端提交。
- 正式账号的模拟器检查：84 项素材中 83 项缓存成功，抽样原图本地解码成功；历史海报 `pb-6188394431b2f95` 仍为服务器 404。新包的 iPhone 相册选择、实际上传和图片显示待用户复测，不能声明真机已通过；未实际上传文件或触发素材分析。未推送、服务器部署或正式发布。原有视频维护脏改动保留。

## 当前统一开发基线：图文视觉统一生产链（2026-10-27）

- 权威工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`，分支 `baseline/unified-20261026`；开发起点 `b5c1c329414edef645cdbb758c0491df98bd24f7`。仅更新单张图文爆款复刻的生成、合成、质检及展示；原未提交的 `server/videos/videoVisibilityMaintenance.ts` 未纳入。
- GPT Image 2 现在按顺序接收已核验企业产品图与对标图，使用简短提示生成包含产品的完整场景；对标图仅指导布局。固定合成器只叠加事实审查后的文案，不再把整张产品照柔边贴到另一张背景。正式质量门新增 `visual_cohesion` 硬检查，贴图方框、光晕、悬浮或光影透视不一致均不能自动交付。旧任务、回执及未知供应商结果不重试。
- 离线调度与生成夹具 29/29、图文管线 89/89、TypeScript、架构扫描（3003 个生产 TS）、204 项迁移清单只读检查、主站构建及 `git diff --check` 通过。未对新提示词执行真实供应商出图或付费质检，故不宣称成片质量通过；正式任务仍需独立预算和准确账单可核回执。未推送、部署、发布或运行目标库迁移。
- 跨阶段决策见 [图文视觉统一 ADR](../architecture/adr/2026-10-27-social-image-visual-cohesion.md)。

## 当前统一开发基线：小程序登录页微调（2026-10-27）

- 权威工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`，分支 `baseline/unified-20261026`；从 `c904f603` 提交登录页源码 `76f81effc8926ad94717b184c1c875a88c102c11`。补齐与网页 `public/brand-logo.png` 字节一致的图标，删除“随时掌握工作的进展”，仅为登录按钮设置 `margin-top:48rpx`；账号字段、登录行为及其他 UI 不变。
- 工作台既有测试 `workbench.test.cjs` 与 `workbench-experience.test.cjs` 共 37/37 通过，`git diff --check` 通过。相同三处改动已在冻结于正式服源码 `21287c57` 的独立预览包通过微信预览编译（主包 373677 字节）；该预览不是当前整个开发基线的验收。未运行全仓类型、架构或迁移检查，未完成真机 UI 验收。
- 原有未提交的 `server/videos/videoVisibilityMaintenance.ts` 保留且未纳入。本轮仅更新本地 Git 基线，没有推送、服务器部署或正式发布小程序；微信域名修改仍待扫码确认及回读核验。

## 当前统一开发基线：冰沙面霜真实调度与产品规则收口（2026-10-27）

- 权威分支 `baseline/unified-20261026` 已快进到源码提交 `e9479b5d`，来自隔离分支 `codex/image-budget-gate-20261027`；原未提交的视频文件保持原样。先前诊断任务已取消，本轮唯一正式任务为 `socialtask_89cadf7b58a8da3322b38f63` / `imgf6326c5301af` / durable job `2b6d2b0064595f5`，会话保存的单条上限为 5 元。5378/8878 本地预览中，受限 worker 只领取该作业一次，完成免费素材核验、Qwen 策划、一次 OpenAI 背景出图、本地产品与文字合成及一次视觉质检；OpenAI 回执为 completed，生成物和质检均有持久记录。底图素材与合成素材是一次出图请求的两份产物，不能算作两次供应商提交。
- 旧源码的编导规则把有独立证据的参考注意区软性失败当作付费返工阻断，正式作业最终为 `blocked` / `input_required`；视觉质检虽把硬检查标为 pass，却放行了未由本次任务逐项确认的营销扩写和明显的源图矩形边缘。因此该候选不是合格成品，未采用、交付或发布。供应商准确账单与累计余额未取得；本轮不重新提交图像请求，不对本地重合成候选购买第二次视觉质检。原始作业、候选、回执和阻断状态原样保留。
- 新源码将有完整候选证据的参考因素 `fail/uncertain` 保留为软性验收提示，硬检查通过时交用户决定；缺失证据仍阻断。正式绑定任务的模型文案仅保留包装核验后的产品标题，其余使用所选语言的安全文案，避免把企业资料中的宽泛营销主张误当作本次确认；源产品照片的外缘做本地柔化。工作台明确展示结构偏差且不自动付费重做。用已付费底图制作的本地视觉证明保存在预览 `data/acceptance/rs005-local-recomposition-proof.png`，它没有新付费调用、没有独立质检，不是可采用的正式候选。
- 定向图文测试 30/30、图文管线 88/88 与 HTTP/合同/治理、会话 25/25、图文 UI 六场景、TypeScript、架构扫描（3003 个生产 TS）、204 项迁移清单只读检查、生产构建和 `git diff --check` 通过。新源码的下一次真实成片验收仍需独立预算和费用可核回执；本次未推送、部署、发布、采用成片或执行目标库迁移。前节的“正式任务尚未创建”是当时状态，以本节为准。

## 当前统一开发基线：图文会话预算准入与本地锁恢复（2026-10-27）

- 权威分支 `baseline/unified-20261026` 在 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026` 从 `f8939eba` 快进至 `0d7439bf`；隔离来源为 `codex/image-budget-gate-20261027`。原未提交的 `server/videos/videoVisibilityMaintenance.ts` 保留且未纳入。
- 图文复刻会话可填单条费用上限并随草稿恢复；未填时仍可入队，但图文任务不继承短视频 15 元默认上限，付费策划、出图、质检前由 worker 返回 `social_image_budget_required`。这只建立明确的预算准入，不构成跨节点累计费用强制账本；供应商真实费用和余额仍须独立核对。
- 本地丰富预览的数据目录出现 10 月 20 日遗留的 `durable_operation_leases.json.lock`，使创建任务返回 `social_content_mutation_unavailable`。停止对应 web 服务后使用仓库锁恢复服务按文件哈希核验、隔离遗留锁并保留审计记录；业务 JSON 哈希未变化。重启后会话可将面霜任务持久入队。两个带旧默认 15 元上限的诊断任务 `socialtask_d739f15322f971c924f9a117`、`socialtask_5109d415a248f684e7355462` 均已取消，队列未领取、无付费请求。正式 5 元任务尚未创建。
- 隔离分支通过图文语言/会话 25/25、图文管线 88/88、HTTP/合同/治理、预算定向 6/6、图文 UI 六场景、`pnpm run lint`、`pnpm run check:architecture`（3003 个生产 TypeScript 文件）、`pnpm run check:digital-employee-migrations`（204 项只读）、`pnpm run build`、`git diff --check`。尚未对新源码做同版本真实供应商 E2E；未推送、部署、发布、采用成品或运行目标库迁移。

## 当前统一开发基线：图文完整调度恢复与一次本地修复（2026-10-26）

- 权威工作树与分支仍为 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026` / `baseline/unified-20261026`；本次源码提交 `b677c726`。原未提交的 `server/videos/videoVisibilityMaintenance.ts` 补丁未纳入，保留在工作树。
- 图文爆款复刻仍走统一内容任务和持久队列。免费像素/OCR 硬检查现在先于付费视觉质检；单图文字确定性失败且底图、产品、原候选血缘及字节均可验证时，使用原底图与权威产品图本地重排一次，原候选标记为 `superseded`，新版本回到质检；不再购买第二张底图。任务恢复时跳过已有候选的重新策划/出图，并根据持久的原质检回执防止重启后绕过追加付费质检门禁。
- 用户确认的规则：无单项费用上限也允许先入队；本地排版修复仅一次；追加付费视觉质检的预算余额不明则暂停；参考结构相似度软指标为 `uncertain` 且硬门槛通过时标明不确定并交用户验收。完整决策与限制见 [图文持久审阅与修复 ADR](../architecture/adr/2026-10-26-social-image-durable-review-and-repair.md)。
- 图文管线 88/88 及 HTTP/合同/治理检查、调度和合成定向测试 24/24、`pnpm run lint`、`pnpm run check:architecture`（3002 个生产 TS）、`pnpm run check:digital-employee-migrations`（204 项只读）、`pnpm run build`、`git diff --check` 均通过。本次没有新建真实付费任务或调用供应商，没有迁移目标库、推送、部署、采用成品或发布。图文费用的供应商账单与跨步骤预占账本仍缺失，因此不能声称实际费用上限得到系统强制保证；追加付费质检保持暂停，直到费用和授权可核实。此前真实任务仍在用户验收，不视为本次新源码的真实复验。

## 当前统一开发基线：图文单任务真实联调到用户验收（2026-10-26）

- 权威工作树与分支仍为 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026` / `baseline/unified-20261026`；隔离修复 `06354c9b` 合入为 `49157cc2`。修复固定合成器的长标题自动换行、辅助文字逐行排版和源产品照片的纵横比；参考文字因素在左上时将标题/产品分列，OCR 因换行分块时按同一区域顺序合并验证。原未提交视频补丁未纳入。
- 已冻结任务 `socialtask_d1f3157acd9de646d61eb123` / `img0b279af90bb0` / durable job `22b2670c58984c2` 用与冻结记录 SHA-256 一致的本机冗余对象副本恢复素材读取。原作业策划检查点未重提，GPT Image 2 仅提交一次背景底图，持久素材 `f0741cbd-62c8-5c3b-a47d-08a5323f177b`。首版 `bcede0ed-8851-57c4-817e-5c44c460a44a` 因标题裁切导致 OCR 硬门槛失败，保留为 superseded 历史；使用同一底图和原企业主图做零额外出图调用的本地重合成，得到第 2 版素材 `01f5cee4-5540-504d-984e-80b186dbd906`，SHA-256 `495524f4982e6443a579b21bb184c1c984e6a455908851ec63d178f248e47c0d`。
- 第 2 版正式视觉质检回执为 completed，全部硬门槛通过，参考注意区与文字层级两个因素均 pass；结构相似度 soft 检查为 uncertain，自动导演审查仍判定 `accept_for_user_review`。原 durable job 为 `succeeded`，节点 `candidate_generation`、`quality_check`、`director_review` 均 completed，`user_approval` 为 needs_review，尚未由用户批准、交付或发布。运行数据中的 GPT Image 2 回执为 completed，准确供应商账单仍未取得，不能据此断言实际花费；本轮仅执行获批任务的一次出图及必要策划/质检，无结果不明请求的自动重试。
- `pnpm run test:social-image-pipeline`（86/86 图片主用例、HTTP/合同/治理）与新增参考策略/排版定向测试 10/10、`pnpm run lint`、`git diff --check` 通过。本地预览前端 5365 返回 200、web 9065 加载提交 `49157cc2`；9065 的全局 ready 为 degraded（本地禁用 PocketBase 且 web-only），不等于该任务失败。未执行目标库迁移、推送、部署或发布。旧节记录的是修复前状态，以本节实测任务回执为准。

## 当前统一开发基线：图文参考版式与素材不可读修复（2026-10-26）

- 权威树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`、分支 `baseline/unified-20261026`，起点 `737d7097551e3682635a5c24e46c66fc7a2aa544`。隔离分支 `codex/image-task-provider-path-20261026` 的后续提交 `81f5a6c9`、`c32fd25b`、`1686080f`、`3aece24d` 分别合入为 `21473736`、`de22df67`、`2f4e7a92`、`d6cda73e4922e7e97e671064c5c1e7c35fa09e2d`；中间治理证据提交 `4a0884fd`。原未提交 `server/videos/videoVisibilityMaintenance.ts` 补丁未纳入，SHA-256 仍为 `ed50ec18853d813c6307d1c7dd9ff1c7d020ec37735282d44ea368ff334a289b`。
- 策划解析对缺失 hashtags 做空数组处理；参考版式先从可读 OCR 选标题区，再于不同列选择显著产品区，避免把大标题当产品焦点；本地图层合成及付费出图准入在冻结参考图重新读取不到时均返回 `social_image_reference_unreadable`，与已读取但哈希不符的 `social_image_reference_bytes_changed` 区分。单图固定产品身份合成仍沿用下节 ADR。
- 本次获批独立预算上限 5 元，限新任务单张图及必要策划/质检，不发布且不自动重复结果不明的付费请求。第一个新任务 `socialtask_b3801b030d86fa7bd421efcb` / `imgce339d1b736e` / job `00cf00be48724c1` 在参考版式校验处阻断，仅有 `image.confirmed` 检查点、0 供应商回执，未提交付费请求。第二个替代任务 `socialtask_d1f3157acd9de646d61eb123` / `img0b279af90bb0` / job `22b2670c58984c2` 在基线 `de22df67` 下完成 Qwen 图文策划检查点；尚无图片供应商回执，随后因本机素材目录访问失效阻断。Qwen 策划可能已计费，准确账单未取得，不宣称本预算尚余确定金额。
- 替代任务冻结的爬取参考为 `history-image-18a82c3360bc2e222f74ad5f` 第 4 张，来源为本地历史 Apify 图片、仅供结构分析；原图 SHA-256 `dc7d51c39152028af9303b51c0dad9e77124d3c6895d7e3a5e3faeb5025da169`。企业产品 `GUIANFA-RS-001` 主图原 SHA-256 `c9673dc0eb6fc0be4dff188ae7a23c520dcfc07054e71f483d666a7608178548`，资产清单已核为可读且授权。随后 `Documents/ChatGPT/1026图文创作版本` 对本地进程返回 `Operation not permitted`，参考图及主图都无法重新读取；第二条作业停在旧源码的 `social_image_reference_bytes_changed`，实质是不可读，未提交 GPT Image 2 出图。原作业和快照均保留，不重写或盲目重跑。
- 隔离修复及合入后权威树均通过 `pnpm run test:social-image-pipeline`（86/86 主用例、HTTP/合同/治理检查）、`pnpm run lint`、`pnpm run check:architecture`（3001 个生产 TS，权威树相对 `737d7097` 棘轮）、`pnpm run check:digital-employee-migrations`（204 项只读）及 `git diff --check`。参考第 4 张的本地离线版式分析在新规则下通过，产品区为右上、标题区为左上。未运行全仓 `quality` / `verify` 或目标库迁移，未推送、部署、发布；真实付费成片 E2E **未通过**。
- 安全恢复点为 `737d7097`、源码提交 `d6cda73e` 和两条原样保留的作业。下一步先恢复并验证本机素材目录访问，核对 Qwen 已发生的费用/回执，再考虑对第二条已阻塞作业作显式队列重试。其 `image.planning` 已完成、`director_brief` 已落库，当前实现可跳过再次调用 Qwen；任何继续执行前须核对源字节哈希、预算和唯一领取权。不得把 0 图片回执解释为 0 总费用。

## 当前统一开发基线：图文任务成片身份与文字修复（2026-10-26）

- 权威树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`、分支 `baseline/unified-20261026`，从 `f71a4aaed8c169dbeee8a964ba353aa2cd11fb3f` 合入隔离功能提交 `923292ad9d6909e88fe458cf9ccb0874955d6d60`，源码提交 `f2fa748320bd9b6c5d766641b2981eedc7ae77de`。原失败任务与运行数据没有重写；原未提交视频文件补丁 SHA-256 保持 `ed50ec18853d813c6307d1c7dd9ff1c7d020ec37735282d44ea368ff334a289b`。
- 真实联调任务 `socialtask_3b51abf46eac93ba47d5d4bf` / 图片任务 `img341321fdf7c2` / 队列作业 `4e7bf3cb5980f9c` 已完成 Qwen 策划、一次 GPT Image 2 出图及一次视觉质检，但停在 `review_required` / `social_image_quality_requires_review`。成片素材 `631b31a3-6d99-4678-887d-2c4c76b591d5`：产品盒写 `Cleansing Honey`，生成标题写 `Cleansing Mousse`，且有未经证实的临床/商业文案；同时旧质检把英文图中的中文事实误作逐字必现。该任务不重试或改判通过。供应商费用没有准确账单回执，不宣称花费为 0 或预算仍有确定余额。
- 新源码令持久单图 worker 只向 GPT Image 2 购买无产品、无文字的背景底图，先持久保存底图，再用已有固定合成器叠加原企业产品完整像素与三处短文案。策划前本地读取已绑定主图的包装 OCR 提示并拦截明显不同的英文品类词；未确认临床声明被剔除；质检按选定语言理解已核实事实，仍拦截包装名称矛盾。手动 Studio 路由及 GIF 路线保持原实现。决定见 [单图固定身份合成 ADR](../architecture/adr/2026-10-26-social-image-fixed-identity-composition.md)。
- 隔离开发树验证：图文定向 19/19、`pnpm run test:social-image-pipeline` 86/86 主用例及 HTTP/路由/工作台/治理合同通过，`pnpm run lint`、相对 `f71a4aa` 的 `pnpm run check:architecture`（3001 个生产 TS）、204 项迁移清单只读检查、`pnpm run build`、`git diff --check` 通过。权威树合入后图文定向 19/19、同一图文管线、TypeScript、相对 `f71a4aa` 的架构棘轮、204 项迁移清单只读检查与 diff 检查通过。没有运行全仓 `quality` / `verify`，没有迁移目标数据库、推送、部署或发布。
- 源码修复尚未取得新版本的真实付费成片验收；当前预览后端也须重启才会加载新源码。早前一次新任务预算上限为 5 元、仅一张图片及必要策划/质检，已经实际发生一张图与质检，准确费用和再次付费范围未核实。复验须在同版本 web/worker/store 下另建冻结任务，先核对新预算和唯一提交权，再只执行一个作业。安全恢复点为 `f71a4aa` 与保留的原任务/供应商回执。

## 当前统一开发基线：对标文案归因修复（2026-10-26）

- 权威工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`，分支 `baseline/unified-20261026`；从 `3ca75fdc17ac25ce6b885353d614a03b2074db61` 合入隔离提交 `3a327a48132f7dcace8b2d548f376083fb53fa9c`，源码 HEAD `ae5d3bb8df4e0debc26a037298c2c589f03cd4b8`。
- 爆款参考帖的竞品标题和文案不再作为本企业商业声明或用户确认要求传给 Qwen；只传已测量版式及企业产品主张。模型自行编造的商业主张在策划草稿中被剔除，不能转化为用户待确认字段。收到策划结果但需复核时，持久检查点明确记录已返回且需复核，不再保留“请求已开始”的含混状态。
- 隔离源码通过图文执行定向 14/14、`pnpm run test:social-image-pipeline`（全部阶段退出 0）、`pnpm run lint`、`pnpm run check:architecture` 及 `git diff --check`；合入基线定向 14/14、`pnpm run lint`、`pnpm run check:architecture`（2999 个生产 TS 文件，相对 `3ca75fdc` 棘轮）、`pnpm run check:digital-employee-migrations`（204 项只读）及 `git diff --check` 通过。未运行全仓 quality/verify。
- 第一条 5 元上限新任务 `socialtask_63198b5515ec1182318b1b6e` / `imge732b0a76b4a` / job `3a80233b6ee3a14` 在旧版策划逻辑下取得 Qwen 草稿后因竞品 OEM/私标字样被误判为待确认而阻塞；图片供应商未提交，无出图回执。其已付策划结果不重提。另一条准备失误任务 `socialtask_ceb2ced4328be670f49f7ada` / `img157568998db6` / job `c231da3431ba335` 未领取、无供应商请求，已显式暂停。下一步仅在同版本 Web/受限 worker/本地对象存储和剩余预算核对后，创建全新冻结任务验收一张真实图片。
- 权威树原有未提交 `server/videos/videoVisibilityMaintenance.ts` 补丁仍未纳入。没有推送、部署、发布或目标库迁移。

## 当前统一开发基线：图文策划请求边界修复（2026-10-26）

- 权威工作树仍为 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`，分支 `baseline/unified-20261026`；在下方 `23505d4ce58d46043e831214a66c6d8f7691e943` 之后，经治理提交 `74b22ab05ee44d7919d30270f0caf5d13ca0e73e` 合入修复提交 `2136b5e8c7fe7d53d972638ddbe529eca329517b`。隔离来源提交为 `7ca41d3f2b9bf96db151d45628abaf7a322e9955`。
- Qwen 策划检查点仅在真正提交供应商请求前写入；输入校验及配额拒绝不再误报为付费结果未知。历史超时任务的页面回执明确显示结果待核对，禁止盲目重试。旧任务 `socialtask_0ac6dfaacc2900a069b28f02` / `img80093c5e51d9` 仍保留阻塞状态。
- 本版定向图文执行测试 12/12、`pnpm run lint`、`pnpm run check:architecture`（2999 个生产 TS 文件，相对 `74b22ab0` 棘轮）、`pnpm run check:digital-employee-migrations`（204 项只读）及 `git diff --check` 通过；未重复运行全仓 quality/verify 或真实付费 E2E。Web 预览仅用 `PROCESS_ROLE=web`，需要受限 worker 领取新的任务；运行状态与源码验证独立判断。
- 权威树原有未提交 `server/videos/videoVisibilityMaintenance.ts` 补丁 SHA-256 为 `ed50ec18853d813c6307d1c7dd9ff1c7d020ec37735282d44ea368ff334a289b`，未纳入图文提交。没有推送、部署或发布。新任务真实联调须在独立批准的 5 元上限内，只生成一张图并记录回执。

## 当前统一开发基线：图文任务正式出图路径（2026-10-26 本地快进）

- 本节覆盖下方历史“当前”声明。默认分支为 `baseline/unified-20261026`，权威工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`；从 `9b5f5446d858d1ea4aa9db401bc7e77d5e3d1213` 快进到源码提交 `23505d4ce58d46043e831214a66c6d8f7691e943`。隔离实现分支 `codex/image-task-provider-path-20261026` 保留为恢复点。
- V3 图文爆款复刻单图任务在参考图证据和企业素材预检后，编译正式出图方案；持久 worker 与手动工作区共用 GPT Image 2 的图片提交、素材落库和原子回执。仅获准作为模型输入的参考图会传递原图；其他参考只传已测量的版式结构。旧版已冻结本地图层任务仍可按原合同恢复。付费策划超时保留结果不明状态，不自动重复请求。
- 隔离源码与合入后基线均通过图文执行定向测试 10/10、`pnpm run test:social-image-pipeline`（85/85 主用例及 HTTP/合同/治理）、`pnpm run lint`、`pnpm run check:architecture`（2999 个生产 TS 文件，相对 `9b5f5446` 棘轮）、`pnpm run check:digital-employee-migrations`（204 项只读）、`pnpm run build`、`git diff --check`；隔离源码另通过 `pnpm run test:image-replication`（24/24）与 `pnpm run test:image-replication-ui`（6 场景）。未运行全仓 `quality`/`verify`。
- 这仅证明源码与本地无付费回归。原任务 `socialtask_0ac6dfaacc2900a069b28f02` / `img80093c5e51d9` 已有结果不明的 Qwen 策划检查点，不自动迁移或重试；真实供应商回执、累计费用与 5 元上限尚待核对，未执行本轮付费出图。下一步是在稳定基线、同版本 web/worker/store 和预算核对后创建新任务做一次真实验收。没有推送、部署、发布或目标库迁移。
- 权威树原有未提交 `server/videos/videoVisibilityMaintenance.ts` 补丁 SHA-256 仍为 `ed50ec18853d813c6307d1c7dd9ff1c7d020ec37735282d44ea368ff334a289b`，未纳入本次源码提交。设计取舍见 [图文正式出图 ADR](../architecture/adr/2026-10-26-social-image-durable-provider-route.md)。

## 当前本机集成基线：快捷卡片回复优化 v2（2026-10-27）

本节覆盖下方旧基线声明。工作树 `/Users/jiejie/Documents/lingshu-AI`、本地基线分支 `节节1025服务器上传`，从 `e572161f1d7f2b77bb1ed50c1d6520e23cc3e7aa` 推进到源码封装提交 `f5486b4dd10f6b1e407381e5c2f0134d5905b98d`；本治理补记另行提交。用户指定本次 GitHub 新分支为 `快捷卡片回复优化v2`，旧版交付分支不移动。

- 本次修改已位于基线工作树，按明确的 15 文件清单提交，不重复合并其他分支。包含新手引导目标市场/买家选项、首页输入文字上移、来源跳转按钮及按需视频预览；主要文件为 `DigitalEmployeeOnboardingSteps.tsx`、`onboardingMarketOptions.ts`、`creator-workspace.css`、`AgentReply.tsx`、`AssistantSourceLink.tsx`、`assistantSourceLinks.ts` 和共享固定资讯目录 `shared/authoritativeNewsSources.ts`，连同相关测试及 UI 规范。没有加入 `.env.local`、账号凭据、素材、运行缓存或数据库内容。
- 上一轮对这份源码实际执行 `NODE_OPTIONS=--max-old-space-size=4096 pnpm run lint --pretty false`，退出 0；本轮核对修改范围没有变化，复用该 TypeScript 结果，不重复启动重型检查。
- 本轮重新执行以下必要检查：定向回归 16/16，3009 个生产 TypeScript 文件架构及相对 `e572161f` 的预算 ratchet、205 项迁移清单只读检查、checksum guard 和 `git diff --cached --check` 全部通过。检查在提交前的同一暂存源码上运行；迁移与清单没有变更。

```sh
node --import tsx --test --test-concurrency=1 src/components/smartBusiness/onboardingMarketOptions.test.ts src/lib/assistantSourceLinks.test.ts src/components/AgentReply.readable.test.tsx src/components/ContentCreationHome.contract.test.ts src/components/DigitalEmployeePage.contract.test.ts server/externalInformation/authoritativeNews.test.ts src/lib/inspirationVideoPlayback.test.ts
ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture
pnpm run check:digital-employee-migrations
pnpm run test:migration-guard
git diff --cached --check
```

- 推送前已确认远端新分支不存在，规范 origin 为 `https://github.com/lingshu-ai-cloud/lingshu_AI.git`。工作流的部署/回滚仅手动触发，push 构建仅匹配 `v*` 标签，普通新分支推送不触发部署。未创建 PR、未执行部署、数据库迁移、真实供应商或付费调用，无外部 run/task 标识；未重复全仓 quality/verify 或构建。
- 已知验证边界：普通资讯页面只跳转原文；视频直链和支持的平台链接提供点击后加载的预览，但本次未验证各真实平台的播放/嵌入限制。前轮新增的会话生命周期迁移仍未应用于目标数据库。源码封装不代表真实供应商 Ready 或生产发布就绪。
- 安全恢复点为旧版分支 `快捷卡片回复优化` / `e572161f1d7f2b77bb1ed50c1d6520e23cc3e7aa`；其他工作树、其未提交现场以及图片 AIGC 保留树未触碰。下一步仅在另行授权后执行真实平台验收或部署。

## 当前本机集成基线：快捷卡片回复优化（2026-10-27）

本节覆盖下方阶段性“待确认”状态。工作树 `/Users/jiejie/Documents/lingshu-AI`，本地基线分支 `节节1025服务器上传`；用户指定本次 GitHub 交付新分支为 `快捷卡片回复优化`。以下为源码 SHA，本治理补记另行提交，随同一基线快照交付。

- 本会话封装 `75b330e058afc1df93fae2ffbfbddd342a616b56` 保留；第一来源 `codex/assistant-conversation-management-20261027` / `eeb936f8025519dca1e1049d527381dec4e4a156` 已通过 `8d7ade7a7b484ab124a2b06696cbfe0d92c8d32b` 合入。
- 用户确认兼容方案后，第二来源 `codex/session-ui-onboarding-20261027` / `7a1e2422b9d2a0a4b7644d84d3af9abef3c0c253` 合入为 `bc060fb8852c3d98d4f6ffcfda6e10bb491cdac1`。三处冲突保留现有 `strategy.ts` 内部简短回复与固定资讯来源分流、`AssistantConversationBubbles.tsx` 的对话内业务选择及 `useAssistantSend.ts` 的快捷任务分派；同时接入新手引导重启、产品稍后设置、草稿与确认契约变更，没有覆盖会话清空/删除隔离保护。
- 合成后 TypeScript 找到新手引导跳过产品时可能访问空 `current.strategy`；以可选链修复，提交 `e7c9129b4497d8b38fffde386d5443568175f3cf` 为最终源码检查点。没有扩展业务流程或放宽产品确认/来源核验门禁。

实际必要检查：

```sh
node --import tsx --test --test-concurrency=1 src/components/assistant/globalAssistantRuntime.hydration.test.ts src/components/assistant/useAssistantThreadSaveQueue.test.tsx server/routes/assistantThreads.actions.test.ts src/components/assistant/useAssistantSend.test.tsx src/components/HomeGrowthTour.test.ts shared/contracts/enterpriseOnboarding.test.ts src/components/ContentCreationHome.contract.test.ts src/components/DigitalEmployeePage.contract.test.ts server/routes/strategy.grounding.integration.test.ts shared/assistantReadableReply.test.ts
node --import tsx --test --test-concurrency=1 shared/contracts/enterpriseOnboarding.test.ts server/routes/enterpriseOnboardingDraft.test.ts
NODE_OPTIONS=--max-old-space-size=4096 pnpm run lint --pretty false
ARCHITECTURE_BASE_REF=2276b7b14a8aea1a758df296e215c890c8b4ea36 pnpm run check:architecture
pnpm run check:digital-employee-migrations
pnpm run test:migration-guard
git diff --check
```

- 首组 42/42 通过；空值修复后的新手引导合同/草稿 11/11 通过（含重复合同用例，不作为额外独立覆盖计数）；完整 TypeScript 复跑退出 0。3005 个生产 TypeScript 文件架构与相对 `2276b7b1` 的预算 ratchet 通过；205 项迁移清单及 checksum guard 通过，后续空值修复未改变迁移；diff 检查通过。
- 本地前端 `http://127.0.0.1:5181/` 返回 200，后端已在最终源码以 `PROCESS_ROLE=web` / `backgroundJobs=false` 重启。`/api/overseas/health`、美妆预览账号的 `POST /api/overseas/auth/local-preview-session` 和 `GET /api/overseas/auth/me` 均返回 200，账号仍为 `local_user_customer_aurelia_beauty` / `local_tenant_customer_aurelia_beauty`。未复制或提交账号密钥、`.env.local`、素材或缓存；登录接口检查不等于浏览器视觉验收或真实供应商验收。
- 推送前核对仓库工作流：部署/回滚为手工触发；构建推送仅匹配 `v*` 标签，普通新分支不触发部署。未创建 PR、未执行部署或数据库迁移，未做真实模型/渠道/付费调用，无外部 run/task 标识。遵照用户要求未重复全仓 `quality` / `verify`、构建或真实 E2E；新会话生命周期迁移尚未应用于目标数据库，不能声明生产发布就绪。
- 安全恢复点：`codex/recovery-pre-quicktasks-integration-20261027-0c4fda22`、完整会话封装 `75b330e0` 和第二次合并前检查点 `2276b7b1`。两个来源工作树及其他未提交现场未改动，图片 AIGC 保留树未触碰。下一步如需发布，须另行授权并核验目标库迁移与真实供应商状态。

## 当前本机会话阶段性基线：快捷任务封装与会话管理合入（2026-10-27）

- 工作树 `/Users/jiejie/Documents/lingshu-AI`、分支 `节节1025服务器上传`。在 `0c4fda229bf564dbde2120e446aec5e9f6ba8397` 上封装本会话 53 个源码、测试及说明文件为 `75b330e058afc1df93fae2ffbfbddd342a616b56`；不包含忽略的 `.env.local`、账号资料、素材或运行缓存。
- 第一条来源 `codex/assistant-conversation-management-20261027` / `eeb936f8025519dca1e1049d527381dec4e4a156` 已按用户顺序无冲突合入，合并提交 `8d7ade7a7b484ab124a2b06696cbfe0d92c8d32b`。新增会话清空/删除及隔离保护；带入迁移 `1793059200_assistant_conversation_lifecycle.js` 和校验和，但未执行任何数据库迁移。
- 第二条来源 `codex/session-ui-onboarding-20261027` / `7a1e2422b9d2a0a4b7644d84d3af9abef3c0c253` 仅运行 `git merge-tree --write-tree` 预检，在 `server/routes/strategy.ts`、`src/components/assistant/AssistantConversationBubbles.tsx`、`src/components/assistant/useAssistantSend.ts` 发现三处冲突。按安全合并约定停止并等待用户决定；没有写入工作区、没有开启未完成的 merge，也没有自动选择任一侧覆盖。
- 验证边界：封装快照此前实际通过 4 GB Node 堆 `pnpm run lint --pretty false`、对话接口 2/2、会话保存 12/12、布局合同 3/3、3002 文件架构及相对 HEAD 的预算 ratchet、`git diff --check`，详见 `docs/runbook/ASSISTANT-QUICK-TASK-20261027.md`。第一条分支合成后仅完成 Git 合并/差异检查；合成后的 TypeScript、受影响领域回归和 205 项迁移清单只读检查待第二条冲突确认后执行，不能把封装前结果写成合成后的整体验收。
- 恢复分支 `codex/recovery-pre-quicktasks-integration-20261027-0c4fda22` 保留原起点；`75b330e0` 是包含本会话全部修改的合并前恢复锚点。两个来源工作树及其未提交现场均未改动，保留的图片 AIGC 工作树未触碰。未推送、部署、真实供应商/付费调用或生产写入，无外部 run/task 标识；源码推进不代表预览运行实例或真实供应商 Ready 已同步。

## 当前本机会话基线：本地预览周计划递归修复（2026-10-26）

- 当前工作树 `/Users/jiejie/Documents/lingshu-AI`、分支 `节节1025服务器上传` 在合并基线 `bc432cc2ac8dbc88efbc4fe89c176b318b550ddd` 上追加运行修复 `e69efa9ba1e21107021b5bf99e501df4b454c49b`。本地经营总览读取包含“已确认日期、未确认时间”的历史周计划时，`repairCollapsedWeeklyVideoProduction` 会对无变化的排期结果递归调用自身并导致后端栈溢出；现在仅在排期字段实际变化时继续修复，日期已确认但时间待定的业务语义保持不变。
- 实际通过 `server/digitalEmployees/weeklyPackage.test.ts`、4 GB Node 堆上限 TypeScript、相对 `bc432cc2` 的架构/ratchet（2,998 个生产 TypeScript 文件）及 `git diff --check`。首次新增回归夹具因没有设置已确认日期而正确触发自动排期，修正为真实现场状态后通过；生产门禁未放宽。
- 本次修复只为恢复当前本地预览可用性，不涉及迁移、真实供应商、付费、发布或部署。预览进程和登录后页面仍须在该提交启动后单独核验。

## 当前本机会话基线：助手业务场景与平台改写兼容合并（2026-10-26）

- 当前工作树 `/Users/jiejie/Documents/lingshu-AI`、分支 `节节1025服务器上传` 从干净检查点 `0f1424553666fb03a1a0616dbedecaebcb04a613` 合入远端 `xixi分工前本地合并` / `9b5f5446d858d1ea4aa9db401bc7e77d5e3d1213`，源码合并提交为 `8d23c0ace56a4a136d5e34a2bb4c02c5f12f8a93`。恢复分支 `backup/pre-xixi-local-merge-20261026-0f142455` 保留。
- 唯一冲突是 `docs/governance/BASELINE.md` 顶部双方新增的治理记录；本机现状保持在最上方，来源的助手场景与平台改写验证证据完整保留为来源历史。双方都改动的 `src/components/GlobalAssistant.tsx` 自动合成，既保留当前 `reduceMotion`/灵小枢入口，也接入新的 `BusinessSceneSelection` 事件参数，无业务代码冲突。
- 合成结果实际通过：业务场景与平台改写 14/14、图文复刻 24/24、完整 `pnpm run test:assistant`；4 GB Node 堆上限 TypeScript、相对 `0f142455` 的架构/ratchet（2,998 个生产 TypeScript 文件）、204 项迁移清单只读检查、迁移 checksum guard 和 `git diff --check` 通过。
- 来源分支已记录产品素材、V4、投流和构建等更大范围证据，本轮未重复执行全仓 `quality` / `verify`、构建或真实 E2E。未推送、部署、执行目标数据库迁移、真实模型/渠道/付费调用或生产写入；本地预览版本仍与源码基线分开核验。

## 当前本机会话基线：差图文创作加联调兼容合并（2026-10-26）

- 当前工作树 `/Users/jiejie/Documents/lingshu-AI`、分支 `节节1025服务器上传` 从干净检查点 `c3addcd54e41ab07fc3f924feef1d6a6fa97c5e6` 合入远端 `差图文创作加联调` / `072c343baabc99da9a6ad975d438503740f33799`，源码合并提交为 `55be5c306aa5d65c727ca493b5a5712b110baf69`。恢复分支 `backup/pre-image-text-merge-20261026-c3addcd5` 保留。
- 147 个来源源码、测试和产品文档文件均无冲突；唯一冲突为 `docs/governance/BASELINE.md` 顶部双方同时新增记录。解决时保留本机既有三路合并记录，并完整保留来源的企业知识、图文持久调度、口播卖点和新人首页验证证据，明确标注为来源历史，不把来源机器路径误写成本机事实。
- 合成结果实际通过：图文复刻 24/24、持久化图文执行 7/7、企业知识/产品素材/首页首访组合 40/40、图文生产管线 85/85 及其 HTTP、路由合同与治理检查；4 GB Node 堆上限 TypeScript、相对 `c3addcd5` 的架构/ratchet（2,983 个生产 TypeScript 文件）、204 项迁移清单只读检查、迁移 checksum guard 和 `git diff --check` 通过。
- 来源分支已经记录构建和更大领域测试；本次遵循非重复验证要求，没有重跑全仓 `quality` / `verify`、构建或真实 E2E。未执行目标数据库迁移、真实供应商/付费调用、推送、部署或生产写入；本地预览版本与源码基线仍须分别核对。

## 当前本机会话基线：三路兼容合并（2026-10-26）

- 当前工作树为 `/Users/jiejie/Documents/lingshu-AI`，分支 `节节1025服务器上传`。本轮从干净提交 `181868f3f9bad2ff437f124018e9decf5ababb59` 开始，依次合入 `灵小枢交互卡片基础修改` / `f2ea282c1ec60aedfab46569d1323ad49bbf2e7d`、`codex/lingxiaoshu-mascot-ui-20261025` / `236d17bfd2c4e306f494cafde74dabebf9ac1059`，再合入远端 `xixi全局ui+对话部分快捷键+生产联调未完成` / `7cb757c10c9857ed7c0fbbda2b84396021e6bcd0`；三个合并提交依次为 `7f4747f162b8bc16d0a4e7ba92f779dfa152607b`、`dd0036592d8777633c00e79dd69406d0b30d679a`、`17b290d9e22cee84efe863678d0ba601e0f2e07b`。恢复分支 `backup/pre-session-merges-20261026-181868f3` 保留。
- 前两路无冲突；第三路只在 `src/components/assistant/AssistantConversationBubbles.tsx` 冲突。按用户确认的兼容方案，同时保留新版 `AssistantMascot` 与 `reduceMotion`，以及远端 `CompanyReportCard`、首页用户消息布局类；没有删除任一侧功能，也没有遗留冲突标记。
- 实际通过 `pnpm run test:assistant`、`pnpm run test:assistant-quality`（145 项：144 通过、1 项按环境条件跳过）、`AssistantMascot.test.tsx`（3/3）、4 GB Node 堆上限 TypeScript、相对 `181868f3` 的架构/ratchet（2,955 个生产 TypeScript 文件）、204 项迁移清单只读检查、迁移 checksum guard 及 `git diff --check`。远端来源已经记录更大范围的分段质量、构建和领域证据；本轮没有重复执行全仓 `quality` / `verify` 或真实 E2E，不能据此声明真实供应商、运行数据或发布就绪。
- 第二个来源工作树存在 14 项未提交草稿，本轮仅合入其已提交分支 `236d17bf`，未读取为基线、未清理、未覆盖。未推送、部署、执行目标数据库迁移、真实付费调用或生产写入；源码基线与当前预览进程/本地数据仍是独立状态。

<!-- 以下为本次及此前来源分支的历史验证记录，不改变上方本机会话基线声明。 -->

## 当前统一开发基线：助手业务场景与多平台改写（2026-10-26 最终本地合并）

- 本节覆盖下方历史“当前”声明。默认分支仍为 `baseline/unified-20261026`，权威树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`；本地版本分支 `差图文创作加联调` 同步保留最终结果。起点 `072c343baabc99da9a6ad975d438503740f33799`，来源 `feature/assistant-scene-backend-closure-20261026` / `ca40301f0fb8364d2a39b49ee6532603febb29d2`，双亲源码合并 `58e103131019be049345b25c6f9afb3ad7ec00d8`；后续提交只补记治理证据。
- 用户仅授权合入经营/客户/投流场景查询与多平台改写继续创作。纳入 `efe54f4d`、`ca40301f` 两个提交，保留当前企业知识库、产品素材关联和图文持久队列；没有夹带媒体404、单条任务界面、本地执行器或视频排序补丁。草稿恢复与素材读取保护同时保留。
- 合并结果定向20/20、产品素材17/17、图文24/24、V4生产75/75、完整助手脚本、投流74个测试文件、TypeScript、2997文件架构/相对072c343b棘轮、204项迁移只读检查、主站/账号中心构建与diff检查通过。
- 助手质量164/165：唯一失败为原卡片顺序断言，在原072c343b权威树再次复现。quality通过前置门禁及本地生产运行检查后，在既有M1用例因受控外网禁止访问api.heygen.com而失败；断言失败后进程驻留，仅终止本轮隔离测试进程组。后续quality阶段未执行，未运行verify，不宣称全仓质量全绿。
- 原权威树未提交 `server/videos/videoVisibilityMaintenance.ts` 的完整补丁SHA-256仍为 `ed50ec18853d813c6307d1c7dd9ff1c7d020ec37735282d44ea368ff334a289b`，未纳入提交。干净候选检出 `/Users/julia1/.codex/worktrees/assistant-scenes-final-20261026` 可用于同版本复核。恢复点 `backup/pre-assistant-scenes-final-20261026` 保留原072c343b。
- 本次仅本地合并，未推送、部署、真实模型/渠道/付费验收或目标库迁移。来源功能树和其他未提交现场保持原位。详细范围与实际命令见 [最终本地合并记录](ASSISTANT-SCENES-FINAL-INTEGRATION-20261026.md)。

## 当前统一开发基线：差图文创作加联调（2026-10-26）

- 本节覆盖下方历史“当前”声明。默认分支继续为 `baseline/unified-20261026`，权威工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`；同名版本分支 `差图文创作加联调` 保留合并结果。起点 `a0d965ae9af64ef2a6229198b496fa7a168f3374`，来源 `feature/enterprise-knowledge-20261026` / `969665d7aa4bb37610ed6220d9be3cf4c4a9e000`，源码合并 `ddd146831e25d0ee3fc269fe63b2140c9ed43a3f`；后续治理提交不改变生产源码。
- 合入分层企业知识库、租户专属场景知识包编辑、产品稳定ID与素材默认选择及任务/草稿恢复修复；保留最新首页、卖点及图文持久调度。仅两处冲突按双方新增规则和字段最小合并，没有新增迁移、依赖或平行业务链路。
- 领域组合66/66、图文24/24、V4 75/75、TypeScript、2982文件架构/相对a0d965ae棘轮、204项迁移只读/guard、主站与账号中心构建及diff检查通过。助手150/151，原基线复现相同卡片顺序断言失败；quality从测试PB路径配置错误续跑后遇到原已记录M1受控外网禁止失败，不宣称全仓quality/verify通过。
- 权威树原视频排序未提交补丁保持SHA-256 `ed50ec18853d813c6307d1c7dd9ff1c7d020ec37735282d44ea368ff334a289b`，不纳入提交。没有推送、部署、真实供应商调用或目标库迁移，预览运行版本与供应商Ready独立核验。
- 完整命令、已知限制、恢复点和证据见 [本轮整合记录](ENTERPRISE-KNOWLEDGE-INTEGRATION-20261026.md)。

## 当前统一开发基线：图文任务持久化调度（2026-10-26）

- 后续修复基线：`7d493ca4ecc06abfc8906884dc9a4027789fe378`。已采集图文帖子逐张显示原始图片，选择和对话恢复保留具体张数；解决封面版式不可用而后续张可用时无法选取的问题。来源隔离提交 `789f5d63b0bbbdbf9bbfd45a31da4c0b2ded84d9`。`pnpm run test:image-replication`（24/24）、`pnpm run test:image-replication-ui`（6 场景）、`pnpm run lint`、`pnpm run check:architecture`、`pnpm run check:digital-employee-migrations`（204 项只读）、`pnpm run build` 与 `git diff --check` 已通过；浏览器确认同帖第 2 张可独立选中。仍未完成真实供应商 E2E，运行数据与 5 元预算准入须独立核验；未推送、部署或发布。
- 唯一默认源码基线为 `baseline/unified-20261026`，工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`。从 `240676bea03ccc67e2c83192bc1778bc96565e81` 快进到已验证源码 `d9c0805457d2613796645127152f59c10d79883b`；此节覆盖下方历史“当前”声明。隔离集成分支 `codex/image-paid-integration-20261026` 保留为恢复点，来源功能提交 `1fbda8a7c743cc98a8bb27911390c1d729f756ac`。
- 图文复刻确认后写入统一内容任务和图文子任务，再持久化入队；worker 读取原任务并记录节点与回执。统一基线的首页、任务详情和对话入口同时保留，首页图文卡为第五张。参考图 OCR 读取区域证据，并在首次付费策划前检查参考画幅与版式；失败明确阻断。图文进度在“内容创作→创作任务”读取同一调度回执。
- 合成源码实际通过：`pnpm run test:social-image-pipeline`（85/85 主用例及 HTTP/合同/治理）、图文 OCR/调度定向测试（12/12）、`pnpm run test:image-replication-ui`（6 场景）、`pnpm run test:content-production-v4`、`pnpm run test:assistant-production`（36/36）、`pnpm run lint`、`pnpm run check:architecture`（2972 个生产 TS 文件，相对 `240676be` 棘轮）、`pnpm run check:digital-employee-migrations`（204 项，只读）、`pnpm run build`、`git diff --check`。未运行全仓 `quality`/`verify`。
- 这些结果是源码与隔离浏览器验证，不是真实供应商 E2E。当前本地预览的 `socialtask_ad1a31f88b3736e23ca2cce2` / `img21b450831da3` 在旧实例中因付费开关关闭而阻断，所选方形参考与已确认 4:5 画幅不匹配；不能把该旧回执当作新基线执行成功。图文计划的实际供应商路径为 Qwen 策划/质检与本地图层合成，不等于任务字段声明的 OpenAI 出图；现有 5 元配置不是图文模型成本的强制上限。仍须独立核对预算、素材和同版本 web/worker/store 后才能进行真实付费联调。本次没有真实供应商调用、推送、部署、发布或数据迁移。
- 原权威树未提交的 `server/videos/videoVisibilityMaintenance.ts` 在快进前后补丁 SHA-256 均为 `ed50ec18853d813c6307d1c7dd9ff1c7d020ec37735282d44ea368ff334a289b`，未纳入本次提交。完整决策与实现边界见 [图文持久调度记录](IMAGE-TEXT-DISPATCH-20261026.md)。

## 当前统一开发基线：口播核心卖点能力安全合入（2026-10-26）

- 唯一默认基线继续为 `baseline/unified-20261026`，工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`。由 `321f6dcc` 快进至验证源码 `e61c3b688dcbc6bb945780650744e2513e7d6cfa`；本节为独立治理补记，覆盖下方历史“当前”声明。恢复分支 `backup/pre-product-highlight-20261026-321f6dcc` 保留。
- 用户授权合入此前独有的产品卖点提炼及回填。保留六组首页与原四张创作卡，追加“提炼口播核心卖点”；复用知识库模型与原企业资料PATCH/If-Match/GET读回，不自动改写冻结口播或启动制作。原功能树全部未提交内容、HEAD和index保留。
- 助手质量149/149、完整助手脚本、企业/首页领域13/13、最终TypeScript、2962文件架构/相对321f6dcc棘轮、204项迁移只读/guard、主站与账号中心构建及diff检查通过。浏览器采用离线候选与旧预览资料GET适配，仅证明新增入口与确认页交互，不是同版本真实E2E或模型质量验收；未运行全仓quality/verify。
- 基线原 `server/videos/videoVisibilityMaintenance.ts` 未提交补丁SHA-256前后一致（`ed50ec18853d813c6307d1c7dd9ff1c7d020ec37735282d44ea368ff334a289b`），不纳入本次提交。原M1及问答路由/业务数据衔接缺口仍保留。未推送、部署、付费或目标数据库迁移。
- 完整范围、命令、证据和限制见 [安全合入记录](PRODUCT-HIGHLIGHT-INTEGRATION-20261026.md)。

## 当前统一开发基线：新人首页双卡与实景导览（2026-10-26）

- 唯一默认基线仍为 `baseline/unified-20261026`，权威树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`。从 `7cb757c10c9857ed7c0fbbda2b84396021e6bcd0` 快进到已验证源码 `71c5cecba007b211133d876154198683fd9c33f8`；本节取代下方历史“当前”声明。恢复分支 `backup/pre-home-first-run-20261026-7cb757c1` 保留。
- 仅纳入本会话尚未提交的新人首页功能：两张旧版外观入门卡、复用既有企业入门表单的问答引导、靠近高亮目标的小气泡实景导览及 Enter/Esc 键盘流程。保留原基线报告、图文复刻、快捷任务及日历实现；未复制旧版首页整文件、平行后端链路或运行数据。
- 实际通过：新人状态/导览几何与首页合同定向测试 4/4，`pnpm run lint`，`pnpm run check:architecture`（2957 个生产 TypeScript 文件），`pnpm run check:digital-employee-migrations`（204 项只读），`pnpm run build`，`git diff --check`。未运行全仓 quality/verify、真实浏览器回归、真实供应商或发布验收；源码检查不能替代这些结论。
- 权威树原有 `server/videos/videoVisibilityMaintenance.ts` 未提交视频排序改动不纳入提交，快进前后补丁 SHA-256 均为 `ed50ec18853d813c6307d1c7dd9ff1c7d020ec37735282d44ea368ff334a289b`，工作树仍非干净。原功能树 `feature/assistant-home-dialogue-20261026` 的其他未提交内容未触碰。本轮没有推送、部署、目标数据库迁移或真实付费调用。详见[新人首页合并记录](HOME-FIRST-RUN-INTEGRATION-20261026.md)。

## 当前统一开发基线：小程序与首页卡片收尾（2026-10-26）

- 唯一默认基线仍为`baseline/unified-20261026`，权威树`/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`。从用户指定的`117933ac8f5059f6782c0dc1b742c3ae13d50e24`快进到验证源码`f4a95242aa28fac1b66dfdc7bd64d9b20d25eef1`，后续仅治理提交；本节取代下方历史“当前”声明。恢复分支`backup/pre-home-card-final-20261026-117933ac`保留。
- 本会话此前提交/快照均已包含；仅新增三个文件的未提交首页调整，固定提交`4253dc2e`：视频标题“借鉴一个爆款视频”，移除活动卡，图文标题“借鉴一个爆款图文”。四卡呈现保留原开场和多平台改写。相对117933ac无后台、小程序或迁移变化，未覆盖其较新功能。
- 实际通过14项首页/查询路由/助手合同、类型、2954文件架构/相对117933ac预算棘轮、204项迁移只读及guard、主站/账号中心构建、完整diff检查。保留旧大分包警告；未运行全仓quality/verify，原M1已知失败未消除。本轮无真实供应商或付费调用。
- 权威工作树原有`server/videos/videoVisibilityMaintenance.ts`未提交排序改动不纳入提交，快进前后完整补丁SHA-256相同；工作树仍非干净。没有推送、部署或运行数据迁移。独立图文分支907e74d1及其新12项队列开发现场不属于本会话此次三文件收尾，未声称已合入，未触碰其内容。
- 详见[首页卡片收尾合并记录](HOME-CARD-FINAL-INTEGRATION-20261026.md)。

## 当前统一开发基线：小程序三 Tab 与按钮链路修复（2026-10-26）

- 唯一默认基线继续为 `baseline/unified-20261026`，权威工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`。从 `353879221169176cb26d97391ad6f4dc7367a9f3` 合入小程序功能分支 `64ba79a49de8a09ff3647d475c5cab515ba20869`，已验证源码合并为 `5f6e09f4fda1db8306cc07f3d3c4dd909c88ee03`；独立治理提交不改变源码。本节取代下方历史“当前”声明。
- 保留较新基线首页、场景、日历、资讯与 V4 功能；新增小程序三个 Tab、独立助手历史及未读、素材/拍摄与客户交互修复。源码与本地预览数据分别保留；不迁入凭据、运行库或媒体。
- 实际通过：小程序164、后端40、预览隔离2、工作台12，类型、2954文件架构/ratchet、204项迁移只读清单与 checksum guard、共享生成检查、主站/账号中心构建及 diff 检查。未运行全仓 quality/verify；原基线周任务M1已知失败与真机/付费/渠道未验收边界保留。
- 目标原有 `server/videos/videoVisibilityMaintenance.ts` 未提交改动不纳入合并，快进前后补丁及文件哈希一致；权威树仍非干净。恢复分支 `backup/pre-miniapp-integration-20261026-35387922` 保留。没有推送、部署、数据库迁移或真实供应商调用。
- 详见 [小程序合并与验证记录](MINIAPP-INTEGRATION-20261026.md)。下一步按明确对象、账号和预算完成体验版真实链路验收，不能以源码合并代替运行/发布验收。

## 当前统一开发基线：灵小枢首页功能整合（2026-10-26）

- 唯一默认基线继续为 `baseline/unified-20261026`，权威树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`。本节取代下方历史“当前”声明。本地已从 `86d855e1` 快进至验证源码 `38d135f16058cb8403b46949de6d62363606d804`；后续仅治理提交。恢复分支 `backup/pre-assistant-home-integration-20261026-86d855e1` 保留。
- 隔离集成分支 `integration/assistant-home-unified-20261026` 纳入场景/日历分支 `a3b66751` 全部6个独有提交，以及本会话资讯/财报、条件查询和图文复刻的独立index快照 `2ae05809`、`f46166be`、`182abf08`。各源树、HEAD、真实index与未提交内容保留；没有迁入凭据、业务数据库或媒体。
- 保留六组底部入口、已删除的产品资讯/财报资料及旧快捷入口不恢复；七张外部资讯卡、重点企业单选、五种创作场景、原日历与确认改期、65%用户消息宽度同时保留。修复行业条件提示词绕开原文证据流程的问题，未新增主业务链路或付费重试。
- 实际通过助手145项、原助手脚本、图文入口24项和图文生产管线、V4 75项、周任务除既有M1外41项；相对原基线架构/ratchet（2953文件）、204项迁移只读/guard、类型、投流全部73文件、主站与账号中心构建及整段diff检查。quality在既有M1阶段失败，其余阶段已分段执行通过，不宣称单次quality/verify或全仓pnpm test通过。
- 原干净86d855e1复测相同M1首个失败（声音元数据触发受控外网禁止）；测试替身实验又发现旧素材供给证据缺口，实验已撤回，生产/测试门禁未放宽。该项是明确遗留失败，不以本轮整合验收抹去。
- 浏览器使用同版本隔离前后端5327/9077验证企业选择、条件弹窗、草稿追加保护、五场景与图文对话入口；长消息宽度比例0.64999556、左对齐。未调用真实付费供应商/发布；空运行库不代表来源/素材Ready。
- 推进时共享基线另有未提交 `server/videos/videoVisibilityMaintenance.ts` 排序改动；不纳入本次提交，快进前后完整补丁SHA-256相同。因此权威工作树不是干净状态，已验证源码指上述提交。没有推送、部署、目标库迁移、客户消息或真实发布。
- [来源、冲突、验证与已知限制](ASSISTANT-HOME-INTEGRATION-20261026.md)。后续开发从本统一基线建立分支，不再从保留的ff43ca61来源树继续分叉。

## 当前统一开发基线：V4 本地成片执行链（2026-10-26）

- **唯一默认开发基线仍为 `baseline/unified-20261026`**，工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`。本节取代下方历史“当前”声明；原统一基线 `ee2654459435a83bfb1ae845a4cf2a118eabe469` 与恢复分支 `backup/pre-content-v4-local-chain-20261026-ee265445` 保留。
- 已将 `codex/content-v4-local-chain` / `ef4715ebee95443272d453171a355807148357bc` 合入，验证源码合并提交为 `b2278f9ec65a165514052e5c58d75fb380311484`。原首页对话、视频任务创建与图文爆款复刻均保留；新增 V4 冻结源素材、声音、人物资产、剪辑、特效、渲染、技术质检、创意质检、人工暂停/恢复、交付的持久化执行链。
- 合并冲突集中在任务读模型、任务更新失效范围、记录投影、共享任务合同与本文件。最终同时保留统一基线的图文预览/封面投影和 V4 的执行准入、成片预览、执行摘要、画面合同与时长字段；没有复制平行业务主链。
- 实际通过：V4 75/75；原始内容完整本地媒体链 1/1（约 64 秒）；首页/助手生产入口 36/36；图文复刻 16/16；TypeScript；2918 个生产 TypeScript 文件架构检查；204 项迁移清单只读检查及迁移 guard；`git diff --check`。测试中的图片 DPI 警告由媒体工具降级为 70 DPI，不影响退出结果。
- 本次验证证明合并后的本地原始内容执行链和相关入口可运行，不证明真实付费供应商、参考视频完整实链、目标数据库迁移或发布就绪。未调用真实供应商，未推送、部署、发布或执行目标数据库迁移。

## 当前统一开发基线：2026-10-26 首页视频任务与图文复刻

- **唯一默认开发基线分支：`baseline/unified-20261026`**；工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`。用户明确要求将两条分叉线合并验证为最新基线。本节取代下方所有历史“当前”声明；旧分支保留为来源与恢复点。
- 已验证源码合并 `280b54973be6a8cf863cdef98183cf12fa88581f`，双亲为 `xixi首页对话+视频任务创建`（与 `xixi投流+卡片前端` 同点）/ `ff43ca6192dbd12c47e7456f31a4581ebf6f017e`，以及 `xixi联合功能模块后端改` / `7f8bd61c0aecf9133654c3a5d7430199b11d46e6`。两边均已成为新基线祖先；本节为验证后独立治理补记。
- 保留首页视频场景、任务创建/日历/详情、经营总览及调度冻结修复，追加第五个图文复刻场景；共享门户兼容双方字段，显式图文意图优先于通用视频复刻识别。
- 定向 47/47、图文复刻 16/16、图文管线 85/85 与 HTTP 集成 1/1、隔离浏览器 4 场景通过；quality 所有阶段最终分段通过，含周任务 42/42 和本地媒体生产、生产 214/214、投流 73 文件、TypeScript、架构/ratchet、203 项迁移只读/guard和主站/账号中心构建。首轮缺少测试环境 PB_BIN，补充已有程序路径后从失败检查点完成余项，不声称单次 quality/verify 成功；未另跑全仓 pnpm test。
- 原分支及原 server/index.ts 未提交内容和补丁逐字未变。未复制既有业务/预览数据库；未真实调用供应商、发送消息、投放、推送或部署；测试通过不代表真实供应商 Ready。
- 完整来源、冲突、验证命令和限制见 [统一基线合并记录](UNIFIED-BASELINE-20261026.md)。后续企业知识库整理从此分支新建功能分支。

## 当前本地基线：1026 灵小枢功能（2026-10-26）

- 本轮按用户指定，采用 `xixi投流+卡片前端`；原 SHA `8c7cc7d3`，验证源码 `99c20b5b9b1a7efe4ec6f52f92721dbc6bab46f8`，后续仅治理提交。基线树 `/Users/julia1/.codex/worktrees/home-cards-integration-20261026/1026灵小枢对话卡片`。下方其他“当前”章节均为历史检查点。
- 来源未提交功能已固定为 `580913fe`，原工作区/HEAD/index 保留；恢复分支 `backup/pre-home-cards-20261026-8c7cc7d3`。
- 定向 122/122、周任务 42/42 + 本地媒体 1/1、调度恢复专项、TypeScript、架构/ratchet、203 项迁移只读/guard、投流 73 文件、主站/账号中心构建通过。quality 首跑失败后修复并分段完成全部阶段；未声称单次 quality/verify 成功，未另跑全仓 pnpm test。
- 修复排队回执破坏调度冻结版本/输入 hash 的回归；原功能和其余工作树保留。仅本地源码合并，不代表真实供应商或发布就绪。
- 详见[本轮集成与完整验证记录](HOME-CARDS-INTEGRATION-20261026.md)。未推送或部署。

## 当前本机开发基线：图文爆款复刻与冒烟准备（2026-10-26）

- 权威工作树仍为 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`、分支 `xixi联合功能模块后端改`。用户授权冻结功能、推进基线并准备一次真实冒烟；从 `8c7cc7d304ffd268fcd5f20deeabf68fb5f8b10d` 快进至已验证合并提交 `6cbfd81b8623b685399c652e3cddb9a808be528a`，功能来源 `feature/image-text-viral-creation-20261026` / `31dced92`。本节为推进后的独立治理补记，后续文档提交不改变生产源码。
- 首页上方创作区保留本分支原四项，追加第五项“图文爆款复刻”；下方入口为“点击开始创作”。最终确认后复用统一内容任务、图文子运行、原素材/参考分析、策划、渲染、预检与人工审核交付，不新增平行业务主链；支持存储响应丢失后的同请求恢复，保留原视频入口。
- 候选树 `/Users/julia1/.codex/worktrees/frontend-v2-safe-integration-20261025` / `integration/image-text-smoke-20261026` 完成复验：`pnpm run test:image-replication` 13/13；首页定向 8/8；`pnpm run test:social-image-pipeline` 主组 85/85、HTTP 集成 1/1、路由/工作台合同及治理检查通过；`pnpm run test:image-replication-ui` 的灵感入口、对话参考、首页第五卡和授权缺失停止四种情形通过。浏览器 API 使用隔离替身，不能作为真实模型出图证据。
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm run lint`、相对 `8c7cc7d3` 的 `pnpm run check:architecture`、`pnpm run check:digital-employee-migrations`（203 项仓库文件只读检查）、`pnpm run test:migration-guard`、主站与账号中心构建及 `git diff --check` 通过。没有执行全仓 test/quality/verify，没有执行目标数据库迁移；存储能力仍需在明确测试实例上核验。
- 用户批准本次真实冒烟总费用最多 5 元，范围一张图片及必要策划/质检，不发布、不自动重试付费请求。只读预检确认全局 Qwen 凭据和本地 OCR 可用，但 OpenAI 图像凭据未配置，本测试运行未绑定持久化存储。抽查现有“云朵泡沫卸妆蜜”主图，商用授权记录存在，但衍生创作与模型输入许可未登记，所选运行环境没有可读取的原图字节。因此真实冒烟在供应商调用前阻塞，实际请求/回执/费用均为 0；不声明生成成功或供应商 Ready。
- 原基线 `server/index.ts` 未提交内容逐字保留，SHA-256 为 `2e3f45a5e129e57eed2c279d5cd74f79c07bc16c0e63ef5229d5d9874493b08d`，未纳入提交。恢复分支 `backup/pre-image-text-smoke-20261026-8c7cc7d3`。证据位于 `/Users/julia1/.codex/integration-evidence/20261026-image-baseline-smoke/`，只读准入记录 `live-preflight.json`。未推送、部署、发布或重启其他工作树服务；下方均为历史检查点。

## 当前本机开发基线：灵小枢交互卡片与本地投流（2026-10-25）

- 权威工作树 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`、分支 `xixi联合功能模块后端改`。从 `5f0b47a69cb029d3f7079cc18d8ba756d969972e` 安全集成卡片 `f2ea282c1ec60aedfab46569d1323ad49bbf2e7d` 与本地投流冻结快照 `e130395e0ca45f3cc40f59b1bd2de9ddd8f90267`，验证源码 `9be85a78443ae5dc6043926b33bf8f02b2aa6ab1`；本节为独立治理补记。
- 用户确认 3 处导航/规范冲突：保留“智能投流”，二级采用“计划管理 / 素材投放表现”，测试同步、双方有效 UI 规范保留。首页/客服等原确认和管理能力不回退。
- 定向 33/33、投流 73 文件、助手质量 87/87、完整助手脚本、导航/GlobalAssistant、前端安全/共享合同、4GB TypeScript、2829 文件架构及相对原基线 ratchet、203 项迁移只读/guard、主站和账号中心构建通过，Studio 371887/485000 字节；未跑全仓 test/quality/verify 或本轮浏览器/真实供应商 E2E。
- 投流来源树未提交内容以独立 index 快照纳入，原 HEAD/index/工作区保留且完整 tree/status 核验一致。基线原 `server/index.ts` 未提交修改逐字保留、不纳入提交；恢复点 `backup/pre-cards-ads-20261025-5f0b47a6`。
- 仅本地合并与治理记录，未推送、部署、目标库迁移、真实付费/广告/发送；其他预览与功能树未同步或重启。详见[本轮集成记录](CARDS-ADS-INTEGRATION-20261025.md)。以下均为历史检查点。

## 当前本机开发基线：节节1025服务器上传增量（2026-10-25）

- 本机权威工作树仍为 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`、分支 `xixi联合功能模块后端改`。从 `b97265dc667ea0936ab8e75bfdb7da58f6a9c847` 无冲突快进到用户指定的 `181868f3f9bad2ff437f124018e9decf5ababb59`；包含最新源码修复 `92d2d56aed64c6ade2eb883081526f1e2588e599`。本节为快进后本机治理补记，不改变生产源码。
- 来源在原基线上增加 10 个提交、19 个文件，主要修复本地预览隔离/认证媒体、按端口隔离 Vite 缓存、首页三张卡的事实回复与自动收起/恢复、客服列布局。没有分叉或产品冲突；原前端/助手整合及保留的管理能力保持完整。下方 `/Users/jiejie/...` 为来源电脑历史记录，不是本机路径。
- 定向组 20/20，助手质量 87/87，预览启动/隔离、完整助手脚本及前端安全组通过。4GB 堆上限 TypeScript、相对 `b97265dc` 架构/ratchet、203 项迁移只读及 checksum guard、主站/账号中心构建通过，Studio 371887/485000 字节。桌面/手机隔离浏览器 4/4，实际点击三张卡、核验回复和展开/收起、横向卡片及客服布局。没有重跑全仓 test/quality/verify，不将定向检查声称为全仓或真实供应商验收。
- 原 `server/index.ts` 未提交资源 404 修复在快进前后逐字和补丁哈希一致，未纳入提交；工作区仍保留这一项修改。恢复分支 `backup/pre-server-upload-20261025-b97265dc`、私有补丁及证据均保留。详见[本轮安全合入记录](SERVER-UPLOAD-INTEGRATION-20261025.md)。
- 仅本地快进与治理记录；未推送、部署、迁移目标数据库或真实付费/发送。没有重启、同步或清理其他预览与功能树；只停止本轮临时验收 Vite。

## GitHub 封装分支：节节1025服务器上传（2026-10-25）

- 权威本地工作树为 `/Users/jiejie/Documents/lingshu-AI`；从干净的前后端与助手知识库整合检查点 `11dd9ba0e1fdc288e0af0e91d8b9f6cd29715514` 创建分支 `节节1025服务器上传`。最新生产源码修复提交为 `92d2d56aed64c6ade2eb883081526f1e2588e599`；本节仅记录封装与可恢复起点，不改变生产源码。
- 封装前已通过四组定向合同/行为测试、4GB 堆上限 TypeScript、架构检查、`git diff --check` 与登录后本地浏览器验收；本次不重复运行与源码完全相同的验证。推送前已核对工作流：普通分支推送不匹配 `v*` 标签构建，部署仅能手动触发。未执行部署、迁移、真实供应商或付费调用。

## 本机切换至前后端与助手知识库整合基线（2026-10-25）

- 本机权威集成位置 `/Users/jiejie/Documents/lingshu-AI` 已按用户明确要求，从已推送且可恢复的 `前端2.0：小程序+智能经营+对话首页`（`175b9da43b5522294d2f4dbbd087e76e5dd40d59`）直接切换到远端分支 `xixi前后端合并+灵小枢回复规范外部知识库` 的精确提交 `b97265dc667ea0936ab8e75bfdb7da58f6a9c847`。这是整树替换，不是把两条历史做三方合并；生产源码与目标远端提交逐字一致，本文档以独立治理提交补记本机分支事实。
- 切换前后当前工作区均干净，目标远端 SHA 与用户提供的 `b97265dc` 一致，本地分支已跟踪同名远端分支。目标提交已经包含下方记录的前端 2.0 安全集成、助手回复质量、外部信息证据/来源折叠及内容门户；来源电脑另行保留但未提交的 `server/index.ts` 资源 404 修改不在该远端提交中，本机没有猜测或补入。
- 本次只核验 Git 根目录、分支、精确 SHA、上游一致性、工作区洁净度及 `git diff --check`，没有重复执行目标分支已记录的完整测试、构建、架构或 203 项迁移只读检查。没有执行目标数据库迁移、真实供应商/付费调用、OAuth、发布、推送或部署；当前 5181 预览进程不会因源码切换自动重启，运行版本须另行核对。
- 新基线首次启动本地预览时，客服隔离门禁正确拒绝了启动期可选数字人视觉质检 Python 子进程，导致后端重启循环。源码提交 `48596fa7` 仅在 `LINGSHU_LOCAL_PREVIEW=1` 时将该可选探针降级为人工验收，非预览及真实付费执行门禁不变；定向回归 11/11 和 `git diff --check` 通过。随后在前端 5181、账号中心 5182、后端 8891 启动受监督预览，健康接口 200，并以受限本地会话验证 `beauty-showcase@local.test`、租户 `local_tenant_customer_aurelia_beauty`、角色 `admin` 可登录；未打印或保存会话令牌。
- 本地媒体显示修复源码检查点 `dbaf01e1`：受监督预览在隔离门禁安装后固定读取 `data/media/object-storage`，不再被仓库 `.env.local` 的远端 COS 驱动覆盖；首页运营卡改用现有认证媒体读取，并在文件缺失时回落为无图样式而非破图。隔离启动测试、4GB 堆上限 TypeScript、架构检查和 `git diff --check` 通过；本地已有的 3 张抽样爆款封面经认证接口实测均为 `200 image/jpeg`。LinkedIn 图文 `trend_videos_c4ea67fe0d9344c2b7381a8fa2b2f793` 只有远端对象元数据、本机数据包未带图片字节，因此隔离预览仍明确返回 404，不以无关图片冒充，也未绕过门禁读取 COS。首页合同文件中的既有锚点高度断言仍与当前 CSS 不一致，本次新增媒体断言已单独通过但该整文件不计为通过。
- 本地预览交互稳定性源码检查点 `509ddb38`：主站及账号中心的 Vite 依赖缓存改为按实际监听端口隔离，避免并行的 5177/5181、5178/5182 预览互相使版本化模块失效；主站 CSP 的 HMR 白名单同步采用实际 5181 端口，重启后浏览器可正常接收更新。监督器合同、客服隔离 10 项、4GB 堆上限 TypeScript、架构检查及 `git diff --check` 通过；全新浏览器对“今日资讯”“提炼产品卖点”“智能投流”执行真实点击均成功，控制台无 `Outdated Optimize Dep` 或动态模块加载失败。当前 5181/5182 缓存目录和 HTTP/CSP 探测通过；未调用真实供应商、执行迁移、推送或部署。
- 本地助手与客服交互修复源码检查点 `92d2d56aed64c6ade2eb883081526f1e2588e599`：首页“今日资讯”“经营策略”和“周经营任务”在本地预览直接读取已加载且可追溯的企业数据，不再因未授权真实模型调用而无回复；无证据时保留明确缺口，不把社媒信号冒充政策结论。首次对话后三张快捷卡自动收起，可通过小按钮恢复；展开时桌面窗口保留 2.5 张卡视口与横向滑动。客服恢复提示、手动控件与聊天线程现固定在同一会话列，不再被 CSS Grid 拆散。四组定向合同/行为测试、`NODE_OPTIONS=--max-old-space-size=4096 pnpm run lint`、`pnpm run check:architecture`及 `git diff --check` 通过；默认 2GB Node 堆的首次 TypeScript 检查因内存上限退出，提高单次进程堆上限后明确退出 0。登录后 5181 实测确认助手立即回复并自动收起，卡片轨道 `1028px > 862px`，客服区为 `224px + 734px`，恢复提示和聊天均位于右列。未启用真实联网问答，未执行迁移、推送或部署。

## 当前开发基线：助手回复质量与内容门户（2026-10-25）

- 本地基线分支 `xixi联合功能模块后端改`，权威工作树 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`；从 `7801dd0f90ce5b27a52540069b8fbfd330ae654b` 快进到功能源码提交 `59d3fc06e46bdc158a7425eed9f2a00298cccb26`。来源 `feature/assistant-reply-quality-20261025`，72个文件，无冲突；本节为后续治理补记。
- 合入外部信息证据/来源折叠与总体结论、内部任务问答和确认后门户、内容创建/批量草稿、输入建议两次回车、附件拖入与统一输入样式。没有迁移、架构预算或锁文件变化。
- quality 33阶段最终逐项通过；第11阶段并发租约首跑失败、原基线对照及功能分支完整单项复跑通过，第12阶段单独通过、第13–33阶段顺序通过，不声明单次quality/verify绿色。类型、相对7801dd0f架构预算、203项迁移只读检查、主站/账号中心构建均通过；额外助手87/87、UI/发送合同3/3通过。合并后目标树复验见[本轮集成记录](ASSISTANT-QUALITY-INTEGRATION-20261025.md)。
- 原 `server/index.ts` 未提交资源404修复逐字保留，未纳入提交；基线工作区仍有此一项修改。恢复分支 `backup/pre-assistant-quality-merge-20261025-7801dd0f` 与原补丁私有备份保留。
- 未推送、部署或对用户目标库迁移；临时PB集成与供应商替身测试不构成真实付费生成、发布或生产Ready。功能树及其5265预览保留；真实供应商配置、预算与联调仍须单独确认。

## 当前开发基线：前端 2.0 安全集成（2026-10-25）

- 本地分支继续为 `xixi联合功能模块后端改`；权威工作树 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`。源码合并提交 `78ba96c87366108aa3035d75dd5d60d323e19492`，双亲为原基线 `dfc9b0c8af85175485cf39370eed92c4be3daedd` 和前端来源 `175b9da43b5522294d2f4dbbd087e76e5dd40d59`；本节治理检查点仅补充记录。
- 用户逐项确认：采用新版统一对话首页；以新版经营任务卡片替换原执行日历；客服保留紧凑资料、归因、标签编辑、画像记录和跟进操作；保留智能体记忆、组织权限、员工管理 API 和旧链接，但账户菜单按新版收起入口。上述决定覆盖下方历史首页/日历规则。
- 在独立候选树处理 100 个冲突文件，接入小程序、新首页、经营页、企业引导及图片生产增量；保留原 Qwen→Gemini、投流授权恢复、客服隔离与草稿保护，合并 OCR 词框与审计内单 worker 复用，修正重复注册、对话字段兼容和图片审核过期问题。详见[合并来源、冲突取舍及验证记录](FRONTEND-V2-INTEGRATION-20261025.md)。
- 完整 `PB_BIN=/Users/julia1/.local/share/lingshu/pocketbase/pocketbase pnpm test` 最终单次退出 0。quality 33 个阶段逐项通过；其中旧导航断言首次失败，修复后完整复跑该阶段通过，不声明单条 quality/verify 一次绿色。类型、架构及相对 `dfc9b0c8` 的 ratchet、203 项迁移只读与 checksum guard、主站/账号中心构建均通过；Studio 371887/485000 字节。小程序 136/136，客服管线 93/93，WhatsApp 12/12，后端定向 40/40；组间不相加。
- 隔离浏览器首轮 8/8、修复及管理深链接补验 6/6，通过桌面 1440px 与手机 390px 布局检查。首页目视发现的重复参考入口已修复。使用测试替身拦截 API 和外部请求，不是真实账号/供应商验收。
- 原权威工作树有一处未提交 `server/index.ts` 资源 404 修复，开始及推进前均核对，原样保留且不纳入合并提交；因此不宣称该工作树干净。恢复分支 `backup/pre-frontend-v2-20261025-dfc9b0c8` 及原补丁/文件 SHA-256 保留。本机证据 `/Users/julia1/.codex/integration-evidence/20261025-frontend-v2/`。
- 本轮仅本地合并，未推送、部署、目标库迁移、真实 OAuth/付费/投放/发送；其他功能树与预览数据未同步或清理。远端同名基线仍是 `dfc9b0c8`，本地包含本轮合并与治理检查点。

## 当前开发基线：联合功能模块与后端整合（2026-10-24）

- 用户确认本轮整合当前本地功能，保留 Qwen→Gemini，并只保留数字员工原任务日历。权威工作树仍为 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`，本地分支已切换为 `xixi联合功能模块后端改`；远端目标为同名 GitHub 分支。
- 从干净的 `974a665d884c11e029bb4cb14df5b8ca05555ff0`，经独立候选树逐笔审查、合并、修复和验证后快进至文档检查点 `e98d7410337dbb411c5478c7f1caeefad2db27f2`。最终源码/测试提交 `02e44500dd35d7020517c62ff00e3a3a0c15cad2`；本节治理补记不改变已验证生产源码。恢复点 `backup/pre-union-20261024-974a665d` 保留，未使用强制推送或覆盖脏工作树。
- 原盘点 93 个本地分支提交均已纳入历史；78 个原已包含，独有提交逐笔审查，其中 10 个分支的等价补丁经 `git cherry` 核对后仅记历史。13 棵未提交源码树创建独立 index 快照并逐笔处理；旧实现中会撤回治理、放宽产品资产/遮挡门禁或恢复 GPT 自动降级的内容未采用。GitHub 旧正式服和部署实验分支按用户确认排除。
- 合入自由创作问答与任务交接、数字员工目标/成片/原执行日历、投流授权生命周期与恢复、灵感及素材层级/访问/联动、小程序上传关联等功能，保留当前客服紧凑界面和持久画像。补齐原工作台遗漏的总开关入口，仍用原确认与建议观察期；修复敏感文字逐帧检查反复初始化 OCR 的超时，不减少帧数、不放宽原 300 秒边界。
- 最终完整 `pnpm test` 单次退出 0；quality 33 个阶段按失败检查点执行通过，不把首次 PB_BIN 缺失、旧合同失败和 M1 超时写成通过，不声明整条 verify 单次绿色。70 文件定向复跑 225/225，周任务主链 42/42（M1 约 99.6 秒），本地生产恢复、完整客服矩阵、小程序共享组及回调桥隔离检查通过。最终类型、架构/ratchet、201 项迁移只读/guard、生产构建通过，Studio 367219/485000 字节。详见[逐笔来源、修复与验证记录](ALL-BRANCH-INTEGRATION-20261024.md)。
- 后续仅清理旧来源 helper 的末尾多余空行，功能语义未变，整段 `git diff --check 974a665d HEAD` 通过；未为此重复执行测试。
- 干净预览来源树已安全快进；含未提交内容的创作/数字员工等功能树保留原位及快照，不覆盖现场。源码不等于运行数据库或真实供应商 Ready。本轮未部署、真实 OAuth/付费/投放/消息或目标库迁移；临时测试库的安装、升级、恢复不代表目标数据库已迁移。未做完整登录后浏览器人工验收。

## 当前开发基线：客服工作台与静默画像集成（2026-10-24）

- 用户确认将 `feature/customer-service-20261024` 合入本地 `xixi投流客服整合补齐基线v1`；权威工作树仍为 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`。从干净的 `89b175109149d4551aeb3ce590fe9c42c46bf23c` 快进至已验证代码提交 `6b5c30224fb31115d35f584e33271cd3ebee3653`，无冲突。本节治理提交不改变已验证生产源码。
- 源码 `5b4ebad7` 包含紧凑客服界面、报价弹窗/完整草稿、分维度标签及人工纠正、同会话新消息后台画像更新、本地草稿/翻译/审批/账本组合和渠道隔离。`1acf73f5` 修正原始构建日志的压缩归档；`6b5c3022` 修复过时的 400 字符详情结构断言，仍检查组件实际位于详情展开区内。
- 在目标工作树重新执行候选功能矩阵：启动隔离 1、隔离 9、pipeline 93、完整客服 67、WhatsApp 12、专项 90 全部通过，0 跳过（组间重叠，不相加）；类型、架构/ratchet、197 项迁移文件只读检查及 guard、构建、工作区和 `89b17510..6b5c3022` 差异检查通过。功能与静态两组各自 5262 路径执行前后源码哈希一致。首次完整客服 66/67 的结构断言失败及修复证据保留。
- 仅推进本地源码基线，未推送、部署、执行目标库迁移或调用真实模型/渠道。预览和运行数据仍独立保留；不声明全仓 quality/verify、远端 CI、真实供应商 E2E 或发布就绪。真实模型标签整链、WhatsApp 原生自动模型分类、后台重启自动恢复及历史响应缺证等边界见[本次集成报告](../qa/customer-baseline-integration-2026-10-24.md)。下一步仅在明确授权下推进远端或真实验收。
- 来源客服分支和原基线 `89b17510` 保留为恢复参照，没有重置、清理或归档其他工作树。以下为历史检查点，以本节为当前开发代码基线。

## 当前开发基线：投流客服整合补齐（2026-10-24）

- 按用户要求固化新的基线分支 `xixi投流客服整合补齐基线v1`，后续本地开发以此分支为准；工作树 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`。远端跟踪同名分支。
- 从干净且与远端一致的 `02f5a112c6a3617a690ef12628628352e2d4a5c7` 创建；该版本包含修复源码 `1dd111866635cf83ccf02cf129a3a3fc64713d0c`。原 `xixi改tab顺序+前端整合` 保留。本次基线提交仅更新记录，生产代码、测试与依赖同已验证版本一致。
- 已补齐投流二级入口、子页高亮和外观外壳，以及投流/客服日夜颜色适配；客服原四分类、三栏布局和业务链保留。复核 23 项定向检查全部通过，沿用上一轮同源码的客服 80 项、投流 47 文件、类型、架构/ratchet、197 项迁移只读和构建证据，不声明本次重新运行全部检查。
- 两棵关联树按干净、可快进条件跟进此基线；实际业务/运行数据与源码分开管理。未执行真实发送、投放、OAuth、付费或部署。已知真实账号验收及助手附件理解等范围外限制仍见 [整合报告](CREATOR-UI-INTEGRATION-20261024.md)。以下为历史检查点。

## 客服与投流功能区、共享外观收口（2026-10-24）

- 开发分支仍为 `xixi改tab顺序+前端整合`；本轮源码/测试提交 `1dd111866635cf83ccf02cf129a3a3fc64713d0c`，基于干净 `2b4c0a91`。治理与产品文档另行提交。
- 投流恢复常驻“计划创编、投放数据、素材管理”原工作区导航，子页归属同一主导航及外观外壳；客服保留四个分类和三栏/移动端区域结构，只调整配色。弹窗、原生表单、素材卡片和提示使用共享日夜 Token，不增加业务实现或依赖。
- 23 项定向前端、客服 80 项、投流 47 文件、TypeScript、架构/ratchet、197 项迁移只读检查及最终构建通过；Studio 368861/485000 字节。浏览器检查日夜客服模拟会话、投流页签及创编表单；四个客服文件剔除 className 后语法树打印一致。未真实发送、投放、付费、OAuth 或部署。
- 详见 [整合报告末尾本轮记录](CREATOR-UI-INTEGRATION-20261024.md)。两棵关联工作树只在干净且可快进时跟进，不覆盖独有开发成果。以下为历史检查点。

## 当前开发基线分支（2026-10-24，用户指定切换）

- 后续开发统一基于本地 `xixi改tab顺序+前端整合`，跟踪 `origin/xixi改tab顺序+前端整合`；工作树为 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`。
- 切换点为本地与远端一致的 `1ed95e73836ebe0709ad9a1cc41c5ab8d764af00`。原分支 `xixi代码架构清理后合并链条v1` 保留在此点，后续不再作为本会话默认开发分支。
- 本次仅切换分支并更新基线记录，生产代码与测试未变化，沿用下方本版验证证据；未重新运行测试、未部署。以下各节为历史检查点，以本节分支为准。

## 当前前端整合与导航版本（2026-10-24）

- 本地开发分支继续为 `xixi代码架构清理后合并链条v1`，工作树 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`；本版源码/测试提交 `9b03cb5360aa32c995d24bc17fe81bea5e1f5a10`，文档及来源祖先记录另行提交。旧恢复点为 `3193ead1`。
- 用户确认前端来源 `64bb6481` 已语义移植到治理后的模块；主导航固定顺序为“经营总览、灵感爆款、内容创作、平台投流、客户会话”，沿用模式和权限过滤。远端版本名为 `xixi改tab顺序+前端整合`，本地开发分支不因此更名。
- 本版 37 项定向前端、六组领域回归、类型、架构/ratchet、197 项迁移只读/guard 及最终构建通过；Studio 368861/485000 字节。浏览器已核对五个入口，未声明完整浏览器整链、真实供应商 Ready 或部署。
- 预览树与内容生成树按用户修订的要求跟进验证后的安全提交；需干净且可快进，不覆盖独有成果。详见 [整合、验证及已知限制](CREATOR-UI-INTEGRATION-20261024.md)。以下均为历史检查点。

## 当前开发基线分支（2026-10-23）

- 用户指定后续开发统一基于 `xixi代码架构清理后合并链条v1`；当前工作树为 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`，本地分支跟踪 `origin/xixi代码架构清理后合并链条v1`。
- 切换点为本地与远端一致的 `2b2ff027a5e349ae9b3026f7201b2a6399e5f790`。本次仅切换分支并更新此基线记录，生产代码和测试未改动，沿用下方整链复测证据；未重新运行测试或部署。
- 原 `xixi功能大合并20261023` 和投流固定快照均保留。以下“当前”标题是历史检查点；后续开发以本节分支为准。

## 当前合并后整链复测基线（2026-10-23）

- 独立工作树 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`，分支 `xixi功能大合并20261023`；验证源码/测试 `4377f112e2289e6452509934ed241f89db2426cc`，最终文档另行提交。六个约定功能范围和 `1d73fda3` 已合入，原治理树及投流快照保持不变。
- 本次补做跨模块完整链路，修复逐帧 OCR 重建 worker 导致的整链超时；原 M1 300 秒边界未放宽，复跑 42/42，后续人工审批恢复/交付 1/1。Starter 完整组、各专项、类型/架构/迁移与构建通过；最终完整 `pnpm test` 退出 0，详见复测报告。
- 按失败检查点验证 quality 各阶段；不声称整条 quality/verify 或远端 CI 绿灯。源码通过不等于真实供应商 Ready；默认 PocketBase 原子能力、真实账号/付费链路、设备与人工视觉验收等限制仍保留。未部署、发布或执行目标库迁移。
- 详见 [跨模块复测报告](FEATURE-INTEGRATION-RETEST-20261023.md)。以下各节为历史检查点。

## 当前独立功能集成基线（2026-10-23，最终离线验证）

- 本任务后续源码/验证使用 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`、`xixi功能大合并20261023`，验证源码/测试SHA `2e431ef5a8ac96670675464f65a0622445d18b80`；最终文档另行提交。投流、客服、用户追加的吴小姐完成最终测试1d73fda3、WhatsApp、视频P1/预算、小程序及图片剩余安全修复均已集成。原治理树641d0b9保持只读恢复点，不回写；xixi架构清理c3355ee5和投流固定快照b6e4b3e8均未推进。
- 最终实际通过完整studio-release、production212/212、完整digital-employees、platform-ads47文件、customer-pipeline80项、安全/租户隔离、以641d0b9为基准架构/ratchet、197项迁移只读及migration-guard。源码共2,677个生产TS，主页面7,030行并降低冻结预算；Studio chunk368,854/485,000字节，视图导入边界通过。193份旧迁移字节不变，追加投流3份及客服1份，不执行目标库迁移。
- 当前生产组没有下方历史两条认证失败；它们由用户指定的测试版本修复，不能删除其合并前失败证据。两份旧集成测试适配在最终交叉中修正，未放宽业务/安全要求。小程序两个短镜头确定性缺陷已用本地FFmpeg先失败后通过验证；原真实视频/模拟器与自动描述准确率仍未验收。图片继续Qwen→Gemini，GPT自动分析未接线。默认PocketBase缺少原子能力时WhatsApp仍拒绝接入。
- 未部署、发布、真实付费/OAuth/消息/广告、目标库迁移，未声明完整登录后浏览器、真实供应商、全仓quality/verify或CI通过。详见[逐批来源、冲突、门禁与限制](FEATURE-INTEGRATION-20261023.md)；下方各节为历史批次证据，以本节为当前独立集成状态。


## 独立集成线追加已测试基线（2026-10-23）

用户指定远端 `吴小姐完成最终测试` / `1d73fda3` 已安全合入独立 `xixi功能大合并20261023`，源码合并 `0093d995`，未回写原治理树。当前包含投流/客服/人物认证修复，新候选production 212/212和完整studio-release均通过，架构/ratchet/197项迁移只读通过，Studio chunk 368,962/485,000。下方两条认证失败记录是合并前历史；仍无真实供应商、登录后完整浏览器或部署验收。详见 [本轮证据](FEATURE-INTEGRATION-20261023.md)。

## 独立功能集成线（2026-10-23）

治理权威线仍为 `xixi1021程永罗沟通前大整合` / `641d0b9`，本任务不回写。独立分支 `xixi功能大合并20261023` 从该干净点创建，投流源码 `cff5de15` 已集成（含冻结新授权功能）；领域/类型/架构/迁移只读/构建及模拟浏览器通过，生产组两条既有失败仍保留。客服源码 `f19e0c05` 已追加且80项定向与客服链/类型/架构/197项迁移/构建通过。后续新增吴小姐最终测试来源、WhatsApp、视频 P1、小程序和图片按批推进，未完成项不可视作已验收。详见 [有限合并清单](FEATURE-INTEGRATION-20261023.md)。未部署或执行真实外部操作。



<!-- 以下为吴小姐完成最终测试分支的来源机器历史证据，非本机工作树切换。 -->
## 本地集成基线切换与人物认证 UI 收口（2026-10-23）

- 来源机器集成工作树为 `/Users/jiejie/Documents/lingshu-AI`，分支 `xixi改五个大文件结构治理`。从远端精确获取并切换到干净提交 `641d0b9ec944730c387ef185012fcf2d44cf8939`，而非按目录名或时间推断“最新”；此前本机 `xixi1021程永罗沟通前大整合` 的 `62f85f8c` 仍是可恢复的历史安全点。人物认证源码及测试单独提交为 `a2b37ae692d6390a4644a02e1a26f26c45efe575`；本文档提交的最终 SHA 与远端一致性须在推送后核验。
- 对照唯一 UI 规范的首次接入两步要求和旧审计，确认原两条失败首先来自 SSR 不执行 capability Effect，旧标题断言误把 pending 当 ready；同时发现分镜入口没有传递已保存的认证照片、本人视频及既有成年人/方舟处理授权。源码改为按当前人物的引用素材预选照片和视频，只在两项声明均已确认时复用授权；缺资料或缺同意时提交仍禁用。认证能力就绪的面板状态增加可预载的测试入口，客户端仍重新读取能力。测试分别覆盖旧人物仅有照片、新人物两项上传、双素材复用与明确授权；并保留 pending 与生成门禁检查。没有仅替换旧正则。
- 实际通过：定向人物认证 3/3、`pnpm run test:production` **212/212**、完整 `pnpm run test:studio-release`（含工作台、分镜/AIGC、production、媒体、安全、外部预检、桌面字幕与构建）；`NODE_OPTIONS=--max-old-space-size=4096 pnpm run lint`、以 `641d0b9e` 为基准的 `check:architecture`（2,603 个生产 TS、1 个冻结历史超限文件）、`test:architecture-ratchet`、`check:digital-employee-migrations`（193 项仓库只读）与 `git diff --check`。构建中 Studio chunk **368,939/485,000** 字节、视图导入边界通过。
- release 首跑在 Qwen 对齐的两条离线模拟中因本机无 `DASHSCOPE_API_KEY`，在模拟 `fetch` 前失败；各用例现仅在自身范围设置并恢复 `test-key`，单文件 6/6 后完整 release 复跑通过。首次无 4GB 堆的本地 `lint` 因约 2GB Node 堆限制 OOM，4GB 设置下通过；不能把这两次首跑称为通过。
- 证据限于源码、SSR 就绪状态及离线测试；尚无登录后真实点击/上传的浏览器验收、真实方舟/HeyGen 供应商 Ready 或付费结果，也未运行全仓 `quality`/`verify`。未部署、未真实付费调用、未执行目标库迁移；来源机器其他工作树及运行/预览数据未动，不能将源码基线等同于预览或供应商基线。
## 原五个大文件有限结构治理收口（2026-10-23）

- 审计起点：干净集成树 `/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`，分支 `xixi1021程永罗沟通前大整合`，本地/远端 `099e394e1244aa19fa395f38dd2a03d50fa44cce`。生产源码保持 `2804dd7207cb23fa51f06cb25e4e6ae9158b3ba1`；本批测试修正 `e46db16f5da4ffa85178338bac55e29990e0516c` 已单独提交推送，未新增生产模块。最终文档另行提交推送，SHA 与本地/远端及干净状态以推送后的核验为准。
- [固定三批清单](STUDIO-CLOSURE-CHECKLIST.md) 已逐项完成；[最终审计](STUDIO-CLOSURE-AUDIT.md) 记录职责、依赖、行为、每项验证和限制。原四个入口为 **654/538/281/187 行**，`AiCreateStudio.tsx` 为 **7,031 行**。保留完整共享状态、跨域脚本协调、逐镜批/句级事务、共享候选投影和页面装配，800 行不是成功条件；不再增加拆分点延长本轮。
- 当前 **177** 个新增生产模块实际装配，15 个为类型合同，其余可从真实入口到达；全部独立进程加载成功且探针禁止 HTTP。各模块无绕回所属主入口的静态初始化；既有跨域兼容入口、延迟业务调用仍存在，不能扩大为全仓库无循环。项目/声音 **377/122** 个 getter 均有真实用途，构造/Hook 读取时机、同名绑定、单一状态与动作已核对，仍明确承认端口耦合。21/23 组任务/交付动作对照、382 项本批 Hook 展开、公开表面和初始 SSR 通过，只作为其覆盖范围的证据。
- 实际通过 `test:video-source-boundaries` **167 项**、`test:production-workflows`、`test:digital-employees`、`test:tenant-isolation`、`test:security-boundaries`；工作台 **131/131** 及导入检查 **4/4**，工作流/分镜/AIGC **13/11/66**；媒体组及另行执行的 release 剩余安全组 **48 项**、外部预检、媒体安全及桌面字幕通过。`lint`、以 `099e394e` 为基准的架构/ratchet（2,602 个生产 TS、1 个历史例外）、193 项迁移清单只读、`git diff --check`及生产构建通过。主 chunk **368,957/485,000** 字节、视图静态导入边界通过；不宣称性能改善。
- `test:studio-release` 实际执行仍在生产组失败：**211 项中 209 通过、2 条既有人物认证 UI 断言失败**。五个相关文件 blob 从 `630c4126` 到当前未变；相同依赖及两项输入的未改基线/当前 SSR 逐字相同，均在 capability pending 分支。原断言未修改/降低；登记为独立既有 SSR 合同与业务验收缺口，仍阻止完整 production/release 门禁通过，后续须真实就绪/上传/明确同意交互验收，不能只改正则。
- 补跑时发现 `studioMediaAccess.test.ts` 的自动刷新断言仍从旧函数区间找已迁出的 `recoverJobs`，本批改为核对真实会话函数、页面 Hook、同一 guarded refresh 与 timer 清理；成功日志移至全合同末尾。修正后定向、131 项工作台、类型/架构/迁移及完整剩余安全组通过，生产逻辑未改变。
- 本轮结构目标收口，不宣称全链路零回归或发布就绪。未做登录后完整浏览器或真实供应商验收；未部署、真实付费、真实发布或访问/执行目标库迁移。普通分支推送已核对不触发部署；未处置其他工作树、未混入视频任务独立后端改动，项目镜像 `sources/` 未改。

## 有限收口第二批：成片验收与人工交付（2026-10-23）

- 起点：干净集成树 `/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`，分支 `xixi1021程永罗沟通前大整合`，本地/远端均为 `c5c5f637b44241f43b9b026b65766527c69638d6`。源码 `2804dd7207cb23fa51f06cb25e4e6ae9158b3ba1` 已推送。`studioDeliveryWorkspace.ts` 统一七组状态、验收保存/撤销/失败恢复、重新质检、人工清单读取/退出与审核/发布待办提交。门禁从本工作区状态推导，不再接收页面派生的“就绪”标记或质量记录；页面只提供选定路径、项目范围和原保存/版本反馈能力。主页面 **7,076→7,031 行**，工作区 **149 行**，无新增 getter，不以净降行数或低于 800 行判断完成。详见 [交付工作区 ADR](../architecture/adr/2026-10-23-studio-delivery-workspace-boundary.md)。
- 完整 `saveProject` 的三个旧成功/冲突/失败反馈测试先失败再通过；现防止旧项目反馈、版本/列表、后续质检或交付污染新项目，保存后计划同步和延迟反馈也检查范围。新增可选本地 `onSavedProject(id)` 仅衔接本次实际提交的新项目身份，不进入 HTTP 或持久化快照；队列自动保存仍读取执行时最新的 `autosaveSnapshotRef.current`。既有 API/服务端权限与最终交付准入保持不变。
- 交付行为及真实页面桥 **17 项**、项目保存组 **13 项**（本批新增 5 项）通过；两种定向合同组各 **31/31**。实际旧/新页面动作的 **23 组非切换场景**保存内容、请求顺序、错误及状态写回一致。展开任务/交付两批 Hook 后的 382 项调用顺序、七组初始状态、两条资格规则一致；其他既有自定义 Hook 未展开。模块独立加载/无反向运行时入口依赖、45 个公开导出和普通/任务初始 SSR（24,562/25,765 字符）一致；不据此宣称全链路零回归。
- 实际通过 `pnpm run lint`、`test:studio-workspace` **131/131**与构建导入 **4/4**、`test:studio-workflow` 13 项、`test:shooting-workflow` 11 项、`test:storyboard-aigc` 66 项，以及另行运行的服务端项目质检/审核路由 3 项；`ARCHITECTURE_BASE_REF=c5c5f637 pnpm run check:architecture`（2,602 个生产 TS）、`test:architecture-ratchet`、193 项迁移清单只读、`git diff --check`及构建通过。主 chunk **368,957/485,000 字节**，视图 chunk 静态导入边界通过，不宣称性能改善。契约断言迁为校验真实动作→原保存/版本回调，另有实际执行页面桥的行为测试，没有放宽原业务要求。
- `test:production` 仍为 **211 项中 209 项通过、2 项既有人物认证 UI 断言失败**；对应面板/测试未修改，没有重跑或宣称完整 `test:studio-release` 通过。没有登录后完整浏览器、真实供应商或发布验收；保留业务的全部并发不在这些局部证据中获证。
- [有限收口清单](STUDIO-CLOSURE-CHECKLIST.md) 第一、第二批已完成，**仅剩第三批依赖/回归收口审计**，包括两条既有失败的原因/归属；不再发现新拆分点来延长任务。共享项目/镜头状态、脚本跨域协调、句级/逐镜批事务与页面装配保留。源码和文档分别提交推送，普通分支推送无部署触发；未部署、真实付费或迁移目标库，其他工作树与 `sources/` 未动。最终文档 SHA、本地/远端一致及干净状态以推送后核验为准。

## 有限收口第一批：普通数字人任务会话（2026-10-23）

- 用户要求固定结束条件，不继续发现新拆分点来延长任务。[有限收口清单](STUDIO-CLOSURE-CHECKLIST.md) 限定三批：本批普通数字人任务会话；下一批成片验收/人工交付；最后依赖/回归审计。共享项目/镜头状态、跨领域脚本协调、句级和逐镜批事务、页面装配保持完整，其余可拆点只作后续建议。
- 起点：干净集成树 `/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`，分支 `xixi1021程永罗沟通前大整合`，本地/远端均为 `ba8d484fa0252d919a2f898612d4205a2c107dbb`。源码 `c3355ee573cf9644355e38ff46f63c2c71aa37d8` 已推送。新 `studioProductionSession.ts` 统一普通数字人任务七个动作、项目读取/自动恢复、任务/方案/执行记录和去重/请求身份 Ref。草稿经原 CAS 入口延迟采集，共享镜头/素材写回为同步页面回调。主页面 **7,155→7,076 行**，会话模块 **254 行**，无新增 getter；实际价值是生命周期与验证归属，不是净降行数。详见 [任务会话 ADR](../architecture/adr/2026-10-23-studio-production-session-boundary.md)。
- 延迟回包测试先复现四个既有项目切换缺口，再验证修复：旧草稿结果不能推进供应商提交/项目采用；旧采用回执不能授权写当前镜头；旧执行详情不能覆盖新项目列表；旧版本化保存结果不能覆盖编辑器版本或弹出旧冲突提示。草稿桥允许自身新建项目 ID 的正常衔接；异步边界重新核对项目范围，已创建任务的服务端原回执保留、未知请求 ID 保留，不自动重提或取消。
- 会话、真实页面回调/草稿桥 **19 项**及版本化保存测试 **8 项**通过；连同页面工作流合同定向组 **28/28**。实际旧/新页面入口的 **21 组非切换场景**请求/草稿顺序、状态、错误、锁和请求 ID 结果相同；切换场景是有意修复，不宣称全部正文等价。仅展开本批新 Hook 的页面调用序列（382 项）与起点一致，已有自定义 Hook 未展开；完整片长、指纹和页面写回辅助正文、草稿保存参数保持一致。模块独立加载、无运行时回导页面依赖、45 个导出和两个初始 SSR（24,562/25,765 字符）对照通过。
- 实际通过 `pnpm run lint`、`pnpm run test:studio-workspace` **109/109**及构建依赖 **4/4**、`test:studio-workflow` 13 项、`test:shooting-workflow` 11 项、`test:storyboard-aigc` 66 项；`ARCHITECTURE_BASE_REF=ba8d484f pnpm run check:architecture`（2,601 个生产 TS）、`test:architecture-ratchet`、`check:digital-employee-migrations`（193 项，只读）、`git diff --check`和构建均通过。主 chunk **366,218/485,000 字节**，视图静态导入边界通过，不宣称性能改善。
- `pnpm run test:production` 仍是 **211 项中 209 项通过、2 项既有人物认证 UI 断言失败**，未修改/放宽这两项测试。未执行完整 `test:studio-release`，整套生产或 release 门禁不能登记为通过；最后固定审计批处理其原因和验收归属。
- 没有登录后完整浏览器或真实供应商验收；上述证据不代表全链路零回归，也不保证所有保留业务的跨项目并发已全面验证。原四个入口当前分别 654/538/281/187 行，最后页面尚待固定的第二、第三批收口，不以压到 800 行为条件。源码和文档分开提交推送，普通分支推送已复核不触发部署；未部署、真实付费或目标库迁移，其他工作树与 `sources/` 未动。最终文档 SHA、远端一致性和干净状态以推送后核验为准。

## 图文制作与人工复核工作区（2026-10-23）

- 起点：干净集成树 `/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`，分支 `xixi1021程永罗沟通前大整合`，本地/远端均为 `910ff71f60ed9343e47737729084b76ab4dec928`。源码 `e712b13be73620a7eaedd3eb94315052f9b7061e` 已推送。`studioPosterWorkspace.ts` 拥有八组结果状态、证据准入、素材规划、两条文案/图片生成路线、部分失败、手动修改失效、人工复核及交付资格。页面通过明确产品/输出快照、已有库存索引和必要回调连接，无新增 getter，不复制共享状态。主页面 **7,394→7,155 行**，新模块 **320 行**，预算按实际收紧；未把高耦合的逐镜批事务机械拆开。详见 [图文工作区 ADR](../architecture/adr/2026-10-23-studio-poster-workspace-ownership.md)。
- 新增真实方法行为 **14/14**，禁止真实网络；`test:studio-workspace` **89/89**，另有构建依赖 **4/4**。三个业务函数完整正文、两条资格表达式和八组状态初始化按实际源码归一化对照一致；状态在原注册位置按原顺序初始化，新模块独立加载及无回导主页面依赖检查通过。45 个导出及普通/任务入口初始 SSR HTML（24,562/25,765 字符）一致，不能据此保证全链路零回归。
- 实际通过 `pnpm run lint`、`ARCHITECTURE_BASE_REF=910ff71f pnpm run check:architecture`（2,600 个生产 TS）、`test:architecture-ratchet`、`check:digital-employee-migrations`（193 项清单，只读）、`git diff --check`；`test:studio-workflow` 13 项、`test:shooting-workflow` 11 项、`test:storyboard-aigc` 66 项、`test:studio-media`、`test:social-image-pipeline`（主组 55 项及路由/合同组）和 `pnpm run build` 均通过。主页面 chunk **363,113/485,000 字节**，视图 chunk 静态导入边界通过；不宣称性能改善。
- 再次执行 `pnpm run test:production`：211 项中 209 项通过，仍是上批已在未修改起点复现的两条人物认证 UI 断言失败。`ShotProductionPanel`、认证模块及其测试未改，没有删除或放宽断言。本批没有重跑完整 `test:studio-release`，不能将完整生产或 release 门禁登记为通过。
- 保护既有功能优先于整理代码；未完成登录后完整浏览器、项目切换/自动保存/重复生成/迟到回执的专项操作或真实供应商验收。正文、类型、局部行为及 SSR 对照仅证明对应范围，没有新增跨项目并发保证。**原五个大文件已完成四个，最后页面仍在治理**；下一批继续按完整职责评估脚本、分镜生产、候选采用及质检交付，800 不是机械目标。
- 源码与文档分开提交、推送，普通集成分支无自动部署触发。未部署、真实付费调用或迁移目标库，其他来源工作树和 `sources/` 未改；视频 P1 独立树没有合入。本批最终文档 SHA、本地/远端一致性和干净状态以推送后 Git 核验为准。

## 渲染会话生命周期所有权（2026-10-23）

- 起点：干净集成树 `/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`，分支 `xixi1021程永罗沟通前大整合`，本地/远端均为 `f333957adb5b2c5404d43b9d4b0a72268bc8060e`。源码提交 `f52c28c69f5d688b1663539e7cebcdf6559a7745` 已推送。`studioRenderSession.ts` 集中拥有十组状态、两个内部 Ref、封面请求、三条渲染执行路径、进度释放、语言版本历史和项目恢复。页面保留跨领域参数组装、就绪检查、导航与版本选择；无新增 getter 桥。主页面 **7,526→7,394 行**，新模块 **225 行**，预算按实际收紧；此批价值是完整生命周期归属，不以净降行数衡量。详见 [渲染会话所有权 ADR](../architecture/adr/2026-10-23-studio-render-session-ownership.md)。
- 新增实际行为 **14/14**：三条执行路径、授权选择、持久轮询、过期结果保护、桌面进度与订阅释放、输出签名、失败及版本历史、恢复退出、封面到参数验证顺序。测试禁止真实网络；工作台 **75/75**，另有构建导入 **4/4**。原完整参数组装正文和选定版本渲染调用参数经 TypeScript 打印归一化对照一致；新模块独立加载成功，无运行时回导页面路径。45 个导出及普通/任务入口初始 SSR HTML（24,562/25,765 字符）逐字一致；不能据此保证全链路零回归。
- 实际通过 `pnpm run lint`、`ARCHITECTURE_BASE_REF=f333957a pnpm run check:architecture`（2,599 个生产 TS）、`pnpm run test:architecture-ratchet`、`pnpm run check:digital-employee-migrations`（193 项，只读）及 `git diff --check`。`test:studio-workflow` 13 项、`test:shooting-workflow` 11 项、`test:storyboard-aigc` 66 项均通过。`test:studio-media`、release 中后续的渲染/字幕/配额锁/媒体安全/存储定向测试（48 项）、外部预检离线合同、媒体访问合同、桌面字幕测试及 `pnpm run build` 分别继续通过。主页面 chunk **360,963/485,000 字节**，真实视图 chunk 静态导入边界通过，不宣称性能改善。
- **完整 `pnpm run test:studio-release` 未通过。** 它在 `test:production` 的 211 项中有 2 项既有人物认证 UI 断言失败（209 项通过）：`ShotProductionPanel.test.tsx` 中已有照片复用及新人物认证入口均期待旧的“人物替换认证（可选）”内容。隔离的未修改 `f333957a` 源码中复现同样失败；面板、认证模块和这两项测试均未修改，没有降低业务要求或把其跳过后改报整套通过。另一个旧路径断言 `ShootingTaskDialog` 同样在基线复现，已改查共享懒加载定义、编辑视图真实导入及实际 JSX 挂载，保留原面板挂载验证。
- 状态集中后 Hook 注册顺序有所调整，初始值不变，恢复 Effect 仍在原注册点。未完成登录后完整浏览器操作或真实供应商验收；跨项目切换的全部在途请求隔离、自动保存最新状态读取及挂载后初始化/懒加载/重试恢复仍需专项验收。保护已有功能优先于缩短文件；不能从正文、类型、局部行为或初始 SSR 对照推导零回归。
- **原五个大文件已完成四个，最后的页面治理仍在继续。** 保留共享项目/镜头状态和跨领域协调，下一批继续评估分镜生产、质检及交付的必要边界；800 不是机械目标。视频 P1 仍在已交接的独立树，本批未合入其后端改动；其他来源树和 `sources/` 未动。未部署、真实付费调用或迁移目标库。普通集成分支推送已复核不触发部署，源码与文档分开提交、推送；最终文档 SHA、远端一致性及干净状态以推送后核验为准。

## 素材库存所有权与证据规划（2026-10-23）

- 起点：干净集成树 `/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`，分支 `xixi1021程永罗沟通前大整合`，本地/远端均为 `ddeb731026eb515e2e482cc5470b89a043acb5e5`。源码提交 `befdda33b396963723f146ac823c3df0780e0256` 将库存、上传/权限、输入/恢复 Ref 和读取/恢复/尺寸副作用归到同一库存模块；跨镜头证据约束迁为纯规划函数，匹配请求、失败反馈和结果写回仍留在同一个页面动作内。本批没有新增 getter 桥，脚本、产品、共享项目/镜头状态及页面协调保留。详见 [素材所有权与完成标准 ADR](../architecture/adr/2026-10-23-studio-material-ownership-and-completion-policy.md)。
- 新增行为 12 项通过；工作台共 61 项，另有构建导入 4 项。三个库存业务函数正文保持一致，仅将上传后追加共享选中列表适配为页面回调；对照起点实际代码，216 组证据/身份/锁定/路线/装配计划一致。两个新模块独立加载成功，无反向加载页面路径；普通/任务入口初始 SSR HTML（24,562/25,765 字符）和 45 个导出一致，不是挂载后浏览器或真实供应商验收。
- 实际通过 TypeScript、架构（2,598 个生产 TS）、ratchet、193 项迁移清单只读检查、空白检查、完整 Studio 脚本/媒体/工作流、分镜 AIGC 66 项、生产工作流、数字员工、租户隔离、安全边界及构建。主页面 chunk **358,872/485,000 字节**，视图 chunk 无直接/间接回导；不宣称性能改善。
- 本批期间“定位灵枢AI基线代码”会话开始在同一集成树修复后端 P1。经用户明确授权协调，该会话已将自己的 6 个已跟踪/3 个新增后端及共享合同改动迁至 `/Users/julia1/Documents/ChatGPT/1023视频生成管线/lingshu-video-p1`，分支 `codex/video-production-p1-20261023`，起点 `ddeb7310`；主树 `server/`、`shared/` 差异清空，前端改动保留。隔离后重新通过类型、架构/迁移只读、工作台 61 项及构建。本批不包含后端 P1 修复，参见 [工作树隔离记录](WORKTREE-INVENTORY.md)。
- 页面 **7,700→7,526 行**，预算按实际收紧；两个新生产模块 137/166 行。**原五个文件已完成四个，最后工作台的治理仍在继续。** 用户确认的完成标准是职责、依赖与独立验证质量，800 仅供参考；最终主文件超过 800 行可以接受。下一步评估分镜生产及预览渲染/交付的完整生命周期，不为行数继续增加扁平接线。未部署、发布、迁移目标库或调用真实付费供应商；源码与文档分开提交并推送，普通分支推送不触发部署。最终文档 SHA、本地/远端一致性和干净状态以推送后核验为准。

## 创作工作台声音工作区（2026-10-23）

- 起点：干净集成树 `/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`，分支 `xixi1021程永罗沟通前大整合`，本地/远端均为 `7a4e451b7b490a2263aa8be6fbdbbcdb40f3b641`。源码提交 `a41ece25c0b664a6ce02a87017fef86af487ba0d` 完整迁出声音状态/投影、翻译与重试、音频/音色上传、单语言/批量 TTS、试听、字幕生成/审阅和配乐。`AiCreateStudio.tsx` **8,372→7,700 行**；九个新生产模块最大 435 行，历史预算按实际收紧，没有新增豁免。详见 [声音工作区 ADR](../architecture/adr/2026-10-23-studio-voice-workspace-boundary.md)。
- 122 个只读类型端口连接唯一状态/Ref，Hook/Effect 和即时/延迟读取保持原时序。项目恢复与声音动作共用取消和请求代际；语言删除清理相关结果，配乐变化继续使已有渲染失效。九个模块逐进程加载成功，没有反向加载主页面的运行时路径；该接线面仍需在后续页面装配中收敛。
- 当前模块实际正文恢复后的整个控制器运行时语法树与起点一致。禁止网络的普通/任务入口初始 SSR HTML（24,562/25,765 字符）逐字一致，45 个运行时导出不变。新增行为 11 项、接线合同 3 项通过，工作台共 49 项，另有构建依赖 4 项；API 使用替身并断言零真实网络调用。不是登录后浏览器或真实供应商验收。
- 实际通过 `pnpm run lint`、`ARCHITECTURE_BASE_REF=7a4e451b pnpm run check:architecture`（2,596 个生产 TS）、ratchet、193 项迁移清单只读检查、`git diff --check`、完整 Studio 脚本/媒体/工作流、分镜 AIGC 66 项、生产工作流、数字员工、租户隔离、安全边界及构建。主页面 chunk **356,669/485,000 字节**，实际视图 chunk 无直接/间接回导；不宣称性能改善。
- **原五个大文件已完成四个，最后的页面仍未完成。** 继续素材、分镜/生产、渲染及页面编排的完整职责治理，800 不是机械切割目标。未部署、发布、迁移目标库或调用真实付费供应商；其他工作树与 `sources/` 未动。源码与文档分开提交并推送，普通集成分支推送不触发部署；最终文档 SHA、本地/远端一致性和干净状态以推送后 Git 核验为准。

## 创作工作台项目生命周期（2026-10-23）

- 起点：干净集成树 `/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`，分支 `xixi1021程永罗沟通前大整合`，本地/远端均为 `93c22cf7a0d579a6dc3e40d9bcc0187cfd66999b`。源码提交 `eaef39d123abec3d20bc355dd8ddd9f608cbf2b5` 将项目状态、入口恢复、完整快照/回填、CAS 保存及冲突、作品动作和自动保存迁入九个生产模块。`AiCreateStudio.tsx` **9,289→8,372 行**，预算按实际收紧；没有新增豁免。详见 [项目生命周期 ADR](../architecture/adr/2026-10-23-studio-project-lifecycle-boundary.md)。
- Hook/Effect 保持原注册位置和顺序，状态/Ref 不复制；内部只读端口有 377 个明确字段，各消费者限制实际字段。动作工厂不提前读取未来绑定，快照投影与异步读取时机保持原语义；该接线量仍需随其他领域状态治理继续收敛。九个新模块逐进程加载成功，没有反向加载主页面的运行时路径。
- 当前模块正文按真实接线恢复后，整个控制器转译运行时语法树与起点一致。45 个运行时导出与普通/任务入口初始 SSR HTML（24,562/25,765 字符）逐字一致，夹具禁止网络；不是登录后浏览器或供应商验收。新增保存/冲突/排队/保护改名/删除/延迟端口行为 7 项、接线合同 3 项通过；工作台共 35 项，另有构建依赖 4 项。
- 实际通过 `pnpm run lint`、`ARCHITECTURE_BASE_REF=93c22cf7 pnpm run check:architecture`（2,587 个生产 TS）、ratchet、193 项迁移清单只读检查、`git diff --check`、完整 Studio 脚本/媒体/工作流、分镜 AIGC 66 项、生产工作流、数字员工、租户隔离、安全边界及构建。主页面 chunk **337,264/485,000 字节**，较上批增加；真实视图 chunk 直接/间接回导门禁通过，不宣称性能改善。
- **原五个大文件已完成四个，最后的工作台控制器仍未完成。** 下一批继续素材、分镜/装配、语音及生产/渲染领域；800 不是机械切割目标。未部署、发布、迁移目标库或调用真实付费供应商。源码与本文档分开提交，普通分支推送已复核不触发部署；其他工作树及 `sources/` 未动。最终文档 SHA、本地/远端一致性和干净状态以推送后 Git 核验为准。

## 创作工作台合同、规则与完整视图区（2026-10-23）

- 起点：集成树 `/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`，分支 `xixi1021程永罗沟通前大整合`，本地/远端均为 `a6d16f6ab20ed762920e303f99245a5bca87232a`，工作区干净。源码提交 `54d114d69ae125e15d5eeded3166ad962d159136` 迁出 17 组规则/目录/本地媒体辅助、前端合同/草稿形态、六个完整视图区和统一可选面板定义。`AiCreateStudio.tsx` **12,000→9,289 行**，预算按实际收紧；最大新视图 709 行，没有新增豁免。**最后一个页面仍未完成**：状态、Ref、Effect、项目保存及生产编排继续保留在控制器，下一批按完整生命周期迁移。详见 [工作台合同与视图区 ADR](../architecture/adr/2026-10-23-studio-workspace-contracts-and-views.md)。
- 视图使用明确的各自输入合同并复用原模型/动作；步骤渲染仍延迟读取当前值，没有新增 DOM 包装或状态副本。媒体预览的 `fontCss` 直接依赖字体模块，页面保留同一函数转导出；另外四处类型消费者直接使用既有底层合同。32 个新生产模块逐个独立进程加载通过，没有反向加载主页面的运行时路径，原主应用/流量页懒加载路径兼容。
- 将六个视图的实际新正文按真实绑定还原到页面后，**56 个完整原函数正文、48 个常量/箭头初始化逻辑一致**，包含整个控制器及其 Hook/Effect 顺序。源码合同装配器核验输入简写绑定逐项匹配，不读取基线快照来代替新实现。实际加载对照 **45 个运行时导出一致**；禁止网络的隔离夹具中，普通/任务两个初始服务端渲染 HTML（24,562/25,765 字符）逐字相同，未据此声明登录后浏览器验收。
- 新增视图行为 **6/6**，覆盖语言不可误删及委托、实际字幕/对齐/忙碌门禁、就绪生成委托、单一折叠效果区、不相关面板不挂载和字体兼容；完整页面/视图 **25/25**。一份旧 Agent 入口合同在源码相同的未修改基线同样失败，改查实际经营日历入口并保留真实生产任务绑定；懒加载/属性栏合同检查真实定义或 AST 分支，其余位置合同读取实际组成模块。
- 构建中复现共享绑定被打包回页面导致“视图→支撑→页面”循环，已调整静态视图/支撑缓存分组。原 **485,000 字节上限未放宽**；构建门禁现额外验证唯一视图 chunk 及无直接/间接静态主入口依赖，新增 **4/4** 边界测试。最终主 chunk **306,364/485,000 字节**、视图 **134,024 字节**，另有缓存支撑 chunk；未宣称首屏总传输量或全部性能债务解决。
- 实际通过：`pnpm run lint`、`ARCHITECTURE_BASE_REF=a6d16f6a pnpm run check:architecture`（2,578 个生产 TS、仍 1 个历史预算）、ratchet、193 项仓库迁移清单只读检查、`test:studio-workspace`（构建依赖 4 项及页面/视图 25 项，已接入 `test:studio-release`）、完整 `test:studio-media`、`test:studio-script`、`test:studio-workflow`、`test:storyboard-aigc`（66/66）、`test:social-content-frontend`、`test:video-source-boundaries`（167/167）、`test:production-workflows`、`test:digital-employees`、`test:tenant-isolation`、支持会话只读与爬虫安全、生产构建及源码暂存空白检查。
- 原五项仍为四项完成、最后一个控制器持续治理；不能把本批视图拆分或 ratchet 通过替代完整目标。未执行真实付费/供应商验收、目标库迁移、发布或部署，其他工作树及 `sources/` 未动；普通分支推送不触发部署的边界已复核。源码与文档分开提交；最终文档 SHA、本地/远端一致性和干净状态以推送后 Git 核验为准。

## Studio 服务完整职责拆分（2026-10-23）

- 起点：集成树 `/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`，分支 `xixi1021程永罗沟通前大整合`，本地/远端均为 `21a64ab5658d99bc71f5b0c9919b43c16e7b78ce`，工作区干净。源码提交 `ac047449c10dfac3c35b07a91ba7c6179dc71e0f` 将生成、分镜原请求恢复/QA、渲染、数字人、素材、语音及项目证据按完整职责迁出。`studio.ts` **7,221→187 行**，单实例装配 301 行，最大新用例 628 行；移除服务历史预算，未新增豁免。脚本的策略、模式提示词和质量规则各为纯模块，未为行数拆散状态机。详见 [Studio 应用边界 ADR](../architecture/adr/2026-10-23-studio-application-boundaries.md)。
- 完整依赖图审计处理四类间接循环：产品身份直接依赖既有 planning 函数；社媒作品只读策略迁至独立模块；Worker 直接复用原素材视频分析；项目保存直接调用完整发布审批失效能力。旧入口兼容转导出/委托，同一租户上下文、语音缓存、活动渲染集合、数字人恢复计时器和创建队列保持唯一所有权；数据/媒体路径归一化后与原位置相同。**53 个新生产模块逐个独立加载通过，零反向主入口路径**。
- 实际加载起点源码与新模块，**94 项 Router/中间件栈及顺序、69 个运行时导出完全一致**。AST 对照确认 **85 个原函数正文一致**；用三个纯脚本模块中的实际迁移语句还原后，**81 个路由表达式一致**。共享策略/仓储/审批失效的额外 7 个迁移语句一致；模型、冻结事实、付费与未知结果门禁未变。
- 新增 **10 项行为测试**纳入 Studio 工作流，覆盖租户隔离、原请求处理中/不明/冲突/恢复失败/成功复用、跨租户预算证据先拒绝及当前脚本与商业字段交付门禁。新边界/合同组合 **19/19**，原生语音付费、HeyGen、素材分析、审批失效、社媒作品工作区和项目 CAS 调用方组合 **21/21**。两份旧复刻合同在未修改起点上同样失败，修正为核验当前提示词/事实修复、素材证据和最终准入，未改变生产行为；其他源码位置合同改查实际组成模块或 AST。
- 实际通过：`pnpm run lint`、`ARCHITECTURE_BASE_REF=21a64ab5 pnpm run check:architecture`（2,546 个生产 TS、剩 1 个历史预算）、`test:architecture-ratchet`、`check:digital-employee-migrations`（193 项仓库只读完整性）、完整 `test:studio-script`、`test:studio-workflow`、`test:studio-media`、`test:storyboard-aigc`（66/66）、`test:production-workflows`、`test:execution-gaps`、`test:digital-employees`、`test:tenant-isolation`、`test:material-import`（18/18）、`test:social-image-pipeline`、支持会话只读及爬虫安全，生产构建与源码暂存空白检查。前端生产代码未改，Studio chunk 480,957/485,000 字节。
- 原五项已完成四项，仍待完整拆分 **`AiCreateStudio.tsx` 12,000 行**；整个目标继续有效。未执行真实供应商/付费、目标库迁移、登录后浏览器验收、发布或部署。其他工作树及 `sources/` 未动，普通分支推送不触发部署的工作流边界已复核。源码与文档分开提交；最终文档 SHA、本地/远端一致性和干净状态以推送后 Git 核验为准。

## 视频应用与执行管线完整拆分（2026-10-23）

- 起点：集成树 `/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`，分支 `xixi1021程永罗沟通前大整合`，本地/远端均为 `f9cff15fcc4552747697b722ba0d418bdf659e72`，工作区干净。源码提交 `5d43242f` 按完整职责迁移采集/发现、供应商、下载、来源与素材分析、维护/Worker 及 HTTP 用例。`videos.ts` **7,823→281 行**，共享装配 296 行，最大新领域实现 627 行；移除视频预算，没有新增豁免。详见 [视频应用 ADR](../architecture/adr/2026-10-23-video-application-boundaries.md)。
- 原共享实例、下载槽位、队列、计时器、运行代理、活动/持久分析租约和归一化数据目录保持唯一所有权与原位置。实际加载起点和新源码，**47 项 Router/中间件栈、58 个运行时导出完全一致**；AST 规范化确认 **184 个原视频函数正文、44 个直接路由表达式一致**。
- 依赖审计发现采集预算/候选评估经周复盘扫描、生产/素材分析绕回视频主入口。原身份函数独立为 `weeklyReviewActor.ts`，23 个生产调用方直接引用，旧入口兼容转导出；40 个新生产模块逐个独立进程加载通过，零反向主入口路径。额外修复未修改基线上可复现的本地排期确认身份问题：本地权威明确不认识的用户在应用用户库查询前拒绝；停用用户拒绝及正式身份查询保持原规则。
- 新增 6 项行为测试覆盖许可拒绝、同一原运行、下载槽位与危险来源；视频来源 **167/167**、深入下载/分析 **124/124**、身份/发现/周流程 **216/216** 通过。源码合同改读组成模块/AST；基线上复现的口播/灵感旧位置合同、费用预算夹具及测试模式夹具分别修正，没有放宽生产付费或 ASR 门禁。
- 实际通过：`pnpm run lint`、`ARCHITECTURE_BASE_REF=f9cff15f pnpm run check:architecture`（2,493 个生产 TS）、`pnpm run test:architecture-ratchet`、`pnpm run check:digital-employee-migrations`（193 项只读完整性）、`test:video-source-boundaries`、完整 `test:production-workflows`、`test:execution-gaps`、`test:digital-employees`、`test:tenant-isolation`、`test:social-image-pipeline`，以及支持会话/爬虫安全、视频路由/精确分析/身份调用方组合回归、`pnpm run build` 和源码暂存空白检查。Studio chunk 480,957/485,000 字节。
- 原五项已完成三项，仍待完整拆分 **Studio 路由 7,221 行、Studio 页面 12,000 行**。目标继续有效；不以 800 行机械切片或 ratchet 通过宣布完成。未执行真实供应商/付费、目标库迁移、登录后浏览器验收、发布或部署。其他工作树和 `sources/` 未动，普通分支推送不触发部署的工作流已复核。源码与文档分开提交，最终文档 SHA、远端一致性与干净状态以推送后 Git 核验为准。

## 数字员工主文件完整应用/路由拆分（2026-10-23）

- 起点：集成树 `/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`，分支 `xixi1021程永罗沟通前大整合`，本地/远端均为 `7f90b99da4f03cc0ddee74b95ea4437262678463`，工作区干净。源码提交 `3076f875a3126812a3424078fa9a0f549bf97423` 将剩余运行状态机、审批准备、周目标开工、事实重建、经营包、初始化、事件/浏览器和领域 HTTP 回调按完整职责迁出。
- `digitalEmployees.ts` **4,113→538 行**，现在只做统一门禁、单实例装配、原顺序挂载和兼容入口委托；移除该历史预算。最大新领域模块为运行协调器 644 行，经营包路由 506 行。不是按行数切片：共享启动队列、运行锁、计时器、事件追加队列和客户编辑队列仍各有唯一所有者。记录合同迁入领域，旧入口转发兼容；内部端口类型不初始化实现模块。详见 [数字员工完整装配 ADR](../architecture/adr/2026-10-23-digital-employee-application-assembly.md)。
- 分别实际加载未修改起点源码与新模块，**59 项路由/中间件栈及 13 个导出入口完全一致**。TypeScript AST 规范化对照确认 **52 个原函数正文和 46 个直接路由/中间件表达式一致**。后台运行协调、初始化 Worker、助手周动作、移动重试、跟进模板和原复盘/纠偏实例继续复用；没有新供应商、审批或发送通道。
- 新增 9 项应用行为测试并纳入数字员工领域组，覆盖先验租户归属、暂停/取消/失败运行不启动工作、未拥有/未提交/社媒血缘目标禁止开工、事件先持久后按序广播和失败队列恢复。旧跨领域源码合同读取当前组成模块，路由/函数检查用 AST 精确选择，保留业务门禁；新测试夹具的泛型和可选 CAS 类型已修正，最终 TypeScript 通过。
- 实际通过：`pnpm run lint`、`ARCHITECTURE_BASE_REF=7f90b99d pnpm run check:architecture`（2,453 个生产 TypeScript 文件）、`pnpm run test:architecture-ratchet`、`pnpm run check:digital-employee-migrations`（193 项仓库只读完整性）、完整 `pnpm run test:digital-employees`、`pnpm run test:review-todos`、`pnpm run test:social-managed`、`pnpm run test:production-workflows`、`pnpm run test:execution-gaps`、`pnpm run test:tenant-isolation`、`node --import tsx --test server/security/supportSessionReadOnly.test.ts`、`pnpm run build`、暂存后的 `git diff --cached --check`。构建无大 chunk 警告，Studio chunk 480,957/485,000 字节，预算仍紧。
- 原五项已完成灵感页、数字员工两项；仍有视频路由 7,823、Studio 路由 7,221、Studio 页面 12,000 三项，完整目标继续有效。没有真实供应商/付费调用、目标库迁移、登录后浏览器验收、发布或部署；其他工作树与 `sources/` 未动。普通分支推送不触发部署的工作流边界已复核。源码与文档分开提交；最终文档 SHA、本地/远端一致性和干净状态以推送后 Git 核验为准。

## 灵感工作区完整拆分与五文件治理目标调整（2026-10-23）

- 用户确认目标：完成原五个大文件的职责拆分，充分考虑外部依赖；800 行只作规模提示，不机械切片。现有架构门禁不放宽，完成依据为明确职责、依赖方向、入口兼容和行为回归。后续顺序与调用方盘点记入 [灵感工作区及剩余治理 ADR](../architecture/adr/2026-10-23-inspiration-workspace-boundaries.md)。整个五文件治理目标仍在进行。
- 起点：集成树 `/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`，分支 `xixi1021程永罗沟通前大整合`，本地/远端均为 `2e889cf4a18204b0c12d8ea42fd7f86bc66e813e`，工作区干净。源码提交 `88273c4263852dea14acc5f143304a9c7afcec59` 将发现库存/轮询、分析动作、创作交接、素材工作区、编辑/删除和素材画廊按完整职责迁出；页面保留共享选中状态、导航核验与装配。新模块通过明确类型端口连接，不从页面反向导入实现；原具名导出、主应用/流量页懒加载和开发审核入口兼容。
- 灵感页 **2,014→654 行**，移除该历史超限预算；迁出的五个 Hook 分别为 428、252、235、510、127 行，素材画廊 262 行，共享合同 73 行。规模变化来自职责划分。28 个迁移函数正文和画廊 JSX 的 token 对照保持一致。当前剩余四项为数字员工 4,113、Studio 路由 7,221、视频路由 7,823、Studio 页面 12,000；不能用架构门禁通过替代后续完整治理。
- 新增 7 项隔离端口行为测试并纳入视频来源领域组，覆盖分析完成/失败/暂停、无记录拒绝、图文状态同步/失败不重提、上传归属先写后刷新与通知。更新分页、素材所有权/产品集合、图文分析、预览、创作交接和二进制上传的旧源码位置合同，保留原断言语义。
- 实际通过：`pnpm run lint`、`ARCHITECTURE_BASE_REF=2e889cf4 pnpm run check:architecture`（2,432 个生产 TypeScript 文件）、`pnpm run test:architecture-ratchet`、`pnpm run check:digital-employee-migrations`（193 项只读完整性）、`pnpm run test:video-source-boundaries`（157/157）、`pnpm run test:social-content-frontend`、`pnpm run test:social-managed`、`pnpm run test:tenant-isolation`、`node --import tsx --test server/security/supportSessionReadOnly.test.ts`，以及上传/素材对话/数字员工页面/新行为的额外 11 项组合。最终 `pnpm run build` 通过，无大 chunk 警告，Studio chunk 480,957/485,000 字节；源码暂存后 `git diff --cached --check` 通过。
- 本批同时只读扫描了原五文件在 `src/`、`server/`、`shared/` 的静态、转导出和字符串动态导入；后续必须继续保留 Worker 初始化、运行协调、移动重试、生产/分析 Legacy Ports、语音付费上下文、Studio 类型与 `fontCss` 调用契约。未执行真实供应商、LinkedIn 付费采集、目标库迁移、登录后浏览器验收、发布或部署。其他工作树和 `sources/` 未改动；普通分支推送不触发部署的边界已复核。源码与文档分开提交；最终文档 SHA 和本地/远端一致性以推送后 Git 核验为准。

## 业务资源准备与回执观察完整职责拆分（2026-10-23）

- 起点：集成树 `/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`，分支 `xixi1021程永罗沟通前大整合`，本地/远端均为 `5877764ca774446dfc86c48fad05a14a61cc3d49`，工作区干净，旧主会话 idle。源码提交 `5fe36cf0bc305c3ee9f40063adc3a8c7c30c9696` 将采集、内容生产/质量、发布、客户归因、分层、跟进草稿与发送回执的准备/观察职责整组迁出。
- `taskBusinessObservation.ts`（245 行）持有租户/运行/任务限定的完成证据判定，复用原跟进恢复与预检端口；它并非承诺零写入的纯查询模块。`taskBusinessPreparation.ts`（323 行）持有资源准备编排，通过明确类型端口复用原调度器、内容生产、客户分层、跟进草稿、冻结企业事实和浏览器执行能力。主路由只装配这两个服务，正常协调、审批预检与纠偏继续共用同一观察入口；没有新增供应商或发送通道。
- `digitalEmployees.ts` 从 4,561 降至 **4,113 行**，预算同步收紧。`observeTaskProof`、`prepareObserveBusinessResource`、`prepareObserveBusinessResourceDirect` 三个函数与起点源码归一化比较，逻辑正文全部一致。浏览器模式下先持久化采集配置、再进入原点击回调；动态执行适配器、冻结资料、原采集重试策略、知识缺口与逐账号回执判断均保留。完整边界见 [业务准备与观察 ADR](../architecture/adr/2026-10-23-task-business-runtime.md)。全仓仍有 5 个历史超限文件：数字员工 4,113、Studio 路由 7,221、视频路由 7,823、Studio 页面 12,000、灵感页 2,014，结构治理仍未完成。
- 新增 14 项独立行为测试，通过显式假端口验证：租户汇总不能替代当前任务采集证据、托管内容必须有当前血缘与成片证明、发布需要全部目标账号回执、客户归因与分层范围、只恢复最新有效跟进批次、模拟适配器优先级、未批准采集不点击、配置/点击/执行顺序、已执行采集不自动重提、失败不追加重试、冻结事实与订单传递、知识缺口保留、跟进草稿不发送、空客户不建分群。加原路由、跨周参考和采集重观察合同共 **17/17** 通过，新增测试已纳入 `test:digital-employees`。
- 扩大定向检查发现旧 `scheduledCollectionReconcile.contract.test.ts` 仍要求 `task.status === 'waiting_external'` 字面形式；只读核对起点已有 `waiting_external`、`waiting_human`、`waiting_approval` 三状态处理。合同更新为检查现行三状态回退，运行逻辑未改。
- 实际全部通过：上述定向组、`pnpm run lint`、`ARCHITECTURE_BASE_REF=5877764c pnpm run check:architecture`（2,425 个生产 TypeScript 文件）、`pnpm run test:architecture-ratchet`、`pnpm run check:digital-employee-migrations`（193 项仓库只读完整性）、完整 `pnpm run test:digital-employees`、`pnpm run test:production-workflows`、`pnpm run test:execution-gaps`、`pnpm run test:tenant-isolation`、`node --import tsx --test server/security/supportSessionReadOnly.test.ts`、`pnpm run build`，以及暂存后 `git diff --cached --check`。构建无大 chunk 警告，Studio 主 chunk 480,957/485,000 字节，仍接近预算。
- 未执行真实供应商、LinkedIn 付费采集、目标库迁移、登录后浏览器验收、发布或部署；其他工作树及 `sources/` 未改动。普通分支推送不触发部署的工作流边界已复核。源码和文档分开提交；最终文档 SHA、远端一致性和干净状态以推送后 Git 核验为准。

## 周复盘与下一周期完整职责拆分（2026-10-23）

- 起点：集成树 `/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`，分支 `xixi1021程永罗沟通前大整合`，本地/远端均为 `c79e583dcf912ed412183e5f8586ff2d7a305d06`，工作区干净，旧主会话 idle。源码提交 `5ad6bcc26962d587a15c04c621bd37ef42b9c3d7` 迁出完整的复盘聚合/保存、手动刷新、定时去重、复盘待办分配及托管周期续接。
- `weeklyReviewApplication.ts`（309 行）统一持有上述应用用例；`weeklyReviewProjection.ts`（59 行）持有任务动作与复盘摘要纯投影，旧 `digitalEmployeeReviewSummary.ts` 保留兼容转发；`digitalEmployeeWeeklyReviewRoutes.ts`（54 行）只做生成/待办 HTTP 协议适配并复用既有 `ReviewTodoService`。后台导出的 `generateScheduledRunReview`、`continueManagedOperatingCycle`、`allocateReviewTodos` 继续转发到同一应用实例，正常执行收尾也使用同一 `completeReview`。
- `digitalEmployees.ts` 从 4,832 降至 **4,561 行**，预算同步收紧。五个迁移函数与起点逐段归一化比较，逻辑正文全部一致。共享启动队列、定时复盘持久标记、托管续接数据库租约、计划 CAS、部分写入恢复及激活前再次核对授权均保持原顺序；没有新增供应商调用。详见 [周复盘与下一周期 ADR](../architecture/adr/2026-10-23-weekly-review-application.md)。全仓仍有 5 个历史超限文件：数字员工 4,561、Studio 路由 7,221、视频路由 7,823、Studio 页面 12,000、灵感页 2,014，不能按 ratchet 通过宣称结构治理完成。
- 新增应用行为 6 项、真实本地 HTTP 适配 3 项；连同现有路由/时间表合同、托管续接和复盘待办集成共 **13/13** 通过。覆盖复盘刷新不重复建记录、不把活跃运行改为完成、跨租户拒绝、同一时段并发去重、写入失败不留成功标记、不可续接时释放租约、认证身份/修订号传递及 HTTP 错误状态。新增 9 项已纳入 `test:digital-employees`。
- 扩大验证发现原 `reviewTodos.integration.test.ts` 在当前启动前置条件下缺少数字人配置，并让知识待办用例意外继承制作任务；已在隔离导出的未修改 `c79e583d` 基线上复现同一数字人前置失败。修正离线夹具：提供显式授权数字人，并将知识待办来源包限定为其复盘工作，继续验证具体知识任务、启动、任务写入中断恢复及不重复建运行。生产启动、预算、资料和真实供应商门禁未修改；制作与托管授权预检继续由完整托管集成组验证。
- 实际通过：上述定向组、`pnpm run lint`、`ARCHITECTURE_BASE_REF=c79e583d pnpm run check:architecture`（2,423 个生产 TypeScript 文件）、`pnpm run test:architecture-ratchet`、`pnpm run check:digital-employee-migrations`（193 项仓库只读完整性）、完整 `pnpm run test:digital-employees`、`pnpm run test:review-todos`、`pnpm run test:social-managed`、`node --import tsx --test server/security/supportSessionReadOnly.test.ts`、`pnpm run test:tenant-isolation`、`pnpm run build`。提交前复核整个代码差异的 `git diff --check` / `git show --check`；新投影继承的尾部空行已清除。构建无大 chunk 警告，Studio 主 chunk 480,957/485,000 字节，仍接近预算。
- 未执行真实供应商、LinkedIn 付费采集、目标库迁移、登录后浏览器验收、发布或部署；其他工作树及项目 `sources/` 未改动。普通分支推送不会触发部署的工作流边界已重新核对。源码与文档分开提交；最终文档 SHA、远端一致性及干净状态以推送后核验为准。

## 数字员工任务纠偏完整职责拆分（2026-10-23）

- 起点：分支 `xixi1021程永罗沟通前大整合` 的本地/远端均为 `81ad476ee9e716c177dd9928fac52023e7e37874`，集成树干净，旧主会话 idle。源码提交 `a7b3844753d28b2938edfc131f26fecf4c59d9eb` 将重试、跳过、人工完成、重规划、编导继续/调整/放弃、业务证据校验与补充整组迁出主路由。
- `server/digitalEmployees/taskInterventionApplication.ts`（434 行）持有共享应用用例，保留 run 锁、任务版本、审批限制、精确分析覆盖、真实回执、纠偏审计与下游失效边界；`server/routes/digitalEmployeeTaskInterventionRoutes.ts`（112 行）只处理 HTTP 参数/响应并调用既有服务。主路由保留鉴权、依赖装配、移动端兼容重试导出和正常运行协调；助手决策、Web、移动端仍共用一个 `applyTaskControl`。正常运行和纠偏均注入原 `taskCorrectionSupersession` 实现，没有第二套失效流程。
- 最终精确计数：`digitalEmployees.ts` 由 5,259 降至 **4,832 行**，预算同步收紧。这是完整职责组的迁移，仍不代表该主路由整体拆分完成。其他四项历史预算未变：Studio 路由 7,221、视频路由 7,823、Studio 页面 12,000、灵感页面 2,014；全仓仍有 5 个超限文件。应用服务与兼容表面决策见 [`2026-10-23-digital-employee-task-intervention.md`](../architecture/adr/2026-10-23-digital-employee-task-intervention.md)。
- 定向验证：新应用服务 11 项、真实本地 HTTP 适配 4 项行为测试全部通过；加原路由、编导合同与依赖失效回归共 20/20。覆盖跨租户和旧版本无写入、带回执禁止重跑、审批节点不可人工绕过、精确分析未覆盖不可跳过、重规划替换旧图、长期规则候选不自动启用、证据去重及下游审批失效、编导继续保留授权及调整失败回滚。核心纠偏函数与证据解析器还与起点源码逐行归一化比较，逻辑正文一致。新测试已纳入 `test:digital-employees`。
- 实际检查全部通过：`pnpm run lint`、`ARCHITECTURE_BASE_REF=81ad476e pnpm run check:architecture`（2,420 个生产 TypeScript 文件）、`pnpm run test:architecture-ratchet`、`pnpm run check:digital-employee-migrations`（193 项仓库只读完整性）、完整 `pnpm run test:digital-employees`、`pnpm run test:tenant-isolation`、`pnpm run build`、`git diff --check`。本次构建无大 chunk 警告，Studio 主 chunk 480,957/485,000 字节；未据此声称加载性能债务解决。
- 未执行真实供应商、LinkedIn 付费采集、目标数据库迁移、登录后浏览器验收、发布或部署；来源工作树未改动。已重新核对工作流：普通分支推送不自动部署。源码与文档分开提交；最终文档 SHA、本地/远端一致性和干净状态以推送后核验为准。剩余任务继续按执行协调、周计划审批、供应商管线及页面控制职责治理，不放宽预算。

## 承接核验与灵感素材库存生命周期拆分（2026-10-23）

- 用户确认停止旧会话后承接；起点集成树 `/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`，分支 `xixi1021程永罗沟通前大整合`，本地与 `git ls-remote origin` 均为 `a8b53951d85ec253a7f941bd3e05507c795fd41c`。保留旧会话停止前留下的两份 AIGC 审计文档增量，并用当前源码和离线回归重新核验。未改动其他工作树。
- 源码提交 `630c412614d13f860e2f361d57b36a5e9b76d52e` 将普通素材全分页读取、产品详情抽屉请求/关闭失效、产品摘要批量刷新及相应状态迁至 `useInspirationMaterialInventory.ts`（154 行）；页面继续负责展示、筛选、预览和写入。`InspirationDashboard.tsx` 从 2,138 降至 2,014 行，预算同步收紧。更新调用边界合同，并修复扩大回归发现的历史合同仍在原页面/路由查找已拆出弹窗和素材投影的问题，未放宽行为要求。
- 实际通过：新 Hook 行为 2/2（完整分页去重与旧请求晚返回）、原定向库存/弹窗/页面合同 6/6、`pnpm run lint`、`ARCHITECTURE_BASE_REF=a8b53951 pnpm run check:architecture`（2,418 个生产 TypeScript 文件）、`pnpm run test:architecture-ratchet`、`pnpm run check:digital-employee-migrations`（193 项，只读仓库完整性）、`pnpm run test:video-source-boundaries`（150/150）、`pnpm run test:social-content-frontend`、`pnpm run test:tenant-isolation`、`pnpm run test:social-image-pipeline`（主组 55/55、HTTP/合同组通过）、`pnpm run build`、`git diff --check`。本次构建日志未出现大 chunk 警告；Studio 主 chunk 仍为 480,957/485,000 字节，接近现有预算，不据此宣称加载性能债务解决。此前章节的大 chunk 提示属于当时记录。
- `rg -n '/agent-usage-costs|agentUsageCosts|AgentUsageCosts' src server shared` 仅匹配两处测试的禁止性断言，生产代码无旧入口。仍有 5 个历史超限文件：数字员工路由 5,259、Studio 路由 7,221、视频路由 7,823、Studio 页面 12,000、灵感页面 2,014 行。整体结构拆分尚未完成，后续继续按完整职责边界治理，不得把 ratchet 通过作为完成。
- 未执行登录后浏览器、真实供应商、LinkedIn 真实付费采集、目标库迁移、发布或部署；Qwen→Gemini 降级按用户要求保留，自动 GPT 图片复核未接入路由。推送前已核对全部仓库工作流：部署仅 `workflow_dispatch`；镜像工作流仅 PR、版本 tag 或手动；普通分支推送不自动部署。文档提交与远端最终 SHA 以提交后 Git/远端核验为准。

## 图片 AIGC 来源与剩余独有提交复核（2026-10-23）

- 集成点 `a8b53951` 时只读复核原图片树 `95b0bcc1` 和新图片树 `23b1bb93`：原树 28 个状态项中的已跟踪源码改动属于日历，不是新图片管线；新树的确定性图层/蒙版能力已选择性合入，自动 GPT 复核路由仍与用户要求保留的 Qwen→Gemini 行为及未完成的付费许可冲突。两树原位保留，详见 `WORKTREE-INVENTORY.md`。
- `test:social-image-pipeline` 离线回归通过，主组 55/55；未执行真实供应商、目标库迁移、浏览器验收或部署。本节是来源审计，不是代码合并或真实链路完成证据。

## 灵感素材弹窗展示边界拆分（2026-10-23）

- 将素材上传归属与编辑/删除确认的既有 Ant 弹窗渲染迁至 `InspirationMaterialDialogs.tsx`，页面保留租户身份、状态、文件选择、API 写入和刷新动作；顺手移除未使用的焦点处理变量。`InspirationDashboard.tsx` 从 2,178 降至 2,138 行并收紧预算。全仓仍有 5 个历史超限文件，不能视为拆分完成。
- 弹窗边界合同 2/2、`test:video-source-boundaries` 148/148、租户隔离、TypeScript、架构扫描/ratchet（2,417 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建和 `git diff --check` 通过。Studio 主 chunk 为 480,957/485,000 字节，构建仍有大 chunk 提示。未做登录后浏览器验收、LinkedIn 真实付费采集、其他真实供应商、目标库迁移或部署。远端 SHA 与工作区状态以推送后核验为准。

## 数字员工客户跟进只读端点拆分（2026-10-23）

- 将批次详情、Worker 状态和人工发送预检迁至 `digitalEmployeeFollowupReadRoutes.ts`，在原数字员工鉴权与支持会话只读门禁之后、人工发送路由之前挂载。租户身份仍从认证上下文读取；实际发送和回执链未改动。`digitalEmployees.ts` 从 5,282 降至 5,259 行，历史预算同步收紧；全仓仍有 5 个超限文件，结构治理未完成。
- 数字员工路由合同、完整 `test:digital-employees`、租户隔离、TypeScript、架构扫描与 ratchet（2,416 个生产 TypeScript 文件）、193 项迁移清单只读检查、生产构建及 `git diff --check` 通过。Studio 主 chunk 为 480,957/485,000 字节；未测试 LinkedIn 真实付费采集，未调用其他真实供应商、执行目标库迁移、浏览器验收或部署。提交与远端 SHA 以推送后核验为准。

## 干净来源工作树可恢复归档（2026-10-23）

- 按用户确认的归档选择，将无独有补丁、Git 状态干净的 `safe-all-modules-ui-20261009` 与 `colleague-handoff-20261019` 完整检出先备份为私有压缩包并校验，再移除工作树注册和原检出。归档包包含原被忽略业务/媒体数据；两条命名分支和 HEAD 提交保留。精确清单、SHA-256 与恢复步骤见 `WORKTREE-INVENTORY.md` 引用的归档文件。
- 注册工作树由 11 降至 9；其余 6 棵脏来源树和 2 棵有独有提交的干净树未改动。集成分支源码、真实供应商、迁移、部署均未因此变化；此处仅证明两棵树可恢复地归档，不宣称其他工作树已清理。

## Studio 裂变批次与发布链接路由拆分（2026-10-23）

- 代码提交 `dfd0b61c` 将租户限定裂变批次状态、认领与失败项重试迁至 `studioVariationBatchRoutes.ts`；将终态发布回执链接、指标投影及素材用量读取迁至 `studioPublishLinkRoutes.ts`，旧 `terminalPublishedPlatformPostId` 公开导出保持兼容。`studio.ts` 在原门禁之后按原顺序注册，主路由从 7,333 降至 7,221 行并收紧历史预算；全仓仍有 5 个超限文件。
- 两组临时文件 HTTP 回归及原生成真实性共 3/3、完整 `test:studio-workflow`、租户隔离、TypeScript、架构扫描/ratchet（2,415 个生产 TypeScript 文件）、193 项迁移清单只读检查、生产构建和 `git diff --check` 通过。Studio 主 chunk 为 480,957/485,000 字节，构建仍有大 chunk 提示。未发起真实供应商、发布、LinkedIn 付费采集、目标库迁移、浏览器验收或部署。远端 SHA 与工作区状态以推送后核验为准。

## Studio 翻译端点整组拆分（2026-10-23）

- 代码提交 `41fd9bfc` 将企业名称发音翻译、单语/批量翻译及请求断连/超时处理迁至 `studioTranslationRoutes.ts`，共用语言名称和模型 JSON 解析迁至 `studioTranslationCore.ts`。原 `studio.ts` 仍在鉴权和订阅门禁之后按原顺序挂载端点；Qwen、语种/时间戳校验、有限修复和部分结果规则保持原路径。主路由从 7,627 降至 7,333 行并收紧历史预算；全仓仍有 5 个超限文件。
- 翻译核心 2/2、HTTP 空名称/批量超时/客户端断连、完整 `test:studio-workflow`、租户隔离、TypeScript、架构扫描/ratchet（2,413 个生产 TypeScript 文件）、193 项迁移清单只读检查、生产构建与 `git diff --check` 通过。Studio 主 chunk 为 480,957/485,000 字节，构建仍有大 chunk 提示。真实 Qwen、LinkedIn 付费采集、目标库迁移、浏览器验收与部署未执行。远端 SHA 与工作区状态以推送后核验为准。

## 灵感页关键词图文采集动作拆分（2026-10-23）

- 代码提交 `e8678af2` 将现有关键词图文采集的请求、记录投影和库存刷新编排迁至 `inspirationImageCrawlAction.ts`；页面仍持有筛选与弹窗状态，授权切换后旧采集响应不写入新账号视图。`InspirationDashboard.tsx` 从 2,208 降至 2,178 行并收紧历史预算；全仓仍有 5 个超限文件。
- 新动作及原页面合同 5/5、`test:video-source-boundaries` 148/148、租户隔离、TypeScript、架构扫描/ratchet（2,411 个生产 TypeScript 文件）、193 项迁移清单只读检查、生产构建与 `git diff --check` 通过。Studio 主 chunk 为 480,957/485,000 字节，构建仍有大 chunk 提示。未执行真实采集供应商、LinkedIn 付费采集测试、目标库迁移、浏览器验收或部署。远端 SHA 与工作区状态以推送后核验为准。

## Studio 对标证据准入与迁移规则拆分（2026-10-23）

- 代码提交 `dddbec98` 将规范化对标证据准入、旧逐镜时间线完整性和跨品类迁移建议迁至 `studioReferenceAdmission.ts`，保留页面公开导出与现有生成门禁；`AiCreateStudio.tsx` 从 12,086 降至 12,000 行并收紧历史预算。全仓仍有 5 个超限文件，这批并不代表架构拆分完成。
- 新模块纯规则 3/3、原 Studio 页面工作流合同、Studio 工作流集成组、租户隔离、TypeScript、架构扫描/ratchet（2,410 个生产 TypeScript 文件）、193 项迁移清单只读检查、生产构建及 `git diff --check` 通过。Studio 主 chunk 为 480,957/485,000 字节，构建仍有大 chunk 提示。未调用真实付费供应商、测试 LinkedIn 付费采集、执行目标库迁移、浏览器验收或部署。远端 SHA 与工作区状态以推送后核验为准。

## 灵感页全片精确分析 HTTP 边界拆分（2026-10-23）

- 代码提交 `f48abb19` 将精确分析提交、持久记录读取、暂停与响应解析迁至 `inspirationExactAnalysisApi.ts`；页面保留准入、状态、轮询上限与展示，旧页面解析导出兼容。`InspirationDashboard.tsx` 从 2,238 降至 2,208 行并收紧历史预算；全仓仍有 5 个超限文件，结构拆分尚未完成。
- 新模块离线模拟请求与原页面解析共 4/4、`test:video-source-boundaries` 148/148、`test:tenant-isolation`、TypeScript、架构扫描/ratchet（2,409 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建和 `git diff --check` 通过。Studio 主 chunk 为 480,909/485,000 字节，构建仍有大 chunk 提示。未测试 LinkedIn 真实付费采集、调用其他真实供应商、执行目标库迁移、浏览器验收或部署。远端 SHA 与工作区状态以推送后核验为准。

## 灵感页本地对标视频导入边界拆分（2026-10-23）

- 代码提交 `2840e649` 将 MP4 校验、现有鉴权入库、记录读回和有界分析状态轮询迁至 `inspirationReferenceImport.ts`，页面保留列表/选中状态和刷新回调。授权切换后旧请求不再读取或写回新会话；未新增供应商请求、分析重提或付费旁路。`InspirationDashboard.tsx` 从 2,296 降至 2,238 行并收紧历史预算；全仓仍有 5 个超限文件。
- 新模块模拟请求直测 3/3、`test:video-source-boundaries` 148/148、`test:tenant-isolation`、TypeScript、架构扫描/ratchet（2,408 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建与 `git diff --check` 通过。Studio 主 chunk 为 480,909/485,000 字节，构建仍有大 chunk 提示。按用户决定未测试 LinkedIn 真实付费采集；本批未上传真实 MP4、调用真实供应商、执行目标库迁移、浏览器验收或部署。远端 SHA 与工作区状态以推送后核验为准。

## 数字员工已配置工作台结构拆分（2026-10-23）

- 代码提交 `b24d0942` 将已有配置时的经营总览、周计划控制、生产入口、视图切换与相关弹窗迁至 `ConfiguredDigitalEmployeeWorkspace.tsx`；页面仍持有授权与异步请求栅栏、数据状态及现有动作，任务状态文案继续共用。`DigitalEmployeePage.tsx` 从 993 降至 686 行，新组件 386 行；页面不再需要历史超限预算，全仓超限文件由 6 个降至 5 个。
- 页面挂载合同、完整 `test:digital-employees`、`test:tenant-isolation`、TypeScript、架构扫描/ratchet（2,407 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建与 `git diff --check` 通过。Studio 主 chunk 为 480,909/485,000 字节，构建仍有大 chunk 提示。此批是源码与离线回归证据，未做登录后浏览器验收；按用户决定未测试 LinkedIn 真实付费采集，也未调用其他真实付费供应商、执行目标库迁移或部署。远端 SHA 与工作区状态以推送后核验为准。

## 数字员工周计划真实启动边界拆分（2026-10-23）

- 代码提交 `a08ff55d` 将准确版本批准、真实运行回执校验、助手状态通知、已有运行冲突和结果不明时的一次只读核对迁至 `digitalEmployeeWeeklyLaunch.ts`；页面继续负责呈现和注入原有冲突恢复，不在未知结果时重复批准。`DigitalEmployeePage.tsx` 从 1,097 降至 993 行并收紧预算；全仓仍有 6 个历史超限文件。
- 新启动模块离线直测 5/5、页面合同、完整 `test:digital-employees`、`test:tenant-isolation`、TypeScript、架构扫描/ratchet（2,406 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建和 `git diff --check` 通过。Studio 主 chunk 为 480,909/485,000 字节，构建仍有大 chunk 提示。按用户决定未测试 LinkedIn 真实付费采集；本批未执行其他真实付费请求、目标库迁移、浏览器交互或部署。远端 SHA 与工作区状态以推送后核验为准。

## 数字员工企业资料冲突恢复边界拆分（2026-10-23）

- 代码提交 `36e24c02` 将结构化 `enterprise_facts_changed` 识别、完整来源证据校验、同一授权范围内并发重建合并、专用幂等重建限次重试及换号写回栅栏迁至 `digitalEmployeeFactRecovery.ts`；页面继续注入原有状态和回执展示，不自动重放旧保存、批准或启动动作。`DigitalEmployeePage.tsx` 从 1,173 降至 1,097 行并收紧历史预算；全仓仍有 6 个超限文件。
- 新恢复模块离线直测 4/4、页面合同、完整 `test:digital-employees`、`test:tenant-isolation`、TypeScript、架构扫描/ratchet（2,405 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建与 `git diff --check` 通过。Studio 主 chunk 为 480,909/485,000 字节，构建仍有大 chunk 提示。按用户决定未测试 LinkedIn 真实付费采集；本批未执行其他真实付费请求、目标库迁移、浏览器交互或部署。远端 SHA 与工作区状态以推送后核验为准。

## 数字员工首次配置动作边界拆分（2026-10-23）

- 代码提交 `f9a02cb2` 将首次配置保存、同指纹计划续跑、任务包确认和首次准备幂等请求从 `DigitalEmployeePage.tsx` 迁至 `digitalEmployeeConfigurationAction.ts`，页面保留现有状态与冲突恢复注入；另移除未挂载目标的滚动和无调用方的旧目标提交函数。页面从 1,292 降至 1,173 行并收紧预算；全仓仍有 6 个历史超限文件，不能称为架构债务全部完成。
- 新动作离线直测 2/2（已存在准备时不重复创建；计划指纹冲突时不覆盖）、页面合同、完整 `test:digital-employees`、`test:tenant-isolation`、TypeScript、架构扫描/ratchet（2,404 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建及 `git diff --check` 通过。Studio 主 chunk 为 480,909/485,000 字节，构建仍有大 chunk 提示。按用户决定暂不测试 LinkedIn 真实付费采集；本批未执行其他真实付费请求、目标库迁移、浏览器交互或部署。远端 SHA 与工作区状态以推送后核验为准。

## 视频封面持久化边界拆分（2026-10-23）

- 代码提交 `bbd03a84` 将签名封面过期判定、限时图片读取、公开封面来源与 COS／记录文件回退迁至 `server/routes/videoThumbnailPersistence.ts`；`videos.ts` 保留租户鉴权、COS 上传校验、爬取修复和付费入口，旧公开 `recordThumbnailUrl` 导出继续转发。主路由从 7,970 降至 7,823 行并收紧预算；全仓仍有 6 个历史超限文件。
- 新模块定向测试 4/4、`test:video-source-boundaries` 145/145、完整 `test:production-workflows`、`test:tenant-isolation`、TypeScript、架构扫描/ratchet（2,403 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建与 `git diff --check` 通过。Studio 主 chunk 为 480,909/485,000 字节，构建仍有大 chunk 提示。按用户决定暂不测试 LinkedIn 真实付费采集；未执行其他真实付费请求、目标库迁移、浏览器交互或部署。远端 SHA 与工作区状态以推送后核验为准。

## 数字员工内容证据边界拆分（2026-10-23）

- 代码提交 `bbd46b4c` 将租户内容路由证据读取与产品/素材/参考分析投影迁至 `server/routes/digitalEmployeeContentEvidence.ts`；原 `digitalEmployees.ts` 保持鉴权、可信租户上下文、周计划与生产调用。聚焦产品仅改排序，不剔除其余已确认产品；共享、合成和未归属素材不充当产品素材，素材库不可用仍明确失败。主路由从 5,355 降至 5,282 行，历史预算同步收紧；全仓仍有 6 个超限文件。
- 新投影规则 2/2、跨周参考复用合同 1/1、完整 `test:digital-employees` 离线领域组、`test:tenant-isolation`、TypeScript、架构扫描/ratchet（2,402 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建和 `git diff --check` 通过。Studio 主 chunk 为 480,909/485,000 字节，构建仍有大 chunk 提示。按用户决定暂不测试 LinkedIn 真实付费采集；未执行其他真实付费请求、目标库迁移、浏览器交互或部署。远端 SHA 与工作区状态以推送后核验为准。

## 数字员工页面死控制逻辑清理（2026-10-23）

- 代码提交 `cc1d9bcf` 移除未被当前页面调用的旧任务跳转、历史面板状态、交付焦点写入、账号矩阵轨道派生以及已不使用的周日期预设；当前任务深链、内容生产跳转、返回定位和用户选择的日期范围读取仍走既有入口。页面合同的源码片段边界同步调整。`DigitalEmployeePage.tsx` 从 1,409 降至 1,292 行，架构预算同步收紧；仍有 6 个历史超限文件，未完成整体拆分。
- 页面合同、完整 `test:digital-employees` 离线领域组、`test:tenant-isolation`、TypeScript、架构扫描/ratchet（2,401 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建和 `git diff --check` 通过；最后额外删除 5 行纯死变量后，页面合同与架构扫描复检通过。Studio 主 chunk 为 480,909/485,000 字节，构建仍有大 chunk 提示。按用户决定暂不测试 LinkedIn 真实付费采集；未执行其他真实付费请求、目标库迁移、浏览器交互或部署。远端 SHA 与工作区状态以推送后核验为准。

## 数字员工页面不可达旧视图清理（2026-10-23）

- 代码提交 `f1253f49f04e202beec43ef3479bfbfad13f77ee` 删除已有配置时被更早 `return` 截断的重复工作台视图与其专属派生状态、辅助展示和导入。首次配置的引导及当前挂载的 `BusinessHealthOverview`、`SmartBusinessDashboard`、周控制台和生产详情入口保持原路径；源码合同改为断言真实挂载关系。`DigitalEmployeePage.tsx` 从 2,033 降至 1,409 行，架构预算同步收紧；全仓仍有 6 个历史超限文件，结构拆分未完成。
- 完整 `test:digital-employees` 离线领域组、`test:tenant-isolation`、TypeScript、架构扫描/ratchet（2,401 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建和 `git diff --check` 通过。Studio 主 chunk 为 480,909/485,000 字节，构建仍有大 chunk 提示。源码还保留若干未挂载的独立组件，不能当作可见功能。按用户决定暂不测试 LinkedIn 真实付费采集；未执行其他真实付费请求、目标库迁移、浏览器交互或部署。远端 SHA 与工作区状态以推送后核验为准。

## 数字员工总览只读编排边界拆分（2026-10-23）

- 代码提交 `a3bc89e3bb03e0c6d341b41f9e425663b2cdb18f` 将数字员工总览的租户限定读取、已提交周目标选择、内容队列/运行态/编导分析和发布准备的响应组装迁至 `server/routes/digitalEmployeeOverviewReader.ts`；原路由继续负责鉴权、可信租户身份、配置/目标读能力注入、状态写入与 SSE。`digitalEmployees.ts` 从 5,469 降至 5,355 行，历史预算同步收紧；全仓仍有 6 个历史超限文件。
- 完整 `test:digital-employees` 离线领域组、编导分析 5/5、路由合同、`test:tenant-isolation`、`pnpm run lint`、架构扫描/ratchet（2,401 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建及 `git diff --check` 通过。首次领域整组因目标重建源码合同仍读取旧文件而失败，迁移断言并校验原路由注入后整组复检通过。Studio 主 chunk 为 480,933/485,000 字节，构建仍有大 chunk 提示。未测试 LinkedIn 真实付费采集，也未做其他真实付费请求、目标库迁移、浏览器交互或部署。远端 SHA 与工作区状态以推送后核验为准。

## 极短视频策略抽帧零帧边界修复（2026-10-23）

- 代码提交 `07c70a87113106d64bc79ad74f27b292ed2cf7b7` 修复上批发现的短片策略抽帧零帧问题：仅当原有采样结果为空时，用本地 FFmpeg 从原片取第 0 秒首帧；若该帧仍不存在则以 `video_frame_extraction_empty` 明确失败，不把空证据交给模型。未新增供应商调用或付费自动重试。
- 2 秒与 6 秒真实本地视频取帧、密集采样及时间线规则 4/4、`test:tenant-isolation`、`pnpm run lint`、架构扫描/ratchet（2,400 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建和 `git diff --check` 通过。全仓仍有 6 个历史超限文件；Studio 主 chunk 为 480,933/485,000 字节，构建仍有大 chunk 提示。未测试 LinkedIn 真实付费采集，也未做其他真实付费请求、目标库迁移、浏览器交互或部署。远端 SHA 与工作区状态以推送后核验为准。

## 视频分析本地取帧边界拆分（2026-10-23）

- 代码提交 `e74c0e78eb7a0ee90ee6056612c6f82e6edc40ee` 将 Qwen 分析抽帧、开场动作帧及物理剪辑点检测迁至 `server/routes/videoFrameExtraction.ts`；`videos.ts` 保留原公开取帧导出、媒体持久化、模型请求、分析状态和回执。路由从 8,104 降至 7,970 行并收紧预算；全仓仍有 6 个历史超限文件，架构债务尚未完成。
- 真实 6 秒本地测试视频的取帧/时间标签/密集采样回归与时间线纯规则共 3/3、`test:tenant-isolation`、`pnpm run lint`、架构扫描/ratchet（2,400 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建和 `git diff --check` 通过。测试初版 2 秒视频显示既有策略采样可能返回空帧；本批仅做等价迁移，尚未修复这个短视频边界。Studio 主 chunk 为 480,933/485,000 字节，构建仍有大 chunk 提示。未测试 LinkedIn 真实付费采集，也未做其他真实付费请求、目标库迁移、浏览器交互或部署。远端 SHA 与工作区状态以推送后核验为准。

## 公开视频/图文只读 HTTP 端点拆分（2026-10-23）

- 代码提交 `a1fe466f3aa812fb6a526911deaed356b55fd47b` 将 `/inventory-summary` 与公开视频/图文列表响应编排迁至 `server/routes/videoListingRoutes.ts`，仍在 `videos.ts` 的鉴权之后按原顺序注册；图片账号公开互动基线迁至已有 `videoTenantListing.ts`。租户身份、队列位置及媒体签名继续由原路由提供，不增设读取或付费旁路。`videos.ts` 从 8,201 降至 8,104 行并收紧历史预算；全仓仍有 6 个历史超限文件。
- 新端点 HTTP 回归与相邻投影共 11/11、`test:tenant-isolation`、TypeScript、架构扫描/ratchet（2,399 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建及 `git diff --check` 通过。Studio 主 chunk 为 480,933/485,000 字节，构建仍有大 chunk 提示。按用户决定未测试 LinkedIn 真实付费采集；本批也未做其他真实付费请求、目标库迁移、浏览器交互或部署。远端 SHA 与工作区状态以推送后核验为准。

## 公开视频/图文租户列表只读边界拆分（2026-10-23）

- 代码提交 `c276f70788c6d15b1427a71f3a8a8ecbfd5271be` 将视频与图片公共列表、跨页搜索、测试租户可见性缓存、旧视频库存统计迁至 `server/routes/videoTenantListing.ts`；`videos.ts` 保留 HTTP 鉴权、可信租户身份、写入后缓存失效与端点编排，旧搜索函数导出继续转发。主路由从 8,404 降至 8,201 行，架构预算同步收紧；全仓仍有 6 个历史超限文件，结构治理尚未完成。
- 新模块及相邻投影直测 9/9、灵感页面合同 4/4、`test:tenant-isolation`、`pnpm run lint`、架构扫描/ratchet（2,398 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建与 `git diff --check` 通过。Studio 主 chunk 为 480,933/485,000 字节，构建仍有大 chunk 提示。遵照用户决定未测试 LinkedIn 真实付费采集；本批也未调用其他真实付费供应商、执行目标库迁移、浏览器交互或部署。远端 SHA 与工作区状态以推送后核验为准。

## 图片 AIGC 来源差异与工作树再核对（2026-10-23）

- 以集成点 `6d5fb43a77e0daff91da93f94f5ec56570d917b9` 作只读核对：原图片提交 `6e2d2e4f` 和来源 HEAD `95b0bcc1` 是集成祖先。新图片分支 `23b1bb93` 的确定性图层、蒙版、轮播/GIF 接线与证据展示已选择性覆盖，剩余自动 GPT 复核路由与当前要求保留的 Qwen→Gemini 降级冲突且未具可签发生产许可；不整笔 cherry-pick。`test:social-image-pipeline` 和图文分析/GPT 付费边界聚焦 19/19 离线测试通过，未做真实付费请求。
- 11 个注册工作树逐一检查后无新增无损归档候选：6 个非集成树有未提交项，另 4 个干净树保留独有补丁或被忽略业务/运行数据；具体见 `WORKTREE-INVENTORY.md`。未改动其他树，也未测试 LinkedIn 付费采集、执行目标库迁移或部署。此轮证明源码覆盖与安全保留理由，不证明其余工作树已清空、真实账号 AIGC 端到端或付费治理已完成。

## 租户隔离源码合同随模块迁移收口（2026-10-23）

- 代码提交 `e05228ab3ababb1bd7113334e57c7f3ea200cc92` 将 `test:tenant-isolation` 中仍扫描旧文件位置的断言对齐到实际模块，并同时检查路由/页面挂载：企业 AI 授权、资产对象键和本地回退、助手引导与关闭、企业表单、WhatsApp 入站、Studio 素材签名与项目读写仍被同一安全合同覆盖。未改变业务栅栏或真实外部行为；上一批记录的该测试失败现已消除。
- `test:tenant-isolation`、完整 `test:assistant`、`test:enterprise-profile-lifecycle`、`pnpm run lint`、架构扫描/ratchet、193 项迁移仓库只读检查、生产构建与 `git diff --check` 通过。Studio 主 chunk 为 480,933/485,000 字节，仍有大 chunk 提示；历史超限文件仍有 6 个。未调用真实供应商、执行目标库迁移、登录后浏览器验收或部署；远端 SHA 与工作区状态待推送后核验。

## Studio 素材响应与企业产品投影拆分（2026-10-23）

- 代码提交 `bf831569ed426855fc3462313941cf58e84bc2b2` 将已读取素材的租户签名播放地址、私有对象键清除、能力清单及企业产品表素材身份投影迁至 `server/routes/studioMaterialProjection.ts`；租户读取、鉴权和持久化仍在 `studio.ts`。`studio.ts` 从 7,789 降至 7,627 行并收紧历史预算；全仓仍有 6 个历史超限文件。
- 新模块离线直测 2/2、`test:material-import`、`test:studio-media`、`test:studio-workflow`、Studio 媒体访问检查、`pnpm run lint`、架构扫描/ratchet、193 项迁移仓库只读检查、生产构建及 `git diff --check` 通过；Studio 主 chunk 为 480,933/485,000 字节，仍有大 chunk 提示。扩展运行的 `test:tenant-isolation` 未通过：既有源码断言仍在 `enterprise.ts` 查找已迁往 `enterpriseKnowledge.ts` 的授权判断，继续修正后又发现资产路由和助手展示的旧文件位置断言；该组不可计入本批通过数，需单独审计全部合同。未调用真实供应商、执行目标库迁移、浏览器验收或部署；远端 SHA 与工作区状态待推送后核验。

## Studio 自动化配音计划与合成边界拆分（2026-10-23）

- 代码提交 `cf766af5b9ac36a141c5ff57b91226ce61c7b89d` 将数字员工自动化使用的冻结语音计划、配音合成、音频质检与租户文件证明迁至 `server/routes/studioVoiceAutomation.ts`；原公开导出保持，私有音频对齐及收据校验仍在 `studio.ts`。三段无调用方的旧口播自动改写/拟合函数已移除。`studio.ts` 从 8,026 降至 7,789 行并收紧历史预算；全仓仍有 6 个历史超限文件，结构治理尚未收口。
- 新模块离线直测 1/1、完整 `test:studio-media`、语音付费门禁专项 10/10、`pnpm run lint`、架构扫描/ratchet（2,396 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过。Studio 主 chunk 为 480,933/485,000 字节，构建仍有大 chunk 提示。按用户决定未测试 LinkedIn 付费采集；本批未调用真实供应商、执行目标库迁移、登录后浏览器验收或部署。远端 SHA 与工作区状态待推送后核验。

## Studio 语音生成及缓存证明边界拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `3613a89af267d57c003acd660320c570c349267a` 将原生语音提供方选择、本地回退、音频缓存/原任务回执证明、比例字幕和能力投影迁至 `server/routes/studioTtsGeneration.ts`；Studio 路由仍负责冻结语音计划、调用时机、请求和质检。`studio.ts` 从 8,244 降至 8,026 行并收紧历史预算；全仓仍有 6 个历史超限文件。
- 新模块离线直测 1/1、语音付费路径定向测试 6/6、完整 Studio 媒体回归、`pnpm run lint`、相对上一 HEAD 的架构扫描/ratchet（2,395 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build` 和 `git diff --check` 通过。Studio 主 chunk 为 480,933/485,000 字节，仍有大 chunk 提示。未调用真实付费供应商、执行目标库迁移、浏览器验收或部署；远端 SHA 与工作区状态待推送后核验。

## Studio 语音供应商适配边界拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `691f6271a66717639e9a9cff2ee3b952d2fcfd60` 将 Qwen/MiniMax 语音供应商实现、克隆音色缓存、凭据隔离及脚本可朗读文本提取迁至 `server/routes/studioTtsProviderRuntime.ts`，由 `studio.ts` 注入原租户目录、URL 和 FFmpeg 能力。保留原 `submitStudioVoicePaidRequest` 入口、冻结许可和供应商回执路径；`studio.ts` 从 8,692 降至 8,244 行，历史预算同步收紧。全仓仍有 6 个历史超限文件。
- 新适配器离线直测 2/2（含无许可零网络请求）、语音付费门禁专项 10/10、完整 Studio 媒体回归、`pnpm run lint`、相对上一 HEAD 的架构扫描/ratchet（2,394 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过。Studio 主 chunk 为 480,933/485,000 字节，仍有大 chunk 提示。原图片 AIGC 来源提交仍为集成祖先；新图片独有补丁的剩余自动 GPT 降级与当前要求保留的 Qwen→Gemini 行为冲突，未整笔合入。本轮未调用真实付费供应商、执行目标库迁移、浏览器验收或部署；远端 SHA 与工作区状态待推送后核验。

## Studio 草稿保存写入边界拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `91d9a1b48720292da0e388b462b7b1b44a09ec17` 将草稿新建、更新和版本 CAS 路由迁至 `server/routes/studioProjectSaveRoutes.ts`，仍在 Studio 鉴权和租户上下文后挂载。原有生产合同、冻结计划、素材候选、知识库图片版本、生成真实性、托管项目只读、海报素材使用及发布审批失效门禁保留；`studio.ts` 从 8,856 降至 8,692 行并收紧历史预算。全仓仍有 6 个历史超限文件，不能把此次拆分称为架构债务全部清零。
- 新模块 HTTP 直测 1/1 覆盖冲突合同、服务端冻结计划所有权、过期修订、CAS 竞争及新建成功；完整 `test:studio-workflow`、`pnpm run lint`、相对上一 HEAD 的架构扫描/ratchet（2,393 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 均通过。Studio 主 chunk 为 480,933/485,000 字节，仍有大 chunk 提示。未执行真实供应商调用、目标库迁移、浏览器验收或部署；LinkedIn 真实付费采集按用户决定暂不测试。远端 SHA 与工作区状态待推送后核验。

## Studio 项目审阅写入边界拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `21de742e095ed57ea10089512c6490cc243039cf` 将重新质检、人工交接创建和删除迁至 `server/routes/studioProjectReviewRoutes.ts`，在原 Studio 鉴权和租户上下文后挂载；草稿保存仍留在 `studio.ts`。保持任务归属、质检输入指纹与版本 CAS、人工验收、可信生产快照只读等原有门禁。`studio.ts` 从 8,960 降至 8,856 行，历史预算同步收紧；全仓仍有 6 个历史超限文件，结构治理尚未完成。
- 新模块 HTTP 直测 1/1、人工交接合同、完整 `test:studio-workflow`、`pnpm run lint`、架构扫描/ratchet（2,392 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build`、`git diff --check` 通过。Studio 主 chunk 为 480,933/485,000 字节，仍有大 chunk 提示。未执行真实供应商调用、目标库迁移、浏览器验收或部署；LinkedIn 真实付费采集按用户决定暂不测试。远端 SHA 与工作区状态待推送后核验。

## Studio 项目只读边界拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `b0ebf95a` 将草稿列表、单项目读取、分镜依据检查和人工交接列表迁至 `server/routes/studioProjectReadRoutes.ts`；仍在 Studio 鉴权与租户上下文后挂载，保存、质检签发、交接创建及删除保持原路径。`studio.ts` 从 9,033 降至 8,960 行，历史预算同步收紧；全仓仍有 6 个历史超限文件。
- 新模块本地 HTTP 直测 1/1 覆盖租户/任务归属、私有素材 URL 重新签名、分镜缺口及缓存边界；`test:studio-workflow`、`test:studio-media`、`pnpm run lint`、架构扫描/ratchet（2,391 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 均通过。Studio 主 chunk 为 480,933/485,000 字节，仍有大 chunk 提示；未进行真实供应商调用、目标库迁移、登录后浏览器交互或部署。LinkedIn 真实付费采集按用户决定暂不测试；远端 SHA 与工作区状态以推送后核验为准。

## Studio BGM HTTP 边界拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `0ec205bd` 将 BGM 媒体流、列表、上传和删除处理迁至 `server/routes/studioBgmRoutes.ts`，仍在 `studio.ts` 的鉴权与租户上下文之后挂载，不改变既有 `/bgm` 路径。主路由从 9,130 降至 9,033 行，架构预算同步收紧；全仓仍有 6 个历史超限文件。
- 新路由路径直测 1/1、`studioMediaAccess` 鉴权挂载及同源媒体流合同、生成真实性定向测试、Studio 媒体与工作流整组、`pnpm run lint`、架构扫描/ratchet（2,390 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 均通过。架构扫描首轮提示预算高于实际行数 1 行，精确收紧后复检通过。Studio 主 chunk 为 480,933/485,000 字节，仍有大 chunk 提示；未执行真实供应商调用、目标库迁移、登录后浏览器交互或部署。LinkedIn 真实付费采集按用户决定暂不测试；远端 SHA 与工作区状态以推送后核验为准。

## Studio 租户配乐曲库边界拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `7ffe958a` 将 BGM 官方曲目、上传索引、租户可见性、推荐排序、自动化音频读取和签名有效期迁至 `server/routes/studioBgmCatalog.ts`；Studio HTTP 鉴权、媒体流、上传与删除仍留在原路由。数字员工与兼容适配层改为直接引用曲库。`studio.ts` 从 9,296 降至 9,130 行，架构预算同步收紧；全仓仍有 6 个历史超限文件。
- 新曲库直测 3/3、`studioMediaAccess`、生成真实性定向测试、Studio 媒体/工作流整组、产品生产路由及数字员工内容生产测试、`pnpm run lint`、架构扫描/ratchet（2,389 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 均通过。Studio 主 chunk 为 480,933/485,000 字节，仍有大 chunk 提示；未做真实供应商调用、目标库迁移、登录后浏览器交互或部署。LinkedIn 真实付费采集按用户决定暂不测试；远端 SHA 和工作区状态以推送后复核为准。

## 数字员工首页公开投影边界拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `ec37bae7ca385d6e7d972fa8e55c196b963ddb1b` 将配置、周目标、计划、四专家状态及事件脱敏投影迁至 `server/digitalEmployees/overviewProjection.ts`；`digitalEmployees.ts` 仍负责租户范围内的读取、鉴权、写入及 SSE 发送。路由从 5,558 降至 5,469 行，架构预算同步收紧；全仓仍有 6 个历史超限文件，结构治理未完成。
- 新模块直测 5/5、数字员工整组、`pnpm run lint`、架构扫描/ratchet（2,388 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过。初次 TypeScript 检查发现新增测试夹具的类型断言不完整，修正后复检通过。Studio 主 chunk 为 480,933/485,000 字节，仍有大 chunk 提示。LinkedIn 仅保留既有离线门禁，按用户要求暂不测试真实付费采集；本批未调用其他真实供应商、执行目标库迁移、浏览器交互或部署。远端 SHA 和工作区状态以推送后核验为准。

## 公开视频搜索传输边界拆分（2026-10-23）

- 代码提交 `bed4be89` 将 YouTube Shorts 平面检索失败后的 HTML 回退、Bing 公开视频 URL 提取和限时 HTTP 文本读取迁至 `videoCrawlerPublicDiscovery.ts`；路由仍负责现有 yt-dlp 执行、租户范围、下载、付费准入及持久化。只被旧源码断言提及、无生产调用的 YouTube 日期过滤辅助函数已移除。`videos.ts` 从 8,514 降至 8,404 行，历史预算同步收紧；全仓仍有 6 个历史超限文件。
- 新模块直测 4/4、原回退合同脚本、`test:video-source-boundaries` 141/141、相关视频路由回归 4/4、`pnpm run lint`、架构扫描/ratchet（2,387 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建及 `git diff --check` 均通过。Studio 主 chunk 为 480,933/485,000 字节，仍有大 chunk 提示。LinkedIn 仅覆盖离线门禁测试，按用户要求未进行真实付费采集或许可签发验收；本批也未调用其他真实供应商、执行目标库迁移、浏览器交互或部署。远端 SHA 与工作区状态以推送后核验为准。

## 爬虫运维失败与代理规则拆分（2026-10-23）

- 代码提交 `dfc13e57` 将视频爬虫的重试退避和失败分类移入 `videoCrawlerOpsTaskState.ts`，代理轮换和日志凭据脱敏移入 `videoCrawlerRuntimeConfig.ts`；实际下载、失败持久化、租户范围和供应商调用仍由 `videos.ts` 控制。路由从 8,549 降至 8,514 行，历史预算同步收紧；全仓仍有 6 个历史超限文件。
- 定向运行配置与恢复测试 3/3、`test:production-workflows`、`test:video-source-boundaries` 137/137、`pnpm run lint`、架构扫描/ratchet（2,386 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建及 `git diff --check` 均通过。Studio 主 chunk 为 480,933/485,000 字节，仍有大 chunk 提示。LinkedIn 测试仅为离线门禁桩，按用户要求未进行真实付费采集或许可签发验收；本批也未执行其他真实供应商调用、目标库迁移、浏览器交互或部署。远端 SHA 与工作区状态以推送后核验为准。

## 视频管线统计投影拆分（2026-10-23）

- 代码提交 `00596d3e` 将抓取、下载、分析、精修队列的只读统计组装迁至 `videoPipelineStatsProjection.ts`；`videos.ts` 继续持有租户限定分页读取、测试租户可见性、爬虫运维快照和供应商配置读取。路由从 8,690 降至 8,549 行，历史预算同步收紧；全仓仍有 6 个历史超限文件。
- 新投影直测 3/3 并纳入 `test:video-source-boundaries`（137/137）；相关视频路由回归 5/5、`pnpm run lint`、架构扫描/ratchet（2,386 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建及 `git diff --check` 均通过。Studio 主 chunk 为 480,933/485,000 字节，构建仍有大 chunk 提示。按用户决定，本批没有真实 LinkedIn 付费采集或许可签发验收；也未调用其他真实供应商、执行目标库迁移、浏览器交互或部署。远端 SHA 与工作区状态以推送后核验为准。

## 公开视频检索结果投影拆分（2026-10-23）

- 代码提交 `bd291e3a` 将公开检索日期过滤、查询 URL、候选元数据、缩略图、去重及失败类别等纯规则迁至 `videoCrawlerPublicProjection.ts`；`videos.ts` 继续负责实际网络请求、付费准入、租户范围、队列及持久化，旧公开导出继续转发。路由从 8,815 降至 8,690 行，历史预算同步收紧；全仓仍有 6 个历史超限文件，整体结构拆分尚未完成。
- 新投影直测 7/7，`test:video-source-boundaries` 134/134，相关视频路由回归 7/7，`pnpm run lint`、架构扫描/ratchet（2,385 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建及 `git diff --check` 均通过。Studio 主 chunk 为 480,933/485,000 字节；仍有大 chunk 提示。来源整组包含 LinkedIn 的离线许可测试，但遵照用户要求未进行真实付费采集或许可签发验收；也未调用真实供应商、执行目标库迁移、浏览器交互或部署。远端 SHA 与工作区状态以推送后核验为准。

## Studio 主 chunk 分组与预算收紧（2026-10-23）

- 代码提交 `484d92d2bbddd7b470c0837f9883c6d44ea72ef6` 将 Studio 已静态依赖的纯规则及小型展示支撑模块纳入现有 `studio-support` 构建分组，保持模块执行顺序，不改工作台 UI、供应商请求或运行时功能边界。`AiCreateStudio` 主 chunk 从 496,205 降至 480,933 字节（减少 15,272），构建门禁从 500,000 收紧至 485,000 字节；支撑 chunk 约 81 KiB，不能把主 chunk 下降解释为总传输量等量下降。全仓仍有 6 个历史超限文件。
- `test:studio-media`、`test:studio-script`、`test:studio-workflow`、`pnpm run lint`、架构扫描/ratchet（2,384 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建和 `git diff --check` 均通过。构建分组产物中的 Studio 主 chunk 引用了新的 `studio-support` chunk；未做登录后浏览器交互、真实供应商调用、付费采集、目标库迁移或部署。远端 SHA 与工作区状态以推送后核验为准。

## Studio 原片素材身份与语言规则边界拆分（2026-10-23）

- 代码提交 `5462818251f0ca9bc522e62431aa99d70a5d869b` 将原片身份比对、企业素材准入、历史素材快照和素材片段类型迁至 `studioSourceMaterial.ts`，将语种目录、脚本/口播语种判定与时间码归一化迁至 `studioLanguageRules.ts`。工作台保留项目、素材与请求编排，旧公开导出继续转发；原片和仅供分析素材仍不可进入企业成片素材池。`AiCreateStudio.tsx` 从 12,355 降至 12,086 行，历史预算同步收紧；全仓仍有 6 个历史超限文件。
- 新增短期签名变化、跨来源误复用、历史快照准入、语言与时间码断言；`test:studio-media`、`test:studio-script`（现纳入翻译持久化回归）、`test:studio-workflow`、`pnpm run lint`、架构扫描/ratchet（2,384 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建及 `git diff --check` 通过。Studio chunk 为 496,205/500,000 字节，比上批 496,106 字节略高；静态规则拆分不等于构建 chunk 已优化，仍需独立处理。未调用真实供应商、执行付费采集、目标库迁移、浏览器交互或部署；远端 SHA 与工作区状态须在推送后单独核验。

## 灵感素材列表投影边界拆分（2026-10-23）

- 代码提交 `77bd4d35160fc67ab8e4f2dc6875f4f96a09770b` 将“我的素材”的完整过滤、用户上传优先排序、产品集合可见性、镜头功能选项和普通素材分页迁至 `inspirationMaterialGalleryProjection.ts`。页面保留请求、筛选状态、详情和动作，产品集合只在第一页展示。`InspirationDashboard.tsx` 从 2,342 降至 2,296 行，历史预算同步收紧；全仓仍有 6 个历史超限文件，不能称整体拆分完成。
- 新投影直测 3/3，页面/产品合同聚焦 10/10、`test:material-import` 18/18、`test:video-source-boundaries` 131/131、`test:social-content-frontend`、`pnpm run lint`、架构扫描/ratchet（2,382 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建及 `git diff --check` 均通过。视频来源整组包含既有 LinkedIn 离线许可测试，但按用户决定未执行真实付费采集或许可签发验收。`AiCreateStudio` chunk 为 496,106/500,000 字节，仍有大 chunk 提示；未调用真实供应商、执行目标库迁移、浏览器交互或部署。本地/远端 SHA 与工作区状态以推送后核验为准。

## 灵感原对标只读解析边界拆分（2026-10-23）

- 代码提交 `bbc4ed583109986ac074d745df1bd0a87299688c` 将周计划原对标的已加载列表匹配、冻结记录 ID 读取、标题搜索及快照回退迁至 `inspirationReferenceResolver.ts`；页面继续负责导航和选中状态，不增加付费、写入或重复请求。`InspirationDashboard.tsx` 从 2,389 降至 2,342 行，历史预算同步收紧；全仓仍有 6 个历史超限文件，结构拆分没有完成。
- 新解析规则及页面合同聚焦 8/8、`test:social-content-frontend`、`test:digital-employees`、`pnpm run lint`、架构扫描/ratchet（2,381 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建和 `git diff --check` 通过。`AiCreateStudio` chunk 为 496,106/500,000 字节，仍有大 chunk 提示。按用户决定，LinkedIn 付费采集暂不测试；本批未调用真实供应商、执行目标库迁移、部署或登录后浏览器验收。远端 SHA 与工作区状态须在推送后单独核验。

## 灵感素材详情与创作准入边界拆分（2026-10-23）

- 代码提交 `02e66b216709a6f3f628cb54101cacbabfb8b2b6` 将素材标签、媒体预览、编导识别、主题选择和完整使用记录抽入 `InspirationMaterialDetailDrawer.tsx`；灵感页继续持有素材读取、主题保存及进入创作回调。卡片与详情统一使用 `canCreateFromLibraryMaterial`，音频、未知时长视频或无可用来源不得进入视觉创作。`InspirationDashboard.tsx` 从 2,423 降至 2,389 行，架构预算同步收紧；全仓仍有 6 个历史超限文件。
- 素材归属合同中三项旧文件位置断言改查当前实际媒体组件与服务端素材列表投影，没有放宽音频占位、内部素材排除或可持久化收藏约束。聚焦直测/合同 8/8、完整 `test:social-content-frontend`、产品导入 35/35、`pnpm run lint`、架构扫描/ratchet（2,380 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建及 `git diff --check` 通过。`AiCreateStudio` chunk 为 496,106/500,000 字节，仍有大 chunk 提示。按用户决定，本批不测 LinkedIn 付费采集；未调用真实供应商、执行目标库迁移、部署或登录后浏览器验收。远端 SHA 与工作区状态须在推送后单独核验。

## 周任务启动证据与冲突展示边界拆分（2026-10-23）

- 代码提交 `bc4d37216184c5584ce1b9c9b1f0e46bddf76ed8` 将已存在的另一轮任务冲突解析、真实运行回执核验、未知结果只读核对判定迁入 `weeklyStartValidation.ts`，冲突提示迁入 `WeeklyStartConflictAlert.tsx`。页面仍只执行一次带精确计划版本的 `approveGoal`，未知结果只读核对一次，不新增启动或付费请求。`DigitalEmployeePage.tsx` 从 2,101 降至 2,033 行，历史预算同步收紧；全仓仍有 6 个历史超限文件。
- 新边界直测 3/3、数字员工页面合同、完整 `test:digital-employees`、`pnpm run lint`、架构扫描/ratchet（2,379 个生产 TypeScript 文件）、193 项迁移仓库只读检查、生产构建及 `git diff --check` 通过；`AiCreateStudio` chunk 为 496,106/500,000 字节，仍有大 chunk 提示。用户要求 LinkedIn 付费采集暂不测试，目标账号费率及共享存储没有验收，本批也没有真实供应商调用、目标库迁移、部署或登录后浏览器交互。分支、远端 SHA 和工作区状态以推送后复核为准。

## 数字员工采集失败诊断与旧源码契约收口（2026-10-23）

- 代码提交 `95bca7a6f313138849ccf7d74808130e91d72734` 在数字员工执行任务现场为失败或等待处理的素材采集显示分类诊断、下一步建议及完整原始阻塞原因；诊断仅呈现现有持久化事实，不触发重试或付费调用。监控页、周计划确认卡的旧源码契约分别改查实际的按需加载模块/页面槽与周目标面板，保留原动态导入、版本化启动 API 和单一路径要求。
- 新提示组件的行为直测 3/3，原 3 条失败合同及扩大扫描 20/20、完整 `test:digital-employees`、TypeScript、架构扫描/ratchet、193 项迁移仓库只读检查、生产构建和 `git diff --check` 通过。`DigitalEmployeePage.tsx` 为 2,101 行，预算同步从 2,103 收紧；历史超限文件仍有 6 个。`AiCreateStudio` chunk 为 496,106/500,000 字节，构建仍有大 chunk 提示。未做登录后的浏览器交互、真实供应商调用、目标库迁移或部署；分支与远端 SHA、工作区状态须在推送后单独核验。

## 数字员工首次引导状态与保存边界拆分（2026-10-23）

- 代码提交 `8b887bb001c57cfb92ecbf780b5612051958f783` 将首次引导及运行规则的本地状态、企业与产品资料读取/保存、阶段确认、出镜策略和推荐计划接线整体迁至 `DigitalEmployeeOnboardingPanel.tsx`（752 行）；`DigitalEmployeePage.tsx` 保留页面导航、周目标与执行状态，通过原 `onSave`/就绪跳转回调挂载引导。主页面从 2,883 降至 2,103 行，历史预算同步收紧；仍有 6 个历史超限文件，不能视为整体拆分完成。
- `test:digital-employees` 整组、引导重置、发布账号安全与周目标面板定向契约、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,376 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 和 `git diff --check` 通过。`AiCreateStudio` chunk 为 496,106/500,000 字节，仍有大 chunk 提示。额外扫描的 3 条旧源码契约（监控页动态导入、旧周计划确认接线、旧采集诊断展示）失败；所查目标在改动前 `HEAD` 也不存在，本批未以改写无关业务来凑绿。未做真实浏览器交互、付费供应商调用、目标库迁移或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## 数字员工首次引导展示边界拆分（2026-10-23）

- 代码提交 `17fb32dee5b30290a1f29f51f37f6304b35f1596` 将企业与品牌、产品表、经营阶段、出镜方式四步展示和共用弹窗框架迁至 `DigitalEmployeeOnboardingSteps.tsx`；页面仍持有企业资料与产品导入、阶段保存、推荐计划和数字人授权判断。`DigitalEmployeePage.tsx` 从 3,101 降至 2,883 行，预算同步收紧；全仓仍有 6 个历史超限文件。
- 页面源码契约改查新展示边界及原页面回调接线；同时修正上一批助手决策读取迁出后周目标重建契约仍只扫描旧路由文件的问题。`test:digital-employees` 整组、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,375 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 496,106/500,000 字节。弹窗使用客户端 Portal，未把空白的服务端静态渲染当成 UI 验收；未做真实浏览器交互、付费供应商调用、目标库迁移或部署。本地/远端 SHA 与工作区状态以推送后核对为准。

## Facebook 图文采集投影拆分（2026-10-23）

- 代码提交 `029927c6979c1f83e0d0fc92613aaac6887b094b` 将 Facebook 帖子图片/视频识别、图片证据和公开指标投影迁至既有 `videoCrawlerImageProjection.ts`，采集入口与供应商调用顺序未动。`videos.ts` 从 8,878 降至 8,815 行，预算同步收紧；全仓仍有 6 个历史超限文件。
- 新 Facebook 投影直测 2/2，图文来源边界整组 131/131、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,374 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 仍为 496,106/500,000 字节。未做真实供应商调用、目标库迁移、浏览器验收或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## 数字员工助手待决事项读取组装拆分（2026-10-23）

- 代码提交 `cadaa7bc3c3b0a6439a6df79bb5b9ec83003a34d` 将租户范围内的周目标、计划、运行、任务、审批及 Starter 决策卡组装迁至 `assistantDecisionFeedService.ts`；原有独立内容任务恢复仍在相同读取时机执行，操作写入与响应回执仍留在路由。`digitalEmployees.ts` 从 5,645 降至 5,558 行，架构预算同步收紧；全仓仍有 6 个历史超限文件，结构拆分尚未完成。
- 决策中心路由契约随文件边界调整，业务整组 69/69、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,374 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 和 `git diff --check` 通过。`AiCreateStudio` chunk 为 496,106/500,000 字节，仍有大 chunk 提示。未做真实付费调用、目标库迁移、浏览器验收或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## Studio 原片口播与时间线规则拆分（2026-10-23）

- 代码提交 `a4b3c0b4d90c0640df9125a3abad4116fbaba43f` 将按原片切点和 ASR 构造/人工编辑复刻口播的规则迁至 `studioReferenceSpeechPlan.ts`，将配音 cue、分镜与数字人成片时长拟合迁至 `studioTimelineFitting.ts`，参考视频与槽位类型独立放置；`AiCreateStudio.tsx` 保留请求和页面状态并转发旧公开导出。该文件从 12,609 降至 12,355 行，预算同步收紧；全仓仍有 6 个历史超限文件。
- 原参考口播/分镜媒体回归与工作流合同直测 2/2、`test:studio-media`、`test:studio-workflow`、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,373 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 和 `git diff --check` 通过。首轮类型检查发现迁移类型文件的相对路径错误，修正并复检通过；`AiCreateStudio` chunk 为 496,106/500,000 字节，仍有大 chunk 提示。未做真实供应商调用、浏览器验收、目标库迁移或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## Studio 字幕 cue 时间轴规则拆分（2026-10-23）

- 代码提交 `ac5282179d38e32a977b78bb3ab5f268dbfe6967` 将句子切分、已确认口播时间范围、字幕 cue 生成/归一化、SRT/VTT 文本和渲染边界迁至 `studioSubtitleCues.ts`；页面仍持有字幕使用时机、语言版本及现有导出流程，旧 `confirmedNarrationForTimeRange` 导出继续转发。`AiCreateStudio.tsx` 从 12,793 降至 12,609 行，历史预算同步收紧；全仓仍有 6 个超限文件。
- 新字幕直测 4/4 并纳入 `test:studio-media`，原人物/口播持久化直测 1/1、Studio 媒体和工作流整组、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,370 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 496,056/500,000 字节，仍有大 chunk 提示。原图片 AIGC 来源分支已在集成祖先中；新图片分支独有提交 `23b1bb93` 的图层改进已选择性合入，剩余自动 GPT 降级与需暂留的 Qwen→Gemini 行为和逐记录付费门禁冲突，本次未整笔合并。未执行真实付费调用、目标库迁移、浏览器验收或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## 灵感结果展示边界拆分（2026-10-23）

- 代码提交 `a8d1230230c6b152e7461094b8b18a3117dd95ef` 将实际挂载的灵感加载/空态、瀑布流卡片、列表与服务端分页迁至 `InspirationVideoResults.tsx`；页面仍持有数据读取、筛选和动作回调，图文证据不完整时的创作禁用规则仍共用原投影。`InspirationDashboard.tsx` 从 2,450 降至 2,423 行，预算同步收紧；全仓仍有 6 个历史超限文件，未完成整体架构拆分。
- 新展示组件服务端渲染直测 2/2、`test:video-source-boundaries` 129/129、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,369 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 496,002/500,000 字节。首轮类型检查发现素材库仍需 `Pagination` 导入，补回并复检通过。未进行浏览器交互、真实采集/付费供应商调用、目标库迁移或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## 关键词采集弹窗展示边界拆分（2026-10-23）

- 代码提交 `0cd6aafaa8bd8b576c86956eb1166395c2108930` 将实际挂载的关键词补充采集弹窗迁至 `InspirationImageCrawlDialog.tsx`；页面保留采集请求、平台/关键词/数量状态及错误清理，原 Ant Design 表单与忙碌态未改。`InspirationDashboard.tsx` 从 2,474 降至 2,450 行，历史预算同步收紧；全仓仍有 6 个超限文件，并非整体架构拆分完成。
- 弹窗合同直测 2/2、`test:video-source-boundaries` 129/129、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,368 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 和 `git diff --check` 通过；`AiCreateStudio` chunk 仍为 496,002/500,000 字节。没有执行真实采集、付费供应商调用、浏览器验收、目标库迁移或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## GPT 图片证据报价与人工批准拆分（2026-10-23）

- 代码提交 `d756a186a62ffa48e3b73167a144cb655a06d971` 为逐记录 GPT 图片复核增加只读报价，批准前必须重算并匹配租户、记录来源、实际图片字节、精确请求、模型/账号、用量上界及费率证据的报价指纹；预算仍受人工人民币上限约束。报价不写批准，批准不是付费发送许可。未改变现有 Qwen→Gemini 降级，也未接通 GPT HTTP/worker 入口。
- 报价/批准直测 7/7，覆盖价格、来源 URL、图片字节变化及超预算拒绝；`test:video-source-boundaries` 129/129、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,367 个生产 TypeScript 文件，仍有 6 个历史超限文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 和 `git diff --check` 通过；`AiCreateStudio` chunk 为 496,002/500,000 字节。目标账号费率/可信多模态上界、跨实例共享卷和付费回执实际联调仍未验证；未调用真实付费供应商、未做目标库迁移或部署。最终本地/远端 SHA 及工作区状态以推送后核对为准。

## 视频可见性与分析终态规则拆分（2026-10-23）

- 代码提交 `5ec2b97a463a874cdefb09c0e4181f7b898485d6` 将公开视频/图文来源资格、完成/暂停可见性与内容类型投影迁至 `videoRecordVisibility.ts`，将完整 Gemini 分析后的成功终态补丁迁至 `videoAnalysisSuccessPatch.ts`；`videos.ts` 仍负责租户读取、写入与执行编排，从 9,012 降至 8,878 行，预算同步收紧。原 `isDisplayableTestTenantVideo` 导出继续转发，未改变现有 AIGC 或付费调用。全仓仍有 6 个历史超限文件。
- 新规则直测 4/4、原暂停可见性回归、`test:video-source-boundaries` 126/126、`test:production-workflows`、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,367 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 496,002/500,000 字节。未做真实爬取/付费供应商调用、浏览器交互、目标库迁移或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## 公开视频投影与证据脱敏拆分（2026-10-23）

- 代码提交 `dfee5e43d922a7a60cb42f41cec995d03f66a42d` 将公开视频响应投影、持久队列编号及关键词匹配迁至 `videoPublicRecordProjection.ts`，`videos.ts` 保留租户数据读取与 HTTP 编排，从 9,111 降至 9,012 行，预算同步收紧；全仓仍有 6 个历史超限文件。直测发现原有脱敏仅解析 JSON 字符串，逐镜证据以对象存储时私有 `clipObjectKey`/`firstFrameObjectKey` 会漏出；新投影对两种形态均清除这些键，保留公开进度和其他证据字段。
- 新投影直测 3/3 并纳入 `test:video-source-boundaries`（122/122）；`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,365 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 496,002/500,000 字节。未做真实爬取/付费供应商调用、浏览器交互、目标库迁移或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## Studio 渲染清单投影拆分（2026-10-23）

- 代码提交 `a364daca6c503984e7097ecae90bdb012a247bff` 将渲染合同类型、素材 URL/字幕/特效/强调计划的纯清单投影迁至 `studioRenderManifestProjection.ts`。路由仍在租户范围内读取素材和配乐，并保留清单安全校验、签名令牌及 HTTP 编排。`studio.ts` 从 9,412 降至 9,296 行，预算同步收紧；全仓仍有 6 个历史超限文件。
- 新投影直测 2/2，强调计划合同、渲染安全和媒体访问检查、`test:studio-workflow`、`test:studio-media`、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,364 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 496,002/500,000 字节。未做浏览器交互、真实供应商调用、目标库迁移或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## Studio 参考时间线完整性规则拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `27b8c281` 将参考逐镜文本及结构化镜头时间线的纯完整性检查迁至 `studioReferenceTimelineQuality.ts`；仅识别行首物理镜头范围，维持片头、空档、重叠和缺少真实片段的原拒绝规则。`studio.ts` 保留生成流程及响应编排，从 9,458 降至 9,412 行，预算同步收紧；全仓仍有 6 个历史超限文件。
- 新规则直测 3/3、`test:studio-script` 整组、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,363 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 和 `git diff --check` 通过；`AiCreateStudio` chunk 为 496,002/500,000 字节。未做浏览器交互、真实供应商调用、目标库迁移或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## Studio 素材库列表投影拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `354e0e39af324432e13fbf61ee34e32cc1d77020` 将素材库产品归属、普通/内部素材可见性、生成素材过滤、facets、排序及分页迁至纯投影 `studioMaterialLibraryProjection.ts`。`studio.ts` 仍负责租户读取、签名 URL、使用证据与 HTTP 响应，从 9,502 降至 9,458 行，架构预算同步收紧；全仓仍有 6 个历史超限文件。
- 新投影直测 4/4，覆盖产品隔离、内部素材恢复、非法筛选、同 ID 库存覆盖及 facets 计算；`test:material-import` 15/15、`test:studio-media` 整组、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,362 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过。`AiCreateStudio` chunk 为 496,002/500,000 字节。未做浏览器交互、真实供应商调用、目标库迁移或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## Studio 已有草稿弹窗与旧预览清理（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `cf6eaad6c0f688ed85bf3007e699e85977ef250e` 将实际挂载的同源草稿选择弹窗迁至按需加载的 `ExistingSourceDraftDialog.tsx`，页面仍持有草稿恢复和新建清理动作；删除未挂载的 `ProductInfoPreview` 与仅供它使用的行投影。`AiCreateStudio.tsx` 从 12,896 降至 12,793 行，预算同步收紧；主 chunk 从 497,209 降至 496,002/500,000 字节，全仓仍有 6 个历史超限文件。
- 新弹窗内容直测 1/1、`test:studio-media` 整组、分镜 AIGC 66/66、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,361 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过。Studio 媒体测试初跑发现一条旧断言仍从 `GlobalAssistant.tsx` 查一次性提示；核对已拆出的通知监听与提示气泡模块后修正测试目标，整组复跑通过。未做浏览器交互、真实供应商调用、目标库迁移或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## 数字员工引导产品导入拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `27eba5a8e51c8adb65eece8d0198bf0258221efb` 将产品文件格式/大小校验、文档解析、图片证据上传、稳定产品 ID 合并及现有鉴权企业档案写入迁至 `onboardingProductImport.ts`；页面保留文件选择、忙碌态与错误/成功反馈。未归属文档图片仍只保存在企业素材库，不凭位置自动绑定产品。`DigitalEmployeePage.tsx` 从 3,181 降至 3,101 行，预算同步收紧；全仓仍有 6 个历史超限文件。
- 新模块直测 3/3，含无效文件前置拒绝、稳定 ID 和 TXT 鉴权 PATCH；页面源码合同改查新模块与调用接线，`test:digital-employees` 整组、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,360 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未做浏览器交互、真实供应商调用、目标库迁移或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## 数字员工配置安全规则拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `f87f3aeb6dc1c2a4c1c408e58e48d9ceb47839c5` 将首次配置默认值、旧发布节奏配额换算、配置补全与发布/跟进人工审批校验迁至 `digitalEmployeeConfigRules.ts`；页面保留引导、资料读取与既有保存链。`DigitalEmployeePage.tsx` 从 3,319 降至 3,181 行，历史预算同步收紧；全仓仍有 6 个历史超限文件。
- 新规则直测 3/3、`test:digital-employees` 整组、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,359 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未做浏览器交互、真实发布/付费供应商调用、目标库迁移或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## 灵感页待拍清单视图拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `0f32f8777f6189a731e146f134c44d112b106d85` 将实际挂载的待拍清单、排序/筛选和可选实拍入口迁至 `InspirationShootingPanel.tsx`；页面继续拥有视频/素材读取、上传状态与任务回写。`InspirationDashboard.tsx` 从 2,550 降至 2,474 行，架构预算同步收紧；全仓仍有 6 个历史超限文件。
- 新组件 SSR 直测 1/1，`test:video-source-boundaries` 119/119、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,358 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。尚未做浏览器交互、真实供应商调用、目标库迁移或部署；LinkedIn 公司帖真实付费入口仍受未具备的费率/共享卷等前提关闭，本地/远端 SHA 与工作区状态以推送后核对为准。

## 灵感页产品库存与周参考目标拆分（2026-10-23）

- 代码提交 `c7142ba99a50d20c6dbce81d1b68074b8fcff733` 将按产品 ID 读取完整素材、批量逐页汇总及周参考目标解析/匹配分别迁至 `inspirationProductMaterialInventory.ts` 和 `inspirationReferenceTarget.ts`；页面保留请求时机、状态与导航。`InspirationDashboard.tsx` 从 2,677 降至 2,550 行，预算同步收紧；全仓仍有 6 个历史超限文件。
- 库存两页读取、去重、顺序和产品隔离直测 2/2；参考目标解析/匹配直测 2/2；旧源码契约改查实际模块与页面接线。`test:video-source-boundaries` 118/118、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,357 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build`、`git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未做浏览器交互、真实供应商调用、目标库迁移或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## 灵感页原视频预览与拍摄缺口拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `bbe7bf39f9ef4acc24feaca6d9e684a041b7c4b3` 将当前挂载的原视频预览弹窗迁至 `InspirationWatchModal.tsx`，将分析与素材匹配驱动的拍摄缺口汇总迁至 `inspirationShootingNeeds.ts`；页面继续拥有预览选择、视频与素材读取。`InspirationDashboard.tsx` 从 2,828 降至 2,677 行，历史预算同步收紧；全仓仍有 6 个超限文件。
- 新拍摄缺口直测 2/2，源码契约检查迁出弹窗及页面接线；`test:video-source-boundaries` 109/109、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,355 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未做浏览器交互、真实供应商调用、目标库迁移或部署；本地/远端 SHA 和工作区状态以推送后核对为准。

## LinkedIn 公司帖唯一付费许可账本（2026-10-23）

- 代码提交 `0322c213728268708dc95602f049ab0ad7c2683b` 增加逐 run 持久预算预约和唯一提交许可账本；许可通过服务端端口重新计算最坏情况报价，在 POST 与数据集 GET 前分别认领，绑定原始运行/结算/读取回执，并核对实际传输 Token 指纹。离线 Mock 集成覆盖并发认领、重启后禁重发、报价变化、撤销、回执与数据集独立门禁。普通发现 worker 尚未签发此许可。
- 新边界回归纳入固定脚本，`test:video-source-boundaries` 107/107、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,353 个生产 TypeScript 文件，仍有 6 个历史超限文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。真实费率/汇率及非 Actor 费用证据适配、目标共享卷跨实例语义和生产许可签发接线仍缺，未执行真实付费请求、目标库迁移或部署。最终本地/远端 SHA 与清洁度以推送后核对为准。

## 数字员工旧首页与计划预览脚手架清理（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `6e5e4fcc49b9442b09f035a2f8e0f0bee1309a88` 删除未挂载的 `TodayNextAction`、`BusinessLoopMap`、`ResourcePreflightPanel`、`NextActionBanner`、`DraftPlanPreview` 与未使用的彩纸常量；实际首页 `TodayFocusPanel`、任务包 `WeeklyExecutionNodes`、任务详情及 `OnboardingPanel` 的就绪资产跳转仍保留。页面从 3,818 降到 3,319 行，历史预算同步收紧；全仓仍有 6 个超限文件。
- 旧源码契约测试曾以未挂载的业务流转图和草案预览文案证明已交付，现改为检查实际任务包节点、已保存的任务状态来源和旧视图不存在。`DigitalEmployeePage.contract.test.ts`、`test:digital-employees`、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,352 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未做浏览器交互、真实供应商调用、目标库迁移或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## 数字员工旧生产现场链清理（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `3e4183d64f06d4b4ed498bc7c01a0e6ac3ea1e35` 移除了仅在彼此内部引用、未挂到页面的 `ProductionScene` 及其任务图标、事件时间线、截图流、纠偏和跳过/人工完成操作面板。当前选中任务仍挂 `ProductionTaskScene`，业务深链和 `SmartBusinessDashboard` 重试入口未变。`DigitalEmployeePage.tsx` 从 4,477 降至 3,818 行，历史预算同步收紧；全仓仍有 6 个超限文件。
- 修复了旧源码契约测试把死代码的按钮与文案算作已交付的问题；现断言实际 `ProductionTaskScene`、真实任务深链与重试 API 接线，并保留后端跳过/人工完成端点的独立检查。后端端点存在不证明当前页面提供这些按钮，不能据旧测试宣称交互已验收。
- `test:digital-employees` 整组、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,352 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未做浏览器交互、真实供应商调用、目标库迁移或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## 客户批量跟进真实发送边界展示拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `5ae9a0cf3fd67218141bfa2a425974b94da7d385` 将正在挂载的批量跟进真相面板及可用性徽标迁至 `BatchFollowupTruthPanel.tsx`；页面仍持有原派发 API、租户上下文、忙碌状态和跳转，向组件显式传入原状态文案。`DigitalEmployeePage.tsx` 从 4,641 降至 4,477 行并收紧预算；全仓仍有 6 个历史超限文件。
- 新 SSR 回归 2/2 验证缺授权禁发、授权后到期客户入口与真实回执后的禁重派发；页面契约测试改查迁出组件与页面接线。`test:digital-employees` 整组、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,352 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build`、`git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未进行浏览器交互、真实消息发送、付费供应商调用、目标库迁移或部署；本地/远端 SHA 与工作区状态以推送后核对为准。

## 数字员工未挂载旧视图清理（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `71e08ceb42ff3799c608b891b8341570ae125f92` 删除 `DigitalEmployeePage.tsx` 中未被调用的旧“今日经营快照”、指标卡与转化图表脚手架，当前实际挂载的 `BusinessHealthOverview`、`SmartBusinessDashboard`、`DigitalEmployeeTodayFocusPanel` 未改。页面从 4,943 降至 4,641 行并同步收紧架构预算；全仓仍有 6 个历史超限文件。
- 同步修复源码契约测试的过时目标：数字员工页检查实际挂载而非死函数；WhatsApp 入站授权读取定位到已拆分的 `historyInbound.ts`；平台排程仅要求平台集合、不把内部扫描次序当业务顺序；本地 Mock 检查当前 `AppPageSlot` 与集中本地门禁。`test:digital-employees` 初次被这些旧断言阻断，逐项核对现行实现后整组重跑通过；`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,351 个生产 TypeScript 文件）、`test:architecture-ratchet`、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过。`AiCreateStudio` chunk 为 497,209/500,000 字节。未做浏览器交互、真实付费供应商调用、目标库迁移或部署；最终本地/远端 SHA 和工作区状态以推送后核对为准。

## 爬虫元数据兜底分析拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `0ead7702a6e0caa010954c622472c5d7f8778b1b` 将元数据兜底分析的纯规则迁至 `videoCrawlerMetadataFallback.ts`，原函数正文逐行比对一致；7 个原调用点仍由 `videos.ts` 编排，未触碰分析队列、真实模型调用或付费许可。`videos.ts` 从 9,200 降至 9,111 行，架构预算同步收紧；全仓仍有 6 个历史超限文件。
- 新规则直测 2/2、`test:video-source-boundaries` 102/102、`test:production-workflows`、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,351 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未做真实爬取/付费供应商调用、目标库迁移、浏览器验收或部署；最终本地/远端 SHA 和工作区状态以推送后核对为准。

## 图片证据轮播编号与 AIGC 来源复核（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `4e4031b34b43a862c70576086e041d6c748e6fe0` 修正图文证据面板的轮播编号：分析输入、Qwen/Gemini 契约和图层蓝图均从第 1 张开始，原面板多加 1，现统一按证据 `imageIndex` 展示；新增服务端静态渲染回归，覆盖轮播证据与图层蓝图同号。
- 复核新图片来源提交 `23b1bb93`：图层蓝图与蒙版确定性处理已在集成代码中；来源提交中的自动 GPT 降级会替换用户要求暂留的 Qwen→Gemini 行为，且未具备真实账号费率、持久唯一付费许可及未知结果恢复条件，因此未整笔 cherry-pick，来源树保留。此修正不接入新的付费请求，也不改变既有降级路由。
- 定向测试 5/5、`test:video-source-boundaries` 100/100、`test:social-image-pipeline`、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,350 个生产 TypeScript 文件，仍有 6 个历史超限文件）、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未做真实供应商调用、浏览器交互验收、目标库迁移或部署；本地/远端 SHA 与清洁度以推送后核对为准。

## 素材卡与使用履历拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `432977c8` 将素材卡媒体/操作层和素材使用履历分别迁至 `MaterialLibraryCardMedia.tsx`、`MaterialUsageHistory.tsx`；原逻辑正文按 83 行与 99 行逐行核对一致，素材列表请求与详情选择仍在页面。`InspirationDashboard.tsx` 从 3,011 降至 2,828 行并同步收紧历史预算；全仓仍有 6 个超限文件。
- 修正旧契约测试在前批次详情迁出后仍读取页面源码的问题，并将全部 9 个 `InspirationDashboard` 测试文件纳入固定来源回归。页面契约组 16/16、`test:video-source-boundaries` 99/99、`test:production-workflows`、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,350 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build` 和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。架构检查首次因导入多一行而比拟定预算高 1 行，按实测行数修正为 2,828 后复跑通过。
- 这是源码与离线回归验收，未做浏览器视口/无障碍验收、真实付费供应商调用、目标库迁移或部署；工作树与远端一致性以推送后 Git 核对为准。

## 编导视频详情职责拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `027646f2` 将编导视频详情 Drawer 原样迁至 `src/components/inspiration/DirectorVideoDetailPanel.tsx`，页面仍拥有选中对象、任务动作和身份边界，并转发原公开组件导出。原组件正文与新组件的 151 行逐行核对一致；`InspirationDashboard.tsx` 从 3,163 降至 3,011 行并收紧预算。全仓仍有 6 个历史超限文件，架构债务尚未清零。
- 详情/预览定向契约测试 7/7 加预览脚本通过，`test:video-source-boundaries` 89/89、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,348 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未做浏览器交互、真实付费供应商、目标库迁移或部署。最终本地/远端 SHA 与工作区状态以推送后 Git 核对为准。

## 视频爬虫静态来源目录拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `07414ec1` 将 Facebook/Instagram 静态来源 URL、TikTok 账号种子及按关键词选择的历史候选从 `server/routes/videos.ts` 迁至纯规则模块 `videoCrawlerSeedCatalog.ts`。路由保留实时检索、媒体读取、来源资格筛选、租户边界及付费准入；从 9,424 降至 9,200 行，架构预算同步收紧。全仓仍有 6 个历史超限文件，不能称结构拆分完成。
- 新目录直测 2/2、`test:video-source-boundaries` 89/89、`test:production-workflows`、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,347 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build` 和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。没有对静态 URL 做实时可访问性或授权确认，也没有真实下载、付费调用、目标库迁移、浏览器验收或部署。最终本地/远端 SHA 与工作区状态以推送后 Git 核对为准。

## LinkedIn 公司帖付费报价边界（2026-10-23）

- 代码提交 `a91c11ee` 新增 `linkedinCompanyCollectionQuote.ts`：在逐 run 批准与来源仍有效时，从受信任端口读取账号/Token 指纹、Actor USD 上限、汇率 CNY 上界和数据集读取等非 Actor 费用上界，计算不超过人工批准金额的人民币最坏情况报价；缺项或变化均拒绝。报价前后重读权威批准，并将任务、账号、Actor 输入和证据哈希绑定到稳定操作标识。
- 离线报价直测 4/4、`test:video-source-boundaries` 87/87、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,346 个生产 TypeScript 文件，仍有 6 个历史超限文件）、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过。首次 TypeScript 检查指出测试夹具未标参数类型，修正后复跑通过。
- 报价端口尚无目标账号的真实费率/汇率/非 Actor 费用权威实现，也没有跨实例原子预算预约、唯一许可签发和目标共享卷证明。输出仅供后续门禁，不能触发真实 Actor 或数据集 GET；原有 LinkedIn 生产入口继续默认拒绝。未执行真实付费请求、目标库迁移或部署。最终本地/远端 SHA 与工作区状态以推送后 Git 核对为准。

## 图片证据 GPT 复核批准准备（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `964222ef` 增加 `imageEvidenceReviewPreparation.ts`：以权威租户图片记录、来源图片字节和现有主分析冻结精确 GPT 请求；只接受可信账号模型、模型感知输入 token 上界与有效人民币费率，在报价不超过逐记录人工上限且来源未变化时才写入现有批准记录。完整高置信度主分析不无故进入付费复核。没有默认费率、估算 token 兜底或浏览器提供的付费意图。
- 准备模块新直测 4/4、`test:video-source-boundaries` 83/83、`test:social-image-pipeline`、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,345 个生产 TypeScript 文件，仍有 6 个历史超限文件）、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。该模块尚未接入逐记录 HTTP/worker 执行入口，真实账号费率、可信计量适配及共享卷部署证明仍缺；当前 Qwen→Gemini 自动降级不变，未执行真实付费请求、目标库迁移、浏览器验收或部署。最终本地/远端 SHA 与工作区状态以推送后 Git 核对为准。

## 灵小枢退出历史超限清单（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `405a24af` 将单列对话面板渲染、外部决策详情生命周期和浮层焦点/收起控制分别迁至 `AssistantConversationPanel.tsx`、`useAssistantDecisionDialog.ts` 与 `useAssistantPanelControls.ts`。主文件 `GlobalAssistant.tsx` 从 1,124 降至 798 行，撤销其历史超限豁免；全仓超限清单由 7 项降为 6 项。身份范围、线程保存、签名动作和原有付费门禁仍由既有链路控制，未改动 Qwen→Gemini 降级。
- `test:assistant`、`test:assistant-production` 34/34、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,344 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。此为源码和离线测试验收，未做真实浏览器交互、付费供应商调用、目标库迁移或部署；最终本地/远端 SHA 与工作区状态以推送后 Git 核对为准。

## 灵小枢任务动作拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `4b1c758f` 将快捷生产操作的确认、返工、启动、原任务回执，以及签名任务卡按钮和暂停/继续动作分别迁至 `useAssistantQuickExecution.tsx` 和 `useAssistantTaskCardActions.ts`。浮层仍持有身份范围栅栏、任务状态和展示，未开放新的付费入口。`GlobalAssistant.tsx` 从 1,266 降至 1,124 行，历史预算同步收紧；全仓仍有 7 个超限文件，结构治理尚未完成。
- `test:assistant`、`test:assistant-production` 34/34、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,341 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build` 和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未做浏览器交互验收、真实付费供应商调用、目标库迁移或部署；最终本地/远端 SHA 和工作区状态以推送后 Git 核对为准。

## 灵小枢消息发送链拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `26c2bdc7` 将单轮消息发送、当前身份范围栅栏、明确生产请求与签名动作分流、附件上传缓存、周计划确认分流和流式答复编排迁至 `src/components/assistant/useAssistantSend.ts`。浮层仍拥有草稿、附件与消息状态、身份栅栏实例和持久化生命周期；未改变 Qwen→Gemini 现有降级或开放新付费入口。`GlobalAssistant.tsx` 从 1,557 降至 1,266 行，历史预算同步收紧；全仓仍有 7 个超限文件，结构治理未完成。
- 新发送直测 1/1、`test:assistant`、`test:assistant-production` 34/34、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,339 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build` 和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未做浏览器交互验收、真实付费供应商调用、目标库迁移或部署；最终本地/远端 SHA 与工作区状态以推送后 Git 核对为准。

## 视频爬虫运行配置拆分与工作树复核（2026-10-23）

- 代码提交 `6934ca1a` 将代理池、子进程环境、Cookie 文件及浏览器候选选择迁至 `server/routes/videoCrawlerRuntimeConfig.ts`；`videos.ts` 继续负责当前尝试代理和实际下载，从 9,495 降至 9,424 行并收紧预算。修正原有逗号分隔浏览器配置会把整串送作单个 yt-dlp 浏览器名的问题。全仓仍有 7 个历史超限文件，架构债务未清零。
- 运行配置/下载参数直测 5/5、原视频恢复测试、`test:production-workflows`、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,338 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。没有真实下载、付费供应商、目标库迁移、浏览器验收或部署。
- 当前 11 个工作树的只读复核见 `docs/governance/WORKTREE-INVENTORY.md`：6 个非集成树仍有未提交项；4 个干净非集成树分别有独有补丁或被忽略的业务/账本数据，没有符合无损归档条件的新候选。图片 `23b1bb93` 的剩余自动 GPT 路由仍与用户要求暂留的 Qwen→Gemini 行为冲突，且无生产可用许可，不整笔合入。最终本地/远端 SHA 和工作区状态以推送后 Git 核对为准。

## Studio 口播语种规则拆分（2026-10-23）

- 代码提交 `6e75a959` 将目标语种文字系统判定、逐句修复切分和配音句子边界迁至纯规则模块 `server/routes/studioVoiceoverLanguageRules.ts`。`studio.ts` 继续转发既有公开函数，并保留模型翻译、TTS 供应商、文件、付费许可与回执编排；路由从 9,568 降至 9,502 行，历史预算同步收紧。全仓仍有 7 个历史超限文件，结构治理未完成。
- 新规则直测 3/3、`test:studio-script`、`test:studio-workflow`、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,337 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build` 和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行真实模型、TTS 或其他付费请求，未进行目标库迁移、浏览器验收或部署；最终本地/远端 SHA 和工作区状态以推送后 Git 核对为准。

## 视频下载器参数规则拆分（2026-10-23）

- 代码提交 `43f3082e` 将 yt-dlp 参数和平台 Referer 纯规则迁至 `server/routes/videoDownloaderArgs.ts`，旧 `videos.ts` 公开导出继续兼容，运行环境、下载执行与 Cookie 回退仍由路由控制。`videos.ts` 从 9,522 降至 9,495 行，架构预算同步收紧；全仓仍有 7 个历史超限文件，结构治理并未完成。
- 新规则测试 3/3、原视频管线恢复测试、`test:production-workflows`、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,336 个生产 TypeScript 文件）、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过。整组回归初次被脚本中已失效的 `scheduledTaskTemplates.test.ts` 路径阻断；确认同名测试实际为 `.tsx` 后修正脚本，原样复跑通过。`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行真实下载、付费供应商、目标库迁移、浏览器验收或部署；最终本地/远端 SHA 和工作区状态以推送后 Git 核对为准。

## 图片证据逐记录人工批准权威（2026-10-23）

- 代码提交 `7a90c1cf` 增加图片 GPT 复核的后台专用持久批准与撤销记录：由具备租户角色的人员批准一个确定的图片来源快照、精确 OpenAI 请求和不超过 15 元的上限，最长 24 小时；读取批准时重验租户、素材、请求哈希、有效期及撤销。批准适配层接到现有预算预留边界，批准本身不充当一次性付费许可，也不签发供应商报价。新增迁移只做仓库文件审查，尚未对目标 PocketBase 执行。
- 来源与付费边界回归 79/79、`pnpm run lint`、架构扫描及相对上一代码基线的 ratchet（2,335 个生产 TypeScript 文件，仍有 7 个历史超限文件）、193 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。离线许可联调使用模拟报价与共享卷，不构成真实账号报价、可信计量、目标共享卷或生产许可签发证明。图片爬取/重分析路由仍未接 GPT 付费调用，Qwen→Gemini 原有降级不变；未做真实付费请求、目标库迁移、浏览器验收或部署。最终本地/远端 SHA 和工作区状态以推送后 Git 核对为准。

## 图片 AIGC 来源与工作树点位复核（2026-10-23）

- 以干净集成代码点 `ad4bf42e` 复核原图片管线与新图片分支：`6e2d2e4f`、`95b0bcc1` 和新图片提交 `23b1bb93` 的父提交都在集成历史中；`23b1bb93` 本身仍有非等价独有补丁。图层与蒙版的确定性能力已选择性进入集成，剩余自动 GPT 路由会替换用户要求暂留的 Qwen→Gemini 行为且付费许可未完整接入，不整笔合并。`test:social-image-pipeline` 与 `test:video-source-boundaries`（75/75）通过；没有真实付费请求或部署。
- 11 个有效工作树的当前分类及保留理由见 `docs/governance/WORKTREE-INVENTORY.md`。6 个非集成树有未提交项，另 4 个干净非集成树仍有独有补丁或不可丢失的忽略数据，本次无安全归档候选；只读盘点未移动任何工作树。此文档提交只更新治理证据，不改变源码或目标数据；最终本地/远端 SHA 和工作区状态以推送后 Git 核对为准。

## 精确视频时间线规则拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `321146a0` 将物理剪辑点选帧、Qwen 观察窗口合并、Gemini 镜头切分和时间标签平移迁至纯规则模块 `server/routes/videoAnalysisTimelineProjection.ts`；`videos.ts` 保留原有导出及供应商/存储编排，从 9,647 降至 9,522 行并收紧历史预算。全仓仍有 7 个历史超限文件，架构债务尚未全部拆完。
- 新规则直测及原 ASR/镜头分组测试 4/4；视频路由回归首次为 15/16，唯一失败是本工作树缺少项目隔离 `yt-dlp`，测试未进入下载替身。按仓库固定版本和哈希脚本准备隔离下载器后原样复跑 16/16 通过；未下载媒体或读取 Cookie。`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,334 个生产 TypeScript 文件）、192 项迁移仓库只读检查、`pnpm run build` 和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行真实付费供应商、目标库迁移、浏览器端验收或部署；最终本地/远端 SHA 和工作区状态以推送后 Git 核对为准。

## LinkedIn 付费回执引用传递（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `7d549086` 让 Apify 受控运输层把原始 HTTP 回执引用传给 run 与终态记账回调；LinkedIn 包装层在回执引用为空时拒绝登记。Actor 已提交但提交回执引用缺失时维持结果不明且禁止第二次 POST；终态轮询回执引用缺失时不结算、不读取数据集。此改动不构成完整持久化许可签发器，也不证明回执已在目标共享卷核验。
- 来源边界测试 75/75、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,333 个生产 TypeScript 文件）、192 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。缺少可信账号报价/汇率、非 Actor 费用上界、跨实例唯一许可和目标共享卷证明，LinkedIn 真实付费入口继续关闭；未执行供应商付费请求、目标库迁移或部署。最终本地/远端 SHA 与工作区状态以推送后 Git 核对为准。

## 灵小枢页面信号职责拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `adb0a2bf` 将页面上下文事件的来源过滤、关闭态按当前周目标读取权威待办数量的低频轮询与监听清理迁至 `src/components/assistant/useAssistantPageSignals.ts`。浮层保留状态和身份范围所有权，`GlobalAssistant.tsx` 从 1,622 降至 1,557 行，历史预算同步收紧。契约测试还更新了此前迁出动作请求后遗留的旧超时断言，改为核验实际请求适配层，并移除未使用常量。全仓仍有 7 个历史超限文件，结构治理尚未收口。
- `test:assistant`、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,333 个生产 TypeScript 文件）、192 项迁移仓库只读检查、`pnpm run build` 和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行真实付费供应商、目标库迁移、浏览器端验收或部署。LinkedIn 付费采集及额外 AIGC 降级仍未满足完整门禁，不因本次拆分开放；最终本地/远端 SHA 和工作区状态以推送后 Git 核对为准。

## GPT 图片证据原始回执限流（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `bf59f368` 将付费响应的流式字节上限抽为 `server/lib/boundedProviderResponse.ts`：GPT 图片证据适配器在读取时最多接收 1 MiB 原始正文，Apify 原始回执路径继续采用 8 MiB 上限。GPT 响应超限后同一逐记录许可保持结果不明，跨上下文实例不能重发；不将原分支无许可的自动 GPT 降级接入路由，保留用户指定的现有 Qwen→Gemini 行为。
- 来源及付费边界脚本 73/73、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,332 个生产 TypeScript 文件）、192 项迁移仓库只读检查、`pnpm run build` 与 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。现有 GPT 适配器仍缺独立的图片记录人工批准、可信多模态计量/账号报价接线和目标共享卷证明，爬取/重分析路由未调用它；旧 Gemini 自动降级亦非完整逐记录付费治理。没有真实付费请求、目标库迁移、浏览器验收或部署。下一步先建立上述记录级批准与请求冻结/恢复链，再处理原分支剩余差异；最终本地/远端 SHA 和工作区状态以推送后 Git 核对为准。

## LinkedIn 原始付费响应流式上限（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `24d266aa` 将要求原始回执的 Apify HTTP 响应改为读取阶段 8 MiB 字节上限，与 LinkedIn 只写一次回执存储共用常量；超限时中止请求，已提交的 Actor 保持 `submitted_unknown`，禁止自动重发。这限制应用读取/存储的正文，不证明供应商传输费用上限，也不开放真实付费入口。`test:video-source-boundaries` 纳入 LinkedIn 批准、传输和回执合同。
- 相关付费传输/回执定向测试 18/18、扩展来源边界测试 65/65、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,331 个生产 TypeScript 文件）、192 项迁移仓库只读检查、`pnpm run build` 和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。缺少可信账号报价/汇率、非 Actor 费用预约、跨实例唯一许可签发及目标共享卷验证，LinkedIn 采集仍默认关闭；没有真实付费请求、目标库迁移或部署。后续须基于真实账号证据补齐完整费用上界和唯一签发，再离线验证断连/恢复与租户隔离；最终本地/远端 SHA 及工作区状态以推送后 Git 核对为准。

## Instagram/TikTok 图片帖投影拆分与 LinkedIn 门禁复核（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `f9983810` 将 Instagram/TikTok Apify 图片帖的来源、图片和互动数据纯投影迁至 `server/routes/videoCrawlerImageProjection.ts`，保留原有平台/视频排除规则；`videos.ts` 仍负责 Actor 调用、付费准入和持久化，从 9,720 降至 9,647 行，历史预算同步收紧。全仓仍有 7 个超限文件，结构治理未完成。
- 新直测 4/4、`test:video-source-boundaries` 43/43、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,331 个生产 TypeScript 文件）、192 项迁移仓库只读检查、`pnpm run build` 和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行真实供应商调用、目标库迁移、浏览器验收或部署。
- 复核现有 LinkedIn 逐 run 批准/撤销、受控 Actor 传输和原始 HTTP 回执后，真实入口仍因缺少可信账号报价及汇率、独立 dataset/传输费用预算、跨实例唯一付费许可签发与目标共享卷验证而保持关闭。批准记录不能充当付费许可；下一步须先补齐这些证据及签发器，再做不调用真实供应商的端到端门禁测试。最终本地/远端 SHA 与工作区状态以推送后 Git 核对为准。

## 灵小枢确定性操作请求边界拆分（2026-10-23）

- 集成分支 `xixi1021程永罗沟通前大整合` 的代码提交 `9203396d` 将带鉴权的确定性动作 HTTP 请求、409 冲突、422 缺输入、超时结果待确认与无效响应的可见错误卡映射迁至 `src/lib/assistantActionRequest.ts`。浮层仍只从服务端签名卡片构造变更操作、保留身份范围与任务卡编排；请求故障不得回退为通用聊天。`GlobalAssistant.tsx` 从 1,682 降至 1,622 行，历史预算同步收紧；全仓仍有 7 个超限文件，架构治理未完成。
- 新离线适配层测试 4/4、`test:assistant`、`test:assistant-production` 34/34、`pnpm run lint`、`ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture`（2,330 个生产 TypeScript 文件）、192 项迁移仓库只读检查、`pnpm run build` 及 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未做真实浏览器操作、真实付费供应商调用、目标库迁移或部署。下一步继续缩减历史超限文件，并在独立授权和门禁证据齐备后处理 AIGC 未合的自动降级补丁与 LinkedIn 付费采集；最终本地/远端 SHA 及工作区状态以推送后 Git 核对为准。

## 灵小枢明确生产请求职责拆分（2026-10-23）

- 代码提交 `ec41ba12` 将企业中心产品身份解析、单条内容任务截止时间确认、真实周任务创建、回执任务卡和深链导航整组迁至 `src/components/assistant/assistantProductionRequest.tsx`。浮层继续控制身份范围、生产意图与问答分流；新模块调用现有 `socialContentApi.createAssistantAction`，不绕过后端生产准入或付费门禁。`GlobalAssistant.tsx` 从 1,756 降至 1,682 行，历史预算同步收紧；全仓仍有 7 个超限文件。
- 新离线链路测试 3/3、`test:assistant`、`test:assistant-production` 34/34、TypeScript、架构扫描及相对上一基线 ratchet、192 项迁移仓库只读检查、生产构建和 `git diff --check` 通过。首次 TypeScript 检查只发现新测试的可空类型声明错误，修正后重跑通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行真实内容生产、付费供应商、目标库迁移、浏览器端验收或部署；最终本地/远端 SHA 和工作区状态以推送后 Git 核对为准。

## 灵小枢问答上下文纯组装职责拆分（2026-10-23）

- 代码提交 `3f15afb2` 将当前页面提示、企业摘要、实时接入事实、已持久化附件元数据、有界历史约束与文件交付格式组装迁至 `src/components/assistant/assistantChatPrompt.ts`。策略主路由仍只传当前用户原文，由服务端注入权威经营事实；组件保留身份栅栏、任务/操作分流、附件上传与流式状态。`GlobalAssistant.tsx` 从 1,803 降至 1,756 行，历史预算同步收紧；仍有 7 个超限文件。
- 新纯函数测试 3/3、`test:assistant`、TypeScript、架构扫描及相对上一基线 ratchet、192 项迁移仓库只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未做真实浏览器问答验收、付费供应商调用、目标库迁移或部署；最终本地/远端 SHA 和工作区状态以推送后 Git 核对为准。

## 灵小枢线程恢复与权威动作重签职责拆分（2026-10-23）

- 代码提交 `b5e6217f` 将租户/用户限定的本地 journal 恢复、远端 CAS 快照合并、旧对话正文剔除与旧聚焦任务卡的权威状态/动作重签迁至 `src/components/assistant/useAssistantThreadHydration.ts`。浮层保留身份范围、保存队列、欢迎语时机和会话展示。`GlobalAssistant.tsx` 从 1,901 降至 1,803 行，历史预算同步收紧；全仓仍有 7 个超限文件。
- 新增恢复规则测试 2/2，`test:assistant`、TypeScript、架构扫描及相对上一基线 ratchet、192 项迁移仓库只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。没有真实浏览器会话恢复验收、付费供应商调用、目标库迁移或部署；最终本地/远端 SHA 和工作区状态以推送后 Git 核对为准。

## 灵小枢后台通知生命周期职责拆分（2026-10-23）

- 代码提交 `238cb28c` 将后台任务卡、等待状态、一次性短消息和首次入口提示的事件订阅、静默策略、轮播与清理整组迁至 `src/components/assistant/useAssistantNotifications.ts`；浮层仍持有用户主动操作结果与对话状态。`GlobalAssistant.tsx` 从 2,008 降至 1,901 行，历史预算同步收紧；仍有 7 个超限文件。
- `test:assistant`、TypeScript、架构扫描及相对上一基线 ratchet、192 项迁移仓库只读检查、生产构建和 `git diff --check` 通过。第一次架构检查因预算记录误写为 1,900 而失败，按实际 1,901 行修正后通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未做真实浏览器通知交互、付费供应商调用、目标库迁移或部署；最终远端 SHA 和工作区状态以推送后 Git 核对为准。

## 灵小枢功能引导生命周期职责拆分（2026-10-23）

- 代码提交 `4b63a87d` 将功能引导的本地记忆、去重冷却、企业页一次性提示、指针/焦点触发及计时器/监听器清理整组迁至 `src/components/assistant/useAssistantFeatureGuides.ts`；浮层仍持有提示展示与打开对话动作。`GlobalAssistant.tsx` 从 2,138 降至 2,008 行，历史预算同步收紧；全仓仍有 7 个超限文件，不能据此称结构治理已完成。
- 新规则测试 3/3、`test:assistant`、TypeScript、架构扫描及相对上一基线 ratchet、192 项迁移仓库只读检查、生产构建和 `git diff --check` 通过。`AiCreateStudio` chunk 为 497,209/500,000 字节。未进行真实浏览器交互、付费供应商调用、目标库迁移或部署；最终远端 SHA 和工作区状态以推送后 Git 核对为准。

## 灵小枢流式回答与文件交付职责拆分（2026-10-23）

- 代码提交 `0921d93a` 将模型首响应/流式空闲超时、SSE 完整性与文件正文完成后生成迁至 `src/lib/assistantChatStream.ts`；`GlobalAssistant.tsx` 保留身份栅栏、消息状态、错误提示和任务分流。主组件从 2,224 降至 2,138 行，历史超限预算同步收紧；全仓仍有 7 个超限文件，结构治理尚未完成。
- 新模块完整流、传输中断和 PDF 文件交付测试 3/3、`test:assistant`、TypeScript、架构扫描/相对上一基线 ratchet、192 项迁移仓库只读检查、生产构建及 `git diff --check` 通过。`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行真实模型/付费供应商、目标库迁移或部署；离线测试不替代真实浏览器验收。最终本地/远端 SHA 和工作区状态以推送后 Git 核对为准。

## LinkedIn 公司帖原始付费回执硬门禁（2026-10-23）

- 代码提交 `169ad3cdae06f5c6d8f9093815a851fb072e9fb7` 为受控 LinkedIn Apify 许可增加必需的原始响应持久化回调，共用传输在 Actor POST、run GET 与 dataset GET 响应到达后先交给回调，成功后才解析或更新账本状态。新增 `server/socialDiscovery/linkedinCompanyReceiptStore.ts`，以批准记录、租户/run、Actor、请求与 Token 指纹绑定 write-once 原始状态码/正文，缺共享根、冲突和篡改均拒绝。现有 TikTok 许可不被这次接口增量强制改动；LinkedIn POST 已发出但回执失败时保持结果不明且禁自动重提。
- Apify 传输与 LinkedIn 受控路径/回执存储离线测试 17/17，LinkedIn 来源与批准测试 11/11；TypeScript、架构扫描及相对上一基线 ratchet、192 项迁移仓库只读检查、生产构建和 `git diff --check` 通过。`AiCreateStudio` chunk 为 497,209/500,000 字节。尚未建立可信账号报价与汇率、独立 dataset/传输费用预算、跨实例唯一许可签发器，也未验证目标部署共享卷；因此真实付费入口继续关闭。未发起真实 Actor、目标库迁移或部署；最终本地/远端 SHA 与工作区状态以推送后核对为准。

## Studio 产品脚本与素材证据规则整组拆分（2026-10-23）

- 代码提交 `ade1ea53a2ab6188fe68670c0381313bef69dbb2` 将产品/目标买家/合作路线的保守口播计划、完整 CTA、锁定分镜序列化、素材真实性与时间线检查整组迁至 `server/routes/studioProductScriptRules.ts`（551 行）；旧 `studio.ts` 导出继续转发，路由保留租户状态、模型生成、资料读取和修复编排。主路由从 10,063 降至 9,568 行，历史预算同步收紧；超限文件仍为 7 个，不代表结构治理完成。
- `test:studio-script` 整组、`test:studio-workflow`、TypeScript、架构扫描及相对上一基线 ratchet、192 项迁移仓库只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行真实模型/付费供应商、目标库迁移或部署；脚本回归只证明离线合同，不证明真实素材与供应商链路。最终本地/远端 SHA 与工作区状态以推送后 Git 核对为准。

## Studio 分镜口播规则职责拆分（2026-10-23）

- 代码提交 `7c768e252530f039d315681766b6f957bf8c3f85` 将分镜口播时长估计与语义压缩、CTA 语义保持、字幕同步、字段规范化、重复字段和口播字幕一致性规则迁至 `server/routes/studioStoryboardSpeechRules.ts`；原 `studio.ts` 导出继续转发，并保留 LLM 生成、租户素材读取与修复编排。两段经全文件引用确认未调用的私有辅助函数不再保留。主路由从 10,372 降至 10,063 行，预算同步收紧；历史超限文件仍有 7 个。
- `test:studio-script` 整组、TypeScript、架构扫描及相对上一基线 ratchet、192 项迁移仓库只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行真实模型/付费供应商、目标库迁移或部署；本地规则回归不等于真实模型生成验收。最终本地/远端 SHA 与工作区状态以推送后 Git 核对为准。

## 产品预制素材上传边界拆分（2026-10-23）

- 代码提交 `d9984cb34af465500942610f062b260828d3ee4a` 将产品预制素材上传意图、当前企业产品身份查找、完整视频探针结果封装、错误映射与复用授权元数据迁至 `server/routes/studioProductSceneUpload.ts`。`studio.ts` 保留 HTTP 上传生命周期、租户素材写入和对象存储，原复用授权导出继续转发；主路由从 10,483 降至 10,372 行，架构预算同步收紧。历史超限文件仍为 7 个。
- 新增上传前置拒绝和探针错误映射测试，产品场景专项 10/10；Studio 工作流合同、`test:material-import` 11/11、TypeScript、架构扫描及相对上一基线 ratchet、192 项迁移仓库只读检查、生产构建和 `git diff --check` 通过。`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行真实供应商、目标库迁移或部署；最终本地/远端 SHA 与工作区状态以推送后 Git 核对为准。

## 产品预制素材只读投影拆分（2026-10-23）

- 代码提交 `b736622429a5a1b609198b8a7f1ff11e3a5a0e7f` 将来源图选择、真实可制作素材判定、三类空槽位投影以及产品/素材范围过滤迁至 `server/routes/studioProductSceneProjection.ts`。`studio.ts` 保留租户鉴权、受保护 URL 签名、素材更新校验与 HTTP 响应；原公开导出继续转发。主路由从 10,621 降至 10,483 行，历史预算同步收紧；超限文件仍为 7 个。
- 产品预制素材 8/8、Studio 工作流合同、`test:material-import` 11/11、TypeScript、架构扫描及相对上一基线 ratchet、192 项迁移仓库只读检查、生产构建通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。提交后另修正新文件末尾空白行并以 `git diff --check` 复核。未执行真实供应商、目标库迁移或部署；最终本地/远端 SHA 与工作区状态以推送后核对为准。

## 产品预制素材凭证规则拆分（2026-10-23）

- 代码提交 `726e9b2e` 将产品预制素材的稳定槽位绑定、上传校验凭证解析、产品关联变更及检索标签迁至 `server/routes/studioProductSceneProvenance.ts`；`studio.ts` 保留原公开导出、租户产品查询、上传媒体探针和素材持久化。主路由从 10,768 降至 10,621 行，历史预算同步收紧；超限文件仍为 7 个，不能称全仓拆分完成。
- 产品预制素材定向测试 8/8、`test:material-import` 11/11、TypeScript、架构扫描及相对拆分前 HEAD 的 ratchet、192 项迁移仓库只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行真实供应商、目标 PocketBase 迁移或部署。最终本地/远端 SHA 与工作区状态以推送后 Git 核对为准。
- 图片 AIGC 来源复核：原来源 `95b0bcc1` 已在集成祖先中，新模块 `23b1bb93` 的确定性图层/蒙版能力已有选择性合入；仍独有的自动 GPT 路由会改变用户明确要求暂留的 Qwen→Gemini 降级，且没有完整逐记录付费许可与结果不明恢复，故未整笔 cherry-pick。该来源树及其他含独有补丁、未提交内容或被忽略业务数据的工作树继续保留，不能按“代码等价”归档。

## Apify 视频候选纯投影拆分（2026-10-23）

- 代码提交 `1220b17e809db19b7d6801323277d6317baabd59` 将 TikTok、Instagram、Facebook 的 Apify 视频行转换、封面 URL、标题与数量格式化迁至 `server/routes/videoCrawlerProviderProjection.ts`。原 `videos.ts` 仍负责 Actor 请求、付费门禁、账号范围、队列与持久化；图片帖转换继续复用相同的基础投影。主路由从 10,005 降至 9,720 行，预算同步收紧，历史超限文件仍有 7 个。
- 新模块视频候选/封面测试 4/4 已纳入视频来源边界回归，整组 39/39；原视频恢复测试、TypeScript、架构扫描及相对上一基线 ratchet、192 项迁移仓库只读检查、生产构建和 `git diff --check` 通过。`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行真实 Apify、其他付费供应商、目标库迁移或部署；最终本地/远端 SHA 与工作区状态以推送后核对为准。

## 视频分析失败与恢复规则拆分（2026-10-23）

- 代码提交 `30386f5884b3254d7cfcce0d142a184a8b45b8ba` 将视频级失败保留已完成证据、显式重试清空旧终态、供应商错误脱敏及用户恢复提示迁至 `server/routes/videoAnalysisRecovery.ts`。`videos.ts` 保留旧公开导出和租户数据读写、队列、HTTP 编排；不改变供应商调用或付费许可。主路由从 10,186 降至 10,005 行，预算同步收紧；历史超限文件仍有 7 个。
- 新模块直接测试 3/3、原视频恢复测试、视频来源边界回归 35/35、TypeScript、架构扫描及相对上一基线 ratchet、192 项迁移仓库只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行完整 `test:production-workflows`、真实付费供应商、目标库迁移或部署。最终本地/远端 SHA 与工作区状态以推送后核对为准。

## 灵小枢入口控件职责拆分（2026-10-23）

- 代码提交 `de8c2b5763867aa3b41100ed1cfe58760e9ffbdc` 将完整入口、贴边恢复入口、待办 Badge 和手动收起控件迁至 `src/components/assistant/AssistantLauncher.tsx`；浮层仍持有收起偏好、焦点交接及打开对话动作。原有 44px 触控目标、可访问名称、对话关联与白底/渐变样式保持。`GlobalAssistant.tsx` 从 2,270 降至 2,224 行，预算同步收紧，历史超限文件仍有 7 个。
- 新入口三态渲染测试 3/3 已纳入 `test:assistant`；助手合同、TypeScript、架构扫描及相对上一基线 ratchet、192 项迁移仓库只读检查、生产构建及 `git diff --check` 通过。`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行浏览器交互专项、真实付费供应商、目标库迁移或部署；最终本地/远端 SHA 与工作区状态以推送后核对为准。

## 灵小枢对话气泡展示职责拆分（2026-10-23）

- 代码提交 `8f12b60a96dddf2c3f53cf080e2d5cb71ce0855d` 将对话滚动区内的决策摘要、欢迎语、历史消息、加载态、任务摘要和周计划入口展示迁至 `src/components/assistant/AssistantConversationBubbles.tsx`。`GlobalAssistant.tsx` 仍控制滚动、草稿、发送、身份栅栏、持久化及详情弹窗动作；展示顺序、文案和动效索引保留。主文件从 2,374 降至 2,270 行，架构预算同步收紧；历史超限文件仍有 7 个。
- 助手合同与 `test:assistant`、TypeScript、架构扫描和相对上一基线的 ratchet、192 项迁移仓库只读检查、生产构建及 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行浏览器交互专项、真实付费供应商、目标库迁移或部署；离线验证不替代真实 UI 验收。最终本地/远端 SHA 与工作区状态以推送后核对为准。

## 灵小枢右侧提示气泡职责拆分（2026-10-23）

- 代码提交 `4f6fcf3f` 将右下入口旁的等待、短消息、周计划、功能引导与企业资料提示展示迁至 `src/components/assistant/AssistantFloatingReminders.tsx`；浮层保留状态、身份/页面上下文和动作回调。提示优先级、收起态/对话打开态不显示横向提示及现有动效参数保留。`GlobalAssistant.tsx` 从 2,496 降至 2,374 行，架构预算同步收紧；历史超限文件仍为 7 个。
- 新组件渲染测试 2/2、`test:assistant`、TypeScript、架构扫描及相对上一基线 ratchet、192 项迁移仓库只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行浏览器交互专项、真实供应商、目标库迁移或部署；离线测试不替代真实 UI 验收。最终本地/远端 SHA 与工作区状态以推送后核对为准。

## 数字员工纠偏业务状态失效职责拆分（2026-10-23）

- 代码提交 `311ad3d6` 将纠偏后的生产 job 取消、冻结内容批次与托管 Studio 项目失效、客户分群与跟进草稿/审批失效迁至 `server/digitalEmployees/taskCorrectionSupersession.ts`；路由仍持有运行锁并注入原有存储、job 控制和跟进项目读取。`digitalEmployees.ts` 从 5,708 降至 5,645 行，历史预算同步收紧；剩余历史超限文件仍为 7 个。
- 纠偏安全与编导合同定向 7/7、生产入口 27/27、TypeScript、架构扫描及相对上一基线 ratchet、192 项迁移仓库只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。旧发布/发送回执拦截仍先于失效操作；新增离线测试不等于真实外部恢复验收。未运行真实供应商、生产迁移或部署；最终本地/远端 SHA 和工作区状态以推送后核对为准。

## 数字员工任务纠偏安全职责拆分验收点（2026-10-23）

- 代码提交 `8f588b44` 将传递性下游任务范围、任务输出和帖子中不可逆外部回执判定、租户范围内帖子/发送回执复核迁至 `server/digitalEmployees/taskCorrectionSafety.ts`。原路由注入存储与发送回执读取并保留原拦截时机；`digitalEmployees.ts` 从 5,783 降至 5,708 行，架构预算同步收紧。剩余历史超限文件仍为 7 个，未完成全仓结构拆分。
- 新模块与任务证据规则定向 7/7、生产入口回归 27/27、TypeScript、架构扫描及相对上一基线的 ratchet、192 项迁移仓库只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未运行真实发送、发布、付费供应商、目标库迁移或部署；最终本地/远端 SHA 与工作区状态以推送后核对为准。

## LinkedIn 批准执行时复核验收点（2026-10-23）

- 代码提交 `8c80aaf4` 为逐 run 批准新增持久化读取断言，并在受控 Apify Actor POST 前、结果数据集 GET 前再次核验批准、撤销及冻结范围；批准撤销时，尚未发出的请求会被阻止。已提交的 Actor 不会因撤销自动取消，其回执仍需按原 run 核对。原手工 HTTP 入口和普通发现 worker 仍不签发付费许可。
- LinkedIn 离线定向测试 10/10、TypeScript、生产构建、架构扫描、192 项迁移仓库只读检查与 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。尚缺可信的供应商价格/汇率和非 Actor 费用覆盖、跨实例预算预约与唯一认领、原始运行回执持久化；因此真实付费入口继续关闭。未发起真实 Apify 请求、执行目标库迁移或部署。最终远端与工作区状态以推送后 Git 核对为准。

## 图片 AIGC 来源与工作树现状复核（2026-10-23）

- 在干净集成点 `d837f94f574ad60adbb3ac23e47eea5a4a07445b` 只读复核：原图片 AIGC 来源 HEAD `95b0bcc1` 已是集成祖先；新图片模块 `23b1bb93` 仍有独有补丁，其确定性图层/蒙版部分已有选择性合入。剩余自动 GPT 降级不能替换用户要求暂留的 Qwen→Gemini 行为，也缺逐记录付费许可和结果不明恢复，故未整笔合并。11 个工作树中 6 个仍有未提交项；4 个干净非集成树因被忽略业务数据或独有补丁不满足安全归档条件，均未动，详见 [`WORKTREE-INVENTORY.md`](./WORKTREE-INVENTORY.md)。
- 当前图片管线专项 55/55、隔离 HTTP 1/1、路由/工作台合同和隔离 GIF 浏览器流程、TypeScript、架构扫描、192 项迁移文件只读检查及生产构建通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未运行真实付费供应商、目标 PocketBase 迁移或部署，也未将独有 GPT 路由标成已合入。此批仅更新审计证据，不修改图片功能代码；提交后仍须复核本地/远端 SHA 与工作区状态。

## 自动成片 worker 退出历史超限例外（2026-10-23）

- 代码提交 `c717bf140ce0a2eb82b7f0dfb94e422eb676ece4` 将安全素材方案和编导冻结、人物声音绑定及渲染清单、最终工件的媒体/成本/质量/来源证据组装分别迁至 `socialContentProductionPlanAndDirector.ts`、`socialContentProductionRenderManifest.ts`、`socialContentProductionArtifact.ts`。`socialContentProductionExecution.ts` 从 1,094 降至 788 行，撤销其历史行数豁免；超限清单从 8 项降为 7 项。原 worker 仍负责阶段编排和既有付费门禁，结构拆分不开放新的真实供应商入口。
- 完整自动成片工作流、图执行/检查点/编导版本/复刻专项 14/14、配音身份/全轨恢复/预算预检/周任务材料准入专项 21/21、拍摄方案执行、TypeScript、架构扫描/ratchet、192 项迁移文件只读检查、生产构建和 `git diff --check` 通过。`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行真实付费请求、目标数据库迁移、浏览器成片验收或部署；这些本地验证不证明全仓架构治理或生产发布就绪。远端和工作区状态以推送后 Git 核对为准。

## 自动成片配音恢复与编导重试职责拆分验收点（2026-10-23）

- 代码提交 `671e00ea617244fc159ccb09c56a41157e8619af` 将冻结口播恢复、TTS 一次性操作认领与结果不明拒绝、声音检查点、超时长后编导压缩修订迁至 `socialContentProductionVoicePreparation.ts`。外层 worker 仍负责后续配乐、渲染与最终清理；阶段内异常由新模块清理未保留的临时音频。worker 从 1,293 降至 1,094 行，历史预算同步收紧；全仓仍有 8 个超限文件。
- 完整自动成片工作流、图执行/检查点/编导版本专项 13/13、配音身份/全轨恢复/预算预检/周任务材料准入专项 21/21、拍摄方案执行、TypeScript、架构扫描/ratchet、192 项迁移文件只读检查、生产构建及 `git diff --check` 通过。`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行真实 TTS、其他付费供应商、生产迁移或部署；本地模拟回归不等于真实供应商恢复验收。远端与工作区状态以推送后 Git 核对为准。

## 自动成片技术质检职责拆分验收点（2026-10-23）

- 代码提交 `4bf4d9c188c045e90b14e3e3cf02a7e989b7a81c` 将成片字节绑定的独立媒体探针、复刻忠实度失败原因、技术放行判断及质量检查点移至 `socialContentProductionTechnicalQuality.ts`；原 worker 保留渲染、图阶段返回与终审调用，从 1,323 降至 1,293 行，预算同步收紧。历史超限仍有 8 项，不能称整体架构债务已清。
- 完整自动成片工作流、生产执行、图执行/检查点/复刻专项 13/13、TypeScript、架构扫描/ratchet、192 项迁移文件只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未做真实供应商请求、目标数据库迁移、浏览器成片验收或部署；远端与工作区状态以推送后 Git 核对为准。

## 自动成片最终交付职责拆分验收点（2026-10-23）

- 代码提交 `4b070de05930eb342689bcd5dc96b3e476f7f896` 将成片与封面持久化、复刻评估、编导终审状态、成本摘要、最终生成素材归档和交付结果投影迁至 `socialContentProductionFinalDelivery.ts`。原 worker 保留阶段编排与后续工件创建，从 1,492 降至 1,323 行，架构预算同步收紧；全仓仍有 8 个历史超限文件，结构治理尚未全部完成。
- 自动成片完整工作流、生产执行、编导版本与检查点/复刻专项 14/14、TypeScript、架构扫描/ratchet、192 项迁移文件只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未做真实供应商调用、目标数据库迁移、浏览器成片验收或部署；本批不构成全链路发布就绪证据。远端与工作区状态以推送后 Git 核对为准。

## 自动成片前置准入职责拆分验收点（2026-10-23）

- 代码提交 `649bca21753859d4d015d745a43921038ef95368` 将周任务授权、冻结路线/复刻证据、已有成品幂等收口、人物技术栈选择和执行方案通过记录移至 `socialContentProductionAdmission.ts`。worker 仅在准入未完成且通过后进入制作；`socialContentProductionExecution.ts` 从 1,633 降至 1,492 行，历史预算同步收紧。仍有 8 个超限文件，不能称整体架构债务已清。
- 完整自动成片工作流、准入拒绝/生产图执行 9/9、拍摄方案执行、TypeScript、架构扫描/ratchet、192 项迁移文件只读检查、生产构建和 `git diff --check` 通过。`AiCreateStudio` chunk 为 497,209/500,000 字节。没有真实供应商请求、目标数据库迁移或部署；这些本地测试不证明真实付费或成片 E2E。

## 自动成片编导准备职责拆分验收点（2026-10-23）

- 代码提交 `10efc066f7eb86a5aabefae89b04256467d3e6b3` 将编导方案检查点恢复、历史版本兼容封存、当前版本落库和交接快照迁至 `socialContentProductionDirectorPreparation.ts`；worker 保留配音拟合修订、渲染和交付编排。`socialContentProductionExecution.ts` 从 1,733 降至 1,633 行，架构预算同步收紧；全仓仍有 8 个历史超限文件。
- 完整自动成片工作流 HTTP/任务测试、生产图执行 7/7、拍摄方案执行、编导版本与检查点 6/6、TypeScript、架构扫描/ratchet、192 项迁移文件只读检查、生产构建和 `git diff --check` 通过。`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行真实供应商请求、生产迁移或部署；代码验证不等于真实成片 E2E。

## Studio 素材逐镜规则拆分验收点（2026-10-23）

- 代码提交 `28d84e481fe3975442fd7b71cc24cb0f68cd2c16` 将素材逐镜投影类型与纯规则移到 `studioMaterialAnalysisSegments.ts`；`studio.ts` 保留原公开导出、供应商选择、租户读写和 HTTP 编排，从 10,855 降到 10,768 行，历史预算随之收紧。剩余超限文件仍为 8 个，不能称为全仓结构拆分完成。
- 新增规则测试 3/3、完整 `test:studio-media`、TypeScript、架构扫描/ratchet、192 项迁移仓库只读检查、生产构建与 `git diff --check` 通过。`AiCreateStudio` chunk 为 497,209/500,000 字节；未进行真实供应商请求、生产迁移或部署。当前分支和工作区状态须在推送后按 Git 命令复核。

## LinkedIn 逐 run 批准记录验收点（2026-10-23）

- 集成分支提交 `5ccc1ff8134468073e7f4d4c1427791b99e6eaf4` 已普通推送并复核本地/远端一致，工作区在该提交后干净。新增私有、不可更新的 LinkedIn 公司帖逐 run 批准和撤销记录，绑定当前发现范围、租户公司账号、Actor 输入摘要及 CNY 上限；**记录不是付费许可**，没有生产签发器，真实 Actor 入口仍关闭。
- LinkedIn 离线定向测试 7/7、TypeScript、生产构建、架构扫描/ratchet、192 项迁移仓库只读检查和 `git diff --check` 通过。迁移文件尚未在目标库执行或做实际升级演练；未做真实付费请求、部署或发布。后续仍需费用覆盖证据、唯一付费认领、原始回执与结果不明恢复。

## 当前权威源码检出（2026-10-22 复核）

- 集成分支：`xixi1021程永罗沟通前大整合`；独立本地检出：`/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`。此文档不把会随提交变化的 SHA 写成永久“当前 HEAD”；交接时必须以 `git rev-parse HEAD`、`git status --porcelain` 和 `git ls-remote` 核对本地、远端和工作区状态。
- 图片准入代码验收点 `eae873e78d4894bb001e210362a881c008447d77` 与客服回复结构治理验收点 `be8a7d1ff9abb8efcbbd7487eaa473d25122e7c7` 是历史批次；当时有 10 个历史超限文件，随后企业资料页面退出清单，当前仍有 8 个。运行数据、真实供应商 Ready 和发布状态均未由这些代码验收。
- 原 `/Users/julia1/.codex/worktrees/xixi1021-full-integration` 现为独立广告功能分支 `feature/platform-ads-meta-workspace-20261022`，不再是本分支检出。当前 11 树分类和图片 AIGC 来源见 [`WORKTREE-INVENTORY.md`](./WORKTREE-INVENTORY.md)。其他未提交来源与被忽略业务数据仍保留；未做真实付费供应商调用、生产迁移或部署。
- 在 `ed83980d` 代码点位后重新只读盘点 11 树：6 个来源树有未提交项，4 个非集成树 Git 状态干净但含有业务/审计数据或独有图片补丁，没有新增可安全归档候选。图片分支 `23b1bb93` 剩余自动 GPT 路由不等价于现行 Gemini 降级和付费门禁，未直接合入；详见工作树清单。
- 下方“阶段二集成基线”保留的是当时的合并节点，不是当前 HEAD 或当前本地路径。仍待解决的产品/架构差异按各批记录分别判断，不能以门禁通过或历史文档标题推定全部完成。800 行是普通文件复杂度门禁；历史例外按职责边界治理并只降不增，不为压线机械切分。

## LinkedIn 公司帖付费采集的受限接线（2026-10-23）

- 从干净集成点 `894fd1188f14f2202b6cc66ac102b8ce993f37fb` 出发，为内部图文/视频采集增加规范公司主页、冻结 Actor 输入、租户/run/窗口与许可摘要绑定，复用异步 Apify 运行 ID、结果不明禁重发和独立数据集读取许可的传输边界。手工 HTTP 入口仍拒绝 LinkedIn；现无耐久批准和成本凭据签发器，普通发现 worker 仍拿不到许可，不声称付费入口已正式开放。用户选择保留的 Qwen→Gemini 自动降级没有改动。
- 将 TikTok Actor 输入纯组装移至 `apifyTikTokInput.ts` 并保留原导出；`videos.ts` 从 10,189 行降至 10,186 行，架构预算同步收紧，历史超限文件仍为 8 项。视频路径在任何租户存储读取之前预检 LinkedIn 许可，提交前再次核验。验证和最终远端点位以本批交接复核为准；未调用真实付费 Actor、执行迁移或部署。
- LinkedIn/Apify 离线定向回归 20/20、视频来源边界 35/35、TypeScript、架构扫描/ratchet、191 项迁移仓库只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 仍为 497,209/500,000 字节。以上不证明生产账号费用、跨实例唯一认领或真实供应商回执已经验收。

## 非渲染代拍执行边界拆分（2026-10-23）

- 从干净集成点 `7f74d468bb1c54ad95d8046f9cf6f50fd18b5d98` 出发，将逐镜代拍工件创建和执行完成状态迁至 `socialContentShootingPlanExecution.ts`。worker 保留原有前置审核、幂等工件查找及渲染前早退位置；新模块不接入付费供应商、渲染工作区或视频发布终结器。`socialContentProductionExecution.ts` 由 1,787 降至 1,733 行，历史预算同步收紧；仍有 8 个历史超限文件。
- 本批是职责边界拆分，不代表完整架构债务或真实供应商链路完成。验证结果和远端状态以本批提交后的交接核验为准；未执行真实付费调用、生产迁移或部署。

## LinkedIn 未授权采集显式失败边界（2026-10-22）

- `fa28472f` 的 LinkedIn 企业帖子付费 Actor 尚未纳入当前逐任务批准、预算认领、提交回执和结果不明恢复链。视频与图文内部采集入口现于任何供应商请求或租户记录操作前明确报 `linkedin_company_paid_collection_permit_required`；外部手工爬取 HTTP 入口仍不开放 LinkedIn。原有离线 URL/帖子解析保留，不能据此称为功能已合入。Apify 候选窗口纯规则迁至 `videoCrawlerNormalization.ts`，`videos.ts` 保留兼容导出并从 10,255 降至 10,252 行；历史超限仍有 8 项。
- LinkedIn 来源边界 34/34、相关采集合同 3/3、TypeScript、架构扫描/ratchet、191 项迁移文件只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。没有真实供应商调用、目标库检查、浏览器验收、生产迁移或部署。Qwen 失败后的现有 Gemini 降级按用户选择暂时保留，仍是独立的付费治理缺口。

## 视频供应商元数据与 URL 归一化拆分（2026-10-22）

- 将 TikTok/YouTube 规范 URL、TikTok 视频 ID/账号识别归入 `videoCrawlerSourceUrls.ts`；上传者、创作者账号、标题和通用社媒标题判断归入 `videoCrawlerNormalization.ts`。`videos.ts` 保留采集编排和元数据消费，从 10,252 降至 10,189 行，预算同步收紧；两个纯模块不新增供应商请求。另增规范来源/创作者离线回归，仍有 8 项历史超限文件。
- 视频/图文来源边界测试 35/35、采集合同 3/3、TypeScript、架构扫描/ratchet 与生产构建通过；远端状态以推送后核验为准。`AiCreateStudio` chunk 仍为 497,209/500,000 字节，不将离线拆分视为完整架构治理或 LinkedIn 付费采集开放。

## Studio 封面 SVG 渲染职责拆分（2026-10-22）

- 将封面尺寸、标题排版、预设图层和 SVG 渲染迁至不接触存储/供应商的 `studioCoverSvg.ts`；`studio.ts` 继续负责 HTTP、租户限定的帧读取和持久化，从 11,292 降至 11,183 行，历史预算同步收紧。请求体颜色限定为十六进制值，非法值回退白色，避免 SVG 属性注入。新增尺寸、标题转义、底图、六种预设及颜色注入的纯渲染测试 3/3；Studio 媒体权限检查通过。仍有 8 项历史超限文件，本批不改变真实生成或发布能力。
- 完整 `test:studio-media`、TypeScript、架构扫描/ratchet、191 项迁移文件只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 仍为 497,209/500,000 字节。远端状态以推送后复核为准；未执行真实付费调用、生产迁移或部署。

## Studio 语音选择纯规则拆分（2026-10-22）

- 从干净集成点 `d226181de12a8a834dff16e9edf19b4ce535ae0e` 出发，将配音风格归一化、MiniMax 停顿/音色修饰/发音词典、Qwen/MiniMax/macOS 音色与语言映射迁至 `studioTtsStyle.ts`；路由保留供应商调用、预算许可、租户文件和响应处理。移除了无调用点的旧 `SAY_VOICE_MAP`。`studio.ts` 从 11,183 降至 10,968 行，预算同步收紧；历史超限仍有 8 项，不能据此称整体拆分完成。
- 离线语音规则 4/4、现有语音选择/付费许可回归 8/8、完整 `test:studio-media`、TypeScript、架构扫描/ratchet、191 项迁移文件只读检查、生产构建和 `git diff --check` 通过；远端状态以推送后核验为准。`AiCreateStudio` chunk 仍为 497,209/500,000 字节。未运行真实 TTS、付费供应商、生产迁移或部署。

## Studio 本地语音适配职责拆分（2026-10-23）

- 从干净集成点 `433e754334c3c171eca8db85d91ddf3b5bb9c49b` 出发，将 Piper、XTTS 和 macOS `say` 的本地进程执行及配置规则迁至 `studioLocalTtsAdapters.ts`；路由通过端口提供租户限定目录、语音样本查找、资产 URL 和 FFmpeg 转码。未配置本地引擎时不访问租户样本/目录或启动进程；Qwen/MiniMax/HeyGen 的原付费调用和许可代码未动。`studio.ts` 从 10,968 降至 10,855 行，预算同步收紧，仍有 8 项历史超限文件。
- 本地无引擎离线测试 1/1、完整 `test:studio-media`、语音选择/付费许可回归 8/8、TypeScript、架构扫描/ratchet、191 项迁移文件只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 仍为 497,209/500,000 字节。远端状态以推送后核验为准。未实际调用本地语音引擎或真实付费供应商，未执行迁移、部署。

## 图片 AIGC 当前接线复核（2026-10-22）

- 在干净集成提交 `6865f13737afc1ddb774c0af61f11f16b931309d` 上只读复核：图片 AIGC 来源提交 `6e2d2e4ffde42e8240750c950763b0b5dd2859ea` 和 `95b0bcc16820e06fcc16ac75e040a6592abdc692` 均为祖先；当前轮播/GIF 已有工作台入口、冻结单元执行和 GIF 非付费合成/交付代码。旧 ADR 中“不可选”的语句是历史阶段状态，已在 ADR 末尾追加当前状态修正，而非删除历史决策。
- `pnpm run test:social-image-pipeline` 的图片领域 55/55、隔离 HTTP 1/1、路由/工作台合同与治理工作流检查通过；`pnpm run test:social-image-gif-browser` 隔离浏览器流程通过。未调用真实付费供应商、目标 PocketBase、真实账号或部署环境；不能据此宣称目标库索引、跨实例素材路径、供应商回执对账或生产交付已验收。先前来源工作树的未提交非图片代码及其他独有分支补丁仍按工作树清单分别审阅，不随祖先关系自动合入。

## 灵小枢客户待办展示职责边界（2026-10-22）

- 代码提交 `e78b735f3b8ea4a53db3a8aa5c49174f9d052fef` 将既有“今日待办”列表及状态样式移至 `AssistantCustomerTodoView.tsx`；`GlobalAssistant.tsx` 仍负责客户选择事件、返回对话和身份/导航状态。展示文案、排序输入与视觉样式未改变。父文件从 2,560 降至 2,496 行，历史预算同步收紧；全仓仍有 8 个历史超限文件。
- 新组件渲染与父页面接线定向测试 5/5、更新后的 `test:assistant-production` 34/34、TypeScript、架构扫描/ratchet、191 项迁移文件只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 仍为 497,209/500,000 字节。此批未做登录后浏览器交互、真实客服发送、真实供应商调用、生产迁移或部署，不能据此宣称整体架构拆分完成。

## 图文延迟分析的前端待核对状态（2026-10-22）

- 代码提交 `70b3842faaeb794bddf8539d1e23a9a99c262172` 在灵感卡片、详情和创作准入中区分 `queued`、`processing`、`unknown`；持有这些状态的记录不再显示重分析入口或旧证据的“已完成”标签，结果不明提示先核对任务与费用。详情状态文案投影迁入 `inspirationAnalysisProjection.ts`，队列文案与禁重提判断在 `imagePostAnalysisPresentation.ts`；`InspirationDashboard.tsx` 从 3,173 降至 3,163 行，历史预算同步收紧，仍有 8 个历史超限文件。
- 图片来源及前端合同回归 33/33、TypeScript、架构扫描/ratchet、生产构建与 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。没有真实账号浏览器验收，也没有真实供应商或部署操作。前端停用重试只是对服务端拒绝的可见投影，不替代持久化付费许可、人工核对入口或原始供应商回执。

## 延迟图文分析持久队列与媒体职责边界（2026-10-22）

- 代码提交 `8231df79a368c26cb0011b2cd075f73a0541920d` 将缩略图/COS 图片来源持久化迁至 `imagePostMediaPersistence.ts`，将原进程内延迟分析改为 `imagePostAnalysisQueue.ts` 的持久排队与后台领取。采集结果和来源哈希先写入记录，租约能力无法证明时不调用模型；已开始但未写回的尝试不自动重放，异常保持待核对状态。来源变化时不写回旧结果；同记录的刷新和显式重分析会拒绝排队中、处理中或结果不明的任务。`videos.ts` 从 10,270 降至 10,255 行并收紧预算，仍有 8 个历史超限文件。
- 图片来源边界测试 26/26、相关爬取路由合同 4/4、TypeScript、架构扫描/ratchet、191 项迁移文件只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未执行真实供应商调用、远端 PocketBase 租约验证、生产迁移、浏览器验收或部署。
- 按本次明确选择，现有 Qwen 失败后自动调用 Gemini 的行为暂时保留。该链路仍无逐记录付费许可和原始供应商回执；同步分析及显式重分析也尚未并入统一付费边界，`unknown` 缺少人工核对/恢复入口。此批只能称为延迟执行与结构职责治理，不能称为图片付费治理或全仓架构治理完成。

## 显式图文重分析尝试与写回边界（2026-10-22）

- 代码提交 `f4026a9fb8c4842b31688a5d6d09e79d88015d21` 将显式重分析组装和写回迁至 `server/socialDiscovery/imagePostReanalysis.ts`：先持久化 `pending` 尝试，再调用现有分析器；写回前校验租户、尝试 ID 和来源快照，写入失败不返回成功。路由保留鉴权和 HTTP 响应。`videos.ts` 从 10,279 降至 10,270 行；仍有 8 个历史超限文件。
- 图片来源测试 18/18、相关采集路由 4/4、TypeScript、架构扫描/ratchet、191 项迁移仓库只读检查、生产构建及 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未进行真实供应商、浏览器、部署或生产迁移验收。
- 尝试 ID 只用于防止明显的过期结果写回，不是原子付费许可或供应商回执。并发重复请求、崩溃后的结果不明、延迟任务的进程内执行、旧 Gemini 自动降级和 GPT 复核接线仍未收口；不能据此宣称图片付费链完成。

## 既有图文刷新先写来源（2026-10-22）

- 代码提交 `07f07159b218f6f32780a7ed7f3d10377245b675` 将既有图文刷新迁至 `server/socialDiscovery/imagePostRefresh.ts`，先保存新来源与 `pending` 状态，写入确认后才调用现有视觉分析或排入延迟队列；持久化失败不进入分析。已有分析的延迟采集仍按旧选择同步分析。`videos.ts` 从 10,322 降至 10,279 行，8 个历史超限文件仍需继续拆分。
- 来源边界 14/14、相关采集路由 4/4、TypeScript、架构扫描/ratchet、191 项迁移只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。未运行真实供应商、浏览器交互、生产迁移或部署。
- 显式重分析与延迟任务实际执行尚未迁入共用的逐记录批准/恢复边界；GPT 复核没有路由接线，旧 Gemini 自动降级也未纳入新付费许可。此批不能视为整个图片付费治理完成。

## 新增图文先落库的分析前置边界（2026-10-22）

- 代码提交 `3a1e428f1edf61a253ecff3b5cb12df575f629b2` 将新增图文导入迁至 `server/socialDiscovery/imagePostImport.ts`：先创建租户记录，再保存图片来源并确认写入，之后才运行现有视觉分析或排入延迟队列。来源写入失败时不会启动分析；分析失败状态仍持久化。`videos.ts` 从 10,375 降至 10,322 行并收紧历史预算；8 个超限文件仍在清单。
- 来源边界测试 11/11、相关采集路由测试 4/4、TypeScript、架构扫描/ratchet、191 项迁移仓库只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` chunk 为 497,209/500,000 字节。这些仅是代码级验收，未做浏览器或真实供应商联调。
- 此批不改变既有记录刷新、显式重分析、旧 Gemini 自动降级，也未接入 GPT 图片复核。逐记录人工批准、可信多模态计量/报价、统一冻结快照及结果不明恢复仍未闭环，不能称为图片付费治理完成。未执行部署或生产迁移；远端和工作区状态以推送后的 Git 核对为准。

## 图片爬取分析与延迟写回职责边界（2026-10-22）

- 代码提交 `d7f9a4ce` 将公开图片读取、Qwen 主分析、现有 Gemini 降级和延迟分析写回迁至 `server/socialDiscovery/imagePostEvidenceAnalysis.ts`；`videos.ts` 继续持有租户鉴权、采集、记录创建与图片 URL 准入。旧函数调用点与写回状态保持，未接入 GPT 复核或新增付费请求。`videos.ts` 从 10,486 降至 10,375 行，历史预算同步收紧；全仓仍有 8 个历史超限文件。
- `test:video-source-boundaries` 8/8、图片采集相关路由合同/回退 4/4、TypeScript、架构扫描/ratchet、191 项迁移仓库只读检查、生产构建与 `git diff --check` 通过。`AiCreateStudio` chunk 为 497,209/500,000 字节。未做登录后浏览器、真实供应商、生产迁移或部署验收。
- 现有 Gemini 自动降级依然不受新的逐记录预算许可约束；新记录仍在视觉分析后落库。下一步须将新记录先落库，建立持久人工批准、可信 OpenAI 计量/报价和统一恢复边界，再处理旧降级与 GPT 接线。此批不可被视为图片 AIGC 全链路或付费治理完成。

## 图片证据逐记录付费预留与回执恢复（2026-10-22）

- 代码提交 `526a70e7` 为 GPT 图片证据复核增加按租户、记录 ID、源快照和完整请求哈希绑定的付费上下文，复用现有可信报价/整计划预留/共享卷一次性许可，并在发送前核对实际端点与密钥指纹；原始 HTTP 响应以不可覆盖的身份绑定文件持久化，可在新上下文中只读恢复。`trend_videos` 的远端 PocketBase 路径无可证明的原子 CAS，未把普通更新当成付费唯一认领。
- 直接模拟测试 7/7 通过，覆盖无批准/报价/共享卷、错误账号、跨租户/快照/请求绑定、重复提交、跨上下文回执读取和记录中途变化；TypeScript、架构扫描与 ratchet、191 项迁移仓库只读检查、生产构建及 `git diff --check` 通过。历史超限文件仍有 8 个，`AiCreateStudio` chunk 为 497,209/500,000 字节。
- 该上下文尚未接入爬取或重分析路由；仍需持久人工批准记录、可信 OpenAI 多模态输入计量与账号报价、爬取先落库、真实部署共享卷证明及路由级并发/租户/崩溃回归。未调用真实供应商、执行生产迁移或部署，不构成自动 GPT 回退可用性验收。

## 图片证据 GPT 复核付费边界（2026-10-22）

- 代码提交 `60b8989143ccece875f740bc0a788429f7a18649` 合入 Qwen 图片证据的纯复核信号及 OpenAI 图片复核适配器。适配器要求可信计划冻结完整请求哈希与模型、测量多模态输入上界、在网络前持久认领预算，并先存原始回执后解析；绑定不符或无许可时不发送请求。原来源分支“Qwen 失败即自动调用 GPT”的路由接线**没有**合入，当前路由不会调用该适配器。
- 直接测试覆盖绑定拒绝、预算许可拒绝、成功回执顺序、传输异常保持结果不明和无效响应的回执保留；TypeScript、架构扫描/ratchet、191 项迁移清单只读检查、生产构建与 `git diff --check` 通过。`AiCreateStudio` chunk 为 497,209/500,000 字节，历史超限文件仍有 8 个。未做真实供应商调用、迁移执行、部署或登录后 E2E。
- 下一步仍需为图片记录建立逐记录授权、可信报价与预留、回执读回及结果不明恢复，再调整爬取/重分析顺序并接线路由；当前提交不构成这条付费链路的可用性或 AIGC 全功能合入证据。最终本地/远端 SHA 和工作区状态应以推送后的 Git 命令核对。

## 灵小枢外部决策弹窗结构边界（2026-10-22）

- 将权威待办详情与普通任务详情共用的 Ant Modal 视图迁至 `AssistantDecisionDialog.tsx`；`GlobalAssistant.tsx` 保留对话、真实动作执行、身份栅栏、关闭与导航焦点恢复。弹窗仍接收当前周目标，未把决策详情放回 420px 对话面板，也未修改后端审批版本门禁。
- 主组件由 2,692 降至 2,560 行，历史预算同步收紧；新弹窗组件 185 行。助手完整回归、周计划/决策反馈 69/69、TypeScript、架构扫描/ratchet、生产构建及 191 项迁移只读检查通过；仍有 8 个历史超限文件，`AiCreateStudio` 主 chunk 为 497,209/500,000 字节。未做真实发送、付费供应商调用、迁移执行或部署；源码验证不等于登录后交互验收。

## 分镜 AIGC 保存夹具与 CAS 回归修复（2026-10-22）

- 上批 `test:storyboard-aigc` 的 409/200 失败来自端到端测试夹具只模拟 `store.getById`、`store.update`，没有模拟现行原子 `compareAndSwap`；项目保存因此落到真实存储实现而返回版本冲突。仅补齐测试夹具的字段比较、拒绝不匹配版本与原子写入行为，没有回退生产 CAS 或放宽草稿保存门禁。
- 修复后六种 AIGC 镜头和自动业务桥接的模拟端到端测试、分镜 AIGC 全套 66/66、独立项目 CAS 冲突保护 4/4、TypeScript、架构扫描/ratchet、191 项迁移清单只读检查和生产构建通过，Studio 主 chunk 为 497,209/500,000 字节。此处的供应商响应均为测试 mock，不代表真实供应商验收；本批没有真实付费调用、部署或迁移执行。

## 制作工作台分镜素材匹配边界（2026-10-22）

- 将本地素材候选排序、画幅偏好、逐片段证据、视觉语义评价与自动分配规则移入 `studioStoryboardMaterialMatching.ts`；原组件继续持有项目状态、素材请求、人工确认与旧导出入口。没有改变供应商调用、任务写入或证据门禁：时长、画幅和素材标签不能单独证明目标动作在剪辑点可见。
- `AiCreateStudio.tsx` 从 13,263 降至 12,896 行，历史预算同步收紧；新规则模块 381 行。仍有 8 个历史超限文件。素材匹配直接回归、完整 Studio 媒体链、交付链、TypeScript、架构扫描/ratchet、191 项迁移只读检查和生产构建通过；主 chunk 为 497,209/500,000 字节，余量仍很小。
- 更宽的 `test:storyboard-aigc` 为 65/66，通过项包含前端工作台合同；唯一失败在未修改的服务端 `studioStoryboardAigcE2e.test.ts` 第 463 行，`free-product adopt` 收到项目版本冲突 409 而非预期 200。单独复跑同样失败。本批只改前端匹配规则、架构预算与文档，没有改服务端路由、存储或测试；该套件不能记为全绿。未进行真实供应商、生产迁移或部署验收；提交、远端与工作区状态须在本批操作后分别复核。

## 制作工作台口播与译文规则边界（2026-10-22）

- 将时间码解析、分镜台词抽取、非语音音效过滤、原片句级时间线覆盖及译文对齐纯规则迁至 `studioVoiceoverRules.ts`。工作台继续持有脚本草稿、供应商请求和原公开导出；没有改动配音、翻译供应商调用或提交时机。冻结回归改为直接读取规则模块。
- `AiCreateStudio.tsx` 从 13,577 降至 13,263 行并收紧历史预算；**8 个历史文件仍超限**。口播冻结、脚本清洗、译文恢复、完整 Studio 媒体链、交付链、TypeScript、架构扫描/ratchet、191 项迁移清单只读检查、生产构建及 `git diff --check` 通过；`AiCreateStudio` 主 chunk 为 497163/500000 字节，接近上限的问题仍在。未进行真实供应商、生产迁移或部署验收；提交、远端与工作区状态须在本批操作后分别复核。

## 数字员工今日关注面板边界（2026-10-22）

- 将当前首页实际挂载的“本周进度/需要你处理”视图迁至 `DigitalEmployeeTodayFocusPanel.tsx`，保留草稿计划、待审批、阻塞任务、至多三项关注动作和页面原有状态文案。旧业务流转图虽未挂载，现有页面合同仍要求保留其内容，本批没有把它当作已批准的死代码删除。
- `DigitalEmployeePage.tsx` 从 5,062 降至 4,943 行并收紧历史预算；**8 个历史文件仍超限**。新面板及既有页面合同、生产入口 27/27、TypeScript、架构扫描/ratchet、191 项迁移清单只读检查、生产构建和 `git diff --check` 通过；`AiCreateStudio` 主 chunk 为 497117/500000 字节。未进行真实供应商、生产迁移或部署验收；提交、远端与工作区状态须在本批操作后分别复核。

## 数字员工新周目标草稿边界（2026-10-22）

- 从 `DigitalEmployeePage.tsx` 抽出周目标草稿、B2B 方案预设、制作平台选择、视频计划校验和确认排期到 `WeeklyGoalPanel.tsx`，共享字段视图迁至 `DigitalEmployeeFormField.tsx`。原页面继续负责 `createWeeklyOutline` 提交、冲突恢复与运行导航；新面板不触发服务端写入。周目标 UI 与准入规则未作产品变更。
- 主页面从 5,446 降至 5,062 行并收紧历史预算；**8 个历史文件仍超限**。新面板直接合同及既有数字员工页面合同、生产入口 26/26、周任务启动反馈 69/69、TypeScript、架构扫描/ratchet、191 项迁移清单只读检查、生产构建及 `git diff --check` 通过；`AiCreateStudio` 主 chunk 为 497117/500000 字节。未进行真实发布、供应商、生产迁移或部署验收；提交、远端及工作区须在本批操作后分别复核。

## 灵感媒体访问与卡片依赖边界（2026-10-22）

- 将缩略图、鉴权图片和视频播放器从 `InspirationDashboard.tsx` 迁至 `InspirationMedia.tsx`；视频卡直接引用媒体模块与发现投影，解除对整页的反向依赖。保留旧页面公开导出、原签名图片直载/受保护媒体鉴权、视频地址解析超时与一次重试、媒体比例回报和失败状态，不改变 UI 文案或外部接口。
- 灵感主文件从 3,387 降至 3,173 行，历史预算同步收紧；**8 个历史文件仍超限**。媒体合同、灵感预览/数据质量/响应测试、完整社媒前端链、TypeScript、架构扫描/ratchet、191 项迁移清单只读检查、生产构建及 `git diff --check` 通过；`AiCreateStudio` 主 chunk 为 497117/500000 字节。未进行真实供应商、生产迁移或部署验收；本批提交与远端状态须在操作后分别核验。

## 灵感原参考编导复核工作区边界（2026-10-22）

- 从 `InspirationDashboard.tsx` 抽出可达的六段结构、逐镜候选、开场钩子、人工口播校时与句级 ASR 显式确认工作区到 `DirectorReviewWorkspace.tsx`。保留原视频/首帧鉴权媒体组件、旧公开函数转发、登录身份栅栏、只读候选查询与供应商结果不明禁自动重提；页面继续负责打开选中原参考和预览。没有新增供应商调用或更改服务端接口。
- 主文件从 3,617 降至 3,387 行，历史预算同步收紧；其他 7 项未改，**8 个历史文件仍超限**。既有复核纯规则及预览合同、新工作区接线/付费边界合同、完整社媒前端测试链、TypeScript、架构扫描/ratchet、191 项迁移清单只读检查及生产构建通过；构建的 `AiCreateStudio` 主 chunk 为 497117/500000 字节。没有运行真实供应商、生产迁移或部署；提交和远端状态须在本批操作后单独核验。

## 灵小枢线程保存队列边界（2026-10-22）


- 从 `GlobalAssistant.tsx` 抽出串行线程保存队列至 `useAssistantThreadSaveQueue.ts`：保留原版本前置条件、409 合并、最新本地快照重排、有限退避、固定认证头、身份栅栏、可中断请求及受限 keepalive。浮层仍决定页面离开/重连触发和登录范围失效，不改变 HTTP 接口或保存时机。
- 主文件从 2,814 降至 2,692 行，历史预算同步收紧；其余 7 个历史超限文件不受本批影响，**8 个仍在超限清单中**。直接行为测试覆盖同一线程串行保存、后续请求继承新版本与最新输入、409 合并不追加旧会话；原灵小枢合同检查迁至实际实现文件并验证页面接线。完整 `test:assistant`、TypeScript、架构扫描/ratchet、191 项迁移清单只读检查、生产构建及 `git diff --check` 通过。上批 `qwen.ts` 多出的一处空行已消除，恢复普通文件 800 行上限，没有新增预算豁免。未进行真实外部供应商或部署验收；最终 SHA 以本批提交后复核为准。

## 图片图层蓝图安全合入（2026-10-22）

- 从干净图片模块来源提交 `23b1bb93f18d0780b2cc668d7e3057531ab17789` 选择性合入 Qwen 参考图的归一化图层/蒙版证据、灵感页到图片工作台的蓝图传递、持久化任务的创建与更新规范化、确定性图层及 GIF 固定层合成。原图片 AIGC 分支 `6e2d2e4f` 已在集成历史中，不重复合并；来源提交未整体等价合入。
- 对蒙版与产品的前景重叠保持 12% 上限，不因存在蒙版而豁免；更新入口重新规范化不可信颜色、坐标、透明度和层级，合成入口也核对遮挡。`InspirationDashboard.tsx` 的可达图片证据展示抽到独立组件，历史超限预算由 3,626 降至 3,617 行；全仓仍有 8 个超限文件。
- 来源提交的 Qwen 失败后自动转 GPT 图片分析未合入：原实现会直接发起另一笔可能付费的调用，却没有持久化许可、预算认领、回执与未知结果恢复。该功能须另立安全任务，不能通过静默重试补上。本批图片专项 55/55、社媒前端链、Qwen 归一化与蒙版遮挡直接测试、TypeScript、生产构建、架构扫描/ratchet 和 191 项迁移只读检查通过；仍未执行真实供应商调用、浏览器 E2E、部署或生产迁移。最终 SHA 以提交后复核为准。

## 生产入口合同与预算重报价一致性（2026-10-22）

- 以干净集成提交 `b046ef6bf0c0881fff6e82b82b22664457852907` 为起点，修复历史重报价路由对 `STORYBOARD_AIGC_BATCH_BUDGET_CNY` 的精确内部测试租户豁免缺口，使其与现行周计划开工入口一致。豁免仅针对已配置的完整租户 ID 与安装级批次上限，不改变真实供应商余额、租户鉴权或其他付费门禁。源码合同改为检查已拆出的任务证据模块；数字员工页面合同改为沿 `AppPageSlot`、共享 `LsCalendar`、数据复盘组件、企业资料合同/存储及深链接模块检查同一行为约束，保留原安全与业务断言。`test:production-entry` 从此前 23/25 恢复为 25/25，`test:weekly-start-feedback` 69/69、精确租户豁免测试 3/3；TypeScript、架构扫描/ratchet、191 项迁移仓库只读检查、生产构建及 `git diff --check` 通过。该批是代码与合同验证，不代表真实付费供应商、浏览器 E2E 或部署验收；历史超限文件仍有 8 个。

## 数字员工任务证据投影边界（2026-10-22）

- 将任务执行元数据、审批祖先、业务引用范围、工作流归属、证据状态与 Studio 完成/渲染判定从 `digitalEmployees.ts` 迁至 `taskEvidenceProjection.ts`，保留原判定顺序与路由接线。路由从 5,931 降至 5,783 行并收紧历史预算；8 个历史超限文件仍未全部拆分。新增直接测试覆盖独立助手任务隔离、可变引用不得覆盖托管项目血缘、渲染证据和待处理状态。直接测试 3/3、现有内容生产与项目血缘测试、TypeScript、架构扫描/ratchet、191 项迁移仓库只读检查、生产构建和 `git diff --check` 通过。完整 `test:production-entry` 为 23/25：既有 `route.contract.test.ts` 要求测试租户绕过批次预算上限，而当前拆出的重报价路由无此例外；既有 `DigitalEmployeePage.contract.test.ts` 仍要求旧 `AgentVideoProductionBoard` 接线，当前页面为 `LsCalendar`。两处被检查的文件在本批前的 HEAD 中已是相同状态，本批未改预算策略或 UI 来凑绿。未做真实供应商或部署验收；最终 SHA 以推送后核验为准。

## 灵小枢签名动作投影边界（2026-10-22）

- 从 `GlobalAssistant.tsx` 抽出聚焦卡自然语言动作、签名目标与参数、响应卡身份、跨对象动作过滤、通知和任务状态投影至 `assistantActionProjection.ts`；浮层保留网络请求、对话和任务卡编排。主文件从 2,969 降至 2,814 行，并收紧历史预算。新增直接测试覆盖唯一签名动作目标与原始参数、歧义动作拒绝、跨对象响应隔离；原静态合同改为检查新模块与页面接线。历史超限文件仍有 8 个，此批不代表整体架构债务收口。验证结果以本批实际命令和推送后 SHA 复核为准；未调用真实付费供应商或部署。

## 未挂载脚本侧栏清理（2026-10-22）

- 以集成提交 `95d18a1d6b05b7937e34b0720e76ea03103b04b0` 为起点，逐项核对 `ScriptPanel`/`AnalysisPanel` 的引用，确认当前选中视频只挂载 `DirectorVideoDetailPanel`，没有可到达的旧脚本/Seedance 侧栏。删除未挂载 UI、仅由其使用的阶段状态、脚本模板/产品选项及旧静态断言；保留当前详情和工作流回调类型。`InspirationDashboard.tsx` 从 4,403 降至 3,626 行，分析投影从 445 降至 333 行；历史超限文件仍有 8 个。这是死路径清理，不等于关闭当前图文/视频分析或生成链路。`pnpm run lint`、`pnpm run test:social-content-frontend`、灵感页 15 项合同测试、架构扫描与 ratchet、191 项迁移清单只读检查、`pnpm run build` 和 `git diff --check` 通过；未做真实供应商或部署验收。

## 灵感分析面板边界（2026-10-22）

- 历史提交 `95d18a1d` 曾将当时的分析侧栏拆到 `InspirationAnalysisPanel.tsx`，并通过 TypeScript、前端测试、灵感页 15 项合同测试、架构扫描与 ratchet、191 项迁移清单只读检查、生产构建和 `git diff --check`。后续引用审计发现这条侧栏本来未挂载，现已按上节清理；该历史拆分不能作为当前可达 UI 的架构成果或真实功能验收。

## 灵感素材库规则边界（2026-10-22）

- 以集成提交 `fe5a686323d1cab3f419f85a76e4453c45c4e205` 为起点，将素材标签归属、可见语义、分类、入口参数、产品和方向筛选迁至 `inspirationMaterialLibrary.ts`，权威宽高比规则下沉到 `src/lib/materialAspectRatio.ts`；保留灵感页及产品素材组件原有公开导出。`InspirationDashboard.tsx` 从 5,167 降至 4,973 行并收紧预算，未修改租户读取、付费供应商或生产任务路径。新增直接测试覆盖企业通用标签不外显、产品/方向/语义筛选和收藏素材来源关联。`pnpm run lint`、`pnpm run test:social-content-frontend`、灵感页 15 项合同测试、产品素材比例合同、架构扫描与 ratchet、191 项迁移清单只读检查、`pnpm run build` 和 `git diff --check` 通过；未做真实供应商或部署验收。

## 灵感分析投影与准入边界（2026-10-22）

- 以干净集成提交 `6618a6b6ce1ca8f4168cb4ebdfb1df32dfff50b9` 为起点，将分析文本清洗、精确分析门槛、图文展示准入、粗结构与逐镜摘要构建迁至 `inspirationAnalysisProjection.ts`，页面保留网络请求和复核交互；原页面导出继续转发。`InspirationDashboard.tsx` 从 5,520 降至 5,167 行并收紧预算，历史超限文件仍有 8 个。新增直接测试证明不确定口播不会进入已确认字幕、单镜头不构成完整视频分析；既有精确分析和图文门禁合同改为检查新模块及页面接线。`pnpm run lint`、`pnpm run test:social-content-frontend`、灵感页 15 项合同测试、架构扫描与 ratchet、191 项迁移清单只读检查、`pnpm run build` 和 `git diff --check` 通过；构建仅证明静态产物可生成，未做真实供应商或部署验收。

## 灵感发现数据投影边界（2026-10-22）

- 以干净集成提交 `da985ee69647a96e75df2bc1f1d98263bc49abde` 为起点，把爬虫记录到前端视频的投影、图片证据保留、元数据兜底、发现评分、账号基线推荐迁至 `inspirationVideoProjection.ts`。页面保留所有请求、租户上下文、排序/筛选与展示；既有页面导出转发保持兼容。`InspirationDashboard.tsx` 从 5,784 降至 5,520 行并收紧预算，历史超限文件仍有 8 个。新增直接测试覆盖图片证据、来源去重、无效平台和八条可度量账号历史的推荐门槛；完整验证以本批最终命令为准。

## 灵感逐镜素材匹配边界（2026-10-22）

- 以干净集成提交 `5c600cb96a618cda9ca67921620ee88eff9e3bb0` 为起点，将逐镜真实片段评分、产品/人物硬条件、爆款潜力与可复制性路线判定迁至 `inspirationFrameMatching.ts`，灵感页保留素材读取、展示和交互。`InspirationDashboard.tsx` 从 5,992 降至 5,784 行，历史预算同步收紧；仍有 8 个历史超限文件。新增独立测试覆盖缺失素材、待分析、产品主体不可见、旧片段字段缺失和真实性未确认。扩展回归还发现原爆款卡虽计算真实比例却强制 9:16，且媒体区存在嵌套伪按钮；已改为真实媒体比例和独立预览按钮，并恢复导入工具栏的既定布局类名。工作树复核见 [`WORKTREE-INVENTORY.md`](./WORKTREE-INVENTORY.md)；完整门禁结果以本批最终命令为准。

## 灵小枢生产准入边界（2026-10-22）

- 以干净集成提交 `15b2774ab3bf7bed85d928d15ec3a40656ee2871` 为起点，将明确生产指令的解析、格式/时长限定和企业中心产品读回校验迁至 `assistantProductionIntake.ts`。浮层仍负责原有对话、卡片与任务创建入口；未新增自动付费提交。`GlobalAssistant.tsx` 从 3,075 降至 2,969 行并收紧历史预算，8 个历史超限文件仍未全部拆分。新增直接测试核对问答不误入生产、已确认产品身份与鉴权 GET；原助手合同继续核对接线。完整验证以本批最终命令为准。

## 视频爬虫任务状态边界（2026-10-22）

- 以干净集成提交 `2de00d04f477c805abe756cc0e1259c7377b48e9` 为起点，将爬虫运维任务的纯状态规则迁至 `videoCrawlerOpsTaskState.ts`，原 `videos.ts` 的导出、文件持久化、租户可见性及执行编排保持不变。`videos.ts` 从 10,606 降至 10,486 行，历史预算同步收紧；历史超限文件仍有 8 个，尚未完成全仓拆分。
- 原 `fa28472f01d7e8b3051730f3dd075e55ddcc1f60` 的 LinkedIn 付费 Actor 路径与当前基线不等价：现有视频路由只有 LinkedIn URL/纯映射能力，不能把该来源提交视为完整合入。旧路径缺少当前所需的持久化付费许可、提交回执和未知结果恢复门禁，故本批未接入该付费调用，也未触发真实供应商。类型、构建、架构/ratchet、恢复测试和迁移只读验证以本批最终命令结果为准。

## 社媒生产执行规则边界（2026-10-22）

- 成片后参考证据与复刻评估批次以干净集成提交 `43892e74f828b97ad51401cd96d48936553464a2` 为起点，将参考视频的租户路径、活跃来源、分析回执与 SHA-256 核对及独立媒体评估迁至 `socialContentProductionReplicationEvaluation.ts`。保留原有检测顺序与 `media_evaluation` 阶段记录；新增隔离测试证明来源不符、租户或缓存路径不符、文件字节变化均不会取用缓存视频。主 worker 从 1,842 降至 1,787 行，历史预算同步收紧；仍有 8 个历史超限文件。助手生产 30/30、LangGraph 32/32、TypeScript、架构扫描/ratchet、生产构建、191 项迁移清单只读检查及 `git diff --check` 以本批最终命令为准；`AiCreateStudio` 主 chunk 为 497103/500000 字节。未调用真实供应商、生产迁移或部署。

- 素材准备后续批次以干净集成提交 `8d4c6d46a9ab17173c812933b49a25e7cff74371` 为起点，将审核后的素材执行方案、动态主持人约束、本地素材读取和旧路线重绑定证据写入迁至 `socialContentProductionMaterialPreparation.ts`。原 worker 仍负责预算报价/认领、外部供应商、生成与质量阶段；素材加载失败继续向上报错，只有既有零素材路线的非产品片段读取例外保持原样。主文件从 1,905 降至 1,842 行，预算同步收紧；仍有 8 个历史超限文件。新增任务范围素材读取与失败传播测试；助手生产 29/29、LangGraph 32/32、产品素材路由链、TypeScript、架构扫描/ratchet、生产构建、191 项迁移清单只读检查与 `git diff --check` 以本批最终命令为准；`AiCreateStudio` 主 chunk 为 497103/500000 字节。没有真实供应商调用、生产迁移或部署。

- 后续基线快照批次以干净提交 `e4e1de0129882e187781ff5efc2f0eabc02d8756` 为起点，将脚本基线的既有快照恢复、企业事实版本校验、配方/参考源兼容重建、每周账号约束和持久化迁入 `socialContentProductionScriptBaseline.ts`。worker 仍负责模板/周任务上下文、阶段写入和后续供应商编排；新模块没有另建付费路径。主文件从 2,034 行降至 1,905 行并收紧预算，历史超限文件仍为 8 项。新增恢复时旧事实快照复用、无快照且事实版本漂移拒绝的直接测试；社媒生产预算/路由定向回归 17/17、助手生产 28/28、LangGraph 32/32、TypeScript、架构扫描/ratchet、生产构建、191 项迁移清单只读检查及 `git diff --check` 以本批最终命令输出为准；构建 `AiCreateStudio` 主 chunk 为 497103/500000 字节。未调用真实供应商、生产迁移或部署。

- 以干净集成提交 `f48687d5f044f180ee879f5f803f666cea8e4950` 为起点，将动态主持人参考背景锁、素材需求与已批准本地路线重绑定移入 `socialContentProductionRouting.ts`，非渲染代拍清单投影移入 `socialContentShootingPlan.ts`。worker 保留原公开导出和调用方式；首帧确认读取、阶段推进与付费准入不变。`socialContentProductionExecution.ts` 从 2,137 行降至 2,034 行，历史预算同步收紧；两个新模块均低于 800 行。仍有 8 个历史超限文件，**本批不代表全仓拆分完成**。
- 助手交付隔离测试补齐原先缺失的 `social_programs` 前置记录，使现行内容订单准入可以接受有效任务；没有放宽生产准入。代拍/素材路线定向测试、完整助手生产回归、TypeScript、架构扫描/ratchet、生产构建、191 项迁移清单只读检查与 `git diff --check` 的结果以本批最终命令输出为准。未调用真实供应商、生产迁移或部署。提交、推送和工作区状态须在操作后分别核验。

## 企业资料页面退出历史超限清单（2026-10-22）

- 以集成分支 `021bbf21d12d101ea702d49223f09ecb08c2d3fe` 为干净起点，将服务端资料默认值合并、资料快照和读回校验分别落在 `enterpriseProfileState.ts` 与 `enterpriseProfilePersistence.ts`；加载、产品接口状态轮询、自动保存与保存后状态归入 `useEnterpriseProfileLifecycle.ts`。父页面继续持有可编辑资料和页签导航；公司与市场表单移入 `EnterpriseCompanyFactsPanel.tsx`。保存仍使用原 POST、`If-Match` 版本头和 GET 读回，产品数量/名称不符不得显示成功。
- `EnterprisePage.tsx` 从 1,050 行降至 796 行，撤销该页历史超限预算；全仓历史超限文件由 9 项降至 8 项，**不代表其他 8 项已完成拆分**。资料状态、公司表单与模拟保存回归 8/8、产品导入 35/35、完整 `test:customer-service` 链、TypeScript、架构扫描/ratchet、生产构建、191 项迁移只读检查及 `git diff --check` 通过；`AiCreateStudio` 主 chunk 为 497103/500000 字节。客服隔离测试中的 PocketBase `ECONNREFUSED` 不代表远端成功；真实账号资料加载/保存、产品接口状态、外部供应商、生产迁移和部署未在本批执行。

## 企业资料 FAQ 控制器边界（2026-10-22）

- 以集成分支 `9eeaacdaeccd8ce53f7c30e81d36eb16474d0d6d` 为干净起点，将 FAQ 草稿、分页、知识包选择、旧问答结构化与知识包导入请求统一迁入 `useEnterpriseFaq.ts`。hook 在父页面无条件挂载，切换页签保留未完成的编辑状态；资料主状态与首次加载仍由父页面持有，加载完成后将知识包目录交给 hook。连续勾选问题改用前一状态计算，避免同一事件批次覆盖选择。
- `EnterprisePage.tsx` 从 1,135 行降至 1,050 行，历史预算同步收紧；仍有 9 个历史超限文件。FAQ 渲染、状态接线和知识包选择 5/5、完整 `test:customer-service` 链、TypeScript、架构扫描/ratchet、生产构建、191 项迁移只读检查及 `git diff --check` 通过；`AiCreateStudio` 主 chunk 为 497103/500000 字节。客服隔离测试中的本地 PocketBase `ECONNREFUSED` 不代表真实服务验收；本批未调用真实客服服务、付费供应商、生产迁移或部署。

## 企业资料更多设置与报价规则视图边界（2026-10-22）

- 以集成分支 `afe4359e190c026f445ee204cb79720019b137aa` 为干净起点，将低频的经营策略、品牌与语气、Agent 学习记录、订单 CSV 导入展示移入 `EnterpriseAdditionalSettings.tsx`；将报价与业务规则、产品资质文书共用展示移入 `EnterpriseBizRulesPanel.tsx`。原 Collapse 收纳、询价转人工和内部价格不自动发送的说明保持；父页面继续持有字段变更、订单导入请求与企业资料保存。
- `EnterprisePage.tsx` 从 1,223 行降至 1,135 行，历史预算同步收紧，仍有 9 个历史超限文件。两处视图的定向渲染/接线测试 10/10、完整 `test:customer-service` 链、TypeScript、架构扫描/ratchet、生产构建及 191 项迁移只读检查通过；`AiCreateStudio` 主 chunk 为 497103/500000 字节。客服隔离测试仍有本地 PocketBase `ECONNREFUSED` 日志，不代表真实服务验收；真实订单导入、客户发送、付费供应商和部署均未执行。

## 企业产品导入复核边界（2026-10-22）

- 以集成分支 `af43973ddab09080dd563547e5bea34fcc5ed2dd` 为干净起点，产品导入复核弹窗移入 `EnterpriseProductImportReviewModal.tsx`；移除导入草稿产品时，对已归属图片和外链主图转存状态的索引重排成为 `removePendingImportedProduct` 纯函数。父页面继续持有草稿、确认状态与真实资产写入流程；确认期间禁用移除行，避免产品索引在写入中变化。原复核文案、资产归属和确认接口保持不变。
- `EnterprisePage.tsx` 从 1,241 行降至 1,223 行，预算同步收紧；仍有 9 个历史超限文件。产品导入专项 35/35（含草稿索引重排、确认中禁改行与页面接线）、TypeScript、架构扫描/ratchet、生产构建及 191 项迁移只读检查通过；`AiCreateStudio` 主 chunk 为 497103/500000 字节。本批未运行真实账号导入、外部资产上传、付费供应商或部署。

## 企业资料销售风格职责边界（2026-10-22）

- 以集成分支 `0425785446b66ef7cbb9d08e5605a1226a8deb0f` 为干净起点，将销售风格编辑规则、重新学习状态/请求和展示分别移入 `enterpriseSalesStyleModel.ts`、`useEnterpriseSalesStyle.ts`、`EnterpriseSalesStylePanel.tsx`。父页面仍持有企业资料和保存状态；学习 hook 位于页签条件之外，切换页签不会卸载学习状态。原重新学习接口、人工修正保留证据、禁用表达解析和明确删除语义保持不变。
- `EnterprisePage.tsx` 从 1,375 行降至 1,241 行，历史预算同步收紧，仍有 9 个历史超限文件，不能称为全仓架构治理完成。销售风格规则/渲染/接线 4/4、完整 `test:customer-service` 链、TypeScript、架构扫描/ratchet、生产构建及 191 项迁移只读检查通过；构建主 `AiCreateStudio` chunk 为 497103/500000 字节。客服隔离测试中的 PocketBase `ECONNREFUSED` 日志不代表真实远端验收。本批仅做离线 UI/规则与源码接线验证，未调用真实付费供应商、执行迁移或部署。

## 企业资质凭证上传结果边界（2026-10-22）

- 以集成分支 `209411cf826553f1aa3a0f873a4cd2a273bc4411` 为干净起点，修正产品资质凭证上传失败被伪装成本地“已上传凭证”的路径。上传批次现由 `enterpriseProductDocumentUpload.ts` 仅筛选带可用 URL 的确认回执，`useEnterpriseProductDocuments.ts` 持有上传中状态、部分成功合并与未确认提示；上传结果不明的文件不进入企业资料自动保存。上传中禁止在页面添加/删除产品或确认导入，以免产品索引漂移；按剩余凭证槽位提交，超额文件不发请求。成功回执可保留，失败或缺 URL 的回执不自动重试，并提示先核对服务端资产。
- `EnterprisePage.tsx` 从 1,379 行降至 1,375 行，预算同步收紧；仍有 9 个历史超限文件。产品导入、凭证结果、素材归属与深链回归 33/33，覆盖成功回执 URL 去重、超额不发请求、部分成功和缺 URL 不入库；TypeScript、架构扫描/ratchet、生产构建及 191 项迁移只读检查通过，`AiCreateStudio` 主 chunk 为 497103/500000 字节。这里没有新增服务端幂等键，**真实写入结果不明时仍须人工核对，不得直接重试**；本批没有真实上传、付费供应商调用、迁移或部署。

## 企业资料客服授权与转人工设置视图（2026-10-22）

- 以集成分支 `7e2b4994883def048d5d35f8a481be9f3e5ad1ab` 为干净起点，将 AI 参与程度、自动发送边界和转人工设置展示移入 `EnterpriseCustomerServiceSettings.tsx`。页面继续持有观察期/FAQ 数量授权判断、启用自动回复的明确确认和转人工规则持久化；共用一份自动发送范围说明。原导航提示、L4 红线文案和表单结构保持不变。
- `EnterprisePage.tsx` 从 1,531 行降至 1,379 行，历史预算同步收紧；仍有 9 个历史超限文件。新增服务端渲染与父页面接线测试 4/4，覆盖未授权降级、已授权边界、关键词/负面情绪设置与 L4 红线；完整 `test:customer-service` 链、TypeScript、架构扫描/ratchet、生产构建及 191 项迁移只读检查通过，`AiCreateStudio` 主 chunk 为 497103/500000 字节。客服回归中的 PocketBase 连接失败日志来自隔离测试的禁网/本地服务缺席，不是远端成功回执；未向真实客户发送消息、调用付费供应商或部署。

## 企业资料产品视图边界（2026-10-22）

- 以集成分支 `208de95e23365ce21d23123869aba9285177e7a8` 为干净起点，把产品事实卡、资质凭证展示、素材库深链提示与分页渲染移入 `EnterpriseProductPanel.tsx`，复用共享选项控件。父页面仍持有产品导入准备/确认、已上传回执、资料保存、产品展开状态和完整度待办导航；没有改动服务端资产写入或付费行为。原有源码位置合同已更新为分别检查父页面接线与新视图，新增空列表、深链成功/失败和凭证的服务端渲染回归。
- `EnterprisePage.tsx` 从 1,662 行降至 1,531 行，历史预算同步收紧；仍有 9 个历史超限文件。产品导入/素材归属/深链聚焦回归 29/29、FAQ 4/4、企业页/通知合同 3/3、TypeScript、架构扫描/ratchet、生产构建及 191 项迁移只读检查通过；`AiCreateStudio` 主 chunk 为 497103/500000 字节。没有真实账号上传、付费供应商、生产迁移或部署。

## 企业资料常见问答视图边界（2026-10-22）

- 以集成分支 `40ddcb163e4ea45f9be8b12c7263a257183997ce` 为干净起点，把常见问答、场景知识包、旧问答结构化预览和审批开关的展示移入 `EnterpriseFaqPanel.tsx`，共享卡片/分页控件移入 `EnterpriseFormControls.tsx`。FAQ 表单草稿、知识包选择、导入请求、分页与企业资料保存状态仍由父页面持有，切换页签不丢失待确认数据；请求路径、自动回复授权规则和原有显示文案未改。
- `EnterprisePage.tsx` 从 1,798 行降至 1,662 行，历史预算同步收紧；仍有 9 个历史超限文件。FAQ 服务端渲染与接线回归 4/4、企业页/通知定向合同 6/6、产品导入 22/22、完整 `test:customer-service` 链、TypeScript、架构扫描/ratchet、生产构建和 191 项迁移只读检查通过；`AiCreateStudio` 主 chunk 为 497103/500000 字节。客服回归中的 PocketBase 连接失败日志来自隔离测试的禁网/本地服务缺席，命令最终退出码为 0；不把它作为真实远端持久化证据。未调用真实客户、付费供应商或部署。

## 企业资料通知设置边界（2026-10-22）

- 以集成分支 `ed7556dad9c353b78cdbb0aa1b8acb33a8188ffa` 为干净起点，将通知接收人编辑、测试提醒、工作时段与夜班确认收敛到 `EnterpriseNotificationSettings.tsx`，共享表单控件移到 `EnterpriseFormControls.tsx`；页面保留企业资料状态、保存和通知设置变更接线。原通知测试接口、鉴权头、夜班确认文案及展示结构保持不变。
- `EnterprisePage.tsx` 从 1,948 行降至 1,798 行，历史预算同步收紧；仍有 9 个历史超限文件，不能把本批称为全仓拆分完成。企业页定向合同 6/6、通知交付与组件接线 3/3、产品导入 22/22、TypeScript、架构扫描/ratchet、生产构建及 191 项迁移只读检查通过；`AiCreateStudio` 主 chunk 为 497103/500000 字节。没有真实通知通道或登录后交互验收，未调用付费供应商或执行部署。

## 客户会话页面退出历史超限（2026-10-22）

- 将 `ConversionPage.tsx` 内的消息事件/渠道发送适配、客户定位与资料加载副作用、翻译/草稿/助手上下文副作用及客服状态文案分入 `customers/` 下的独立模块；页面继续持有会话状态、人工接管、发送确认和三栏 UI。页面由 1,060 降至 791 行，撤销该文件的历史超限预算；超限文件由 10 项降为 9 项，**不代表其他 9 项已拆完**。
- 新增隔离的模拟发送/请求形态、页面接线、客服文案与建议暂不处理共享键回归，并更新源位置合同；`test:conversion-boundaries` 11/11 与完整 `test:customer-service` 链通过。TypeScript、架构扫描/ratchet、生产构建、191 项迁移清单只读检查通过。测试没有向真实客户发送消息、调用付费供应商或验证登录后的生产会话；构建主 `AiCreateStudio` chunk 仍接近 500 kB 门槛。

## 企业资料归一化职责边界（2026-10-22）

- 产品导入确认边界：将已归属图片上传、外链主图转存和未归属图片上传的分阶段执行移至 `enterpriseProductImportConfirmation.ts`；页面仍控制确认、资料合并、提示与取消。失败时不合并产品，并保留阶段结果供核对；已成功的已归属图片在明确重试时复用上传回执且不重复附加到产品。`EnterprisePage.tsx` 从 1,995 降至 1,948 行，历史预算同步下调。`test:product-import` 现含 22 项解析/确认/部分失败回归并全部通过；TypeScript、架构扫描/ratchet、生产构建、191 项迁移只读检查通过。上传接口未新增幂等键，**结果不明的真实资产写入仍不能仅凭本地状态安全重试**；本批没有运行真实上传或登录后浏览器验收。
- 产品导入准备边界：将文档/表格解析后的字段映射、产品预览草稿和外链主图待转存标记迁至 `enterpriseProductImportPreparation.ts`；`EnterprisePage.tsx` 从 2,064 降至 1,995 行，历史预算同步收紧。页面继续持有导入确认、素材上传、失败状态与保存动作；准备函数不发起租户资产写入。`test:product-import` 扩充为 CSV、DOCX、解析、准备和页面合同 19 项并全部通过；TypeScript、架构扫描/ratchet、生产构建和 191 项迁移只读检查通过。仍未做真实账号产品导入浏览器验收，页面也尚未退出历史超限清单。
- 后续结构批次：将产品素材去重计数、企业事实完成度和资料补全待办移至 `enterpriseProfileCompleteness.ts`，与资料归一化、页面交互分离；`EnterprisePage.tsx` 从 2,135 降至 2,064 行，历史预算同步下调。新增主图与图片列表同资产不重复计数的断言，归一化行为测试和企业页面 9 项定向合同通过；架构扫描及相对上一远端提交的 ratchet、生产构建、191 项迁移只读检查通过。该页仍超出 800 行，后续需继续按交互职责拆分，不能据此称结构治理完成。
- 将 `EnterprisePage.tsx` 中的资料类型、选项词表、旧资料归一化和产品项补全规则迁入 `enterpriseProfileTypes.ts`、`enterpriseProfileNormalization.ts`；页面由 2,443 降至 2,135 行，历史预算同步下调，仍属超限文件。现有归一化测试补充了编辑中空白产品及旧媒体回填断言；企业资料定向合同 5/5、TypeScript、架构扫描/ratchet、生产构建、191 项迁移只读检查通过。产品文档导入合同原有 2 项失败经核对是源码位置和文案变化后的过期断言，测试已分别追踪当前 PDF 图片对象提取与租户资产上传适配层，4/4 通过；未更改导入运行逻辑。此批未更改企业资料 UI、真实供应商或运行数据。

## 图片多输出 HTTP 准入回归（2026-10-22）

- GIF 隔离浏览器验收：`pnpm run test:social-image-gif-browser` 在临时 Vite 页面与独立无头 Chrome 中，以静态任务和拦截的企业资料 API 实际选择 GIF 类型、打开四底图付费确认、取消后检查零写请求，并验证已交付 GIF 成片/合成帧在页面刷新后仍可见。该验收不使用真实账号、运行数据或供应商，不证明真实付费生成和生产环境端到端交付；登录后实链路仍需独立授权与验收。
- GIF 工作台接线 `e0f2caeb`：GIF 现在可在图片工作台选择，首次底图付费请求前显示 4 单元与质量选择确认；取消不提交底图。轮播和 GIF 共用逐单元顺序执行器，刷新后保留已存单元，结果不明停止、不自动重试；底图齐备后才调用不付费的 `/finalize-gif`，预检后优先展示/下载最终 GIF，并提供合成帧查看入口。修订了媒体加载状态和架构摘要。图片领域 50 项、HTTP/工作台源码合同、TypeScript、架构扫描/ratchet、生产构建、191 项迁移只读检查通过。**未做登录后浏览器交互、真实付费供应商或真实账号 GIF 交付验收**；源码可选不等于生产就绪，发布授权仍另行确认。
- GIF 背景底图付费准入代码 `6291d926`：Studio 路由现在允许**已冻结计划**的 GIF 单元使用与轮播相同的原子认领、逐单元回执和异常结果阻断；服务端输入只送背景意图与可选结构对标，不送企业产品图片、素材和海报文字。认领前重读企业产品字节并与计划哈希比对，变更则 HTTP 409，未调用供应商。通用海报提示词与 GIF 背景提示词、产品校验迁至图片领域模块，`studio.ts` 维持 11292 行的历史预算。图片领域 49 项、HTTP 拒绝/离线交付回归、路由合同、TypeScript、架构扫描/ratchet 和生产构建通过；迁移清单仍为 191 项只读通过。**未**真实提交任何付费单元、验证供应商回执或打开工作台 GIF 选项，不能称为真实 GIF 生产验收。
- HTTP 收口与冻结输入回归 `1ccb99b9`：临时本地数据与对象存储中的产品、四张已登记背景底图经真实 `/plan-units`、`/finalize-gif` 路由完成产品哈希冻结、四张合成帧和单份 GIF 登记；重复请求不新增成片，产品字节被替换时拒绝。冻结计划存在期间，通用任务更新即使所有付费单元已完成也不能改写生成输入；须显式撤销计划并核对回执。图片专项 47 项领域测试与 HTTP 成功/拒绝回归、TypeScript、架构扫描及 ratchet、生产构建、191 项迁移只读检查通过。测试只使用模拟已付费底图，**不**证明真实供应商生成、浏览器操作或 GIF 付费入口开放。
- 后续 GIF 离线收口代码提交 `ec02d344`：服务端可将**已逐单元持久化**、至少两张不同的付费背景底图与冻结的企业产品素材合成固定图层画面，再编码单份 GIF 成片；冻结计划同时记录产品字节哈希。合成帧、最终 GIF 和原始底图在任务契约中分开，客户不可通过通用 PATCH 伪造交付关联。素材以租户、任务计划和稳定键登记，重试同一键若字节不一致则拒绝；不重发付费请求。图片专项 47 项领域测试及 HTTP 拒绝/防伪回归、TypeScript、架构扫描与 ratchet、生产构建、191 项迁移只读检查通过。该批未做真实 HTTP 成功链路、浏览器验收或付费供应商调用；GIF 付费入口和前端可用性仍关闭，因此**不能称 GIF 全链路可交付**。
- 结构批次 `83a28213` 将 Studio 路由内的生成图片素材写入、租户路径、对象存储和素材库登记抽为 `generatedImageMaterial.ts`，供单图与后续非付费 GIF 合成复用；PNG/GIF 使用临时隔离素材目录验证了字节、哈希、租户归属与记录一致性。`studio.ts` 由 11361 降至 11292 行并下调历史预算；这只是持久化职责边界，**尚未**把逐单元 GIF 底图与最终成片接通。图片专项 45 项、Studio 工作流与媒体回归、TypeScript、架构扫描与 ratchet、生产构建、191 项迁移只读检查通过；未调用真实供应商或部署。
- 安全补丁 `add581a2`：通用图片任务 PATCH 不再接受浏览器新增成片、伪造 `approved` 状态或改写质检/素材证据；仅允许现有输出保持原样或降为 `repair_required`，维持工作台的显式精修入口。真实 HTTP 回归覆盖伪造拒绝和合法降级。图片专项、TypeScript、架构扫描与 ratchet、生产构建、191 项迁移只读检查通过；未调用真实供应商或部署。
- 代码提交 `eae873e7` 将隔离的真实 HTTP 路由测试加入 `test:social-image-pipeline`：GIF 任务在供应商前返回 `social_image_gif_delivery_not_ready`，未冻结的轮播单元返回 `social_image_frozen_plan_invalid`。测试使用临时本地数据目录并在结束时清理，不发起供应商请求。
- 图片管线 44 项领域测试、新 HTTP 测试、现有路由源码合同、TypeScript、架构扫描与 ratchet 测试、生产构建、191 项迁移清单只读检查和 `git diff --check` 通过；主 Studio chunk 为 497103/500000 字节。此验收只证明拒绝路径，**不证明**轮播付费生成的 HTTP 全流程、GIF 合成交付、浏览器交互或真实供应商就绪；这些仍待完成。
- AIGC 来源 `95b0bcc` 已是集成祖先，但来源版本的 `/fb-poster/render` 在一次 HTTP 请求中循环发起多个图片供应商调用，再统一回写一个任务；中断时无法逐单元恢复。当前基线改为冻结计划和逐单元认领，轮播服务端已部分接线，GIF 仍明确关闭。恢复 GIF 不能直接拷回来源旧循环；需按冻结单元分别生成、回执恢复，再从已持久化底图合成固定图层与最终 GIF，并独立验证交付身份。

## WhatsApp 历史与入站处理边界退出超限清单（2026-10-22）

- 以集成提交 `1582684eb31d92af4012cdb67a0aa280493bb979` 为起点，按数据职责拆出历史去重/快照与 PocketBase 镜像持久化、客户夜间与地区策略、客户写入与内容归因、入站消息解析准备、单条消息处理五个模块。`historyImport.ts` 保留原公开入口、维护调度、Webhook 编排和客户查询。迁出的 59 个函数与起点提交逐段比对，除新增导出修饰外源码一致；没有新增入站消息发送、外部上传或镜像写入路径。
- `historyImport.ts` 从 1,880 行降至约 502 行；新模块均低于 800 行，撤销历史超限预算后历史超限文件由 11 项降至 10 项。新入站模块仍含约 607 行的单消息处理函数，后续应按鉴权/归因、知识检索和回复决策分阶段拆解；全仓结构治理仍未完成。
- 部分写入恢复、同租户重放与跨租户隔离、签名后真实入站、客户资料持久化的定向测试，TypeScript、架构扫描/ratchet、生产构建以本批最终命令结果为准。回放测试在隔离目录阻断网络；客户资料测试在本地写入后恢复原文件，并出现 PocketBase 连接失败日志，未形成远端成功回执。未执行真实客户消息发送、付费供应商、生产迁移或部署。
- 同一共享工作树继续存在另一批未提交广告功能与迁移改动：共享树的只读迁移检查报两项 `unregistered_migration` 和一项 `checksum_mismatch`，因此不能称为干净。仅含本批代码提交的临时干净检出重新执行相同检查，191 项通过且无阻塞；这不证明并发迁移改动可合入。临时检出已移除，广告与迁移文件均未纳入本批提交。

## 内容生产项目推进边界退出超限清单（2026-10-22）

- 以集成提交 `c48ad6ff1b2735e0d7e259c9fbfc91daccd47221` 为起点，将项目状态、重试、证据快照和旧订单产品绑定恢复迁入 `contentProductionProjectState.ts`，单项目推进与真实渲染阶段迁入 `contentProductionExecution.ts`；原 `contentProduction.ts` 保留公开导出、租户批次编排和任务材料化。迁出的 13 个函数与起点源码逐段比对，除新增导出修饰外一致；没有改动付费供应商调用条件。
- 原主文件由 1,287 行降至 314 行，状态模块 226 行，执行模块 768 行，均低于 800 行普通门禁；撤销原主文件历史超限预算，历史超限文件由 12 项降至 11 项。执行模块仍有较长的单项目推进函数，后续可按阶段细分；不能把全仓架构债务视为已完成。
- 内容生产、恢复、编导决策、主持人审批、Starter 产物接线、周矩阵、素材分析、本地真实 FFmpeg 质量流程和上传素材溯源定向测试、TypeScript、架构扫描/ratchet 与生产构建以本批最终命令结果为准。构建 `AiCreateStudio` 主 chunk 497,094/500,000 字节。
- 验证期间同一工作树存在另一批未提交广告页与广告账号改动，其中修改了已有 PocketBase migration，并新增未登记 migration；共享工作树上的迁移检查因此报 `checksum_mismatch` 与 `unregistered_migration`。在仅含本批提交 `0bcdd579f58657772e132d71dc39d70c1e89a104` 的临时干净检出中重新执行同一只读检查，191 项全部通过且无阻塞；临时检出已移除。这证明提交的迁移文件状态，不代表当前共享工作树干净或并发迁移改动可合入。本批不改动、不提交该并发改动；完整 `productionTruthfulness.contract.test.ts` 的既有 `App.tsx` 断言限制仍存在。未运行付费供应商、执行迁移或部署。

## 内容生产事实与脚本生成边界（2026-10-22）

- 以集成提交 `6788c228db444d194e0158788a88ba728288d66b` 为起点，将产品选择、冻结订单归属、产品事实和参考结构解析迁入 `contentProductionFacts.ts`；脚本生成、封闭世界离线降级及编导脚本冻结迁入 `contentProductionScripts.ts`。`contentProduction.ts` 保留原有公开导出和执行调用点。迁出 15 个函数与起点提交逐段比对，除新增导出修饰外源码一致；未改真实渲染或供应商调用逻辑。
- 主文件从 1,594 行降至 1,287 行，历史预算同步收紧；两个新模块分别为 130、201 行，历史超限文件仍为 12 项。主执行文件仍超出 800 行，后续需继续按任务推进/渲染阶段拆分。
- 内容生产、恢复、路由、周矩阵、素材分析及编导决策定向测试，TypeScript、架构扫描/ratchet、生产构建、191 项迁移仓库只读检查与迁移 guard 的最终结果以本批命令输出为准。完整 `productionTruthfulness.contract.test.ts` 的未改动 `App.tsx` 断言仍是既有失败，不能记为通过；未调用真实付费供应商、执行迁移或部署。
- 本批验证时同一工作树出现并发的广告页、布局和页面注册文件改动，不属于本批。提交与推送状态须在验证和 Git 状态核对后分别记录；只提交本批明确列出的文件，不能把并发工作树称为干净基线。

## 内容生产素材证据边界（2026-10-22）

- 以干净集成提交 `b1ea6f42be00398725666573dc8a1eea9caa8705` 为起点，将本地、云端与企业素材的读取、归属、授权和位置解析移入 `contentProductionAssets.ts`；主文件继续通过原公开入口导出 `collectProductionAssets` 和 `resolveEnterpriseAssetLocation`，并调用同一实现。没有改动真实渲染或付费供应商路径。
- `contentProduction.ts` 从 1,746 行降至 1,594 行，历史行数预算同步收紧；新素材模块 161 行。历史超限文件仍为 12 项，主执行文件尚未完成拆分。
- 两个 Git 状态干净的其他工作树仍含被忽略的上传、素材和渲染数据，未作为空工作树归档；五个有未提交文件的工作树也保持原状。集成树的 `AGENTS.md` 已由此前仅改该文件的提交 `ef685ba2`、`b3c184d1` 收口，本批无待提交差异。
- 本批迁出的 9 个函数与起点提交逐段比对，除新增导出修饰外源码一致。内容生产、恢复、路由、素材分析、编导决策及主持人审批定向测试，TypeScript、架构扫描/ratchet、生产构建、191 项迁移仓库只读检查与迁移 guard 通过；`AiCreateStudio` 主 chunk 497,094/500,000 字节。完整 `productionTruthfulness.contract.test.ts` 仍在未改动的 `App.tsx` 模拟客户入口源码断言处失败，早于本批素材断言；不能记录为通过。未调用真实付费供应商、执行迁移或部署。

## 内容生产规划规则边界（2026-10-22）

- 以集成提交 `c18618d8a8e1bd609198f55ad6b71991bf89b7c5` 的干净工作树为起点，将语言订单展开、冻结脚本准入、素材授权与逐镜匹配、生产路径分配等规划规则移入 `contentProductionPlanning.ts`；`contentProduction.ts` 保持原有公开导出及执行调用点。迁出源码与起点提交逐段比对，除新增导出修饰外内容一致，没有改动真实渲染、供应商或付费执行条件。
- 主文件由 2,129 行降至 1,746 行，历史预算同步收紧；新规划模块 414 行。历史超限文件仍为 12 项，主执行文件仍待继续按职责拆分。
- 内容生产、恢复、订单矩阵、素材分析、真实本地 FFmpeg 质量工作流、编导决策接线等定向测试通过；TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读检查以本批最终执行结果为准。完整 `productionTruthfulness.contract.test.ts` 在未改动的 `App.tsx` 模拟客户入口源码断言处失败，早于本批迁出的规划规则断言；本批未把该完整合同记录为通过。未调用真实付费供应商、执行迁移或部署。

## 定时任务页退出历史超限清单（2026-10-22）

- 以干净集成提交 `f5f1d97c0d4ddc80999347bb3a4b39e9e9029a64` 为起点，将定时任务的状态、轮询、任务创建/运行/导出控制移入 `useScheduledPageController.tsx`；新建任务弹层、结果抽屉和执行状态展示规则分别移入独立模块。页面仍以原公开导出承载视图，并保持弹层/抽屉的条件挂载、原控制器事件和任务提交入口。
- `ScheduledPage.tsx` 从 1,672 行降至 747 行；控制器 610 行，新建弹层 293 行，结果抽屉 153 行，执行展示规则 44 行。视图渲染辅助仍留在页面，控制器只负责状态、派生数据和动作。撤销该页面历史超限豁免，历史超限项由 13 降至 12。状态呈现、失败信息脱敏及原有任务接线有直接或合同测试；未新建平行任务链。
- TypeScript、生产工作流回归、架构扫描/ratchet、生产构建和 191 项迁移仓库只读检查以本批最终执行结果为准。该重构未做登录后浏览器交互验收，不能把源码合同与构建通过写成真实 E2E。未调用真实任务、付费供应商、执行迁移或部署；最终 SHA 与工作树状态以普通推送后核验为准。

## 定时任务经营动态视图边界（2026-10-22）

- 以干净集成提交 `5ae361c7b14a64267e42b582b982b6b7c56f846a` 为起点，将定时任务页的经营画像、汇率报价和公开市场动态展示迁至 `ScheduledBusinessDynamicsWorkspace.tsx`；页面继续持有数据拉取、刷新回调和模板创建，不变更真实任务、供应商请求或调度持久化。
- `ScheduledPage.tsx` 从 1,886 行降至 1,672 行，历史预算同步收紧；新视图 238 行。加载、资料不全、检索失败、已就绪数据和外部来源链接有直接渲染测试，页面接线由合同测试覆盖。历史超限文件仍为 13 项，页面整体拆分尚未完成。
- TypeScript、生产工作流测试、架构扫描/ratchet、生产构建和 191 项迁移仓库只读检查通过；`AiCreateStudio` 主 chunk 497,094/500,000 字节。未运行真实任务、付费供应商、迁移或部署；本地/远端 SHA 与工作树状态以推送后复核为准。

## 定时任务结果动作与工作台元数据边界（2026-10-22）

- 以干净集成提交 `5dec92fc909e35778632b7552c04027edc2f0021` 为起点，将定时任务结果的后续 Agent 动作建议移入 `scheduledTaskActions.ts`，各任务类型的结果工作台标题、卡片和操作元数据移入 `scheduledTaskWorkspaces.ts`。原页面仍负责导航、状态、任务创建与执行，不改变实际调度或外部调用链。
- `ScheduledPage.tsx` 由 2,141 行降至 1,886 行，历史预算同步收紧；新增规则模块分别为 178、91 行。历史超限文件仍为 13 项，页面尚未完成整体拆分。两个模块的任务类型、摘要传递、回退状态与工作台卡片有直接行为测试，并纳入生产工作流回归。
- TypeScript、生产工作流测试、架构扫描/ratchet、生产构建和 191 项迁移仓库只读检查通过；`AiCreateStudio` 主 chunk 497,094/500,000 字节。未触发真实任务、供应商、迁移或部署；本地/远端 SHA 与工作区状态以本批推送后复核为准。

## 定时任务模板与排期规则边界（2026-10-22）

- 以集成提交 `299942c3c9e2dcf4d854a1f7c751e51b50fdd808` 的干净工作树为起点，将 `ScheduledPage.tsx` 内的任务模板目录、分组、北京时间标签、爬取数量规范化及相关纯规则迁到 `scheduledTaskTemplates.tsx`；页面仍引用同一组模板与规则，未改变任务创建、定时执行或供应商调用路径。
- 页面由 2,276 行降至 2,141 行，历史行数预算同步收紧；新模块 144 行。历史超限文件仍为 13 项，此批是职责边界拆分，不宣称页面整体退出超限清单。新增模板规则行为测试并接入 `test:production-workflows`。
- TypeScript、生产工作流测试与生产构建通过；架构扫描/ratchet、迁移清单只读检查以本批最终执行结果为准。`AiCreateStudio` 主 chunk 497,094/500,000 字节，无大 chunk 告警。未运行真实任务、付费供应商、迁移或部署。图片 AIGC 已提交来源 `95b0bcc` 是当前集成分支的祖先；来源工作树的未提交工作约定、日历修改与运行数据仍单独保留，不视为已合入。

## 社媒创作工作台控制器与视图边界（2026-10-22）

- 以 `e87c4e7f086f4a084b4925990cc670953ff08b13` 为干净起点。仓库工作约定的证据口径先由独立提交 `b3c184d1` 补充；本批再将 `SocialCreationWorkbench` 的状态、派生规则、异步操作和语音高亮控制移到 `useSocialCreationWorkbenchController.tsx`，时间辅助函数移到 `socialCreationWorkbenchTime.ts`，原组件保留公开合同和 JSX 视图。控制器与视图经原始提交逐段比对，除文件边界和空白外保持原逻辑及 JSX 不变。
- 原组件由 1,008 行降至 323 行，新控制器 736 行，撤销原组件的历史超限豁免；历史超限文件由 14 项降至 13 项。相关源码位置合同已改为分别检查控制器规则和视图接线，未改变社媒生成、付费提交或预览状态模型。
- 社媒前端及 Studio 媒体定向测试、`pnpm run lint`、架构扫描与 ratchet 回归、生产构建、191 项迁移仓库只读检查及迁移 guard 测试通过。构建中 `AiCreateStudio` 主 chunk 为 497,094/500,000 字节，无大 chunk 告警；这不代表真实用户操作、付费供应商 E2E 或发布验收。未调用真实付费供应商、执行迁移或部署。最终本地/远端 SHA 与工作树状态以本批提交、推送后的复核为准。

## Studio 支撑模块分包与构建体积门禁（2026-10-22）

- 以集成分支 `e331a08cac40926e5bbb2f1c6c09ac3fdd0e3873` 为干净起点，使用当前 Vite/Rolldown 的明确模块分组，将工作台框架、媒体预览、任务水合与纯规则等静态依赖放入可缓存的 `studio-support` 包；保留严格执行顺序，避免分包改变静态依赖的求值先后。`pnpm run build` 新增 `check-studio-chunk.mjs`，在构建后对 `AiCreateStudio` 主 chunk 执行 500,000 字节硬门禁。
- 本地正式生产构建无大 chunk 告警：`AiCreateStudio` 497,094 字节，`studio-support` 66,346 字节。**这主要是包边界与缓存优化，不是总下载量同比下降**；主组件自身约 413 kB 的控制器/渲染耦合仍是架构债务，应继续按明确工作流边界治理。`xlsx` chunk 约 492.98 kB，也接近 500 kB 告警阈值，但本批未改它。
- 无头 Chrome 对本地生产预览返回 HTTP 200，应用页面无脚本错误，且 `AiCreateStudio` 构建 chunk 可在浏览器求值；这只是模块加载烟测，不代表登录后的全工作台操作验收。TypeScript、生产构建和 Studio 定向回归以本批最终执行结果为准。未调用真实付费供应商、执行迁移或部署。

## 创作工作台预览与问题修复加载边界（2026-10-22）

- 以集成分支 `1491a42a6aff94ba5a295a5bb81f33f9a8875fea` 为干净起点，将参考视频预览、图文包预览与分镜问题修复操作改为按需加载，并在原使用位置保留局部等待状态。旧主工作台的状态、渲染验收、保存及付费提交动作未移动；新增合同锁定三个懒加载边界。
- 生产构建实测 `AiCreateStudio` 主 chunk 从 579.39 kB 降至 561.56 kB；**仍超过 500 kB，告警未解决**。这批减少的是进入相应预览或审核状态之前需要加载的代码，不代表整条创作链路总下载量同比下降。下一步仍须处理主组件自身约 413 kB 的控制器/渲染耦合。
- 相关预览与审核合同 5/5、`test:studio-media`、`test:studio-workflow`、TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读检查通过。历史超限项仍为 14；未调用真实付费供应商、执行迁移或部署。

## 创作工作台可选面板加载边界（2026-10-22）

- 以集成分支 `eff7be1f559959016a09eac8fe46618d7ea7e768` 为干净起点，仅将任务演示、分镜审核与镜头素材库三个按条件显示的视图改为 `React.lazy`，各自保留局部 `Suspense` 等待状态；没有移动任务状态、提交动作、恢复逻辑或主工作台框架。新增加载边界合同并调整演示模式源码合同以识别包装层。
- 生产构建实测 `AiCreateStudio` 主 chunk 从 598.69 kB 降至 579.39 kB，三个视图均生成独立 chunk；**仍超过 500 kB，告警未解决**。源码映射显示原主 chunk 中约 412 kB 来自 `AiCreateStudio.tsx` 自身，尤其第 12,001–13,500 行的工作台渲染区域；下一步须处理真正可独立加载的视图/控制器边界，而非仅迁移文件行数或提高告警阈值。
- 演示、分镜审核、素材库及预览合同 6/6、`test:studio-media`、`test:studio-workflow`、TypeScript、架构扫描/ratchet、生产构建及 191 项迁移仓库只读检查通过。历史超限项仍为 14；未调用真实付费供应商、执行迁移或部署。

## 企业素材路由边界收口（2026-10-22）

- 以集成分支 `4c4559ae7ac90335b34de3d8cafe40003ffd34da` 为干净起点，将企业素材上传、外部图片导入和按租户读取三条 HTTP 路由迁入 `enterpriseAssetRoutes.ts`，在原位置注册；迁出的路由体仅替换路由器变量，内容与原版逐字节一致。素材目录解析、文件名生成与存储适配随路由迁移，原有 `enterprise.ts` 公开导出不变。
- `server/routes/enterprise.ts` 从 1,000 行降至 756 行，撤销其历史超限豁免；新素材模块 269 行，历史超限项由 15 降至 14。企业素材上传/产品投影/租户隔离真实 HTTP 测试与企业资料、安全等定向测试合计 9/9 通过；TypeScript、架构扫描/ratchet、生产构建及 191 项迁移仓库只读检查通过。
- 本批没有改变客户端工作台；构建仍提示 `AiCreateStudio` 598.69 kB 大 chunk，不能宣称体积治理完成。未调用真实付费供应商、执行迁移或部署。

## 企业资料路由职责拆分续批（2026-10-22）

- 以集成分支 `cc8d41deabdb2cc29e47a5062da0e0419ec5827e` 为干净起点，将企业资料的默认值、规范化与事实版本持久化移入 `enterpriseProfileStore.ts`，知识完整性、FAQ 和业务说明移入 `enterpriseKnowledge.ts`，订单 HTTP 路由移入 `enterpriseOrderRoutes.ts`，租户识别共用函数移入 `enterpriseTenantAuth.ts`。原 `enterprise.ts` 的公开导出和路由挂载顺序保持兼容；客服激活安全合同改为检查实际承载默认值的模块。
- `server/routes/enterprise.ts` 从 2,137 行降至 1,000 行，历史预算收紧至 1,000；新文件均不超过 800 行，历史超限项仍为 15。此处按持久化、知识规则与订单 HTTP 边界拆分，没有为达到单一行数强行继续拆散路由。
- 企业事实、订单生命周期、产品素材归属、客服激活、产品 API 安全、资料 UI 规范化和助手企业事实读取等定向测试 8/8 通过；TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读检查通过。构建仍提示 `AiCreateStudio` 598.69 kB 大 chunk，不能宣称体积治理完成。未调用真实付费供应商、执行迁移或部署。

## 企业资料合同与订单模块拆分（2026-10-22）

- 以集成分支 `49d05baeb13fccd8d247732470222e8b13d5e4f4` 为干净起点，将跨服务使用的企业资料/客服/订单 TypeScript 合同移入 `enterpriseProfileContracts.ts`，并保留 `enterprise.ts` 原有类型导出；本地和 PocketBase 订单读取、CSV 归一化、幂等保存与客户摘要同步迁入 `enterpriseOrders.ts`，原 `readOrders` 导出路径仍兼容。订单模块按需读取 WhatsApp 同步函数，避免新增静态路由导入环。
- `server/routes/enterprise.ts` 从 2,661 行降至 2,137 行，历史预算同步收紧；新合同与订单模块分别为 247、293 行。该路由**仍超出 800 行**，历史超限文件总数仍为 15。企业事实、订单生命周期/API 隔离、产品素材归属和客服激活四组定向测试通过；TypeScript、架构门禁与 ratchet 回归、生产构建、191 项迁移仓库只读检查通过。
- 本批源码映射复核：`AiCreateStudio` 仍为 598.69 kB；映射中约 412 kB 的生成代码归于 `AiCreateStudio.tsx` 自身，源码 12,001–13,500 行对应约 104 kB 生成代码。单独迁出少量现有子组件不足以证明告警会消失，后续需拆出可按需加载、类型明确的工作台视图/控制器边界并做浏览器状态回归。本批没有改变该前端代码，不能宣称大 chunk 已治理。未发起真实付费供应商调用、执行迁移或部署。

## 生产任务路由退出历史超限清单（2026-10-22）

- 以集成分支 `fecb857c343364470a97a256c1c0cf4e8ea89fe7` 为干净起点，将数字人任务列表、付费提交、批量编排、刷新、参考人物提交/刷新/取消迁入 `productionJobRoutes.ts`，并把共用的人物授权提示与素材身份只读证据放到 `productionRouteEvidence.ts`。迁出的路由块与原文件逐字节一致；新模块通过显式参数复用原有锁、预算、存储、逐句复刻与供应商执行器，没有另建平行状态链。
- `server/routes/production.ts` 从 1,293 行降至 782 行，移除历史超限豁免；`productionJobRoutes.ts` 为 510 行，新证据模块 38 行，历史超限文件从 16 减至 15。人物来源、生产路由与逐句复刻聚焦测试 15/15、TypeScript、架构扫描/ratchet、生产构建、191 项迁移仓库只读检查通过。
- 扩大到完整 `test:production` 得到 209/211，通过之外的 2 项均为未改动的 `ShotProductionPanel.test.tsx` 中“人物替换认证（可选）”文案断言，与当前面板实际文案不符；本批未改动该 UI 或测试，不把完整套件记录为通过。构建仍提示 `AiCreateStudio` 598.69 kB 大 chunk；未发起真实付费供应商调用、执行迁移或部署。

## 人物来源路由边界拆分（2026-10-22）

- 以集成分支 `3d36694bb1ef1c0e2a9144a599222badbdf00ee1` 为干净起点，将数字人源片字幕补取和企业人物视频取帧两条路由完整迁入 `productionPresenterSourceRoutes.ts`；原路由块与迁出内容逐字节一致，仍由原生产路由挂载，并复用同一个租户上下文、独占锁、存储和运行选项。未发起供应商或付费请求。
- `server/routes/production.ts` 从 1,453 行降至 1,293 行，历史预算同步收紧；新文件 183 行。该主文件**仍超出 800 行**，历史超限文件总数仍为 16，后续须继续按业务边界拆分。
- 人物来源/取帧专项 3/3、生产路由与逐句复刻 13/13、TypeScript、架构扫描、ratchet 回归、生产构建及 191 项迁移仓库只读检查通过。原人物字幕测试桩缺少现行原子 CAS 能力，已补成会检查预期值的模拟实现；生产代码没有回退到非原子写入。生产构建仍提示 `AiCreateStudio` 主 chunk 598.69 kB 超过 500 kB；未执行真实迁移或部署。

## Studio 遗留预览运行时与无引用函数清理（2026-10-22）

- 以集成分支 `a238fcca925aea35809dae90bf16533dcad3abb9` 为干净起点，通过 TypeScript 未使用符号诊断和调用点核对，清除旧步骤留下的无引用操作函数，并移除没有任何启动入口的旧分镜预览时钟、预热缓存与音轨副作用。当前正式成片仍由已挂载工作台的 `<video>` 播放，下载仍检查当前完成产物与导出资格；新增可达性合同防止旧预览链回流。
- `AiCreateStudio.tsx` 从 14,633 行降至 13,577 行，行数预算同步收紧；历史超限文件仍为 16 项。构建主 chunk 从约 603 kB 降至约 599 kB，**仍有超过 500 kB 的告警**。此前已被打包器消除的死函数只改善源码债务，约 4 kB 的实测下降主要来自旧预览运行时副作用移除，不能据此宣称体积治理完成。
- Studio 聚焦合同、媒体访问与旧预览可达性测试 36/36 通过；TypeScript、架构扫描/ratchet、生产构建和 191 项迁移只读检查以本批最终执行结果为准。没有发起真实付费供应商调用、执行迁移或部署；浏览器工作流回归与可达工作台拆包仍待完成。

## 调度路由职责拆分（2026-10-22）

- 以集成分支 `82acf2bcf66384dc96016ae4261c4076279dda9c` 为干净起点，将经营动态快照/报告、每周视频报告/PDF、视频与图文采集任务分别移入 `schedulerBusinessDynamics.ts`、`schedulerTaskReport.ts`、`schedulerCrawlTasks.ts`。`scheduler.ts` 保留路由、任务生命周期、权限及调用入口；公开的 `beijingWeekWindow` 等既有导出保持兼容。没有修改采集、付费或外部发送执行条件。
- 主文件由 1,708 行降至 787 行，移除历史超限豁免；架构清单从 17 项降至 16 项，新模块均低于 800 行。新增经营信号来源约束、采集配置边界、北京时间周窗口和路由接线测试。旧对标采集合同原要求当前基线并不存在的图文热度排序，现改为检查实际的平台范围、去重、图文入库和配文保留；这不代表新增热度排序能力。
- 调度/采集/社媒发现相关测试 15/15、TypeScript、架构扫描/ratchet、生产构建与 191 项迁移只读检查通过。生产构建仍提示 `AiCreateStudio` 约 603 kB 大 chunk；未调用真实采集、付费供应商、执行迁移或部署。此批提交及远端 SHA 以推送后的核对为准。

## 发布控制器退出历史超限清单（2026-10-22）

- 在上一批视图拆分基础上，将数字员工深链解析、发布请求/统一文案适配、平台账号读取、视频上传和发布资格/日历待排项的纯计算分别移入独立模块；`TrafficPage.tsx` 原有公开导出保持兼容，真实发布确认与回执处理仍留在控制器。本批没有改动接口路径、请求正文或发布选择规则。
- 主文件从 1,023 行降至 792 行，撤销其历史行数豁免；架构冻结超限项由 18 降至 17。发布资格直接测试与工作流聚焦合同 12/12 通过，覆盖未授权账号、待定时间和未验证项目成片不得进入真实发布选择。
- 安全合同中两处旧源码位置断言同步改为检查已拆分的 OAuth 支持模块和交付向导模块，继续验证租户凭据与 TikTok 交付设置，未更改认证实现；该安全合同通过。TypeScript、架构扫描/ratchet、架构 ratchet 回归、生产构建与 191 项迁移仓库只读检查通过；`AiCreateStudio` 约 772 kB 的大 chunk 告警仍待治理。没有真实发布、付费调用、迁移或部署。

## 发布面板视图边界（2026-10-22）

- 将发布队列、账号选择、内容编辑、发布设置及确认弹窗的展示移到 `SocialPublishPanelView.tsx`，平台展示元数据移到 `publishing/publishPlatformMeta.ts`；`TrafficPage.tsx` 保留原有发布控制器及外部入口，没有改动真实发布、日历排期或供应商请求流程。主文件由 1,355 行降至 1,023 行，历史预算同步收紧；剩余超限项仍为 18 个，发布控制器尚待继续拆分。
- TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读检查通过。发布面板及相关工作流的聚焦测试 10/10 通过；合并运行的安全合同另有一项既有 TikTok OAuth 源码位置断言失败，已核对变更前 HEAD 同样不满足断言。本批未改 OAuth 逻辑。
- 构建仍提示 `AiCreateStudio` 约 772 kB 大 chunk。未调用真实发布平台、付费供应商、执行迁移或部署；权威提交以本批普通推送后的本地/远端 SHA 核验为准。

## 社媒工作区模式协调边界（2026-10-22）

- 集成分支：`xixi1021程永罗沟通前大整合`。本批代码提交 `67a43aec`；仓库工作约定由独立提交 `ef685ba2` 更新。最终远端分支 SHA 应以推送后的本地/远端核对为准。
- 将 `TrafficPage.tsx` 的灵感/创作/发布/账号模式协调、周任务目标挂载与导航入口移到 `TrafficWorkspacePage.tsx`；原默认导出和发布队列面板仍留在 `TrafficPage.tsx`。主文件从 1,750 行降至 1,355 行，新组件 425 行，历史预算同步收紧；剩余超限项仍为 18 个。
- 本批仅移动工作区协调逻辑，不触发真实发布。周任务目标、发布队列、手动任务桥接及助手合同测试 14/14、TypeScript/lint、架构门禁/ratchet、生产构建及 191 项迁移只读检查通过。发布队列主模块仍超限，构建仍提示 `AiCreateStudio` 约 772 kB 大 chunk；后续继续拆分状态、日历与编辑区。

## 根路由加载边界整理（2026-10-22）

- 将 `App.tsx` 中的懒加载页面声明、预取映射、本地预览预热和企业产品深链规范化移到 `appPageModules.tsx`，保留 `App` 原有公开导出与页面加载路径。根组件从 1,118 行降至 984 行；随后把全局助手和页面上下文栏移到 `AppShellChrome.tsx`，降至 951 行。本批再将页面挂载渲染区移到 `AppPageSlot.tsx`，根组件降至 797 行并撤销历史超限豁免；冻结超限项从 19 降至 18。
- App 导航状态、延迟页面壳、页面外壳与企业产品深链合同测试 6/6 通过；本次没有改变页面权限、外部调用或部署行为。TypeScript、生产构建、架构扫描/ratchet、ratchet 回归与 191 项迁移只读核查通过。入口 chunk 约 231 kB；`AiCreateStudio` 约 772 kB 的告警仍在。

## 创作工作台合同回归收口（2026-10-22）

- 复核上一轮创作专项的两项旧失败：项目续接标题断言改为覆盖现行“模板副本/普通续接”分支；目标首帧持久化断言改为检查版本感知保存方法，均未放松业务约束。
- 左侧分镜列表移除重复的路线、成本、产品精度及生产诊断摘要，生产设置和验收仍在对应制作区域；这与既有分镜列表合同一致。创作工作台专项 16/16、分镜列表与工作台框架测试 2/2 通过。
- TypeScript、生产构建、架构扫描/ratchet 和 191 项迁移只读检查通过；`AiCreateStudio` 主 chunk 约 772 kB，告警仍未解决，超限文件仍为 19 个。

## 创作工作台加载边界（2026-10-22）

- 镜头制作面板和“我的创作”浮层改为按需加载，项目浮层源码移出 `AiCreateStudio.tsx`；主文件从 17,963 行降至 17,807 行，历史行数预算同步收紧。构建主 chunk 从约 881 kB 降至约 774 kB，仍有大 chunk 告警。
- 主文件自身的生成代码约 570 kB，后续仍需拆分步骤工作流才能完成构建告警治理；本批不声称已解决。项目删除合同 1/1、相关创作工作台定向测试 14/16 通过，另两项旧断言失败未因本轮按需加载修改相关实现。
- TypeScript、生产构建、架构扫描/ratchet、ratchet 回归及 191 项迁移只读检查通过。推送 SHA 以本批最终核对为准。

## 经营看板结构治理（2026-10-22）

- `SmartBusinessDashboard.tsx` 的周计划展示与统一展示模型分别移到 `smartBusiness/WeeklyPlanPresentation.tsx` 和 `smartBusiness/smartBusinessDisplayModel.ts`，原组件导出入口保留；主文件从 1,540 行降至 623 行，移除其超限豁免，剩余超限项 19 个。
- 保持真实回传与参考估算、计划视频预算、精确爆款引用和缩略图回退规则不变。看板相关定向回归 8/8 通过。此前 `studioApi.ts` 拆分遗漏的 `readStudioHttpError` 依赖已恢复。
- TypeScript 全量检查、生产构建、架构扫描/ratchet、架构 ratchet 回归与 191 项迁移只读核查通过。构建仍提示 `AiCreateStudio` 约 881 kB 大 chunk。本批推送 SHA 以最终核对为准；其他仍含未提交内容的来源工作树不在本批合并范围。

## 最新结构治理：工作台 API 边界（2026-10-22）

- `studioApi.ts` 的公开类型合同与 POST 请求传输分别移入 `studioApiContracts.ts` 和 `studioApiTransport.ts`，原导出路径继续兼容。主文件从 1,316 行降至 735 行，移除其超限豁免；剩余超限项 20 个。
- 本批仅重排模块，不改变请求重试、失败回退、项目保存或供应商调用规则。工作台 API 专项 10/10、TypeScript 全量检查、生产构建、架构扫描/ratchet 与 191 项迁移只读检查通过。构建仍提示 `AiCreateStudio` 约 881 kB 的大 chunk。
- 本地和远端权威提交在本批提交、普通推送并核对 SHA 后确定；其他仍有未提交内容的工作树不属于本基线。

## 阶段二集成基线（历史合并节点）

- 仓库：`lingshu-ai-cloud/lingshu_AI`
- 集成分支：`xixi1021程永罗沟通前大整合`
- 阶段二代码集成提交：`8fe56ca815fc3ee5dd7c8286e1fd10ab428aeb65`（双亲：阶段一 `69813195277028455b6cc0a0c675de01d66217d5`、AIGC `95b0bcc16820e06fcc16ac75e040a6592abdc692`）
- 上游冻结点：`62f85f8cc00a41a4e492261d92e227f2786592fd`
- 阶段一治理提交：`69813195277028455b6cc0a0c675de01d66217d5`
- 上一稳定基线：`xixi数字员工架构待清理` / `2d6c5a62d516c6eb5fc83d7dc19c17080aa31d98`
- 当时的本地集成工作树：`/Users/julia1/.codex/worktrees/xixi1021-full-integration`（现已切为另一任务的广告功能分支，不是当前集成路径）。
- 当时的工作树盘点：[`WORKTREE-INVENTORY.md`](./WORKTREE-INVENTORY.md)（该文件顶部另有当前 9 树复核；本段数字属于历史阶段）。
- 阶段 0 核验时工作区干净；图片 AIGC 工作树 `mobile-dual-edition-20261012` 有未提交改动，明确不属于本基线。

## 阶段一范围

阶段一仅处理基线可读性与低风险架构治理：基线声明、旧治理文档的权威边界、架构债务 ratchet 和运行产物隔离。业务规则、付费供应商调用、生产数据、部署、历史工作树/分支清理均不在本阶段范围内。

## 当前治理事实

- `architecture.config.json` 使用 schema v2，普通生产 TypeScript 文件上限为 800 行；本次核验记录 49 个历史超限文件的精确行数预算。
- CI 的 `build-release-images.yml` 对所有目标分支的 PR 执行架构、迁移、图片管线专项和生产构建校验，并以 PR base commit 为 ratchet 基线；push 到普通 feature 分支不触发镜像发布。
- 本次新增的一次性债务快照仅适用于精确基线 `62f85f8cc00a41a4e492261d92e227f2786592fd` 和 ID `2026-10-21-stage1-verified-inventory`；后续 schema 或债务 ID 变更不能豁免预算上升。
- 快照后历史预算只能保持或下降；新增文件仍受 800 行限制。
- 工作流 `build-release-images.yml` 对所有 PR 运行验证；只有 tag 或手动触发才进入镜像发布 job。环境部署/回滚工作流均为手动触发。
- 推送分支不等于部署授权；本项目仍遵守仓库 `AGENTS.md` 的部署限制。

## 独立状态，不混为一谈

1. 源码集成基线：本文件记录的 commit 和分支。
2. 图片 AIGC：已选择性集成分支 `xixi图片AIGC管线` 的提交 `95b0bcc16820e06fcc16ac75e040a6592abdc692`。本轮不包含该工作树未提交文件。轮播/GIF 多输出服务端链路仍未完成，不视为已可用。
3. 运行/预览数据：不由源码 commit 代表；需单独记录 store、服务实例和 run/package/version。
4. 真实供应商联调：需单独满足账号、资产、配额、授权、预算和唯一写入会话要求。

## 后续接手规则

- 新开发从明确指定的集成分支/commit 创建隔离工作树，不根据“最新”字样推断权威状态。
- 每次基线推进，更新本文件的分支、commit、工作树及验证结果。
- 未合入内容只记录来源与状态，不清理其工作树、分支或运行数据。
- 外部依赖未 Ready 时记录阻塞，不以扩大架构或真实付费重试绕过。

## 阶段一验证记录

- 架构 ratchet 回归：通过（含 schema 升级不能扩大/新增超限豁免）。
- 迁移仓库只读完整性：通过，191 项，无 blocker；不代表数据库升级已演练。
- 生产构建：通过；Vite 报告若干既有大 chunk 提示。
- TypeScript：通过。清理了不再被客户端使用、且将供应商成本映射为客户积分的旧 `/agent-usage-costs` 路由。
- 全量架构扫描：通过，2112 个生产 TypeScript 文件；49 个历史超限文件被冻结在准确基线预算内。
- ratchet 回归：通过，覆盖 schema 变更不能作为预算增长/新增历史豁免的后门。
- 这一提交建立清晰的债务快照，不代表 49 个超限文件已拆分；阶段一剩余工作应按每次 1–2 个业务热点文件拆分并降低预算。

## 阶段二：AIGC 与剩余基线治理

- 集成范围：关键词智能规划与测试、参考文案传递、图片任务合同/图层工具、单图质量参数、Qwen 多模态复核基础；详情见 `docs/architecture/adr/2026-10-21-aigc-merge-boundary.md`。
- 明确未完成：轮播多图生成与任务恢复、GIF 编码/交付、真实供应商端到端验收。对应内容继续保持 UI 不可选。
- 四层文档入口已建立：`docs/product/PRODUCT_BASELINE.md`、`docs/architecture/ARCHITECTURE.md`、`docs/architecture/adr/`、`docs/runbook/`。旧 PRD 暂不批量归档；未逐篇核对引用和权威关系前保留原位。
- 外部联调与产品开发已拆为两条泳道，准入清单见 `docs/runbook/EXTERNAL-E2E-READINESS.md`。
- 架构检查通过：2121 个生产 TypeScript 文件；49 个历史超限文件仍不超过冻结预算。TrafficPage 删除重复图文导航分支并下调其预算 71 行；studio.ts/AiCreateStudio.tsx 的预算随已确认的行数下降 1 行。
- 架构 ratchet 回归通过；迁移仓库只读预检 191 项通过、无 blocker；图片 AIGC 专项测试 31/31 通过。
- 全量 TypeScript 检查通过；生产前端构建通过（保留既有大 chunk 警告）。
- 该阶段验证只代表本地自动化/构建结果；不代表外部账号、真实供应商或线上部署验收。本次没有调用真实付费供应商、部署或推送。

## 后续阶段：CI 覆盖与热点拆分（2026-10-22）

- 阶段代码提交：`902d270a4aaa8a1d3b645991ec1634add70eef04`，位于集成分支 `xixi1021程永罗沟通前大整合`；2026-10-22 基线记录点 `ce1105c21761c9d2d3755ffecd81ffe5ed822646` 已普通推送到同名远端分支，并核验本地/远端 SHA 一致。未部署、未发布。
- 所有目标分支的 Pull Request 现在都会运行 verify job；架构与迁移 ratchet 均以 PR base SHA 为比较基线。发布镜像的 publish/smoke job 仍排除 PR 事件，只保留 tag/手动触发路径。
- CI 固定运行图片管线专项合同和 `server/lib/translationCues.ts` 回归。纯时间戳翻译解析从 `server/routes/studio.ts` 下沉至领域模块，Express 超时和连接生命周期仍留在路由 adapter；路由从 11,486 行降至 11,380 行，预算同步收紧。
- AIGC render-plan 规格测试固定轮播最多 4 个独立幂等单元及角色顺序；这不是生产多输出实现。轮播/GIF UI 仍不可选，直到逐单元耐久任务、费用结算和恢复完成。
- 验证：TypeScript 全量检查、生产前端构建、架构检查/ratchet、迁移 guard、翻译回归 3/3、图片管线 17/17、workflow 合同 2/2 均通过；Vite 有既有大 chunk 警告。无真实供应商调用、PocketBase 访问、部署或推送。
- 2026-10-22 重新盘点 19 个有效工作树；仅清理两个目标已不存在的 Git 失效注册记录，分支保留。其他工作树仍按 [`WORKTREE-INVENTORY.md`](./WORKTREE-INVENTORY.md) 分类逐项审查；未归档或删除有效工作树、分支或运行数据。

## 本轮核验与剩余边界（2026-10-22）

- 代码提交 `ec3b88382b05c55042c9eea5e421ad82fb551730` 为单图付费请求增加保守门禁：任务中存在尚无成片的运行中/结果未知记录时，刷新后也不能直接再次提交；异常响应不再被当成确定失败。此门禁并不提供供应商回执对账或自动恢复。
- `ce1105c21761c9d2d3755ffecd81ffe5ed822646` 已与远端同名分支核验一致；上述代码提交及本文件的提交需以新的 `git rev-parse HEAD` 和 `git ls-remote` 另行核验，不得沿用旧 SHA 声称当前基线已同步。
- 本轮验证：TypeScript、生产前端构建、图片管线专项 17/17、架构扫描（2123 个生产 TypeScript 文件、49 个冻结超限文件）、ratchet、迁移仓库只读预检（191 项，无 blocker）通过。构建仍有既有大 chunk 警告；未做真实供应商调用、数据库迁移或部署。
- 仍未完成：49 个历史超限文件的结构性拆分、轮播/GIF 逐单元耐久作业和费用/结果恢复、8 个有独有提交的工作树补丁审查，以及 5 个有未提交内容来源树的归档处置。不能将“分支祖先已合入”解释成这些未提交内容或端到端功能均已合并。

## 结构拆分进度（2026-10-22）

- 代码提交 `027b6906f2a0aaf59263eab5bded59bf889f8dfd` 把复制任务的冻结因子/Job 合同与编导锁定口播压缩规则各抽入独立模块，保留原合同导出入口。两个原超限文件分别从 808 行降至 686 行、824 行降至 780 行；对应历史豁免已从 `architecture.config.json` 删除。
- 相对先前远端基线 `5b153ee7cb599606ca3cda08ee5d497b210b7a13` 的架构 ratchet 通过：生产 TypeScript 文件 2125 个，冻结的历史超限文件由 49 降为 47。TypeScript、共享合同兼容、编导计划合同、图片专项 17/17、生产前端构建和迁移仓库只读预检 191 项通过；构建仍有既有大 chunk 提示。
- 图片多输出的服务端耐久单元设计见 [`2026-10-22-social-image-durable-units.md`](../architecture/adr/2026-10-22-social-image-durable-units.md)。当前远端 PocketBase 不声明可验证的原子 CAS 能力，轮播/GIF 仍不开放；设计文档不是已实现或真实供应商验收的证明。
- 尚余 47 个历史超限文件，以及逐单元付费作业、供应商对账/恢复和其他来源工作树的处置。不得把本次结构拆分的测试通过解读为上述范围已完成。

## 图片付费单元接线（2026-10-22）

- 代码提交 `46848f46b390153571666c382d6e23aac5c3e744` 将单图工作台接入服务端原子认领、输入哈希冻结、素材先持久化后关联输出，以及结果未知禁止自动重发。浏览器通用 PATCH 不能改写已存在付费记录；轮播/GIF 类型仍在服务端被拒绝。
- 为保持架构 ratchet，海报产品摘要与前端海报渲染合同各抽出独立模块；`server/routes/studio.ts` 预算由 11,380 收紧至 11,362 行，`src/lib/studioApi.ts` 由 1,323 收紧至 1,316 行。历史超限总数仍为 47。
- 验证：TypeScript、生产前端构建、图片专项 23/23、架构扫描/相对 `0cb783f1fe93c8f0e615f896313009a7861aae43` 的 ratchet、迁移仓库只读预检 191 项均通过。未调用真实供应商、未部署；生产构建仍有大 chunk 提示。
- 重要限制：远端 PocketBase 的全局 `supportsAtomicCompareAndSwap()` 为假；图片任务随后加入按集合核验的能力判断，但现有远端环境的真实结构仍未验收。不能把单元测试通过解释成现有远端已具备生成能力。下一步需做不付费故障注入和恢复测试，再处理多输出与真实供应商验收。

## 远端图片 CAS 结构核验（2026-10-22）

- 代码提交 `df867eb019506f8c4d1e80545401cd70dc3d5603` 在单图付费 Job 认领前，以只读管理员请求检查 PocketBase `datastore_cas_claims` 集合的私有规则、必需字段及 `target_key` 唯一索引元数据。仅 `studio_projects` 图片任务可使用该按集合证明；其他集合的远端全局 CAS 能力仍为假。缺凭据、网络失败或结构不符时一律拒绝付费认领。
- 图片专项测试 26/26 与 workflow 合同 2/2、TypeScript、生产前端构建、架构扫描/相对 `3d52017008e2405c5538aa68c1ca755550130d26` 的 ratchet、191 项迁移仓库只读预检通过。架构扫描为 2129 个生产 TypeScript 文件、47 个冻结超限文件；构建仍有大 chunk 提示。
- 本轮没有访问目标 PocketBase、没有执行迁移、没有调用真实付费供应商，也没有部署。目标环境是否真的具备该唯一索引及跨实例表现，仍需后续只读核验和不付费故障注入；轮播/GIF、供应商回执对账与自动恢复仍未完成。
- 集成分支的新权威 HEAD 应以推送后 `git rev-parse HEAD` 与 `git ls-remote` 的一致性为准；不能将上述代码提交本身误当作文档提交后的最终 SHA。

## `fa28472f` 来源追溯（2026-10-22）

- 用户提供的企业资料/积分/数字人录制提交 `fa28472f01d7e8b3051730f3dd075e55ddcc1f60` **不是**当前集成分支的 Git 祖先。集成历史中的 `62f85f8cc00a41a4e492261d92e227f2786592fd` 是同题材的冲突整合提交，不是相同 patch-id；不能仅凭同名提交声称原提交被原样合并。
- 对两个提交各自的改动路径做只读对比：绝大多数路径重合；积分迁移在集成线上因序号冲突改名，来源提交的 `server/routes/videos.ts` 改动未出现在 `62f85f8` 提交中。该路由当前仍无来源分支的 LinkedIn 采集分支，属于待审的具体差异；不得因分支已推送就宣称该来源全部等价合入。
- 当前基线仍保留企业资料、积分和数字人相关的整合成果；上述差异需按现行采集架构单独审阅、测试和选择性补入，不能直接覆盖整份路由文件。

## 生产计划时间线结构拆分（2026-10-22）

- 将 `server/starter198/socialContentProductionPlan.ts` 的时间提示和锁定片段时间线构造移至 `socialContentProductionTimeline.ts`，原模块继续重导出既有 API。生产计划主模块由 806 行降至 746 行，并撤销其历史超限豁免；冻结超限文件由 47 降至 46。
- 相关生产计划测试、自动生产测试、全量 TypeScript、架构扫描/ratchet、生产前端构建和 191 项迁移仓库只读预检通过；构建仍报告既有大 chunk。
- 此次拆分没有补入 `fa28472f` 遗留的 LinkedIn 视频/图文采集，后者涉及当前付费采集准入，仍须针对现行路由单独集成和测试。

## 图片付费异常状态修正（2026-10-22）

- 单图渲染路由现区分供应商明确拒绝与无法判定是否收费的异常：明确拒绝的 Job 记为 `failed`，结果不明仍记为 `outcome_unknown` 并禁止自动重试。此修正消除了“接口说未产生图片费用、耐久任务却永久待对账”的不一致。
- 图片专项 27/27 与 workflow 合同 2/2、TypeScript 全量检查、架构扫描/ratchet、生产前端构建和 191 项迁移仓库只读预检通过；生产构建仍有既有大 chunk 提示。
- 这不是供应商回执自动对账或轮播/GIF 多输出实现；未知状态仍需恢复/核对链路，未做真实付费调用或部署。

## 已落库单图素材的非付费恢复（2026-10-22）

- 新增单图 Job 的服务端素材核对入口，并在图片工作台的“待核对”提示中提供明确标注“不重新生成”的次级操作：只有任务/Job/输入哈希、租户归属、唯一素材记录、租户对象定位、字节 SHA 和图片解码全部吻合，才以现有原子 CAS 关联输出。找不到、重复匹配、素材目录不完整或内容损坏时不会再次调用图片供应商，也不会自动触发多模态付费质检。重复核对同一素材保持幂等。
- 新生成的单图任务输出保存稳定的受保护媒体路径，而非短期签名 URL；素材响应仍可按现有机制签发临时访问链接。质量预检也可从租户素材目录读取此前仅保存在本地目录的成片，而不只查询 `materials` DataStore。图片专项 30/30 与 workflow 合同 2/2、TypeScript 全量检查、架构扫描/ratchet、生产前端构建和 191 项迁移仓库只读预检通过；生产构建仍有既有大 chunk 提示。
- 当前只恢复**已落库且服务端可读取**的素材；未落库的供应商结果、跨实例目录共享、轮播/GIF 逐单元交付及自动对账仍未解决。没有访问真实供应商、目标 PocketBase 或部署环境。

## 轮播/GIF 耐久计划（2026-10-22）

- 基于当前集成 HEAD `5b231f371a71347cfef38efa771f09a689ba853e` 增加多输出计划的原子持久化：固定计划版本、输入哈希、每页/底图的 Job ID 与幂等键；相同请求可重放，未解决单元期间禁止修改付费输入。通用任务 PATCH 不能伪造计划或单元元数据。
- 审阅/发布门禁要求所有计划单元及 GIF 最终动图均有已批准素材。多输出供应商认领与 UI 入口仍关闭，故这不是轮播/GIF 生产链路完成，也没有真实付费供应商、目标 PocketBase、数据库迁移或部署操作。
- 图片专项 33/33、workflow 合同 2/2、TypeScript、生产前端构建、架构扫描/ratchet、191 项迁移只读预检通过；既有大 chunk 提示仍在。此处的 HEAD 是本次修改前的比较基线；推进后的权威提交以推送后本地/远端 SHA 核验为准。

## 数字人配置组件拆分（2026-10-22）

- 将 `PresenterManager.tsx` 的形象分组、任务状态文案和本地声音任务恢复解析抽成独立模型模块，保留 `groupPresenterLooks` 原导出入口。主组件从 827 行降到 799 行，并删除其历史超限豁免；冻结超限项由 46 降至 45。
- 组件专项测试 5/5 通过；此前直接在组件源码中寻找 JPEG 编码实现的断言改为检查现有 `presenterVideoFrame.ts`，状态文案断言改为检查拆分后的模型文件。此项仅是结构拆分，不改变录制或供应商行为。

## 图片来源工作树未提交内容复核（2026-10-22）

- 当前图片 AIGC 来源分支的已提交 HEAD `95b0bcc` 已在集成历史内；对其未提交状态做只读核对，代码差异集中于周任务日历改为视频进度表及新增配套组件/测试，不是新的图片生成管线补丁。其分析文件、视频和截图为独立运行产物。
- 因此图片分支的已提交管线与来源树的未提交日历/运行内容必须分开评价；后者仍保留原位，未被归入权威集成基线。`fa28472f` 的 LinkedIn 路由差异仍需独立设计和验证付费采集准入，不能在工作树整理时直接照搬。

## LinkedIn 采集来源边界准备（2026-10-22）

- 从 `fa28472f` 遗留的视频路由差异中先抽出不付费的来源识别与纯帖子行映射：LinkedIn 企业主页、帖子 URL、说明文案、图片、封面/时长及时间证据均可离线判别；伪装域名和缺失视频证据拒绝。账号/视频 URL 判别和 YouTube ID 解析移至独立模块，`videos.ts` 从 10,718 行降至 10,664 行并同步收紧预算。
- CI 新增离线来源边界测试。当前**没有**把 LinkedIn 接入可调用的同步 Apify Actor 路由：现有 Actor transport 在启动后超时无法证明是否已计费，直接照搬来源补丁会产生无回执重试风险。后续需先明确持久化付费认领、Actor run ID/数据集回执恢复，再连通视频和图文采集路径；不要把本批准备工作称为已完成 LinkedIn 采集。

## 视频来源 URL 模块继续拆分（2026-10-22）

- 将账号展示名、跟踪参数清理、平台账号列表页规范化和 YouTube 缩略图 URL 继续移入 `videoCrawlerSourceUrls.ts`，路由保留原有 `accountLabelFromUrl` 导出。`videos.ts` 从 10,664 行降至 10,606 行，历史预算同步下调；功能路径未接入新的付费 Actor。
- 离线来源测试 5/5、既有 crawler fallback/reference grouping 测试通过。已确认现行 `runPaidApifyTikTokDataset` 虽可对 Actor 提交做未知结果保护，但其付费许可属于周计划 TikTok 专用账本；不能把它视为 LinkedIn 的预算授权。

## 社媒集成与发布路由结构拆分（2026-10-22）

- Instagram Login 的授权码交换、专业账号读取与长期令牌续期从 `server/integrations/social.ts` 移入 `instagramLogin.ts`，原导出路径保留；主集成文件从 860 行降至 773 行。
- 发布记录的公开视图、数值/JSON 解析、受保护视频预览 URL 和已发布目标判别从 `server/routes/publishing.ts` 移入 `server/publishing/postPresentation.ts`；路由从 863 行降至 784 行。两项历史超限豁免已删除，剩余 43 项。
- Instagram Login 专项 2/2、发布记录新测试 2/2 与日历加载回归通过。此拆分没有触发 OAuth、平台发布或其他外部请求；仅调整模块边界和测试覆盖。

## 素材供应计划纯策略拆分（2026-10-22）

- 将库存标准化、默认镜头、可用性/制作路由判别、账号主播锁与备用策略从 `shared/socialContentAssetSupply.ts` 移到纯策略模块，并保持 `inferSocialAssetAvailability` 既有导出。主文件从 894 行降至 793 行，历史超限豁免由 43 项降至 42 项。
- 同时修正原有免费 `material_cut` 路径：本地已验证片段仍保留精确时间窗，但不再携带面向生成的 `materialRouting` 合同；避免免费剪辑被解释为付费画面生成准入。相关素材供应/类型路由/时间线测试 25/25 通过。

## 数字员工导航与配置快照拆分（2026-10-22）

- 将深链接映射、Studio 任务归因与一次性返回上下文移入 `digitalEmployeeNavigation.ts`；将历史配置展示的 fail-closed 投影及展示指纹移入 `digitalEmployeeConfigSnapshot.ts`，`digitalEmployees.ts` 保留原公共导出。主文件从 1,018 行降至 779 行，撤销历史豁免；剩余 41 项。
- 新导航/配置专项 5/5、周计划历史快照兼容测试通过。`DigitalEmployeePage.contract.test.ts` 的全文件执行仍被一条与本批无关的旧断言阻断：它要求已提交的 `RestoredAgentWorkCalendar.tsx` 使用 `AgentVideoProductionBoard`，而该基线实际仍渲染 `LsCalendar`。该失败不能被计为本批导航回归通过，也不应仅为凑绿擅自改变当前日历产品界面。

## 轮播/GIF 逐单元认领合同（2026-10-22）

- 在耐久计划之上增加仅供服务端调用的逐单元原子认领：必须匹配租户、冻结计划来源哈希、计划版本、单元顺序、Job ID、幂等键和计划输入哈希；并发重复认领只能有一次成功。未完成前序单元、失效计划及未验证原子存储均拒绝。
- 现有单图付费入口继续拒绝轮播/GIF，未连接供应商执行、素材回写、逐单元费用结算、GIF 合成与 UI；此处只完善状态机合同，**不能**表述为多输出管线已可用。
- 图片专项 34/34 与 workflow 合同 2/2、TypeScript、生产构建通过；生产构建仍提示大 chunk。未调用真实付费供应商，也未部署。

## 平台发布媒体边界拆分（2026-10-22）

- 将本地视频格式/大小校验、公开素材暂存和 Instagram 兼容转码从 `platformPublisher.ts` 抽至 `publishVideoMedia.ts`，主发布模块由 873 行降至 787 行，撤销历史超限豁免；冻结超限项从 41 降至 40。
- 新增媒体校验测试 1/1；发布恢复、Instagram 原生发布、来源声明和原子存储相关专项通过。TikTok 旧专项仍在入口的统一文案预检处失败：其测试输入未提供必需文案，执行尚未进入本次拆出的媒体模块，因此不能将发布专项整体计为通过。
- TypeScript、架构扫描/ratchet、生产构建与 191 项迁移仓库只读预检通过；构建仍提示大 chunk。没有调用真实发布平台、运行迁移或部署。

## 认证身份辅助模块拆分（2026-10-22）

- 将本地预览 Origin/回环地址判定、本地账号凭据读写/密码比对和 PocketBase 登录身份解析从 `server/routes/auth.ts` 抽入 `server/auth/authIdentityHelpers.ts`；路由保留既有公开导出。`auth.ts` 由 890 行降至 792 行，撤销历史超限豁免，剩余 39 项。
- 本地预览测试夹具明确声明其断言允许的 5183 端口，未改变生产默认 Origin。该测试及邀请注册测试通过；TypeScript、架构扫描/ratchet、生产构建及 191 项迁移仓库只读预检通过，构建仍有大 chunk 警告。
- `test:security-boundaries` 全链在 `adminSecretResponse.test.ts` 的已有前端源码正则断言处失败，期望特定 `setForm` 字面写法，而当前组件使用 `withoutPlatformCredentials`；此失败与认证模块拆分无关，但全链不能计为通过。未执行外部登录、付费调用、迁移或部署。

## 过时测试夹具与安全门禁收口（2026-10-22）

- 安全响应测试不再只比对四个 Secret 的固定源码字串，改为确认成功保存分支清空 YouTube、Meta、Instagram、TikTok 和 LinkedIn 五个 Secret 草稿；生产组件原已执行这五项清空。`test:security-boundaries` 全链通过。
- TikTok/YouTube 发布并发测试夹具补齐当前统一发布预检必需的文案，使测试实际到达付费前认领、并发阻断和未知回执恢复分支；发布相关 11 项测试通过。两处都只修正测试合同，没有放宽生产安全规则，也没有调用真实发布平台。

## 其他工作树只读复核（2026-10-22）

- 当前仓库共有 19 个已登记工作树；集成工作树干净。8 个干净的 exact-Qwen/weekly-exact/carry 来源工作树虽然含有相对集成分支的独有提交 SHA，但逐分支 `git cherry -v` 均显示这些提交已有 patch-id 等价版本，不应重复 cherry-pick，也不能仅以祖先关系否定其内容已集成。
- 另有 5 个工作树仍含未提交文件：`local-preview-1002`、`local-integrated-flow`、`local-unified-20261010`、`mobile-dual-edition-20261012`、`total-merge-langgraph`。这些文件兼有源码与大量运行数据；本次只读盘点，没有覆盖、提交、删除或归档任何来源工作树。它们的未提交内容不属于权威集成基线。
- 图片 AIGC 工作树已提交的 HEAD `95b0bcc` 是集成 HEAD 的祖先。其未提交源码主要是将 Agent 周任务日历替换为视频进度表及配套 `VideoProgressTable`，并非新的图片生成管线提交；是否纳入当前产品日历属于独立界面选择，不能作为“图片 AIGC 合并遗漏”直接覆盖现有界面。轮播/GIF 多输出服务端执行与交付仍未完成。

## 社媒内容任务计划边界拆分（2026-10-22）

- 将工作包选择和周计划父子任务编排抽入 `socialContentTaskPlanning.ts`；后者以任务创建函数注入避免运行时循环依赖，原 `socialContentTasks.ts` 公共入口保留。主模块从 913 行降至 784 行，撤销超限豁免，剩余 38 项。
- 社媒内容工作流 HTTP 回归通过，覆盖周计划两项子任务、租户隔离、幂等、限额和工作包完整性；TypeScript、架构扫描/ratchet、生产构建及 191 项迁移仓库只读预检通过。生产构建仍有大 chunk 提示；没有调用真实付费服务、执行迁移或部署。

## 持久内容队列准入边界拆分（2026-10-22）

- 将任务准入、受阻素材修订暂存、租户队列读模型及并发限额配置从 `server/contentExecution/durableQueue.ts` 移入 `durableQueueAdmission.ts`；原入口重导出既有 API，调度、认领、结算和运行控制继续留在主模块。主模块由 946 行降至 762 行，撤销历史超限豁免，剩余 37 项。
- 队列专项 35/35 通过，覆盖幂等准入、并发认领、客户限额、暂停/恢复与供应商回执保留。TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读预检通过；构建仍有大 chunk 提示。没有真实付费调用、迁移或部署。

## 图片多输出计划指纹与请求指纹分离（2026-10-22）

- 逐单元认领不再把冻结计划指纹误写入 `generationJobs.inputHash`：服务端调用者必须提供 64 位实际渲染请求哈希，计划指纹继续保存在 `plannedInputHash`；两个身份分别约束计划来源与供应商请求。并发只认领一次、错误哈希拒绝，输出回写只接受实际请求哈希；完成首单元后可认领下一单元。
- 单图渲染路由仍显式拒绝轮播/GIF；此修正是接入多输出前的耐久身份合同，不代表供应商执行、费用结算、GIF 合成或 UI 已开放。图片专项 34/34 与 workflow 合同 2/2、TypeScript、架构扫描/ratchet、生产构建、191 项迁移只读预检通过；构建仍有大 chunk 警告。未做真实付费调用或部署。

## 产品表格解析按需加载（2026-10-22）

- 将 `xlsx` 从产品导入模块的静态运行时依赖改为文件解析时动态加载；类型仍静态检查，CSV/XLS/XLSX 文件信封、ZIP 展开上限、单元格与文本量门禁保持原样。产品导入与安全解析测试 6/6 通过。
- 实际生产构建中 `enterpriseProductAssetUpload` 共享块由约 388 kB 降至约 26 kB，`xlsx` 成为按需加载的约 492 kB 独立块。`index`、`AiCreateStudio` 与 `DigitalEmployeePage` 仍分别约 824/881/920 kB，故大 chunk 警告**仍未消除**。TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读预检通过；未部署。

## 回复草稿翻译与事实校验边界拆分（2026-10-22）

- 将翻译/文本清理和事实验证提示词、风险解析、安全降级分别移入 `draftReplyLanguage.ts`、`draftReplyVerification.ts`；`draftReply.ts` 保留路由编排及原行为，由 979 行降至 781 行，撤销历史超限豁免，剩余 36 项。
- 新模块直接测试、草稿事实版本合同、回复规划与事实安全测试通过；TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读预检通过，构建仍有大 chunk 提示。
- 更宽的 `test:customer-service` 链在既有 `customerReplyUiContract.test.ts` 源码断言处失败：它要求 `ConversionPage.tsx` 两次出现 `translatedBody: result.translatedDraft`，而当前组件无此字面写法。本批未改该组件，故不能宣称客户服务全链通过；需独立核验实际翻译在自动回复/人工承接消息中的保留行为，不能仅为凑绿修改断言。

## 客户回复 UI 合同与现行发送路径对齐（2026-10-22）

- 复核源码与提交历史：上述 `translatedBody: result.translatedDraft` 断言创建于 8 月的自动发送路径，当前界面在 9 月已改为人工确认发送。服务端返回的中文译文仍映射到草稿；手动输入与经人工确认的 AI 草稿均先翻译成客户目标语言，再通过 `queueSend` 同时保留中文原文，时间线用 `translatedBody` 保存可回看的中文文本。未恢复旧自动发送行为。
- 将合同测试改为检查现行两条发送入口及真实客户通道状态展示，撤销已不存在的 UI 字面写法要求；没有修改生产组件。`test:customer-reply-ui` 与完整 `test:customer-service` 均通过。隔离测试产生预期的 PocketBase 无网络日志，但进程退出码为 0。此项不改变仍剩余 36 个超限文件或生产构建的大 chunk 提示。

## 跟进发送 Worker 纯逻辑边界拆分（2026-10-22）

- 将预检结果文案、客户本地发送时间窗、值解析与客户风险分类分别移至 `followupDispatchPresentation.ts`、`followupDeliveryWindow.ts` 和 `followupDispatchHelpers.ts`。原 Worker 保留准入、调度、供应商回执及持久化编排，对外导出保持兼容；由 901 行降至 772 行，撤销其历史超限豁免，剩余 35 项。
- Worker 与原生每周跟进专项测试、TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读预检通过。构建仍报告 `index`、`AiCreateStudio`、`DigitalEmployeePage` 三个约 824/881/920 kB 的大块；本次并未通过调高阈值掩盖警告。未触发真实发送、执行迁移或部署。

## 图片多输出已存素材恢复（2026-10-22）

- 轮播/GIF 单元在供应商素材已持久化、任务输出回写丢失或结果未知时，可按同租户、任务 ID、单元 ID、实际渲染请求哈希、素材字节哈希与冻结计划中的版本/索引/角色/标签进行只读核对，再关联已有素材。重复恢复保持幂等；错误单元或角色拒绝关联。首个轮播单元恢复后，下一单元可按原计划认领，不会重付首单元费用。
- 图片专项 36/36、工作流合同 2/2、TypeScript、架构扫描/ratchet、生产构建及 191 项迁移仓库只读检查通过。此项只补全事故恢复边界，**不代表**多输出供应商执行、GIF 合成/交付或 UI 已开放；`index`、`AiCreateStudio`、`DigitalEmployeePage` 的大 chunk 警告仍在。未调用真实付费供应商、执行迁移或部署。

## 图片多输出冻结请求准入（2026-10-22）

- 多输出渲染输入现可从持久化任务和冻结单元独立推导：海报页、尺寸比例、质量、产品/素材 ID、参考图、幂等键及单元提示均不采信浏览器临时字段。认领前重算每个单元的内容哈希，并核对计划版本、索引、角色、作业身份和原始任务快照；海报被改写但 ID 未变也会拒绝认领。
- 图片专项 37/37、工作流合同 2/2、TypeScript、架构扫描/ratchet、生产构建及 191 项迁移仓库只读检查通过。服务端生成入口尚未使用这份冻结请求提交付费调用，工作台仍明确关闭轮播/GIF，因此本次只是执行前合同，**不是**多输出功能已交付。构建的三个大 chunk 提示未消除。

## 轮播页服务端渲染入口接线（2026-10-22）

- `/studio/fb-poster/render` 对关联轮播任务先读取同租户冻结单元，海报页、叙事角色、素材/产品、参考图、比例、质量、交付类型、生产策略和幂等键均由服务端推导，不继承浏览器临时字段；实际供应商请求哈希保留冻结单元指纹，再经原子认领。成片节点写回对应页的角色与标签。GIF 入口继续显式拒绝付费调用，待背景板与固定图层合成、完整交付接线后再开放。
- 将海报字段规范化与本地参考文件定位拆出 `studioPosterHelpers.ts` 并加直接测试，`studio.ts` 当前 11361 行，冻结预算同步降至 11361；超限文件总数仍为 35。图片专项 39/39、路由源码合同、工作流合同 2/2、TypeScript、架构扫描/ratchet、生产构建及 191 项迁移仓库只读检查通过。
- 工作台仍将轮播/GIF 标为不可选；本批没有隔离 HTTP 全流程与真实供应商验收，**不能称轮播或 GIF 已端到端交付**。生产构建的三个大 chunk 提示仍在；未调用真实付费供应商、执行迁移或部署。

## 轮播工作台逐页执行与恢复（2026-10-22）

- 轮播类型在图片工作台开放选择；保存策划后先冻结四页单元，再按序提交每页。浏览器只向渲染 API 发送任务/单元 ID，绝不发送临时海报或素材覆写。每页须收到带耐久素材节点的服务端任务才会继续下一页；网络/供应商结果不明、用户停止等待或未持久化输出都会终止本轮自动提交。刷新后可跳过已保存页，未知页只能核对已落库素材，不会自动重付。GIF 仍关闭。
- 审阅区按冻结计划逐页预览和下载；视觉预检以每页冻结标题/副标题核对，轮播总体通过只统计所有页均通过的硬检查。轮播尚不宣称支持单图式分层局部修复，相关按钮未误开放。
- 图片专项 42/42、路由/工作台合同与工作流合同 2/2、TypeScript、架构扫描/ratchet、生产构建及 191 项迁移仓库只读检查通过。尚无隔离 HTTP 全流程、真实付费供应商及浏览器人工验收；供应商明确拒绝后如何安全废弃未提交页并重新规划仍待接线，故“轮播端到端完成”仍**未验证**。35 个历史超限文件及三个大 chunk 提示未收口；未部署。

## 轮播计划安全废弃与重新规划（2026-10-22）

- 供应商明确拒绝某页时，工作台可经显式费用提示废弃当前轮播计划并返回输入。服务端在同租户原子 CAS 下仅关闭确定未提交的排队单元，保留已生成素材、付费回执和失败记录；运行中或结果未知的单元一律拒绝废弃。旧计划输出标记为非当前成片，新计划版本和单元 ID 单调递增，旧认领不能复用。
- 图片专项 44/44、路由/工作台合同、工作流合同 2/2、TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读检查通过。轮播仍缺隔离 HTTP 全流程、真实供应商及浏览器人工验收，GIF 仍关闭；35 个历史超限文件和三个大 chunk 提示尚未收口。未调用真实付费供应商、执行迁移或部署。

## 社媒内容上传模块边界拆分（2026-10-22）

- 将跨进程上传租约准入移入 `socialContentFileAdmission.ts`，将文件类型/魔数检查、后端文件端口、素材端口及临时文件清理等基础能力移入 `socialContentFilePrimitives.ts`；原 `socialContentFiles.ts` 对外重导出既有 API。主模块由 968 行降至 789 行，撤销其历史超限豁免，剩余 34 项。
- 后端文件与社媒内容工作流测试通过（两个测试文件）；TypeScript、架构扫描/ratchet、生产构建及 191 项迁移仓库只读检查通过。构建仍提示三个大 chunk；没有调用真实付费供应商、执行迁移或部署。

## 社媒脚本基线合同与兜底场景拆分（2026-10-22）

- 将脚本基线持久化合同及事实快照类型移入 `socialContentScriptBaselineContract.ts`，将受控系统主题兜底场景移入 `socialContentScriptFallbackScenes.ts`；原模块保留现有导出和冻结/解析逻辑。主文件从 971 行降至 790 行，撤销其历史超限豁免，剩余 33 项。
- 脚本来源、灵感结构、导演计划及自动生产四组专项通过；TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读检查通过。构建的三个大 chunk 警告仍在；未调用真实付费供应商、执行迁移或部署。

## 周包执行计划编排与持久化分层（2026-10-22）

- 将周包七类工作流的任务图规划、依赖/预算/日程安排和主辅代理链身份移入 `weeklyExecutionPlanner.ts`；`executionTasks.ts` 保留持久化、租约、激活、取消及服务入口，并重导出原规划 API。原模块由 983 行降至约 560 行，规划器约 430 行；撤销历史超限豁免，剩余 32 项。
- 执行任务、流水线和续跑专项 27/27 通过；TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读检查通过。构建大 chunk 提示仍在；未调用真实付费供应商、执行迁移或部署。

## YouTube 账号与 OAuth 辅助边界拆分（2026-10-22）

- 将 OAuth 状态/回调页面、账号凭据封存与更新、频道分析降级读取、回跳地址及视频路径规范化移入 `youtubeAccountSupport.ts`，路由文件保留 HTTP 处理并由 1046 行降至 799 行；撤销超限豁免，剩余 31 项。回调 HTML 的内联 JSON 现转义尖括号，防止授权错误消息中的 `</script>` 结束脚本。
- 新增同源回跳/HTML 转义/重定向测试；生产就绪夹具补上配置中既有的 LinkedIn 回调预期。相关 7/7、TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读检查通过。三个大 chunk 警告仍在；未实际发起 OAuth、付费调用、迁移或部署。

## 参考视频证据与脚本生产路由拆分（2026-10-22）

- 将参考视频精确分析、时间线边界规范化、已核验语音行、结构化镜头与实体身份替换规则抽入 `socialContentReferenceEvidence.ts`；`socialContentScriptSources.ts` 保留镜头生产契约、素材计划及对外组包入口，并重导出原公共 API。原模块从 1423 行降至 787 行，新证据模块 662 行；撤销历史超限豁免，剩余 30 项。
- 脚本来源、参考保真、灵感结构和生产路由消费专项 20/20 通过；TypeScript、架构扫描/ratchet、生产构建及 191 项迁移仓库只读检查通过。构建仍有三个大 chunk 提示；未调用真实付费供应商、执行迁移或部署。

## 社媒内容记录投影与任务详情分层（2026-10-22）

- 将任务摘要、输入解析、素材候选投影和授权人物库存读取移入 `socialContentRecordProjection.ts`；`socialContentRecords.ts` 保留详情组装、关联子记录读取及原有公共重导出，并移除拆分后多余的运行时依赖。主模块由 1319 行降至 600 行，投影模块 729 行；撤销超限豁免，剩余 29 项。
- 素材候选、素材权限和社媒内容 HTTP 工作流三组专项通过；TypeScript、架构扫描/ratchet、生产构建及 191 项迁移仓库只读检查通过。构建仍有三个大 chunk 提示；未调用真实付费供应商、执行迁移或部署。

## 社媒 Agent 导演规划与执行组装分层（2026-10-22）

- 将导演分镜、真实证据需求、产品选择及可用能力候选排序移入 `socialContentAgentWorkflowPlanning.ts`；`socialContentAgentWorkflow.ts` 保留执行场景、预算审阅与工作流组装，并清理拆分后多余依赖。主文件由 1290 行降至 580 行，规划模块 724 行；撤销超限豁免，剩余 28 项。
- Agent 工作流、能力刷新与生产计划专项 15/15 通过；TypeScript、架构扫描/ratchet、生产构建及 191 项迁移仓库只读检查通过。构建的三个大 chunk 警告仍在；未调用真实付费供应商、执行迁移或部署。

## 社媒平台 OAuth 与账号辅助边界拆分（2026-10-22）

- 将 TikTok、Meta、Instagram、LinkedIn 的 OAuth 回调辅助、账号封存/更新和平台连接逻辑抽入 `socialOAuthSupport.ts`；`social.ts` 保留 HTTP 路由及原有公开上传响应导出。路由由 1269 行降至 713 行，辅助模块 585 行；撤销超限豁免，剩余 27 项。回调 HTML 的内联 JSON 现转义尖括号，避免供应商错误文本以 `</script>` 注入。
- 新增同源回跳与脚本注入回归测试；相关受控平台配置、支持会话只读测试合计 6/6 通过。TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读检查通过。构建仍有三个大 chunk 警告；未发起真实 OAuth、付费调用、迁移或部署。

## 管理路由视频告警与账号支持边界拆分（2026-10-22）

- 将视频告警/灵感列表的汇总与缓存辅助移入 `adminAlertSupport.ts`，将试用账号、升级正式客户及支持访问会话路由移入 `adminAccountRoutes.ts`，在原位置注册以保持中间件和路由顺序。`admin.ts` 由 1415 行降至 727 行；两个新模块分别为 382/307 行，撤销超限豁免，剩余 26 项。
- 密码不可恢复性合同改为核对新路由文件及其挂载点，仍断言响应不含明文/可逆密码；管理员认证、支持访问、交付入口和密码安全四组专项通过。TypeScript、架构扫描/ratchet、生产构建与 191 项迁移仓库只读检查通过。构建的三个大 chunk 提示仍在；未执行真实支持会话、迁移或部署。

## 补丁等价的干净来源工作树收口（2026-10-22）

- 用户明确选择归档 8 个 exact-Qwen/weekly-exact/carry 候选工作树。逐一复核 `git status --porcelain` 均为空，`git cherry` 对集成分支均无未覆盖的正向补丁；各树唯一的忽略项是可重建的 `node_modules/`。这些目录不是当前任务可由 Codex 托管归档的工作树，因此使用 `git worktree remove` 退出注册并清理检出目录；全部命名分支和提交仍保留，可用 `git worktree add` 恢复源码检出，但 `node_modules/` 需重新安装。这不是 Codex 的工作树快照归档。
- 五个含未提交内容的来源工作树未动，其他干净工作树也未动。详见 [`WORKTREE-INVENTORY.md`](./WORKTREE-INVENTORY.md)。

## 频道总览与连接配置页面拆分（2026-10-22）

- 从 `YouTubeIntegration.tsx` 抽出频道总览的数据读取、视频/评论展示及完整页面到 `ChannelOverview.tsx`；原入口继续重导出 `ChannelOverview`、`YouTubeContent` 和默认页面，YouTube/社媒连接面板仍留在原模块。原文件由 1199 行降至 789 行，新模块 430 行，撤销超限豁免，剩余 25 项。
- TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读检查通过；对原模块五个页面导出做了运行时加载检查。构建仍有三个大 chunk 提示；未执行真实 OAuth、迁移或部署。

## 管理员交付页接入向导拆分（2026-10-22）

- 将平台配置字段、密钥只写输入、交付进度条和平台接入向导移入 `AdminDeliveryComponents.tsx`；`AdminDeliveryPage.tsx` 保留租户列表、保存/测试编排及页面入口。两文件分别为 557/703 行，撤销原页面的超限豁免，剩余 24 项。
- 密钥响应回归测试同步核对新向导实现及页面挂载，不放宽原有只写断言；专项 2/2 通过。TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读检查通过，页面和组件导出可加载。构建仍有三个大 chunk 提示；未执行真实平台连接、迁移或部署。

## 插件接入与技能目录分层（2026-10-22）

- 将 Skill 元数据、详情抽屉、卡片及目录页移入 `PluginSkillsTab.tsx`；`PluginsPage.tsx` 保留插件安装、配置与工具交互。原文件由 1088 行降至 608 行，新模块 486 行，撤销超限豁免，剩余 23 项。
- 插件访问合同测试通过；TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读检查通过，页面与技能目录导出可加载。构建仍有三个大 chunk 提示；未连接真实外部插件或部署。

## 工作区管理页面与内容运营映射拆分（2026-10-22）

- 将内容运营概览的响应映射、指标标签与本地预览数据移入 `workspaceContentOps.ts`，将组织成员/权限页面移入 `OrganizationPermissionsPage.tsx`；`WorkspaceManagementPages.tsx` 保留脚本库、Agent 记忆页面及组织权限重导出。原文件由 1008 行降至 758 行，新模块分别为 128/135 行，撤销超限豁免，剩余 22 项。
- 工作区管理合同测试继续覆盖组织角色保护、删除确认和记忆编辑，专项 3/3 通过；TypeScript、架构扫描/ratchet、生产构建及 191 项迁移仓库只读检查通过，原三个页面导出可加载。构建仍有三个大 chunk 提示；未访问真实客户数据、执行迁移或部署。

## 构建体积归因（2026-10-22）

- 对三个大 chunk 做了 source map 归因并记录在 [`BUNDLE-CHUNK-ANALYSIS.md`](./BUNDLE-CHUNK-ANALYSIS.md)。依赖分组试验虽缩小首屏 `index`，却造成大量小 chunk 且未解决两个业务页面告警，因此已撤回；目前构建行为不变，后续应按真实页面/步骤边界拆分。

## 数字员工页按需加载边界（2026-10-22）

- 将经营看板及其命名视图、周复盘改为按需加载，并在页面使用处加局部加载提示；声明集中在 `digitalEmployeeDeferredViews.tsx`，新增边界合同测试。`DigitalEmployeePage` 的架构行数预算由 5447 收紧到 5446 行，剩余超限文件仍为 22 项。
- 聚焦测试 7/7、TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读检查通过。数字员工主 chunk 由约 920 kB 降至约 487 kB；`index` 和 `AiCreateStudio` 仍超 500 kB。三项旧 UI 宽范围合同在变更前 HEAD 的源文件中也缺少其预期标记，本批未修改这些无关合同断言；未执行真实生产任务、迁移或部署。

## 登录与应用布局互斥加载（2026-10-22）

- 将 `AuthScreen` 和 `Layout` 置于 `AppDeferredShell.tsx` 的独立懒加载边界，并在 `App.tsx` 中分别提供页面加载提示；未登录时不加载完整工作台布局。`App.tsx` 的架构行数预算由 1119 收紧到 1118，剩余超限文件仍为 22 项。
- 壳层/导航/登录等聚焦测试通过，TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读检查通过。本地生产预览未登录页实际加载、浏览器错误日志为空；未输入账号或调用付费接口。`index` chunk 由约 806 kB 降至约 231 kB，当前仅 `AiCreateStudio` 仍超 500 kB。

## 人物素材路由上下文边界拆分（2026-10-22）

- 将人物目录整理、专属账号归属检查、预算工厂、任务查找与安全刷新辅助移入 `presenterAssetSupport.ts`；`presenterAssets.ts` 保留 HTTP 路由及原有导出。路由文件由 919 行降至 794 行，新模块 151 行，撤销超限豁免，剩余 21 项。
- 音色绑定旧测试 fixture 补齐了基线安全合同已要求的授权用途与供应商范围，未放宽生产校验；人物创建/授权/隔离/音色专项 7/7 通过。TypeScript、架构扫描/ratchet、生产构建和 191 项迁移仓库只读检查通过；未调用真实 HeyGen、执行迁移或部署。`AiCreateStudio` 大 chunk 告警仍在。

## Studio 不可达步骤清理（2026-10-22）

- `AiCreateStudio` 的旧 `renderStep` 仅能被 `mode` 和 `poster` 调用；清除其他五个不可达分支，文件由 17,807 行降至 14,633 行，预算同步收紧，超限文件仍为 17 项。可达性合同防止重新把真实步骤误接入旧渲染器。
- 旧素材筛选原先只存在于不可达分支，已在实际挂载的分镜素材库提供“我的生成”与生成类型筛选，沿用统一生成素材投影。源码合同改为核验真实工作台和实际挂载组件，且筛选逻辑有直接测试。
- 相关 Studio、路由安全与社媒导航合同 34/34、TypeScript、架构扫描/ratchet、生产构建和 191 项迁移只读检查通过；`AiCreateStudio` 主 chunk 从约 772 kB 降至约 603 kB，**仍有大 chunk 告警**。未调用真实付费服务、执行迁移或部署；浏览器工作流回归和继续拆分可达工作台仍待完成。

## 社媒执行方案转换边界拆分（2026-10-22）

- 将审核后的素材候选映射、规范类型路由回绑和完整性断言移入纯转换模块 `socialContentExecutionPlan.ts`；生产执行器维持原有导出接口，主文件由 2221 行降至 2137 行，并同步收紧历史预算。超限文件仍有 10 项，不能视为已完成整体架构拆分。
- 在代码提交 `4cdef8e60e24cd1c76952f501a49d66f25459103` 的临时干净检出中，聚焦的生产执行及素材供给测试、TypeScript、架构扫描和生产构建通过；迁移清单只读检查为 191 项、零阻塞，`AiCreateStudio` chunk 为 497090/500000 字节。架构 ratchet 在共享检出中以变更前 HEAD 为基准通过。
- 更宽的 `enterpriseProductFootageVisualReview.test.ts` 有一项在素材审阅准入处报 `product_footage_shot_review_required`；以改动前 `0bbccd17` 的临时干净检出复测得到相同失败，确认它不是本批引入，但全文件仍不能计为通过。
- 集成工作树仍有另一广告任务的未提交源码及迁移改动，本批没有修改或提交它们。共享工作树不算干净，本批的独立代码基线验收仅指上述干净提交检出。未发起真实付费调用、执行迁移或部署。

## 客服三栏工作台结构拆分（2026-10-22）

- 代码提交 `4f14df0bf532b633991d0853ced130fe8b7083eb` 将聊天列、左侧客户列表、右侧客户信息栏与共享展示字段拆成独立模块；`ConversionPage.tsx` 从 2492 行降至 1368 行，历史预算同步收紧。新模块分别为 400、192、540、14 行，均低于 800 行。页面仍为超限文件，当前超限文件总数仍为 10，不把三栏拆分称为整个页面或整体架构治理完成。
- 三栏/滚动布局、翻译发送、客服开关、模拟客户隔离、报价卡、应用入口与工作台合同测试通过；源码合同随实现位置调整，保持原检查内容。此前客服开关合同仍读取旧 `historyImport.ts`，本批改为分别核对实际的 `historyInbound.ts` 和 `historyPolicy.ts`，并核对主页面挂载右栏及右栏总开关。
- 在该代码提交的临时干净检出中，TypeScript、架构扫描、生产构建及 191 项迁移清单只读检查通过；`AiCreateStudio` chunk 为 497108/500000 字节。以变更前 HEAD 为基准的架构 ratchet 和 ratchet 测试在共享检出通过。临时检出已移除。
- 集成分支的共享工作树仍含另一广告任务的未提交代码和迁移改动，本批未触碰或提交。未做登录后的浏览器全链验收、真实客户发送、付费供应商调用、迁移执行或部署；源码基线、运行数据和供应商 Ready 状态仍应分别判断。

## 客服回复准备边界拆分与超限例外（2026-10-22）

- 代码提交 `402b9e468cef0c198f097d589751ab7a259fa35e` 将语言判断、草稿请求、翻译回退及人工报价拦截移入 `customerReplyPreparation.ts`，并新增无外部调用的直接测试；类型导入修正提交为 `be8a7d1ff9abb8efcbbd7487eaa473d25122e7c7`。`ConversionPage.tsx` 由 1368 行降至 1060 行，历史预算同步收紧。
- 曾试拆整个页面状态为一个约 460 行、需返回大量变量的 Hook；它只增加跳转和耦合，未改善职责边界，已在提交前撤回。800 行是默认复杂度告警线，不是为达标而机械切分的目标；本页面保留受 ratchet 约束的历史例外，后续只在找到清晰的发送、持久化或会话状态边界时继续拆分。当前超限文件仍为 10 项，不能称整体架构已完成。
- 回复准备直接测试 2/2，三栏/滚动、翻译发送、客服开关、模拟客户隔离、报价卡、应用入口等聚焦合同通过。最终代码提交的临时干净检出中，TypeScript、架构扫描、生产构建及 191 项迁移清单只读检查通过；`AiCreateStudio` chunk 为 497090/500000 字节。架构 ratchet 及其测试在共享检出通过；临时检出已移除。
- 共享工作树仍有另一广告任务的未提交源码和迁移，未触碰或提交。未做真实客户发送、付费供应商调用、迁移执行或部署；源码验收不等于运行或供应商验收。
