import type { VideoCreationPlan } from '../../shared/contracts/videoCreationPlan';
import type { ContentQueueItem, DigitalEmployeeOverview, WorkflowTask } from './digitalEmployees';

export type WeeklyContentProgressStageStatus = 'pending' | 'ready' | 'running' | 'waiting' | 'blocked' | 'completed' | 'not_applicable' | 'unavailable';
export type StageStatus = WeeklyContentProgressStageStatus;
export type WeeklyContentProgressStageKey = 'benchmark' | 'script' | 'materials' | 'voice' | 'presenter' | 'render' | 'quality';
export interface WeeklyContentProgressStage {
  key: WeeklyContentProgressStageKey;
  label: string;
  status: StageStatus;
  statusLabel: string;
  detail: string;
  evidence: string[];
}
/** A read-only subset of StudioProject; importing the API here would make this model impure. */
export interface WeeklyContentProgressProject { id: string; status?: string; spec: unknown; updatedAt?: string }
export interface WeeklyContentProgress {
  contentId: string;
  masterContentId: string;
  isAdaptation: boolean;
  sharedMaster: boolean;
  queueItemId: string | null;
  taskId: string | null;
  projectIds: string[];
  status: StageStatus;
  statusLabel: string;
  summary: string;
  stages: WeeklyContentProgressStage[];
  blockingReasons: string[];
  nextAction: { label: string; kind: 'start' | 'view_master' | 'view_production' | 'resolve_blocker' | 'refresh' | 'none'; taskId?: string; projectId?: string } | null;
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const labels: Record<StageStatus, string> = { pending: '未开始', ready: '已就绪', running: '进行中', waiting: '等待中', blocked: '需处理', completed: '已完成', not_applicable: '不适用', unavailable: '待同步' };
const definitions: Array<[WeeklyContentProgressStageKey, string]> = [
  ['benchmark', '爆款脚本分析'], ['script', '脚本确认'], ['materials', '素材匹配'],
  ['voice', '口播与字幕'], ['presenter', '数字人生成'], ['render', '视频合成'], ['quality', '成片质检'],
];
const stage = (key: WeeklyContentProgressStageKey, status: StageStatus = 'pending', detail = '尚无本阶段的执行回执。', evidence: string[] = []): WeeklyContentProgressStage => ({ key, label: definitions.find(item => item[0] === key)![1], status, statusLabel: labels[status], detail, evidence });
const runtimeKeys: Record<string, WeeklyContentProgressStageKey> = {
  script: 'script', storyboard: 'script', material_match: 'materials', asset_generation: 'materials',
  voice_subtitles: 'voice', heygen: 'presenter', presenter: 'presenter', render: 'render', video_generation: 'render', quality: 'quality', quality_check: 'quality', rework: 'quality',
};

// Only known replication executor messages establish analysis ownership. Do not
// guess from generic words such as “镜头” that can describe real rendering errors.
const benchmarkFailureMessages = new Set([
  '复刻镜头类型或物理镜头边界不完整',
  '爆款分析缺少镜头边界，需补全分析后继续生产',
  '爆款分析缺少已确认的镜头类型或物理镜头边界，需补全分析后继续生产',
  '爆款分析缺少物理镜头边界，需补全分析后继续生产',
  '爆款分析缺少已确认的镜头类型，需补全分析后继续生产',
  '爆款分析缺少逐镜可见事实，需补全分析后继续生产',
  '复刻逐镜时间线不完整，不能生成完整成片',
  '复刻需要全片精确视频分析',
]);
function benchmarkFailureDetail(plan: VideoCreationPlan, blocker: string): string | null {
  if (plan.route !== 'clone' || !benchmarkFailureMessages.has(blocker)) return null;
  const shots = plan.benchmarkAnalysis?.shots || [];
  const missingBoundaries = shots.filter(shot => shot.granularity !== 'shot' || typeof shot.start !== 'number' || !Number.isFinite(shot.start)
    || typeof shot.end !== 'number' || !Number.isFinite(shot.end) || shot.start < 0 || shot.end <= shot.start).map(shot => shot.index);
  const missingTypes = shots.filter(shot => shot.materialType === 'unknown').map(shot => shot.index);
  const missingVisuals = shots.filter(shot => !text(shot.visual)).map(shot => shot.index);
  const details = [
    missingBoundaries.length ? `第 ${missingBoundaries.join('、')} 镜缺少已确认的物理镜头边界` : '',
    missingTypes.length ? `第 ${missingTypes.join('、')} 镜素材类型待确认` : '',
    missingVisuals.length ? `第 ${missingVisuals.join('、')} 镜画面描述缺失` : '',
    !shots.length ? '当前只有准备摘要，尚无可核验的完整物理镜头明细' : '',
  ].filter(Boolean);
  return [blocker, ...details].join('；');
}

function executableBenchmark(plan: VideoCreationPlan): boolean {
  const analysis = plan.benchmarkAnalysis;
  // Mirror buildReplicationWorkbenchSpec / buildBenchmarkAnalysis's physical-shot
  // checks. Target plan duration is NOT the source video's duration, so the latter's
  // normalized timelineComplete remains the end-of-source coverage evidence.
  return Boolean(analysis?.status === 'ready' && analysis.source.videoId === plan.referenceId && analysis.source.analysisMode === 'exact'
    && analysis.timelineComplete && analysis.shots.length > 0 && analysis.shots.every((shot, index) =>
      shot.materialType !== 'unknown' && shot.granularity === 'shot' && text(shot.visual)
      && typeof shot.start === 'number' && Number.isFinite(shot.start) && shot.start >= 0
      && typeof shot.end === 'number' && Number.isFinite(shot.end) && shot.end > shot.start
      && (index === 0 ? shot.start <= 0.35 : typeof analysis.shots[index - 1]!.end === 'number' && Math.abs(shot.start - analysis.shots[index - 1]!.end!) <= 0.35)));
}

function completeSceneMatching(spec: Record<string, unknown>, automation: Record<string, unknown>): number {
  // Same persisted [start-end] storyboard format as the production validator. No
  // server-only imports or guessed scene count from the selected asset count.
  const ranges = [...text(spec.script).matchAll(/^\s*\[\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\]/gm)]
    .map(match => ({ start: Number(match[1]), end: Number(match[2]) })).filter(range => range.end > range.start);
  const scenes = array(spec.sceneSourcePlan).map(object);
  const evidence = array(spec.selectedMaterialEvidence).map(object);
  if (!ranges.length || scenes.length !== ranges.length) return 0;
  return ranges.every((range, index) => {
    const matches = scenes.filter(scene => scene.sceneIndex === index);
    if (matches.length !== 1) return false;
    const scene = matches[0]!;
    const assetId = text(scene.assetId);
    return assetId && scene.start === range.start && scene.end === range.end
      && (evidence.some(asset => text(asset.id) === assetId && ['image', 'video'].includes(text(asset.type))) || assetId === text(automation.heygenOutputMaterialId));
  }) ? ranges.length : 0;
}

const blockedShot = (shot: Record<string, unknown>) => shot.kind === 'blocked' || shot.productionState === 'blocked';
const analysisBlockerCodes = new Set(['physical_boundary_unconfirmed', 'material_type_unconfirmed', 'visual_evidence_missing']);
function replicationEvidence(spec: Record<string, unknown>) {
  const shots = array(spec.automatedReplicationShots).map(object);
  const progress = object(spec.automatedReplicationProgress);
  const assignments = object(spec.storyboardAssignments);
  const blocked = shots.filter(blockedShot);
  const executable = shots.filter(shot => !blockedShot(shot));
  const assigned = executable.filter(shot => {
    const state = object(progress[text(shot.shotId)]);
    return text(assignments[text(shot.slotId)]) && state.adopted === true && text(state.materialId) === text(assignments[text(shot.slotId)]);
  });
  const firstFrames = executable.filter(shot => {
    const state = object(progress[text(shot.shotId)]);
    return text(state.firstFrameMaterialId) && text(state.firstFrameFingerprint);
  });
  const videos = executable.filter(shot => text(object(progress[text(shot.shotId)]).videoMaterialId));
  // A submission flag or a local queue entry is not a supplier receipt. A receipt
  // proves acceptance only; actual processing requires a supplier status update.
  const providerAccepted = executable.filter(shot => {
    const state = object(progress[text(shot.shotId)]);
    return !videos.includes(shot) && !assigned.includes(shot)
      && text(state.providerTaskId) && Number.isFinite(Date.parse(text(state.providerAcceptedAt)))
      && !['failed', 'cancelled', 'canceled', 'succeeded', 'completed', 'done'].includes(text(state.providerStatus));
  });
  const providerProcessing = providerAccepted.filter(shot => ['running', 'processing'].includes(text(object(progress[text(shot.shotId)]).providerStatus)));
  const providerQueued = providerAccepted.filter(shot => ['queued', 'pending'].includes(text(object(progress[text(shot.shotId)]).providerStatus)));
  return { shots, blocked, executable, assigned, firstFrames, videos, providerAccepted, providerProcessing, providerQueued };
}

function supplierSummary(projects: readonly WeeklyContentProgressProject[]) {
  const evidence = projects.map(project => replicationEvidence(object(project.spec)));
  const accepted = evidence.reduce((count, item) => count + item.providerAccepted.length, 0);
  const processing = evidence.reduce((count, item) => count + item.providerProcessing.length, 0);
  const queued = evidence.reduce((count, item) => count + item.providerQueued.length, 0);
  return {
    accepted, status: processing ? 'running' as const : 'ready' as const,
    label: processing ? '供应商生产中' : queued === accepted ? '供应商排队中' : '供应商已受理',
    detail: `${accepted} 个镜头已有供应商受理回执${processing ? `，其中 ${processing} 个正在生成` : queued === accepted ? '，正在供应商队列中等待' : '，等待供应商生成结果'}；尚未取得这些镜头的视频产物，后续采用、合成与质检仍待完成`,
  };
}

function preparation(plan: VideoCreationPlan): WeeklyContentProgressStage[] {
  const result = definitions.map(([key]) => stage(key));
  const put = (value: WeeklyContentProgressStage) => { result[result.findIndex(item => item.key === value.key)] = value; };
  const preview = plan.preproduction;
  const analysis = plan.benchmarkAnalysis;
  if (plan.route !== 'clone' && !plan.referenceId) put(stage('benchmark', 'not_applicable', '此内容未采用爆款复刻路线。'));
  else if (executableBenchmark(plan)) {
    put(stage('benchmark', 'completed', `已取得 ${analysis!.shots.length} 个真实物理镜头的完整分析结果。`, ['冻结的全片精确逐镜分析']));
  } else if (analysis?.status === 'failed' || analysis?.status === 'needs_review') {
    put(stage('benchmark', 'blocked', analysis.gaps?.join('；') || '爆款分析需要补充或复核。'));
  } else if (preview?.benchmark.status === 'ready' && preview.benchmark.referenceId === plan.referenceId && preview.benchmark.shotSummary.length > 0) {
    put({ ...stage('benchmark', 'ready', `已保存 ${preview.benchmark.shotSummary.length} 条准备摘要；全片时间线、物理切镜边界和镜头类型尚待执行校验。`, ['冻结的爆款分析摘要（非生产校验回执）']), statusLabel: '待校验' });
  } else if (analysis?.shots.length && analysis.source.videoId === plan.referenceId) {
    put({ ...stage('benchmark', 'ready', analysis.gaps.join('；') || '已保存分析结果，尚未确认全片时间线、物理切镜边界与镜头类型。', ['冻结的分析结果（待校验）']), statusLabel: '待校验' });
  }
  if (preview?.directorScript?.status === 'confirmed' && text(preview.directorScript.body) && text(preview.directorScript.hash)) {
    put(stage('script', 'completed', '导演脚本已确认；不代表口播或视频已生成。', ['已确认的导演脚本版本']));
  }
  if (preview?.materials.status === 'blocked') put(stage('materials', 'blocked', preview.materials.blockers.join('；') || '素材仍有缺失或待授权项。'));
  else if (preview?.materials.status === 'ready') put(stage('materials', 'ready', '生产前素材检查已就绪，尚未取得实际分镜匹配回执。', ['素材准备检查']));
  // Clone shots may require digital humans even when the old plan-level presenter says material.
  if (plan.presenter === 'material' && plan.route !== 'clone') put(stage('presenter', 'not_applicable', '此内容为纯素材剪辑，不生成数字人。'));
  return result;
}

function resolveMaster(plans: VideoCreationPlan[], selected: VideoCreationPlan): VideoCreationPlan | undefined {
  if (selected.productionRole !== 'platform_adaptation') return selected;
  const candidates = plans.filter(plan => plan.productionRole === 'master' && (
    selected.masterContentId ? plan.contentId === selected.masterContentId : Boolean(selected.contentFamilyId && plan.contentFamilyId === selected.contentFamilyId)
  ));
  if (candidates.length !== 1) return undefined;
  const master = candidates[0]!;
  if (selected.contentFamilyId && master.contentFamilyId !== selected.contentFamilyId) return undefined;
  if (selected.productId && master.productId !== selected.productId) return undefined;
  return master;
}

function scopedProject(project: WeeklyContentProgressProject, item: ContentQueueItem, runId: string, taskId: string): boolean {
  const spec = object(project.spec);
  const automation = object(spec.automation);
  const order = object(spec.contentOrder);
  const lineage = object(order.lineage);
  const orderId = text(order.sourceContentOrderId) || text(spec.contentOrderId) || text(order.id);
  return item.projectIds.includes(project.id)
    && text(spec.workflowRunId) === runId && text(spec.workflowTaskId) === taskId
    && text(automation.managedBy) === 'digital_employee' && text(automation.stage) !== 'superseded'
    && Boolean(orderId && orderId.split('::')[0] === item.orderId)
    && (!text(lineage.goalId) || text(lineage.goalId) === item.lineage.goalId)
    && (!text(lineage.planId) || text(lineage.planId) === item.lineage.planId);
}

function projectStages(project: WeeklyContentProgressProject, plan: VideoCreationPlan): WeeklyContentProgressStage[] {
  const result = preparation(plan);
  const put = (value: WeeklyContentProgressStage) => { result[result.findIndex(item => item.key === value.key)] = value; };
  const spec = object(project.spec);
  const automation = object(spec.automation);
  const rawStage = text(automation.stage);
  const current = ['blocked', 'failed'].includes(rawStage) ? text(automation.resumeStage) : rawStage;
  const quality = object(automation.quality);
  // A rewind must not resurrect downstream files from an earlier attempt. Stage position
  // only invalidates old evidence; it NEVER proves that an earlier stage completed.
  const order = ['script', 'material_match', 'voice_subtitles', 'heygen', 'render', 'quality', 'completed'];
  const currentIndex = order.indexOf(current);
  const canUse = (at: string) => currentIndex >= order.indexOf(at);
  const shots = array(spec.automatedReplicationShots).map(object);
  const isReplication = shots.length > 0 && Number(automation.replicationBridgeVersion) > 0;
  const assignments = object(spec.storyboardAssignments);
  const progress = object(spec.automatedReplicationProgress);
  const finish = object(spec.automatedReplicationFinish);
  const receipts = array(finish.receipts).map(object);
  if (canUse('script') && text(spec.script) && text(automation.scriptGeneratedAt)) put(stage('script', 'completed', '已保存实际生产脚本。', ['生产脚本回执']));

  if (isReplication && canUse('material_match')) {
    const { assigned, blocked: unresolved, executable, firstFrames, videos, providerAccepted, providerProcessing, providerQueued } = replicationEvidence(spec);
    const analysisBlocked = unresolved.filter(shot => analysisBlockerCodes.has(text(shot.blockerCode)));
    const livePlan = object(spec.automatedReplicationPlan);
    if (text(livePlan.referenceId) === plan.referenceId && text(livePlan.referenceRevision)) {
      put(stage('benchmark', analysisBlocked.length ? 'blocked' : 'completed', analysisBlocked.length
        ? `${shots.length - analysisBlocked.length}/${shots.length} 个镜头已有可执行分析；${analysisBlocked.map(shot => text(shot.blocker)).filter(Boolean).join('；') || '其余镜头证据待补齐'}。已确认镜头可先进入制作。`
        : `生产逐镜方案已核验 ${shots.length} 个镜头的时间线、类型与画面证据。`, ['当前生产逐镜方案']));
    }
    const materialDetail = [
      `${assigned.length}/${shots.length} 个镜头已匹配或生成并采用视频`,
      firstFrames.length ? `${firstFrames.length} 个镜头已有首帧产物` : '',
      videos.length ? `${videos.length} 个镜头已有视频产物，采用与质检单独核验` : '',
      providerAccepted.length ? `${providerAccepted.length} 个镜头已有供应商受理回执${providerProcessing.length ? `，其中 ${providerProcessing.length} 个正在生成` : providerQueued.length === providerAccepted.length ? '，正在供应商队列中等待' : '，等待供应商生成结果'}` : '',
      unresolved.length ? `${unresolved.length} 个必需镜头仍待处理，未从总数中移除` : '',
    ].filter(Boolean).join('；') + '。';
    const materialEvidence = unique([
      ...(assigned.length ? ['逐镜采用回执'] : []),
      ...firstFrames.map(shot => `首帧产物：${text(object(progress[text(shot.shotId)]).firstFrameMaterialId)}`),
      ...videos.map(shot => `镜头视频产物：${text(object(progress[text(shot.shotId)]).videoMaterialId)}`),
      ...providerAccepted.map(shot => {
        const receipt = object(progress[text(shot.shotId)]);
        return `供应商任务：${text(receipt.providerTaskId)}；受理时间：${new Date(text(receipt.providerAcceptedAt)).toISOString()}${text(receipt.providerModel) ? `；模型：${text(receipt.providerModel)}` : ''}`;
      }),
    ]);
    if (assigned.length === shots.length) put(stage('materials', 'completed', `${assigned.length}/${shots.length} 个镜头已匹配或生成并采用视频。`, ['逐镜采用回执']));
    else if (providerAccepted.length) put({ ...stage('materials', providerProcessing.length ? 'running' : 'waiting', materialDetail, materialEvidence), statusLabel: providerProcessing.length ? '供应商生产中' : providerQueued.length === providerAccepted.length ? '供应商排队中' : '供应商已受理' });
    else if (assigned.length || firstFrames.length || videos.length) put(stage('materials', 'running', materialDetail, materialEvidence));
    else if (unresolved.length) put(stage('materials', executable.length ? 'ready' : 'blocked', materialDetail));
    const people = shots.filter(shot => shot.kind === 'person');
    const blockedPeople = unresolved.filter(shot => shot.intendedKind === 'person');
    if (blockedPeople.length) put(stage('presenter', 'blocked', blockedPeople.map(shot => text(shot.blocker)).filter(Boolean).join('；') || `${blockedPeople.length} 个人物镜头等待补充必要条件。`));
    else if (!people.length) put(stage('presenter', analysisBlocked.length ? 'pending' : 'not_applicable', analysisBlocked.length ? '部分镜头类型或画面证据待确认，暂不能断言无需数字人。' : '逐镜生产计划中没有人物生成镜头。'));
    else {
      const adoptions = object(spec.digitalHumanAssemblyAdoptions);
      const accepted = people.filter(shot => {
        const adoption = object(adoptions[`${text(spec.activeAssemblyId)}:${text(shot.shotId)}`]);
        const state = object(progress[text(shot.shotId)]);
        return text(adoption.executionId) && text(adoption.candidateContentSha256) && text(adoption.fingerprint)
          && text(adoption.materialId) === text(assignments[text(shot.slotId)]) && state.adopted === true && text(state.materialId) === text(adoption.materialId);
      });
      if (accepted.length === people.length) put(stage('presenter', 'completed', `${accepted.length}/${people.length} 个人物镜头已有生成与采用凭据。`, ['数字人装配采用凭据']));
      else if (people.some(shot => object(progress[text(shot.shotId)]).submitted === true)) put(stage('presenter', 'waiting', `${accepted.length}/${people.length} 个人物镜头已采用；已记录生成请求，供应商受理与生成结果尚待回执核验。`, ['人物生成请求记录（不等于供应商已受理）']));
      else put(stage('presenter', 'pending', '人物镜头等待提交生成，选定人物不代表已生成。'));
    }
    if (!unresolved.length && current === 'completed' && text(finish.outputContentSha256) && receipts.length === shots.length && shots.every(shot => receipts.some(receipt => text(receipt.shotId) === text(shot.shotId) && text(receipt.audioSource) && text(receipt.captionSource) && text(receipt.contentSha256)))) {
      const audible = receipts.filter(receipt => receipt.audioSource !== 'intentional_silence');
      put(stage('voice', audible.length ? 'completed' : 'not_applicable', audible.length ? `${audible.length} 个镜头已有实测音轨与字幕凭据。` : '所有镜头均明确采用静音方案。', ['逐镜声音与字幕质检回执']));
    }
  } else {
    const matchedScenes = canUse('material_match') ? completeSceneMatching(spec, automation) : 0;
    if (matchedScenes > 0) put(stage('materials', 'completed', `全部 ${matchedScenes} 个分镜已有绑定素材与来源证据。`, ['完整生产分镜素材匹配结果']));
    if (canUse('voice_subtitles') && text(spec.voiceoverUrl) && Number(spec.voiceoverDur) > 0 && text(spec.subtitleAlignmentSource) && automation.narrationReviewPassed === true) {
      put(stage('voice', 'completed', '已生成口播音频，并保存字幕对齐与口播核验结果。', ['口播音频与字幕对齐回执']));
    }
    if (canUse('heygen') && text(automation.heygenOutputMaterialId)) put(stage('presenter', 'completed', '已取得数字人视频产物；成片质检单独记录。', ['数字人视频素材回执']));
    else if (canUse('heygen') && text(automation.heygenJobId)) put(stage('presenter', 'waiting', '数字人作业已提交，尚未取得视频产物。', ['供应商作业编号']));
  }
  const rendered = canUse('render') && !(isReplication && shots.some(blockedShot)) && Boolean(text(spec.renderOutputPath) || text(automation.renderOutputPath));
  if (rendered) put(stage('render', 'completed', '已保存实际合成视频的输出回执。', ['合成视频输出回执']));
  if (rendered && canUse('quality') && quality.passed === true) put(stage('quality', 'completed', '机器质检已通过；不代表已发布。', ['机器质量检查通过回执']));
  else if (rendered && canUse('quality') && quality.passed === false) put(stage('quality', 'blocked', '成片质检未通过，已保留生成结果。', ['机器质量检查失败回执']));

  const blocker = text(automation.blocker);
  const blocked = ['blocked', 'failed'].includes(rawStage) || ['blocked', 'failed'].includes(text(automation.status));
  const benchmarkFailure = blocked ? benchmarkFailureDetail(plan, blocker) : null;
  const runtimeKey = benchmarkFailure ? 'benchmark' : runtimeKeys[current];
  if (runtimeKey) {
    const existing = result.find(item => item.key === runtimeKey)!;
    // A current, scoped failure supersedes preparation/previous-attempt receipts
    // for THIS stage. Keep those receipts as retained evidence, not completion.
    if (blocked) {
      const failure = benchmarkFailure || blocker || '当前阶段等待处理，已有结果已保留。';
      put(stage(runtimeKey, 'blocked', isReplication && runtimeKey === 'materials' && existing.evidence.length ? `${failure}；${existing.detail}` : failure, existing.evidence));
      return result;
    }
    // Managed replication's coarse material_match stage covers many asynchronous shot
    // jobs. Do not claim all of those jobs are currently matching materials.
    if (!(isReplication && runtimeKey === 'materials') && !['completed', 'not_applicable', 'blocked', 'waiting'].includes(existing.status)) {
      put(stage(runtimeKey, text(automation.status) === 'queued' ? 'ready' : 'running', text(automation.status) === 'queued' ? '已进入生产队列，等待执行。' : '执行器正在处理此阶段，等待产物回执。', existing.evidence));
    }
  }
  return result;
}

function mergeStages(results: WeeklyContentProgressStage[][]): WeeklyContentProgressStage[] {
  return definitions.map(([key]) => {
    const values = results.map(items => items.find(item => item.key === key)!);
    if (values.length === 1) return values[0]!;
    const applicable = values.filter(item => item.status !== 'not_applicable');
    const completed = applicable.filter(item => item.status === 'completed').length;
    const state: StageStatus = !applicable.length ? 'not_applicable' : completed === applicable.length ? 'completed'
      : (['blocked', 'unavailable', 'running', 'waiting', 'pending', 'ready'] as const).find(value => applicable.some(item => item.status === value)) || 'pending';
    const merged = stage(key, state, `${completed}/${applicable.length} 个生产版本完成本阶段。${unique(values.filter(item => item.status !== 'completed').map(item => item.detail)).join('；')}`, unique(values.flatMap(item => item.evidence)));
    return key === 'benchmark' && state === 'ready' ? { ...merged, statusLabel: '待校验' } : merged;
  });
}

function taskWait(task: WorkflowTask): string {
  return text(task.blocked_reason) || text(object(object(task.output).waitState).message);
}

/** Pure, read-only projection. Queue percentages and previous-step flags are intentionally
 * ignored: preparation, submission, generated artifacts and acceptance are different facts. */
export function buildWeeklyContentProgress(data: DigitalEmployeeOverview, contentId: string, options: {
  projects?: readonly WeeklyContentProgressProject[];
  projectsStatus?: 'loading' | 'available' | 'unavailable';
} = {}): WeeklyContentProgress {
  const plans = data.plan?.businessPackage?.tasks.filter(item => item.templateId === 'production').flatMap(item => item.videoPlans || []) || [];
  const selected = plans.find(plan => plan.contentId === contentId);
  const master = selected && resolveMaster(plans, selected);
  const isAdaptation = selected?.productionRole === 'platform_adaptation';
  const base: WeeklyContentProgress = {
    contentId, masterContentId: master?.contentId || '', isAdaptation, sharedMaster: isAdaptation && Boolean(master),
    queueItemId: null, taskId: null, projectIds: [], status: 'pending', statusLabel: '未开始',
    summary: '尚未启动此内容的生产。', stages: master ? preparation(master) : definitions.map(([key]) => stage(key, 'unavailable', '当前计划中缺少可核验的内容或母版关联。')),
    blockingReasons: [], nextAction: null,
  };
  const finish = (status: StageStatus, summary: string, statusLabel = labels[status]) => ({ ...base, status, statusLabel, summary });
  if (!selected || !master || !data.goal || !data.plan) {
    base.nextAction = { kind: 'refresh', label: '同步当前计划' };
    return finish('unavailable', '内容或母版关联不完整，无法显示其他内容的生产状态。');
  }
  const scopedItems = (data.contentQueue?.items || []).filter(item => item.origin === 'weekly_plan' && item.lineage.goalId === data.goal!.id && item.lineage.planId === data.plan!.id && item.contentId === master.contentId);
  const item = scopedItems.length === 1 ? scopedItems[0] : undefined;
  if (item) base.queueItemId = item.id;
  const run = data.run;
  if (run && (run.goal_id !== data.goal.id || run.plan_id !== data.plan.id)) {
    base.nextAction = { kind: 'refresh', label: '同步本周运行' };
    return finish('unavailable', '运行记录与当前周目标或计划不一致，未使用其他任务的进度。');
  }
  if (!run) {
    base.nextAction = { kind: 'start', label: '开始周任务' };
    return finish(master.preproduction?.readiness.canStart ? 'ready' : 'pending', master.preproduction?.readiness.blockers.length ? '尚未启动生产；待补资料将在对应内容的执行步骤中处理。' : '尚未启动生产；已就绪的分析或脚本只是生产准备。', '待启动');
  }
  const productionTasks = data.tasks.filter(task => task.run_id === run.id && task.task_key === 'content_production');
  const task = item?.taskId ? productionTasks.find(task => task.id === item.taskId) : productionTasks.length === 1 ? productionTasks[0] : undefined;
  if (!task) {
    base.nextAction = { kind: 'refresh', label: '同步生产任务' };
    return finish('unavailable', '尚未取得属于当前运行的内容生产任务，不能确认此内容已开始生产。');
  }
  base.taskId = task.id;
  // A foreign/old queue item's task must never supply project IDs, even if content IDs repeat.
  const queue = item?.taskId === task.id ? item : undefined;
  base.projectIds = unique(queue?.projectIds || []);
  const projects = queue ? [...new Map((options.projects || []).filter(project => scopedProject(project, queue, run.id, task.id)).map(project => [project.id, project])).values()] : [];
  const missingProjectCount = base.projectIds.filter(id => !projects.some(project => project.id === id)).length;
  if (projects.length) {
    const results = projects.map(project => projectStages(project, master));
    for (let missing = 0; missing < missingProjectCount; missing++) results.push(preparation(master).map(item => ['voice', 'presenter', 'render', 'quality'].includes(item.key) && item.status !== 'not_applicable' ? stage(item.key, 'unavailable', '部分生产版本的产物回执未同步。') : item));
    base.stages = mergeStages(results);
  } else if (base.projectIds.length) {
    const detail = options.projectsStatus === 'unavailable' ? '生产记录暂不可用，请重试同步；不以排队进度替代产物回执。' : '正在等待生产项目回执同步。';
    base.stages = base.stages.map(item => ['voice', 'presenter', 'render', 'quality'].includes(item.key) && item.status !== 'not_applicable' ? stage(item.key, 'unavailable', detail) : item);
    // Current active stage is useful without fabricating completion for any previous step.
    const active = queue?.steps.find(step => step.state === 'active');
    const key = active && runtimeKeys[active.key];
    if (key && queue?.status === 'producing') base.stages = base.stages.map(item => item.key === key ? stage(key, 'running', `生产队列报告：${queue.stage}；产物回执待同步。`) : item);
  }
  // The server projects a shared failed task onto every not-yet-created order.
  // Without a content project, that is not evidence this particular content failed.
  const localQueueBlocked = queue?.status === 'blocked' && queue.projectIds.length > 0;
  const queueBenchmarkFailure = localQueueBlocked ? benchmarkFailureDetail(master, text(queue!.reason)) : null;
  if (queueBenchmarkFailure && !projects.length) base.stages = base.stages.map(item => item.key === 'benchmark' ? stage('benchmark', 'blocked', queueBenchmarkFailure, item.evidence) : item);
  base.blockingReasons = unique([
    ...projects.map(project => { const automation = object(object(project.spec).automation); return ['blocked', 'failed'].includes(text(automation.stage)) || ['blocked', 'failed'].includes(text(automation.status)) ? text(automation.blocker) : ''; }),
    ...projects.flatMap(project => {
      const spec = object(project.spec), automation = object(spec.automation);
      return Number(automation.replicationBridgeVersion) > 0 && ['material_match', 'blocked', 'failed', 'completed'].includes(text(automation.stage))
        ? replicationEvidence(spec).blocked.map(shot => text(shot.blocker) || `${text(shot.shotId)} 必需镜头等待补齐生产条件`) : [];
    }),
    ...(localQueueBlocked ? [queue!.reason] : []),
  ]);
  base.nextAction = { kind: 'view_production', label: '查看制作工作台', taskId: task.id, ...(projects[0] ? { projectId: projects[0].id } : {}) };
  const outputComplete = !missingProjectCount && projects.length > 0 && base.stages.find(item => item.key === 'render')?.status === 'completed' && base.stages.find(item => item.key === 'quality')?.status === 'completed';
  const localBlocked = localQueueBlocked || base.blockingReasons.length > 0 || base.stages.some(item => item.status === 'blocked');
  if (outputComplete && !localBlocked) return finish(queue?.status === 'completed' ? 'completed' : 'waiting', queue?.status === 'completed' ? '成片已完成并通过内容验收；发布状态请查看发布回执。' : '成片已生成且机器质检通过，等待内容验收。', queue?.status === 'completed' ? '已完成' : '待验收');
  const notExecuting = ['paused', 'cancelled', 'failed'].includes(run.status) || ['paused', 'cancelled', 'failed', 'waiting_human', 'waiting_approval'].includes(task.status);
  if (notExecuting) base.stages = base.stages.map(item => item.status === 'running' || item.status === 'ready' ? stage(item.key, 'waiting', '周任务当前没有继续执行，已保留本内容的阶段结果。', item.evidence) : item);
  if (run.status === 'paused' || task.status === 'paused') return finish('waiting', run.pause_reason || taskWait(task) || '本周任务已暂停，已保留完成的产物。', '已暂停');
  if (run.status === 'cancelled' || task.status === 'cancelled') return finish('waiting', '本次运行已取消，已有产物记录保留；未完成阶段不会继续。', '已取消');
  if (localBlocked) {
    base.nextAction = { ...base.nextAction, kind: 'resolve_blocker', label: '查看并处理卡点' };
    const wait = object(object(task.output).waitState);
    const taskAdvancing = task.status === 'running' || (task.status === 'waiting_external' && wait.kind === 'processing' && wait.requiresAttention === false);
    const advancing = !notExecuting ? projects.filter(project => {
      const spec = object(project.spec), automation = object(spec.automation);
      const evidence = replicationEvidence(spec);
      return Number(automation.replicationBridgeVersion) > 0 && text(automation.stage) === 'material_match'
        && ['processing', 'queued'].includes(text(automation.status)) && evidence.executable.length > evidence.assigned.length
        // Native acceptance is persisted before the shared task tick returns.
        // A still-pending task must not hide that receipt behind a sibling gap.
        && (taskAdvancing || (task.status === 'pending' && evidence.providerAccepted.length > 0));
    }) : [];
    if (advancing.length) {
      const supplier = supplierSummary(advancing);
      if (supplier.accepted) return finish(supplier.status, `${supplier.detail}；待处理镜头仍保留在完整计划中。${base.blockingReasons.join('；')}`, `部分${supplier.label.replace('供应商', '镜头')}`);
      const hasProductionArtifacts = advancing.some(project => {
        const evidence = replicationEvidence(object(project.spec));
        return evidence.firstFrames.length > 0 || evidence.videos.length > 0;
      });
      return finish(hasProductionArtifacts ? 'running' : 'ready', `${hasProductionArtifacts ? '部分镜头已有真实生成产物，其他可执行镜头继续推进' : '可执行镜头已进入制作调度，供应商生成结果尚待回执'}；待处理镜头仍保留在完整计划中，不会提前标记成片完成。${base.blockingReasons.join('；')}`, hasProductionArtifacts ? '部分生产中' : '部分已排队');
    }
    return finish('blocked', base.blockingReasons.join('；') || taskWait(task) || run.pause_reason || '生产遇到卡点，请查看当前阶段。');
  }
  if (run.status === 'failed' || task.status === 'failed') return finish('waiting', '周任务已停止，但本内容没有独立失败回执；已保留完成结果，等待恢复。', '等待恢复');
  if (['waiting_human', 'waiting_approval'].includes(task.status)) return finish('waiting', taskWait(task) || '生产等待确认，未继续执行。', '待确认');
  const supplier = supplierSummary(projects.filter(project => {
    const automation = object(object(project.spec).automation);
    return Number(automation.replicationBridgeVersion) > 0 && text(automation.stage) === 'material_match'
      && ['processing', 'queued'].includes(text(automation.status));
  }));
  const supplierWait = object(object(task.output).waitState);
  if (supplier.accepted && (['pending', 'running'].includes(task.status) || (task.status === 'waiting_external' && supplierWait.kind === 'processing' && supplierWait.requiresAttention === false))) {
    return finish(supplier.status, `${supplier.detail}。`, supplier.label);
  }
  if (task.status === 'waiting_external') {
    const wait = object(object(task.output).waitState);
    const working = wait.kind === 'processing' && wait.requiresAttention === false;
    return finish(working ? 'running' : 'waiting', taskWait(task) || '等待外部生成服务或下一次执行。', working ? '生产中' : '等待执行');
  }
  if (task.status === 'succeeded' || run.status === 'succeeded') return finish('unavailable', '任务已结束，但此内容的成片与质检回执尚不完整；暂不标记制作完成。');
  if (queue?.status === 'waiting_review' || queue?.status === 'completed') return finish('waiting', '队列报告成片待验收或已验收；详细产物回执尚未同步。', '同步产物中');
  if (task.status === 'running' || queue?.status === 'producing') return finish('running', isAdaptation ? '此平台版本复用对应母版的生产进度；平台交付不等于已发布。' : '生产任务已启动，以下阶段按实际产物与执行回执更新。', '生产中');
  return finish('ready', '周任务已创建，此内容等待执行；尚未开始的阶段不会标记完成。', '已排队');
}
