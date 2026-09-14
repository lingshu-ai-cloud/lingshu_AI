import { createHash } from 'node:crypto';
import { store } from '../storage/index.js';
import { getConnectionCredential } from './connections.js';
import { AdProviderError, MetaAdsAdapter } from './metaAdapter.js';
import { GoogleAdsAdapter, TikTokAdsAdapter } from './otherAdapters.js';
import { getPlatformAdTask, PLATFORM_AD_TASKS_COLLECTION, withPlatformAdTaskLock, type PlatformAdTask } from './tasks.js';
import { emptyAdPlanConfiguration } from '../../src/lib/platformAdsDomain.js';

export const AD_IMPORTS = 'platform_ad_imports';
export type AdImport = { id: string; tenant_id: string; provider: string; accountId: string; connectionId: string; campaignId: string; taskId: string; status: string; capability: 'read_only'; providerSnapshot: Record<string, unknown>; createdAt: string; updatedAt: string };
export async function listAdImports(tenantId: string, taskId?: string) {
  return (await store.list<AdImport>(AD_IMPORTS, { where: { tenant_id: tenantId, ...(taskId ? { taskId } : {}) }, sort: '-createdAt', perPage: 200 })).items;
}

async function fetchCampaign(provider: string, accountId: string, accessToken: string, campaignId: string) {
  if (provider === 'meta') {
    const adapter = new MetaAdsAdapter(accessToken);
    const campaign = await adapter.request(campaignId, { fields: 'id,account_id,name,status,effective_status,objective,daily_budget,lifetime_budget,spend_cap' });
    if (String(campaign.id) !== campaignId || String(campaign.account_id) !== accountId.replace(/^act_/, '')) throw new AdProviderError('广告系列不属于当前账户', 'ACCOUNT_MISMATCH');
    return { name: String(campaign.name || campaignId), status: String(campaign.status || ''), objective: String(campaign.objective || ''), dailyBudget: campaign.daily_budget ? Number(campaign.daily_budget) / 100 : null, totalBudget: campaign.spend_cap ? Number(campaign.spend_cap) / 100 : campaign.lifetime_budget ? Number(campaign.lifetime_budget) / 100 : null, snapshot: campaign as Record<string, unknown> };
  }
  if (provider === 'tiktok') {
    const adapter = new TikTokAdsAdapter(accessToken);
    await adapter.account(accountId);
    const data = await adapter.get('campaign/get/', { advertiser_id: accountId, filtering: { campaign_ids: [campaignId] }, page_size: 100 });
    const campaign = data.list?.find((item: any) => String(item.campaign_id) === campaignId);
    if (!campaign || (campaign.advertiser_id && String(campaign.advertiser_id) !== accountId)) throw new AdProviderError('广告系列不属于当前账户', 'ACCOUNT_MISMATCH');
    return { name: String(campaign.campaign_name || campaignId), status: String(campaign.operation_status || ''), objective: String(campaign.objective_type || ''), dailyBudget: campaign.budget_mode === 'BUDGET_MODE_DAY' ? Number(campaign.budget) : null, totalBudget: campaign.budget_mode === 'BUDGET_MODE_TOTAL' ? Number(campaign.budget) : null, snapshot: campaign as Record<string, unknown> };
  }
  if (provider === 'google') {
    const adapter = new GoogleAdsAdapter(accessToken);
    await adapter.account(accountId);
    const data = await adapter.search(accountId, `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`);
    const row = data.results?.find((item: any) => String(item.campaign?.id) === campaignId);
    if (!row) throw new AdProviderError('广告系列不属于当前客户账户', 'ACCOUNT_MISMATCH');
    if (row.campaign.advertisingChannelType !== 'VIDEO') throw new AdProviderError('当前仅导入 Google 视频广告系列，其他广告类型尚未映射', 'NOT_SUPPORTED');
    return { name: String(row.campaign.name || campaignId), status: String(row.campaign.status || ''), objective: String(row.campaign.advertisingChannelType || ''), dailyBudget: row.campaignBudget?.amountMicros ? Number(row.campaignBudget.amountMicros) / 1_000_000 : null, totalBudget: null, snapshot: row as Record<string, unknown> };
  }
  throw new AdProviderError('当前平台尚不支持导入', 'NOT_SUPPORTED');
}

/** Read-only platform import. It does not manufacture execution receipts or grant control. */
export async function importPlatformAdCampaign(tenantId: string, userId: string, connectionId: string, input: Record<string, unknown>) {
  const campaignId = String(input.campaignId || '');
  if (!/^\d{1,30}$/.test(campaignId)) throw new AdProviderError('广告系列 ID 无效', 'INVALID_INPUT');
  const { connection, accessToken } = await getConnectionCredential(tenantId, connectionId);
  if (connection.currency !== 'USD' && !(connection.provider === 'meta' && connection.currency === 'CNY')) throw new AdProviderError('当前仅支持 USD 及 Meta CNY 账户导入；不进行币种转换', 'CURRENCY_MISMATCH');
  const key = `${tenantId}|${connection.provider}|${connection.accountId}|${campaignId}`;
  const taskId = createHash('sha256').update(`task:${key}`).digest('hex').slice(0, 15);
  const importId = createHash('sha256').update(`import:${key}`).digest('hex').slice(0, 15);
  return withPlatformAdTaskLock(tenantId, `import-${importId}`, async () => {
    // Refresh ownership on every attempt, including an otherwise idempotent retry.
    const campaign = await fetchCampaign(connection.provider, connection.accountId, accessToken, campaignId);
    const existing = await store.getById<AdImport>(AD_IMPORTS, importId);
    if (existing && (existing.tenant_id !== tenantId || existing.accountId !== connection.accountId || existing.campaignId !== campaignId || existing.provider !== connection.provider)) throw new AdProviderError('导入映射冲突', 'IMPORT_CONFLICT');
    const knownTask = await getPlatformAdTask(tenantId, taskId);
    if (existing?.status === 'IMPORTED' && knownTask) return { task: knownTask, import: existing, reused: true };
    const now = new Date().toISOString();
    const mapping = { tenant_id: tenantId, provider: connection.provider, accountId: connection.accountId, connectionId, campaignId, taskId, status: 'PENDING', capability: 'read_only' as const, providerSnapshot: campaign.snapshot, createdAt: existing?.createdAt || now, updatedAt: now };
    if (!existing && !await store.create(AD_IMPORTS, { id: importId, ...mapping })) throw new AdProviderError('导入映射保存失败', 'STORAGE_ERROR');
    const positive = (value: number | null) => value !== null && Number.isFinite(value) && value > 0 ? value : null;
    const dailyBudget = positive(campaign.dailyBudget), totalBudget = positive(campaign.totalBudget);
    const status: PlatformAdTask['status'] = ['ACTIVE', 'ENABLE', 'ENABLED'].includes(campaign.status) ? 'active' : ['PAUSED', 'DISABLE', 'DISABLED'].includes(campaign.status) ? 'paused' : 'unknown';
    if (!knownTask) {
      const created = await store.create(PLATFORM_AD_TASKS_COLLECTION, {
        id: taskId, tenant_id: tenantId, created_by: userId, name: campaign.name.slice(0, 80), video: '平台已有素材（待同步）', market: '平台定向（待同步）',
        goal: `平台目标：${campaign.objective || '未提供'}`, budget: totalBudget || 0, currency: connection.currency, channels: connection.provider === 'meta' ? ['Facebook', 'Instagram'] : connection.provider === 'tiktok' ? ['TikTok'] : ['YouTube'],
        creationSource: 'platform_import', managementMode: 'manual', version: 1, authorization: null, proposal: null, sourceContext: null, managementHistory: [],
        configuration: { ...emptyAdPlanConfiguration, dailyBudget }, status, createdAt: now, updatedAt: now,
      });
      if (!created) throw new AdProviderError('导入任务保存失败，可安全重试同一广告系列', 'STORAGE_ERROR');
    } else if (knownTask.creationSource !== 'platform_import') throw new AdProviderError('导入任务 ID 冲突', 'IMPORT_CONFLICT');
    if (!await store.update(AD_IMPORTS, importId, { ...mapping, status: 'IMPORTED' })) throw new AdProviderError('导入已保存，映射待恢复；请重试同一广告系列', 'STORAGE_ERROR');
    return { task: await getPlatformAdTask(tenantId, taskId), import: { id: importId, ...mapping, status: 'IMPORTED' }, reused: Boolean(knownTask) };
  });
}
