import { store } from '../storage/index.js';
import type { PlatformAdTask } from './tasks.js';
import type { AdConnection } from './connections.js';
import { AdProviderError } from './metaAdapter.js';
import { TikTokExecutionAdapter, validateTikTokVideoPlan, type TikTokVideoPlan, type TikTokResources } from './tiktokExecutionAdapter.js';
import type { AdExecution } from './execution.js';
/** Called only while the common task lock is held and duplicate/unknown checks passed. */
export async function executeTikTokWithinLock(tenantId: string, task: PlatformAdTask, connection: AdConnection, token: string, input: Record<string, unknown>, mode: string, receipts: Omit<AdExecution, 'tenant_id'>[]) {
  if (mode !== 'manual' || task.managementMode !== 'manual') throw new AdProviderError('TikTok 当前支持人工执行，请先人工接管；自动与审批执行尚未开放', 'NOT_SUPPORTED');
  if (connection.status !== 'connected' || connection.currency !== 'USD' || task.currency !== 'USD') throw new AdProviderError('TikTok 需有效 USD 广告账户', 'AUTH_REQUIRED');
  const action = String(input.action);
  if (!['create', 'activate', 'pause', 'resume'].includes(action)) throw new AdProviderError('TikTok 当前仅支持创建及启停', 'NOT_SUPPORTED');
  let plan: TikTokVideoPlan | null = null;
  if (action === 'create') {
    if (task.goal !== '提升有效视频观看' || task.channels.length !== 1 || task.channels[0] !== 'TikTok') throw new AdProviderError('TikTok 创建需单独的有效视频观看任务', 'UNSUPPORTED_OBJECTIVE');
    const value = input.tiktok as Record<string, unknown> | undefined;
    plan = { advertiserId: connection.accountId, name: task.name, totalBudget: task.budget, startsAt: task.configuration.startsAt, endsAt: task.configuration.endsAt, identityId: String(value?.identityId || ''), tiktokItemId: String(value?.tiktokItemId || ''), locationIds: Array.isArray(value?.locationIds) ? value.locationIds.map(String) : [], adText: String(value?.adText || '').slice(0, 100) };
    validateTikTokVideoPlan(plan);
  }
  const resourceId = String(input.resourceId || '');
  const previous = receipts.find(item => item.action === 'create' && item.connectionId === connection.id && item.resourceId === resourceId && item.status === 'VERIFIED');
  const existing = previous?.result as TikTokResources | undefined;
  if (action !== 'create' && (!existing?.campaignId || !existing.adgroupId || !existing.adId)) throw new AdProviderError('TikTok 资源未关联到此计划', 'RESOURCE_MISMATCH');
  const adapter = new TikTokExecutionAdapter(token);
  if (action === 'activate' || action === 'resume') {
    if (task.configuration.endsAt && Date.parse(task.configuration.endsAt) <= Date.now()) throw new AdProviderError('投放排期已结束', 'INVALID_INPUT');
    const actual = await adapter.read(connection.accountId, 'campaign', existing!.campaignId);
    if (actual.budget_mode !== 'BUDGET_MODE_TOTAL' || !Number(actual.budget) || Number(actual.budget) > task.budget) throw new AdProviderError('TikTok 平台预算超出任务预算', 'BUDGET_LIMIT');
  }
  const receipt = await store.create<AdExecution>('platform_ad_executions', { tenant_id: tenantId, taskId: task.id, connectionId: connection.id, requestId: input.requestId, action, resourceId, status: 'EXECUTING', createdAt: new Date().toISOString() });
  if (!receipt) throw new AdProviderError('无法持久化执行请求', 'STORAGE_ERROR');
  let accepted = false;
  const resources: Partial<TikTokResources> = { ...existing };
  const publicReceipt = (value: AdExecution) => { const { tenant_id: _tenant, ...rest } = value; return rest; };
  try {
    if (action === 'create') {
      await adapter.createPaused(plan!, async (kind, id) => {
        accepted = true; resources[kind] = id;
        if (!await store.update('platform_ad_executions', receipt.id, { status: 'PROVIDER_ACCEPTED', resourceId: resources.campaignId || '', result: resources })) throw new AdProviderError('TikTok 已创建资源，本地记录待恢复', 'STORAGE_ERROR', true);
      });
      for (const [kind, id] of [['campaign', resources.campaignId], ['adgroup', resources.adgroupId], ['ad', resources.adId]] as const) {
        const actual = await adapter.read(connection.accountId, kind, id!);
        if (actual.operation_status !== 'DISABLE') throw new AdProviderError('TikTok 暂停状态尚未确认', 'RECONCILIATION_REQUIRED', true);
      }
    } else if (action === 'pause') { await adapter.setStatus(connection.accountId, 'campaign', existing!.campaignId, 'DISABLE'); accepted = true; }
    else { accepted = true; await adapter.activate(connection.accountId, existing!); }
    const patch = { status: 'VERIFIED', resourceId: resources.campaignId!, result: { ...resources, status: action === 'create' || action === 'pause' ? 'DISABLE' : 'ENABLE' } };
    if (!await store.update('platform_ad_executions', receipt.id, patch)) throw new AdProviderError('TikTok 执行回执保存失败', 'STORAGE_ERROR', true);
    if (!await store.update('platform_ad_tasks', task.id, { status: action === 'create' || action === 'pause' ? 'paused' : 'active', updatedAt: new Date().toISOString() })) throw new AdProviderError('TikTok 计划状态待核对', 'STORAGE_ERROR', true);
    return publicReceipt({ ...receipt, ...patch });
  } catch (error) {
    const status = !accepted && error instanceof AdProviderError && !error.uncertain ? 'FAILED' : 'UNKNOWN';
    const message = error instanceof AdProviderError ? error.message : 'TikTok 执行结果待核对';
    await store.update('platform_ad_executions', receipt.id, { status, error: message, result: resources, resourceId: resources.campaignId || resourceId });
    if (status === 'UNKNOWN') await store.update('platform_ad_tasks', task.id, { status: 'unknown' });
    return publicReceipt({ ...receipt, status, error: message, result: resources, resourceId: resources.campaignId || resourceId });
  }
}
export async function reconcileTikTokWithinLock(receipt: AdExecution, connection: AdConnection, token: string) {
  const ids = receipt.result as TikTokResources | undefined;
  if (!ids?.campaignId || !ids.adgroupId || !ids.adId) throw new AdProviderError('TikTok 部分资源或未知资源需平台人工核对，不会重新创建', 'RECONCILIATION_REQUIRED');
  const adapter = new TikTokExecutionAdapter(token);
  const campaign = await adapter.read(connection.accountId, 'campaign', ids.campaignId);
  const group = await adapter.read(connection.accountId, 'adgroup', ids.adgroupId);
  const ad = await adapter.read(connection.accountId, 'ad', ids.adId);
  if (String(group.campaign_id) !== ids.campaignId || String(ad.adgroup_id) !== ids.adgroupId) throw new AdProviderError('TikTok 广告关联不一致', 'RESOURCE_MISMATCH');
  const expected = receipt.action === 'create' || receipt.action === 'pause' ? 'DISABLE' : 'ENABLE';
  if (campaign.operation_status !== expected || (receipt.action !== 'pause' && (group.operation_status !== expected || ad.operation_status !== expected))) throw new AdProviderError('TikTok 状态与目标不一致，继续保留待核对状态', 'RECONCILIATION_REQUIRED');
  const patch = { status: 'VERIFIED', resourceId: ids.campaignId, result: { ...ids, status: expected }, error: '' };
  if (!await store.update('platform_ad_executions', receipt.id, patch)) throw new AdProviderError('TikTok 对账回执保存失败', 'STORAGE_ERROR');
  await store.update('platform_ad_tasks', receipt.taskId, { status: expected === 'ENABLE' ? 'active' : 'paused', updatedAt: new Date().toISOString() });
  const { tenant_id: _tenant, ...result } = { ...receipt, ...patch }; return result;
}
