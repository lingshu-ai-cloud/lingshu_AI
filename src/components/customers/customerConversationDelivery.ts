import { authHeader } from '../../lib/auth';
import type { CustomerProfile, TimelineEvent } from '../../types/customer';
import type { TemplatePlan, StyleMemoryPayload } from './customerReplyPreparation';

export function createMessageEvent(
  customerId: string,
  body: string,
  actor: 'seller' | 'buyer' | 'ai',
  extra: Partial<TimelineEvent> = {},
): TimelineEvent {
  const timestamp = Date.now();
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return {
    id: `${customerId}-${Date.now()}-${actor}`,
    type: 'messenger',
    actor,
    title: actor === 'buyer' ? '客户消息' : actor === 'ai' ? 'AI 回复' : '我的回复',
    body,
    time,
    timestamp,
    ...extra,
  };
}

export async function sendCustomerOutbox(customer: CustomerProfile, requestId: string, body: string, outsideWindow: boolean, templatePlan?: TemplatePlan | null, styleMemory?: StyleMemoryPayload | null): Promise<{status?:'queued'|'sent'|'delivered';outboxId?:string;providerMessageIds?:string[];timeline?:TimelineEvent[]}> {
  if (customer.isMock && customer.localSimulation) {
    const simulation = customer.localSimulation;
    const response = await fetch(`/api/overseas/customer-simulation/sessions/${encodeURIComponent(simulation.sessionId)}/actions`, {method:'POST',headers:{'Content-Type':'application/json',...authHeader()},body:JSON.stringify({action:'send',text:body,contentHash:simulation.itemHash})});
    const data = await response.json();
    if (!response.ok) throw Error(data.error || '本地模拟发送失败');
    return {status:'sent' as const,outboxId:data.send?.providerMessageId,providerMessageIds:data.send?.providerMessageId?[String(data.send.providerMessageId)]:[],timeline:data.customer?.timeline};
  }
  if (customer.isMock) return { status: 'delivered' as const, outboxId: `mock-${Date.now()}` };
  const resp = await fetch(`/api/overseas/customers/${encodeURIComponent(customer.id)}/outbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(templatePlan
      ? { requestId, body: templatePlan.rendered, mode: 'template', outsideWindow, to: customer.source === 'instagram' ? customer.instagramUserId : customer.messengerUserId, styleMemory }
      : { requestId, body, mode: 'free_text', outsideWindow, to: customer.source === 'instagram' ? customer.instagramUserId : customer.messengerUserId, styleMemory }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.message || data.error || '发送失败');
  return data as { status?: 'queued' | 'sent' | 'delivered'; outboxId?: string; providerMessageIds?: string[] };
}
