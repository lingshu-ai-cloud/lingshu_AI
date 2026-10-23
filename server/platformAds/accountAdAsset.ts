import type { MetaAdAsset } from '../../shared/adAccountDirectory.js';
import { readGrantedAdapter } from './accountDirectory.js';
import { AdProviderError, type MetaAdsAdapter } from './metaAdapter.js';
import { creativeReadCache } from './creativeReadCache.js';
const cache = creativeReadCache<MetaAdAsset>(60_000);
const id = (value: unknown) => /^\d+$/.test(String(value || '')) ? String(value) : '';
const imageUrl = (value: unknown) => {
  try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password && ![...url.searchParams.keys()].some(k => /access_token|secret|authorization/i.test(k)) ? url.href : ''; } catch { return ''; }
};
export async function readAccountAdAsset(accountId: string, adId: string, adapter: Pick<MetaAdsAdapter, 'request'>): Promise<MetaAdAsset> {
  if (!id(accountId) || !id(adId)) throw new AdProviderError('广告标识无效', 'INVALID_INPUT');
  const ad = await adapter.request(adId, { fields: 'id,name,account_id,creative,status,effective_status' });
  const creativeId = id(ad.creative?.id);
  if (String(ad.id) !== adId || String(ad.account_id) !== accountId || !creativeId) throw new AdProviderError('广告账户或创意归属不一致', 'RESOURCE_MISMATCH');
  const creative = await adapter.request(creativeId, { fields: 'id,name,account_id,object_story_spec,video_id,image_hash,thumbnail_url,asset_feed_spec' });
  if (String(creative.id) !== creativeId || String(creative.account_id) !== accountId) throw new AdProviderError('广告素材不属于当前账户', 'RESOURCE_MISMATCH');
  const spec = creative.object_story_spec || {}, feed = creative.asset_feed_spec || {};
  const videoIds = [...new Set([creative.video_id, spec.video_data?.video_id, ...(Array.isArray(feed.videos) ? feed.videos.map((v: any) => v.video_id) : [])].map(id).filter(Boolean))];
  const imageHashes = [...new Set([creative.image_hash, spec.link_data?.image_hash, spec.video_data?.image_hash, ...(Array.isArray(feed.images) ? feed.images.map((i: any) => i.hash) : [])].filter((v): v is string => typeof v === 'string' && /^[a-f\d]{16,128}$/i.test(v)))];
  return { accountId, adId, adName: String(ad.name || adId), creativeId, creativeName: String(creative.name || '平台广告素材'),
    configuredStatus: String(ad.status || ''), effectiveStatus: String(ad.effective_status || ''), pageId: id(spec.page_id), videoIds, imageHashes,
    thumbnailUrl: imageUrl(creative.thumbnail_url), checkedAt: new Date().toISOString(), localSource: 'unverified' };
}
export async function getAccountAdAsset(tenantId: string, connectionId: string, accountId: string, adId: string) {
  return cache(tenantId, JSON.stringify([connectionId, accountId, adId]), async () => {
    const { adapter } = await readGrantedAdapter(tenantId, connectionId, accountId);
    return readAccountAdAsset(accountId, adId, adapter);
  });
}
