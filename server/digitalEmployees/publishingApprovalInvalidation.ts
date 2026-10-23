import { store } from '../storage/index.js';
import { runExternalActionBlockedReason, withDigitalEmployeeRunLock } from './runControl.js';

export const text = (value: unknown): string => String(value ?? '').trim();

export const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function tenantPosts(tenantId: string): Promise<any[]> {
  const posts: any[] = [];
  for (let page = 1; ; page += 1) {
    const result = await store.list<any>('posts', { where: { tenant_id: tenantId }, page, perPage: 500 });
    posts.push(...result.items);
    if (page >= result.totalPages || !result.items.length) return posts;
  }
}

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
