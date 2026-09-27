import { withAdWorkerEvidence } from './workerHealth.js';
import { store } from '../storage/index.js';
import { assertAdReleaseAction } from './releasePolicy.js';
import { getPlatformAdTask, withPlatformAdTaskLock, PlatformAdTaskValidationError, PlatformAdTaskConflictError } from './tasks.js';
import { AdProviderError, validateMetaVideoInput, type MetaVideoInput } from './metaAdapter.js';
import { executeAutomaticAdAction, listAdExecutions, reconcileAdExecution } from './execution.js';
import { getConnectionCredential } from './connections.js';

export const AD_LAUNCHES = 'platform_ad_launches';
export type AdLaunchMode = 'create_paused' | 'create_and_activate';
export type AdLaunch = { id: string; tenant_id: string; taskId: string; taskVersion: number; connectionId: string; launchMode?: AdLaunchMode; meta: MetaVideoInput; status: string; createdAt: string; updatedAt: string; receipt?: unknown; error?: string };
export async function listAdLaunches(tenantId: string, taskId: string) {
  return (await store.list<AdLaunch>(AD_LAUNCHES, { where: { tenant_id: tenantId, taskId }, sort: '-createdAt', perPage: 200 })).items;
}
export async function saveAdLaunch(tenantId: string, taskId: string, input: Record<string, unknown>) {
  return withPlatformAdTaskLock(tenantId, taskId, async () => {
    const task = await getPlatformAdTask(tenantId, taskId);
    if (!task) throw new PlatformAdTaskValidationError('未找到任务');
    if (input.expectedVersion !== task.version) throw new PlatformAdTaskConflictError('计划已变更，请刷新');
    const grant = task.authorization, connectionId = String(input.connectionId || '');
    const launchMode = input.launchMode === undefined ? 'create_and_activate' : input.launchMode;
    if (launchMode !== 'create_paused' && launchMode !== 'create_and_activate') throw new PlatformAdTaskValidationError('请选择有效的托管创建方式');
    try { assertAdReleaseAction('meta', launchMode === 'create_paused' ? 'create' : 'activate'); }
    catch (error) { throw new PlatformAdTaskValidationError(error instanceof Error ? error.message : '平台执行未开放'); }
    if (task.managementMode !== 'managed' || !grant || Date.parse(grant.expiresAt) <= Date.now() || !grant.accountIds.includes(connectionId) || !grant.allowedActions.includes('create') || (launchMode === 'create_and_activate' && !grant.allowedActions.includes('activate'))) throw new PlatformAdTaskValidationError(launchMode === 'create_paused' ? '请先授权该账户自动创建广告' : '请先授权该账户自动创建和启动广告');
    const { connection } = await getConnectionCredential(tenantId, connectionId);
    if (connection.provider !== 'meta') throw new PlatformAdTaskValidationError('当前自动启动仅支持 Meta；该平台请使用人工执行');
    if (connection.status !== 'connected' || connection.currency !== task.currency) throw new PlatformAdTaskValidationError('广告账户状态或币种不满足自动启动要求');
    const existing = await listAdLaunches(tenantId, taskId);
    if (existing.some(r => !['INVALIDATED', 'BLOCKED'].includes(r.status))) throw new PlatformAdTaskValidationError('已有托管启动任务，请等待执行或核对结果');
    const meta = validateMetaVideoInput(input.meta, Math.min(task.budget, grant.maxTotalBudget), task.goal === '提升有效视频观看');
    if (meta.dailyBudget > grant.maxDailyBudget) throw new PlatformAdTaskValidationError('日预算超过托管授权');
    if (task.budget > grant.maxTotalBudget) throw new PlatformAdTaskValidationError('计划总预算超过托管授权，请调整计划预算或授权');
    const now = new Date().toISOString();
    // Keep the worker away until persistence proves the mode survived the schema.
    // Otherwise an old schema could drop create_paused and turn it into a legacy auto-launch.
    const record = await store.create<AdLaunch>(AD_LAUNCHES, { tenant_id: tenantId, taskId, taskVersion: task.version, connectionId, launchMode, meta, status: 'DRAFT', createdAt: now, updatedAt: now });
    if (!record) throw new Error('自动启动任务保存失败');
    const persisted = await store.getById<AdLaunch>(AD_LAUNCHES, record.id);
    if (!persisted || persisted.launchMode !== launchMode || persisted.status !== 'DRAFT') {
      await store.update(AD_LAUNCHES, record.id, { status: 'BLOCKED', error: '托管创建方式未正确持久化，请检查存储字段定义' });
      throw new PlatformAdTaskValidationError('托管创建方式未正确持久化，任务不会执行；请检查存储字段定义');
    }
    const updatedAt = new Date().toISOString();
    const pending = await store.update(AD_LAUNCHES, record.id, { status: 'PENDING', updatedAt });
    if (!pending) throw new Error('托管任务未能进入待执行状态');
    return { ...persisted, status: 'PENDING', updatedAt };
  });
}

export async function runAdLaunch(launch: AdLaunch) {
  return withPlatformAdTaskLock(launch.tenant_id, `launch-${launch.id}`, async () => {
    let fresh = await store.getById<AdLaunch>(AD_LAUNCHES, launch.id);
    if (!fresh || !['PENDING', 'CREATED'].includes(fresh.status)) return;
    const patch = async (values: Record<string, unknown>) => {
      if (!await store.update(AD_LAUNCHES, launch.id, { ...values, updatedAt: new Date().toISOString() })) throw new Error('托管启动记录保存失败');
    };
    try {
      assertAdReleaseAction('meta', fresh.launchMode === 'create_paused' ? 'create' : 'activate');
      const task = await getPlatformAdTask(launch.tenant_id, launch.taskId);
      if (!task || task.version !== fresh.taskVersion || task.managementMode !== 'managed') { await patch({ status: 'INVALIDATED', error: '计划或控制权已变化' }); return; }
      if (fresh.status === 'PENDING') {
        await patch({ status: 'CREATING' });
        const receipt = await executeAutomaticAdAction(launch.tenant_id, launch.taskId, { expectedVersion: fresh.taskVersion, requestId: `launch_${fresh.id}_create`, launchId: fresh.id, connectionId: fresh.connectionId, action: 'create', meta: fresh.meta });
        if (receipt.status !== 'VERIFIED') { await patch({ status: receipt.status === 'FAILED' ? 'BLOCKED' : 'UNKNOWN', receipt }); return; }
        const current = await getPlatformAdTask(launch.tenant_id, launch.taskId);
        if (!current || current.managementMode !== 'managed' || current.version !== fresh.taskVersion) { await patch({ status: 'INVALIDATED', receipt }); return; }
        await patch({ status: 'CREATED', taskVersion: current.version, receipt });
        fresh = { ...fresh, status: 'CREATED', taskVersion: current.version, receipt };
      }
      const receipts = await listAdExecutions(launch.tenant_id, launch.taskId);
      const created = receipts.find(r => r.requestId === `launch_${fresh!.id}_create` && r.status === 'VERIFIED');
      if (!created?.resourceId) { await patch({ status: 'UNKNOWN', error: '缺少已核验的创建结果' }); return; }
      if (fresh.launchMode === 'create_paused') { await patch({ status: 'PAUSED', receipt: created }); return; }
      await patch({ status: 'ACTIVATING' });
      const activated = await executeAutomaticAdAction(launch.tenant_id, launch.taskId, { expectedVersion: fresh.taskVersion, requestId: `launch_${fresh.id}_activate`, launchId: fresh.id, connectionId: fresh.connectionId, resourceId: created.resourceId, action: 'activate' });
      await patch({ status: activated.status === 'VERIFIED' ? 'ACTIVE' : activated.status === 'FAILED' ? 'BLOCKED' : 'UNKNOWN', receipt: activated });
    } catch (error) { await patch({ status: error instanceof AdProviderError && error.code === 'RELEASE_RESTRICTED' ? 'BLOCKED' : 'UNKNOWN', error: error instanceof Error ? error.message : '托管启动待核对' }); }
  });
}

export async function runAdLaunchesOnce() {
  for (const status of ['PENDING', 'CREATED']) {
    // Materialize the snapshot before changing statuses to avoid skipping paginated rows.
    const all: AdLaunch[] = [];
    for (let page = 1; ; page++) {
      const records = await store.list<AdLaunch>(AD_LAUNCHES, { where: { status }, page, perPage: 100 });
      all.push(...records.items);
      if (page >= records.totalPages) break;
    }
    for (const launch of all) {
      try { await withAdWorkerEvidence(launch.tenant_id, () => runAdLaunch(launch)); } catch (error) { console.error('[ad-launch]', error instanceof Error ? error.message : 'failed'); }
    }
  }
}

export async function reconcileAdLaunch(tenantId: string, taskId: string, launchId: string) {
  return withPlatformAdTaskLock(tenantId, `launch-${launchId}`, async () => {
    const launch = await store.getById<AdLaunch>(AD_LAUNCHES, launchId);
    if (!launch || launch.tenant_id !== tenantId || launch.taskId !== taskId) throw new PlatformAdTaskValidationError('未找到启动任务');
    if (!['CREATING', 'ACTIVATING', 'UNKNOWN'].includes(launch.status)) return launch;
    const receipts = await listAdExecutions(tenantId, taskId);
    const existing = (launch.launchMode !== 'create_paused' && receipts.find(r => r.requestId === `launch_${launchId}_activate`)) || receipts.find(r => r.requestId === `launch_${launchId}_create`);
    if (!existing) throw new PlatformAdTaskValidationError('未收到平台资源回执，需要人工核对；不会重新创建');
    const receipt = await reconcileAdExecution(tenantId, taskId, existing.id);
    const task = await getPlatformAdTask(tenantId, taskId);
    const status = !task || task.version !== launch.taskVersion || task.managementMode !== 'managed' ? 'INVALIDATED' : receipt.status === 'VERIFIED' ? receipt.action === 'create' ? launch.launchMode === 'create_paused' ? 'PAUSED' : 'CREATED' : 'ACTIVE' : receipt.status === 'FAILED' ? 'BLOCKED' : 'UNKNOWN';
    const patch = { status, receipt, updatedAt: new Date().toISOString() };
    if (!await store.update(AD_LAUNCHES, launchId, patch)) throw new Error('托管启动核对结果保存失败');
    return { ...launch, ...patch };
  });
}
