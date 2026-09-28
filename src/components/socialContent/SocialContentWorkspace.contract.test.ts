import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync(new URL('../../lib/socialContentApi.ts', import.meta.url), 'utf8');
const hook = fs.readFileSync(new URL('./useSocialContentWorkspace.ts', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('./SocialContentWorkspace.tsx', import.meta.url), 'utf8');
const overview = fs.readFileSync(new URL('./SocialTaskOverview.tsx', import.meta.url), 'utf8');
const productionProgress = fs.readFileSync(new URL('./SocialProductionProgressPanel.tsx', import.meta.url), 'utf8');
const runStatus = fs.readFileSync(new URL('./SocialTaskRunStatusPanel.tsx', import.meta.url), 'utf8');
assert.match(productionProgress, /failed_recoverable[\s\S]*重新尝试/, 'recoverable provider failures expose a direct retry instead of forcing the three-step task form');
const replicationAnalysis = fs.readFileSync(new URL('./SocialReplicationAnalysisPanel.tsx', import.meta.url), 'utf8');
const editor = fs.readFileSync(new URL('./SocialTaskEditorDialog.tsx', import.meta.url), 'utf8');
const commandPanel = fs.readFileSync(new URL('./SocialTaskCommandPanel.tsx', import.meta.url), 'utf8');
const sources = fs.readFileSync(new URL('./SocialTaskSourcesStep.tsx', import.meta.url), 'utf8');
const actions = fs.readFileSync(new URL('./SocialTaskActionDialogs.tsx', import.meta.url), 'utf8');
const starterWorkspace = fs.readFileSync(new URL('../starter/StarterWorkspacePage.tsx', import.meta.url), 'utf8');
const studio = fs.readFileSync(new URL('../AiCreateStudio.tsx', import.meta.url), 'utf8');
const preview = fs.readFileSync(new URL('./SocialArtifactPreviewDialog.tsx', import.meta.url), 'utf8');
const presentation = fs.readFileSync(new URL('./socialContentUi.ts', import.meta.url), 'utf8');
const planning = fs.readFileSync(new URL('./SocialContentPlanningPage.tsx', import.meta.url), 'utf8');
const landing = fs.readFileSync(new URL('./SocialContentLanding.tsx', import.meta.url), 'utf8');
const creationWorkbench = fs.readFileSync(new URL('./SocialCreationWorkbench.tsx', import.meta.url), 'utf8');
const stageOnboarding = fs.readFileSync(new URL('./SocialContentStageOnboarding.tsx', import.meta.url), 'utf8');
const stageStrategy = fs.readFileSync(new URL('../../lib/socialContentStage.ts', import.meta.url), 'utf8');
const themeCards = fs.readFileSync(new URL('./SocialThemeCards.tsx', import.meta.url), 'utf8');
const agentWorkflowPanel = fs.readFileSync(new URL('./SocialAgentWorkflowPanel.tsx', import.meta.url), 'utf8');
const generationConfirmation = fs.readFileSync(new URL('./SocialGenerationConfirmationCard.tsx', import.meta.url), 'utf8');
const videoRoutes = fs.readFileSync(new URL('../../../server/routes/videos.ts', import.meta.url), 'utf8');

assert.match(api, /\/tasks\/\$\{encodeURIComponent\(taskId\)\}\/files\?\$\{query\}/);
assert.match(api, /body: file/);
assert.doesNotMatch(api, /source-files|FormData/);
assert.match(api, /SocialContentSourceOptionPage/);
assert.match(api, /\/source-options\?\$\{params\}/);
assert.match(api, /normalizeSocialContentSourceQuery\(query\)/);
assert.match(api, /listTasks: async \(page = 1, perPage = 50\)/);
assert.match(api, /requestJson<unknown>\(`\/tasks\?\$\{params\}`\)/);
assert.doesNotMatch(api, /listTasks:[\s\S]{0,500}perPage = 200/);
assert.match(api, /JSON_REQUEST_TIMEOUT_MS = 30_000/);
assert.match(api, /READ_RETRY_STATUSES = new Set\(\[429/);
assert.match(hook, /target\.mode === 'edit'/);
assert.match(hook, /updateTask\(target\.taskId/);
assert.match(hook, /createTask\(requestInput\(draft\), `\$\{target\.attemptId\}:create`\)/);
assert.match(hook, /creationMode: draft\.creationPath/);
assert.match(hook, /assetAvailability: draft\.materialInput/);
assert.match(hook, /managementMode: draft\.managedMode/);
assert.doesNotMatch(hook.slice(hook.indexOf('const saveDraft'), hook.indexOf('const startTask')), /workspace\?\.currentTask/);
assert.match(hook, /const sourceRef = upload\.material\?\.sourceRef \|\| upload\.file\.fileRef/,
  'task upload must prefer the canonical My Materials reference');
assert.match(hook, /existingRefs\.has\(`material:\$\{sourceRef\}`\)/);
assert.match(hook, /onTaskProgress\?\.\(next\)/);
assert.match(hook, /removeSource\(task\.taskId/);
assert.match(hook, /createDeliveryPackage\(task\.taskId/);
assert.match(hook, /document\.visibilityState === 'hidden'/);
assert.match(hook, /\['producing', 'packaging', 'attention'\]\.includes\(task\.status\) \? 5_000 : 15_000/,
  'active production must refresh frequently enough for the visible time and step to stay current');
assert.match(hook, /restoreSavedSocialContentTask\(next, savedTaskId/);
assert.match(hook, /snapshot\.taskList\.page >= snapshot\.taskList\.totalPages/);
assert.match(hook, /Promise\.all\(\[[\s\S]*?socialContentApi\.listTasks\(requestedPage, snapshot\.taskList\.perPage\)[\s\S]*?socialContentApi\.listTasks\(1, snapshot\.taskList\.perPage\)\.catch\(\(\) => null\)/);
assert.doesNotMatch(hook, /page\.totalItems !== snapshot\.taskList\.totalItems/);
assert.match(hook, /mergeSocialContentTaskSummaries\(current\.tasks, \[/);
assert.match(workspace, /mode: 'new', taskId: null, expectedVersion: null, attemptId:/);
assert.match(workspace, /mode: 'edit', taskId: task\.taskId, expectedVersion: task\.version, attemptId:/);
assert.match(workspace, /if \(start\)[\s\S]{0,320}setEditor\(null\)/,
  'starting a task must leave the modal as soon as the task exists so uploads and queueing cannot look frozen');
assert.doesNotMatch(workspace, /next\?\.status === 'attention'[\s\S]{0,160}navigateWithTask\('smartAssets', next\.taskId\)/,
  'starting a task must keep the prominent progress board visible instead of navigating away immediately');
assert.match(workspace, /const taskId = explicitTaskId \|\| task\?\.taskId/,
  'a newly-created task must open Studio with its returned id instead of a stale render closure');
assert.match(workspace, /hasMoreTasks=\{state\.workspace\.taskList\.page < state\.workspace\.taskList\.totalPages\}/);
assert.match(workspace, /onLoadMoreTasks=\{\(\) => void state\.loadMoreTasks\(\)\}/);
assert.doesNotMatch(editor, /existingMaterialLabels|pendingCount|const STEPS/,
  '制作前不再要求用户选素材或填写三步 Brief');
assert.match(editor, /await onSubmit\(draft, \[\], false\)/,
  '单页产品选择完成后直接交给系统生成制作方案');
assert.match(editor, /studioApi\.materialProducts\(\)/,
  'the production entry must load selectable products from Enterprise Center');
assert.match(editor, /<option value="">交给系统自动选择<\/option>/,
  'users may explicitly delegate product selection to the content agent');
assert.match(editor, /products\.map\(item => <option key=\{item\.id\} value=\{item\.id\}>\{item\.name\}<\/option>\)/,
  'product choices must come from Enterprise Center rather than free text');
assert.doesNotMatch(editor, /<input value=\{draft\.productName\}/,
  'the production entry must not accept an unbound free-text product name');
assert.match(editor, /productId: selected\?\.id/,
  '任务必须保存企业中心的稳定产品 ID，不能只保存展示名');
assert.match(hook, /productId: draft\.productId\.trim\(\) \|\| null,[\s\S]{0,80}productRef: draft\.productName\.trim\(\) \|\| null/,
  '制作请求必须分开传递稳定产品 ID 与展示名');
assert.match(editor, /无需填写卖点、企业事实、目标客户、市场或产品自由文本/,
  '所有内容制作入口都只选企业中心产品，不再补填 Brief');
assert.match(planning, /defaultCreateMode="instant"/);
assert.match(starterWorkspace, /defaultCreateMode="weekly"/);
assert.match(landing, /自由创作/);
assert.match(landing, /爆款裂变/);
assert.match(landing, /我的素材[^]*?只需选择要宣传的产品/);
assert.match(landing, /沿用爆款口播与结构[^]*?仅替换企业、品牌和产品名称/);
assert.match(landing, /managedMode: 'one_click_managed'/);
assert.match(landing, /path\.id === 'viral_replication' && onSelectViralReplication/,
  '选择爆款裂变必须先进入灵感中心选择真实爆款');
assert.match(planning, /const selectViralReplication[\s\S]{0,520}onNavigate\('socialInspiration'\)/,
  '内容制作的爆款裂变入口必须跳到灵感中心');
assert.doesNotMatch(landing, /适合：|把你现有的视频|提供一条参考视频/,
  'the mode chooser must use one concise capability description per card');
assert.match(landing, /role="dialog"/);
assert.match(planning, /chooserOpen/);
assert.match(planning, /我的创作/);
assert.match(planning, /quickStartRequest/);
assert.match(planning, /loadSocialContentStage\(\)/, '内容制作首次进入必须读取已保存的社媒阶段');
assert.doesNotMatch(planning, /<SocialContentStageOnboarding|新手引导/, '全局新手引导不得放进内容制作页面');
assert.doesNotMatch(creationWorkbench, /onOpenOnboarding|新手引导/, '三栏制作台不得重复承载应用级新手引导');
for (const label of ['B2B 起步验证', 'B2B 增长进阶', 'D2C 品牌增长']) {
  assert.match(stageStrategy, new RegExp(label), `新手引导必须使用润色后的阶段名称：${label}`);
}
for (const preset of ['b2b_starting', 'b2b_growing', 'dtc_sales']) {
  assert.match(stageStrategy, new RegExp(preset), `社媒阶段必须映射到 PRD 周任务方案：${preset}`);
}
assert.match(stageOnboarding, /社媒经营阶段/);
assert.match(stageOnboarding, /确认阶段并开始使用/);
assert.doesNotMatch(stageOnboarding, /产品 PRD|推荐起步节奏|这不是行业标签/);
assert.match(workspace, /stageStrategy\.generationBrief/, '阶段设置必须进入持久化任务的生成策略');
assert.match(workspace, /state\.saveDraft\(draft, quickStartRequest\.files, true, target\)/,
  'the new workbench must reuse the persisted social production queue');
assert.match(workspace, /creationPath === 'material_processing' \? 'material_cut' : 'ai_enhanced'/,
  '自由创作必须停留在免费素材路线，只有爆款裂变进入付费智能增强技术栈');
assert.equal((workspace.match(/state\.saveDraft\(draft, quickStartRequest\.files, true, target\)/g) || []).length, 1,
  '快速启动 effect 只能发起一次任务保存');
assert.match(workspace, /attemptId:\s*`socialquick:\$\{quickStartRequest\.requestId\}`/,
  '快速启动必须使用稳定幂等键，防止 React remount 重复创建任务');
assert.match(creationWorkbench, /studioApi\.materialProducts\(\)/,
  '制作入口必须从企业中心读取可选产品');
assert.match(creationWorkbench, /productId:\s*selected\?\.id \|\| '',[\s\S]{0,80}productName/,
  '制作入口必须把选中产品的稳定 ID 与展示名一起传递');
for (const section of ['口播内容', '画面预览', '生成设置', '开始生成']) {
  assert.match(creationWorkbench, new RegExp(section), `三栏制作台必须显示：${section}`);
}
assert.match(creationWorkbench, /type="file"[^>]+multiple[^>]+accept="video\/\*,image\/\*"/,
  '自由创作必须允许直接上传视频或图片');
assert.match(creationWorkbench, /selectedLines/,
  '逐句口播必须支持多选并同步画面帧');
assert.match(creationWorkbench, /disabled=\{isReplication\}/,
  '爆款裂变的沿用项必须显示为只读');
assert.match(creationWorkbench, /主推产品/,
  '爆款裂变必须先选择企业产品表中的主推产品');
assert.match(creationWorkbench, /referenceLinks:\s*seed\?\.referenceLinks \|\| \[\]/,
  '从爆款卡片带入的 reference 链接必须继续传入任务');
assert.match(planning, /referenceTitle:\s*request\.sourceContext\?\.referenceTitle[\s\S]{0,180}referenceLinks:\s*request\.prefill\?\.referenceLinks/,
  '爆款卡片的标题、封面与参考链路不得在极简入口丢失');
assert.match(creationWorkbench, /seed\?\.referenceThumbnail && seed\.referenceContentType === 'video'/,
  '从我的素材进入自由创作后必须直接显示已选视频，而不是丢失素材预览');
assert.match(workspace, /productId:\s*quickStartRequest\.productId,[\s\S]{0,80}productName:\s*quickStartRequest\.productName/,
  '稳定产品 ID 不得在制作台转任务时丢失');
assert.doesNotMatch(landing, /SOCIAL_THEME_OPTIONS|选好视频主题|这条视频想讲什么/,
  'the content landing must expose two creation paths instead of five topic cards');
assert.doesNotMatch(landing, /VALUE_POINTS|3 步发起任务|从产品卖点开始/,
  '顶部引导应保持为一句话，不再堆叠卖点和入口');
assert.match(themeCards, /SOCIAL_THEME_OPTIONS\.map/);
assert.match(overview, /可选的拍摄与素材建议/);
assert.match(overview, /系统会结合现有素材安排画面/);
assert.doesNotMatch(starterWorkspace, /我会统筹今天的经营任务|系统会主动推进|<StarterWorkflowOverview|socialTaskHeadline/, 'the home must open directly on task progress instead of an explanatory hero or agent map');
assert.doesNotMatch(workspace, />灵小枢<[^]*?>社媒内容工作台</, 'the social workspace must not repeat a large explanatory heading above the task');
assert.match(studio, /item\.id === 'kickoff-product' \|\| item\.id\.startsWith\('social-task-product:'\)/);
assert.match(overview, /READINESS_LABEL/);
assert.doesNotMatch(overview, />\{item\}<\/li>/);
assert.match(overview, /setPreviewArtifact\(artifact\)/);
assert.match(overview, /currentArtifacts\.map\(artifact/);
assert.match(overview, /max-h-\[34rem\][^"']*overflow-y-auto/);
assert.doesNotMatch(overview, /currentArtifacts\.slice\(/);
assert.doesNotMatch(overview, /\{artifact\.kind\}/);
assert.doesNotMatch(overview, /framework-v1/);
assert.doesNotMatch(overview, /<SocialTaskCommandPanel|<TaskStageBar/,
  'the old progress rail and duplicated stage bar must not remain in the task page');
assert.doesNotMatch(overview, /function TaskHeader|<TaskHeader/,
  '当前任务大卡片不应挤占主要内容空间');
assert.match(overview, /showDelivery[^]*?\{showDelivery && <DeliveryPanel/,
  '交付区在有交付内容时才显示');
assert.doesNotMatch(overview, /<SocialReplicationAnalysisPanel task=\{task\}/,
  'internal replication analysis must not be mixed into the customer task page');
assert.match(replicationAnalysis, /task\.brief\.creationMode !== 'viral_replication'/);
for (const detail of ['黄金前三秒', '两个备选钩子', '逐镜复刻清单', '需要保留', '必须改动', '内容 Agent 推荐路线']) {
  assert.match(replicationAnalysis, new RegExp(detail));
}
for (const field of ['referenceVideoAnalysis', 'replicationScript', 'shotMaterialMap', 'primaryHookId', 'fidelityPoints', 'mustDifferPoints', 'sourceStrategy']) {
  assert.match(replicationAnalysis, new RegExp(field));
}
assert.match(replicationAnalysis, /编导分析中/);
assert.match(replicationAnalysis, /analysis\?\.status !== 'ready' \|\| !script/,
  'missing analysis or script data must stay visibly pending instead of inventing a comparison');
assert.doesNotMatch(replicationAnalysis, /模拟数据|示例镜头|默认钩子|假设/);
assert.match(productionProgress, /data-social-task-list/);
assert.match(productionProgress, /fixed bottom-24 right-4/,
  '任务列表入口应固定在右下角且不占主布局');
assert.match(productionProgress, /role="dialog"[^]*?aria-modal="true"[^]*?inset-y-0 right-0/,
  'task list must open in an accessible right-side drawer');
assert.match(productionProgress, /taskItems\.map\(item =>/,
  'the drawer must render multiple tasks instead of only the selected task');
for (const detail of ['全部任务', '任务列表', '选择任务，查看或继续处理', '当前查看']) {
  assert.match(productionProgress, new RegExp(detail));
}
for (const detail of ['预计生成耗时', '当前步骤', '系统正在做什么']) assert.doesNotMatch(productionProgress, new RegExp(detail));
for (const detail of ['预计生成耗时', '当前步骤', '系统正在做什么']) assert.match(runStatus, new RegExp(detail));
assert.match(runStatus, /animate-spin[^]*?motion-reduce:animate-none/);
assert.match(runStatus, /productionProgress\?\.estimatedRemainingSeconds/);
assert.match(runStatus, /productionProgress\?\.step/);
assert.doesNotMatch(runStatus, /productionProgress\?\.activity/,
  'customer-facing activity must use concise, controlled wording instead of backend technical messages');
for (const removedDetail of ['已完成产物', '待用户审核', '自动制作接力', '查看导演方案摘要']) {
  assert.doesNotMatch(productionProgress, new RegExp(removedDetail));
}
assert.doesNotMatch(productionProgress, /formulaId|formula_reference|内部模板|系统提示词/,
  'customer progress must not expose internal formula identifiers or prompts');
assert.match(productionProgress, /onSelectTask\?\.\(taskId\)/);
assert.match(productionProgress, /loadingMoreTasks \? '正在加载任务' : `加载更多任务/);
assert.doesNotMatch(productionProgress + runStatus, /style=\{\{\s*width|\d+%/, 'production status must not invent a percentage');
assert.doesNotMatch(commandPanel + overview + productionProgress, /继续制作|请继续完成脚本|进入内容创作|Studio|旧路线/);
assert.match(overview, /<SocialTaskRunStatusPanel task=\{task\} onOpenWorkbench=\{\(\) => props\.onNavigate\('smartAssets'\)\}/,
  'running production must preserve the task id while opening the complete three-column Studio');
for (const action of ['查看方案与费用', '继续处理', '审核成片']) assert.match(productionProgress, new RegExp(action));
assert.match(editor, /保存并查看制作方案/);
assert.match(editor, /onClick=\{\(\) => void submit\(\)\}/,
  '新建与编辑任务都在选完产品后直接进入制作方案');
assert.doesNotMatch(editor, /下一步：确认素材情况|materialPolicy|SocialTaskSourcesStep|ScaleStep|ReviewStep/,
  '旧的多步 Brief、素材手选和输出设置不得留在制作入口');
assert.match(sources, /选“完全没素材”后也能继续/);
assert.match(sources, /已选择零素材托管，待逐镜判断/);
assert.match(sources, /materialPolicy\.quickStartTitle/);
assert.match(sources, /materialPolicy\.uploadTitle/);
assert.match(sources, /materialPolicy\.recommendedShots/);
assert.match(overview, /真实素材已就绪，可以制作/);
assert.doesNotMatch(overview, /<SocialAgentWorkflowPanel task=\{task\}/,
  'internal agent state must not be mixed into the customer task page');
for (const detail of ['经营 Agent', '编导 Agent', '内容 Agent', 'DirectorBrief', 'ContentExecutionPlan', '完整实现', '功能等价', '事实或权利阻断']) {
  assert.match(agentWorkflowPanel, new RegExp(detail));
}
for (const field of ['weeklyPackage', 'adHocBusinessContext', 'directorBrief', 'executionPlan', 'executionPlanReview', 'precisionIntervals', 'overallConfidence']) {
  assert.match(agentWorkflowPanel, new RegExp(field));
}
for (const detail of ['选择制作方案并核对关键帧', '智能混合制作·主推', '免费素材方案', '建立代拍清单', '参考关键帧', '预计成片关键帧', '关键帧对比', '成片预计时长', '预计制作耗时', '预计费用', '确认方案并开始制作']) {
  assert.match(generationConfirmation, new RegExp(detail));
}
assert.match(generationConfirmation, /\['ai_enhanced', 'material_cut', 'shooting_plan'\]/,
  'current options must be ordered as promoted hybrid, free materials, and shooting list');
assert.match(generationConfirmation, /productionApproach === 'material_polish' \? 'material_cut'/,
  'historic material_polish tasks remain readable as the free material option');
assert.match(generationConfirmation, /productionApproach \?\? 'ai_enhanced'/,
  'new tasks without a saved approach must default to the promoted hybrid option');
assert.doesNotMatch(generationConfirmation, /素材精剪增强|AI 高质量制作|纯素材智能剪辑/,
  'historic production option labels must not appear in the current confirmation card');
for (const field of ['productionOptions', 'referenceFirstFramePreview', 'estimatedTotalSeconds', 'estimatedCostCny', 'executionPlanReview']) {
  assert.match(generationConfirmation, new RegExp(field));
}
assert.doesNotMatch(generationConfirmation, /匹配了哪份素材|为什么选它/);
assert.doesNotMatch(generationConfirmation + productionProgress + runStatus, /编导 Agent|内容 Agent|IAIGC|模型|供应商|任务 ID|运行 ID/,
  'customer-facing review, queue and running states must avoid technical implementation language');
assert.match(videoRoutes, /SOCIAL_SHARED_INSPIRATION_TENANT_ID \|\| 'demo-shared-video-pool'/);
assert.match(videoRoutes, /videosRouter\.use\(requireAuth\)/,
  'thumbnail access must remain behind the authenticated videos router');
assert.match(videoRoutes, /isSharedInspirationThumbnailReadable\(record\)/);
assert.match(videoRoutes, /String\(record\.tenantId \|\| ''\) === sharedTenantId[\s\S]*analysis\.userVisible === true[\s\S]*isPublicTestTenantVideo\(record\)/,
  'only public records in the designated shared inspiration tenant may expose cross-tenant thumbnails');
const mediaRoute = videoRoutes.slice(videoRoutes.indexOf("videosRouter.get('/:id/media'"), videoRoutes.indexOf("videosRouter.get('/:id/media-url'"));
assert.doesNotMatch(mediaRoute, /isSharedInspirationThumbnailReadable/,
  'shared inspiration access must never expose the source media endpoint');
assert.match(productionProgress, /补充任务资料/);
assert.doesNotMatch(editor + landing + overview, /配置爆款公式|填写脚本|填写口播|填写字幕/,
  'customers must not be asked to configure formulas or author production components');
assert.match(preview, /fetchArtifactMedia\(artifact\.taskId, artifact\.artifactId/);
assert.match(preview, /技术质检已通过/);
assert.match(preview, /不可发布 · 需要修改/);
assert.match(preview, /本次已记录/);
for (const check of ['客户素材已用于剪辑', '逐镜检查通过', '口播音轨可正常播放', '字幕已按口播时间轴生成']) {
  assert.match(preview, new RegExp(check));
}
assert.doesNotMatch(preview, /(?:href|src)=\{artifact\.resourceRef\}/);
assert.match(presentation, /return simple \? `第 \$\{simple\[1\]\} 版` : '当前版本'/);
assert.match(sources, /maxLength=\{SOCIAL_CONTENT_SOURCE_QUERY_MAX_LENGTH\}/);
assert.match(sources, /page < totalPages/);
assert.match(sources, /socialContentSourceOptionsAfterFailure\(current, page\)/);
assert.match(sources, /existingSources\.map\(source =>/);
assert.doesNotMatch(sources, /existingSources\.slice\(/);
assert.doesNotMatch(sources, />\{option\.type\}<\/span>/);
assert.match(actions, /\.csv,\.xlsx/);
assert.doesNotMatch(actions, /\.csv,\.xls,\.xlsx|image\/\*/);

for (const source of [workspace, overview, productionProgress, commandPanel, preview]) {
  assert.doesNotMatch(source, /接口|服务端|写入托管|开发预留|待开发|工作图|模拟数据/);
}

console.log('social content workspace contract tests passed');
