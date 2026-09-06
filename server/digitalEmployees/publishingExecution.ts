import { boundedPublishingSlots } from './continuationPolicy.js';
import { createHash } from 'node:crypto';
import { createTrackedPostDraft } from '../publishing/waLink.js';
import { store } from '../storage/index.js';
import type { PublishingPlatform, PublishingTarget } from './domain.js';
import { runExternalActionBlockedReason, withDigitalEmployeeRunLock } from './runControl.js';

type StoredProject = { id: string; title?: unknown; status?: unknown; spec?: unknown };

export interface PublishingApprovalItem {
  sourceProjectId: string;
  platform: PublishingPlatform;
  accountIds: string[];
  accountLabels: string[];
  title: string;
  description: string;
  videoPath: string;
  scheduledAt: string;
}

export interface PublishingApprovalPackage {
  schemaVersion: 1;
  contentHash: string;
  allowRealPublishing: boolean;
  items: PublishingApprovalItem[];
}

const text = (value: unknown): string => String(value ?? '').trim();
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function outputPaths(spec: Record<string, unknown>): string[] {
  const automation = record(spec.automation);
  // Automation owns a single current deliverable. Historical render versions
  // remain in the library, but are never implicit approval subjects.
  if (text(automation.renderOutputPath)) return [text(automation.renderOutputPath)];
  const outputs = record(spec.languageRenderOutputs);
  if (Object.keys(outputs).length) {
    return [...new Set(Object.values(outputs).map(record)
      .filter(item => text(item.status) === 'done' && text(item.path))
      .map(item => text(item.path)))];
  }
  const legacy = ['renderOutputPath', 'videoPath', 'outputPath'].map(key => text(spec[key])).find(Boolean);
  return legacy ? [legacy] : [];
}

function nextDailySlot(index: number, now: Date): string {
  const slot = new Date(now);
  slot.setDate(slot.getDate() + index + 1);
  slot.setHours(20, 0, 0, 0);
  return slot.toISOString();
}

function contentFingerprint(items: PublishingApprovalItem[], allowRealPublishing: boolean): string {
  return createHash('sha256').update(JSON.stringify({ allowRealPublishing, items })).digest('hex');
}

/** Build the exact, human-readable subject of a batch approval. */
export function buildPublishingApprovalPackage(input: {
  projects: StoredProject[];
  targets: PublishingTarget[];
  goalPlatforms: PublishingPlatform[];
  allowRealPublishing: boolean;
  now?: Date;
  scheduling?: { startsAt: string; endsAt: string; timezone: 'account' | 'Asia/Shanghai' };
}): PublishingApprovalPackage {
  const now = input.now || new Date();
  const selectedPlatforms = new Set(input.goalPlatforms);
  const targetsByPlatform = new Map<PublishingPlatform, PublishingTarget[]>();
  for (const target of input.targets.filter(item => selectedPlatforms.has(item.platform))) {
    targetsByPlatform.set(target.platform, [...(targetsByPlatform.get(target.platform) || []), target]);
  }
  const items: PublishingApprovalItem[] = [];
  for (const project of input.projects) {
    const spec = record(project.spec);
    for (const videoPath of outputPaths(spec)) {
      for (const [platform, targets] of targetsByPlatform.entries()) {
        items.push({
          sourceProjectId: project.id,
          platform,
          accountIds: targets.map(target => target.accountId),
          accountLabels: targets.map(target => target.accountLabel),
          title: text(project.title) || `内容作品 ${project.id}`,
          description: text(spec.caption) || text(spec.script) || '',
          videoPath,
          scheduledAt: nextDailySlot(items.length, now),
        });
      }
    }
  }
  if (input.scheduling) {
    // Schedule independently per account. A group spanning zones must not share one UTC slot.
    const expanded = items.flatMap(item => item.accountIds.map((id, index) => ({ ...item, accountIds: [id], accountLabels: [item.accountLabels[index]] })));
    for (const target of input.targets) {
      const own = expanded.filter(item => item.accountIds[0] === target.accountId);
      if (!own.length) continue;
      const timezone = input.scheduling.timezone === 'account' ? target.timezone || '' : 'Asia/Shanghai';
      const slots = boundedPublishingSlots({ ...input.scheduling, timezone, count: own.length, now });
      own.forEach((item, index) => { item.scheduledAt = slots[index]; });
    }
    items.splice(0, items.length, ...expanded);
  }
  return { schemaVersion: 1, contentHash: contentFingerprint(items, input.allowRealPublishing), allowRealPublishing: input.allowRealPublishing, items };
}

async function tenantPosts(tenantId: string): Promise<any[]> {
  const posts: any[] = [];
  for (let page = 1; ; page += 1) {
    const result = await store.list<any>('posts', { where: { tenant_id: tenantId }, page, perPage: 500 });
    posts.push(...result.items);
    if (page >= result.totalPages || !result.items.length) return posts;
  }
}

/** Idempotently materialize an approved package in the publishing calendar. */
export async function createPublishingCalendarEntries(input: {
  tenantId: string;
  runId: string;
  approvalTaskId: string;
  approvalId: string;
  approvedContentHash: string;
  package: PublishingApprovalPackage;
}): Promise<Array<{ id: string; status: string }>> {
  if (input.package.contentHash !== input.approvedContentHash
    || contentFingerprint(input.package.items, input.package.allowRealPublishing) !== input.approvedContentHash) throw new Error('approval_subject_changed');
  return withDigitalEmployeeRunLock(input.tenantId, input.runId, async () => {
  const existing = await tenantPosts(input.tenantId);
  const result: Array<{ id: string; status: string }> = [];
  for (const item of input.package.items) {
    const found = existing.find(post => {
      const stats = record(post.stats);
      return text(stats.workflowRunId) === input.runId && text(stats.sourceProjectId) === item.sourceProjectId
        && text(post.platform) === item.platform && text(stats.approvedContentHash) === input.approvedContentHash
        && text(stats.videoPath) === item.videoPath
        && (!Array.isArray(stats.targetAccountIds) || JSON.stringify(stats.targetAccountIds.slice().sort()) === JSON.stringify([...item.accountIds].sort()));
    });
    if (found) { result.push({ id: found.id, status: text(record(found.stats).status) }); continue; }
    const status = input.package.allowRealPublishing ? 'scheduled' : 'awaiting_manual_publish';
    // Save the approval identity and complete calendar subject in the same create.
    // A failed or ambiguously completed write can then be recovered by its identity.
    const tracked = await createTrackedPostDraft(input.tenantId, { contentId: item.sourceProjectId, platform: item.platform, title: item.title, enabled: true }, {
      published_at: item.scheduledAt,
      stats: {
        status, description: item.description, videoPath: item.videoPath,
        targetAccountIds: item.accountIds, targetAccountLabels: item.accountLabels,
        publishAttempts: 0, publishResults: {}, warnings: [], sourceProjectId: item.sourceProjectId,
        workflowRunId: input.runId, workflowTaskId: input.approvalTaskId, workflowTaskKey: 'content_release_approval',
        approvalId: input.approvalId, approvedContentHash: input.approvedContentHash,
        realPublishingAuthorized: input.package.allowRealPublishing,
      },
    });
    existing.push(tracked);
    result.push({ id: tracked.id, status });
  }
  return result;
  });
}

/** Stop future delivery when an already approved source project changes. */
export async function invalidatePublishingApprovalForProject(
  tenantId: string,
  projectId: string,
): Promise<number> {
  const posts = await tenantPosts(tenantId);
  const affected = posts.filter(post => {
    const stats = record(post.stats);
    return text(stats.sourceProjectId) === projectId
      && Boolean(text(stats.approvalId))
      && !['published', 'partial'].includes(text(stats.status));
  });
  const invalidatedAt = new Date().toISOString();
  const approvalIds = new Set<string>();
  for (const post of affected) {
    const stats = record(post.stats);
    approvalIds.add(text(stats.approvalId));
    await store.update('posts', post.id, {
      stats: { ...stats, status: 'awaiting_reapproval', approvedContentHash: '', realPublishingAuthorized: false },
    });
  }
  for (const approvalId of approvalIds) {
    const initialApproval = await store.getById<any>('approval_requests', approvalId);
    if (!initialApproval || initialApproval.tenant_id !== tenantId) continue;
    await withDigitalEmployeeRunLock(tenantId, text(initialApproval.run_id), async () => {
    const approval = await store.getById<any>('approval_requests', approvalId);
    if (!approval || approval.tenant_id !== tenantId || approval.status === 'superseded') return;
    await store.update('approval_requests', approvalId, {
      status: 'superseded', decision_note: '源作品已修改，原发布审批自动失效。', decided_at: invalidatedAt,
    });
    const task = await store.getById<any>('workflow_tasks', text(approval.task_id));
    if (task?.tenant_id === tenantId && text(task.run_id) === text(approval.run_id)) {
      await store.update('workflow_tasks', task.id, {
        ...(!['cancelled', 'handed_off'].includes(text(task.status)) ? { status: 'waiting_external' } : {}),
        task_version: Number(task.task_version || 1) + 1,
        blocked_reason: '源作品已修改，需要重新完成质量检查并发起审批。', updated_at: invalidatedAt,
      });
      const run = await store.getById<any>('workflow_runs', text(task.run_id));
      if (!runExternalActionBlockedReason(run, tenantId)) {
        await store.update('workflow_runs', run.id, { status: 'waiting_external', current_controller: 'human', pause_reason: '源作品已修改，等待重新审批。' });
      }
    }
    });
  }
  return affected.length;
}
