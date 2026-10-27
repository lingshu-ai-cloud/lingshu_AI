import { store } from '../../storage/index.js';
import { readCustomerChannelSendEvidence, CHANNEL_SEND_REQUESTS } from '../../digitalEmployees/customerChannelSendRequests.js';
import type { DailyFollowups } from '../../../shared/contracts/assistantWork.js';
import { readSceneCustomers, customerLabel } from './customerEvidence.js';
import { sceneProfile, type BusinessSceneScope } from './service.js';
import { object, text, inWindow, scanTenantRecords } from './readScope.js';
import { localFollowupPreviewEnabled } from '../../customerService/localFollowupPreview.js';

export function prioritizeDailyCustomers(rows: Record<string, unknown>[], completed: Set<string>, now = new Date(), localPreview = false): DailyFollowups {
  const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const isPreview = (c: Record<string, unknown>) => localPreview && c.localFollowupPreview === true && c.isMock === true && c.source === 'local_followup' && String(c.id).startsWith('preview_followup_');
  const candidates = rows.filter(c => (isPreview(c) || ['messenger', 'instagram'].includes(String(c.source)) && !c.isMock) && !c.optedOut && !c.readOnly && !c.isHistorical && !completed.has(String(c.id)));
  const latest = (c: Record<string, unknown>) => (Array.isArray(c.timeline) ? c.timeline.map(object) : []).filter(t => t.actor === 'buyer').at(-1);
  const score = (c: Record<string, unknown>) => Number(c.hasUnread === true) * 1000 + Number(c.stage === 'quoted') * 200 + (typeof c.intentScore === 'number' && Number.isFinite(c.intentScore) ? Math.min(100, Math.max(0, c.intentScore)) : 0);
  candidates.sort((a, b) => score(b) - score(a) || String(a.id).localeCompare(String(b.id)));
  return { day, remaining: candidates.length, completed: completed.size, customers: candidates.slice(0, 5).map(c => {
    const event = latest(c), at = event?.timestamp || c.lastActiveAt;
    const timestamp = typeof at === 'number' ? at : Date.parse(String(at || ''));
    const channel = isPreview(c) ? '本地演练' : text(c.source, 40);
    return { id: String(c.id), name: customerLabel(c), channel, stage: text(c.stage, 60) || '待确认',
      lastInteraction: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '',
      issue: text(c.nextStep, 200) || text(event?.body, 200) || '需在客户会话中核对当前需求',
      reason: c.hasUnread ? '有未处理的客户消息' : c.stage === 'quoted' ? '已报价，建议确认客户反馈' : typeof c.intentScore === 'number' ? `已有意向分 ${c.intentScore}，结合会话确认下一步` : '已有客户会话，采购意向待确认',
      canFollow: isPreview(c) || ['messenger', 'instagram'].includes(channel),
    };
  }) };
}

export const dailyFollowupReaders = { profile: sceneProfile, customers: readSceneCustomers, scan: scanTenantRecords, receipt: readCustomerChannelSendEvidence };
export async function dailyFollowups(scope: BusinessSceneScope, now = new Date(), read = dailyFollowupReaders) {
  await read.profile(scope, 'CS-01');
  const customers = await read.customers(scope.tenantId);
  const ids = new Set(customers.map(c => String(c.id))), completed = new Set<string>();
  const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  for (const row of await read.scan(store, CHANNEL_SEND_REQUESTS, scope.tenantId)) {
    const p = object(row.payload);
    if (!ids.has(String(p.customerId)) || !inWindow(p.settledAt, day, day) || !['messenger', 'instagram'].includes(String(p.channel))) continue;
    // Verify the durable sealed request, rather than trusting a frontend completion flag.
    const receipt = await read.receipt(store, scope.tenantId, p.channel as 'messenger' | 'instagram', String(p.requestId));
    if (receipt?.status === 'accepted' && receipt.providerMessageId && receipt.deliveryStatus !== 'failed') completed.add(receipt.customerId);
  }
  const preview = localFollowupPreviewEnabled(scope.tenantId);
  if (preview) for (const c of customers) {
    if (c.localFollowupPreview !== true || c.source !== 'local_followup' || c.isMock !== true) continue;
    if ((Array.isArray(c.timeline) ? c.timeline.map(object) : []).some(t => t.localPreviewReceipt === true && t.actor === 'seller' && t.sendStatus === 'sent' && inWindow(t.timestamp, day, day))) completed.add(String(c.id));
  }
  return prioritizeDailyCustomers(customers, completed, now, preview);
}
