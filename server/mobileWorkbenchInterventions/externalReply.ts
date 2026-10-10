/**
 * Mobile intervention domain adapters. The authenticated router owns capabilities,
 * durable command idempotency and execution leases; this layer checks tenant and
 * frozen subject versions before delegating to existing business services.
 *
 * Evidence submission is pending verification, not publication success. Provider
 * recovery performs owned-channel/content/time checks; unsupported platforms fail
 * closed. Customer replies use reviewed WeCom drafts and its native outbox, not
 * a raw transport send. Dependency retries pass structured scope and never turn
 * the payload into a natural-language instruction.
 */
import type { DataStore, Record_ } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import { readStarterPublicationPackage, submitStarterPublicationEvidence } from '../publishing/starterPublicationPackage.js';
import { recoverPublishingReceipt } from '../publishing/receiptRecovery.js';
import { weComCustomerService } from '../wecom/customerService.js';

export type ExternalReplyKind = 'publication_evidence_submit' | 'publication_receipt_verify' | 'conversation_reply_send' | 'conversation_assign' | 'dependency_retry';
export interface ExternalReplyInput { tenantId: string; userId: string; targetId: string; expectedVersion: string; idempotencyKey: string; kind: ExternalReplyKind; payload: Record<string, unknown> }
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const required = (v: unknown, field: string): string => { const result = text(v); if (!result) throw new Error(`${field}_required`); return result; };
const version = (row: Record_) => String(row.task_version ?? row.version ?? row.updated_at ?? row.updated ?? '');
async function owned(dataStore: DataStore, collection: string, id: string, tenantId: string, expectedVersion?: string) {
  const row = await dataStore.getById<Record_>(collection, id);
  if (!row || text(row.tenant_id ?? row.tenantId) !== tenantId) throw new Error('intervention_subject_not_found');
  if (expectedVersion !== undefined && (!expectedVersion || version(row) !== expectedVersion)) throw new Error('intervention_version_conflict');
  return row;
}
export function createExternalReplyAdapter(deps: {
  dataStore?: DataStore;
  conversation?: typeof weComCustomerService;
  recoverReceipt?: typeof recoverPublishingReceipt;
  retryTask?: (input: { tenantId: string; userId: string; taskId: string; expectedTaskVersion: string; rerunDownstream: boolean }) => Promise<unknown>;
} = {}) {
  const dataStore = deps.dataStore ?? store;
  const conversation = deps.conversation ?? weComCustomerService;
  return {
    async detail(input: { tenantId: string; targetId: string; type: 'external' | 'conversation' | 'resume' }) {
      if (input.type === 'external') {
        const manifest = await readStarterPublicationPackage(input.tenantId, input.targetId, dataStore);
        if (!manifest) throw new Error('intervention_subject_not_found');
        const enabled = !['published', 'superseded', 'expired'].includes(manifest.status);
        return { matterId: input.targetId, subjectVersion: manifest.contentHash, title: '完成平台发布', whyUser: '需要人工发布并提交可核验回执', source: { entityId: manifest.packageId }, requiresUserAction: enabled, external: { ...manifest, packageUrl: null, copy: [manifest.copy.title, manifest.copy.body, ...manifest.copy.hashtags].filter(Boolean).join('\n'), platformInstruction: manifest.publishingSteps.join('\n') },
          actionOptions: [{ id: 'submit_evidence', label: '提交发布链接', kind: 'publication_evidence_submit', enabled, disabledReason: enabled ? '' : '发布包已完成或失效', fields: [{ id: 'publicUrl', label: '公开发布链接', type: 'url', required: true }], payload: { contentHash: manifest.contentHash } }] };
      }
      if (input.type === 'conversation') {
        const result = await conversation.getConversationDetail({ tenantId: input.tenantId, conversationId: input.targetId });
        const row = result.conversation;
        const draft = result.drafts.find(item => item.status === 'pending' || item.status === 'draft') ?? result.drafts[0];
        const inWindow = Number.isFinite(Date.parse(text(row.last_inbound_at))) && Date.now() - Date.parse(text(row.last_inbound_at)) <= 48 * 60 * 60_000 && Date.now() >= Date.parse(text(row.last_inbound_at));
        return { matterId: row.id, subjectVersion: version(row), title: '处理客户询盘', whyUser: '客户需要人工回复或接手', source: { entityId: row.id }, requiresUserAction: row.human_required === true, conversation: { ...result, draft: draft?.content ?? '', messages: result.messages.map(message => ({ ...message, sender: message.direction === 'inbound' ? '客户' : message.direction === 'human_outbound' ? '客服' : '系统', body: text(message.content), occurredAt: text(message.sent_at) })) },
          actionOptions: [{ id: 'send_draft', label: '确认发送草稿', kind: 'conversation_reply_send', enabled: Boolean(draft) && inWindow, disabledReason: !draft ? '尚无可发送草稿' : !inWindow ? '客户回复窗口已关闭' : '', payload: { draftId: draft?.id ?? '', humanApproved: true } }, { id: 'assign', label: '转交负责人', kind: 'conversation_assign', enabled: true, fields: [{ id: 'servicerUserId', label: '负责人企业微信 ID', type: 'text', required: true }, { id: 'reason', label: '转交原因', type: 'text', required: true }], payload: {} }] };
      }
      const row = await owned(dataStore, 'workflow_tasks', input.targetId, input.tenantId);
      const retryable = ['failed', 'blocked', 'needs_attention'].includes(text(row.status));
      return { matterId: row.id, subjectVersion: version(row), title: text(row.title) || '恢复任务', whyUser: text(row.blocked_reason), source: { entityId: row.id }, requiresUserAction: retryable, resume: { checkpointLabel: text(object(row.output).checkpoint) || '当前失败步骤', retainedArtifacts: row.business_refs ?? [], checkpoint: object(row.output).checkpoint ?? null, preservedOutput: row.output ?? null, businessRefs: row.business_refs ?? [], status: row.status },
        actionOptions: [{ id: 'retry_step', label: '只重试失败步骤', kind: 'dependency_retry', enabled: retryable, disabledReason: retryable ? '' : '任务当前不可重试', payload: { mode: 'failed_step' } }, { id: 'retry_downstream', label: '重跑受影响下游', kind: 'dependency_retry', enabled: retryable, payload: { mode: 'downstream' } }] };
    },
    async execute(input: ExternalReplyInput): Promise<Record<string, unknown>> {
      const p = input.payload;
      if (input.kind === 'publication_evidence_submit') {
        const manifest = await readStarterPublicationPackage(input.tenantId, input.targetId, dataStore);
        if (!manifest) throw new Error('intervention_subject_not_found');
        if (input.expectedVersion !== manifest.contentHash || p.contentHash !== manifest.contentHash) throw new Error('intervention_version_conflict');
        const result = await submitStarterPublicationEvidence({ tenantId: input.tenantId, packageId: input.targetId, contentHash: manifest.contentHash, publicUrl: required(p.publicUrl, 'publicUrl'), submittedBy: input.userId }, dataStore);
        return { ...result, status: 'waiting_verification', message: '链接已提交，等待平台证据核验；尚未确认发布成功' };
      }
      if (input.kind === 'publication_receipt_verify') {
        await owned(dataStore, 'posts', input.targetId, input.tenantId, input.expectedVersion);
        const post = await (deps.recoverReceipt ?? recoverPublishingReceipt)({ tenantId: input.tenantId, postId: input.targetId, accountId: required(p.accountId, 'accountId'), attemptId: required(p.attemptId, 'attemptId'), platformPostId: required(p.platformPostId, 'platformPostId') });
        return { postId: post.id, stats: post.stats };
      }
      if (input.kind === 'conversation_reply_send' || input.kind === 'conversation_assign') {
        const detail = await conversation.getConversationDetail({ tenantId: input.tenantId, conversationId: input.targetId });
        if (version(detail.conversation) !== input.expectedVersion) throw new Error('intervention_version_conflict');
        if (input.kind === 'conversation_reply_send') {
          if (p.humanApproved !== true) throw new Error('human_approval_required');
          const result = await conversation.sendDraft({ tenantId: input.tenantId, userId: input.userId, conversationId: input.targetId, draftId: required(p.draftId, 'draftId'), humanApproved: true, idempotencyKey: required(input.idempotencyKey, 'idempotencyKey') });
          return { outboundId: result.id, status: result.status, deliveryConfirmed: false };
        }
        return object(await conversation.handoff({ tenantId: input.tenantId, userId: input.userId, conversationId: input.targetId, reason: required(p.reason, 'reason'), servicerUserId: required(p.servicerUserId, 'servicerUserId') }));
      }
      if (input.kind === 'dependency_retry') {
        const row = await owned(dataStore, 'workflow_tasks', input.targetId, input.tenantId, input.expectedVersion);
        if (!['failed', 'blocked', 'needs_attention'].includes(text(row.status))) throw new Error('task_not_retryable');
        if (!['failed_step', 'downstream'].includes(text(p.mode))) throw new Error('retry_mode_invalid');
        const retry = deps.retryTask ?? (await import('../routes/digitalEmployees.js')).retryDigitalEmployeeTask;
        return { ...object(await retry({ tenantId: input.tenantId, userId: input.userId, taskId: input.targetId, expectedTaskVersion: input.expectedVersion, rerunDownstream: p.mode === 'downstream' })), status: 'running' };
      }
      throw new Error('intervention_action_unsupported');
    },
  };
}
