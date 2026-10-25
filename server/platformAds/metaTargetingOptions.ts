import { getConnectionCredential } from './connections.js';
import { AdProviderError, MetaAdsAdapter } from './metaAdapter.js';
import type { MetaTargetOption } from '../../shared/metaTargeting.js';
export type MetaTargetingOptions = { source: 'meta_graph'; accountId: string; kind: string; apiVersion: string; fetchedAt: string; items: MetaTargetOption[]; hasMore: boolean; after: string | null };
export function parseMetaTargetingQuery(input: Record<string, unknown>) {
  if (Object.keys(input).some(k => !['kind', 'q', 'after'].includes(k)) || Object.values(input).some(v => typeof v !== 'string')) throw new AdProviderError('定向查询参数无效', 'INVALID_INPUT');
  const kind = String(input.kind || ''), q = String(input.q || '').trim(), after = String(input.after || '');
  if (!['interest', 'locale', 'audience'].includes(kind) || q.length > 100 || kind !== 'audience' && q.length < 2 || after.length > 4096 || /[\u0000-\u001f]/.test(after)) throw new AdProviderError('请选择查询类型；语言和兴趣至少输入两个字符', 'INVALID_INPUT');
  return { kind, q, after };
}
export async function readMetaTargetingOptions(adapter: Pick<MetaAdsAdapter, 'request'>, accountId: string, input: Record<string, unknown>): Promise<MetaTargetingOptions> {
  const { kind, q, after } = parseMetaTargetingQuery(input);
  const result = kind === 'audience'
    ? await adapter.request(`act_${accountId}/customaudiences`, { fields: 'id,name', limit: 50, after: after || undefined })
    : await adapter.request('search', { type: kind === 'locale' ? 'adlocale' : 'adinterest', q, limit: 50, after: after || undefined });
  if (!Array.isArray(result.data) || result.data.length > 50) throw new AdProviderError('Meta 定向目录响应无效', 'INVALID_RESPONSE');
  const items = result.data.map((row: Record<string, unknown>) => {
    const id = String(kind === 'locale' ? row.key ?? row.id ?? '' : row.id ?? '');
    if (!/^\d{1,30}$/.test(id) || typeof row.name !== 'string' || !row.name || row.name.length > 300) throw new AdProviderError('Meta 定向选项缺少有效名称或标识', 'INVALID_RESPONSE');
    return { id, name: row.name };
  });
  const hasMore = !!result.paging?.next, cursor = result.paging?.cursors?.after;
  if (hasMore && (typeof cursor !== 'string' || !cursor || cursor.length > 4096 || cursor === after)) throw new AdProviderError('Meta 定向目录分页无法继续', 'INVALID_RESPONSE');
  return { source: 'meta_graph', accountId, kind, apiVersion: process.env.META_ADS_API_VERSION || '', fetchedAt: new Date().toISOString(), items, hasMore, after: hasMore ? cursor : null };
}
export async function getMetaTargetingOptions(tenantId: string, connectionId: string, input: Record<string, unknown>) {
  parseMetaTargetingQuery(input);
  const { connection, accessToken } = await getConnectionCredential(tenantId, connectionId);
  if (connection.provider !== 'meta' || connection.status !== 'connected') throw new AdProviderError('请选择已连接的 Meta 广告账户', 'AUTH_REQUIRED');
  return readMetaTargetingOptions(new MetaAdsAdapter(accessToken), connection.accountId, input);
}
