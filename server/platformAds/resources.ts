import { createHash, randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import type { PlatformAdResource, PlatformAdResourceLevel, PlatformAdResourceSyncResult } from '../../shared/platformAdResources.js';
import { AD_CONNECTIONS, getConnection, getConnectionCredential } from './connections.js';
import { AdProviderError, MetaAdsAdapter } from './metaAdapter.js';
import { withPlatformAdTaskLock } from './taskLock.js';

const collections: Record<PlatformAdResourceLevel, string> = {
  campaign: 'platform_ad_campaigns',
  adset: 'platform_ad_adsets',
  ad: 'platform_ad_ads',
};
const fields: Record<PlatformAdResourceLevel, string> = {
  campaign: 'id,account_id,name,objective,status,effective_status,daily_budget,lifetime_budget,budget_remaining,buying_type,special_ad_categories,start_time,stop_time',
  adset: 'id,account_id,campaign_id,name,status,effective_status,daily_budget,lifetime_budget,start_time,end_time,optimization_goal,billing_event,bid_strategy,destination_type,targeting,attribution_spec,promoted_object',
  ad: 'id,account_id,campaign_id,adset_id,name,status,effective_status,creative,tracking_specs,conversion_domain',
};
const edges: Record<PlatformAdResourceLevel, string> = { campaign: 'campaigns', adset: 'adsets', ad: 'ads' };

type MetaPage = { data?: unknown[]; paging?: { cursors?: { after?: unknown }; next?: unknown } };
type Dependencies = {
  dataStore: DataStore;
  credential: typeof getConnectionCredential;
  connection: typeof getConnection;
  adapter: (token: string) => Pick<MetaAdsAdapter, 'request'>;
  lock: typeof withPlatformAdTaskLock;
  now: () => Date;
};

const text = (value: unknown, max = 500) => String(value ?? '').slice(0, max);
const recordId = (tenantId: string, connectionId: string, level: PlatformAdResourceLevel, providerId: string, syncRunId: string) =>
  createHash('sha256').update(JSON.stringify([tenantId, connectionId, level, providerId, syncRunId])).digest('hex').slice(0, 15);

function normalize(input: unknown, level: PlatformAdResourceLevel, identity: { tenantId: string; connectionId: string; accountId: string; currency: string; timezone: string; syncedAt: string; syncRunId: string }): PlatformAdResource & { tenant_id: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AdProviderError('Meta 广告资源格式无效', 'INVALID_RESPONSE');
  const item = input as Record<string, unknown>;
  const providerResourceId = text(item.id, 100);
  const accountId = text(item.account_id, 100).replace(/^act_/, '');
  if (!/^\d+$/.test(providerResourceId) || accountId !== identity.accountId) throw new AdProviderError('Meta 广告资源归属异常', 'ACCOUNT_MISMATCH');
  const campaignId = level === 'campaign' ? providerResourceId : text(item.campaign_id, 100);
  const adsetId = level === 'ad' ? text(item.adset_id, 100) : '';
  if (!/^\d+$/.test(campaignId) || (level === 'ad' && !/^\d+$/.test(adsetId))) throw new AdProviderError('Meta 广告资源层级不完整', 'INVALID_RESPONSE');
  return {
    id: recordId(identity.tenantId, identity.connectionId, level, providerResourceId, identity.syncRunId), tenant_id: identity.tenantId,
    provider: 'meta', connectionId: identity.connectionId, accountId: identity.accountId, providerResourceId, level,
    parentResourceId: level === 'campaign' ? '' : level === 'adset' ? campaignId : adsetId,
    campaignId, adsetId, name: text(item.name, 500), configuredStatus: text(item.status, 50), effectiveStatus: text(item.effective_status, 50),
    currency: identity.currency, accountTimezone: identity.timezone, providerSnapshot: structuredClone(item), syncRunId: identity.syncRunId, lastSyncedAt: identity.syncedAt,
  };
}

export function createPlatformAdResourceService(deps: Dependencies) {
  async function readAll(adapter: Pick<MetaAdsAdapter, 'request'>, accountId: string, level: PlatformAdResourceLevel) {
    const rows: unknown[] = [];
    let after = '';
    for (let page = 0; page < 100; page += 1) {
      const result = await adapter.request(`act_${accountId}/${edges[level]}`, { fields: fields[level], limit: 100, after: after || undefined }) as MetaPage;
      if (!Array.isArray(result.data)) throw new AdProviderError('Meta 广告资源列表无法解析', 'INVALID_RESPONSE');
      rows.push(...result.data);
      const next = text(result.paging?.cursors?.after, 500);
      if (!result.paging?.next) return rows;
      if (!next || next === after) throw new AdProviderError('Meta 广告资源分页游标异常', 'INVALID_RESPONSE');
      after = next;
    }
    throw new AdProviderError('Meta 广告资源超过同步上限，请缩小账户范围', 'RESULT_TOO_LARGE');
  }

  async function save(resource: PlatformAdResource & { tenant_id: string }) {
    const collection = collections[resource.level];
    const existing = await deps.dataStore.getById<PlatformAdResource & { tenant_id: string }>(collection, resource.id);
    if (existing && (existing.tenant_id !== resource.tenant_id || existing.connectionId !== resource.connectionId || existing.providerResourceId !== resource.providerResourceId)) throw new AdProviderError('广告资源映射冲突', 'STORAGE_ERROR');
    const written = existing ? await deps.dataStore.update(collection, resource.id, resource) : await deps.dataStore.create(collection, resource);
    if (!written) throw new AdProviderError('广告资源保存失败', 'STORAGE_ERROR');
    const persisted = await deps.dataStore.getById<PlatformAdResource & { tenant_id: string }>(collection, resource.id);
    if (!persisted || persisted.tenant_id !== resource.tenant_id || persisted.providerResourceId !== resource.providerResourceId || persisted.lastSyncedAt !== resource.lastSyncedAt) throw new AdProviderError('广告资源保存后校验失败', 'STORAGE_ERROR');
  }

  return {
    async sync(tenantId: string, connectionId: string): Promise<PlatformAdResourceSyncResult> {
      return deps.lock(tenantId, `resource-sync-${connectionId}`, async guard => {
        const { connection, accessToken } = await deps.credential(tenantId, connectionId);
        if (connection.provider !== 'meta') throw new AdProviderError('首版资源同步仅支持 Meta', 'NOT_SUPPORTED');
        if (connection.status !== 'connected') throw new AdProviderError('Meta 广告账户不可用，请重新验证', 'AUTH_REQUIRED');
        if (!connection.timezoneName) throw new AdProviderError('Meta 账户时区尚未核验，请先重新验证账户', 'ACCOUNT_CONTEXT_REQUIRED');
        const adapter = deps.adapter(accessToken);
        const syncedAt = deps.now().toISOString();
        const syncRunId = randomUUID();
        const identity = { tenantId, connectionId, accountId: connection.accountId, currency: connection.currency, timezone: connection.timezoneName, syncedAt, syncRunId };
        const counts = { campaign: 0, adset: 0, ad: 0 };
        for (const level of ['campaign', 'adset', 'ad'] as const) {
          const items = await readAll(adapter, connection.accountId, level);
          for (const item of items) { await guard.beforeEffect(); await save(normalize(item, level, identity)); }
          counts[level] = items.length;
        }
        await guard.beforeEffect();
        if (!await deps.dataStore.update(AD_CONNECTIONS, connectionId, { resourceSyncRunId: syncRunId, resourceSyncedAt: syncedAt })) throw new AdProviderError('广告资源同步版本保存失败', 'STORAGE_ERROR');
        const committed = await deps.dataStore.getById<{ tenant_id: string; resourceSyncRunId?: string }>(AD_CONNECTIONS, connectionId);
        if (!committed || committed.tenant_id !== tenantId || committed.resourceSyncRunId !== syncRunId) throw new AdProviderError('广告资源同步版本校验失败', 'STORAGE_ERROR');
        return { connectionId, accountId: connection.accountId, currency: connection.currency, accountTimezone: connection.timezoneName, syncedAt, counts };
      });
    },
    async list(tenantId: string, connectionId: string, level: PlatformAdResourceLevel) {
      if (!collections[level]) throw new AdProviderError('广告资源层级无效', 'INVALID_INPUT');
      const connection = await deps.connection(tenantId, connectionId);
      if (!connection.resourceSyncRunId) return { items: [], hasMore: false, accountTimezone: connection.timezoneName || '', currency: connection.currency };
      const result = await deps.dataStore.list<PlatformAdResource & { tenant_id: string }>(collections[level], { where: { tenant_id: tenantId, connectionId, syncRunId: connection.resourceSyncRunId }, sort: 'name', perPage: 200 });
      return { items: result.items.map(({ tenant_id: _tenant, ...item }) => item), hasMore: result.totalPages > 1, accountTimezone: connection.timezoneName || '', currency: connection.currency };
    },
  };
}

const service = createPlatformAdResourceService({ dataStore: store, credential: getConnectionCredential, connection: getConnection, adapter: token => new MetaAdsAdapter(token), lock: withPlatformAdTaskLock, now: () => new Date() });
export const syncPlatformAdResources = service.sync;
export const listPlatformAdResources = service.list;
