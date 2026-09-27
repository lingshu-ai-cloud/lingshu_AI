import { resolveAdCreativeExecution } from './creativeExecution.js';
import { store } from '../storage/index.js';
import { assertAdReleaseAction } from './releasePolicy.js';
import { getPlatformAdTask, withPlatformAdTaskLock } from './tasks.js';
import { getConnectionCredential } from './connections.js';
import { AdProviderError, MetaAdsAdapter, validateMetaVideoInput } from './metaAdapter.js';
import { executeTikTokWithinLock, reconcileTikTokWithinLock } from './tiktokExecution.js';
import { executeGoogleWithinLock, reconcileGoogleWithinLock } from './googleExecution.js';
import type { PlatformAdTaskLeaseGuard } from './taskLock.js';
export const AD_EXECUTIONS = 'platform_ad_executions';
export type AdExecution = { id: string; tenant_id: string; taskId: string; requestId: string; action: string; connectionId: string; resourceId: string; status: string; createdAt: string; result?: unknown; error?: string; expectedDailyBudget?: number };
const publicReceipt = ({ tenant_id: _tenant, ...receipt }: AdExecution) => receipt;
export async function listAdExecutions(tenantId: string, taskId: string) {
  return (await store.list<AdExecution>(AD_EXECUTIONS, { where: { tenant_id: tenantId, taskId }, sort: '-createdAt', perPage: 200 })).items.map(publicReceipt);
}
export async function executeAdAction(tenantId: string, taskId: string, input: Record<string, unknown>) {
  return execute(tenantId, taskId, input, 'manual');
}
export async function executeAutomaticAdAction(tenantId: string, taskId: string, input: Record<string, unknown>) {
  return execute(tenantId, taskId, input, 'automatic');
}
export async function executeApprovedAdAction(tenantId: string, taskId: string, input: Record<string, unknown>) {
  return execute(tenantId, taskId, input, 'approved');
}
async function execute(tenantId: string, taskId: string, input: Record<string, unknown>, mode: 'manual' | 'automatic' | 'approved') {
  const automatic = mode === 'automatic';
  return withPlatformAdTaskLock(tenantId, taskId, async (leaseGuard: PlatformAdTaskLeaseGuard) => {
    const task = await getPlatformAdTask(tenantId, taskId);
    if (!task) throw new AdProviderError('未找到投放任务', 'NOT_FOUND');
    if (task.creationSource === 'platform_import') throw new AdProviderError('导入计划当前仅支持查看，尚未建立可执行资源绑定', 'NOT_SUPPORTED');
    const requestId = String(input.requestId || '');
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw new AdProviderError('请提供唯一操作请求 ID', 'INVALID_INPUT');
    const previous = (await store.list<AdExecution>(AD_EXECUTIONS, { where: { tenant_id: tenantId, taskId, requestId } })).items[0];
    if (previous) return publicReceipt(previous);
    if (Number(input.expectedVersion) !== task.version) throw new AdProviderError('计划已变化，请刷新后重试', 'VERSION_CONFLICT');
    const action = String(input.action || '');
    if (!['create', 'activate', 'pause', 'resume', 'adjust_budget'].includes(action)) throw new AdProviderError('不支持该投放动作', 'INVALID_INPUT');
    const allReceipts = await listAdExecutions(tenantId, taskId);
    if (allReceipts.some(receipt => ['EXECUTING', 'PROVIDER_ACCEPTED', 'UNKNOWN'].includes(receipt.status))) throw new AdProviderError('存在待核对操作，请完成平台对账后再执行', 'RECONCILIATION_REQUIRED');
    if (action === 'create' && allReceipts.some(receipt => receipt.action === 'create' && receipt.status !== 'FAILED')) throw new AdProviderError('该任务已创建广告，请管理已有广告或建立独立预算任务', 'ALREADY_CREATED');
    const connectionId = String(input.connectionId || '');
    const { connection, accessToken } = await getConnectionCredential(tenantId, connectionId);
    assertAdReleaseAction(connection.provider, action);
    if (input.creativeId && (connection.provider !== 'meta' || action !== 'create' || mode !== 'manual')) throw new AdProviderError('绑定成片当前仅用于 Meta 人工创建', 'NOT_SUPPORTED');
    if (connection.provider === 'tiktok') return executeTikTokWithinLock(tenantId, task, connection, accessToken, input, mode, allReceipts, leaseGuard);
    if (connection.provider === 'google') return executeGoogleWithinLock(tenantId, task, connection, accessToken, input, mode, allReceipts, leaseGuard);
    if (connection.provider !== 'meta') throw new AdProviderError('此平台执行适配尚未开放', 'NOT_SUPPORTED');
    if (connection.status !== 'connected') throw new AdProviderError('账户受限，请重新验证账户', 'AUTH_REQUIRED');
    if (task.currency !== connection.currency) throw new AdProviderError('任务与广告账户币种不一致', 'CURRENCY_MISMATCH');
    if (!['USD', 'CNY'].includes(connection.currency)) throw new AdProviderError('Meta 执行目前仅支持 USD 或 CNY 账户', 'UNSUPPORTED_CURRENCY');
    // Requests originate from authenticated users. Automated workers must use a separate entry
    // point that validates persisted authorization; never accept an "automatic" client flag.
    if (mode === 'manual' && task.managementMode !== 'manual') throw new AdProviderError('请先人工接管计划，再执行人工操作', 'MANAGEMENT_CONFLICT');
    if (mode === 'approved') {
      const approval = await store.getById<any>('platform_ad_approvals', String(input.approvalId || ''));
      const payload = approval?.payload;
      const matches = payload && Object.keys(payload).every(key => JSON.stringify(payload[key]) === JSON.stringify(input[key])) && Object.keys(input).every(key => key === 'approvalId' || key === 'requestId' || Object.hasOwn(payload, key)) && input.requestId === `approval_${approval.id}`;
      const grant = task.authorization;
      if (!approval || approval.tenant_id !== tenantId || approval.taskId !== taskId || approval.status !== 'APPROVING' || approval.taskVersion !== task.version || !approval.decidedBy || Date.parse(approval.expiresAt) <= Date.now() || !matches || task.managementMode !== 'approval' || !grant || Date.parse(grant.expiresAt) <= Date.now() || !grant.accountIds.includes(connectionId) || !grant.allowedActions.includes(action as any)) throw new AdProviderError('审批内容或授权已变化', 'APPROVAL_REQUIRED');
    }
    if (automatic) {
      if (action === 'create' || action === 'activate') {
        const launch = await store.getById<any>('platform_ad_launches', String(input.launchId || ''));
        if (action === 'activate' && launch?.launchMode === 'create_paused') throw new AdProviderError('此托管任务仅允许创建暂停广告，禁止自动启用', 'LAUNCH_CHANGED');
        if (!launch || launch.tenant_id !== tenantId || launch.taskId !== taskId || launch.taskVersion !== task.version || launch.connectionId !== connectionId || launch.status !== (action === 'create' ? 'CREATING' : 'ACTIVATING') || (action === 'create' && JSON.stringify(launch.meta) !== JSON.stringify(input.meta)) || input.requestId !== `launch_${launch.id}_${action}`) throw new AdProviderError('自动启动配置已变更', 'LAUNCH_CHANGED');
      } else {
        const rule = await store.getById<any>('platform_ad_automation_rules', String(input.automationRuleId || ''));
        if (!rule || rule.tenant_id !== tenantId || rule.taskId !== taskId || rule.connectionId !== connectionId || rule.resourceId !== String(input.resourceId || '') || !rule.enabled || rule.updatedAt !== input.automationRuleUpdatedAt) throw new AdProviderError('自动规则已停用或变更', 'RULE_CHANGED');
      }
      const grant = task.authorization;
      if (task.managementMode !== 'managed' || !grant || Date.parse(grant.expiresAt) <= Date.now() || !grant.accountIds.includes(connectionId) || !grant.allowedActions.includes(action as any)) throw new AdProviderError('托管授权不允许此操作', 'AUTHORIZATION_REQUIRED');
      if (!['create', 'activate', 'pause', 'adjust_budget'].includes(action)) throw new AdProviderError('自动执行不支持该动作', 'NOT_SUPPORTED');
    }
    const resourceId = String(input.resourceId || '');
    if (action !== 'create') {
      if (!/^\d+$/.test(resourceId)) throw new AdProviderError('缺少广告资源 ID', 'INVALID_INPUT');
      const receipts = await listAdExecutions(tenantId, taskId);
      if (!receipts.some(r => r.connectionId === connectionId && r.resourceId === resourceId && r.status === 'VERIFIED')) throw new AdProviderError('该资源尚未关联到当前计划', 'RESOURCE_MISMATCH');
    }
    const creativeInput = action === 'create' ? await resolveAdCreativeExecution(tenantId, task, connection, input, mode) : { meta: input.meta, evidence: {} };
    const metaInput = action === 'create' ? validateMetaVideoInput(creativeInput.meta, task.budget, task.goal === '提升有效视频观看') : null;
    if (action === 'create' || action === 'activate' || action === 'resume') {
      const { startsAt, endsAt } = task.configuration;
      for (const date of [startsAt, endsAt]) if (date && (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(date) || !Number.isFinite(Date.parse(date)))) throw new AdProviderError('投放排期无效', 'INVALID_INPUT');
      if (endsAt && Date.parse(endsAt) <= Date.now()) throw new AdProviderError('投放结束时间已过期', 'INVALID_INPUT');
      if (action === 'create' && startsAt && Date.parse(startsAt) <= Date.now()) throw new AdProviderError('开始时间已过期，请更新投放排期', 'INVALID_INPUT');
    }
    if (mode !== 'manual' && metaInput && (metaInput.dailyBudget > task.authorization!.maxDailyBudget || task.budget > task.authorization!.maxTotalBudget)) throw new AdProviderError('创建预算超出授权', 'BUDGET_LIMIT');
    if (action === 'create' && !['提升网站访问', '提升有效视频观看'].includes(task.goal)) throw new AdProviderError('当前 Meta 视频创编支持网站访问或有效视频观看目标', 'UNSUPPORTED_OBJECTIVE');
    if (action === 'create' && task.channels.some(channel => !['Facebook', 'Instagram'].includes(channel))) throw new AdProviderError('当前真实创建仅支持 Meta 渠道，请为其他平台单独建立投放任务', 'UNSUPPORTED_CHANNEL');
    const prior = action === 'create' ? null : (await listAdExecutions(tenantId, taskId)).find(r => r.action === 'create' && r.connectionId === connectionId && r.resourceId === resourceId && r.status === 'VERIFIED');
    const resources = (prior?.result || {}) as Record<string, string>;
    if (action !== 'create' && (!resources.adsetId || !resources.adId)) throw new AdProviderError('完整广告组和广告尚未关联，无法执行', 'PREFLIGHT_REQUIRED');
    const dailyBudget = Number(input.dailyBudget);
    if (action === 'adjust_budget' && (!Number.isFinite(dailyBudget) || dailyBudget < 1 || dailyBudget > task.budget)) throw new AdProviderError('日预算必须在任务预算范围内', 'INVALID_INPUT');
    const adapter = new MetaAdsAdapter(accessToken, fetch, () => leaseGuard.beforeEffect());
    if (action === 'activate' || action === 'resume') {
      const campaignBudget = await adapter.request(resourceId, { fields: 'spend_cap' });
      const adsetBudget = await adapter.request(resources.adsetId, { fields: 'daily_budget' });
      const totalLimit = mode === 'manual' ? task.budget : Math.min(task.budget, task.authorization!.maxTotalBudget);
      const dailyLimit = mode === 'manual' ? task.budget : task.authorization!.maxDailyBudget;
      if (!Number(campaignBudget.spend_cap) || Number(campaignBudget.spend_cap) / 100 > totalLimit || !Number(adsetBudget.daily_budget) || Number(adsetBudget.daily_budget) / 100 > dailyLimit) throw new AdProviderError('平台预算已变化或超出当前授权，请先核对预算', 'BUDGET_LIMIT');
    }
    if (mode !== 'manual' && action === 'adjust_budget') {
      const grant = task.authorization!;
      const current = await adapter.request(resources.adsetId, { fields: 'daily_budget' });
      const previousBudget = Number(current.daily_budget) / 100;
      if (!Number.isFinite(previousBudget) || previousBudget <= 0 || Number(input.expectedDailyBudget) !== previousBudget) throw new AdProviderError('平台预算已变化，请重新分析', 'EXTERNAL_CHANGE');
      if (dailyBudget > grant.maxDailyBudget || Math.abs(dailyBudget - previousBudget) / previousBudget * 100 > grant.maxAdjustmentPercent + 0.001) throw new AdProviderError('预算调整超出托管授权', 'BUDGET_LIMIT');
      const insights = await adapter.request(`${resourceId}/insights`, { fields: 'spend', date_preset: 'maximum' });
      const spend = Number(insights.data?.[0]?.spend);
      if (!Number.isFinite(spend)) throw new AdProviderError('缺少真实累计消耗，暂不调整', 'METRICS_REQUIRED');
      if (spend >= grant.maxTotalBudget) throw new AdProviderError('已达到授权总预算', 'BUDGET_LIMIT');
      const campaign = await adapter.request(resourceId, { fields: 'spend_cap' });
      if (!Number(campaign.spend_cap) || Number(campaign.spend_cap) / 100 > grant.maxTotalBudget) throw new AdProviderError('平台总预算上限高于授权额度，需人工调整', 'BUDGET_LIMIT');
    }
    const now = new Date().toISOString();
    await leaseGuard.beforeEffect();
    const receipt = await store.create<AdExecution>(AD_EXECUTIONS, { tenant_id: tenantId, taskId, requestId, action, connectionId, resourceId, status: 'EXECUTING', createdAt: now, ...(action === 'create' ? { result: creativeInput.evidence } : {}), expectedDailyBudget: action === 'adjust_budget' ? dailyBudget : 0 });
    if (!receipt) throw new AdProviderError('无法保存执行记录，未发起操作', 'STORAGE_ERROR');
    let accepted = false;
    const createdResources: Record<string, string> = { ...creativeInput.evidence };
    try {
      let result: any;
      let actualId = resourceId;
      if (action === 'create') {
        result = await adapter.createPausedVideoTraffic(connection.accountId, task.name, metaInput!, task.budget, async (kind, id) => {
          accepted = true;
          createdResources[kind] = id;
          if (!await store.update(AD_EXECUTIONS, receipt.id, { result: createdResources, resourceId: createdResources.campaignId || '', status: 'PROVIDER_ACCEPTED' })) throw new AdProviderError('平台资源已创建，本地记录待恢复', 'STORAGE_ERROR', true);
        }, task.goal === '提升有效视频观看', task.channels, task.configuration);
        actualId = String(result.campaignId || '');
        if (!/^\d+$/.test(actualId)) throw new AdProviderError('未收到有效平台资源 ID', 'INVALID_RESPONSE', true);
      } else if (action === 'pause') result = await adapter.setCampaignStatus(connection.accountId, resourceId, 'PAUSED');
      else if (action === 'activate' || action === 'resume') {
        // Keep the parent paused until both children are enabled.
        await adapter.setCampaignStatus(connection.accountId, resources.adId, 'ACTIVE'); accepted = true;
        await adapter.setCampaignStatus(connection.accountId, resources.adsetId, 'ACTIVE');
        result = await adapter.setCampaignStatus(connection.accountId, resourceId, 'ACTIVE');
      } else result = await adapter.setDailyBudget(connection.accountId, resources.adsetId, Math.round(dailyBudget * 100));
      accepted = true;
      // Persist accepted ID before readback so uncertain writes remain recoverable.
      if (!await store.update(AD_EXECUTIONS, receipt.id, { resourceId: actualId, status: 'PROVIDER_ACCEPTED' })) throw new AdProviderError('平台已接受操作，但本地保存失败', 'STORAGE_ERROR', true);
      const verified = await adapter.request(action === 'adjust_budget' ? resources.adsetId : actualId, { fields: action === 'adjust_budget' ? 'id,status,daily_budget' : 'id,status' });
      if (action === 'create') {
        const adset = await adapter.request(createdResources.adsetId, { fields: 'daily_budget,status' });
        if (Number(adset.daily_budget) !== Math.round(metaInput!.dailyBudget * 100) || adset.status !== 'PAUSED') throw new AdProviderError('广告组预算或暂停状态尚未确认', 'RECONCILIATION_REQUIRED', true);
        verified.daily_budget = adset.daily_budget;
      }
      if ((action === 'create' || action === 'pause') && verified.status !== 'PAUSED') throw new AdProviderError('平台状态尚未确认', 'RECONCILIATION_REQUIRED', true);
      if (action === 'adjust_budget' && Number(verified.daily_budget) !== Math.round(dailyBudget * 100)) throw new AdProviderError('平台预算尚未确认', 'RECONCILIATION_REQUIRED', true);
      if ((action === 'activate' || action === 'resume') && verified.status !== 'ACTIVE') throw new AdProviderError('平台启用状态尚未确认', 'RECONCILIATION_REQUIRED', true);
      const patch = { status: 'VERIFIED', resourceId: actualId, result: { ...(action === 'create' ? createdResources : resources), id: actualId, status: verified.status, dailyBudgetMinor: verified.daily_budget || null } };
      if (!await store.update(AD_EXECUTIONS, receipt.id, patch)) throw new AdProviderError('平台执行完成，但回执保存失败', 'STORAGE_ERROR', true);
      if (action !== 'adjust_budget' && !await store.update('platform_ad_tasks', taskId, { status: action === 'create' || action === 'pause' ? 'paused' : 'active', updatedAt: new Date().toISOString() })) throw new AdProviderError('平台执行完成，计划状态待核对', 'STORAGE_ERROR', true);
      return publicReceipt({ ...receipt, ...patch });
    } catch (error) {
      const status = !accepted && error instanceof AdProviderError && !error.uncertain ? 'FAILED' : 'UNKNOWN';
      const message = error instanceof AdProviderError ? error.message : '执行结果需要核对';
      await store.update(AD_EXECUTIONS, receipt.id, { status, error: message });
      if (status === 'UNKNOWN') await store.update('platform_ad_tasks', taskId, { status: 'unknown', updatedAt: new Date().toISOString() });
      return publicReceipt({ ...receipt, resourceId: createdResources.campaignId || resourceId, result: createdResources, status, error: message });
    }
  });
}
export async function reconcileAdExecution(tenantId: string, taskId: string, executionId: string) {
  return withPlatformAdTaskLock(tenantId, taskId, async () => {
    const receipt = await store.getById<AdExecution>(AD_EXECUTIONS, executionId);
    if (!receipt || receipt.tenant_id !== tenantId || receipt.taskId !== taskId) throw new AdProviderError('未找到执行记录', 'NOT_FOUND');
    if (!['UNKNOWN', 'EXECUTING', 'PROVIDER_ACCEPTED'].includes(receipt.status)) return publicReceipt(receipt);
    const { connection, accessToken } = await getConnectionCredential(tenantId, receipt.connectionId);
    if (connection.provider === 'tiktok') return reconcileTikTokWithinLock(receipt, connection, accessToken);
    if (connection.provider === 'google') return reconcileGoogleWithinLock(receipt, connection, accessToken);
    const adapter = new MetaAdsAdapter(accessToken);
    const createReceipt = receipt.action === 'create' ? receipt : (await listAdExecutions(tenantId, taskId)).find(item => item.action === 'create' && item.resourceId === receipt.resourceId && item.status === 'VERIFIED');
    const resources = (createReceipt?.result || {}) as Record<string, string>;
    if (!resources.campaignId || !resources.adsetId || !resources.adId || !resources.creativeId) throw new AdProviderError('仅创建了部分资源或资源 ID 未收到，需平台人工核对；不会重新创建', 'RECONCILIATION_REQUIRED');
    await adapter.assertOwnership(connection.accountId, resources.campaignId);
    const campaign = await adapter.request(resources.campaignId, { fields: 'id,status' });
    const actualAdset = await adapter.request(resources.adsetId, { fields: 'id,account_id,campaign_id,status,daily_budget' });
    const actualAd = await adapter.request(resources.adId, { fields: 'id,account_id,adset_id,status,creative' });
    const actualCreative = await adapter.request(resources.creativeId, { fields: 'id,account_id' });
    if ([actualAdset, actualAd, actualCreative].some(item => String(item.account_id) !== connection.accountId) || String(actualAdset.campaign_id) !== resources.campaignId || String(actualAd.adset_id) !== resources.adsetId || String(actualAd.creative?.id) !== resources.creativeId) throw new AdProviderError('平台资源归属或关联不一致', 'RESOURCE_MISMATCH');
    let matches = false;
    if (receipt.action === 'create') matches = campaign.status === 'PAUSED' && actualAdset.status === 'PAUSED' && actualAd.status === 'PAUSED';
    if (receipt.action === 'pause') matches = campaign.status === 'PAUSED';
    if (receipt.action === 'activate' || receipt.action === 'resume') {
      const adset = await adapter.request(resources.adsetId, { fields: 'status' });
      const ad = await adapter.request(resources.adId, { fields: 'status' });
      matches = campaign.status === 'ACTIVE' && adset.status === 'ACTIVE' && ad.status === 'ACTIVE';
    }
    if (receipt.action === 'adjust_budget') {
      const adset = await adapter.request(resources.adsetId, { fields: 'daily_budget' });
      matches = Boolean(receipt.expectedDailyBudget) && Number(adset.daily_budget) === Math.round(receipt.expectedDailyBudget! * 100);
    }
    if (!matches) throw new AdProviderError('平台实际状态与目标不一致，继续保留待核对状态', 'RECONCILIATION_REQUIRED');
    const patch = { status: 'VERIFIED', resourceId: resources.campaignId, result: { ...resources, status: campaign.status, dailyBudgetMinor: actualAdset.daily_budget }, error: '' };
    if (!await store.update(AD_EXECUTIONS, executionId, patch)) throw new AdProviderError('对账结果保存失败', 'STORAGE_ERROR');
    await store.update('platform_ad_tasks', taskId, { status: campaign.status === 'ACTIVE' ? 'active' : 'paused', updatedAt: new Date().toISOString() });
    return publicReceipt({ ...receipt, ...patch });
  });
}
