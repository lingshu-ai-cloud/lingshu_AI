import { META_PERFORMANCE_FIELDS, metaAccountDate, metaDateRange, type MetaPerformanceReport, type MetaMetricValues, type MetaReportLevel } from '../../shared/metaPerformance.js';
import { readExecutedCreative } from './executedCreative.js';
import { creativeReadCache } from './creativeReadCache.js';
import { PlatformAdCreativeError } from './creatives.js';
const cached = creativeReadCache<MetaPerformanceReport>(60_000);
const accounts = creativeReadCache<{ id: string; name: string; currency: string; timezone_name: string }>(300_000);
const n = (v: unknown) => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
export function normalizeMetaPerformance(row: Record<string, any>): MetaMetricValues {
  return Object.fromEntries(Object.entries(META_PERFORMANCE_FIELDS).map(([key, def]) => {
    const action = 'actionType' in def ? def.actionType : ['thruPlays', 'costPerThruPlay'].includes(key) ? 'video_view' : '';
    const matches = action && Array.isArray(row[def.field]) ? row[def.field].filter((a: any) => a.action_type === action) : [];
    return [key, n(action ? matches.length === 1 ? matches[0].value : null : row[def.field])];
  })) as MetaMetricValues;
}
export function parseMetaPerformanceQuery(input: Record<string, unknown>) {
  if (Object.keys(input).some(k => !['preset', 'since', 'until', 'level'].includes(k)) || Object.values(input).some(v => typeof v !== 'string')) throw new PlatformAdCreativeError('不支持的报告参数');
  const level = input.level || 'campaign';
  if (!['campaign', 'adset', 'ad'].includes(String(level))) throw new PlatformAdCreativeError('无效的报告层级');
  const preset = input.preset || '7';
  if (!['1', '7', '30', 'custom', 'maximum'].includes(String(preset))) throw new PlatformAdCreativeError('无效的报告周期');
  if (preset === 'custom' ? !metaDateRange(String(input.since || ''), String(input.until || '')).length : input.since !== undefined || input.until !== undefined) throw new PlatformAdCreativeError('请选择有效日期，最多 93 天；预设周期不能混用自定义日期');
  return { level: level as MetaReportLevel, preset: String(preset), since: input.since as string | undefined, until: input.until as string | undefined };
}
export async function getMetaPerformanceReport(tenantId: string, executionId: string, input: Record<string, unknown>, source?: { cacheKey: string; read: () => ReturnType<typeof readExecutedCreative> }) {
  const query = parseMetaPerformanceQuery(input);
  // Minute bucket prevents a preset from crossing an account date boundary in cache.
  return cached(tenantId, JSON.stringify([source?.cacheKey || 'current', executionId, query, Math.floor(Date.now() / 60_000)]), async () => {
    const ctx = await (source ? source.read() : readExecutedCreative(tenantId, executionId));
    const account = await accounts(tenantId, JSON.stringify([source?.cacheKey || 'current', ctx.connection.id]), async () => {
      const a = await ctx.adapter.request(`act_${ctx.connection.accountId}`, { fields: 'id,name,currency,timezone_name' });
      if (String(a.id).replace(/^act_/, '') !== ctx.connection.accountId || a.currency !== ctx.connection.currency || !a.timezone_name) throw new PlatformAdCreativeError('账户币种或时区已变化，请先核对账户', 409);
      return { id: ctx.connection.accountId, name: String(a.name || ctx.connection.name), currency: String(a.currency), timezone_name: String(a.timezone_name) };
    });
    const maximum = query.preset === 'maximum';
    const today = metaAccountDate(account.timezone_name); let until = query.until || today;
    let since = query.since || (maximum ? today : new Date(Date.parse(`${until}T12:00:00Z`) - (Number(query.preset) - 1) * 86400000).toISOString().slice(0, 10));
    if (!metaDateRange(since, until).length || until > today) throw new PlatformAdCreativeError('日期超出账户当前日期或 93 天范围');
    const resourceId = query.level === 'campaign' ? ctx.ids.campaignId : query.level === 'adset' ? ctx.ids.adsetId : ctx.ids.adId;
    const object = query.level === 'campaign' ? ctx.campaign : query.level === 'adset' ? ctx.adset : ctx.ad;
    const idField = query.level === 'campaign' ? 'campaign_id' : query.level === 'adset' ? 'adset_id' : 'ad_id';
    const fields = [...new Set(['account_id', 'account_currency', idField, 'date_start', 'date_stop', ...Object.values(META_PERFORMANCE_FIELDS).map(f => f.field)])].join(',');
    const request = { fields, level: query.level, ...(maximum ? { date_preset: 'maximum' } : { time_range: { since, until } }), action_report_time: 'impression', use_unified_attribution_setting: true, limit: 100 };
    const total = await ctx.adapter.request(`${resourceId}/insights`, { ...request, time_increment: 'all_days' });
    // Maximum is Meta's available history, not an unlimited lifetime claim. Do not truncate daily pages.
    const daily = maximum ? { data: [] } : await ctx.adapter.request(`${resourceId}/insights`, { ...request, time_increment: 1 });
    if (maximum && total.data?.length === 1) { since = String(total.data[0].date_start); until = String(total.data[0].date_stop); }
    const validDate = (v: string) => metaDateRange(v, v).length === 1;
    for (const response of [total, daily]) {
      if (!Array.isArray(response.data) || response.paging?.next || response.data.some((r: any) => String(r.account_id) !== account.id || r.account_currency !== account.currency || String(r[idField]) !== resourceId || !validDate(String(r.date_start || '')) || !validDate(String(r.date_stop || '')) || r.date_start > r.date_stop || r.date_start < since || r.date_stop > until || r.date_stop > today)) throw new PlatformAdCreativeError('Meta 报告归属、日期或分页不完整', 503);
    }
    if (total.data.length > 1 || daily.data.some((r: any) => r.date_start !== r.date_stop) || new Set(daily.data.map((r: any) => r.date_start)).size !== daily.data.length || !maximum && (total.data.length === 0) !== (daily.data.length === 0)) throw new PlatformAdCreativeError('Meta 汇总与日数据不一致，请稍后刷新', 503);
    return { source: 'provider', level: query.level, resourceId, executionId, videoId: ctx.videoId, pageId: ctx.pageId, accountId: account.id, accountName: account.name, currency: account.currency, reportTimezone: account.timezone_name,
      configuredStatus: String(object.status || ''), effectiveStatus: String(object.effective_status || ''), objective: String(ctx.campaign.objective || ''), optimizationGoal: query.level === 'campaign' ? '' : String(ctx.adset.optimization_goal || ''),
      adConfiguredStatus: String(ctx.ad.status || ''), adEffectiveStatus: String(ctx.ad.effective_status || ''),
      attributionSpec: Array.isArray(ctx.adset.attribution_spec) ? ctx.adset.attribution_spec.map((a: any) => ({ event_type: String(a.event_type), window_days: Number(a.window_days) })) : [],
      issues: (ctx.ad.issues_info || []).map((i: any) => ({ code: Number(i.error_code), message: String(i.error_summary || '平台广告异常') })),
      window: { since, until }, reportedAt: new Date().toISOString(), actionReportTime: 'impression', useUnifiedAttributionSetting: true,
      totals: total.data.length ? normalizeMetaPerformance(total.data[0]) : null, daily: daily.data.map((r: any) => ({ date: String(r.date_start), ...normalizeMetaPerformance(r) })),
      ...(maximum ? { historyScope: 'maximum' as const, windowAvailable: total.data.length > 0 } : {}),
    } satisfies MetaPerformanceReport;
  });
}
