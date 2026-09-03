import { createHash } from 'node:crypto';
import type { ExecutionContract } from './executionContract.js';
import {
  activatePreparedScheduledPost,
  createScheduledPost,
  schedulePayloadHash,
  verifyApprovedScheduledPost,
  type SchedulePostInput,
} from '../publishing/scheduleService.js';
import type { PostRecord } from '../publishing/waLink.js';
import { store } from '../storage/index.js';
import { compareAndSetRecord, createRecordIfAbsent, ReliableKernelError } from './reliableKernel.js';
import {
  attachPublishContentFences,
  publishContentFenceKey,
  releasePostContentFences,
  releasePublishContentReservations,
  reservePublishContentFences,
  type ReservedPublishContentFences,
} from '../publishing/publishContentFence.js';
import { tenantPublishingVideoSha256 } from '../publishing/localVideoSecurity.js';
import { withPublishQueueProjection } from '../publishing/publishQueueProjection.js';

type StoredRecord = { id: string; [key: string]: unknown };
export interface OutboundActionProposal {
  actionType: 'register_schedule'; version: number; mode: 'dry_run' | 'real';
  artifact: { type: 'studio_project'; id: string; version: number; scriptId?: string; deepLink?: string; previewUrl?: string; videoPath?: string; videoUrl?: string; videoSha256?: string };
  contentSnapshot: Record<string, unknown>;
  contentPayloadHash: string;
  targetAccount: { id: string; label: string; platform: string };
  scheduledAt: string; estimatedCost: number; risk: 'high'; reversibility: 'reversible_before_publish'; expiresAt: string;
  nextStep: string; schedulePayload: SchedulePostInput; payloadHash: string;
}
function text(value: unknown, max = 1000): string { return String(value ?? '').trim().slice(0, max); }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function jsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') { try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; } }
  return {};
}

type OutboundAuthorizationInput = {
  tenantId: string;
  runId: string;
  taskId: string;
  approvalId: string;
  proposal: OutboundActionProposal;
  approvedPayloadHash: string;
  approval: StoredRecord | null;
  run: StoredRecord | null;
  task: StoredRecord | null;
  expectedApprovalRevision?: number;
  expectedRunRevision?: number;
  expectedTaskRevision?: number;
  now?: number;
};

/** Pure, fail-closed gate used both before and after schedule persistence. */
export function outboundAuthorizationFailure(input: OutboundAuthorizationInput): string | null {
  const { approval, run, task } = input;
  if (!approval || approval.id !== input.approvalId || approval.tenant_id !== input.tenantId
    || approval.run_id !== input.runId || approval.task_id !== input.taskId
    || !['approved', 'approved_with_changes'].includes(String(approval.status))) return 'approval_snapshot_not_executable';
  if (String(approval.approved_payload_hash || '') !== input.approvedPayloadHash
    || Number(approval.action_version || 0) !== input.proposal.version
    || proposalIntegrityHash(jsonRecord(approval.action_payload) as unknown as OutboundActionProposal) !== input.approvedPayloadHash) {
    return 'approval_snapshot_stale';
  }
  if (input.proposal.risk === 'high' && !approval.decided_by) return 'high_risk_approval_identity_missing';
  if (input.expectedApprovalRevision !== undefined && Number(approval.revision || 0) !== input.expectedApprovalRevision) return 'approval_revision_changed';
  if (!run || run.id !== input.runId || run.tenant_id !== input.tenantId || run.status !== 'running') return 'run_not_executable';
  if (input.expectedRunRevision !== undefined && Number(run.revision || 0) !== input.expectedRunRevision) return 'run_revision_changed';
  if (!task || task.id !== input.taskId || task.tenant_id !== input.tenantId || task.run_id !== input.runId || task.status !== 'running') return 'task_not_executable';
  if (input.expectedTaskRevision !== undefined && Number(task.revision || 0) !== input.expectedTaskRevision) return 'task_revision_changed';
  const expiresAt = Date.parse(input.proposal.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= (input.now ?? Date.now())) return 'approved_action_expired';
  if (input.proposal.estimatedCost > Math.max(0, Number(run.budget_limit || 0) - Number(run.budget_spent || 0))) return 'approved_action_budget_exceeded';
  return null;
}

async function fencePostAfterAuthorizationLoss(post: PostRecord, reason: string): Promise<void> {
  const stats = jsonRecord(post.stats);
  const status = text(stats.status, 80);
  const uncertain = ['publishing', 'partial', 'published', 'needs_reconciliation'].includes(status);
  const nextFence = Number(post.digital_employee_fence_revision || 0) + 1;
  const changed = await compareAndSetRecord<PostRecord>({
    store,
    collection: 'posts',
    id: post.id,
    expected: {
      publish_revision: Number(post.publish_revision || 0),
      digital_employee_fence_revision: Number(post.digital_employee_fence_revision || 0),
      digital_employee_run_id: text(post.digital_employee_run_id, 120),
      digital_employee_approval_id: text(post.digital_employee_approval_id, 120),
    },
    patch: withPublishQueueProjection(post, {
      stats: {
        ...stats,
        status: uncertain ? 'needs_reconciliation' : 'cancelled',
        publishError: reason,
        nextPublishAttemptAt: '',
        warnings: [reason],
      },
      digital_employee_fence_revision: nextFence,
      publish_revision: Number(post.publish_revision || 0) + 1,
      publish_lease_owner: '',
      publish_lease_expires_at: '',
      reconciliation_required: uncertain,
    }),
  });
  if (!changed.ok) throw new ReliableKernelError('scheduled_post_authorization_fence_conflict', 'The schedule changed while its authorization was being fenced.', true);
  if (!uncertain) await releasePostContentFences(store, post.id);
}

function scheduledPostBoundToAction(post: PostRecord, input: {
  tenantId: string;
  runId: string;
  approvalId: string;
  approvedPayloadHash: string;
  proposal: OutboundActionProposal;
}): boolean {
  if (post.tenant_id !== input.tenantId
    || text(post.digital_employee_run_id, 120) !== input.runId
    || text(post.digital_employee_approval_id, 120) !== input.approvalId
    || text(post.digital_employee_action_hash, 128) !== input.approvedPayloadHash
    || !verifyApprovedScheduledPost(post).ok) return false;
  const stats = jsonRecord(post.stats);
  const expectedScheduleHash = schedulePayloadHash({
    ...input.proposal.schedulePayload,
    runId: input.runId,
    approvalId: input.approvalId,
    approvedActionHash: input.approvedPayloadHash,
    runRevision: Number(stats.runRevision || 0),
    approvalRevision: Number(stats.approvalRevision || 0),
    fenceRevision: Number(stats.approvedFenceRevision || 0),
  });
  return text(stats.schedulePayloadHash, 128) === expectedScheduleHash;
}

export function buildOutboundActionProposal(input: { tenantId: string; runId: string; taskId: string; goalTitle: string; contract: ExecutionContract; draft: Record<string, unknown>; now?: Date }): OutboundActionProposal {
  const now = input.now || new Date();
  const artifact = (input.draft.studioProject || input.draft.artifact || {}) as Record<string, unknown>;
  const script = (input.draft.script || {}) as Record<string, unknown>;
  const draftSummary = (input.draft.draftSummary || input.draft.summary || {}) as Record<string, unknown>;
  const contentSnapshot = jsonRecord(input.draft.draftSnapshot);
  const contentPayloadHash = text(input.draft.artifactPayloadHash, 128).toLowerCase();
  if (!Object.keys(contentSnapshot).length || !/^[a-f0-9]{64}$/.test(contentPayloadHash)
    || hash(contentSnapshot) !== contentPayloadHash) {
    throw new ReliableKernelError('approval_content_snapshot_missing', '审批所需的完整内容快照缺失或摘要不一致');
  }
  const platform = text(draftSummary.platform, 30).toLowerCase();
  const account = input.contract.resources.connectedAccounts.find(candidate => (
    text(candidate.platform, 30).toLowerCase() === platform
  ));
  const scheduledAt = new Date(Math.max(now.getTime() + 60 * 60_000, Date.parse(`${input.contract.measurement.window.startsAt}T09:00:00.000Z`) || 0)).toISOString();
  const videoSha256 = text(artifact.videoSha256, 128).toLowerCase();
  // Automated publishing is restricted to a renderer-owned local artifact. A
  // remote URL cannot be proven to contain the same bytes when the worker later
  // publishes it, so it must stay in dry-run mode even when a caller supplies a
  // digest-looking value.
  const hasMedia = Boolean(text(artifact.videoPath)) && /^[a-f0-9]{64}$/.test(videoSha256);
  // TikTok requires the latest creator capabilities, a privacy selection with
  // no default, interaction/disclosure choices, and an express music-use
  // confirmation. Those inputs cannot be inferred by an autonomous proposal;
  // the compliant Traffic workflow performs this interactive handoff.
  const requiresInteractiveTikTokConsent = platform === 'tiktok';
  const mode: 'dry_run' | 'real' = account && hasMedia
    && ['youtube', 'tiktok', 'instagram', 'facebook'].includes(platform)
    && !requiresInteractiveTikTokConsent
    && input.contract.policy.autonomyMode !== 'suggest'
    && process.env.DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED === 'true' ? 'real' : 'dry_run';
  const schedulePayload: SchedulePostInput = {
    tenantId: input.tenantId, contentId: text(artifact.id, 120), platform,
    title: text(contentSnapshot.title, 300) || input.goalTitle,
    scheduledAt, language: text(draftSummary.language, 30) || 'en',
    description: [
      text(contentSnapshot.caption, 5_000),
      Array.isArray(contentSnapshot.hashtags) ? contentSnapshot.hashtags.map(item => text(item, 80)).filter(Boolean).join(' ') : '',
      text(contentSnapshot.cta, 300),
    ].filter(Boolean).join('\n\n').slice(0, 8_000),
    videoPath: text(artifact.videoPath, 2000), videoUrl: '', videoSha256,
    publishContentDigest: videoSha256,
    contentFenceKeys: account ? [publishContentFenceKey({
      tenantId: input.tenantId,
      platform,
      accountId: account.id,
      contentDigest: videoSha256,
    })] : [],
    targetAccountIds: account ? [account.id] : [], targetAccountLabels: account ? [account.platform] : [], trackWaLink: true, scheduleLocked: true,
    source: 'digital_employee', idempotencyKey: `${input.runId}:register_schedule:v2`,
  };
  const proposalWithoutHash = {
    actionType: 'register_schedule', version: 2, mode,
    artifact: {
      type: 'studio_project', id: text(artifact.id, 120), version: Number(artifact.version || 1), scriptId: text(script.id, 120),
      deepLink: text(artifact.deepLink, 500),
      previewUrl: `/api/overseas/digital-employees/artifacts/${encodeURIComponent(text(artifact.id, 120))}/video`,
      videoPath: text(artifact.videoPath, 2000), videoUrl: text(artifact.videoUrl, 2000), videoSha256,
    },
    contentSnapshot,
    contentPayloadHash,
    targetAccount: { id: text(account?.id, 120), label: text(account?.platform, 100), platform }, scheduledAt,
    estimatedCost: 0, risk: 'high', reversibility: 'reversible_before_publish', expiresAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
    nextStep: mode === 'real'
      ? '创建已审批排期，由现有发布 Worker 执行'
      : requiresInteractiveTikTokConsent
        ? '执行 dry-run；转到流量运营完成 TikTok 创作者权限、可见范围、披露项与音乐使用确认后再排期'
        : '执行 dry-run 并明确记录未发布原因',
    schedulePayload,
  } satisfies Omit<OutboundActionProposal, 'payloadHash'>;
  // Bind the approval to every action field, not only the subset persisted in
  // posts. The publishing service performs its own second, schedule-specific
  // hash check immediately before creating an executable schedule.
  const payloadHash = hash(proposalWithoutHash);
  return { ...proposalWithoutHash, payloadHash };
}

export async function executeApprovedOutboundAction(input: { tenantId: string; runId: string; taskId: string; approvalId: string; proposal: OutboundActionProposal; approvedPayloadHash: string }): Promise<Record<string, unknown>> {
  if (proposalIntegrityHash(input.proposal) !== input.approvedPayloadHash) throw new Error('approved_action_payload_changed');
  const [approval, run, task] = await Promise.all([
    store.getById<StoredRecord>('approval_requests', input.approvalId),
    store.getById<StoredRecord>('workflow_runs', input.runId),
    store.getById<StoredRecord>('workflow_tasks', input.taskId),
  ]);
  const initialFailure = outboundAuthorizationFailure({ ...input, approval, run, task });
  if (initialFailure) throw new Error(initialFailure);
  const approvalRevision = Number(approval?.revision || 0);
  const runRevision = Number(run?.revision || 0);
  const taskRevision = Number(task?.revision || 0);
  const key = `${input.runId}:register_schedule:v${input.proposal.version}`;
  const now = new Date().toISOString();
  let reservation = await createRecordIfAbsent<StoredRecord>({
    store,
    collection: 'outbound_action_ledger',
    uniqueWhere: { tenant_id: input.tenantId, idempotency_key: key },
    data: {
      tenant_id: input.tenantId, run_id: input.runId, task_id: input.taskId, approval_id: input.approvalId,
      action_type: input.proposal.actionType, action_version: input.proposal.version, status: 'executing', idempotency_key: key,
      approved_payload_hash: input.approvedPayloadHash, payload: input.proposal, external_record_id: '', reason: '', created_at: now, updated_at: now,
    },
  });
  if (!reservation.created) {
    const status = String(reservation.record.status || '');
    if (status === 'dry_run') {
      return { action: { id: reservation.record.id, status }, externalPublishPerformed: false, artifact: reservation.record.external_record_id ? { type: 'post', id: reservation.record.external_record_id } : undefined };
    }
    if (status === 'scheduled') {
      const existing = text(reservation.record.external_record_id, 120)
        ? await store.getById<PostRecord>('posts', text(reservation.record.external_record_id, 120))
        : null;
      if (!existing || !scheduledPostBoundToAction(existing, input)) throw new Error('scheduled_post_governance_binding_invalid');
      return { action: { id: reservation.record.id, status }, externalPublishPerformed: false, artifact: { type: 'post', id: existing.id } };
    }
    const scheduledPost = await store.list<PostRecord>('posts', { where: { tenant_id: input.tenantId, digital_employee_idempotency_key: input.proposal.schedulePayload.idempotencyKey || key }, perPage: 1 });
    if (scheduledPost.items[0] && text(jsonRecord(scheduledPost.items[0].stats).status, 80) === 'scheduled'
      && scheduledPostBoundToAction(scheduledPost.items[0], input)) {
      await compareAndSetRecord({ store, collection: 'outbound_action_ledger', id: reservation.record.id, expected: { status }, patch: { status: 'scheduled', external_record_id: scheduledPost.items[0].id, reason: '', updated_at: new Date().toISOString() } });
      return { summary: '已恢复上次已创建的排期记录', externalPublishPerformed: false, action: { id: reservation.record.id, status: 'scheduled' }, artifact: { type: 'post', id: scheduledPost.items[0].id } };
    }
    const stale = Date.now() - Date.parse(String(reservation.record.updated_at || reservation.record.created_at || '')) > 5 * 60_000;
    const knownFailed = status === 'failed';
    if (!stale && !knownFailed) throw new ReliableKernelError('outbound_action_in_progress', 'The approved outbound action is already executing.', true);
    const reclaimed = await compareAndSetRecord<StoredRecord>({ store, collection: 'outbound_action_ledger', id: reservation.record.id, expected: { status }, patch: { status: 'executing', reason: 'stale_action_reclaimed', updated_at: new Date().toISOString() } });
    if (!reclaimed.ok) throw new ReliableKernelError('outbound_action_claim_conflict', 'The approved outbound action claim changed.', true);
    reservation = { created: true, record: reclaimed.record };
  }
  try {
    if (input.proposal.mode === 'dry_run') {
      const reason = !input.proposal.targetAccount.id
        ? '未连接目标社媒账号'
        : !input.proposal.artifact.videoPath || !/^[a-f0-9]{64}$/.test(String(input.proposal.artifact.videoSha256 || ''))
          ? 'Studio 尚未生成经过内容摘要校验的可发布视频文件'
          : input.proposal.targetAccount.platform === 'tiktok'
            ? 'TikTok 要求发布前实时查询创作者权限，并由用户显式选择可见范围、披露项及确认音乐使用；已安全转为人工发布交接'
          : '自主模式或真实自动发布开关不允许执行';
      const completed = await compareAndSetRecord<StoredRecord>({ store, collection: 'outbound_action_ledger', id: reservation.record.id, expected: { status: 'executing' }, patch: { status: 'dry_run', reason, updated_at: new Date().toISOString() } });
      if (!completed.ok) throw new ReliableKernelError('action_ledger_completion_conflict', 'Dry-run ledger completion conflicted.', true);
      return { summary: '已完成安全 dry-run，未执行真实发布', externalPublishPerformed: false, action: { id: completed.record.id, status: 'dry_run' }, reason };
    }
    const scheduleInput: SchedulePostInput = {
      ...input.proposal.schedulePayload,
      runId: input.runId,
      approvalId: input.approvalId,
      approvedActionHash: input.approvedPayloadHash,
      runRevision,
      approvalRevision,
      fenceRevision: 0,
    };
    const mediaIdentity = await tenantPublishingVideoSha256(input.tenantId, scheduleInput.videoPath || '');
    if (mediaIdentity.sha256 !== String(scheduleInput.videoSha256 || '').toLowerCase()
      || mediaIdentity.sha256 !== String(scheduleInput.publishContentDigest || '').toLowerCase()) {
      throw new Error('approved_video_content_changed');
    }
    const immutableScheduleInput: SchedulePostInput = {
      ...scheduleInput,
      videoPath: mediaIdentity.filePath,
      videoUrl: '',
      videoSha256: mediaIdentity.sha256,
      publishContentDigest: mediaIdentity.sha256,
    };
    const scheduleHash = schedulePayloadHash(immutableScheduleInput);
    const prepared = await createScheduledPost({ ...immutableScheduleInput, approvedPayloadHash: scheduleHash });
    let contentReservation: ReservedPublishContentFences | undefined;
    try {
      contentReservation = await reservePublishContentFences({
        dataStore: store,
        tenantId: input.tenantId,
        platform: immutableScheduleInput.platform,
        accountIds: immutableScheduleInput.targetAccountIds,
        contentDigest: mediaIdentity.sha256,
        ownerKey: immutableScheduleInput.idempotencyKey || key,
      });
      await attachPublishContentFences(
        store,
        contentReservation.records,
        immutableScheduleInput.idempotencyKey || key,
        prepared.id,
      );
      const preActivationFailure = outboundAuthorizationFailure({
        ...input,
        approval: await store.getById<StoredRecord>('approval_requests', input.approvalId),
        run: await store.getById<StoredRecord>('workflow_runs', input.runId),
        task: await store.getById<StoredRecord>('workflow_tasks', input.taskId),
        expectedApprovalRevision: approvalRevision,
        expectedRunRevision: runRevision,
        expectedTaskRevision: taskRevision,
      });
      if (preActivationFailure) throw new Error(preActivationFailure);
    } catch (error) {
      if (contentReservation) {
        await releasePostContentFences(store, prepared.id).catch(() => undefined);
        await releasePublishContentReservations(
          store,
          contentReservation.createdIds,
          immutableScheduleInput.idempotencyKey || key,
        ).catch(() => undefined);
      }
      throw error;
    }
    const post = await activatePreparedScheduledPost(prepared, store);
    if (text(jsonRecord(post.stats).status, 80) !== 'scheduled') throw new Error('scheduled_post_not_executable');
    const [freshApproval, freshRun, freshTask] = await Promise.all([
      store.getById<StoredRecord>('approval_requests', input.approvalId),
      store.getById<StoredRecord>('workflow_runs', input.runId),
      store.getById<StoredRecord>('workflow_tasks', input.taskId),
    ]);
    const postCreateFailure = outboundAuthorizationFailure({
      ...input,
      approval: freshApproval,
      run: freshRun,
      task: freshTask,
      expectedApprovalRevision: approvalRevision,
      expectedRunRevision: runRevision,
      expectedTaskRevision: taskRevision,
    });
    if (postCreateFailure) {
      await fencePostAfterAuthorizationLoss(post, postCreateFailure);
      throw new Error(postCreateFailure);
    }
    const completed = await compareAndSetRecord<StoredRecord>({ store, collection: 'outbound_action_ledger', id: reservation.record.id, expected: { status: 'executing' }, patch: { status: 'scheduled', external_record_id: post.id, reason: '', updated_at: new Date().toISOString() } });
    if (!completed.ok) throw new ReliableKernelError('action_ledger_completion_conflict', 'Schedule ledger completion conflicted.', true);
    return { summary: '已安全创建排期，等待现有发布 Worker 执行', externalPublishPerformed: false, action: { id: completed.record.id, status: 'scheduled' }, artifact: { type: 'post', id: post.id, deepLink: `/scheduled?post=${encodeURIComponent(post.id)}` } };
  } catch (error) {
    await compareAndSetRecord({ store, collection: 'outbound_action_ledger', id: reservation.record.id, expected: { status: 'executing' }, patch: { status: 'failed', reason: String((error as Error)?.message || error).slice(0, 2_000), updated_at: new Date().toISOString() } }).catch(() => undefined);
    throw error;
  }
}

export function proposalIntegrityHash(proposal: OutboundActionProposal): string {
  const { payloadHash: _payloadHash, ...boundFields } = proposal;
  return hash(boundFields);
}
