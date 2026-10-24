import { AdProviderError, type MetaAdsAdapter, type MetaVideoInput } from './metaAdapter.js';
export async function readMetaVideoPlan(adapter: MetaAdsAdapter, accountId: string, ids: Record<string, string>) {
  if (!['campaignId', 'adsetId', 'creativeId', 'adId'].every(k => /^\d+$/.test(ids[k] || ''))) throw new AdProviderError('缺少完整 Meta 资源 ID', 'RESOURCE_MISMATCH');
  const campaign = await adapter.request(ids.campaignId, { fields: 'id,account_id,status,effective_status,objective,spend_cap' });
  const adset = await adapter.request(ids.adsetId, { fields: 'id,account_id,campaign_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,attribution_spec,billing_event,destination_type,targeting,start_time,end_time' });
  const ad = await adapter.request(ids.adId, { fields: 'id,account_id,adset_id,creative,status,effective_status,issues_info' });
  const creative = await adapter.request(ids.creativeId, { fields: 'id,account_id,object_story_spec' });
  if ([campaign, adset, ad, creative].some((r, i) => String(r.account_id) !== accountId || String(r.id) !== [ids.campaignId, ids.adsetId, ids.adId, ids.creativeId][i]) || String(adset.campaign_id) !== ids.campaignId || String(ad.adset_id) !== ids.adsetId || String(ad.creative?.id) !== ids.creativeId) throw new AdProviderError('平台账户归属或资源关联已变化', 'RESOURCE_MISMATCH');
  return { campaign, adset, ad, creative };
}
export function assertPausedMetaVideoPlan(snapshot: Awaited<ReturnType<typeof readMetaVideoPlan>>, input: MetaVideoInput, budget: number, videoViews: boolean, channels: string[], schedule: { startsAt?: string; endsAt?: string } = {}) {
  const { campaign, adset, ad, creative } = snapshot;
  const video = creative.object_story_spec?.video_data;
  const equal = (a: unknown, b: string[]) => Array.isArray(a) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const sameUrl = (a: unknown, b: string) => { try { return new URL(String(a)).href === new URL(b).href; } catch { return false; } };
  if ([campaign, adset, ad].some(r => r.status !== 'PAUSED') || campaign.objective !== (videoViews ? 'OUTCOME_ENGAGEMENT' : 'OUTCOME_TRAFFIC')
    || Number(campaign.spend_cap) !== Math.round(budget * 100) || Number(adset.daily_budget) !== Math.round(input.dailyBudget * 100)
    || adset.optimization_goal !== (videoViews ? 'THRUPLAY' : 'LINK_CLICKS') || adset.destination_type !== (videoViews ? 'ON_VIDEO' : 'WEBSITE') || adset.billing_event !== 'IMPRESSIONS'
    || String(creative.object_story_spec?.page_id) !== input.pageId || String(video?.video_id) !== input.videoId || (!videoViews && !sameUrl(video?.call_to_action?.value?.link, input.linkUrl))
    || (schedule.startsAt && Math.floor(Date.parse(adset.start_time) / 1000) !== Math.floor(Date.parse(schedule.startsAt) / 1000)) || (schedule.endsAt && Math.floor(Date.parse(adset.end_time) / 1000) !== Math.floor(Date.parse(schedule.endsAt) / 1000))
    || !equal(adset.targeting?.geo_locations?.countries, input.countries) || !equal(adset.targeting?.publisher_platforms, channels.map(c => c === 'Facebook' ? 'facebook' : 'instagram'))) throw new AdProviderError('Meta 创建读回的账户、层级、暂停状态、目标、素材、地域、版位或预算与请求不一致；保留原资源待核对，不会重建', 'RECONCILIATION_REQUIRED', true);
}
