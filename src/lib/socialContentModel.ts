import type {
  SocialArtifactStatus,
  SocialContentSourceOption,
  SocialContentTaskDetail,
  SocialContentTaskMode,
  SocialContentTaskStatus,
  SocialContentThemeId,
} from '../../shared/contracts/socialContentWorkflow';

export const SOCIAL_CONTENT_STAGES = [
  { id: 'prepare', label: '本周设定' },
  { id: 'plan', label: '周计划' },
  { id: 'produce', label: '批量生产' },
  { id: 'review', label: '批次验收' },
  { id: 'deliver', label: '交付发布' },
  { id: 'measure', label: '周复盘' },
] as const;

export type SocialContentStageId = typeof SOCIAL_CONTENT_STAGES[number]['id'];
export type { SocialContentTaskStatus };

const INSTANT_STAGE_LABELS: Record<SocialContentStageId, string> = {
  prepare: '准备信息',
  plan: '确认方案',
  produce: '生成内容',
  review: '验收成品',
  deliver: '交付发布',
  measure: '效果回收',
};

export function socialContentStagesForMode(mode?: SocialContentTaskMode | null) {
  if (mode !== 'instant') return SOCIAL_CONTENT_STAGES;
  return SOCIAL_CONTENT_STAGES.map(stage => ({ ...stage, label: INSTANT_STAGE_LABELS[stage.id] }));
}

export type SocialContentPrimaryAction =
  | 'create'
  | 'continue'
  | 'start'
  | 'resume'
  | 'continue_production'
  | 'view_progress'
  | 'review_assets'
  | 'download'
  | 'register_publication'
  | 'submit_metrics'
  | 'create_next';

const STAGE_BY_STATUS: Record<SocialContentTaskStatus, SocialContentStageId> = {
  draft: 'prepare',
  needs_input: 'prepare',
  plan_review: 'plan',
  producing: 'produce',
  asset_review: 'review',
  packaging: 'deliver',
  delivered: 'deliver',
  awaiting_publish: 'deliver',
  awaiting_metrics: 'measure',
  reviewed: 'measure',
  paused: 'produce',
  attention: 'produce',
};

const STATUS_LABEL: Record<SocialContentTaskStatus, string> = {
  draft: '草稿',
  needs_input: '资料待补充',
  plan_review: '方案待确认',
  producing: '制作中',
  asset_review: '成品待确认',
  packaging: '正在整理交付包',
  delivered: '已交付',
  awaiting_publish: '等待登记发布结果',
  awaiting_metrics: '等待回传数据',
  reviewed: '已完成复盘',
  paused: '已暂停',
  attention: '需要处理',
};

export function socialContentStage(status: SocialContentTaskStatus): SocialContentStageId {
  return STAGE_BY_STATUS[status];
}

export function socialContentStatusLabel(status: SocialContentTaskStatus): string {
  return STATUS_LABEL[status];
}

export function socialContentStageIndex(status: SocialContentTaskStatus): number {
  return SOCIAL_CONTENT_STAGES.findIndex(stage => stage.id === socialContentStage(status));
}

export function socialContentPrimaryAction(status: SocialContentTaskStatus): SocialContentPrimaryAction {
  if (status === 'draft' || status === 'needs_input') return 'continue';
  if (status === 'plan_review') return 'start';
  if (status === 'paused') return 'resume';
  if (status === 'attention') return 'continue_production';
  if (status === 'producing' || status === 'packaging') return 'view_progress';
  if (status === 'asset_review') return 'review_assets';
  if (status === 'delivered') return 'download';
  if (status === 'awaiting_publish') return 'register_publication';
  if (status === 'awaiting_metrics') return 'submit_metrics';
  return 'create_next';
}

export function socialContentCurrentDelivery(task: Pick<SocialContentTaskDetail, 'deliveryPackages'>) {
  return task.deliveryPackages.filter(item => item.status !== 'superseded').at(-1) ?? null;
}

export function socialContentCanRegisterPublication(
  task: Pick<SocialContentTaskDetail, 'status' | 'deliveryPackages'>,
): boolean {
  if (!['delivered', 'awaiting_publish', 'awaiting_metrics'].includes(task.status)) return false;
  const delivery = socialContentCurrentDelivery(task);
  return delivery?.status === 'ready' || delivery?.status === 'confirmed';
}

export function socialContentCurrentArtifacts<T extends { status: SocialArtifactStatus }>(artifacts: T[]): T[] {
  return artifacts.filter(artifact => artifact.status !== 'superseded');
}

/** Child records are stronger evidence than a lagging denormalized task status. */
export function socialContentTaskHeadline(task: Pick<SocialContentTaskDetail, 'status' | 'deliveryPackages' | 'publications' | 'metricSubmissions'>): string {
  if (task.status === 'reviewed') return socialContentStatusLabel(task.status);
  if (task.metricSubmissions.length > 0) return '发布数据已回传';
  if (task.publications.length > 0) return '发布结果已登记';
  const delivery = socialContentCurrentDelivery(task);
  if (delivery?.status === 'preparing') return '正在整理交付包';
  if (delivery?.status === 'ready' || delivery?.status === 'confirmed') return '交付包已准备好';
  return socialContentStatusLabel(task.status);
}

export function socialContentPrimaryActionForTask(
  task: Pick<SocialContentTaskDetail, 'status' | 'deliveryPackages' | 'publications' | 'metricSubmissions'>,
): SocialContentPrimaryAction {
  if (task.status === 'reviewed') return 'create_next';
  if (task.publications.length > 0) return 'submit_metrics';
  const action = socialContentPrimaryAction(task.status);
  if ((action === 'download' || action === 'register_publication') && !socialContentCanRegisterPublication(task)) {
    return 'view_progress';
  }
  return action;
}

export const SOCIAL_CONTENT_PRODUCTION_STAGES = [
  { id: 'inputs', label: '输入已确认' },
  { id: 'production', label: '正在制作' },
  { id: 'quality', label: '质量检查' },
  { id: 'review', label: '待验收' },
] as const;

export type SocialContentProductionStageId = typeof SOCIAL_CONTENT_PRODUCTION_STAGES[number]['id'];
export type SocialContentProductionStageState = 'complete' | 'current' | 'pending';

type SocialContentProductionTask = Pick<
  SocialContentTaskDetail,
  'status' | 'readiness' | 'artifacts' | 'deliveryPackages' | 'publications' | 'metricSubmissions'
>;

const AFTER_REVIEW_STATUSES = new Set<SocialContentTaskStatus>([
  'packaging',
  'delivered',
  'awaiting_publish',
  'awaiting_metrics',
  'reviewed',
]);

/**
 * A coarse production view derived only from persisted task and artifact state.
 * It deliberately exposes no synthetic percentage or unpersisted background step.
 */
export function socialContentProductionProgress(task: SocialContentProductionTask): {
  headline: string;
  detail: string;
  currentStageId: SocialContentProductionStageId | null;
  steps: Array<(typeof SOCIAL_CONTENT_PRODUCTION_STAGES)[number] & { state: SocialContentProductionStageState }>;
  artifactCount: number;
  pendingReviewCount: number;
} {
  const artifacts = socialContentCurrentArtifacts(task.artifacts);
  const pendingReviewCount = artifacts.filter(artifact => artifact.status === 'review_required').length;
  const approvedCount = artifacts.filter(artifact => artifact.status === 'approved').length;
  const inputsComplete = task.readiness.complete || !['draft', 'needs_input'].includes(task.status);
  const reviewComplete = AFTER_REVIEW_STATUSES.has(task.status)
    || (artifacts.length > 0 && approvedCount === artifacts.length);
  const reviewCurrent = !reviewComplete
    && (task.status === 'asset_review' || pendingReviewCount > 0);
  const qualityComplete = reviewCurrent || reviewComplete;
  // The public task contract has no persisted "quality check is running" state.
  // Keep this stage pending until a reviewable artifact or later task status proves it completed.
  const productionComplete = qualityComplete;

  let currentStageId: SocialContentProductionStageId | null = null;
  if (!inputsComplete) currentStageId = 'inputs';
  else if (reviewCurrent) currentStageId = 'review';
  else if (['attention', 'producing', 'paused'].includes(task.status)) currentStageId = 'production';

  const completeStages = new Set<SocialContentProductionStageId>();
  if (inputsComplete) completeStages.add('inputs');
  if (productionComplete) completeStages.add('production');
  if (qualityComplete) completeStages.add('quality');
  if (reviewComplete) completeStages.add('review');

  let headline = '请先确认制作输入';
  let detail = task.readiness.missing.length > 0
    ? `还有 ${task.readiness.missing.length} 项制作信息待补充。`
    : '确认主题、产品资料和素材后即可开始制作。';
  if (task.status === 'plan_review') {
    headline = '制作输入已确认';
    detail = '任务已经准备好，可以开始制作。';
  } else if (task.status === 'attention') {
    headline = '机器人正在自动重试';
    detail = '已有脚本、素材与生成结果均已保存。';
  } else if (task.status === 'paused') {
    headline = '自动生成已暂停';
    detail = '已有脚本、素材与生成结果均已保存。';
  } else if (task.status === 'producing') {
    headline = '内容正在制作';
    detail = '任务正在执行，成品生成后会进入质量检查。';
  } else if (task.status === 'asset_review') {
    headline = pendingReviewCount > 0 ? `${pendingReviewCount} 项成品待验收` : '成品等待验收';
    detail = artifacts.length > 0 ? `当前共有 ${artifacts.length} 项成品。` : '成品状态已进入验收阶段。';
  } else if (task.status === 'packaging') {
    headline = '验收完成，正在整理交付';
    detail = '已确认的成品正在整理为交付包。';
  } else if (task.status === 'delivered' || task.status === 'awaiting_publish') {
    headline = '成品已完成交付';
    detail = '制作与验收均已完成，可以下载交付包或登记发布结果。';
  } else if (task.status === 'awaiting_metrics') {
    headline = '成品已发布';
    detail = '制作与验收均已完成，等待回传发布数据。';
  } else if (task.status === 'reviewed') {
    headline = '本轮制作已完成';
    detail = '成品、交付和效果回收均已完成。';
  }

  return {
    headline,
    detail,
    currentStageId,
    steps: SOCIAL_CONTENT_PRODUCTION_STAGES.map(stage => ({
      ...stage,
      state: completeStages.has(stage.id)
        ? 'complete'
        : currentStageId === stage.id
          ? 'current'
          : 'pending',
    })),
    artifactCount: artifacts.length,
    pendingReviewCount,
  };
}

export function socialContentAssetReviewAction(artifacts: Array<{ status: SocialArtifactStatus }>): 'review' | 'package' | 'progress' {
  const current = artifacts.filter(artifact => artifact.status !== 'superseded');
  if (current.some(artifact => artifact.status === 'review_required')) return 'review';
  if (current.length > 0 && current.every(artifact => artifact.status === 'approved')) return 'package';
  return 'progress';
}

export interface SocialContentDraft {
  mode: SocialContentTaskMode;
  productionMode: 'social_ready' | 'concept_preview';
  themeId: SocialContentThemeId | '';
  customTopic: string;
  topic: string;
  title: string;
  productName: string;
  primaryGoal: string;
  audience: string;
  market: string;
  language: string;
  desiredDeliveryAt: string;
  selectedSources: SocialContentSourceOption[];
  removedSourceIds: string[];
  referenceLinks: string[];
  keyFacts: string;
  prohibitedClaims: string;
  callToAction: string;
  platforms: string[];
  formats: string[];
  quantity: number;
  weeklyBudgetCny: number | null;
  perItemBudgetCny: number | null;
  retryReserveCny: number | null;
  planningMode: 'fixed' | 'auto_adjust';
  shootingWindowMinutes: number | null;
  specialRequirements: string;
  aspectRatio: string;
  cadence: string;
  packageSelection: Record<'industry_launch' | 'content_rocket' | 'task_express', string>;
}

export const EMPTY_SOCIAL_CONTENT_DRAFT: SocialContentDraft = {
  mode: 'instant',
  productionMode: 'social_ready',
  themeId: 'product_value',
  customTopic: '',
  topic: '',
  title: '',
  productName: '',
  primaryGoal: '',
  audience: '',
  market: '',
  language: '简体中文',
  desiredDeliveryAt: '',
  selectedSources: [],
  removedSourceIds: [],
  referenceLinks: [],
  keyFacts: '',
  prohibitedClaims: '',
  callToAction: '',
  platforms: [],
  formats: [],
  quantity: 1,
  weeklyBudgetCny: null,
  perItemBudgetCny: null,
  retryReserveCny: null,
  planningMode: 'auto_adjust',
  shootingWindowMinutes: null,
  specialRequirements: '',
  aspectRatio: '9:16',
  cadence: '',
  packageSelection: {
    industry_launch: 'framework-v1',
    content_rocket: 'framework-v1',
    task_express: 'framework-v1',
  },
};

export function validateSocialContentDraft(draft: SocialContentDraft): Record<number, string[]> {
  const issues: Record<number, string[]> = {};
  const add = (step: number, message: string) => { issues[step] = [...(issues[step] || []), message]; };
  const list = (value: string) => value.split(/[、,，;；\n]/).map(item => item.trim()).filter(Boolean);
  const fastStart = draft.mode === 'instant';
  if (!draft.themeId && !draft.customTopic.trim()) add(0, '请选择一个内容主题，或填写自定义主题');
  if (draft.customTopic.length > 300) add(0, '自定义主题不超过 300 字');
  if (draft.topic.length > 300) add(0, '一句话选题不超过 300 字');
  if (!draft.title.trim()) add(0, '请填写任务名称');
  if (!fastStart && !draft.productName.trim()) add(0, '请填写产品或业务主题');
  if (!draft.primaryGoal.trim()) add(0, '请选择本次主要目标');
  if (!fastStart && !draft.audience.trim()) add(0, '请填写目标客户');
  if (!fastStart && !draft.market.trim()) add(0, '请填写目标市场');
  if (!fastStart && !draft.language.trim()) add(0, '请填写内容语言');
  const markets = list(draft.market);
  const languages = list(draft.language);
  if (markets.length > 10 || markets.some(item => item.length > 80)) add(0, '目标市场最多 10 项，每项不超过 80 字');
  if (languages.length > 10 || languages.some(item => item.length > 40)) add(0, '内容语言最多 10 项，每项不超过 40 字');
  if (draft.keyFacts.length > 3_000) add(1, '企业与产品关键信息不超过 3000 字');
  const restrictions = draft.prohibitedClaims.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  if (restrictions.length > 30 || restrictions.some(item => item.length > 240)) add(1, '禁用表达最多 30 项，每项不超过 240 字');
  if (draft.referenceLinks.length > 50) add(1, '参考链接一次最多添加 50 个');
  draft.referenceLinks.forEach(value => {
    if (value.length > 600) { add(1, '参考链接过长，请检查后重试'); return; }
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch {
      add(1, `参考链接格式不正确：${value.slice(0, 60)}`);
    }
  });
  if (draft.platforms.length === 0) add(2, '请至少选择一个发布平台');
  if (draft.formats.length === 0) add(2, '请至少选择一种内容形式');
  if (!Number.isInteger(draft.quantity) || draft.quantity < 1 || draft.quantity > 100) add(2, '内容数量应为 1 至 100');
  if (draft.mode === 'instant' && draft.quantity !== 1) add(2, '立即创作一次只生成 1 条内容');
  for (const [value, label] of [
    [draft.weeklyBudgetCny, '本周预算'],
    [draft.perItemBudgetCny, '单条预算上限'],
    [draft.retryReserveCny, '重试预留'],
  ] as const) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) add(2, `${label}不能小于 0`);
  }
  if (draft.weeklyBudgetCny !== null && draft.perItemBudgetCny !== null && draft.perItemBudgetCny > draft.weeklyBudgetCny) {
    add(2, '单条预算上限不能高于本周预算');
  }
  if (draft.weeklyBudgetCny !== null && draft.retryReserveCny !== null && draft.retryReserveCny > draft.weeklyBudgetCny) {
    add(2, '重试预留不能高于本周预算');
  }
  if (draft.shootingWindowMinutes !== null && (!Number.isInteger(draft.shootingWindowMinutes) || draft.shootingWindowMinutes < 0 || draft.shootingWindowMinutes > 10_080)) {
    add(2, '集中拍摄时间应为 0 至 10080 分钟');
  }
  if (draft.specialRequirements.length > 2_000) add(2, '本周特殊要求不超过 2000 字');
  return issues;
}
