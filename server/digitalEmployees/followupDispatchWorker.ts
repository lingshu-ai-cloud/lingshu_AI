import { randomUUID, createHash } from 'node:crypto';
import { guardOutbound } from '../autonomy/outboundGuard.js';
import { store } from '../storage/index.js';
import { isRealWhatsAppNumber } from '../whatsapp/customerVisibility.js';
import { getWhatsAppCustomers, markWhatsAppHumanReply } from '../whatsapp/historyImport.js';
import { sendTenantWhatsAppTemplateWithReceipt, sendTenantWhatsAppTextWithReceipts } from '../whatsapp/send.js';
import {
  getFollowupBatch,
  getFollowupBatchItems,
  type FollowupBatchItemRecord,
  type FollowupBatchRecord,
} from './customerWorkflow.js';
import { followupWorkerIntervalMs, followupWorkerMaxAttempts, followupWorkerMode } from './followupWorkerConfig.js';
import { digitalEmployeeRunBlockedReason, withDigitalEmployeeExternalAction, WorkflowRunBlockedError } from './runControl.js';
import {
  readCustomerMessagingAuthorization,
  type CustomerMessagingAuthorization,
} from './customerMessagingPolicy.js';

type StoredRecord = { id: string; [key: string]: unknown };

export interface FollowupWorkerEvent {
  tenantId: string;
  runId: string;
  taskId: string;
  batchId: string;
  itemId?: string;
  customerId?: string;
  type: 'worker.claimed' | 'worker.sent' | 'worker.partial_sent' | 'worker.retry_scheduled' | 'worker.blocked' | 'worker.failed' | 'worker.receipt';
  level: 'info' | 'success' | 'warning' | 'error';
  summary: string;
  payload: Record<string, unknown>;
}

export interface FollowupDispatchResult {
  batchId: string;
  mode: 'scheduled' | 'manual';
  claimed: number;
  sent: number;
  partial: number;
  blocked: number;
  retryScheduled: number;
  failed: number;
  future: number;
  counts: Record<string, number>;
}

export interface FollowupDispatchPreflight {
  batchId: string;
  mode: 'scheduled' | 'manual';
  ready: boolean;
  batchApproved: boolean;
  authorized: boolean;
  eligible: number;
  blocked: number;
  future: number;
  skipped: number;
  blockers: Record<string, number>;
  authorization: CustomerMessagingAuthorization;
}

const PREFLIGHT_BLOCKER_LABELS: Record<string, string> = {
  workflow_run_unavailable: '关联运行不存在或不属于当前租户',
  workflow_run_paused: '经营任务已暂停，恢复前不会发送',
  workflow_run_cancelled: '经营任务已取消，不再发送',
  workflow_run_waiting_human: '经营任务已由人工接管，不再自动发送',
  workflow_run_failed: '经营任务已失败，处理后才能发送',
  workflow_run_succeeded: '经营任务已结束，不再发送',
  followup_batch_not_approved_for_current_version: '跟进批次尚未审批，或审批版本已过期',
  digital_employee_configuration_inactive: '数字员工配置未激活',
  customer_agent_not_enabled: '客服 Agent 未启用',
  tenant_real_customer_messages_not_authorized: '租户未授权真实发送',
  whatsapp_provider_not_ready: 'WhatsApp 渠道未连接或凭证未就绪',
  followup_background_worker_disabled: '自动发送 Worker 未启用（仍可在授权后人工触发）',
  no_dispatchable_items: '当前批次没有可发送的逐客草稿',
  draft_content_hash_changed: '草稿内容已变化，需要重新审批',
  invalid_whatsapp_number: '客户 WhatsApp 号码无效',
  high_risk_requires_individual_review: '高风险客户需要逐客人工复核',
  customer_no_longer_available: '客户资料已不存在',
  customer_whatsapp_number_changed: '客户 WhatsApp 号码已变化',
  customer_opted_out_or_blacklisted: '客户已退订或进入黑名单',
  contact_frequency_limit: '客户触达频率已达上限',
  whatsapp_template_required: '已超出 24 小时会话窗口，需要获批模板',
  approved_whatsapp_template_required: 'WhatsApp 模板尚未获批',
  unsupported_send_mode: '发送模式不受支持',
};

export function followupDispatchPreflightFacts(preflight: FollowupDispatchPreflight): string[] {
  const facts = Object.entries(preflight.blockers)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => {
      const label = PREFLIGHT_BLOCKER_LABELS[reason]
        || (reason.startsWith('outbound_guard:') ? '草稿命中对外发送红线' : reason);
      return count > 1 ? `${label}（${count} 条）` : label;
    });
  if (preflight.future > 0) facts.push(`未来发送时段：${preflight.future} 条尚未到逐客发送时间`);
  if (preflight.blocked > 0 && !Object.keys(preflight.blockers).length) facts.push(`发送前安全复核阻断 ${preflight.blocked} 条`);
  if (preflight.ready) facts.push(`发送预检通过：${preflight.eligible} 条已到期且具备真实发送条件`);
  return [...new Set(facts)];
}

export function followupDispatchPreflightBlockedReason(preflight: FollowupDispatchPreflight): string {
  const facts = followupDispatchPreflightFacts(preflight);
  return facts.length ? `真实发送预检：${facts.join('；')}` : '真实发送预检：尚无可发送项目';
}

interface DispatchDependencies {
  now: () => Date;
  sendText: typeof sendTenantWhatsAppTextWithReceipts;
  sendTemplate: typeof sendTenantWhatsAppTemplateWithReceipt;
  customers: (tenantId: string) => Array<Record<string, unknown>>;
  guard: typeof guardOutbound;
  recordOutbound: typeof markWhatsAppHumanReply;
  authorization: (tenantId: string) => Promise<CustomerMessagingAuthorization>;
  recipientDelayMs: number;
}

const listeners = new Set<(event: FollowupWorkerEvent) => void | Promise<void>>();
const batchQueues = new Map<string, Promise<void>>();
let interval: ReturnType<typeof setInterval> | null = null;
let scanRunning = false;

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch { return {}; }
  }
  return {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : [];
}

function hash(value: unknown): string {
  // Batch creation fingerprints every payload through JSON.stringify, including
  // primitive strings. Dispatch must use the identical representation or an
  // untouched, approved draft will be rejected as if it had changed.
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeError(error: unknown): { code: string; message: string; retryable: boolean } {
  const record = error && typeof error === 'object' ? error as Record<string, any> : {};
  const response = jsonObject(record.response);
  const responseData = jsonObject(response.data);
  const providerError = jsonObject(responseData.error);
  const status = Number(response.status || 0);
  const code = String(providerError.code || record.code || (error instanceof Error ? error.message : 'whatsapp_send_failed')).slice(0, 120);
  const message = String(providerError.message || (error instanceof Error ? error.message : 'WhatsApp send failed'))
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, 1000);
  const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
  return { code, message, retryable };
}

function timestamp(value: unknown): number {
  const numeric = Number(value || 0);
  if (numeric > 0) return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Re-check the configured customer-local sending window after approval. */
export function nextFollowupDeliveryWindow(timeZone: string, rawPolicy: unknown, now: Date): Date {
  const policy = jsonObject(rawPolicy);
  if (policy.sendWindowStartHour === undefined || policy.sendWindowEndHour === undefined) return now;
  const start = Math.max(0, Math.min(23, Number(policy.sendWindowStartHour || 9)));
  const end = Math.max(start + 1, Math.min(24, Number(policy.sendWindowEndHour || 18)));
  const workdaysOnly = policy.workdaysOnly !== false;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', hour: '2-digit', hourCycle: 'h23', minute: '2-digit',
  });
  let candidate = now;
  try { formatter.format(candidate); } catch { return now; }
  for (let index = 0; index < 8 * 48; index += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(candidate).map(part => [part.type, part.value]));
    const hour = Number(parts.hour || 0);
    const allowedDay = !workdaysOnly || !['Sat', 'Sun'].includes(parts.weekday || '');
    if (allowedDay && hour >= start && hour < end) return candidate;
    candidate = new Date(Math.ceil((candidate.getTime() + 1) / 1_800_000) * 1_800_000);
  }
  return candidate;
}

function latestInboundAt(customer: Record<string, unknown>): number {
  const timeline = Array.isArray(customer.timeline) ? customer.timeline as Array<Record<string, unknown>> : [];
  return timeline.filter(item => item.actor === 'buyer' || item.type === 'msg_in')
    .reduce((latest, item) => Math.max(latest, timestamp(item.timestamp)), timestamp(customer.lastInboundAt));
}

function customerRiskReason(customer: Record<string, unknown>): string {
  const bant = jsonObject(customer.bant);
  const authenticity = jsonObject(bant.authenticity);
  const qualification = String(bant.qualification_band || bant.band || '').toLowerCase();
  const authenticityBand = String(authenticity.band || bant.authenticity_band || '').toLowerCase();
  const markers = [...stringList(customer.tags), String(customer.blockedAutoReplyReason || '')].map(item => item.toLowerCase());
  if (String(customer.handlingMode || '') === 'human_needed') return 'human_handling_in_progress';
  if (qualification === 'black') return 'customer_qualification_black';
  if (['suspected_scraping', 'suspicious_scraping'].includes(authenticityBand)) return 'customer_suspected_scraping';
  if (markers.some(item => /unsubscribe|opt[ -]?out|do not contact|blacklist|退订|拒收|黑名单|勿扰/.test(item))) return 'customer_opted_out_or_blacklisted';
  return '';
}

async function runtimeSafety(tenantId: string, item: FollowupBatchItemRecord, now: Date, dependencies: DispatchDependencies, rawDeliveryPolicy: unknown): Promise<{ allowed: boolean; reason: string; customer?: Record<string, unknown> }> {
  const digits = String(item.wa_number || '').replace(/\D/g, '');
  if (!isRealWhatsAppNumber(item.wa_number) || digits.length < 7 || digits.length > 15) return { allowed: false, reason: 'invalid_whatsapp_number' };
  if (item.risk_level === 'high') return { allowed: false, reason: 'high_risk_requires_individual_review' };
  const customer = dependencies.customers(tenantId).find(candidate => String(candidate.id || '') === item.customer_id);
  if (!customer) return { allowed: false, reason: 'customer_no_longer_available' };
  if (String(customer.waNumber || '') !== item.wa_number) return { allowed: false, reason: 'customer_whatsapp_number_changed' };
  const customerRisk = customerRiskReason(customer);
  if (customerRisk) return { allowed: false, reason: customerRisk };
  const deliveryPolicy = jsonObject(rawDeliveryPolicy);
  const contactWindowDays = Math.max(1, Math.min(365, Number(deliveryPolicy.contactWindowDays || 7)));
  const maxContacts = Math.max(1, Math.min(20, Number(deliveryPolicy.maxContactsPerWindow || 1)));
  const priorItems = await store.list<FollowupBatchItemRecord>('followup_batch_items', {
    where: { tenant_id: tenantId, customer_id: item.customer_id }, sort: '-sent_at', page: 1, perPage: 100,
  });
  const cutoff = now.getTime() - contactWindowDays * 86_400_000;
  const recentContacts = priorItems.items.filter(prior => (
    prior.id !== item.id
    && Boolean(prior.provider_message_id || prior.sent_at)
    && timestamp(prior.sent_at) >= cutoff
  )).length;
  if (recentContacts >= maxContacts) return { allowed: false, reason: 'contact_frequency_limit' };
  const guard = await dependencies.guard(item.draft_body, { tenantId, customerId: item.customer_id, action: 'digital_employee_batch_followup' });
  if (!guard.allowed) return { allowed: false, reason: `outbound_guard:${guard.matchedRule || 'blocked'}` };
  if (item.send_mode === 'session_message') {
    const inboundAt = latestInboundAt(customer);
    if (!inboundAt || now.getTime() - inboundAt >= 24 * 60 * 60 * 1000) return { allowed: false, reason: 'whatsapp_template_required' };
  } else if (item.send_mode === 'template') {
    if (!item.template_name || item.template_status !== 'approved') return { allowed: false, reason: 'approved_whatsapp_template_required' };
  } else {
    return { allowed: false, reason: 'unsupported_send_mode' };
  }
  return { allowed: true, reason: '', customer };
}

async function emit(event: FollowupWorkerEvent): Promise<void> {
  await Promise.allSettled([...listeners].map(listener => listener(event)));
}

export function onFollowupWorkerEvent(listener: (event: FollowupWorkerEvent) => void | Promise<void>): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function withBatchQueue<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = batchQueues.get(key) || Promise.resolve();
  let release = () => {};
  const current = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => current);
  batchQueues.set(key, tail);
  await previous;
  try { return await action(); }
  finally {
    release();
    if (batchQueues.get(key) === tail) batchQueues.delete(key);
  }
}

function receiptMessages(value: unknown): Array<Record<string, unknown>> {
  const receipt = jsonObject(value);
  return Array.isArray(receipt.messages) ? receipt.messages as Array<Record<string, unknown>> : [];
}

async function refreshBatchCounts(batch: FollowupBatchRecord): Promise<Record<string, number>> {
  const items = await getFollowupBatchItems(batch.tenant_id, batch.id);
  const count = (statuses: string[]) => items.filter(item => statuses.includes(String(item.status || ''))).length;
  const counts = {
    total: items.length,
    draft: count(['draft']),
    blocked: count(['blocked']),
    approved: count(['approved']),
    sending: count(['sending']),
    retryWaiting: count(['retry_wait']),
    partial: count(['partial_sent']),
    sent: count(['sent', 'delivered', 'read']),
    delivered: count(['delivered', 'read']),
    read: count(['read']),
    failed: count(['failed']),
  };
  const deliverable = items.filter(item => !['blocked', 'rejected', 'superseded', 'cancelled'].includes(item.status));
  const settled = deliverable.every(item => ['sent', 'delivered', 'read', 'failed', 'partial_sent'].includes(item.status));
  let status = batch.status;
  if (settled && deliverable.length) {
    if (counts.failed === deliverable.length) status = 'failed';
    else if (counts.failed || counts.partial) status = 'partial_failed';
    else status = 'completed';
  }
  await store.update('followup_batches', batch.id, { counts, status, updated_at: new Date().toISOString() });
  return counts;
}

async function dispatchTaskId(batch: FollowupBatchRecord): Promise<string> {
  const tasks = await store.list<StoredRecord>('workflow_tasks', { where: { tenant_id: batch.tenant_id, run_id: batch.run_id }, perPage: 100 });
  return String(tasks.items.find(task => task.task_key === 'followup_dispatch')?.id || batch.task_id);
}

function defaultDependencies(): DispatchDependencies {
  const delay = Number(process.env.FOLLOWUP_WORKER_RECIPIENT_DELAY_MS || 1000);
  return {
    now: () => new Date(),
    sendText: sendTenantWhatsAppTextWithReceipts,
    sendTemplate: sendTenantWhatsAppTemplateWithReceipt,
    customers: tenantId => getWhatsAppCustomers(tenantId) as Array<Record<string, unknown>>,
    guard: guardOutbound,
    recordOutbound: markWhatsAppHumanReply,
    authorization: readCustomerMessagingAuthorization,
    recipientDelayMs: Number.isFinite(delay) ? Math.max(0, delay) : 1000,
  };
}

/**
 * Read-only dispatch preflight. This deliberately performs no claims, status
 * updates, audit writes or provider calls, so operators can inspect the exact
 * approval/authorization/runtime blockers before authorizing a real send.
 */
export async function preflightFollowupBatchDispatch(
  tenantId: string,
  batchId: string,
  options: { mode?: 'scheduled' | 'manual'; dependencies?: Partial<DispatchDependencies> } = {},
): Promise<FollowupDispatchPreflight> {
  const mode = options.mode || 'manual';
  const dependencies = { ...defaultDependencies(), ...(options.dependencies || {}) } as DispatchDependencies;
  const batch = await getFollowupBatch(tenantId, batchId);
  if (!batch) throw new Error('followup_batch_not_found');

  const hasApprovalEvidence = Boolean(batch.approval_id) || batch.approved_by === 'approval_policy';
  const batchApproved = batch.status === 'approved'
    && Number(batch.approved_version || 0) === Number(batch.version || 0)
    && hasApprovalEvidence;
  const authorization = await dependencies.authorization(tenantId);
  const authorized = mode === 'scheduled'
    ? authorization.scheduledFollowupSendAllowed
    : authorization.manualFollowupSendAllowed;
  const blockers: Record<string, number> = {};
  const addBlocker = (reason: string) => { blockers[reason] = (blockers[reason] || 0) + 1; };
  const runBlocker = await digitalEmployeeRunBlockedReason(tenantId, batch.run_id);
  if (runBlocker) addBlocker(runBlocker);
  if (!batchApproved) addBlocker('followup_batch_not_approved_for_current_version');
  if (!authorized) {
    const relevantReasons = mode === 'manual'
      ? authorization.reasons.filter(reason => reason !== 'followup_background_worker_disabled')
      : authorization.reasons;
    (relevantReasons.length ? relevantReasons : ['customer_message_send_not_authorized']).forEach(addBlocker);
  }

  let eligible = 0;
  let blocked = 0;
  let future = 0;
  let skipped = 0;
  const items = await getFollowupBatchItems(tenantId, batch.id);
  for (const item of items) {
    if (!['approved', 'retry_wait'].includes(item.status)) { skipped += 1; continue; }
    const now = dependencies.now();
    if (timestamp(item.scheduled_at) > now.getTime()) { future += 1; continue; }
    if (nextFollowupDeliveryWindow(item.time_zone, batch.delivery_policy, now).getTime() > now.getTime()) {
      future += 1;
      continue;
    }
    if (hash(item.draft_body) !== item.content_hash) {
      blocked += 1;
      addBlocker('draft_content_hash_changed');
      continue;
    }
    const safety = await runtimeSafety(tenantId, item, now, dependencies, batch.delivery_policy);
    if (!safety.allowed) {
      blocked += 1;
      addBlocker(safety.reason);
      continue;
    }
    eligible += 1;
  }
  if (!eligible && !future && !blocked) addBlocker('no_dispatchable_items');
  return {
    batchId,
    mode,
    ready: !runBlocker && batchApproved && authorized && eligible > 0,
    batchApproved,
    authorized,
    eligible,
    blocked,
    future,
    skipped,
    blockers,
    authorization,
  };
}

export async function dispatchFollowupBatch(
  tenantId: string,
  batchId: string,
  options: { mode?: 'scheduled' | 'manual'; dependencies?: Partial<DispatchDependencies> } = {},
): Promise<FollowupDispatchResult> {
  return withBatchQueue(`${tenantId}:${batchId}`, async () => {
    const dependencies = { ...defaultDependencies(), ...(options.dependencies || {}) } as DispatchDependencies;
    const batch = await getFollowupBatch(tenantId, batchId);
    if (!batch) throw new Error('followup_batch_not_found');
    const hasApprovalEvidence = Boolean(batch.approval_id) || batch.approved_by === 'approval_policy';
    if (batch.status !== 'approved' || Number(batch.approved_version || 0) !== Number(batch.version || 0) || !hasApprovalEvidence) {
      throw new Error('followup_batch_not_approved_for_current_version');
    }
    const runBlocker = await digitalEmployeeRunBlockedReason(tenantId, batch.run_id);
    if (runBlocker) throw new WorkflowRunBlockedError(runBlocker);
    const authorization = await dependencies.authorization(tenantId);
    const authorized = options.mode === 'scheduled'
      ? authorization.scheduledFollowupSendAllowed
      : authorization.manualFollowupSendAllowed;
    if (!authorized) {
      const reason = authorization.reasons.find(item => item !== 'followup_background_worker_disabled')
        || authorization.reasons[0]
        || 'customer_message_send_not_authorized';
      throw new Error(`customer_message_send_not_authorized:${reason}`);
    }
    const eventTaskId = await dispatchTaskId(batch);
    const result: FollowupDispatchResult = {
      batchId, mode: options.mode || 'manual', claimed: 0, sent: 0, partial: 0, blocked: 0, retryScheduled: 0, failed: 0, future: 0, counts: {},
    };
    const items = await getFollowupBatchItems(tenantId, batch.id);
    for (const listedItem of items) {
      if (!['approved', 'retry_wait'].includes(listedItem.status)) continue;
      const now = dependencies.now();
      if (timestamp(listedItem.scheduled_at) > now.getTime()) { result.future += 1; continue; }
      const item = await store.getById<FollowupBatchItemRecord>('followup_batch_items', listedItem.id);
      if (!item || item.tenant_id !== tenantId || item.batch_id !== batch.id || !['approved', 'retry_wait'].includes(item.status)) continue;
      const safeWindow = nextFollowupDeliveryWindow(item.time_zone, batch.delivery_policy, now);
      if (safeWindow.getTime() > now.getTime()) {
        await store.update('followup_batch_items', item.id, { scheduled_at: safeWindow.toISOString(), updated_at: now.toISOString() });
        result.future += 1;
        continue;
      }
      if (hash(item.draft_body) !== item.content_hash) {
        await store.update('followup_batch_items', item.id, { status: 'blocked', exclusion_reason: 'draft_content_hash_changed', updated_at: now.toISOString() });
        result.blocked += 1;
        continue;
      }
      const safety = await runtimeSafety(tenantId, item, now, dependencies, batch.delivery_policy);
      if (!safety.allowed) {
        await store.update('followup_batch_items', item.id, { status: 'blocked', exclusion_reason: safety.reason, last_error: '', updated_at: now.toISOString() });
        result.blocked += 1;
        await emit({ tenantId, runId: batch.run_id, taskId: eventTaskId, batchId, itemId: item.id, customerId: item.customer_id, type: 'worker.blocked', level: 'warning', summary: `${item.customer_name || '客户'} 跟进已被发送前安全检查拦截`, payload: { reason: safety.reason } });
        continue;
      }

      const attempt = Number(item.attempts || 0) + 1;
      const previousStatus = item.status;
      const previousReceipt = item.provider_receipt;
      const claimToken = randomUUID();
      const claimedAt = now.toISOString();
      await store.update('followup_batch_items', item.id, {
        status: 'sending', attempts: attempt, last_error: '',
        provider_receipt: { ...jsonObject(item.provider_receipt), claimToken, claimedAt, workerMode: options.mode || 'manual' },
        updated_at: claimedAt,
      });
      result.claimed += 1;
      await emit({ tenantId, runId: batch.run_id, taskId: eventTaskId, batchId, itemId: item.id, customerId: item.customer_id, type: 'worker.claimed', level: 'info', summary: `${item.customer_name || '客户'} 跟进已进入真实发送`, payload: { attempt, idempotencyKey: item.idempotency_key } });

      const accepted: Array<Record<string, unknown>> = receiptMessages(item.provider_receipt);
      try {
        await withDigitalEmployeeExternalAction(tenantId, batch.run_id, async () => {
        if (item.send_mode === 'template') {
          const variables = Array.isArray(item.template_variables) ? item.template_variables.map(value => String(value || '')) : [];
          const receipt = await dependencies.sendTemplate({ tenantId, to: item.wa_number, templateName: item.template_name, languageCode: item.template_language || 'en_US', variables });
          if (!receipt.messageId) throw new Error('whatsapp_provider_message_id_missing');
          accepted.push({ body: item.draft_body, messageId: receipt.messageId, recipientId: receipt.recipientId, raw: receipt.raw, acceptedAt: dependencies.now().toISOString() });
        } else {
          await dependencies.sendText(tenantId, item.wa_number, item.draft_body, async progress => {
            if (!progress.receipt.messageId) throw new Error('whatsapp_provider_message_id_missing');
            accepted.push({ body: progress.message, messageId: progress.receipt.messageId, recipientId: progress.receipt.recipientId, raw: progress.receipt.raw, acceptedAt: dependencies.now().toISOString() });
            await store.update('followup_batch_items', item.id, {
              provider_message_id: String(accepted[0]?.messageId || ''),
              provider_receipt: { claimToken, claimedAt, status: 'accepting', messages: accepted },
              updated_at: dependencies.now().toISOString(),
            });
          });
        }
        const sentAt = dependencies.now().toISOString();
        await store.update('followup_batch_items', item.id, {
          status: 'sent', provider_message_id: String(accepted[0]?.messageId || ''),
          provider_receipt: { claimToken, claimedAt, status: 'accepted', messages: accepted },
          sent_at: sentAt, last_error: '', updated_at: sentAt,
        });
        dependencies.recordOutbound({ tenantId, customerId: item.customer_id, body: item.draft_body, messages: accepted.map(entry => String(entry.body || '')).filter(Boolean), waNumber: item.wa_number, providerReceipts: accepted.map(entry => ({ messageId: String(entry.messageId || ''), recipientId: String(entry.recipientId || ''), raw: entry.raw })) });
        result.sent += 1;
        await emit({ tenantId, runId: batch.run_id, taskId: eventTaskId, batchId, itemId: item.id, customerId: item.customer_id, type: 'worker.sent', level: 'success', summary: `${item.customer_name || '客户'} 跟进已被 WhatsApp 接受`, payload: { providerMessageIds: accepted.map(entry => entry.messageId), attempt } });
        });
      } catch (error) {
        if (error instanceof WorkflowRunBlockedError && !accepted.length) {
          // Human control won the lock before any provider call. Do not consume
          // an attempt, discard approval, or invent a failed/sent receipt.
          await store.update('followup_batch_items', item.id, {
            status: previousStatus, attempts: attempt - 1, provider_receipt: previousReceipt,
            last_error: error.reason, updated_at: dependencies.now().toISOString(),
          });
          result.claimed -= 1;
          result.blocked += 1;
          await emit({ tenantId, runId: batch.run_id, taskId: eventTaskId, batchId, itemId: item.id, type: 'worker.blocked', level: 'warning', summary: '运行已停止，后续客户发送已暂停', payload: { reason: error.reason } });
          break;
        }
        const failure = safeError(error);
        const failedAt = dependencies.now();
        if (accepted.length) {
          await store.update('followup_batch_items', item.id, {
            status: 'partial_sent', provider_message_id: String(accepted[0]?.messageId || ''),
            provider_receipt: { claimToken, claimedAt, status: 'accepted_partial', messages: accepted },
            sent_at: failedAt.toISOString(), last_error: `${failure.code}: ${failure.message}`, updated_at: failedAt.toISOString(),
          });
          dependencies.recordOutbound({ tenantId, customerId: item.customer_id, body: accepted.map(entry => String(entry.body || '')).join('\n'), messages: accepted.map(entry => String(entry.body || '')), waNumber: item.wa_number, providerReceipts: accepted.map(entry => ({ messageId: String(entry.messageId || ''), recipientId: String(entry.recipientId || ''), raw: entry.raw })) });
          result.partial += 1;
          await emit({ tenantId, runId: batch.run_id, taskId: eventTaskId, batchId, itemId: item.id, customerId: item.customer_id, type: 'worker.partial_sent', level: 'error', summary: `${item.customer_name || '客户'} 仅部分消息被 WhatsApp 接受，已停止自动重试`, payload: { providerMessageIds: accepted.map(entry => entry.messageId), errorCode: failure.code, attempt } });
        } else if (failure.retryable && attempt < followupWorkerMaxAttempts()) {
          const retryAt = new Date(failedAt.getTime() + Math.min(30 * 60_000, 30_000 * (2 ** (attempt - 1))));
          await store.update('followup_batch_items', item.id, { status: 'retry_wait', scheduled_at: retryAt.toISOString(), last_error: `${failure.code}: ${failure.message}`, updated_at: failedAt.toISOString() });
          result.retryScheduled += 1;
          await emit({ tenantId, runId: batch.run_id, taskId: eventTaskId, batchId, itemId: item.id, customerId: item.customer_id, type: 'worker.retry_scheduled', level: 'warning', summary: `${item.customer_name || '客户'} 跟进发送失败，已安排安全重试`, payload: { errorCode: failure.code, attempt, retryAt: retryAt.toISOString() } });
        } else {
          await store.update('followup_batch_items', item.id, { status: 'failed', last_error: `${failure.code}: ${failure.message}`, updated_at: failedAt.toISOString() });
          result.failed += 1;
          await emit({ tenantId, runId: batch.run_id, taskId: eventTaskId, batchId, itemId: item.id, customerId: item.customer_id, type: 'worker.failed', level: 'error', summary: `${item.customer_name || '客户'} 跟进发送失败`, payload: { errorCode: failure.code, attempt, retryable: failure.retryable } });
        }
      }
      if (dependencies.recipientDelayMs > 0) await new Promise(resolve => setTimeout(resolve, dependencies.recipientDelayMs));
    }
    result.counts = await refreshBatchCounts(batch);
    return result;
  });
}

function metaStatuses(payload: unknown): Array<Record<string, unknown>> {
  const root = jsonObject(payload);
  const entries = Array.isArray(root.entry) ? root.entry as Array<Record<string, unknown>> : [];
  return entries.flatMap(entry => {
    const changes = Array.isArray(entry.changes) ? entry.changes as Array<Record<string, unknown>> : [];
    return changes.flatMap(change => {
      const value = jsonObject(change.value);
      return Array.isArray(value.statuses) ? value.statuses as Array<Record<string, unknown>> : [];
    });
  });
}

const RECEIPT_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

export async function ingestFollowupDeliveryStatuses(tenantId: string, payload: unknown): Promise<number> {
  const statuses = metaStatuses(payload);
  if (!statuses.length) return 0;
  const allItems = await store.list<FollowupBatchItemRecord>('followup_batch_items', { where: { tenant_id: tenantId }, perPage: 2000, sort: '-updated_at' });
  let updated = 0;
  const touchedBatches = new Set<string>();
  for (const status of statuses) {
    const messageId = String(status.id || '');
    const nextStatus = String(status.status || '').toLowerCase();
    if (!messageId || !RECEIPT_RANK[nextStatus]) continue;
    const item = allItems.items.find(candidate => candidate.provider_message_id === messageId || receiptMessages(candidate.provider_receipt).some(entry => entry.messageId === messageId));
    if (!item) continue;
    const current = String(item.status || 'sent');
    const occurredAt = timestamp(status.timestamp) ? new Date(timestamp(status.timestamp)).toISOString() : new Date().toISOString();
    const receipt = jsonObject(item.provider_receipt);
    const receiptStatuses = Array.isArray(receipt.statuses) ? receipt.statuses as Array<Record<string, unknown>> : [];
    const priorMessageStatus = receiptStatuses
      .filter(entry => entry.messageId === messageId)
      .map(entry => String(entry.status || 'sent'))
      .sort((left, right) => (RECEIPT_RANK[right] || 0) - (RECEIPT_RANK[left] || 0))[0];
    if (priorMessageStatus && (RECEIPT_RANK[nextStatus] || 0) < (RECEIPT_RANK[priorMessageStatus] || 0)) continue;
    const nextStatuses = [...receiptStatuses.filter(entry => entry.messageId !== messageId), { messageId, status: nextStatus, occurredAt, conversation: status.conversation || {}, pricing: status.pricing || {}, errors: status.errors || [] }];
    const nextReceipt = { ...receipt, statuses: nextStatuses };
    const messageIds = receiptMessages(receipt).map(entry => String(entry.messageId || '')).filter(Boolean);
    const statusByMessage = new Map(nextStatuses.map(entry => [String(entry.messageId || ''), String(entry.status || 'sent')]));
    const aggregateStatuses = messageIds.map(id => statusByMessage.get(id) || 'sent');
    const aggregateStatus = current === 'partial_sent'
      ? 'partial_sent'
      : aggregateStatuses.some(value => value === 'failed')
        ? 'failed'
        : aggregateStatuses.length && aggregateStatuses.every(value => value === 'read')
          ? 'read'
          : aggregateStatuses.length && aggregateStatuses.every(value => (RECEIPT_RANK[value] || 0) >= RECEIPT_RANK.delivered)
            ? 'delivered'
            : 'sent';
    const patch: Record<string, unknown> = { status: aggregateStatus, provider_receipt: nextReceipt, updated_at: occurredAt };
    if (aggregateStatus === 'delivered' || aggregateStatus === 'read') patch.delivered_at = item.delivered_at || occurredAt;
    if (aggregateStatus === 'failed') patch.last_error = JSON.stringify(status.errors || []).slice(0, 1000) || 'provider_delivery_failed';
    await store.update('followup_batch_items', item.id, patch);
    const batch = await getFollowupBatch(tenantId, item.batch_id);
    if (batch) {
      touchedBatches.add(batch.id);
      await emit({ tenantId, runId: batch.run_id, taskId: await dispatchTaskId(batch), batchId: batch.id, itemId: item.id, customerId: item.customer_id, type: 'worker.receipt', level: nextStatus === 'failed' ? 'error' : 'success', summary: `${item.customer_name || '客户'} WhatsApp 回执：${nextStatus}`, payload: { providerMessageId: messageId, status: nextStatus, occurredAt } });
    }
    updated += 1;
  }
  for (const batchId of touchedBatches) {
    const batch = await getFollowupBatch(tenantId, batchId);
    if (batch) await refreshBatchCounts(batch);
  }
  return updated;
}

export function getFollowupDispatchWorkerStatus(): { mode: 'scheduled' | 'manual_only'; running: boolean; intervalMs: number; maxAttempts: number } {
  return { mode: followupWorkerMode(), running: Boolean(interval), intervalMs: followupWorkerIntervalMs(), maxAttempts: followupWorkerMaxAttempts() };
}

export async function getTenantFollowupDispatchStatus(tenantId: string): Promise<ReturnType<typeof getFollowupDispatchWorkerStatus> & {
  authorization: CustomerMessagingAuthorization;
}> {
  return {
    ...getFollowupDispatchWorkerStatus(),
    authorization: await readCustomerMessagingAuthorization(tenantId),
  };
}

export async function runFollowupDispatchScan(): Promise<number> {
  if (scanRunning) return 0;
  scanRunning = true;
  try {
    const batches = await store.list<FollowupBatchRecord>('followup_batches', { where: { status: 'approved' }, sort: 'updated_at', perPage: 500 });
    for (const batch of batches.items) {
      await dispatchFollowupBatch(batch.tenant_id, batch.id, { mode: 'scheduled' }).catch(error => {
        const failure = safeError(error);
        if (!failure.code.startsWith('customer_message_send_not_authorized:')) {
          console.error('[followup-worker:batch]', batch.id, failure.code);
        }
      });
    }
    return batches.items.length;
  } finally { scanRunning = false; }
}

export function initFollowupDispatchWorker(): void {
  if (followupWorkerMode() !== 'scheduled' || interval) return;
  const tick = () => { void runFollowupDispatchScan().catch(error => console.error('[followup-worker:scan]', safeError(error).code)); };
  interval = setInterval(tick, followupWorkerIntervalMs());
  interval.unref?.();
  tick();
  console.log(`[followup-worker] scheduled mode enabled (${followupWorkerIntervalMs()}ms)`);
}
