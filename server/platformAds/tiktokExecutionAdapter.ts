import { AdProviderError } from './metaAdapter.js';

export type TikTokVideoPlan = {
  advertiserId: string; name: string; totalBudget: number; locationIds: string[];
  startsAt: string; endsAt: string; identityId: string; tiktokItemId: string; adText: string;
};
export type TikTokResources = { campaignId: string; adgroupId: string; adId: string };
export function validateTikTokVideoPlan(value: TikTokVideoPlan) {
  for (const id of [value.advertiserId, value.identityId, value.tiktokItemId, ...value.locationIds]) if (!/^\d+$/.test(id)) throw new AdProviderError('TikTok 账户、身份、帖子和地域 ID 无效', 'INVALID_INPUT');
  if (!value.name.trim() || value.name.length > 100 || !value.locationIds.length || !Number.isFinite(value.totalBudget) || value.totalBudget <= 0) throw new AdProviderError('TikTok 计划配置不完整', 'INVALID_INPUT');
  for (const date of [value.startsAt, value.endsAt]) if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(date) || !Number.isFinite(Date.parse(date))) throw new AdProviderError('TikTok 排期必须包含时区', 'INVALID_INPUT');
  if (Date.parse(value.startsAt) <= Date.now() || Date.parse(value.endsAt) <= Date.parse(value.startsAt)) throw new AdProviderError('TikTok 排期已过期或结束时间无效', 'INVALID_INPUT');
}
/** Isolated adapter: not yet exposed by task execution routes. Requires an authorized
 * TT_USER identity and existing promotable TikTok post. No arbitrary request passthrough. */
export class TikTokExecutionAdapter {
  constructor(private token: string, private transport: typeof fetch = fetch) {}
  private async request(path: string, params: Record<string, unknown>, method: 'GET' | 'POST') {
    const url = new URL(`https://business-api.tiktok.com/open_api/v1.3/${path}/`);
    if (method === 'GET') for (const [key, value] of Object.entries(params)) url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    let response: Response;
    try { response = await this.transport(url, { method, headers: { 'Access-Token': this.token, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(params) : undefined, signal: AbortSignal.timeout(30000) }); }
    catch { throw new AdProviderError('TikTok 请求超时，需对账确认结果', 'NETWORK_ERROR', method === 'POST'); }
    let data: any;
    try { data = await response.json(); } catch { throw new AdProviderError('TikTok 回执无法解析', 'INVALID_RESPONSE', method === 'POST'); }
    if (!response.ok || Number(data.code) !== 0) throw new AdProviderError(`TikTok 拒绝请求（${data.code || response.status}）`, String(data.code || response.status), method === 'POST' && (response.status >= 500 || response.status === 408));
    return data.data;
  }
  async createPaused(plan: TikTokVideoPlan, onCreated: (kind: keyof TikTokResources, id: string) => Promise<void>): Promise<TikTokResources> {
    validateTikTokVideoPlan(plan);
    const publishId = async (kind: keyof TikTokResources, value: unknown) => {
      const id = String(value || '');
      if (!/^\d+$/.test(id)) throw new AdProviderError('TikTok 创建回执缺少资源 ID', 'INVALID_RESPONSE', true);
      await onCreated(kind, id); return id;
    };
    const campaign = await this.request('campaign/create', { advertiser_id: plan.advertiserId, campaign_name: plan.name, objective_type: 'VIDEO_VIEWS', budget_mode: 'BUDGET_MODE_TOTAL', budget: plan.totalBudget, operation_status: 'DISABLE' }, 'POST');
    const campaignId = await publishId('campaignId', campaign.campaign_id);
    // TikTok schedule strings are UTC in the API; input timezone is normalized explicitly.
    const utc = (date: string) => new Date(date).toISOString().slice(0, 19).replace('T', ' ');
    const adgroup = await this.request('adgroup/create', { advertiser_id: plan.advertiserId, campaign_id: campaignId, adgroup_name: `${plan.name} · 视频观看`, placement_type: 'PLACEMENT_TYPE_NORMAL', placements: ['PLACEMENT_TIKTOK'], location_ids: plan.locationIds, gender: 'GENDER_UNLIMITED', budget_mode: 'BUDGET_MODE_TOTAL', budget: plan.totalBudget, schedule_type: 'SCHEDULE_START_END', schedule_start_time: utc(plan.startsAt), schedule_end_time: utc(plan.endsAt), optimization_goal: 'ENGAGED_VIEW', bid_type: 'BID_TYPE_NO_BID', billing_event: 'CPV', bid_display_mode: 'CPV', pacing: 'PACING_MODE_SMOOTH', operation_status: 'DISABLE' }, 'POST');
    const adgroupId = await publishId('adgroupId', adgroup.adgroup_id);
    const ad = await this.request('ad/create', { advertiser_id: plan.advertiserId, adgroup_id: adgroupId, creatives: [{ ad_name: plan.name, ad_format: 'SINGLE_VIDEO', identity_type: 'TT_USER', identity_id: plan.identityId, tiktok_item_id: plan.tiktokItemId, ad_text: plan.adText }], operation_status: 'DISABLE' }, 'POST');
    const adId = await publishId('adId', ad.ad_ids?.[0]);
    return { campaignId, adgroupId, adId };
  }
  async read(advertiserId: string, kind: 'campaign' | 'adgroup' | 'ad', id: string) {
    if (!/^\d+$/.test(advertiserId) || !/^\d+$/.test(id)) throw new AdProviderError('TikTok 资源 ID 无效', 'INVALID_INPUT');
    const result = await this.request(`${kind}/get`, { advertiser_id: advertiserId, filtering: { [`${kind}_ids`]: [id] }, page_size: 100 }, 'GET');
    const found = result.list?.find((item: any) => String(item[`${kind}_id`]) === id);
    if (!found || (found.advertiser_id && String(found.advertiser_id) !== advertiserId)) throw new AdProviderError('TikTok 资源不属于授权账户', 'ACCOUNT_MISMATCH');
    return found;
  }
  async setStatus(advertiserId: string, kind: 'campaign' | 'adgroup' | 'ad', id: string, status: 'ENABLE' | 'DISABLE') {
    await this.read(advertiserId, kind, id);
    await this.request(`${kind}/status/update`, { advertiser_id: advertiserId, [`${kind}_ids`]: [id], operation_status: status }, 'POST');
    try {
      const actual = await this.read(advertiserId, kind, id);
      if (actual.operation_status !== status) throw new AdProviderError('TikTok 状态仍待确认', 'RECONCILIATION_REQUIRED', true);
      return actual;
    } catch { throw new AdProviderError('TikTok 已接受状态修改，读回结果待核对', 'RECONCILIATION_REQUIRED', true); }
  }
  async activate(advertiserId: string, resources: TikTokResources) {
    const campaign = await this.read(advertiserId, 'campaign', resources.campaignId);
    const group = await this.read(advertiserId, 'adgroup', resources.adgroupId);
    const ad = await this.read(advertiserId, 'ad', resources.adId);
    if (String(group.campaign_id) !== resources.campaignId || String(ad.adgroup_id) !== resources.adgroupId || campaign.operation_status !== 'DISABLE') throw new AdProviderError('TikTok 资源关系或父计划状态不一致', 'RESOURCE_MISMATCH');
    await this.setStatus(advertiserId, 'ad', resources.adId, 'ENABLE');
    await this.setStatus(advertiserId, 'adgroup', resources.adgroupId, 'ENABLE');
    return this.setStatus(advertiserId, 'campaign', resources.campaignId, 'ENABLE');
  }
}
