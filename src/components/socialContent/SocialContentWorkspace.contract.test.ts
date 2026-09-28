import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync(new URL('../../lib/socialContentApi.ts', import.meta.url), 'utf8');
const hook = fs.readFileSync(new URL('./useSocialContentWorkspace.ts', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('./SocialContentWorkspace.tsx', import.meta.url), 'utf8');
const overview = fs.readFileSync(new URL('./SocialTaskOverview.tsx', import.meta.url), 'utf8');
const productionProgress = fs.readFileSync(new URL('./SocialProductionProgressPanel.tsx', import.meta.url), 'utf8');
const replicationAnalysis = fs.readFileSync(new URL('./SocialReplicationAnalysisPanel.tsx', import.meta.url), 'utf8');
const commandPanel = fs.readFileSync(new URL('./SocialTaskCommandPanel.tsx', import.meta.url), 'utf8');
const actions = fs.readFileSync(new URL('./SocialTaskActionDialogs.tsx', import.meta.url), 'utf8');
const starterWorkspace = fs.readFileSync(new URL('../starter/StarterWorkspacePage.tsx', import.meta.url), 'utf8');
const studio = fs.readFileSync(new URL('../AiCreateStudio.tsx', import.meta.url), 'utf8');
const preview = fs.readFileSync(new URL('./SocialArtifactPreviewDialog.tsx', import.meta.url), 'utf8');
const presentation = fs.readFileSync(new URL('./socialContentUi.ts', import.meta.url), 'utf8');
const planning = fs.readFileSync(new URL('./SocialContentPlanningPage.tsx', import.meta.url), 'utf8');
const landing = fs.readFileSync(new URL('./SocialContentLanding.tsx', import.meta.url), 'utf8');
const themeCards = fs.readFileSync(new URL('./SocialThemeCards.tsx', import.meta.url), 'utf8');
const agentWorkflowPanel = fs.readFileSync(new URL('./SocialAgentWorkflowPanel.tsx', import.meta.url), 'utf8');
const generationConfirmation = fs.readFileSync(new URL('./SocialGenerationConfirmationCard.tsx', import.meta.url), 'utf8');

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
assert.doesNotMatch(hook, /saveDraft|requestInput|SocialContentSaveTarget/,
  'modal-only task editing and upload paths must be removed');
assert.match(hook, /createDeliveryPackage\(task\.taskId/);
assert.match(hook, /document\.visibilityState === 'hidden'/);
assert.match(hook, /restoreSavedSocialContentTask\(next, savedTaskId/);
assert.match(hook, /snapshot\.taskList\.page >= snapshot\.taskList\.totalPages/);
assert.match(hook, /Promise\.all\(\[[\s\S]*?socialContentApi\.listTasks\(requestedPage, snapshot\.taskList\.perPage\)[\s\S]*?socialContentApi\.listTasks\(1, snapshot\.taskList\.perPage\)\.catch\(\(\) => null\)/);
assert.doesNotMatch(hook, /page\.totalItems !== snapshot\.taskList\.totalItems/);
assert.match(hook, /mergeSocialContentTaskSummaries\(current\.tasks, \[/);
assert.doesNotMatch(workspace, /SocialTaskEditorDialog|setEditor|submitTask/,
  'task creation and editing must not open the removed modal');
assert.match(workspace, /onEdit=\{\(\) => task && navigateWithTask\('smartAssets', task\.taskId\)\}/);
assert.match(workspace, /onStart=\{\(\) => task && navigateWithTask\('smartAssets', task\.taskId\)\}/);
assert.match(workspace, /onSelectTask=\{taskId => navigateWithTask\('smartAssets', taskId\)\}/,
  '最近任务点击必须直接进入带任务上下文的制作工作台');
assert.match(workspace, /contentCreationRequest:/,
  'new task entry must navigate straight to the content workbench');
assert.match(workspace, /const taskId = explicitTaskId \|\| task\?\.taskId/,
  'a newly-created task must open Studio with its returned id instead of a stale render closure');
assert.match(workspace, /hasMoreTasks=\{state\.workspace\.taskList\.page < state\.workspace\.taskList\.totalPages\}/);
assert.match(workspace, /onLoadMoreTasks=\{\(\) => void state\.loadMoreTasks\(\)\}/);
assert.match(planning, /contentCreationRequest: \{ requestId: Date\.now\(\)/);
assert.match(landing, /素材加工/);
assert.match(landing, /爆款裂变/);
assert.match(landing, /默认使用一键托管/);
assert.match(landing, /managedMode: 'one_click_managed'/);
assert.doesNotMatch(landing, /SOCIAL_THEME_OPTIONS|选好视频主题|这条视频想讲什么/,
  'the content landing must expose two creation paths instead of five topic cards');
assert.doesNotMatch(landing, /VALUE_POINTS|3 步发起任务|从产品卖点开始/,
  '顶部引导应保持为一句话，不再堆叠卖点和入口');
assert.match(themeCards, /SOCIAL_THEME_OPTIONS\.map/);
assert.match(overview, /可选的拍摄与素材建议/);
assert.match(overview, /编导 Agent 会结合现有素材安排导演方案/);
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
assert.match(overview, /<SocialReplicationAnalysisPanel task=\{task\}/);
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
assert.match(productionProgress, /data-social-production-progress/);
assert.match(productionProgress, /fixed bottom-24 right-4/,
  '制作进度入口应固定在右下角且不占主布局');
assert.match(productionProgress, /编导 Agent 正在准备导演方案/);
assert.match(productionProgress, /内容 Agent 正在按导演方案生成视频/);
assert.match(productionProgress, /animate-spin[^]*?motion-reduce:animate-none/);
assert.match(productionProgress, /role="dialog"[^]*?aria-modal="true"[^]*?inset-y-0 right-0/,
  'task details must open in an accessible right-side drawer');
assert.match(productionProgress, /taskItems\.map\(item =>/,
  'the drawer must render multiple tasks instead of only the selected task');
for (const detail of ['当前自动步骤', '已完成产物', '待用户审核', '编导 Agent 定方案，内容 Agent 生成视频']) {
  assert.match(productionProgress, new RegExp(detail));
}
for (const detail of ['自动制作接力', '编导 Agent', '内容 Agent', '查看导演方案摘要', '脚本', '口播', '字幕', '镜头与节奏']) {
  assert.match(productionProgress, new RegExp(detail));
}
for (const field of ['scriptSummary', 'voiceoverSummary', 'subtitleSummary', 'shotRhythmSummary']) {
  assert.match(productionProgress, new RegExp(`plan\\.${field}`));
}
assert.match(productionProgress, /plan\?\.status === 'ready'/);
assert.doesNotMatch(productionProgress, /formulaId|formula_reference|内部模板|系统提示词/,
  'customer progress must not expose internal formula identifiers or prompts');
assert.match(productionProgress, /onSelectTask\?\.\(taskId\)/);
assert.doesNotMatch(productionProgress, /if \(taskId !== task\.taskId\) onSelectTask/,
  '当前项也必须可点击进入制作工作台');
assert.match(productionProgress, /loadingMoreTasks \? '正在加载任务' : `加载更多任务/);
assert.match(productionProgress, /task\.runId/);
assert.doesNotMatch(productionProgress, /style=\{\{\s*width|\d+%/, 'production progress must not invent a percentage');
assert.doesNotMatch(commandPanel + overview + productionProgress, /继续制作|请继续完成脚本|进入内容创作|Studio|旧路线/);
assert.doesNotMatch(productionProgress + overview, /onNavigate\('smartAssets'\)/,
  'production status must not send the user into the old production route');
for (const action of ['查看费用与效果', '继续自动处理', '审核生成结果']) assert.match(productionProgress, new RegExp(action));
assert.match(overview, /真实素材已就绪，可以制作/);
assert.match(overview, /<SocialAgentWorkflowPanel task=\{task\}/);
for (const detail of ['经营 Agent', '编导 Agent', '内容 Agent', 'DirectorBrief', 'ContentExecutionPlan', '完整实现', '功能等价', '事实或权利阻断']) {
  assert.match(agentWorkflowPanel, new RegExp(detail));
}
for (const field of ['weeklyPackage', 'adHocBusinessContext', 'directorBrief', 'executionPlan', 'executionPlanReview', 'precisionIntervals', 'overallConfidence']) {
  assert.match(agentWorkflowPanel, new RegExp(field));
}
for (const detail of ['这次会产出', '预计费用', '效果预判', '确认逐镜方案', '开始生成']) {
  assert.match(generationConfirmation, new RegExp(detail));
}
assert.doesNotMatch(generationConfirmation, /低成本分镜预演|不是实际生成关键帧|storyboard\.map/,
  '方案确认页不再横排展示爆款分镜；分镜随视频预览切换在操作台左侧展示');
assert.match(studio, /canvasView === 'reference' && mode === 'clone' \? '爆款视频分镜'/);
assert.match(studio, /<StudioStoryboardList items=\{referenceStoryboardItems\}/);
assert.match(studio, /<StudioStoryboardList items=\{workbenchStoryboardItems\}/);
assert.match(studio, /setVideoKickoff\(seed\.reference\); setCanvasView\('creation'\)/,
  '爆款裂变任务默认必须进入新建视频工作台');
assert.match(studio, /loadProject\(project\);\s*setCanvasView\('creation'\);/,
  '恢复已保存的爆款任务时也必须默认回到新建视频工作台');
assert.match(studio, /socialShotMaterialBindings\.forEach\(\(\{ shotIndex, materialId \}\)/,
  '任务已绑定素材必须按分镜序号回填到 Studio');
for (const field of ['estimatedTotalCostCny', 'estimatedSuccessRate', 'budgetLimitCny', 'executionPlanReview']) {
  assert.match(generationConfirmation, new RegExp(field));
}
assert.match(productionProgress, /内容 Agent 正按编导方案生成配音、字幕并剪辑视频/);
assert.match(productionProgress, /补充任务资料/);
assert.doesNotMatch(landing + overview, /配置爆款公式|填写脚本|填写口播|填写字幕/,
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
assert.match(actions, /\.csv,\.xlsx/);
assert.doesNotMatch(actions, /\.csv,\.xls,\.xlsx|image\/\*/);

for (const source of [workspace, overview, productionProgress, commandPanel, preview]) {
  assert.doesNotMatch(source, /接口|服务端|写入托管|开发预留|待开发|工作图|模拟数据/);
}

console.log('social content workspace contract tests passed');
