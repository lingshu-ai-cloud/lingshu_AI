import { getConnectionCredential } from './connections.js';
import { AdProviderError, MetaAdsAdapter } from './metaAdapter.js';
import { creativeReadCache } from './creativeReadCache.js';
const cached = creativeReadCache<Array<{ accountId: string; name: string; currency: string }>>(60_000);
/** Discover existing grants only. Never connect/import/create an account. */
export async function readHistoryAccounts(adapter: Pick<MetaAdsAdapter, 'request'>) {
  const items: Array<{ accountId: string; name: string; currency: string }> = [], seen = new Set<string>(), cursors = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const response = await adapter.request('me/adaccounts', { fields: 'id,name,currency', limit: 100, after });
    if (!Array.isArray(response.data) || response.data.length > 100) throw new AdProviderError('已授权账户清单异常', 'INVALID_RESPONSE');
    for (const row of response.data) {
      const accountId = String(row.id || '').replace(/^act_/, '');
      if (!/^\d+$/.test(accountId) || !/^[A-Z]{3}$/.test(row.currency || '') || seen.has(accountId)) throw new AdProviderError('已授权账户身份异常', 'INVALID_RESPONSE');
      seen.add(accountId); items.push({ accountId, name: String(row.name || accountId), currency: row.currency });
    }
    if (!response.paging?.next) return items;
    const cursor = response.paging?.cursors?.after;
    if (typeof cursor !== 'string' || !cursor || cursor.length > 4096 || cursors.has(cursor)) throw new AdProviderError('已授权账户清单分页不完整', 'INVALID_RESPONSE');
    cursors.add(cursor); after = cursor;
  }
  throw new AdProviderError('已授权账户超过当前读取上限，请缩小授权范围后查询', 'LIMIT_EXCEEDED');
}
export async function getHistoryAccounts(tenantId: string, connectionId: string) {
  return cached(tenantId, connectionId, async () => {
    const { connection, accessToken } = await getConnectionCredential(tenantId, connectionId);
    if (connection.provider !== 'meta') throw new AdProviderError('仅支持 Meta 授权账户', 'NOT_SUPPORTED');
    return readHistoryAccounts(new MetaAdsAdapter(accessToken));
  });
}
