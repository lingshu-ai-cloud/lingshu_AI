import { AdProviderError, MetaAdsAdapter, metaAccountId } from './metaAdapter.js';
export type AuthorizedPage = { id: string; name: string; tasks: string[] };
/** Cursor-only pagination: never follow a provider-supplied URL carrying credentials. */
export async function readAuthorizationEdge(adapter: MetaAdsAdapter, path: string, fields: string) {
  const items: Record<string, any>[] = [], cursors = new Set<string>();
  let after = '';
  for (let page = 0; page < 10; page++) {
    const body = await adapter.request(path, { fields, limit: 100, ...(after ? { after } : {}) });
    if (!Array.isArray(body.data)) throw new AdProviderError('授权资产列表读取不完整，请重试', 'INVALID_RESPONSE');
    items.push(...body.data);
    if (!body.paging?.next) return items;
    const cursor = body.paging?.cursors?.after;
    if (typeof cursor !== 'string' || !cursor || cursors.has(cursor)) break;
    cursors.add(cursor); after = cursor;
  }
  throw new AdProviderError('授权资产过多或分页异常，未展示不完整列表，请联系管理员', 'INVALID_RESPONSE');
}
/** A readable personal Page is not necessarily promotable by this ad account. */
export async function authorizedPages(token: string, accountId: string): Promise<AuthorizedPage[]> {
  const adapter = new MetaAdsAdapter(token);
  const [personal, promotable] = await Promise.all([
    readAuthorizationEdge(adapter, 'me/accounts', 'id,name,tasks'),
    readAuthorizationEdge(adapter, `act_${metaAccountId(accountId)}/promote_pages`, 'id,name'),
  ]);
  const allowed = new Set(promotable.map(p => String(p.id)));
  return personal.filter(p => /^\d+$/.test(String(p.id)) && allowed.has(String(p.id)) && Array.isArray(p.tasks) && p.tasks.some((t: unknown) => ['ADVERTISE', 'MANAGE'].includes(String(t))))
    .map(p => ({ id: String(p.id), name: String(p.name || p.id), tasks: p.tasks.map(String) }));
}
