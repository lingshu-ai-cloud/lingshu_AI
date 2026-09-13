import { AdProviderError } from './metaAdapter.js';
async function jsonRequest(url: string, init: RequestInit, transport: typeof fetch) {
  let response: Response;
  try { response = await transport(url, { ...init, signal: AbortSignal.timeout(30000) }); } catch { throw new AdProviderError('广告平台网络异常', 'NETWORK_ERROR'); }
  let data: any;
  try { data = await response.json(); } catch { throw new AdProviderError('广告平台响应无效', 'INVALID_RESPONSE'); }
  if (!response.ok) throw new AdProviderError(`广告平台拒绝请求（${response.status}）`, String(response.status));
  return data;
}
export class TikTokAdsAdapter {
  constructor(private token: string, private transport: typeof fetch = fetch) {}
  async get(path: string, args: Record<string, unknown>) {
    if (!['advertiser/info/', 'campaign/get/'].includes(path)) throw new AdProviderError('不支持该接口', 'INVALID_INPUT');
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(args)) query.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    const result = await jsonRequest(`https://business-api.tiktok.com/open_api/v1.3/${path}?${query}`, { headers: { 'Access-Token': this.token } }, this.transport);
    if (Number(result.code) !== 0) throw new AdProviderError(`TikTok 拒绝请求（${result.code}）`, String(result.code));
    return result.data;
  }
  async account(id: string) {
    if (!/^\d+$/.test(id)) throw new AdProviderError('广告账户 ID 无效', 'INVALID_INPUT');
    const data = await this.get('advertiser/info/', { advertiser_ids: [id] });
    const account = data.list?.find((item: any) => String(item.advertiser_id) === id);
    if (!account) throw new AdProviderError('无法访问该 TikTok 广告账户', 'AUTH_REQUIRED');
    return { name: String(account.name || id), currency: String(account.currency || ''), status: account.status === 'STATUS_ENABLE' ? 'connected' : 'restricted' };
  }
  async campaigns(id: string) { return this.get('campaign/get/', { advertiser_id: id, page_size: 100 }); }
}
export class GoogleAdsAdapter {
  constructor(private token: string, private transport: typeof fetch = fetch) {}
  async search(id: string, query: string) {
    if (!/^\d{10}$/.test(id)) throw new AdProviderError('Google 客户 ID 须为 10 位数字', 'INVALID_INPUT');
    const version = process.env.GOOGLE_ADS_API_VERSION;
    if (!version || !/^v\d+$/.test(version)) throw new AdProviderError('Google Ads API 版本尚未配置', 'NOT_CONFIGURED');
    // Since 2026-09-09 API access is bound to the OAuth Google Cloud project.
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
    if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers['login-customer-id'] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    return jsonRequest(`https://googleads.googleapis.com/${version}/customers/${id}/googleAds:search`, { method: 'POST', headers, body: JSON.stringify({ query }) }, this.transport);
  }
  async account(id: string) {
    const data = await this.search(id, 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.status FROM customer LIMIT 1');
    const account = data.results?.[0]?.customer;
    if (!account || String(account.id) !== id) throw new AdProviderError('无法访问该 Google 广告账户', 'AUTH_REQUIRED');
    return { name: String(account.descriptiveName || id), currency: String(account.currencyCode || ''), status: account.status === 'ENABLED' ? 'connected' : 'restricted' };
  }
  async campaigns(id: string) { return this.search(id, 'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign LIMIT 100'); }
}
