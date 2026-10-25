import { metaAdObjective } from '../../shared/metaAdObjectives.js';
import { buildMetaTargeting, metaTargetingMatches } from '../../shared/metaTargeting.js';
import { AdProviderError, type MetaAdsAdapter, type MetaVideoInput } from './metaAdapter.js';
export async function readMetaVideoPlan(adapter: MetaAdsAdapter, accountId: string, ids: Record<string, string>) {
  if (!['campaignId', 'adsetId', 'creativeId', 'adId'].every(k => /^\d+$/.test(ids[k] || ''))) throw new AdProviderError('缺少完整 Meta 资源 ID', 'RESOURCE_MISMATCH');
  const campaign = await adapter.request(ids.campaignId, { fields: 'id,account_id,status,effective_status,objective,spend_cap' });
  const adset = await adapter.request(ids.adsetId, { fields: 'id,account_id,campaign_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,attribution_spec,promoted_object,billing_event,destination_type,targeting,start_time,end_time' });
  const ad = await adapter.request(ids.adId, { fields: 'id,account_id,adset_id,creative,status,effective_status,issues_info' });
  const creative = await adapter.request(ids.creativeId, { fields: 'id,account_id,object_story_spec' });
  if ([campaign, adset, ad, creative].some((r, i) => String(r.account_id) !== accountId || String(r.id) !== [ids.campaignId, ids.adsetId, ids.adId, ids.creativeId][i]) || String(adset.campaign_id) !== ids.campaignId || String(ad.adset_id) !== ids.adsetId || String(ad.creative?.id) !== ids.creativeId) throw new AdProviderError('平台账户归属或资源关联已变化', 'RESOURCE_MISMATCH');
  return { campaign, adset, ad, creative };
}
export function assertPausedMetaVideoPlan(snapshot: Awaited<ReturnType<typeof readMetaVideoPlan>>, input: MetaVideoInput, budget: number, goal: string | boolean, channels: string[], schedule: { startsAt?: string; endsAt?: string } = {}) {
  const { campaign, adset, ad, creative } = snapshot;
  const spec = metaAdObjective(goal, input.messageDestination);
  const video = creative.object_story_spec?.video_data;
  const equal = (a: unknown, b: string[]) => Array.isArray(a) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const sameUrl = (a: unknown, b: string) => { try { return new URL(String(a)).href === new URL(b).href; } catch { return false; } };
  if (input.targeting && !metaTargetingMatches(adset.targeting, buildMetaTargeting(input.countries, channels, input.targeting))) throw new AdProviderError('Meta 读回的人群或手动版位与已确认配置不一致；保留资源待核对，不会重建', 'RECONCILIATION_REQUIRED', true);
  if ([campaign, adset, ad].some(r => r.status !== 'PAUSED') || campaign.objective !== spec.objective
    || Number(campaign.spend_cap) !== Math.round(budget * 100) || Number(adset.daily_budget) !== Math.round(input.dailyBudget * 100)
    || adset.optimization_goal !== spec.optimizationGoal || adset.destination_type !== spec.destinationType || adset.billing_event !== 'IMPRESSIONS'
    || String(creative.object_story_spec?.page_id) !== input.pageId || String(video?.video_id) !== input.videoId || (spec.destinationType === 'WEBSITE' && (video?.call_to_action?.type !== 'LEARN_MORE' || !sameUrl(video?.call_to_action?.value?.link, input.linkUrl)))
    || (goal === '获取Meta表单线索' && (video?.call_to_action?.type !== 'SIGN_UP' || String(video?.call_to_action?.value?.lead_gen_form_id) !== input.leadFormId || String(adset.promoted_object?.page_id) !== input.pageId))
    || (goal === '获取独立站询盘' && (String(adset.promoted_object?.pixel_id) !== input.pixelId || adset.promoted_object?.custom_event_type !== 'LEAD'))
    || (goal === '获取消息会话' && (String(adset.promoted_object?.page_id) !== input.pageId || video?.call_to_action?.type !== (input.messageDestination === 'WHATSAPP' ? 'WHATSAPP_MESSAGE' : 'MESSAGE_PAGE') || (input.messageDestination === 'WHATSAPP' && String(adset.promoted_object?.whatsapp_phone_number).replace(/\D/g, '') !== input.whatsappPhoneNumber?.replace(/\D/g, '')) || (input.messageDestination === 'INSTAGRAM_DIRECT' && (String(adset.promoted_object?.instagram_actor_id) !== input.instagramActorId || String(creative.object_story_spec?.instagram_actor_id) !== input.instagramActorId))))
    || (goal === '获取消息会话' && !sameUrl(video?.call_to_action?.value?.link, input.messageDestination === 'WHATSAPP' ? `https://wa.me/${input.whatsappPhoneNumber!.replace(/\D/g, '')}` : input.messageDestination === 'MESSENGER' ? `https://m.me/${input.pageId}` : `https://ig.me/m/${input.instagramUsername}`))
    || (schedule.startsAt && Math.floor(Date.parse(adset.start_time) / 1000) !== Math.floor(Date.parse(schedule.startsAt) / 1000)) || (schedule.endsAt && Math.floor(Date.parse(adset.end_time) / 1000) !== Math.floor(Date.parse(schedule.endsAt) / 1000))
    || !equal(adset.targeting?.geo_locations?.countries, input.countries) || !equal(adset.targeting?.publisher_platforms, channels.map(c => c === 'Facebook' ? 'facebook' : 'instagram'))) throw new AdProviderError('Meta 创建读回的账户、层级、暂停状态、目标、素材、地域、版位或预算与请求不一致；保留原资源待核对，不会重建', 'RECONCILIATION_REQUIRED', true);
}
