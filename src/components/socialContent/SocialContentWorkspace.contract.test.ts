import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync(new URL('../../lib/socialContentApi.ts', import.meta.url), 'utf8');
const hook = fs.readFileSync(new URL('./useSocialContentWorkspace.ts', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('./SocialContentWorkspace.tsx', import.meta.url), 'utf8');
const overview = fs.readFileSync(new URL('./SocialTaskOverview.tsx', import.meta.url), 'utf8');
const productionProgress = fs.readFileSync(new URL('./SocialProductionProgressPanel.tsx', import.meta.url), 'utf8');
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
const themeCards = fs.readFileSync(new URL('./SocialThemeCards.tsx', import.meta.url), 'utf8');

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
assert.doesNotMatch(hook.slice(hook.indexOf('const saveDraft'), hook.indexOf('const startTask')), /workspace\?\.currentTask/);
assert.match(hook, /const sourceRef = upload\.material\?\.sourceRef \|\| upload\.file\.fileRef/,
  'task upload must prefer the canonical My Materials reference');
assert.match(hook, /existingRefs\.has\(`material:\$\{sourceRef\}`\)/);
assert.match(hook, /onTaskProgress\?\.\(next\)/);
assert.match(hook, /removeSource\(task\.taskId/);
assert.match(hook, /createDeliveryPackage\(task\.taskId/);
assert.match(hook, /document\.visibilityState === 'hidden'/);
assert.match(hook, /restoreSavedSocialContentTask\(next, savedTaskId/);
assert.match(hook, /snapshot\.taskList\.page >= snapshot\.taskList\.totalPages/);
assert.match(hook, /Promise\.all\(\[[\s\S]*?socialContentApi\.listTasks\(requestedPage, snapshot\.taskList\.perPage\)[\s\S]*?socialContentApi\.listTasks\(1, snapshot\.taskList\.perPage\)\.catch\(\(\) => null\)/);
assert.doesNotMatch(hook, /page\.totalItems !== snapshot\.taskList\.totalItems/);
assert.match(hook, /mergeSocialContentTaskSummaries\(current\.tasks, \[/);
assert.match(workspace, /mode: 'new', taskId: null, expectedVersion: null, attemptId:/);
assert.match(workspace, /mode: 'edit', taskId: task\.taskId, expectedVersion: task\.version, attemptId:/);
assert.doesNotMatch(workspace, /next\?\.status === 'attention'[\s\S]{0,160}navigateWithTask\('smartAssets', next\.taskId\)/,
  'starting a task must keep the prominent progress board visible instead of navigating away immediately');
assert.match(workspace, /const taskId = explicitTaskId \|\| task\?\.taskId/,
  'a newly-created task must open Studio with its returned id instead of a stale render closure');
assert.match(workspace, /hasMoreTasks=\{state\.workspace\.taskList\.page < state\.workspace\.taskList\.totalPages\}/);
assert.match(workspace, /onLoadMoreTasks=\{\(\) => void state\.loadMoreTasks\(\)\}/);
assert.match(editor, /existingMaterialLabels/);
assert.match(editor, /\$\{pendingCount\} 项待新增/);
assert.match(editor, /企业资料和至少一份真实素材关联后即可开始制作/);
assert.match(editor, /const STEPS = \['内容目标', '准备素材', '确认生成'\]/);
assert.match(planning, /defaultCreateMode="instant"/);
assert.match(starterWorkspace, /defaultCreateMode="weekly"/);
assert.match(landing, /按客户最关心的内容开始/);
assert.match(themeCards, /SOCIAL_THEME_OPTIONS\.map/);
assert.match(overview, /可选的拍摄与素材建议/);
assert.match(overview, /不会影响开始制作；爆款公式正式配置后再决定内容结构/);
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
assert.match(overview, /<TaskHeader[^]*?<SocialProductionProgressPanel[^]*?<div className="min-w-0 space-y-4">/,
  'the compact robot status must sit after the task header and before task results');
assert.match(productionProgress, /data-social-production-progress/);
assert.match(productionProgress, /我们的机器人正在后台全力帮你生成内容/);
assert.match(productionProgress, /animate-spin[^]*?motion-reduce:animate-none/);
assert.match(productionProgress, /role="dialog"[^]*?aria-modal="true"[^]*?inset-y-0 right-0/,
  'task details must open in an accessible right-side drawer');
assert.match(productionProgress, /taskItems\.map\(item =>/,
  'the drawer must render multiple tasks instead of only the selected task');
for (const detail of ['当前自动步骤', '已完成产物', '待用户审核', '脚本、口播、字幕和剪辑由机器人自动完成']) {
  assert.match(productionProgress, new RegExp(detail));
}
assert.match(productionProgress, /onSelectTask\?\.\(taskId\)/);
assert.match(productionProgress, /loadingMoreTasks \? '正在加载任务' : `加载更多任务/);
assert.match(productionProgress, /task\.runId/);
assert.doesNotMatch(productionProgress, /style=\{\{\s*width|\d+%/, 'production progress must not invent a percentage');
assert.doesNotMatch(commandPanel + overview + productionProgress, /继续制作|请继续完成脚本|进入内容创作|Studio|旧路线/);
assert.doesNotMatch(productionProgress + overview, /onNavigate\('smartAssets'\)/,
  'production status must not send the user into the old production route');
for (const action of ['确认并开始自动制作', '重试自动生成', '审核生成结果']) assert.match(productionProgress, new RegExp(action));
assert.match(productionProgress, /根据已上传素材适配既有脚本，并自动生成口播、字幕和画面/);
for (const operation of ['编辑任务', '新建任务']) assert.match(overview, new RegExp(operation));
assert.match(preview, /fetchArtifactMedia\(artifact\.taskId, artifact\.artifactId/);
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
