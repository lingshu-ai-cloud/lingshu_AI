import type { CreationTaskRow } from './creationTaskWorkspace';
import type { PlatformAdTask } from './platformAds';
import type { CustomerProfile } from '../types/customer';
import type { PlanOperatingData } from '../components/useAdPlanOperatingData';
import { planStatusText } from './adPlanRow';
import { pendingCustomers, isTodoCompleted } from './customerPriority';
import { projectContentProductionTaskCard } from '../../shared/contracts/assistantContentTaskCard';

export type BusinessWorkKind = 'content' | 'traffic' | 'customer';
type WorkBase = { id: string; title: string; status: string; needsAction: boolean; next: string; action: string; context: string; updatedAt: string; dueAt?: string };
export type BusinessWorkItem = WorkBase & (
  { kind: 'content'; row: CreationTaskRow } |
  { kind: 'traffic'; task: PlatformAdTask } |
  { kind: 'customer'; customer: CustomerProfile }
);
const timestamp = (value?: string) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
/** Sort actual business objects, never infer a domain from workflow titles. */
export function sortBusinessWork(items: BusinessWorkItem[]): BusinessWorkItem[] {
  return [...items].sort((a, b) => Number(b.needsAction) - Number(a.needsAction)
    || (timestamp(a.dueAt) ?? Infinity) - (timestamp(b.dueAt) ?? Infinity)
    || (timestamp(b.updatedAt) ?? 0) - (timestamp(a.updatedAt) ?? 0) || a.id.localeCompare(b.id));
}
export function projectContentWork(rows: CreationTaskRow[]): BusinessWorkItem[] {
  return sortBusinessWork(rows.filter(row => row.category !== 'completed'
    && !['cancelled', 'cancelling'].includes(row.summary?.status || '')).map(row => {
    const card = row.summary?.runId ? projectContentProductionTaskCard(row.summary) : null;
    return {
    id: row.key, kind: 'content' as const, title: row.title, status: row.statusLabel,
    needsAction: row.category === 'confirmation', row,
    next: row.readError ? '历史任务记录不完整，请核对原任务资料'
      : card?.blockingItems.length ? card.blockingItems.map(item => item.value).join('；')
      : card?.currentNode.userFacingSummary || row.weekly?.reason || row.weekly?.stage || '查看原任务的当前节点与交付记录',
    action: row.category === 'confirmation' ? '查看待确认项' : '查看进度',
    context: [row.product, row.sourceLabel].filter(Boolean).join(' · '), updatedAt: row.updatedAt, dueAt: row.publishAt || undefined,
    };
  }));
}
export function projectAdWork(tasks: PlatformAdTask[], operating: Record<string, PlanOperatingData>): BusinessWorkItem[] {
  return sortBusinessWork(tasks.map(task => {
    const data = operating[task.id];
    const needsAction = ['unknown', 'error'].includes(task.status) || Boolean(data?.errors.length || data?.audit?.pendingCount);
    return { id: task.id, kind: 'traffic' as const, title: task.name, task, status: planStatusText(task, data), needsAction,
      next: data?.errors.length ? data.errors.join('；') : task.status === 'unknown' || data?.audit?.pendingCount
        ? '原执行结果尚未确认，请在计划中核对回执' : task.status === 'draft' ? '在原计划中核对草稿配置与投放回执' : '查看原计划的预算、平台回执与操作记录',
      action: needsAction ? '核对计划' : '查看计划',
      context: [task.channels.join(' / '), task.market, task.goal].filter(Boolean).join(' · '), updatedAt: task.updatedAt,
    };
  }));
}
export function projectCustomerWork(customers: CustomerProfile[]): BusinessWorkItem[] {
  const live = customers.filter(c => !c.isMock && !c.isHistorical && c.isReal !== false && !c.readOnly);
  const pending = new Set(pendingCustomers(live).map(c => c.id));
  return sortBusinessWork(live.filter(c => !isTodoCompleted(c) && (pending.has(c.id) || c.hasUnread || c.blockedAutoReplyReason
    || c.handlingMode === 'ai_auto' && c.stage !== 'won')).map(c => {
    const needsAction = pending.has(c.id) || Boolean(c.hasUnread || c.blockedAutoReplyReason);
    return { id: c.id, kind: 'customer' as const, title: c.name, customer: c, needsAction,
      status: c.blockedAutoReplyReason ? '接待受阻' : c.pendingDraft ? '回复待确认' : c.hasUnread ? '有未读消息'
        : c.handlingMode === 'human_needed' ? '需人工处理' : c.handlingMode === 'ai_draft' ? '草稿接待' : 'AI 自动接待',
      next: c.blockedAutoReplyReason || c.nextStep || c.handlingReason || '查看原会话与接待状态',
      action: c.pendingDraft ? '查看回复草稿' : '查看会话', context: [c.source, c.countryName].filter(Boolean).join(' · '),
      updatedAt: c.lastActiveAt && Number.isFinite(c.lastActiveAt) ? new Date(c.lastActiveAt).toISOString() : '', dueAt: c.handoffDueAt || undefined,
    };
  }));
}
