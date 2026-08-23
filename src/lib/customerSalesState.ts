import type { CustomerProfile, DealOutcome, EngagementStatus, SalesLifecycleStage } from '../types/customer';

export const SALES_LIFECYCLE_LABEL: Record<SalesLifecycleStage, string> = {
  new_inquiry: '新询盘',
  discovery_qualification: '需求确认',
  technical_sample_validation: '技术/样品验证',
  proposal_quote: '方案报价',
  negotiation_approval: '谈判审批',
  closed: '已关闭',
  fulfillment_relationship: '履约/复购',
};

export const ENGAGEMENT_LABEL: Record<EngagementStatus, string> = {
  active: '活跃',
  waiting_buyer: '待客户回复',
  waiting_seller: '待销售回复',
  dormant_30d: '沉默30天',
  dormant_60d: '沉默60天',
};

function lifecycleFromLegacy(customer: CustomerProfile): { stage: SalesLifecycleStage; outcome?: DealOutcome } {
  if (customer.stage === 'won') return { stage: 'closed', outcome: 'won' };
  if (customer.stage === 'quoted') return { stage: 'proposal_quote' };
  if (customer.stage === 'lead') return { stage: 'new_inquiry' };
  return { stage: 'discovery_qualification' };
}

function engagementFromLegacy(customer: CustomerProfile): EngagementStatus {
  if (customer.stage === 'silent60') return 'dormant_60d';
  if (customer.stage === 'silent30') return 'dormant_30d';
  const lastMessage = [...customer.timeline].reverse().find(event => event.type === 'whatsapp');
  if (lastMessage?.actor === 'buyer') return 'waiting_seller';
  if (lastMessage?.actor === 'seller' || lastMessage?.actor === 'ai') return 'waiting_buyer';
  return 'active';
}

export function lifecycleLabel(stage: SalesLifecycleStage, outcome?: DealOutcome): string {
  if (stage !== 'closed') return SALES_LIFECYCLE_LABEL[stage];
  if (outcome === 'won') return '已成交';
  if (outcome === 'lost') return '已输单';
  if (outcome === 'on_hold') return '暂缓';
  return SALES_LIFECYCLE_LABEL.closed;
}

export function customerSalesDisplay(customer: CustomerProfile): {
  lifecycleStage: SalesLifecycleStage;
  lifecycleLabel: string;
  engagementStatus: EngagementStatus;
  engagementLabel: string;
} {
  const lifecycle = customer.salesState?.lifecycle || lifecycleFromLegacy(customer);
  const engagementStatus = customer.salesState?.engagement.status || engagementFromLegacy(customer);
  return {
    lifecycleStage: lifecycle.stage,
    lifecycleLabel: lifecycleLabel(lifecycle.stage, lifecycle.outcome),
    engagementStatus,
    engagementLabel: ENGAGEMENT_LABEL[engagementStatus],
  };
}

export function lifecycleBadgeClass(stage: SalesLifecycleStage): string {
  if (stage === 'closed' || stage === 'fulfillment_relationship') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (stage === 'proposal_quote' || stage === 'negotiation_approval') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-cyan-200 bg-cyan-50 text-cyan-700';
}

export function engagementBadgeClass(status: EngagementStatus): string {
  if (status === 'waiting_seller') return 'border-red-200 bg-red-50 text-red-700';
  if (status === 'dormant_30d' || status === 'dormant_60d') return 'border-slate-200 bg-slate-100 text-slate-600';
  if (status === 'waiting_buyer') return 'border-violet-200 bg-violet-50 text-violet-700';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}
