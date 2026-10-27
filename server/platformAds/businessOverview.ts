import type { MetaBusinessOverview, MetaAudienceDimension } from '../../shared/metaBusinessOverview.js';
import { META_PERFORMANCE_FIELDS, metaAccountDate, metaDateRange, type MetaMetricValues } from '../../shared/metaPerformance.js';
import { normalizeMetaPerformance } from './metaPerformance.js';
import { readGrantedAdapter } from './accountDirectory.js';
import { readAccountAdAsset } from './accountAdAsset.js';
import { AdProviderError, type MetaAdsAdapter } from './metaAdapter.js';
import { creativeReadCache } from './creativeReadCache.js';
const cache = creativeReadCache<MetaBusinessOverview>(60_000);
const fail = () => new AdProviderError('Meta 报告归属、日期、维度或分页不完整', 'INVALID_RESPONSE');
const count = (v: unknown) => typeof v === 'string' && v.trim() || typeof v === 'number' ? Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null : null;
export function overviewDays(query: Record<string, unknown>): number {
  if (Object.keys(query).some(key => key !== 'days') || query.days !== undefined && (typeof query.days !== 'string' || !['7', '30'].includes(query.days))) throw new AdProviderError('请选择最近 7 天或 30 天', 'INVALID_INPUT');
  return Number(query.days || 7);
}
export async function readMetaBusinessOverview(accountId: string, days: number, adapter: Pick<MetaAdsAdapter, 'request'>): Promise<MetaBusinessOverview> {
  if (!/^\d+$/.test(accountId) || ![7, 30].includes(days)) throw new AdProviderError('账户或周期无效', 'INVALID_INPUT');
  const account = await adapter.request(`act_${accountId}`, { fields: 'id,name,currency,timezone_name' });
  if (String(account.id) !== `act_${accountId}` || !/^[A-Z]{3}$/.test(account.currency || '') || !account.timezone_name) throw fail();
  const until = metaAccountDate(account.timezone_name);
  const since = new Date(Date.parse(`${until}T12:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
  const validDates = new Set(metaDateRange(since, until));
  const common = { time_range: { since, until }, action_report_time: 'impression', use_unified_attribution_setting: true, limit: 100 };
  const fields = [...new Set(['account_id', 'account_currency', 'date_start', 'date_stop', ...Object.values(META_PERFORMANCE_FIELDS).map(item => item.field)])].join(',');
  async function read(extra: Record<string, unknown>, extraFields = '', key: (row: Record<string, any>) => string) {
    const rows: Array<Record<string, any>> = [], keys = new Set<string>(), cursors = new Set<string>();
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const response = await adapter.request(`act_${accountId}/insights`, { ...common, fields: fields + extraFields, ...extra, after });
      if (!Array.isArray(response.data) || response.data.length > 100) throw fail();
      for (const row of response.data) {
        const identity = key(row);
        if (String(row.account_id) !== accountId || row.account_currency !== account.currency || !validDates.has(row.date_start) || !validDates.has(row.date_stop) || row.date_start > row.date_stop || !identity || keys.has(identity)) throw fail();
        keys.add(identity); rows.push(row);
      }
      if (!response.paging?.next) return rows;
      const next = response.paging?.cursors?.after;
      if (typeof next !== 'string' || !next || next.length > 4096 || cursors.has(next)) throw fail();
      cursors.add(next); after = next;
    }
    throw fail();
  }
  const totals = await read({ level: 'account', time_increment: 'all_days' }, '', () => 'account');
  const daily = await read({ level: 'account', time_increment: 1 }, '', row => row.date_start === row.date_stop ? row.date_start : '');
  if (totals.length > 1 || (totals.length === 0) !== (daily.length === 0)) throw fail();
  // Aggregate totals must cover the requested account window, never an arbitrary partial row.
  if (totals.some(row => row.date_start !== since || row.date_stop !== until)) throw fail();
  const warnings: string[] = [];
  const audiences: MetaBusinessOverview['audiences'] = [];
  for (const dimension of ['age', 'gender', 'country'] as MetaAudienceDimension[]) {
    try {
      const rows = await read({ level: 'account', breakdowns: dimension, time_increment: 'all_days', fields: `account_id,account_currency,date_start,date_stop,impressions,clicks,${dimension}` }, '', row => typeof row[dimension] === 'string' && row[dimension].trim() ? row[dimension] : '');
      if (rows.some(row => row.date_start !== since || row.date_stop !== until)) throw fail();
      audiences.push({ dimension, available: rows.length > 0, rows: rows.map(row => ({ label: row[dimension], impressions: count(row.impressions), clicks: count(row.clicks) })), note: rows.length ? 'Meta 广告展示人群分布' : '平台未返回该维度，可能受隐私阈值或数据可用性限制。' });
    } catch { audiences.push({ dimension, available: false, rows: [], note: '该维度暂未回传；不以 CRM 标签或投放定向替代实际人群。' }); }
  }
  const topVideos: MetaBusinessOverview['topVideos'] = [];
  let videoRankingComplete = true;
  const videoIds = new Set<string>();
  try {
    const ads = await read({ level: 'ad', time_increment: 'all_days' }, ',ad_id,ad_name', row => /^\d+$/.test(String(row.ad_id)) ? String(row.ad_id) : '');
    const candidates = ads.map(row => ({ row, metrics: normalizeMetaPerformance(row) })).filter(item => item.metrics.spend != null && item.metrics.spend > 0).sort((a, b) => b.metrics.spend! - a.metrics.spend!);
    for (const { row, metrics } of candidates.slice(0, 30)) {
      try {
        const asset = await readAccountAdAsset(accountId, row.ad_id, adapter);
        if (asset.videoIds.length && asset.videoIds.every(id => !videoIds.has(id))) {
          asset.videoIds.forEach(id => videoIds.add(id));
          topVideos.push({ adId: row.ad_id, name: String(row.ad_name || row.ad_id), metrics, asset });
        }
      } catch { videoRankingComplete = false; }
      if (topVideos.length === 3) break;
    }
    if (candidates.length > 30 && topVideos.length < 3) videoRankingComplete = false;
  } catch { videoRankingComplete = false; }
  if (!videoRankingComplete) warnings.push('部分广告素材无法核验，高消耗视频仅展示已核验的结果，不作为完整排名。');
  return { source: 'provider', accountId, accountName: String(account.name || accountId), currency: account.currency, timezone: account.timezone_name, window: { since, until }, reportedAt: new Date().toISOString(), actionReportTime: 'impression', useUnifiedAttributionSetting: true,
    totals: totals.length ? normalizeMetaPerformance(totals[0]) : null, daily: daily.map(row => ({ date: row.date_start, ...normalizeMetaPerformance(row) })).sort((a, b) => a.date.localeCompare(b.date)), audiences, topVideos, videoRankingComplete, warnings };
}
export async function getMetaBusinessOverview(tenantId: string, connectionId: string, accountId: string, query: Record<string, unknown>) {
  const days = overviewDays(query);
  return cache(tenantId, `${connectionId}:${accountId}:${days}:${Math.floor(Date.now() / 60_000)}`, async () => {
    const { adapter } = await readGrantedAdapter(tenantId, connectionId, accountId);
    return readMetaBusinessOverview(accountId, days, adapter);
  });
}
