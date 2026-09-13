import { store } from '../storage/index.js';
import { getPlatformAdTask, withPlatformAdTaskLock, PlatformAdTaskValidationError, PlatformAdTaskConflictError } from './tasks.js';
import { executeApprovedAdAction, listAdExecutions, reconcileAdExecution } from './execution.js';
import { validateMetaVideoInput } from './metaAdapter.js';
import { getConnectionCredential } from './connections.js';

export const AD_APPROVALS = 'platform_ad_approvals';
export type AdApproval = { id: string; tenant_id: string; taskId: string; taskVersion: number; status: string; payload: Record<string, unknown>; createdBy: string; decidedBy?: string; createdAt: string; expiresAt: string; updatedAt: string; receipt?: unknown; error?: string };
export async function listAdApprovals(tenantId: string, taskId: string) {
  const [records, task] = await Promise.all([store.list<AdApproval>(AD_APPROVALS, { where: { tenant_id: tenantId, taskId }, sort: '-createdAt', perPage: 200 }), getPlatformAdTask(tenantId, taskId)]);
  return records.items.map(record => ({ ...record, status: record.status !== 'PENDING' ? record.status : Date.parse(record.expiresAt) <= Date.now() ? 'EXPIRED' : !task || task.version !== record.taskVersion || task.managementMode !== 'approval' ? 'INVALIDATED' : 'PENDING' }));
}
export async function createAdApproval(tenantId: string, userId: string, taskId: string, input: Record<string, unknown>) {
  return withPlatformAdTaskLock(tenantId, taskId, async () => {
    const task = await getPlatformAdTask(tenantId, taskId);
    if (!task) throw new PlatformAdTaskValidationError('未找到投放任务');
    if (task.version !== input.expectedVersion) throw new PlatformAdTaskConflictError('计划已变化，请刷新');
    const authorization = task.authorization;
    const action = String(input.action || ''), connectionId = String(input.connectionId || '');
    if (task.managementMode !== 'approval' || !authorization || Date.parse(authorization.expiresAt) <= Date.now() || !authorization.accountIds.includes(connectionId) || !authorization.allowedActions.includes(action as any)) throw new PlatformAdTaskValidationError('当前审批授权不允许此动作');
    const { connection } = await getConnectionCredential(tenantId, connectionId);
    if (connection.provider !== 'meta') throw new PlatformAdTaskValidationError('当前审批执行仅支持 Meta；该平台请使用人工执行');
    if (connection.status !== 'connected' || connection.currency !== task.currency) throw new PlatformAdTaskValidationError('广告账户状态或币种不满足审批执行要求');
    const dailyBudget = input.dailyBudget === undefined ? undefined : Number(input.dailyBudget);
    if (action === 'adjust_budget' && (!Number.isFinite(dailyBudget) || dailyBudget! < 1 || dailyBudget! > authorization.maxDailyBudget)) throw new PlatformAdTaskValidationError('日预算超出授权');
    const payload: Record<string, unknown> = { expectedVersion: task.version, action, connectionId, resourceId: String(input.resourceId || '') };
    if (dailyBudget !== undefined) payload.dailyBudget = dailyBudget;
    if (action === 'create') payload.meta = validateMetaVideoInput(input.meta, Math.min(task.budget, authorization.maxTotalBudget), task.goal === '提升有效视频观看');
    const now = new Date().toISOString();
    const record = await store.create<AdApproval>(AD_APPROVALS, { tenant_id: tenantId, taskId, taskVersion: task.version, status: 'PENDING', payload, createdBy: userId, createdAt: now, updatedAt: now, expiresAt: new Date(Math.min(Date.now() + 86400000, Date.parse(authorization.expiresAt))).toISOString() });
    if (!record) throw new Error('审批保存失败');
    return record;
  });
}
export async function decideAdApproval(tenantId: string, userId: string, taskId: string, approvalId: string, decision: unknown) {
  if (decision !== 'approve' && decision !== 'reject') throw new PlatformAdTaskValidationError('审批决定无效');
  let execute = false;
  const record = await withPlatformAdTaskLock(tenantId, taskId, async () => {
    const approval = await store.getById<AdApproval>(AD_APPROVALS, approvalId);
    if (!approval || approval.tenant_id !== tenantId || approval.taskId !== taskId) throw new PlatformAdTaskValidationError('未找到审批');
    if (approval.status !== 'PENDING') return approval;
    const task = await getPlatformAdTask(tenantId, taskId);
    const status = Date.parse(approval.expiresAt) <= Date.now() ? 'EXPIRED' : !task || task.version !== approval.taskVersion || task.managementMode !== 'approval' ? 'INVALIDATED' : decision === 'reject' ? 'REJECTED' : 'APPROVING';
    const patch = { status, decidedBy: userId, updatedAt: new Date().toISOString() };
    if (!await store.update(AD_APPROVALS, approval.id, patch)) throw new Error('审批决定保存失败');
    execute = status === 'APPROVING';
    return { ...approval, ...patch };
  });
  if (!execute) return record;
  try {
    const receipt = await executeApprovedAdAction(tenantId, taskId, { ...record.payload, requestId: `approval_${record.id}`, approvalId: record.id });
    const patch = { status: receipt.status === 'VERIFIED' ? 'EXECUTED' : receipt.status === 'FAILED' ? 'FAILED' : 'UNKNOWN', receipt, updatedAt: new Date().toISOString() };
    if (!await store.update(AD_APPROVALS, record.id, patch)) throw new Error('执行回执尚未保存到审批');
    return { ...record, ...patch };
  } catch (error) {
    // The action may have reached the provider; never advertise safe retry here.
    const patch = { status: 'UNKNOWN', error: error instanceof Error ? error.message : '审批执行待核对', updatedAt: new Date().toISOString() };
    await store.update(AD_APPROVALS, record.id, patch);
    return { ...record, ...patch };
  }
}

export async function reconcileAdApproval(tenantId: string, taskId: string, approvalId: string) {
  const approval = await store.getById<AdApproval>(AD_APPROVALS, approvalId);
  if (!approval || approval.tenant_id !== tenantId || approval.taskId !== taskId) throw new PlatformAdTaskValidationError('未找到审批');
  if (!['APPROVING', 'UNKNOWN'].includes(approval.status)) return approval;
  const existing = (await listAdExecutions(tenantId, taskId)).find(r => r.requestId === `approval_${approval.id}`);
  if (!existing) throw new PlatformAdTaskValidationError('尚无执行回执，需要人工核对；不会重新发送动作');
  const receipt = await reconcileAdExecution(tenantId, taskId, existing.id);
  const patch = { status: receipt.status === 'VERIFIED' ? 'EXECUTED' : receipt.status === 'FAILED' ? 'FAILED' : 'UNKNOWN', receipt, updatedAt: new Date().toISOString() };
  if (!await store.update(AD_APPROVALS, approval.id, patch)) throw new Error('审批核对结果保存失败');
  return { ...approval, ...patch };
}
