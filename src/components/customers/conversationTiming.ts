import type { CustomerProfile, TimelineEvent } from '../../types/customer';

export type ConversationDraftIntent = 'reply' | 'opener' | 'followup' | 'reactivate' | 'post_call' | 'polish' | 'handoff_summary';

export function timelineEventAgeHours(event?: TimelineEvent): number {
  const time = String(event?.time || '').trim();
  if (!time) return 0;
  const hourMatch = time.match(/(\d+)\s*(?:h|小时|小時)/i);
  if (hourMatch) return Number(hourMatch[1]);
  const dayMatch = time.match(/(\d+)\s*(?:d|天)/i);
  if (dayMatch) return Number(dayMatch[1]) * 24;
  return time.includes('昨天') ? 30 : 0;
}

export function lastBuyerEvent(customer: CustomerProfile): TimelineEvent | undefined {
  return [...customer.timeline].reverse().find(event => event.type === 'whatsapp' && event.actor === 'buyer');
}

export function isOutsideWhatsAppWindow(customer: CustomerProfile): boolean {
  return timelineEventAgeHours(lastBuyerEvent(customer)) > 24;
}

export function sceneChips(customer: CustomerProfile): { intent: ConversationDraftIntent; label: string }[] {
  const chips: { intent: ConversationDraftIntent; label: string }[] = [];
  const hasSellerOrAi = customer.timeline.some(event => event.type === 'whatsapp' && (event.actor === 'seller' || event.actor === 'ai'));
  const last = customer.timeline[customer.timeline.length - 1];
  const lastBuyer = lastBuyerEvent(customer);
  if (customer.stage === 'lead' && !hasSellerOrAi) chips.push({ intent: 'opener', label: '写一条开场白' });
  if (customer.stage === 'quoted' && timelineEventAgeHours(lastBuyer) > 72) chips.push({ intent: 'followup', label: '写一条跟进' });
  if (customer.stage === 'silent30' || customer.stage === 'silent60') chips.push({ intent: 'reactivate', label: '写一条唤醒消息' });
  if (last?.type === 'call') chips.push({ intent: 'post_call', label: '按通话结果写跟进' });
  return chips.slice(0, 3);
}
