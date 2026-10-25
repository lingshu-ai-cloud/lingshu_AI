import type { MetaDestinationAssets, MetaDestinationKind } from '../../shared/metaDestinationAssets.js';
import { getConnectionCredential } from './connections.js';
import { AdProviderError, MetaAdsAdapter } from './metaAdapter.js';
import { authorizedPages, readAuthorizationEdge } from './metaAuthorization.js';

/** Read only. Page credentials and raw provider bodies never leave this boundary. */
export async function readMetaDestinationAssets(adapter: MetaAdsAdapter, accountId: string, pageId: string, kind: MetaDestinationKind): Promise<MetaDestinationAssets> {
  const result: MetaDestinationAssets = { kind, pageId, forms: [], termsAccepted: null, pixels: [], whatsappPhoneNumber: '', instagram: null };
  if (kind === 'pixels') {
    const pixels = await readAuthorizationEdge(adapter, `act_${accountId}/adspixels`, 'id,name');
    result.pixels = pixels.filter(p => /^\d+$/.test(String(p.id))).map(p => ({ id: String(p.id), name: String(p.name || '网站数据源') }));
    return result;
  }
  const pageAdapter = await adapter.pageCreativeAdapter(pageId);
  if (kind === 'forms') {
    const page = await pageAdapter.request(pageId, { fields: 'id,leadgen_tos_accepted' });
    if (String(page.id) !== pageId) throw new AdProviderError('主页返回与所选资产不一致', 'PAGE_MISMATCH');
    result.termsAccepted = page.leadgen_tos_accepted === true ? true : page.leadgen_tos_accepted === false ? false : null;
    const forms = await readAuthorizationEdge(pageAdapter, `${pageId}/leadgen_forms`, 'id,name,status,locale,questions');
    result.forms = forms.filter(f => /^\d+$/.test(String(f.id)) && f.status === 'ACTIVE').map(f => ({ id: String(f.id), name: String(f.name || '获客表单'), locale: String(f.locale || ''), questions: Array.isArray(f.questions) ? f.questions.map((q: { label?: unknown; type?: unknown }) => String(q.label || q.type || '')).filter(Boolean) : [] }));
  } else {
    const page = await pageAdapter.request(pageId, { fields: 'id,whatsapp_number,instagram_business_account{id,username}' });
    if (String(page.id) !== pageId) throw new AdProviderError('主页返回与所选资产不一致', 'PAGE_MISMATCH');
    result.whatsappPhoneNumber = /^\+?[1-9][0-9]{6,14}$/.test(String(page.whatsapp_number || '').replace(/[\s()-]/g, '')) ? String(page.whatsapp_number).replace(/[\s()-]/g, '') : '';
    const ig = page.instagram_business_account;
    if (/^\d+$/.test(String(ig?.id)) && /^[A-Za-z0-9_.]{1,30}$/.test(String(ig?.username))) result.instagram = { id: String(ig.id), username: String(ig.username) };
  }
  return result;
}

export async function getMetaDestinationAssets(tenantId: string, connectionId: string, query: { pageId?: unknown; kind?: unknown }) {
  const { connection, accessToken } = await getConnectionCredential(tenantId, connectionId);
  if (connection.provider !== 'meta') throw new AdProviderError('仅支持 Meta 账户', 'INVALID_INPUT');
  const kind = query.kind;
  if (kind !== 'forms' && kind !== 'messages' && kind !== 'pixels') throw new AdProviderError('获客资产类型无效', 'INVALID_INPUT');
  const pageId = typeof query.pageId === 'string' ? query.pageId : '';
  if (!/^\d+$/.test(pageId)) throw new AdProviderError('请先关联 Facebook 主页', 'INVALID_INPUT');
  const pages = await authorizedPages(accessToken, connection.accountId);
  if (!pages.some(p => p.id === pageId)) throw new AdProviderError('所选主页不在该广告账户授权范围内，请重新连接账户', 'PAGE_AUTH_REQUIRED');
  return readMetaDestinationAssets(new MetaAdsAdapter(accessToken), connection.accountId, pageId, kind);
}
