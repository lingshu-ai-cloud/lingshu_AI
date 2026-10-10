import { AdProviderError } from './metaAdapter.js';
import { TikTokAdsAdapter } from './otherAdapters.js';

// Official synchronous reporting contract and metric definitions, checked 2026-09-12:
// https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/ReportingApi.md
// https://business-api.tiktok.com/gateway/docs/index?doc_id=1751443967255553
// ENGAGED_VIEW is engaged_view (6-second focused views, including qualifying engagement),
// not raw video starts, 6-second paid views alone, or clicks.
export type TikTokMetricRow = { dimensions: { campaign_id?: string; stat_time_day?: string }; metrics: Record<string, unknown> };
const metricNumber = (value: unknown): number | null => (typeof value === 'number' || typeof value === 'string') && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const sum = (values: Array<number | null>) => values.length && values.every(value => value !== null) ? values.reduce<number>((total, value) => total + value!, 0) : null;
const resultMetric = (optimizationGoal: string) => optimizationGoal === 'ENGAGED_VIEW' ? 'engaged_view' : optimizationGoal === 'ENGAGED_VIEW_FIFTEEN' ? 'engaged_view_15s' : null;
export function aggregateTikTokMetrics(rows: TikTokMetricRow[], optimizationGoal: string) {
  const resultKey = resultMetric(optimizationGoal);
  const daily = rows.map(row => ({ date: String(row.dimensions.stat_time_day || '').slice(0, 10), spend: metricNumber(row.metrics.spend), impressions: metricNumber(row.metrics.impressions), clicks: metricNumber(row.metrics.clicks), results: resultKey ? metricNumber(row.metrics[resultKey]) : null }));
  const spend = sum(daily.map(row => row.spend)), results = sum(daily.map(row => row.results));
  return { spend, impressions: sum(daily.map(row => row.impressions)), clicks: sum(daily.map(row => row.clicks)), results, costPerResult: spend !== null && results !== null && results > 0 ? spend / results : null, daily,
    metricLabel: optimizationGoal === 'ENGAGED_VIEW' ? 'TikTok 6 秒专注观看（含符合条件的互动）' : optimizationGoal === 'ENGAGED_VIEW_FIFTEEN' ? 'TikTok 15 秒专注观看（含符合条件的互动）' : '目标口径尚未映射',
    resultNote: resultKey ? '平台专注观看口径包含达标观看或规定时间内的有效互动；不等同纯播放数。字段缺失时不以其他指标替代。' : '尚未验证该优化目标的报告口径，结果及单次结果成本暂不提供。',
  };
}

export async function getTikTokCampaignMetrics(input: { accessToken: string; accountId: string; campaignId: string; since: string; until: string; optimizationGoal: string }, transport: typeof fetch = fetch) {
  if (!/^\d+$/.test(input.accountId) || !/^\d+$/.test(input.campaignId)) throw new AdProviderError('TikTok 广告账户或计划 ID 无效', 'INVALID_INPUT');
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(input.since) || !validDate(input.until) || input.since > input.until || Date.parse(input.until) - Date.parse(input.since) > 30 * 86400000) throw new AdProviderError('报告日期须为有效且不超过 31 天的时间范围', 'INVALID_INPUT');
  const accountAdapter = new TikTokAdsAdapter(input.accessToken, transport);
  const campaigns = await accountAdapter.get('campaign/get/', { advertiser_id: input.accountId, filtering: { campaign_ids: [input.campaignId] }, page_size: 100 });
  if (!campaigns.list?.some((campaign: any) => String(campaign.campaign_id) === input.campaignId && (!campaign.advertiser_id || String(campaign.advertiser_id) === input.accountId))) throw new AdProviderError('TikTok 计划不属于当前广告账户', 'ACCOUNT_MISMATCH');
  const rows: TikTokMetricRow[] = [], seen = new Set<string>();
  const resultKey = resultMetric(input.optimizationGoal);
  for (let page = 1; page <= 20; page++) {
    const query = new URLSearchParams({ advertiser_id: input.accountId, report_type: 'BASIC', service_type: 'AUCTION', data_level: 'AUCTION_CAMPAIGN', dimensions: JSON.stringify(['campaign_id', 'stat_time_day']), metrics: JSON.stringify(['spend', 'impressions', 'clicks', ...(resultKey ? [resultKey] : [])]), start_date: input.since, end_date: input.until, filtering: JSON.stringify([{ field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify([input.campaignId]) }]), page: String(page), page_size: '1000' });
    let response: Response;
    try { response = await transport(`https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?${query}`, { method: 'GET', headers: { 'Access-Token': input.accessToken }, signal: AbortSignal.timeout(30000) }); }
    catch { throw new AdProviderError('TikTok 报告请求失败', 'NETWORK_ERROR'); }
    let body: any;
    try { body = await response.json(); } catch { throw new AdProviderError('TikTok 报告响应无效', 'INVALID_RESPONSE'); }
    if (!response.ok || Number(body.code) !== 0) throw new AdProviderError('TikTok 尚未提供该报告，请检查报告权限和指标可用性', 'METRICS_NOT_READY');
    if (!Array.isArray(body.data?.list)) throw new AdProviderError('TikTok 报告缺少数据列表', 'INVALID_RESPONSE');
    const totalPages = Number(body.data.page_info?.total_page);
    if (!Number.isInteger(totalPages) || totalPages < 0 || totalPages > 20 || (totalPages === 0 && body.data.list.length)) throw new AdProviderError('TikTok 报告分页不完整', 'METRICS_NOT_READY');
    for (const row of body.data.list as TikTokMetricRow[]) {
      const date = String(row.dimensions?.stat_time_day || '').slice(0, 10);
      if (String(row.dimensions?.campaign_id) !== input.campaignId || !validDate(date) || date < input.since || date > input.until || !row.metrics || seen.has(date)) throw new AdProviderError('TikTok 报告范围或分页数据不一致', 'METRICS_NOT_READY');
      seen.add(date); rows.push(row);
    }
    if (page >= totalPages) break;
  }
  rows.sort((a, b) => String(a.dimensions.stat_time_day).localeCompare(String(b.dimensions.stat_time_day)));
  return { provider: 'tiktok' as const, source: 'provider' as const, window: { since: input.since, until: input.until }, reportedAt: new Date().toISOString(), ...aggregateTikTokMetrics(rows, input.optimizationGoal), dataNote: '报告日期按广告账户时区解释，平台数据可能延迟或回补；空数据不表示零消耗。' };
}
