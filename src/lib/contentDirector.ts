export type DirectorItemStatus = 'collecting' | 'candidate' | 'script_draft' | 'script_approved' | 'in_production' | 'review' | 'approved' | 'blocked';

export interface DirectorProgressItem {
  id: string;
  title: string;
  status: DirectorItemStatus;
  result: string;
  nextStep: string;
  owner: 'director' | 'content' | 'team';
  updatedAt: string;
  estimatedCost: number;
  actualCost: number;
}

export interface ContentDirectorPlan {
  currency: 'CNY' | 'USD';
  productionBudget: number;
  paidMediaBudget: number;
  productionReserved: number;
  productionSpent: number;
  originalTarget: number;
  platformVersionTarget: number;
  publishTarget: number;
  collectionBrief: string;
  qualityStandard: string;
  progress: DirectorProgressItem[];
}

const text = (value: unknown, max = 1000) => String(value ?? '').trim().slice(0, max);
const money = (value: unknown) => Math.max(0, Math.round((Number(value) || 0) * 100) / 100);
const count = (value: unknown) => Math.max(0, Math.min(100, Math.floor(Number(value) || 0)));

export function normalizeDirectorPlan(value: unknown): ContentDirectorPlan {
  const raw = value && typeof value === 'object' ? value as Partial<ContentDirectorPlan> : {};
  return {
    currency: raw.currency === 'USD' ? 'USD' : 'CNY',
    productionBudget: money(raw.productionBudget), paidMediaBudget: money(raw.paidMediaBudget),
    productionReserved: money(raw.productionReserved), productionSpent: money(raw.productionSpent),
    originalTarget: count(raw.originalTarget), platformVersionTarget: count(raw.platformVersionTarget), publishTarget: count(raw.publishTarget),
    collectionBrief: text(raw.collectionBrief), qualityStandard: text(raw.qualityStandard),
    progress: Array.isArray(raw.progress) ? raw.progress.slice(0, 100).map((item, index) => ({
      id: text(item?.id, 120) || `director-${index + 1}`, title: text(item?.title, 180),
      status: ['collecting', 'candidate', 'script_draft', 'script_approved', 'in_production', 'review', 'approved', 'blocked'].includes(String(item?.status)) ? item!.status as DirectorItemStatus : 'candidate',
      result: text(item?.result, 3000), nextStep: text(item?.nextStep, 1000),
      owner: item?.owner === 'content' || item?.owner === 'team' ? item.owner : 'director',
      updatedAt: text(item?.updatedAt, 40), estimatedCost: money(item?.estimatedCost), actualCost: money(item?.actualCost),
    })) : [],
  };
}

export function directorIssues(value: ContentDirectorPlan | undefined): string[] {
  if (!value) return [];
  const issues: string[] = [];
  if (value.productionSpent + value.productionReserved > value.productionBudget) issues.push('内容生产的已用与预占金额超过生产预算');
  if (value.platformVersionTarget < value.originalTarget) issues.push('平台交付版本目标不能少于原创内容目标');
  if (value.progress.some(item => !item.title)) issues.push('编导过程记录需要填写名称');
  return issues;
}

export function defaultDirectorPlan(contentCount = 1, publishTarget = contentCount): ContentDirectorPlan {
  return normalizeDirectorPlan({ originalTarget: contentCount, platformVersionTarget: contentCount, publishTarget,
    collectionBrief: '围绕本周买家问题采集平台热点、对标结构和可验证证据。',
    qualityStandard: '脚本回答明确的买家问题；关键主张有真实事实或素材支持；平台版本、行动引导和承接入口完整。' });
}
