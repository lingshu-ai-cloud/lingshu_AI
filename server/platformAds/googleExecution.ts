import { store } from '../storage/index.js';
import type { PlatformAdTask } from './tasks.js';
import type { AdConnection } from './connections.js';
import type { AdExecution } from './execution.js';
import { AdProviderError } from './metaAdapter.js';
import { GoogleExecutionAdapter, demandGenOperations, type GoogleDemandGenPlan } from './googleExecutionAdapter.js';
import { GoogleAdsAdapter } from './otherAdapters.js';
type GoogleResources = { campaignId: string; budgetId: string; adgroupId: string; adId: string };
export async function executeGoogleWithinLock(tenantId: string, task: PlatformAdTask, connection: AdConnection, token: string, input: Record<string, unknown>, mode: string, receipts: Omit<AdExecution, 'tenant_id'>[]) {
  if (mode !== 'manual' || task.managementMode !== 'manual') throw new AdProviderError('Google 当前支持人工执行；自动和审批执行尚未开放', 'NOT_SUPPORTED');
  if (connection.status !== 'connected' || connection.currency !== 'USD' || task.currency !== 'USD') throw new AdProviderError('Google 需有效 USD 广告账户及 USD 任务', 'AUTH_REQUIRED');
  const action = String(input.action);
  if (!['create', 'activate', 'pause', 'resume'].includes(action)) throw new AdProviderError('Google 当前仅支持创建和启停', 'NOT_SUPPORTED');
  const adapter = new GoogleExecutionAdapter(token);
  let plan: GoogleDemandGenPlan | null = null;
  if (action === 'create') {
    if (task.goal !== '获取线索或转化' || task.channels.length !== 1 || task.channels[0] !== 'YouTube') throw new AdProviderError('Google 创建支持 YouTube Demand Gen 线索或转化目标，标准视频观看广告不支持写入', 'UNSUPPORTED_OBJECTIVE');
    const { startsAt, endsAt } = task.configuration;
    for (const value of [startsAt, endsAt]) if (!value || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new AdProviderError('Google 创建必须提供带时区的完整排期', 'INVALID_INPUT');
    if (Date.parse(startsAt) <= Date.now() || Date.parse(endsAt) <= Date.parse(startsAt)) throw new AdProviderError('Google 排期过期或无效', 'INVALID_INPUT');
    const account = await new GoogleAdsAdapter(token).search(connection.accountId, 'SELECT customer.time_zone FROM customer LIMIT 1');
    const zone = account.results?.[0]?.customer?.timeZone;
    if (!zone) throw new AdProviderError('无法读取 Google 账户时区', 'PREFLIGHT_REQUIRED');
    const localTime = (value: string) => {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
      const get = (type: string) => parts.find(part => part.type === type)!.value;
      return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
    };
    const startDateTime = localTime(startsAt), endDateTime = localTime(endsAt);
    const raw = input.google as Record<string, unknown> || {};
    plan = { customerId: connection.accountId, name: task.name, totalBudget: task.budget, targetCpa: Number(raw.targetCpa), startDate: startDateTime.slice(0, 10), endDate: endDateTime.slice(0, 10), startDateTime, endDateTime, videoAssetId: String(raw.videoAssetId || ''), logoAssetId: String(raw.logoAssetId || ''), finalUrl: String(raw.finalUrl || ''), businessName: String(raw.businessName || ''), headline: String(raw.headline || ''), longHeadline: String(raw.longHeadline || ''), description: String(raw.description || ''), locationIds: Array.isArray(raw.locationIds) ? raw.locationIds.map(String) : [] };
    demandGenOperations(plan);
  }
  const resourceId = String(input.resourceId || '');
  const previous = receipts.find(item => item.action === 'create' && item.connectionId === connection.id && item.resourceId === resourceId && item.status === 'VERIFIED');
  let resources = previous?.result as GoogleResources | undefined;
  if (action !== 'create' && (!resources?.campaignId || !resources.adgroupId || !resources.adId)) throw new AdProviderError('Google 资源未关联到当前计划', 'RESOURCE_MISMATCH');
  if (action === 'activate' || action === 'resume') {
    if (Date.parse(task.configuration.endsAt) <= Date.now()) throw new AdProviderError('Google 投放排期已结束', 'INVALID_INPUT');
    const actual = await adapter.campaign(connection.accountId, resources!.campaignId);
    if (!Number(actual.campaignBudget?.totalAmountMicros) || Number(actual.campaignBudget.totalAmountMicros) / 1e6 > task.budget) throw new AdProviderError('Google 平台总预算超出计划', 'BUDGET_LIMIT');
  }
  const receipt = await store.create<AdExecution>('platform_ad_executions', { tenant_id: tenantId, taskId: task.id, connectionId: connection.id, requestId: input.requestId, action, resourceId, status: 'EXECUTING', createdAt: new Date().toISOString() });
  if (!receipt) throw new AdProviderError('无法保存 Google 执行记录', 'STORAGE_ERROR');
  let accepted = false;
  try {
    if (action === 'create') { resources = await adapter.createPaused(plan!); accepted = true; }
    else { await adapter.setStatus(connection.accountId, resources!, action === 'pause' ? 'PAUSED' : 'ENABLED'); accepted = true; }
    if (!await store.update('platform_ad_executions', receipt.id, { status: 'PROVIDER_ACCEPTED', resourceId: resources!.campaignId, result: resources })) throw new AdProviderError('Google 已接受操作，本地回执待恢复', 'STORAGE_ERROR', true);
    const expected = action === 'create' || action === 'pause' ? 'PAUSED' : 'ENABLED';
    const actual = await adapter.verifyResources(connection.accountId, resources!);
    if (actual.campaign.status !== expected || (action !== 'pause' && (actual.adGroup.status !== expected || actual.adGroupAd.status !== expected))) throw new AdProviderError('Google 状态尚未确认', 'RECONCILIATION_REQUIRED', true);
    const patch = { status: 'VERIFIED', resourceId: resources!.campaignId, result: { ...resources, status: expected } };
    if (!await store.update('platform_ad_executions', receipt.id, patch)) throw new AdProviderError('Google 回执保存失败', 'STORAGE_ERROR', true);
    if (!await store.update('platform_ad_tasks', task.id, { status: expected === 'PAUSED' ? 'paused' : 'active', updatedAt: new Date().toISOString() })) throw new AdProviderError('Google 执行已完成，计划状态待核对', 'STORAGE_ERROR', true);
    const { tenant_id: _tenant, ...result } = { ...receipt, ...patch }; return result;
  } catch (error) {
    const status = !accepted && error instanceof AdProviderError && !error.uncertain ? 'FAILED' : 'UNKNOWN';
    const message = error instanceof AdProviderError ? error.message : 'Google 执行结果需核对';
    await store.update('platform_ad_executions', receipt.id, { status, result: resources || {}, resourceId: resources?.campaignId || resourceId, error: message });
    if (status === 'UNKNOWN') await store.update('platform_ad_tasks', task.id, { status: 'unknown' });
    const { tenant_id: _tenant, ...result } = { ...receipt, status, result: resources, resourceId: resources?.campaignId || resourceId, error: message }; return result;
  }
}
export async function reconcileGoogleWithinLock(receipt: AdExecution, connection: AdConnection, token: string) {
  const resources = receipt.result as GoogleResources | undefined;
  if (!resources?.campaignId || !resources.adgroupId || !resources.adId) throw new AdProviderError('Google 未返回完整资源，需平台人工核对；不会重新创建', 'RECONCILIATION_REQUIRED');
  const actual = await new GoogleExecutionAdapter(token).verifyResources(connection.accountId, resources);
  const expected = receipt.action === 'create' || receipt.action === 'pause' ? 'PAUSED' : 'ENABLED';
  if (actual.campaign.status !== expected || (receipt.action !== 'pause' && (actual.adGroup.status !== expected || actual.adGroupAd.status !== expected))) throw new AdProviderError('Google 平台状态不一致，继续保留待核对', 'RECONCILIATION_REQUIRED');
  const patch = { status: 'VERIFIED', resourceId: resources.campaignId, result: { ...resources, status: expected }, error: '' };
  if (!await store.update('platform_ad_executions', receipt.id, patch)) throw new AdProviderError('Google 对账结果保存失败', 'STORAGE_ERROR');
  await store.update('platform_ad_tasks', receipt.taskId, { status: expected === 'PAUSED' ? 'paused' : 'active', updatedAt: new Date().toISOString() });
  const { tenant_id: _tenant, ...result } = { ...receipt, ...patch }; return result;
}
