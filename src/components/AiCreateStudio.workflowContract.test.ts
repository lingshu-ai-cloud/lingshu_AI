import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  followAdoptedDigitalHumanSlotDurations,
  resolveStudioWorkflowProjectEntry,
  studioAgentSourceLabel,
  studioSpecHasMeaningfulContent,
  studioWorkflowContextFromSpec,
  validateStudioScriptGenerationInput,
} from './AiCreateStudio.js';
import { parseDigitalEmployeeWorkflowContext } from './TrafficPage.js';
import { reconcileShootingSlots } from '../lib/shootingWorkflow.js';

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

const durationSlot = { id: 'slot-17', title: '结尾', detail: '口播', time: '0.0s-5.7s', start: 0, end: 5.67 };
const adoptedShot = { adoptedId: 'candidate-3', candidates: [{ id: 'candidate-3', materialId: 'pipeline-3', source: 'avatar' }] };
const followedSlots = followAdoptedDigitalHumanSlotDurations(
  [durationSlot], { 'slot-17': 'pipeline-3' }, { 'video-1:persisted-17': adoptedShot } as never,
  new Map([['pipeline-3', 6.083]]), 'video-1', { 'slot-17': 'persisted-17' },
);
assert.equal(followedSlots[0]?.end, 6.083, 'adopted duration must resolve through the persisted shooting-shot identity');
const wrongAssemblySlots = followAdoptedDigitalHumanSlotDurations(
  [durationSlot], { 'slot-17': 'pipeline-3' }, { 'other-video:persisted-17': adoptedShot } as never,
  new Map([['pipeline-3', 6.083]]), 'video-1', { 'slot-17': 'persisted-17' },
);
assert.equal(wrongAssemblySlots[0]?.end, 5.67, 'another assembly must not retime this storyboard slot');
const reconciledDuration = reconcileShootingSlots(
  [{ id: 'persisted-17', slotId: 'slot-17', detail: '口播', duration: 5.67, requirements: '{"duration":5.67}' }],
  followedSlots, '{}', () => 'new-id',
)[0]!;
assert.equal(reconciledDuration.duration, 6.08);
assert.equal(JSON.parse(reconciledDuration.requirements).duration, 6.08, 'shooting slot and its persisted requirements must use the same adopted duration');

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
assert.match(
  studioSource,
  /preparedTargetShot[\s\S]{0,500}targetFramesConfirmed:true[\s\S]{0,700}studioApi\.saveProject/,
  'a generated target frame is automatically persisted without a human review gate',
);
assert.match(studioSource, /数字人素材已生成并自动回填当前分镜/);
assert.match(studioSource, /已完成.*目标人物视频，并自动回填当前分镜/);
assert.match(studioSource, /const refreshProductionJob[\s\S]{0,2400}digitalHumanFullLengthEdit\(clip, storyboardSlot\)/, 'a manually refreshed completed avatar job must immediately synchronize its full-length edit');
assert.match(studioSource, /const runProductionSentenceReplication[\s\S]{0,3000}digitalHumanFullLengthEdit\(clip, slot\)/, 'sentence-video auto-fill must immediately synchronize its full-length edit');
assert.match(studioSource, /useEffect\(\(\) => \{[\s\S]{0,1000}adoptedDigitalHumanCandidate\(slot, materialId\)[\s\S]{0,800}digitalHumanFullLengthEdit\(clip, slot\)/, 'restored and asynchronously loaded avatar assignments must normalize historical clip edits');
assert.match(studioSource, /const targetDuration = adoptedVideo \? clip!\.duration/, 'an adopted digital-human storyboard slot must follow the material duration');
assert.match(studioSource, /trimStart: adoptedVideo \? 0 : edit\.trimStart,[\s\S]{0,120}trimEnd: adoptedVideo \? clip\.duration : edit\.trimEnd,[\s\S]{0,120}speed: adoptedVideo \? 1 : edit\.speed/, 'an adopted digital-human storyboard slot must use the complete material at normal speed');
assert.match(studioSource, /fallbackDigitalHumanVideo\?\.duration[\s\S]{0,1300}trimStart: 0, trimEnd: fallbackDigitalHumanVideo\?\.duration \|\| targetDuration, speed: 1/, 'the legacy HeyGen render fallback must use measured material duration at normal speed');
assert.match(studioSource, /followAdoptedDigitalHumanSlotDurations\(base, storyboardAssignments, shotProductions,[\s\S]{0,180}item\.duration/, 'storyboard timing must be rebuilt from the adopted digital-human material duration');
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
assert.match(studioSource, /schemaVersion:\s*'studio-analysis\.v1'/, 'storyboard, voiceover and shot analysis must have an explicit durable recovery bundle');
for (const persistedField of ['reference', 'storyboard', 'voiceover', 'shots']) {
  assert.match(studioSource, new RegExp(`analysisResults[\\s\\S]{0,900}${persistedField}`), `${persistedField} analysis must be persisted with the project`);
}
assert.match(studioSource, /Analysis output is expensive[\s\S]{0,700}setTimeout[\s\S]{0,160}autosaveSnapshotRef\.current/, 'analysis changes must be saved without waiting for the ten-second checkpoint');
assert.match(studioSource, /analysisResults is the durable, versioned recovery bundle/, 'project hydration must recover from the versioned analysis bundle');
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
assert.match(studioSource, /HeyGen 数字人口播生成/, 'the material workbench must expose the HeyGen asset selector');
assert.match(studioSource, /studioApi\.digitalHumanAvatars\(\)/, 'the Studio must load provider avatar assets instead of rendering an empty selector');
assert.match(studioSource, /onDigitalHuman=\{\(\) => \{[\s\S]{0,1200}openProduction\(salesSlot\)/, 'the material decision panel must open the selected storyboard shot in digital-human production');
assert.match(studioSource, /avatar\.defaultVoiceId/, 'provider-owned avatars must carry their default voice into production defaults');
assert.match(studioSource, /setStoryboardAssignments\(current => \(\{ \.\.\.current, \[slot\.id\]: clip\.id \}\)\)/,
  'a generated non-presenter clip must immediately replace the active storyboard assignment');
assert.match(studioSource, /新AI画面已回填当前分镜，并已保存到 AI 素材库/,
  'the Studio must explain immediate storyboard backfill and durable AI-library storage');

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

assert.match(studioSource, /重新质检并签发/);
assert.match(studioSource, /requalityProject\(projectId\)/);
assert.match(studioSource, /!currentProjectQualityRecord \|\| Boolean\(manualHandoffBusy\)/);

console.log('content execution workspace contract tests passed');

const reusedDigitalSlots = followAdoptedDigitalHumanSlotDurations([durationSlot, { ...durationSlot, id: 'slot-next', start: 5.67, end: 7.67 }], { 'slot-17': 'reused-digital' }, {}, new Map([['reused-digital', 3.2]]), 'video-1', {}, new Set(['reused-digital']));
assert.equal(reusedDigitalSlots[0]?.end, 3.2, 'reused digital-human videos follow media duration without an adoption candidate');
assert.equal(reusedDigitalSlots[1]?.start, 3.2, 'the following shot shifts with the digital-human media duration');
assert.equal(reusedDigitalSlots[1]?.end, 5.2);

assert.match(studioSource, /generatedSource \? sourceCuesForShot\(source, clip.duration\)/, 'generated speech captions must use measured source timings rather than spreading script text across the shot');
