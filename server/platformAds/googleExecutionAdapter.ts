import { AdProviderError } from './metaAdapter.js';
import { GoogleAdsAdapter } from './otherAdapters.js';
export type GoogleDemandGenPlan = {
  customerId: string; name: string; totalBudget: number; targetCpa: number;
  startDate: string; endDate: string; videoAssetId: string; logoAssetId: string;
  startDateTime?: string; endDateTime?: string;
  finalUrl: string; businessName: string; headline: string; longHeadline: string; description: string; locationIds: string[];
};
export function demandGenOperations(plan: GoogleDemandGenPlan): Record<string, unknown>[] {
  if (!/^\d{10}$/.test(plan.customerId) || !/^\d+$/.test(plan.videoAssetId) || !/^\d+$/.test(plan.logoAssetId) || !plan.locationIds.length || plan.locationIds.some(id => !/^\d+$/.test(id))) throw new AdProviderError('Google 客户、资产及地域 ID 无效', 'INVALID_INPUT');
  if (![plan.totalBudget, plan.targetCpa].every(value => Number.isFinite(value) && value > 0)) throw new AdProviderError('Google 预算或目标 CPA 无效', 'INVALID_INPUT');
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(plan.startDate) || !validDate(plan.endDate) || plan.startDate > plan.endDate || plan.endDate < new Date().toISOString().slice(0, 10)) throw new AdProviderError('Google 排期无效或已过期', 'INVALID_INPUT');
  try { if (new URL(plan.finalUrl).protocol !== 'https:') throw new Error(); } catch { throw new AdProviderError('Google 落地页必须使用 HTTPS', 'INVALID_INPUT'); }
  for (const [text, max] of [[plan.businessName, 25], [plan.headline, 40], [plan.longHeadline, 90], [plan.description, 90]] as const) if (!text.trim() || text.length > max) throw new AdProviderError('Google 广告文案缺失或超长', 'INVALID_INPUT');
  const base = `customers/${plan.customerId}`, budget = `${base}/campaignBudgets/-1`, campaign = `${base}/campaigns/-2`, group = `${base}/adGroups/-3`;
  return [
    { campaignBudgetOperation: { create: { resourceName: budget, name: `${plan.name} budget`, totalAmountMicros: String(Math.round(plan.totalBudget * 1e6)), period: 'CUSTOM_PERIOD', deliveryMethod: 'STANDARD', explicitlyShared: false } } },
    { campaignOperation: { create: { resourceName: campaign, name: plan.name, status: 'PAUSED', advertisingChannelType: 'DEMAND_GEN', campaignBudget: budget, startDateTime: plan.startDateTime || `${plan.startDate} 00:00:00`, endDateTime: plan.endDateTime || `${plan.endDate} 23:59:59`, targetCpa: { targetCpaMicros: String(Math.round(plan.targetCpa * 1e6)) }, containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING' } } },
    { adGroupOperation: { create: { resourceName: group, name: `${plan.name} video`, campaign, status: 'PAUSED', demandGenAdGroupSettings: { channelControls: { selectedChannels: { gmail: false, discover: false, display: false, youtubeInFeed: true, youtubeInStream: true, youtubeShorts: true } } } } } },
    ...plan.locationIds.map(id => ({ adGroupCriterionOperation: { create: { adGroup: group, location: { geoTargetConstant: `geoTargetConstants/${id}` } } } })),
    { adGroupAdOperation: { create: { adGroup: group, status: 'PAUSED', ad: { name: plan.name, finalUrls: [plan.finalUrl], demandGenVideoResponsiveAd: { businessName: { text: plan.businessName }, headlines: [{ text: plan.headline }], longHeadlines: [{ text: plan.longHeadline }], descriptions: [{ text: plan.description }], videos: [{ asset: `${base}/assets/${plan.videoAssetId}` }], logoImages: [{ asset: `${base}/assets/${plan.logoAssetId}` }] } } } } },
  ];
}
export class GoogleExecutionAdapter {
  constructor(
    private token: string,
    private transport: typeof fetch = fetch,
    private beforeProviderWrite?: () => Promise<void>,
  ) {}
  private async mutate(customerId: string, mutateOperations: Record<string, unknown>[], validateOnly = false) {
    const version = process.env.GOOGLE_ADS_API_VERSION;
    if (!version || !/^v\d+$/.test(version) || !/^\d{10}$/.test(customerId)) throw new AdProviderError('Google Ads 版本或客户 ID 无效', 'NOT_CONFIGURED');
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
    if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers['login-customer-id'] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    if (!validateOnly) await this.beforeProviderWrite?.();
    let response: Response;
    try { response = await this.transport(`https://googleads.googleapis.com/${version}/customers/${customerId}/googleAds:mutate`, { method: 'POST', headers, body: JSON.stringify({ mutateOperations, partialFailure: false, validateOnly }), signal: AbortSignal.timeout(30000) }); }
    catch { throw new AdProviderError('Google 请求超时，需核对平台结果', 'NETWORK_ERROR', !validateOnly); }
    let data: any;
    try { data = await response.json(); } catch { throw new AdProviderError('Google 回执无法解析', 'INVALID_RESPONSE', !validateOnly); }
    if (!response.ok || data.partialFailureError) throw new AdProviderError(`Google 拒绝请求（${data.error?.code || response.status}）`, String(data.error?.code || response.status), !validateOnly && (response.status >= 500 || response.status === 408));
    return data;
  }
  async createPaused(plan: GoogleDemandGenPlan) {
    const operations = demandGenOperations(plan);
    await this.mutate(plan.customerId, operations, true);
    const result = await this.mutate(plan.customerId, operations);
    const responses = result.mutateOperationResponses || [];
    const resource = (key: string) => String(responses.find((item: any) => item[key])?.[key]?.resourceName || '');
    const resources = { campaignId: resource('campaignResult'), budgetId: resource('campaignBudgetResult'), adgroupId: resource('adGroupResult'), adId: resource('adGroupAdResult') };
    if (Object.values(resources).some(value => !value.startsWith(`customers/${plan.customerId}/`))) throw new AdProviderError('Google 创建回执缺少资源，需平台核对', 'INVALID_RESPONSE', true);
    return resources;
  }
  async campaign(customerId: string, campaignResource: string) {
    if (!new RegExp(`^customers/${customerId}/campaigns/[0-9]+$`).test(campaignResource)) throw new AdProviderError('Google 广告资源归属不一致', 'ACCOUNT_MISMATCH');
    const id = campaignResource.split('/').pop();
    const result = await new GoogleAdsAdapter(this.token, this.transport).search(customerId, `SELECT campaign.resource_name, campaign.status, campaign.campaign_budget, campaign_budget.total_amount_micros FROM campaign WHERE campaign.id = ${id}`);
    if (!result.results?.[0]) throw new AdProviderError('Google 广告系列不可访问', 'ACCOUNT_MISMATCH');
    return result.results[0];
  }
  async setStatus(customerId: string, resources: { campaignId: string; adgroupId: string; adId: string }, status: 'ENABLED' | 'PAUSED') {
    await this.verifyResources(customerId, resources);
    for (const resource of [resources.adgroupId, resources.adId]) if (!resource.startsWith(`customers/${customerId}/`)) throw new AdProviderError('Google 子资源账户不匹配', 'ACCOUNT_MISMATCH');
    const operations: Record<string, unknown>[] = [];
    if (status === 'ENABLED') {
      operations.push({ adGroupOperation: { update: { resourceName: resources.adgroupId, status }, updateMask: 'status' } }, { adGroupAdOperation: { update: { resourceName: resources.adId, status }, updateMask: 'status' } });
    }
    operations.push({ campaignOperation: { update: { resourceName: resources.campaignId, status }, updateMask: 'status' } });
    await this.mutate(customerId, operations);
    try {
      const actual = await this.campaign(customerId, resources.campaignId);
      if (actual.campaign.status !== status) throw new AdProviderError('Google 状态待核对', 'RECONCILIATION_REQUIRED', true);
      return actual;
    } catch { throw new AdProviderError('Google 已接受状态修改，读回结果待核对', 'RECONCILIATION_REQUIRED', true); }
  }
  async verifyResources(customerId: string, resources: { campaignId: string; adgroupId: string; adId: string }) {
    const campaign = await this.campaign(customerId, resources.campaignId);
    if (!new RegExp(`^customers/${customerId}/adGroups/[0-9]+$`).test(resources.adgroupId) || !new RegExp(`^customers/${customerId}/adGroupAds/[0-9]+~[0-9]+$`).test(resources.adId)) throw new AdProviderError('Google 子资源 ID 无效', 'ACCOUNT_MISMATCH');
    const data = await new GoogleAdsAdapter(this.token, this.transport).search(customerId, `SELECT ad_group_ad.resource_name, ad_group_ad.status, ad_group.resource_name, ad_group.campaign, ad_group.status FROM ad_group_ad WHERE ad_group_ad.resource_name = '${resources.adId}'`);
    const child = data.results?.[0];
    if (!child || child.adGroup.resourceName !== resources.adgroupId || child.adGroup.campaign !== resources.campaignId || child.adGroupAd.resourceName !== resources.adId) throw new AdProviderError('Google 广告层级关联不一致', 'RESOURCE_MISMATCH');
    return { ...campaign, adGroup: child.adGroup, adGroupAd: child.adGroupAd };
  }
}
