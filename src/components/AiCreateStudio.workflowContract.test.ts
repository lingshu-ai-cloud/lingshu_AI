import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  resolveStudioWorkflowProjectEntry,
  studioAgentSourceLabel,
  studioSpecHasMeaningfulContent,
  studioWorkflowContextFromSpec,
  validateStudioScriptGenerationInput,
} from './AiCreateStudio.js';
import { parseDigitalEmployeeWorkflowContext } from './TrafficPage.js';

const validBase = {
  mode: 'product' as const,
  language: 'zh',
  productInfo: '产品名称：LX Vision',
  productLabel: 'LX Vision',
  selectedMaterialCount: 0,
  hasReferenceAnalysis: false,
  duration: 20,
};
assert.deepEqual(validateStudioScriptGenerationInput(validBase), { ok: true });
assert.equal(validateStudioScriptGenerationInput({ ...validBase, language: '' }).code, 'language_required');
assert.equal(validateStudioScriptGenerationInput({ ...validBase, productInfo: '' }).code, 'product_required');
assert.equal(validateStudioScriptGenerationInput({ ...validBase, mode: 'material' }).code, 'material_required');
assert.equal(validateStudioScriptGenerationInput({ ...validBase, mode: 'clone' }).code, 'reference_required');
assert.equal(validateStudioScriptGenerationInput({ ...validBase, duration: 0 }).code, 'duration_invalid');
assert.match(studioAgentSourceLabel('inspiration_analysis'), /灵感中心.*爆款视频分析/);
assert.match(studioAgentSourceLabel('agent_memory'), /智能推荐/);
assert.equal(studioAgentSourceLabel('unrecognized_internal_source'), '手动创建', 'unknown internal source codes must not be shown to customers');
assert.deepEqual(
  studioWorkflowContextFromSpec({ workflowRunId: 'run-1', workflowTaskId: 'task-1', workflowTaskKey: 'content_production' }),
  { runId: 'run-1', taskId: 'task-1', taskKey: 'content_production' },
);
assert.equal(studioWorkflowContextFromSpec({ workflowRunId: 'run-1' }), null, 'partial workflow attribution must never bind to a project');

const workflowContext = { runId: 'run-1', taskId: 'task-1', taskKey: 'content_production' };
const workflowProjects = [
  { id: 'old-empty', title: '未命名草稿', status: 'draft' as const, spec: {}, createdAt: '', updatedAt: '' },
  ...['one', 'two', 'three'].map(id => ({
    id,
    title: `任务项目 ${id}`,
    status: 'draft' as const,
    spec: { workflowRunId: 'run-1', workflowTaskId: 'task-1', workflowTaskKey: 'content_production' },
    createdAt: '', updatedAt: '',
  })),
  { id: 'other-task', title: '其他任务', status: 'draft' as const, spec: { workflowRunId: 'run-1', workflowTaskId: 'task-2' }, createdAt: '', updatedAt: '' },
];
const multipleEntry = resolveStudioWorkflowProjectEntry(workflowProjects, workflowContext);
assert.equal(multipleEntry.projects.length, 3, 'a workflow handoff must list only projects created by that exact run/task');
assert.equal(multipleEntry.project, null, 'multiple task projects must land on the filtered project list');
assert.equal(multipleEntry.openList, true);
assert.ok(!multipleEntry.projects.some(project => project.id === 'old-empty'), 'a remembered unscoped draft must never replace workflow projects');
const singleEntry = resolveStudioWorkflowProjectEntry([workflowProjects[0]!, workflowProjects[1]!], workflowContext);
assert.equal(singleEntry.project?.id, 'one', 'a single exact task project may open directly');
assert.equal(singleEntry.openList, false);
assert.equal(resolveStudioWorkflowProjectEntry(workflowProjects, { ...workflowContext, entityId: 'two' }).project?.id, 'two', 'a resource handoff must select exactly the requested project');
assert.equal(resolveStudioWorkflowProjectEntry(workflowProjects, { ...workflowContext, entityId: 'missing' }).project, null, 'missing project must not open a sibling');
assert.deepEqual(resolveStudioWorkflowProjectEntry([workflowProjects[0]!], workflowContext).projects, [], 'zero task projects must not fall back to unrelated drafts');

assert.equal(studioSpecHasMeaningfulContent({ mode: 'material', productInfo: '企业默认产品', audience: '企业默认客群' }), false, 'enterprise defaults are not a user-created draft');
assert.equal(studioSpecHasMeaningfulContent({ workflowRunId: 'run-1', workflowTaskId: 'task-1' }), false, 'a task handoff alone must not manufacture an empty project');
assert.equal(studioSpecHasMeaningfulContent({ script: '真实创作脚本' }), true);
assert.equal(studioSpecHasMeaningfulContent({ selected: ['asset-1'] }), true);

const handoffNow = Date.parse('2026-09-04T08:00:00.000Z');
const validHandoff = JSON.stringify({
  page: 'smartAssets', runId: 'legacy-run', taskId: 'legacy-task', workflowRunId: 'run-1', workflowTaskId: 'task-1', issuedAt: handoffNow,
  businessRef: { taskKey: 'content_production' },
});
assert.deepEqual(parseDigitalEmployeeWorkflowContext(validHandoff, handoffNow + 1000), {
  runId: 'run-1', taskId: 'task-1', taskKey: 'content_production',
}, 'a first-mount handoff must restore the exact run and task');
assert.equal(parseDigitalEmployeeWorkflowContext(validHandoff, handoffNow + 16 * 60 * 1000), null, 'an unopened stale handoff must not bind later work');
assert.equal(parseDigitalEmployeeWorkflowContext(JSON.stringify({ page: 'smartAssets', runId: 'run-1', issuedAt: handoffNow }), handoffNow), null, 'a partial handoff must not bind');
assert.equal(parseDigitalEmployeeWorkflowContext(JSON.stringify({ page: 'conversion', runId: 'run-1', taskId: 'task-1', issuedAt: handoffNow }), handoffNow), null, 'a handoff for another workspace must not bind to Studio');
assert.deepEqual(parseDigitalEmployeeWorkflowContext(JSON.stringify({ page: 'smartAssets', runId: '', taskId: '', issuedAt: handoffNow, businessRef: { taskKey: 'content_production', preview: true } }), handoffNow), {
  runId: '', taskId: '', taskKey: 'content_production', preview: true,
}, 'a draft plan preview must retain its task identity without pretending that a run already exists');

const studioSource = readFileSync(new URL('./AiCreateStudio.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(
  studioSource,
  /setMode\(m\.id\);[\s\S]{0,220}setProjectTitle/,
  '切换创作模式不能改写用户的项目名',
);
assert.match(studioSource, /validateStudioScriptGenerationInput\(\{/);
assert.match(studioSource, /<StudioInputSummary[\s\S]{0,300}title="已确认内容"/, 'the Studio must summarize the inputs used for this creation');
assert.doesNotMatch(studioSource, />Agent 任务上下文<|label: 'Agent 来源'|`Agent 任务 · \$\{normalized\}`/, 'Studio must not expose internal workflow labels or raw source codes');
assert.match(studioSource, /sourceWorkflowContext\.preview \? '制作方案预览' : '灵小图'/, 'Studio must distinguish draft-plan preview from an executing content task');
assert.match(studioSource, /焦点产品/);
assert.match(studioSource, /workflowRunId:\s*projectWorkflowContext\?\.runId/, 'saved studio projects must retain their own originating workflow run');
assert.match(studioSource, /workflowTaskId:\s*projectWorkflowContext\?\.taskId/, 'saved studio projects must retain their own originating workflow task');
assert.match(
  studioSource,
  /setProjectWorkflowContext\([\s\S]{0,120}workflowContext\?\.taskKey === 'content_quality_gate'[\s\S]{0,120}\? workflowContext[\s\S]{0,120}: studioWorkflowContextFromSpec\(s\)/,
  'loading a project must restore persisted attribution unless an explicit content-quality task is the active authority',
);
assert.match(studioSource, /withoutStudioWorkflowContext\([\s\S]{0,180}JSON\.parse/, 'reusing a historical project must not inherit the historical workflow task');
assert.match(studioSource, /resolveStudioWorkflowProjectEntry\(nextProjects, workflowContext\)/, 'a content-production handoff must resolve exact task projects before entering Studio');
assert.match(studioSource, /if \(workflowContext \|\| socialContentTaskId\) \{[\s\S]{0,180}removeItem\(STUDIO_OPEN_PROJECT_KEY\)/, 'workflow or social-task context must override and consume a remembered browser draft');
assert.match(studioSource, /silent && !projectId && !studioSpecHasMeaningfulContent\(nextSpec\)/, 'background autosave must not create empty unnamed drafts');
assert.match(studioSource, /onCreatePresenter=\{async input => \{/,'the current shot must expose inline presenter completion');
assert.match(studioSource, /presenterApi\.uploadPhotoMaterial\(input\.file, input\.name\)[\s\S]{0,140}studioApi\.uploadMaterialFile\(input\.file,\{folder:'presenter',type:mediaType,sourceType:'presenter-inline-upload'\}\)/,'inline completion must upload the selected person asset through the available provider path');
assert.match(studioSource, /setProductionDefaults\(saved\);await refreshMaterials\(\)/,'inline completion must refresh enterprise presenters and Studio materials before returning');
assert.match(studioSource, /defaultPresenterId:productionDefaults\.defaultPresenterId\|\|presenterId/, 'the first inline presenter becomes the enterprise default while remaining selected in the originating shot');
assert.doesNotMatch(studioSource, /showProjects \|\| linkedProductionContext/, 'a linked Agent task must not hide the three-column Studio behind a status scene');
assert.match(studioSource, /<details[^>]*>[\s\S]{0,450}<ProductionTaskScene[^>]*embedded/, 'the linked task status must stay collapsible while the Studio workbench remains accessible');
assert.match(studioSource, /className=\{showProjects \? 'hidden' : 'flex min-h-0 flex-1 flex-col'\}/, 'the Studio is hidden only while its project chooser is open');
assert.match(studioSource, /digitalHumanJob\?\.status === 'review'[\s\S]{0,180}<video/, 'generated digital-human candidates must be directly previewable before approval');
assert.match(studioSource, /<RenderedVideoPlayer[^>]+src=\{formalPreviewUrl\}/, 'formal AIGC output must be directly playable in the final preview step');
assert.match(studioSource, /<DigitalHumanProductionOverview/, 'the production page must retain per-shot digital-human progress and settlement UI');
assert.match(studioSource, /HeyGen 账号资产/, 'the material workbench sidebar must expose the HeyGen asset selector');
assert.match(studioSource, /studioApi\.digitalHumanAvatars\(\)/, 'the Studio must load provider avatar assets instead of rendering an empty selector');
assert.match(studioSource, /bindHeygenAvatarToShot\(activeWorkbenchSlot\)/, 'an account avatar must be bindable to the active storyboard shot');
assert.match(studioSource, /avatar\.defaultVoiceId/, 'provider-owned avatars must carry their default voice into production defaults');

const trafficSource = readFileSync(new URL('./TrafficPage.tsx', import.meta.url), 'utf8');
assert.match(trafficSource, /digitalEmployee\.businessDeepLink/, 'the content workspace must consume the persisted Digital Employee handoff');
assert.match(trafficSource, /sessionStorage\.removeItem\('digitalEmployee\.businessDeepLink'\)/, 'the persisted handoff must be consumed once instead of leaking into later manual sessions');
assert.match(trafficSource, /DIGITAL_EMPLOYEE_CONTEXT_TTL/, 'a never-opened stale handoff must expire');
assert.match(trafficSource, /workflowRunId:\s*item\.workflowRunId\s*\|\|\s*''/, 'publishing calendar writes must use per-item workflow attribution');
assert.match(trafficSource, /workflowTaskId:\s*item\.workflowTaskId\s*\|\|\s*''/, 'publishing calendar writes must use per-item task attribution');
assert.doesNotMatch(trafficSource, /workflowRunId:\s*item\.workflowRunId\s*\|\|\s*workflowContext/, 'an unrelated queued item must not inherit the page-level workflow context');
assert.match(trafficSource, /draft\s*\|\|\s*\(workflowContext\s*\?\s*null\s*:\s*readStoredPublishDraft\(storageScope\)\)/, 'a direct workflow handoff must not adopt a stale locally stored draft');
assert.doesNotMatch(trafficSource, /readStoredPublishDraft\(\)/, 'all browser-only publishing drafts must use the current tenant storage scope');
assert.match(trafficSource, /handledWorkflowContextRef[\s\S]{0,900}createPublishItem\(null, \[\], workflowContext\)/, 'an already-mounted publishing panel must create a separate attributed item for a newly arrived task');
assert.match(trafficSource, /原有队列不受影响/, 'the mounted-panel handoff must explain that existing queue items are not relabeled');

const publishingSource = readFileSync(new URL('../../server/routes/publishing.ts', import.meta.url), 'utf8');
assert.match(publishingSource, /workflowRunId:\s*workflowAttribution\.runId/, 'the publishing API must persist verified workflow run attribution');
assert.match(publishingSource, /workflowTaskId:\s*workflowAttribution\.taskId/, 'the publishing API must persist verified workflow task attribution');
assert.match(publishingSource, /task\.tenant_id !== tenantId/, 'the publishing API must verify workflow attribution belongs to the current tenant');
assert.match(publishingSource, /text\(task\.run_id\) !== runId/, 'the publishing API must verify the workflow task belongs to the claimed run');

const scheduledSource = readFileSync(new URL('./ScheduledPage.tsx', import.meta.url), 'utf8');
for (const label of ['已入队', '执行中', '成功', '失败', 'Worker 离线']) assert.match(scheduledSource, new RegExp(label));
assert.match(scheduledSource, /正在加载生产状态/);
assert.match(scheduledSource, /setInterval\([\s\S]{0,220}fetchVideoStats\(false\)/, '生产状态必须自动刷新');
assert.match(scheduledSource, /人工恢复：/);

const conversionSource = readFileSync(new URL('./ConversionPage.tsx', import.meta.url), 'utf8');
assert.match(conversionSource, /customer\.isMock \? '模拟客户' : '真实客户'/);
assert.match(conversionSource, /模拟客户 · 不对外发送/);
assert.match(conversionSource, /真实客户 · 通道未连接/);
assert.match(conversionSource, /真实客户 · 通道已连接/);

const workerSource = readFileSync(new URL('../../scripts/local-crawl-worker.ts', import.meta.url), 'utf8');
assert.match(workerSource, /CRAWL_WORKER_HEARTBEAT_MS/);
assert.match(workerSource, /heartbeatJob\(job\)/);
assert.match(workerSource, /localCrawlWorkerFailureMessage\(error\)/);

console.log('content execution workspace contract tests passed');
