# 投流双页工作台验收（2026-10-25）

- 工作树：`/Users/julia1/Documents/ChatGPT/1025投流`；分支 `feature/platform-ads-20261025`；HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`。本轮为未提交功能改动，保留此前脏改动，不推进集成基线，不提交、推送或部署。
- 两个主入口：计划管理、素材分析。智能创编在两个页面右上角打开 Ant Modal，默认 AI 辅助，手动为显式切换；素材目录选中的成片直接带入。投放效果及平台历史留在计划页内展开，旧 `adsOverview` 地址兼容进入计划管理，`adsManaged` 继续打开 AI 投手 Drawer。
- 保存以既有 createTask / generatePlan / updateTask 返回的任务为准，选中新 ID 并写入 adsTaskId；编辑提交 expectedVersion。执行继续使用既有 AdTaskControls、真实资源核对、审批和回执接口，没有新增执行旁路或数据库迁移。
- 增加提交单飞、保存期间禁止关闭与编辑、跨身份迟到响应隔离、弹窗内错误与保留输入。Modal 传送至应用壳外后继续使用共享字体、主题和表单样式；嵌套素材 Drawer / 示例预览保留独立关闭行为。

## 实际验证

- `node --import tsx --test src/components/AdPlanWorkspace.test.tsx`：9/9，覆盖五个目标的 AI 请求配置与进入执行详情、失败后显式手动保存、重复提交、编辑原 ID 与版本、跨身份响应隔离。模型和 API 在此组为受控替身，不是实际 AI 供应商验收。
- `node --import tsx --test src/components/PlatformAdsPage.contract.test.ts src/components/AdPerformanceOverview.test.tsx src/pageRegistry.test.ts`：15/15。
- `node scripts/test-platform-ads.mjs`：63 个文件通过，含任务持久化、多页读取、权限隔离、素材与报告、五目标预检及暂停创建的离线回归。
- `pnpm run lint`：通过。
- `ARCHITECTURE_BASE_REF=dfc9b0c8af85175485cf39370eed92c4be3daedd pnpm run check:architecture`：2757 个生产 TS 文件通过及 ratchet 通过，未扩大预算。
- `pnpm run build`：通过，Studio 367202/485000 字节；保留既有大 chunk 提示。
- `git diff --check`：通过。未运行全仓 quality / verify。

## 浏览器与本地数据库

- 在已有登录的 `127.0.0.1:5237` 对真实本地后端 `9037` 和 PocketBase `8991` 操作。
- 选取当前企业已核验 MP4、关联 Lucy Chang CNY 账户，创建本地测试草稿 `xj6bpsf2et17hnu`；自动进入计划管理执行详情。刷新后仍能恢复同一计划。
- 编辑预算 500 → 520，版本 1 → 2，账户、素材 SHA、加拿大定向、文案、日预算 12 均保留。独立登录后经 API 读回并断言列表只有一个同 ID 记录；证据 `tmp/ads-preview/workspace-persisted-readback.json`。
- 计划内打开报告定位同一计划；没有广告回执时保留“—”。从计划到素材页显示已选源视频及尚未绑定/上传状态。素材目录选择成片能打开默认 AI 创编弹窗并带入文件。
- 桌面弹窗左右布局、390px 窄屏弹窗及示例入口已检查，临时视口恢复。截图保存在 `tmp/ads-preview/workspace-ai-dialog.jpg`、`workspace-mobile.jpg`、`workspace-plan-list.jpg`。

## 边界和恢复

- 本轮没有真实模型生成、视频上传、Meta 创建/启动、付费或迁移。AI 成功/失败衔接以行为测试验证；真实模型调用仍需单独供应商验收。
- Lucy 账户目前没有可推广主页，且真实执行只允许已合并稳定基线验收；不能据此声称真实广告全链路通过或发布就绪。当前第一条新素材仍需原素材绑定流程；本轮未扩展上传能力。
- 原平台历史、账户目录、数据采集时间、币种/时区、权限和资源映射规则沿用原接口，不以本地计划状态代替实际投放状态。
- 本轮核心文件：PlatformAdsPage、AdCreativeLibrary、platformAds.css、pageRegistry、productSurfaceFlags、相应测试和 UI 规范。当前会话此前改动保留；恢复参考为上述 HEAD 与 `tmp/ads-preview/workspace-before.tsx` 的本轮前快照，不能用整树回退覆盖此前工作。

## 用户截图修订：删除列表顶部两块折叠区

- 移除“查看各平台已实现能力与限制”和“投放效果与平台历史”列表顶层折叠区。保留原后端数据与执行接口；计划详情的“查看此计划投放数据”改为按需打开报告 Drawer。
- 浏览器已验证两个折叠区不再出现、计划列表正常、从原计划详情仍可打开报告侧栏；已打开并刷新当前本地预览，截图 `tmp/ads-preview/plan-list-clean.jpg`。
- `node --import tsx --test src/components/PlatformAdsPage.contract.test.ts src/components/AdPlanWorkspace.test.tsx`：17/17。类型与架构日志分别为 `remove-plan-panels-lint.log`、`remove-plan-panels-architecture.log`；不重复声明此前构建为本次重跑。
- HEAD 仍为 `dfc9b0c8af85175485cf39370eed92c4be3daedd`，保留全部此前未提交改动；无外部投放、数据库迁移、提交、推送或部署。

## 运营双页与后端能力盘点

2026-10-25，仍在原功能分支与上述 HEAD 上开发，未合并或推进集成基线。新增只读素材目录领域投影，预算写入继续使用原合同。

| 已有后端能力 | 原前端情况 | 当前承接 |
| --- | --- | --- |
| tasks PATCH：草稿总预算与日预算、版本校验 | 需要进入完整创编表单 | 列表与详情的预算管理 Modal，保留完整配置和 expectedVersion |
| execute / executions / reconcile：日预算调整与未知结果核验 | 藏在综合平台执行表单，需选技术资源 | 从核验创建回执自动取资源与账户，展示平台预算、拟议值及原回执；当前 paused_only 仍禁止真实调整 |
| tasks metrics：近 7 天目标结果和成本 | Meta 主要进入报告侧栏后才查看 | 计划列表直接展示消耗、结果、成本及采集时间，可见页面每分钟刷新 |
| metrics/history、metrics/sync：历史快照与显式同步 | 页面缺少直接入口 | 计划详情按需展开，读取与写入分开；空报告明确报错 |
| automation/status：持久化 worker 状态 | 仅 AI 投手深层可见 | 列表直接进入 AI 建议与执行记录；明确配置未启用、未知和过期 |
| automation：结构化决策、预算拟议值、规则版本、执行关联 | 与普通创编入口混在一起 | 原 AI 投手集中查看；仅网站访问 CPC 有自动优化算法，不虚构其他目标建议 |
| creative-history / creative-library / account history | 按三个来源 Tab 分离，重复列表 | material-directory 合并为统一筛选与分页目录；前端不建立新素材库 |
| creative reports / lifecycle：广告级与来源关联报告 | 多重侧栏入口、口径不易区分 | 主卡按账户、目标、市场、归因和窗口分组；完整证据按需展开 |
| creative-selection：文件、版本与使用权限核验 | 主要位于创编素材选择器 | 当前企业素材可直接用于新计划；跨企业只读与原片未关联广告不可复用 |
| attach-existing：原片映射修复 | 位于投放素材侧栏 | 保留在“素材关联核对”，不恢复主页面三个 Tab |
| 智能经营交接、平台资源导入、授权恢复 | 已有来源与账户模块承接 | 本轮沿用原入口与 sourceContext，不另建流程 |

### 确认的后端缺口

- 已执行计划追加广告系列总花费上限没有专用动作；不能仅 PATCH 本地预算。
- 没有草稿删除／归档端点及恢复合同，没有逐次草稿预算修改历史（目前仅版本递增）。本轮不提供假删除或假审计。
- 单计划当前限制一份创建资源与单素材绑定，缺少多素材 A/B 编排合同；本轮复用一条素材到新计划。
- 暂无其他目标的已验证自动优化算法；没有可核验利润 ROI 或 CRM 有效询盘归因。真实调预算仍受发布策略、授权和平台条件约束。

### 本轮验证与证据

- `node scripts/test-platform-ads.mjs`：65 个文件通过。随后最终计划范围隔离补充由下述定向组覆盖。
- `node --import tsx --test server/platformAds/materialDirectory.test.ts src/components/AdPlanOperations.test.tsx src/components/PlatformAdsPage.contract.test.ts src/components/AdPlanWorkspace.test.tsx src/pageRegistry.test.ts`：最终 32/32；包含来源版本去重、跨账户及归因分组、失败／截断、计划范围不继承其他计划效果、预算单飞及执行限制。
- `pnpm run lint`、带上述 HEAD 的 `check:architecture`：通过，2763 个生产 TS；未扩大预算。`pnpm run build`：通过，Studio 367202/485000 字节，保留既有大 chunk 提示。`git diff --check`：通过。
- 旧浏览器夹具脚本同步了两个页签、自动资产及只读目录合同，`node --check scripts/test-platform-ads-ui.mjs` 通过；没有运行其独立浏览器驱动。实际交互验收使用当前已登录本地预览。
- 浏览器预算冒烟：原本地测试草稿 `xj6bpsf2et17hnu` 总上限 520 → 540、日预算 12 → 14、版本 2 → 3；API 独立读回验证原账户、国家、文案和素材 SHA 保留，列表同 ID 只有一条。证据 `operations-budget-readback.json`。
- 新目录首屏 API 读取 37 条素材／待关联广告记录、返回 12 条、0 告警、未截断；证据 `operations-directory-readback.json`。其中旧 UI acceptance 平台数据属于原数据库夹具，不是本轮真实投放成功证据。
- 实际读取平台测试资源的日预算 50 与系列上限 500；当前发布策略明确暂停创建限制，“确认调整日预算”禁用，未发起平台预算写入。
- 指标历史读取成功为空；对没有平台报告的草稿点击同步，明确返回“尚无可持久化的平台报告”，未伪装为同步成功。AI 侧栏读回当前配置未启用，无新决策证据，不显示后台正在优化。

### 文件、运行与恢复

- 主要新增：`shared/adMaterialDirectory.ts`、`server/platformAds/materialDirectory.ts` 及测试、`AdPlanManagement.tsx`、`AdPlanBudgetDialog.tsx`、`AdPlanMetricHistory.tsx`、`AdMaterialPerformance.tsx`、`AdPlanOperations.test.tsx`。
- 接线与样式：PlatformAdsPage、AdHistoryMedia、AdCreativeLibrary 的诊断模式、原 creative routes、pageRegistry、测试驱动和 UI 规范。决策见 ADR `2026-10-25-ad-operations-read-model.md`。
- 后端仅为 web 角色，重启加载代码，PID 记录在 `tmp/ads-preview/backend.pid`；PocketBase 原目录、端口和网络限制保留。不迁移、不恢复数据库、不启用 worker、不调用真实模型或广告 POST。
- 本轮开始前页面快照 `tmp/ads-preview/operations-before.tsx` 保留；所有前序脏改动及原 HEAD 保留，不能整树回退覆盖它们。没有提交、推送或部署，不声明外部 E2E／发布就绪。

最终浏览器补验：选中草稿范围时该素材显示“当前筛选 0 条广告”，没有继承其他计划效果；“查看全部计划素材”清除 adsTaskId 后恢复 37 条目录。点击当前企业“用于新计划”打开默认 AI 创编 Modal 并带入原片，未提交新计划。390px 下计划表格取消固定列以避免重叠，检查后恢复默认视口。最终预览截图：`tmp/ads-preview/operations-plans-final.jpg`、`operations-materials-final.jpg`。最后一次类型、ratchet 架构和构建检查均通过。

## 素材页工具栏精简（用户三处标注）

- 源码：`feature/platform-ads-20261025`，HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`，保留原未提交改动，未推进基线。
- 修改 `src/components/AdMaterialPerformance.tsx`：移除“全部投放情况”筛选和对应闲置状态、移除“素材关联核对”入口及其不可达抽屉、移除工具栏下方说明文字。读取接口默认全部投放情况，其余筛选、素材详情和报告保持原逻辑。未修改后台数据或契约。
- `node --import tsx --test src/components/AdPlanOperations.test.tsx src/components/AdPerformanceOverview.test.tsx`：13/13 通过。`pnpm run lint`（TypeScript）、`pnpm run check:architecture`、`git diff --check` 通过；架构未设置 BASE_REF ratchet。日志前缀 `tmp/ads-preview/material-toolbar-removal-`。
- 独立本地浏览器预览确认三处已移除，保留素材来源／目标／账户筛选与刷新，返回 38 条素材记录；截图 `tmp/ads-preview/material-toolbar-removal.jpg`，临时测试标签已关闭。无外部 run/task、无真实广告写入。本次恢复点为上述 SHA 和保留的工作区；未运行全量领域测试或构建。

## 计划状态筛选移除（用户单项标注）

- 修改 `src/components/AdPlanManagement.tsx`：删除“全部核验状态”筛选器及其闲置状态和筛选条件。计划表格状态列、状态统计及其他筛选保持原逻辑。
- HEAD 仍为 `dfc9b0c8af85175485cf39370eed92c4be3daedd`，功能分支保留原未提交内容，无基线推进、后端或数据库改动。
- `node --import tsx --test src/components/AdPlanOperations.test.tsx`：7/7 通过。浏览器确认只保留目标、币种、账户、渠道四个筛选框，截图 `tmp/ads-preview/plan-status-filter-removal.jpg`。临时核对标签已关闭，无外部 run/task 或真实投放操作。
- `pnpm run lint`（TypeScript）、`pnpm run check:architecture`、`git diff --check` 通过；架构未设置 BASE_REF ratchet，未运行全量领域回归或构建。日志前缀 `tmp/ads-preview/plan-status-filter-removal-`。恢复点为上述 HEAD 和保留的工作区。

## 广告账户卡片优化（用户三项标注）

- HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`，分支 `feature/platform-ads-20261025`，保留现有脏改动，未推进集成基线。
- 修改 `AdAccountConnections.tsx`、`adAccountConnections.css`：三个账户复用统一卡片，身份／币种／时区／连接状态／授权检查结果纵向排列；数据操作保留“查看平台已有计划”“同步计划、广告组和广告”；维护操作放在原生 details 中，保留原请求处理、角色变化隔离、失败保护及禁用条件。
- 修改 `AdMetaConnectionGuide.tsx` 移除“绑定帮助与管理员检查”，配置异常仍有直接提示；更新两份相关测试及 UI 权威规范。没有修改授权、同步、广告执行的后端流程。
- `node --import tsx --test src/components/AdAccountConnections.recovery.test.tsx src/components/AdMetaConnectionGuide.test.tsx src/components/AdAuthorizationHealth.test.tsx`：3 个测试文件通过，覆盖原账户重新登录定位、检查失败保留旧状态及身份切换后晚到响应丢弃。
- 浏览器确认三个真实本地账户显示统一卡片；Lucy Chang 维护区域可展开／收起，五项原动作仍在对应位置。只验证展示和展开，没有发起新 OAuth、账户检查或同步请求。截图 `tmp/ads-preview/account-cards-overview.jpg`、`account-cards-maintenance.jpg`，临时标签已关闭。
- 无外部 run/task、无真实广告写入；恢复点为上述 HEAD 与保留的功能工作区。本次不涉及迁移或全量领域验收。
- `pnpm run lint`（TypeScript）、`pnpm run check:architecture`、`git diff --check` 通过。架构检查未设置 BASE_REF ratchet；日志前缀 `tmp/ads-preview/account-cards-`。未运行构建或真实供应商 E2E，不声明发布就绪。

## 计划筛选区固定横排（用户两项标注）

- HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`，分支 `feature/platform-ads-20261025`，保留现有未提交改动，未推进基线。
- 修改 `AdPlanManagement.tsx` 和 `platformAds.css`：搜索、四个筛选框、刷新固定单行 Grid，36px 同高，8px 共享间距；容器不足时仅工具栏横向滚动。币种默认文案精简为“全部币种”。删除指标带后的说明文字。同步 UI 规范，不修改后端或筛选业务。
- `node --import tsx --test src/components/AdPlanOperations.test.tsx`：7/7 通过。浏览器实际 viewport 1280px：六个控件 top 均为 245px、高度均为 36px，页面无横向溢出；截图 `tmp/ads-preview/plan-toolbar-row.jpg`。临时测试标签已关闭，无真实广告操作。
- 尝试 viewport capability 设置 889px，但 DOM 仍报告 1280px，因此不声明完成窄屏实测；已 reset 覆盖。窄屏样式通过容器 min-width／overflow-x 适配，后续可在实际窄窗口人工核对。
- 无外部 run/task，无迁移或完整供应商 E2E。本次恢复点为上述 HEAD 与保留工作区。
- `pnpm run lint`（TypeScript）、`pnpm run check:architecture`、`git diff --check` 通过；未设置 BASE_REF ratchet，未运行构建。日志前缀 `tmp/ads-preview/plan-toolbar-row-`。

## 素材筛选区固定横排（用户标注）

- HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`，`feature/platform-ads-20261025`，保留原工作区，不推进基线。
- 修改 `AdMaterialPerformance.tsx`、`adCreativeLibrary.css`：搜索、来源、目标、账户和刷新使用单行 Grid，统一 36px 高度、共享 8px 间距；窄容器在工具栏内横向滚动。搜索提示精简为“搜索素材、计划或市场”。同步 UI 规范，其他页面工具栏不受该样式作用域影响。
- `node --import tsx --test src/components/AdPerformanceOverview.test.tsx`：6/6 通过。浏览器五个控件 top 均为 245px、高度均为 36px，页面无横向溢出；只验证实际默认窗口尺寸，不声明窄屏实测。截图 `tmp/ads-preview/material-toolbar-row.jpg`，临时标签已关闭。
- 无后端、数据或外部 run/task 变化，无真实广告操作；恢复点为上述 HEAD 与保留工作区。
- `pnpm run lint`（TypeScript）、`pnpm run check:architecture`、`git diff --check` 通过；未设置 BASE_REF ratchet，未运行构建或真实供应商 E2E。日志前缀 `tmp/ads-preview/material-toolbar-row-`。

## 计划列表密度调整（用户两项标注）

- HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`、分支 `feature/platform-ads-20261025`，保留原工作区，未推进基线。
- 修改 `AdPlanManagement.tsx`、`platformAds.css`：搜索提示缩为“搜索计划”，账户默认项缩为“全部账户”；Table 使用 Ant small 局部紧凑模式，单元格垂直 padding 8px，段落 margin 2px，操作项间距 4px、预算按钮 small。完整业务字段与动作保留，未改变筛选／预算／执行逻辑。
- `node --import tsx --test src/components/AdPlanOperations.test.tsx`：7/7 通过。浏览器确认搜索提示完整显示，前三行实测高度均为 111px；截图 `tmp/ads-preview/plan-density.jpg`，临时标签已关闭。仅默认窗口尺寸视觉核对，无外部 run/task 或真实广告写入。
- 遵循 UI 规范 3.4 局部紧凑表格规则，无全局紧凑模式、数据契约或数据库变更。恢复点为上述 HEAD 和保留工作区。
- `pnpm run lint`（TypeScript）、`pnpm run check:architecture`、`git diff --check` 通过。架构未设置 BASE_REF ratchet，未运行构建／全量领域回归；日志前缀 `tmp/ads-preview/plan-density-`。

## 素材投放表现改为紧凑表格（用户标注）

- HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`、分支 `feature/platform-ads-20261025`，保留原脏改动，未推进集成基线。
- 修改 `AdMaterialPerformance.tsx`、`AdHistoryMedia.tsx`、`adCreativeLibrary.css`：原瀑布流替换为共享 Ant small Table，第一列为真实视频缩略图；素材／来源／关联投放／表现摘要／详情与复用依次排列。AdHistoryMedia 新增 thumbnailOnly 展示选项，现有非表格使用不受影响。列表压缩摘要，原 Drawer 完整报告、文件验证与复用动作仍在。
- 更新 `AdPerformanceOverview.test.tsx`，验证报告未齐、读取失败、跨币种／跨目标分组，以及同组加权小计；`node --import tsx --test src/components/AdPerformanceOverview.test.tsx src/components/AdWorkflowRecovery.test.tsx`：22/22 通过。
- 浏览器确认 12 行当前目录，行高 55–57px；打开第二行，原 Drawer 的完整报告、关联计划存在，文件核验后“用此素材创编计划”可用（未点击创建）。滚动至表头可见时，默认 1280×720 窗口完整可见 9 行。截图 `tmp/ads-preview/material-table.jpg`，测试标签已关闭；不声明实际 1137×652 窗口验收。
- 无后端契约、数据库或供应商写入；无新增外部 run/task；恢复点为上述 HEAD 与保留工作区。同步 UI 权威规范，未执行发布或部署。
- 最终 `pnpm run lint`（TypeScript）、`pnpm run check:architecture`、`git diff --check` 通过；架构未设置 BASE_REF ratchet，未运行构建或真实 E2E。日志 `tmp/ads-preview/material-table-lint-final.log`、`material-table-architecture.log`、`material-table-tests.log`。

## 素材搜索框文字垂直居中（用户标注）

- HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`，功能分支保留原脏改动。仅修改 `src/components/adCreativeLibrary.css` 的素材工具栏样式。
- 原输入框因共享高度规则为 36px，嵌在带 6px 上下内边距的 36px 外框内，文字中心向下偏移。限定素材搜索框输入行盒为 22px、清除内层垂直 padding，外框 flex 居中，保持左对齐和 36px 外框。
- 浏览器实测：输入行盒 22px，外框 36px，二者垂直中心偏移 0。截图 `tmp/ads-preview/material-search-center.jpg`，临时标签关闭；未修改查询逻辑、后端或数据，没有外部 run/task。
- 本次为局部可逆 CSS 修正，无新增单元测试；不声明供应商 E2E。恢复点为当前 HEAD 与保留的工作区。
- `pnpm run lint`（TypeScript）、`pnpm run check:architecture`、`git diff --check` 通过；未设置 BASE_REF ratchet，未运行构建。日志前缀 `tmp/ads-preview/material-search-center-`。

## 创编窗口三处提示移除（用户标注）

- HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`，分支 `feature/platform-ads-20261025`，保留原工作区；无基线推进。
- 修改 `PlatformAdsPage.tsx`：删除目标支持情况说明块及不再使用的变量；目标选项的能力标识、原保存与执行校验继续保留。修改 `AdMaterialPicker.tsx`：删除已选素材旁的来源企业和内部内容标签，保留素材名称、更换与清除动作。其他素材详情及选择目录的标签未改。
- 原契约测试要求显示目标说明块，与用户删除要求冲突，首次运行对应 1 项失败；同步该展示断言后，`node --import tsx --test src/components/AdPlanWorkspace.test.tsx src/components/PlatformAdsPage.contract.test.ts`：19/19 通过。
- 浏览器从现有素材详情点击“用此素材创编计划”，验证三个展示项均移除、素材名称及表单正常；未保存或执行广告，未发起 AI 生成。截图 `tmp/ads-preview/create-hints-removal.jpg`，临时标签关闭。
- 无后端契约、数据库或外部 run/task 变更；本次恢复点为上述 HEAD 与保留的工作区。未运行构建或真实供应商 E2E。
- `pnpm run lint`（TypeScript）、`pnpm run check:architecture`、`git diff --check` 通过；未设置 BASE_REF ratchet。日志前缀 `tmp/ads-preview/create-hints-removal-`。
