import type {
  SocialContentTaskDetail,
  SocialContentTaskSummary,
  SocialContentTaskStatus,
  SocialShotSourceStrategy,
} from '../../shared/contracts/socialContentWorkflow';

export type ContentProgressNodeState = 'pending' | 'active' | 'complete' | 'blocked' | 'failed';
export type ContentProgressNodeId = 'submitted' | 'preflight' | 'script' | 'shots' | 'edit' | 'quality' | 'acceptance';

export interface ContentProgressNode {
  id: ContentProgressNodeId;
  label: string;
  state: ContentProgressNodeState;
  result: string;
  timestamp: string | null;
}

export type ContentPreflightState = 'ready' | 'warning' | 'blocked' | 'unknown';

export interface ContentPreflightItem {
  id: 'materials' | 'account' | 'budget' | 'time';
  label: string;
  state: ContentPreflightState;
  value: string;
  detail: string;
}

export type ContentShotProgressState = 'queued' | 'producing' | 'quality' | 'rework' | 'completed' | 'failed';

export interface ContentShotProgress {
  sceneId: string;
  order: number;
  title: string;
  timeRange: string;
  state: ContentShotProgressState;
  sourceLabel: string;
  detail: string;
  estimatedSeconds: number;
  estimatedCostCny: number;
  qualityIssues: string[];
}

export type ContentExceptionKind = 'missing_material' | 'quality_failed' | 'model_failed';

export interface ContentProductionException {
  id: string;
  kind: ContentExceptionKind;
  title: string;
  affectedSceneIds: string[];
  impact: string;
  systemAction: string;
  userAction: string;
  resumeFrom: string;
  recovering: boolean;
}

export interface ContentAchievementSummary {
  visible: boolean;
  completedScenes: number;
  totalScenes: number;
  qualityPassedScenes: number;
  artifactCount: number;
  artifactKinds: string[];
  durationSeconds: number | null;
  elapsedSeconds: number | null;
}

type TaskLike = SocialContentTaskSummary | SocialContentTaskDetail;

const COMPLETE_TASK_STATUSES = new Set<SocialContentTaskStatus>([
  'packaging',
  'delivered',
  'awaiting_publish',
  'awaiting_metrics',
  'reviewed',
]);

const CONTENT_READY_STATUSES = new Set<SocialContentTaskStatus>([
  'asset_review',
  ...COMPLETE_TASK_STATUSES,
]);

function isDetail(task: TaskLike): task is SocialContentTaskDetail {
  return 'artifacts' in task;
}

function minutesLabel(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '正在计算';
  if (seconds <= 60) return '约 1 分钟';
  return `约 ${Math.ceil(seconds / 60)} 分钟`;
}

function money(value: number): string {
  return `¥${Math.max(0, value).toFixed(2)}`;
}

function activeProgressIndex(task: TaskLike): number {
  if (COMPLETE_TASK_STATUSES.has(task.status)) return 7;
  if (task.status === 'asset_review') return 6;
  if (task.status === 'draft' || task.status === 'needs_input' || task.status === 'plan_review') return 1;
  if (!isDetail(task)) return task.directorPlan?.status === 'ready' ? 3 : 2;
  const progress = `${task.productionProgress?.step || ''} ${task.productionProgress?.activity || ''}`.toLowerCase();
  if (/质检|审核|quality|review|evaluate/.test(progress)) return 5;
  if (/剪辑|合成|音乐|音效|特效|render|edit|music|sound|effect/.test(progress)) return 4;
  if (/分镜|素材|语音|配音|字幕|shot|material|asset|voice|audio|subtitle|caption/.test(progress)) return 3;
  if (/脚本|口播|编导|script|copy|director/.test(progress)) return 2;
  return task.directorPlan?.status === 'ready' ? 3 : 2;
}

function interruption(task: TaskLike): { state: 'blocked' | 'failed'; message: string } | null {
  if (!isDetail(task)) return task.status === 'paused' || task.status === 'attention'
    ? { state: 'blocked', message: '任务需要处理，已完成结果会保留' }
    : null;
  const stage = task.agentWorkflow?.stage;
  if (stage === 'needs_facts') return { state: 'blocked', message: '缺少不可替代的产品事实' };
  if (stage === 'needs_rights') return { state: 'blocked', message: '素材使用权等待确认' };
  if (stage === 'needs_budget') return { state: 'blocked', message: '预计费用超出任务预算' };
  if (stage === 'goal_degraded') return { state: 'blocked', message: '当前方案会降低成片目标' };
  if (stage === 'failed_recoverable') return { state: 'failed', message: '本次制作未完成，可从当前节点恢复' };
  if (task.status === 'paused') return { state: 'blocked', message: '任务已暂停，当前结果和进度已保留' };
  return null;
}

function qualityBlocked(task: TaskLike): boolean {
  if (!isDetail(task)) return false;
  const evaluation = task.agentWorkflow?.replicationEvaluation;
  if (evaluation && evaluation.status !== 'passed') return true;
  const result = task.agentWorkflow?.productionResult;
  return Boolean(result && (!result.technicalReview.approved || !result.creativeReview.approved));
}

function sceneCounts(task: TaskLike): { total: number; completed: number } {
  if (!isDetail(task)) return { total: task.directorPlan?.sceneCount || 0, completed: CONTENT_READY_STATUSES.has(task.status) ? task.directorPlan?.sceneCount || 0 : 0 };
  const total = task.agentWorkflow?.executionPlan.scenes.length || task.directorPlan?.sceneCount || 0;
  const completed = task.agentWorkflow?.productionResult?.sceneResults.length
    ?? (CONTENT_READY_STATUSES.has(task.status) ? total : 0);
  return { total, completed: Math.min(total, completed) };
}

export function contentProgressNodes(task: TaskLike): ContentProgressNode[] {
  const index = activeProgressIndex(task);
  const issue = interruption(task);
  const counts = sceneCounts(task);
  const detail = isDetail(task) ? task : null;
  const scriptScenes = task.directorPlan?.sceneCount || detail?.agentWorkflow?.directorBrief.scenes.length || 0;
  const duration = detail?.agentWorkflow?.directorBrief.totalDurationSeconds;
  const artifacts = detail?.artifacts.filter(item => item.status !== 'superseded') || [];
  const definitions: Array<Omit<ContentProgressNode, 'state'>> = [
    { id: 'submitted', label: '任务已提交', result: '任务资料与后续进度会自动保存', timestamp: task.createdAt },
    { id: 'preflight', label: '制作准备', result: issue && index === 1 ? issue.message : task.status === 'plan_review' ? '费用、素材路线和预计时间已就绪，等待你确认' : task.readiness.complete ? '必要资料、素材路线和执行条件已检查' : `还有 ${task.readiness.missing.length} 项必要信息待处理`, timestamp: task.updatedAt },
    { id: 'script', label: '脚本与口播', result: task.directorPlan?.status === 'ready' ? `已形成 ${scriptScenes} 个镜头${duration ? ` · 预计 ${Math.round(duration)} 秒` : ''}` : '正在整理脚本、口播和镜头安排', timestamp: task.directorPlan?.createdAt || null },
    { id: 'shots', label: '逐镜制作', result: counts.total ? `${counts.completed}/${counts.total} 个镜头已取得制作结果` : '等待镜头方案确认', timestamp: task.updatedAt },
    { id: 'edit', label: '剪辑合成', result: detail?.agentWorkflow?.productionResult ? '画面、配音和字幕已完成合成' : '等待逐镜结果进入合成', timestamp: task.updatedAt },
    { id: 'quality', label: '成片质检', result: qualityBlocked(task) ? '成片检查未通过，需要处理' : CONTENT_READY_STATUSES.has(task.status) ? '画面、声音和字幕检查已完成' : '等待成片进入质量检查', timestamp: task.updatedAt },
    { id: 'acceptance', label: '完成与验收', result: artifacts.length ? `已生成 ${artifacts.length} 项成果，等待确认或交付` : COMPLETE_TASK_STATUSES.has(task.status) ? '本轮内容已经完成' : '完成后可在这里预览和确认成果', timestamp: task.updatedAt },
  ];

  return definitions.map((definition, nodeIndex) => {
    let state: ContentProgressNodeState = nodeIndex < index ? 'complete' : nodeIndex === index ? 'active' : 'pending';
    if (index >= definitions.length) state = 'complete';
    if (issue && nodeIndex === index) state = issue.state;
    if (qualityBlocked(task) && nodeIndex === 5) state = 'failed';
    if (task.status === 'plan_review' && nodeIndex === 1) state = 'blocked';
    if (task.status === 'asset_review' && nodeIndex === 6) state = 'active';
    return { ...definition, state };
  });
}

function strategyUsesExistingMaterial(strategy: SocialShotSourceStrategy): boolean {
  return strategy === 'customer_real_asset' || strategy === 'customer_product_image_animation';
}

export function contentPreflightItems(task: SocialContentTaskDetail): ContentPreflightItem[] {
  const workflow = task.agentWorkflow;
  const scenes = workflow?.executionPlan.scenes || [];
  const existing = scenes.filter(scene => strategyUsesExistingMaterial(scene.selectedSourceStrategy)).length;
  const blockedScenes = scenes.filter(scene => scene.feasibility === 'blocked_for_facts_or_rights');
  const systemSupplied = Math.max(0, scenes.length - existing - blockedScenes.length);
  const materialBlocked = blockedScenes.length > 0
    || workflow?.executionPlanReview.reasonCodes.some(reason => ['material_insufficient', 'facts_missing', 'rights_missing'].includes(reason));
  const accountRefs = workflow?.directorBrief.accountRefs || [];
  const targetAccountRef = task.brief.targetAccountRef?.id || task.brief.accountPlaybookRef?.id || null;
  const accountCount = new Set([...accountRefs, ...(targetAccountRef ? [targetAccountRef] : [])]).size;
  const estimatedCost = workflow?.executionPlan.estimatedTotalCostCny;
  const budgetLimit = workflow?.executionPlan.budgetLimitCny;
  const budgetExceeded = workflow?.executionPlanReview.reasonCodes.includes('budget_exceeded')
    || (estimatedCost != null && budgetLimit != null && estimatedCost > budgetLimit);
  const estimatedSeconds = workflow?.executionPlan.estimatedTotalSeconds
    ?? task.productionProgress?.estimatedRemainingSeconds
    ?? null;

  return [
    {
      id: 'materials',
      label: '素材',
      state: materialBlocked ? 'blocked' : scenes.length ? 'ready' : 'unknown',
      value: scenes.length ? `${existing} 镜已有 · ${systemSupplied} 镜系统补齐${blockedScenes.length ? ` · ${blockedScenes.length} 镜待处理` : ''}` : '正在盘点',
      detail: materialBlocked ? '存在不可替代的事实、权利或产品画面，请先处理' : scenes.length ? '系统可补齐的镜头不会阻止开始制作' : '导演方案完成后显示逐镜素材覆盖',
    },
    {
      id: 'account',
      label: '账号',
      state: accountCount ? 'ready' : 'warning',
      value: accountCount ? `已关联 ${accountCount} 个目标账号` : '尚未关联发布账号',
      detail: accountCount ? '成片完成后可继续确认发布安排' : '不影响制作；完成后会先保存到作品库',
    },
    {
      id: 'budget',
      label: '预算',
      state: estimatedCost == null ? 'unknown' : budgetExceeded ? 'blocked' : 'ready',
      value: estimatedCost == null ? '正在核算' : budgetLimit == null ? `预计 ${money(estimatedCost)}` : `预计 ${money(estimatedCost)} / 上限 ${money(budgetLimit)}`,
      detail: estimatedCost == null ? '执行方案完成后显示真实预估' : budgetExceeded ? `预计超出 ${money(Math.max(0, estimatedCost - (budgetLimit || 0)))}` : '最终费用按实际调用结算',
    },
    {
      id: 'time',
      label: '预计时间',
      state: estimatedSeconds == null ? 'unknown' : 'ready',
      value: minutesLabel(estimatedSeconds),
      detail: task.productionProgress?.updatedAt ? `最近更新 ${new Date(task.productionProgress.updatedAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '开始制作后会按真实进度校准',
    },
  ];
}

const STRATEGY_LABELS: Record<SocialShotSourceStrategy, string> = {
  customer_real_asset: '使用已授权的真实素材',
  customer_product_image_animation: '使用产品图片制作动态画面',
  aigc_product_scene_replication: '按产品身份参考生成场景',
  authorized_digital_presenter: '生成已授权的数字人口播',
  licensed_stock_asset: '使用已授权的素材库画面',
  non_evidentiary_ai_visual: '生成非事实证明画面',
  motion_graphics: '制作信息图与动态文字',
  verified_fact_card: '制作已核验事实说明卡',
};

function evaluationIssues(task: SocialContentTaskDetail, sceneId: string): string[] {
  const scene = task.agentWorkflow?.replicationEvaluation?.sceneResults.find(item => item.sceneId === sceneId);
  return scene?.factorResults.filter(item => item.status !== 'passed').map(item => item.repairAction || `${item.factorId} 未通过`).filter(Boolean) || [];
}

function shotState(task: SocialContentTaskDetail, sceneId: string): ContentShotProgressState {
  const workflow = task.agentWorkflow;
  if (!workflow) return 'queued';
  const review = workflow.executionPlanReview.sceneResults.find(item => item.sceneId === sceneId);
  const produced = workflow.productionResult?.sceneResults.some(item => item.sceneId === sceneId) || false;
  const issues = evaluationIssues(task, sceneId);
  if (issues.length) return workflow.replicationEvaluation?.directorDecision.status === 'changes_required' || task.status === 'producing' ? 'rework' : 'failed';
  if (review && !review.approved && review.reasonCodes.some(reason => ['generation_failed', 'expression_failed', 'capability_mismatch'].includes(reason))) return 'failed';
  if (workflow.stage === 'failed_recoverable' && !produced) return 'failed';
  if (CONTENT_READY_STATUSES.has(task.status)) return produced || !workflow.productionResult ? 'completed' : 'failed';
  if (workflow.stage === 'technical_review' || workflow.stage === 'media_evaluation' || workflow.stage === 'creative_review' || /质检|审核|quality|review/i.test(task.productionProgress?.step || '')) return produced ? 'quality' : 'producing';
  if (task.status === 'producing' || task.status === 'attention') return produced ? 'quality' : 'producing';
  return 'queued';
}

export function contentShotProgress(task: SocialContentTaskDetail): ContentShotProgress[] {
  const workflow = task.agentWorkflow;
  if (!workflow) return [];
  const directorScenes = new Map(workflow.directorBrief.scenes.map(scene => [scene.sceneId, scene]));
  return workflow.executionPlan.scenes.map((scene, index) => {
    const director = directorScenes.get(scene.sceneId);
    const qualityIssues = evaluationIssues(task, scene.sceneId);
    const state = shotState(task, scene.sceneId);
    const start = director?.duration.startSeconds;
    const end = director?.duration.endSeconds;
    const detail = state === 'queued' ? '已进入本批制作队列'
      : state === 'producing' ? '正在生成或整理本镜头画面'
        : state === 'quality' ? '正在检查画面、声音和字幕'
          : state === 'rework' ? `只重做未通过部分；其他镜头已保留${qualityIssues[0] ? `：${qualityIssues[0]}` : ''}`
            : state === 'completed' ? '制作和当前质量检查已完成'
              : workflow.stage === 'failed_recoverable' ? '模型调用未完成，可从本镜头恢复' : scene.feasibilityReason || '本镜头制作未完成';
    return {
      sceneId: scene.sceneId,
      order: index + 1,
      title: director?.targetVisual || director?.purpose || `镜头 ${index + 1}`,
      timeRange: start != null && end != null ? `${start.toFixed(1)}–${end.toFixed(1)} 秒` : `镜头 ${index + 1}`,
      state,
      sourceLabel: STRATEGY_LABELS[scene.selectedSourceStrategy],
      detail,
      estimatedSeconds: scene.estimatedSeconds,
      estimatedCostCny: scene.estimatedCostCny,
      qualityIssues,
    };
  });
}

export function contentProductionExceptions(task: SocialContentTaskDetail): ContentProductionException[] {
  const workflow = task.agentWorkflow;
  if (!workflow) return [];
  const exceptions: ContentProductionException[] = [];
  const materialScenes = workflow.executionPlanReview.sceneResults
    .filter(item => item.reasonCodes.some(reason => ['material_insufficient', 'facts_missing', 'rights_missing'].includes(reason)))
    .map(item => item.sceneId);
  if (materialScenes.length || ['needs_facts', 'needs_rights'].includes(workflow.stage)) {
    exceptions.push({
      id: 'missing-material',
      kind: 'missing_material',
      title: workflow.stage === 'needs_rights' ? '素材使用权等待确认' : '缺少不可替代的素材或事实',
      affectedSceneIds: materialScenes,
      impact: materialScenes.length ? `影响 ${materialScenes.length} 个镜头，其他镜头和已生成结果会保留` : '当前方案无法安全进入正式制作',
      systemAction: '系统已检查现有素材和可替代制作路线，不会用生成画面冒充真实证据',
      userAction: workflow.stage === 'needs_rights' ? '确认素材使用权或更换素材' : '补充对应产品、证书或事实素材',
      resumeFrom: materialScenes.length ? `补齐后从受影响的 ${materialScenes.length} 个镜头继续` : '补齐后从制作准备继续',
      recovering: false,
    });
  }

  const evaluation = workflow.replicationEvaluation;
  const qualityScenes = evaluation?.sceneResults.filter(scene => scene.factorResults.some(item => item.status !== 'passed')).map(scene => scene.sceneId) || [];
  if (qualityScenes.length || (workflow.productionResult && (!workflow.productionResult.technicalReview.approved || !workflow.productionResult.creativeReview.approved))) {
    exceptions.push({
      id: 'quality-failed',
      kind: 'quality_failed',
      title: '部分镜头质量检查未通过',
      affectedSceneIds: qualityScenes,
      impact: qualityScenes.length ? `仅影响 ${qualityScenes.length} 个镜头；已通过镜头不会重做` : '成片暂时不能进入验收或发布',
      systemAction: evaluation?.directorDecision.status === 'changes_required' ? '系统已生成局部返工要求并保留已通过镜头' : '系统已保存检查结果和现有成片',
      userAction: '查看修改要求并确认只重做失败镜头',
      resumeFrom: '返工完成后重新进入成片质检',
      recovering: evaluation?.directorDecision.status === 'changes_required' && task.status === 'producing',
    });
  }

  const modelScenes = workflow.executionPlanReview.sceneResults
    .filter(item => item.reasonCodes.some(reason => ['generation_failed', 'expression_failed', 'capability_mismatch'].includes(reason)))
    .map(item => item.sceneId);
  if (workflow.stage === 'failed_recoverable' || modelScenes.length) {
    exceptions.push({
      id: 'model-failed',
      kind: 'model_failed',
      title: '模型调用未完成',
      affectedSceneIds: modelScenes,
      impact: modelScenes.length ? `影响 ${modelScenes.length} 个镜头；已确认结果会保留` : '当前制作批次已停在可恢复节点',
      systemAction: task.status === 'attention' ? '系统正在切换可用方案并保留原运行记录' : '系统已保存最后一次确认结果，避免重复计费和重复提交',
      userAction: task.status === 'attention' ? '暂时无需操作，也可以打开任务查看恢复进度' : '重试当前节点或选择可用替代方案',
      resumeFrom: '恢复后从失败镜头继续，不重做已完成镜头',
      recovering: task.status === 'attention',
    });
  }
  return exceptions;
}

export function contentAchievementSummary(task: SocialContentTaskDetail): ContentAchievementSummary {
  const workflow = task.agentWorkflow;
  const totalScenes = workflow?.executionPlan.scenes.length || task.directorPlan?.sceneCount || 0;
  const completedScenes = workflow?.productionResult?.sceneResults.length || (CONTENT_READY_STATUSES.has(task.status) ? totalScenes : 0);
  const evaluation = workflow?.replicationEvaluation;
  const qualityPassedScenes = evaluation
    ? evaluation.sceneResults.filter(scene => scene.factorResults.every(item => item.status === 'passed')).length
    : workflow?.productionResult?.technicalReview.approved ? completedScenes : 0;
  const artifacts = task.artifacts.filter(item => item.status !== 'superseded');
  const createdAt = Date.parse(task.createdAt);
  const updatedAt = Date.parse(task.updatedAt);
  return {
    visible: CONTENT_READY_STATUSES.has(task.status) || Boolean(workflow?.productionResult),
    completedScenes,
    totalScenes,
    qualityPassedScenes,
    artifactCount: artifacts.length,
    artifactKinds: [...new Set(artifacts.map(item => item.kind))],
    durationSeconds: workflow?.directorBrief.totalDurationSeconds ?? null,
    elapsedSeconds: Number.isFinite(createdAt) && Number.isFinite(updatedAt) && updatedAt >= createdAt ? Math.round((updatedAt - createdAt) / 1000) : null,
  };
}

export function formatContentDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '暂无';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
}
