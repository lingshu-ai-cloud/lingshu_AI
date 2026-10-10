import assert from 'node:assert/strict';
import type { VideoCreationPlan } from '../../shared/contracts/videoCreationPlan';
import { buildBenchmarkAnalysis } from '../../shared/benchmarkAnalysis';
import type { DigitalEmployeeOverview, ContentQueueItem, WorkflowTask } from './digitalEmployees';
import { buildWeeklyContentProgress, type WeeklyContentProgressProject } from './weeklyContentProgress';

const plan = (overrides: Partial<VideoCreationPlan> = {}): VideoCreationPlan => ({
  contentId: 'master', contentFamilyId: 'family', productionRole: 'master', route: 'material', productId: 'product', productName: '产品',
  theme: '主题', language: 'en', duration: 30, platform: 'tiktok', materialIds: ['material'], referenceId: '', presenter: 'material', heygenAvatarId: '', avatarConsent: false, voice: 'v1',
  preproduction: { version: 1, status: 'ready', generatedAt: '',
    benchmark: { status: 'not_applicable', referenceId: '', title: '', account: '', views: '', thumbnailUrl: '', sourceUrl: '', hook: '', shotSummary: [] },
    materials: { status: 'ready', items: [], blockers: [], pendingShootTaskIds: [] }, readiness: { canStart: true, blockers: [] }, confidence: { onTimeRate: null, effectLevel: 'insufficient', reasons: [] },
    directorScript: { version: 1, body: 'Confirmed script', hash: 'hash', language: 'en', status: 'confirmed', generatedBy: 'director_agent', generatedAt: '', source: 'llm', degradedReason: '' } },
  ...overrides,
});
const queue = (overrides: Partial<ContentQueueItem> = {}): ContentQueueItem => ({
  id: 'queue', contentId: 'master', orderId: 'order', projectIds: ['project'], taskId: 'task', origin: 'weekly_plan',
  lineage: { goalId: 'goal', planId: 'plan' }, status: 'producing', stage: '视频渲染', reason: '', steps: [], ...overrides,
} as ContentQueueItem);
const task = (overrides: Partial<WorkflowTask> = {}): WorkflowTask => ({ id: 'task', run_id: 'run', task_key: 'content_production', status: 'running', blocked_reason: '', output: {}, ...overrides } as WorkflowTask);
const overview = (plans = [plan()]): DigitalEmployeeOverview => ({ goal: { id: 'goal' }, plan: { id: 'plan', businessPackage: { tasks: [{ templateId: 'production', videoPlans: plans }] } }, run: { id: 'run', goal_id: 'goal', plan_id: 'plan', status: 'running' }, tasks: [task()], contentQueue: { sourceStatus: 'available', items: [queue()] } } as DigitalEmployeeOverview);
const project = (spec: Record<string, unknown> = {}, automation: Record<string, unknown> = {}): WeeklyContentProgressProject => ({ id: 'project', spec: {
  workflowRunId: 'run', workflowTaskId: 'task', contentOrderId: 'order', contentOrder: { lineage: { goalId: 'goal', planId: 'plan' } },
  automation: { managedBy: 'digital_employee', stage: 'script', status: 'processing', ...automation }, ...spec,
} });
const get = (model: ReturnType<typeof buildWeeklyContentProgress>, key: string) => model.stages.find(stage => stage.key === key)!;
const build = (data = overview(), projects: WeeklyContentProgressProject[] = []) => buildWeeklyContentProgress(data, 'master', { projects, projectsStatus: 'available' });

{
  const data = overview(); data.run = null;
  const result = build(data);
  assert.equal(result.statusLabel, '待启动');
  assert.equal(get(result, 'script').status, 'completed');
  assert.equal(get(result, 'materials').status, 'ready');
  assert.equal(get(result, 'voice').status, 'pending');
  assert.equal(get(result, 'presenter').status, 'not_applicable');
  assert.equal(get(result, 'render').status, 'pending');
  assert.equal(result.projectIds.length, 0, 'old queue cannot attach projects before a run exists');
  data.plan!.businessPackage!.tasks[0]!.videoPlans![0]!.preproduction!.readiness = { canStart: false, blockers: ['待补产品素材'] };
  const withMissingPreparation = build(data);
  assert.equal(withMissingPreparation.statusLabel, '待启动');
  assert.equal(withMissingPreparation.nextAction?.kind, 'start');
  assert.equal(withMissingPreparation.blockingReasons.length, 0, 'preparation gaps are not a new whole-week start gate');
}
{
  const data = overview();
  data.contentQueue!.items[0]!.progress = 100;
  data.contentQueue!.items[0]!.steps = [{ key: 'voice_subtitles', label: '口播', state: 'done' } as never];
  const result = build(data);
  assert.notEqual(get(result, 'voice').status, 'completed');
  assert.notEqual(get(result, 'quality').status, 'completed');
}
{
  const result = build(overview([plan({ presenter: 'heygen' })]), [project({}, { stage: 'render' })]);
  for (const key of ['voice', 'presenter', 'quality']) assert.equal(get(result, key).status, 'pending', 'later stage is not proof of an earlier artifact');
  assert.equal(get(result, 'render').status, 'running');
}
{
  const data = overview([plan({ presenter: 'heygen' })]);
  const p = project({ script: '[0-30] Scene', sceneSourcePlan: [{ sceneIndex: 0, start: 0, end: 30, assetId: 'asset' }], selectedMaterialEvidence: [{ id: 'asset', type: 'video' }], voiceoverUrl: '/audio.wav', voiceoverDur: 30, subtitleAlignmentSource: 'measured', renderOutputPath: '/video.mp4' }, { stage: 'quality', narrationReviewPassed: true, heygenOutputMaterialId: 'avatar-video', quality: { passed: true } });
  const snapshot = JSON.stringify({ data, p });
  const result = build(data, [p]);
  for (const key of ['materials', 'voice', 'presenter', 'render', 'quality']) assert.equal(get(result, key).status, 'completed');
  assert.equal(result.statusLabel, '待验收');
  assert.equal(JSON.stringify({ data, p }), snapshot, 'view model must not mutate business state');
  data.contentQueue!.items[0]!.status = 'completed';
  assert.equal(build(data, [p]).status, 'completed');
  const retry = project({ voiceoverUrl: '/old.wav', voiceoverDur: 30, subtitleAlignmentSource: 'measured', renderOutputPath: '/old.mp4' }, { stage: 'script', narrationReviewPassed: true, heygenOutputMaterialId: 'old', quality: { passed: true } });
  const rewound = build(data, [retry]);
  for (const key of ['voice', 'presenter', 'render', 'quality']) assert.notEqual(get(rewound, key).status, 'completed', 'rewind invalidates old downstream output');
}
{
  const data = overview([plan({ presenter: 'heygen' })]);
  assert.equal(get(build(data, [project({}, { stage: 'heygen', heygenJobId: 'submitted-job' })]), 'presenter').status, 'waiting');
  const result = build(data, [project({ renderOutputPath: '/video.mp4' }, { stage: 'quality', quality: { passed: false } })]);
  assert.equal(get(result, 'quality').status, 'blocked');
  assert.equal(result.status, 'blocked');
}
{
  const blocker = '产品事实无法核验口播，请补充已确认事实';
  // Frozen confirmed scripts and previous-attempt script timestamps are not a
  // successful current production validation when the actual script step failed.
  for (const spec of [{}, { script: '[0-30] Previous script', automation: { managedBy: 'digital_employee', stage: 'blocked', resumeStage: 'script', status: 'blocked', scriptGeneratedAt: '2026-10-10', blocker } }]) {
    const result = build(overview(), [project(spec, { stage: 'blocked', resumeStage: 'script', status: 'blocked', blocker })]);
    assert.equal(get(result, 'script').status, 'blocked');
    assert.equal(get(result, 'script').detail, blocker);
    assert.equal(get(result, 'materials').status, 'ready');
    assert.doesNotMatch(get(result, 'materials').detail, /产品事实无法核验/);
    assert.equal(result.status, 'blocked');
  }
  const renderFailure = build(overview(), [project({ renderOutputPath: '/previous.mp4' }, { stage: 'blocked', resumeStage: 'render', status: 'failed', blocker: '本次合成失败', quality: { passed: true } })]);
  assert.equal(get(renderFailure, 'render').status, 'blocked');
  assert.equal(get(renderFailure, 'render').detail, '本次合成失败');
  assert.equal(get(renderFailure, 'quality').status, 'pending');
  const qualityFailure = build(overview(), [project({ renderOutputPath: '/video.mp4' }, { stage: 'blocked', resumeStage: 'quality', status: 'blocked', blocker: '本次口型质检失败', quality: { passed: true } })]);
  assert.equal(get(qualityFailure, 'quality').status, 'blocked', 'current quality failure overrides a retained historical pass');
  assert.equal(get(qualityFailure, 'render').status, 'completed', 'failure remains on its own stage, keeping genuine upstream output');
  const foreign = { ...project({}, { stage: 'blocked', resumeStage: 'script', status: 'blocked', blocker }), id: 'sibling-project' };
  const unaffected = build(overview(), [project({}, { stage: 'material_match' }), foreign]);
  assert.equal(get(unaffected, 'script').status, 'completed', 'another content’s failure must never override this content’s prepared script');
}
{
  const clone = plan({ route: 'clone', referenceId: 'reference' });
  clone.preproduction!.benchmark = { ...clone.preproduction!.benchmark, status: 'ready', referenceId: 'reference', shotSummary: Array.from({ length: 6 }, (_, i) => `摘要 ${i + 1}`) };
  const data = overview([clone]); data.run = null;
  const prepared = get(build(data), 'benchmark');
  assert.equal(prepared.status, 'ready'); assert.equal(prepared.statusLabel, '待校验');
  assert.match(prepared.detail, /准备摘要/);

  const analysis = buildBenchmarkAnalysis({ videoId: 'reference', duration: 20, evidenceRevision: 'revision', analysis: {
    analysisMode: 'exact', analysisQuality: 'video', geminiStatus: 'analyzed',
    gemini: { scriptDetails15s: [
      { time: '0-10s', materialType: 'product', narrativeRole: 'hook', classificationEvidence: '展示产品', visual: '产品瓶身近景' },
      { time: '10-20s', materialType: 'factory', narrativeRole: 'capability_proof', classificationEvidence: '展示工厂', visual: '工厂灌装线运行' },
    ] },
  } });
  assert.equal(analysis.status, 'ready', 'fixture uses the real shared normalization format');
  clone.benchmarkAnalysis = analysis;
  assert.equal(get(build(data), 'benchmark').status, 'completed');
  for (const mutate of [
    () => { analysis.timelineComplete = false; },
    () => { analysis.source.analysisMode = 'fast'; },
    () => { analysis.shots[0]!.granularity = 'observation_window'; },
    () => { analysis.shots[0]!.materialType = 'unknown'; },
    () => { analysis.shots[0]!.visual = ''; },
    () => { analysis.shots[0]!.end = null; },
  ]) {
    const before = structuredClone(analysis); mutate();
    assert.notEqual(get(build(data), 'benchmark').status, 'completed', 'ready label alone cannot establish executable physical-shot evidence');
    Object.assign(analysis, before);
  }
  analysis.shots[0]!.granularity = 'observation_window';
  const live = overview([clone]);
  for (const blocker of [
    '复刻镜头类型或物理镜头边界不完整', '爆款分析缺少镜头边界，需补全分析后继续生产',
    '爆款分析缺少已确认的镜头类型或物理镜头边界，需补全分析后继续生产',
    '爆款分析缺少物理镜头边界，需补全分析后继续生产',
    '爆款分析缺少已确认的镜头类型，需补全分析后继续生产',
    '爆款分析缺少逐镜可见事实，需补全分析后继续生产',
    '复刻逐镜时间线不完整，不能生成完整成片', '复刻需要全片精确视频分析',
  ]) {
    const result = build(live, [project({}, { stage: 'blocked', resumeStage: 'material_match', status: 'blocked', blocker })]);
    assert.equal(get(result, 'benchmark').status, 'blocked');
    assert.match(get(result, 'benchmark').detail, /第 1 镜缺少已确认的物理镜头边界/);
    assert.equal(get(result, 'materials').status, 'ready', 'known analysis failure does not become a material matching failure');
    assert.ok(get(result, 'benchmark').detail.includes(blocker));
  }
  const materialFailure = build(live, [project({}, { stage: 'blocked', resumeStage: 'material_match', status: 'blocked', blocker: '第 1 镜真实素材缺失' })]);
  assert.equal(get(materialFailure, 'materials').status, 'blocked');
  assert.notEqual(get(materialFailure, 'benchmark').status, 'blocked', 'generic shot/media errors are not heuristically reclassified as analysis errors');
  live.contentQueue!.items[0] = queue({ status: 'blocked', reason: '复刻镜头类型或物理镜头边界不完整' });
  assert.equal(get(build(live), 'benchmark').status, 'blocked', 'known scoped queue failure is visible while project receipts load');
}
{
  const data = overview();
  const complete = project({ renderOutputPath: '/video.mp4' }, { stage: 'completed', quality: { passed: true } });
  data.contentQueue!.items[0]!.status = 'completed';
  data.tasks[0] = task({ status: 'failed', blocked_reason: '另一母版素材缺失' });
  data.run!.status = 'failed';
  assert.equal(build(data, [complete]).status, 'completed', 'a failed sibling must not overwrite this completed content');
  data.contentQueue!.items[0]!.status = 'producing';
  const stopped = build(data, [project({}, { stage: 'render' })]);
  assert.equal(stopped.status, 'waiting');
  assert.equal(stopped.blockingReasons.length, 0, 'shared task blocker is not attributed to every content');
  data.contentQueue!.items[0] = queue({ projectIds: [], status: 'blocked', reason: '另一母版素材缺失' });
  assert.equal(build(data).status, 'waiting', 'an uncreated order inherits shared task errors but has not individually failed');
  assert.equal(build(data).blockingReasons.length, 0);
}
{
  const data = overview();
  const script = '[0-10] First\n[10-30] Second';
  const match = { sceneIndex: 0, start: 0, end: 10, assetId: 'asset' };
  for (const scenes of [[match], [match, { ...match, sceneIndex: 1, start: 10, end: 30, assetId: 'missing' }], [match, match]]) {
    const result = build(data, [project({ script, sceneSourcePlan: scenes, selectedMaterialEvidence: [{ id: 'asset', type: 'video' }] }, { stage: 'voice_subtitles' })]);
    assert.notEqual(get(result, 'materials').status, 'completed', 'partial, unproven or duplicate scene bindings must not count as complete');
  }
}
{
  for (const mutate of [
    (data: DigitalEmployeeOverview) => { data.run!.goal_id = 'other'; },
    (data: DigitalEmployeeOverview) => { data.run!.plan_id = 'old'; },
    (data: DigitalEmployeeOverview) => { data.tasks[0]!.run_id = 'old'; },
    (data: DigitalEmployeeOverview) => { data.contentQueue!.items[0]!.taskId = 'foreign'; },
  ]) {
    const data = overview(); mutate(data);
    const result = build(data, [project({ renderOutputPath: '/other.mp4' }, { stage: 'completed', quality: { passed: true } })]);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.projectIds.length, 0);
    assert.notEqual(get(result, 'render').status, 'completed');
  }
  for (const spec of [{ workflowRunId: 'other' }, { workflowTaskId: 'other' }, { contentOrderId: 'other' }, { contentOrder: { lineage: { goalId: 'other', planId: 'plan' } } }]) {
    const result = build(overview(), [project({ ...spec, renderOutputPath: '/other.mp4' }, { stage: 'completed', quality: { passed: true } })]);
    assert.notEqual(get(result, 'render').status, 'completed');
  }
  const data = overview(); data.contentQueue!.items[0]!.lineage.goalId = 'other';
  assert.equal(build(data).projectIds.length, 0);
}
{
  const adaptation = plan({ contentId: 'variant', productionRole: 'platform_adaptation', masterContentId: 'master', platform: 'instagram' });
  const data = overview([plan({ contentId: 'other', contentFamilyId: 'other-family' }), plan(), adaptation]);
  const result = buildWeeklyContentProgress(data, 'variant');
  assert.equal(result.masterContentId, 'master'); assert.equal(result.sharedMaster, true); assert.equal(result.queueItemId, 'queue');
  adaptation.productId = 'wrong';
  assert.equal(buildWeeklyContentProgress(data, 'variant').status, 'unavailable');
  adaptation.productId = 'product'; adaptation.masterContentId = 'missing';
  assert.equal(buildWeeklyContentProgress(data, 'variant').status, 'unavailable');
  adaptation.masterContentId = ''; data.plan!.businessPackage!.tasks[0]!.videoPlans!.push(plan({ contentId: 'duplicate' }));
  assert.equal(buildWeeklyContentProgress(data, 'variant').status, 'unavailable', 'ambiguous family must not choose the first master');
}
{
  for (const status of ['paused', 'cancelled', 'failed']) {
    const data = overview(); data.run!.status = status;
    const result = build(data, [project({}, { stage: 'render' })]);
    assert.notEqual(result.status, 'running'); assert.notEqual(get(result, 'render').status, 'running');
  }
  const data = overview(); data.tasks[0] = task({ status: 'waiting_external', blocked_reason: '等待供应商', output: { waitState: { kind: 'processing', requiresAttention: false } } });
  assert.equal(build(data).status, 'running');
  data.tasks[0] = task({ status: 'waiting_external', blocked_reason: '补充素材', output: { waitState: { kind: 'input', requiresAttention: true } } });
  assert.equal(build(data).status, 'waiting');
}
{
  const data = overview(); data.contentQueue!.items[0]!.projectIds.push('project-two');
  const completed = project({ renderOutputPath: '/video.mp4' }, { stage: 'completed', quality: { passed: true } });
  const result = build(data, [completed]);
  assert.notEqual(get(result, 'render').status, 'completed', 'one language cannot stand in for missing language output');
  assert.notEqual(result.status, 'completed');
  const unknown = build(overview(), [project({ renderOutputPath: '/old.mp4' }, { stage: 'new_unknown_stage', quality: { passed: true } })]);
  assert.notEqual(get(unknown, 'render').status, 'completed');
}
{
  const data = overview([plan({ route: 'clone', presenter: 'material', referenceId: 'reference' })]);
  const spec = { activeAssemblyId: 'assembly', automatedReplicationShots: [{ shotId: 'person', slotId: 'slot', kind: 'person' }],
    automatedReplicationProgress: { person: { submitted: true } } };
  const pending = build(data, [project(spec, { stage: 'material_match', replicationBridgeVersion: 1 })]);
  assert.equal(get(pending, 'presenter').status, 'waiting', 'clone-level material presenter does not skip person shots');
  assert.match(get(pending, 'presenter').detail, /供应商受理.*尚待回执核验/, 'local submission flag is not supplier acceptance');
  assert.notEqual(get(pending, 'voice').status, 'completed');
  const adopted = build(data, [project({ ...spec, storyboardAssignments: { slot: 'person-video' }, automatedReplicationProgress: { person: { submitted: true, adopted: true, materialId: 'person-video' } },
    digitalHumanAssemblyAdoptions: { 'assembly:person': { executionId: 'execution', candidateContentSha256: 'sha', fingerprint: 'fp', materialId: 'person-video' } } }, { stage: 'material_match', replicationBridgeVersion: 1 })]);
  assert.equal(get(adopted, 'presenter').status, 'completed');
  assert.equal(get(adopted, 'materials').status, 'completed');
  assert.notEqual(get(adopted, 'voice').status, 'completed', 'adopting person video does not prove final spoken audio verification');
}
{
  const data = overview([plan({ route: 'clone', referenceId: 'reference' })]);
  const pendingShot = { shotId: 'unresolved', slotId: 'blocked-slot', kind: 'blocked', required: true, productionState: 'blocked',
    intendedKind: 'nonperson', blockerCode: 'material_type_unconfirmed', blocker: '第 2 镜缺少已确认的镜头类型' };
  const base = { automatedReplicationPlan: { version: 1, referenceId: 'reference', referenceRevision: 'revision' },
    automatedReplicationShots: [{ shotId: 'known', slotId: 'slot', kind: 'nonperson', required: true, productionState: 'ready' }, pendingShot] };
  const automation = { stage: 'material_match', status: 'processing', replicationBridgeVersion: 1 };
  const queued = build(data, [project(base, automation)]);
  assert.equal(queued.statusLabel, '部分已排队');
  assert.match(queued.summary, /供应商生成结果尚待回执/);
  assert.deepEqual(queued.blockingReasons, [pendingShot.blocker]);
  assert.equal(get(queued, 'benchmark').status, 'blocked');
  assert.match(get(queued, 'benchmark').detail, /1\/2/);
  assert.equal(get(queued, 'presenter').status, 'pending', 'unclassified shots cannot establish no presenter is needed');

  const frameSpec = { ...base, automatedReplicationProgress: { known: { firstFrameMaterialId: 'frame', firstFrameFingerprint: 'fingerprint' } } };
  const before = JSON.stringify({ data, frameSpec });
  const firstFrame = build(data, [project(frameSpec, automation)]);
  assert.equal(firstFrame.status, 'running');
  assert.equal(firstFrame.statusLabel, '部分生产中');
  assert.equal(get(firstFrame, 'materials').status, 'running');
  assert.match(get(firstFrame, 'materials').detail, /0\/2.*1 个镜头已有首帧产物.*1 个必需镜头仍待处理/);
  assert.ok(get(firstFrame, 'materials').evidence.includes('首帧产物：frame'));
  assert.equal(get(firstFrame, 'render').status, 'pending');
  assert.equal(firstFrame.nextAction?.kind, 'resolve_blocker');
  assert.equal(JSON.stringify({ data, frameSpec }), before);

  const providerReceipt = { providerTaskId: 'supplier-task', providerAcceptedAt: '2026-10-11T02:00:00+08:00', providerModel: 'supplier-model' };
  const acceptedSpec = { ...frameSpec, automatedReplicationProgress: { known: { ...frameSpec.automatedReplicationProgress.known, ...providerReceipt } } };
  const acceptedSnapshot = JSON.stringify({ data, acceptedSpec });
  const accepted = build(data, [project(acceptedSpec, automation)]);
  assert.equal(accepted.statusLabel, '部分镜头已受理');
  assert.equal(accepted.status, 'ready', 'acceptance alone does not prove supplier rendering has begun');
  assert.match(accepted.summary, /1 个镜头已有供应商受理回执.*尚未取得.*视频产物/);
  assert.equal(get(accepted, 'materials').statusLabel, '供应商已受理');
  assert.match(get(accepted, 'materials').evidence.join(';'), /supplier-task.*2026-10-10T18:00:00.000Z.*supplier-model/);
  assert.equal(get(accepted, 'render').status, 'pending');
  assert.equal(get(accepted, 'quality').status, 'pending');
  assert.equal(JSON.stringify({ data, acceptedSpec }), acceptedSnapshot, 'receipt projection is read-only');

  for (const [providerStatus, label, status] of [['queued', '部分镜头排队中', 'ready'], ['processing', '部分镜头生产中', 'running']] as const) {
    const result = build(data, [project({ ...acceptedSpec, automatedReplicationProgress: { known: { ...providerReceipt, providerStatus } } }, automation)]);
    assert.equal(result.statusLabel, label);
    assert.equal(result.status, status);
    assert.notEqual(get(result, 'render').status, 'completed');
  }
  for (const incompleteReceipt of [{ submitted: true }, { providerTaskId: 'supplier-task' }, { ...providerReceipt, providerAcceptedAt: 'invalid' }, { ...providerReceipt, providerTaskId: '' }]) {
    const result = build(data, [project({ ...base, automatedReplicationProgress: { known: incompleteReceipt } }, automation)]);
    assert.equal(result.statusLabel, '部分已排队');
    assert.doesNotMatch(get(result, 'materials').detail, /已有供应商受理回执/);
  }
  const noBlockedSpec = { ...acceptedSpec, automatedReplicationShots: [base.automatedReplicationShots[0]] };
  const wholeQueued = build(data, [project(noBlockedSpec, automation)]);
  assert.equal(wholeQueued.statusLabel, '供应商已受理');
  assert.equal(wholeQueued.status, 'ready');
  assert.notEqual(get(wholeQueued, 'materials').status, 'completed');
  const acceptedButPaused = structuredClone(data); acceptedButPaused.run!.status = 'paused';
  assert.equal(build(acceptedButPaused, [project(acceptedSpec, automation)]).statusLabel, '已暂停');
  const acceptedButBlocked = build(data, [project(acceptedSpec, { ...automation, stage: 'blocked', status: 'blocked', resumeStage: 'material_match', blocker: '供应商处理异常，等待核验原任务' })]);
  assert.equal(acceptedButBlocked.status, 'blocked', 'receipt cannot override a current execution failure');
  assert.match(get(acceptedButBlocked, 'materials').evidence.join(';'), /supplier-task/, 'retained receipt remains available for recovery');
  const providerVideo = build(data, [project({ ...acceptedSpec, automatedReplicationProgress: { known: { ...providerReceipt, videoMaterialId: 'generated-shot' } } }, automation)]);
  assert.equal(providerVideo.statusLabel, '部分生产中');
  assert.match(get(providerVideo, 'materials').detail, /视频产物，采用与质检单独核验/);
  assert.doesNotMatch(get(providerVideo, 'materials').detail, /等待供应商生成结果/);
  assert.notEqual(get(providerVideo, 'render').status, 'completed', 'supplier shot output is not a finished assembled video');
  const foreignReceipt = { ...project(acceptedSpec, automation), id: 'other-project' };
  assert.doesNotMatch(build(data, [foreignReceipt]).summary, /供应商已受理/);

  // Native POST receipt is durable while the shared worker is still pending:
  // the real eight-shot project has seven executable shots and an unknown third.
  const inFlight = structuredClone(data);
  inFlight.tasks[0] = task({ status: 'pending' });
  const eightShots = Array.from({ length: 8 }, (_, index) => index === 2
    ? { ...pendingShot, blocker: '第 3 镜缺少已确认的镜头类型' }
    : { shotId: index === 0 ? 'known' : `shot-${index + 1}`, slotId: `slot-${index + 1}`, kind: 'nonperson', required: true, productionState: 'ready' });
  const inFlightSpec = { ...acceptedSpec, automatedReplicationShots: eightShots };
  const queuedAutomation = { ...automation, status: 'queued', productionGraph: { activeNode: 'material_match', nodes: [{ nodeId: 'material_match', status: 'blocked', blocker: '历史首帧质检错误' }] } };
  const inFlightResult = build(inFlight, [project(inFlightSpec, queuedAutomation)]);
  assert.equal(inFlightResult.statusLabel, '部分镜头已受理');
  assert.match(inFlightResult.summary, /1 个镜头已有供应商受理回执/);
  assert.deepEqual(inFlightResult.blockingReasons, ['第 3 镜缺少已确认的镜头类型']);
  assert.equal(get(inFlightResult, 'benchmark').status, 'blocked');
  assert.match(get(inFlightResult, 'benchmark').detail, /7\/8/);
  assert.equal(get(inFlightResult, 'materials').statusLabel, '供应商已受理');
  assert.notEqual(get(inFlightResult, 'render').status, 'completed');
  assert.equal(build(inFlight, [project({ ...base, automatedReplicationShots: eightShots }, queuedAutomation)]).status, 'blocked', 'pending local scheduling alone cannot override a real gap');
  assert.equal(build(inFlight, [project(noBlockedSpec, queuedAutomation)]).statusLabel, '供应商已受理');
  for (const status of ['paused', 'cancelled', 'failed', 'waiting_human', 'waiting_approval'] as const) {
    const stopped = structuredClone(inFlight); stopped.tasks[0] = task({ status });
    assert.doesNotMatch(build(stopped, [project(inFlightSpec, queuedAutomation)]).statusLabel, /已受理|生产中|排队中/, 'receipt must not overwrite a stopped or input-waiting task');
  }

  const video = build(data, [project({ ...base, automatedReplicationProgress: { known: { videoMaterialId: 'video' } } }, automation)]);
  assert.equal(video.statusLabel, '部分生产中');
  assert.match(get(video, 'materials').detail, /0\/2.*1 个镜头已有视频产物/);
  assert.ok(get(video, 'materials').evidence.includes('镜头视频产物：video'));
  assert.notEqual(get(video, 'render').status, 'completed', 'shot video is not assembled output');

  const assigned = build(data, [project({ ...base, storyboardAssignments: { slot: 'video', 'blocked-slot': 'old-video' },
    automatedReplicationProgress: { known: { adopted: true, materialId: 'video' }, unresolved: { adopted: true, materialId: 'old-video' } } }, automation)]);
  assert.equal(assigned.status, 'blocked', 'once every executable shot is adopted, unresolved shots still stop completion');
  assert.match(get(assigned, 'materials').detail, /1\/2/);
  assert.notEqual(get(assigned, 'materials').status, 'completed', 'stale assignment cannot satisfy a blocked required shot');

  const allBlocked = build(data, [project({ ...base, automatedReplicationShots: [pendingShot] }, automation)]);
  assert.equal(allBlocked.status, 'blocked');
  assert.equal(get(allBlocked, 'materials').status, 'blocked');

  const refused = build(data, [project(frameSpec, { ...automation, stage: 'blocked', status: 'blocked', resumeStage: 'material_match', blocker: '预算不足，未提交视频生成' })]);
  assert.equal(refused.status, 'blocked');
  assert.match(get(refused, 'materials').detail, /预算不足.*1 个镜头已有首帧产物/);
  const paused = structuredClone(data); paused.run!.status = 'paused';
  assert.equal(build(paused, [project(frameSpec, automation)]).statusLabel, '已暂停');
  const waitingInput = structuredClone(data);
  waitingInput.tasks[0] = task({ status: 'waiting_external', output: { waitState: { kind: 'input', requiresAttention: true } } });
  assert.equal(build(waitingInput, [project(frameSpec, automation)]).status, 'blocked', 'stale processing metadata cannot override an input wait');

  const invalidCompletion = build(data, [project({ ...frameSpec, renderOutputPath: '/old.mp4' }, { ...automation, stage: 'completed', quality: { passed: true } })]);
  assert.notEqual(get(invalidCompletion, 'render').status, 'completed');
  assert.notEqual(get(invalidCompletion, 'quality').status, 'completed');
  const blockedPerson = build(data, [project({ ...base, automatedReplicationShots: [base.automatedReplicationShots[0],
    { ...pendingShot, intendedKind: 'person', blockerCode: 'presenter_authorization_required', blocker: '第 2 镜需要已授权企业数字人' }] }, automation)]);
  assert.equal(get(blockedPerson, 'benchmark').status, 'completed', 'authorization gap does not erase genuine shot analysis');
  assert.equal(get(blockedPerson, 'presenter').status, 'blocked');
  assert.match(get(blockedPerson, 'presenter').detail, /已授权企业数字人/);
}
console.log('Weekly content progress evidence tests passed');
