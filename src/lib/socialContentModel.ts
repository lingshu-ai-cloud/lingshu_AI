import type {
  SocialArtifactStatus,
  SocialContentSourceOption,
  SocialContentTaskDetail,
  SocialContentTaskStatus,
} from '../../shared/contracts/socialContentWorkflow';

export const SOCIAL_CONTENT_STAGES = [
  { id: 'prepare', label: '准备资料' },
  { id: 'plan', label: '确认方案' },
  { id: 'produce', label: '内容制作' },
  { id: 'review', label: '确认成品' },
  { id: 'deliver', label: '交付发布' },
  { id: 'measure', label: '数据回收' },
] as const;

export type SocialContentStageId = typeof SOCIAL_CONTENT_STAGES[number]['id'];
export type { SocialContentTaskStatus };

export type SocialContentPrimaryAction =
  | 'create'
  | 'continue'
  | 'start'
  | 'resume'
  | 'open_studio'
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
  if (status === 'attention') return 'open_studio';
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

export function socialContentProgress(status: SocialContentTaskStatus): number {
  const progress: Record<SocialContentTaskStatus, number> = {
    draft: 8,
    needs_input: 14,
    plan_review: 24,
    producing: 52,
    asset_review: 68,
    packaging: 82,
    delivered: 88,
    awaiting_publish: 90,
    awaiting_metrics: 96,
    reviewed: 100,
    paused: 52,
    attention: 52,
  };
  return progress[status];
}

export function socialContentAssetReviewAction(artifacts: Array<{ status: SocialArtifactStatus }>): 'review' | 'package' | 'progress' {
  const current = artifacts.filter(artifact => artifact.status !== 'superseded');
  if (current.some(artifact => artifact.status === 'review_required')) return 'review';
  if (current.length > 0 && current.every(artifact => artifact.status === 'approved')) return 'package';
  return 'progress';
}

export interface SocialContentDraft {
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
  aspectRatio: string;
  cadence: string;
  packageSelection: Record<'industry_launch' | 'content_rocket' | 'task_express', string>;
}

export const EMPTY_SOCIAL_CONTENT_DRAFT: SocialContentDraft = {
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
  if (!draft.title.trim()) add(0, '请填写任务名称');
  if (!draft.productName.trim()) add(0, '请填写产品或业务主题');
  if (!draft.primaryGoal.trim()) add(0, '请选择本次主要目标');
  if (!draft.audience.trim()) add(0, '请填写目标客户');
  if (!draft.market.trim()) add(0, '请填写目标市场');
  if (!draft.language.trim()) add(0, '请填写内容语言');
  const markets = list(draft.market);
  const languages = list(draft.language);
  if (markets.length > 10 || markets.some(item => item.length > 80)) add(0, '目标市场最多 10 项，每项不超过 80 字');
  if (languages.length > 10 || languages.some(item => item.length > 40)) add(0, '内容语言最多 10 项，每项不超过 40 字');
  if (!draft.selectedSources.some(item => item.kind === 'knowledge') && !draft.keyFacts.trim()) add(1, '请选择企业资料或填写本次关键信息');
  if (!draft.selectedSources.some(item => item.kind === 'material') && draft.referenceLinks.length === 0) add(1, '请选择素材、上传文件或添加参考链接');
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
  if (!Number.isInteger(draft.quantity) || draft.quantity < 1 || draft.quantity > 50) add(2, '内容数量应为 1 至 50');
  return issues;
}
