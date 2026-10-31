import { META_AD_GOALS, metaAdObjective } from '../../shared/metaAdObjectives.js';
import type { PlatformAdMetricResource } from '../../shared/platformAdMetricHistory.js';
import { getPlatformAdTask } from './tasks.js';
import { listAdExecutions } from './execution.js';
import { getConnectionCredential } from './connections.js';
import { MetaAdsAdapter, AdProviderError } from './metaAdapter.js';
import { TikTokExecutionAdapter } from './tiktokExecutionAdapter.js';
import { getTikTokCampaignMetrics } from './tiktokMetrics.js';
import { listAdImports } from './imports.js';
import { metaAccountDate, metaDateRange } from '../../shared/metaPerformance.js';
import { importedMetaMetricResource } from './metaImportedDelivery.js';
import { resolveAdReportWindow, type AdReportPeriod } from '../../shared/adReportPeriod.js';

type MetricRow = { actions?: Array<{ action_type: string; value: string }>; date_start?: string; date_stop?: string; spend?: string; impressions?: string; clicks?: string; inline_link_clicks?: string; video_thruplay_watched_actions?: Array<{ action_type: string; value: string }> };
const number = (value: unknown) => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const sum = (values: Array<number | null>) => values.every(value => value !== null) ? values.reduce<number>((total, value) => total + value!, 0) : null;

export function aggregateAdMetrics(rows: MetricRow[], goal: string) {
  const videoGoal = goal === '提升有效视频观看';
  const clickGoal = goal === '提升网站访问';
  const spec = (META_AD_GOALS as readonly string[]).includes(goal) ? metaAdObjective(goal) : null;
  const label = spec?.metricLabel || '目标口径尚未映射';
  const daily = rows.map(row => ({
    date: row.date_start || '', spend: number(row.spend), impressions: number(row.impressions), clicks: number(row.clicks),
    results: videoGoal ? number(row.video_thruplay_watched_actions?.find(item => item.action_type === 'video_view')?.value) : clickGoal ? number(row.inline_link_clicks) : spec ? number(row.actions?.find(item => item.action_type === spec.metric)?.value) : null,
  }));
  if (!rows.length) return { spend: null, impressions: null, clicks: null, results: null, costPerResult: null, daily, metricLabel: label };
  const spend = sum(daily.map(day => day.spend)), results = sum(daily.map(day => day.results));
  return { spend, impressions: sum(daily.map(day => day.impressions)), clicks: sum(daily.map(day => day.clicks)), results,
    costPerResult: spend !== null && results !== null && results > 0 ? spend / results : null,
    daily, metricLabel: label };
}

/** Missing reports remain unknown; daily entries from separate resources must not masquerade as distinct days. */
export function aggregateMetaResources(reports: MetricRow[][], goal: string) {
  const parts = reports.map(rows => aggregateAdMetrics(rows, goal));
  if (!parts.length) return aggregateAdMetrics([], goal);
  const complete = parts.every(part => part.daily.length > 0);
  const spend = complete ? sum(parts.map(part => part.spend)) : null;
  const results = complete ? sum(parts.map(part => part.results)) : null;
  const dates = [...new Set(parts.flatMap(part => part.daily.map(day => day.date)))].sort();
  const daily = dates.map(date => {
    const days = parts.map(part => part.daily.find(day => day.date === date));
    const total = (field: 'spend' | 'impressions' | 'clicks' | 'results') => days.every(Boolean) ? sum(days.map(day => day![field])) : null;
    return { date, spend: total('spend'), impressions: total('impressions'), clicks: total('clicks'), results: total('results') };
  });
  return { spend, impressions: complete ? sum(parts.map(part => part.impressions)) : null, clicks: complete ? sum(parts.map(part => part.clicks)) : null, results,
    costPerResult: spend !== null && results !== null && results > 0 ? spend / results : null, daily, metricLabel: parts[0].metricLabel };
}

export function validateMetaMetricRows(rows: unknown[], accountId: string, campaignId: string, currency: string, since: string, until: string) {
  const validDates = new Set(metaDateRange(since, until)), seen = new Set<string>();
  if (!validDates.size) throw new AdProviderError('广告报告日期范围无效', 'INVALID_RESPONSE');
  for (const value of rows) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdProviderError('广告报告格式异常', 'INVALID_RESPONSE');
    const row = value as Record<string, unknown>, date = row.date_start;
    if (String(row.account_id) !== accountId.replace(/^act_/, '') || String(row.campaign_id) !== campaignId || row.account_currency !== currency || typeof date !== 'string' || row.date_stop !== date || !validDates.has(date) || seen.has(date)) throw new AdProviderError('广告报告归属或日期不完整', 'INVALID_RESPONSE');
    seen.add(date);
  }
}

export async function getAdTaskMetrics(tenantId: string, taskId: string, period: AdReportPeriod = 7) {
  const task = await getPlatformAdTask(tenantId, taskId);
  if (!task) throw new AdProviderError('未找到投放任务', 'NOT_FOUND');
  const executions = await listAdExecutions(tenantId, taskId);
  const imported = task.creationSource === 'platform_import' ? importedMetaMetricResource(taskId, tenantId, await listAdImports(tenantId, taskId)) : null;
  const creates = imported ? [{ connectionId: imported.connectionId, resourceId: imported.campaignId, result: undefined }] : executions.filter(item => item.action === 'create' && item.status === 'VERIFIED' && item.resourceId);
  if (!creates.length) return {
    status: 'not_ready', source: 'none', currency: task.currency, reportedAt: '',
    spend: null, impressions: null, clicks: null, results: null, costPerResult: null, daily: [],
    metricLabel: (META_AD_GOALS as readonly string[]).includes(task.goal) ? metaAdObjective(task.goal).metricLabel : '目标口径尚未映射',
    reason: '尚无已核验的平台计划，效果数据未就绪。',
    forecast: { status: 'insufficient_data', reason: '尚无已核验的平台计划及平台报告，不提供预测。' },
    dataNote: '当前仅有本地计划或尚未核验的执行记录，未读取平台效果；空值不表示零消耗。',
  };
  const firstConnection = await getConnectionCredential(tenantId, creates[0].connectionId);
  if (imported && (firstConnection.connection.provider !== 'meta' || firstConnection.connection.accountId.replace(/^act_/, '') !== imported.accountId.replace(/^act_/, '') || firstConnection.connection.currency !== task.currency)) throw new AdProviderError('导入计划账户或币种不匹配', 'ACCOUNT_MISMATCH');
  const timezone = firstConnection.connection.timezoneName || '';
  if (firstConnection.connection.provider === 'meta' && !timezone) throw new AdProviderError('账户时区未核验，无法读取准确的报告范围', 'METRICS_NOT_READY');
  const today = timezone ? metaAccountDate(timezone) : new Date().toISOString().slice(0, 10);
  let since: string, until: string;
  try { ({ since, until } = resolveAdReportWindow(period, today)); }
  catch { throw new AdProviderError('请选择有效的历史日期或统计周期', 'INVALID_INPUT'); }
  if (firstConnection.connection.provider === 'tiktok') {
    if (creates.length !== 1 || firstConnection.connection.currency !== task.currency) throw new AdProviderError('不同渠道或币种效果不能混合汇总', 'METRICS_NOT_READY');
    const ids = creates[0].result as { adgroupId?: string } | undefined;
    if (!ids?.adgroupId) throw new AdProviderError('缺少已核验的 TikTok 广告组', 'METRICS_NOT_READY');
    const group = await new TikTokExecutionAdapter(firstConnection.accessToken).read(firstConnection.connection.accountId, 'adgroup', ids.adgroupId);
    if (String(group.campaign_id) !== creates[0].resourceId) throw new AdProviderError('TikTok 广告组关联已变化', 'RESOURCE_MISMATCH');
    const result = await getTikTokCampaignMetrics({ accessToken: firstConnection.accessToken, accountId: firstConnection.connection.accountId, campaignId: creates[0].resourceId, since, until, optimizationGoal: String(group.optimization_goal || '') });
    return { ...result, window: { since, until }, resources: [{ provider: 'tiktok' as const, accountId: firstConnection.connection.accountId, campaignId: creates[0].resourceId, currency: task.currency, metricDefinition: `tiktok:${String(group.optimization_goal || 'unknown')}`, metricLabel: result.metricLabel, reportTimezone: '', daily: result.daily }], currency: task.currency, forecast: { status: 'insufficient_data', reason: '当前展示平台报告值；尚未建立经过验证的收益预测模型。' } };
  }
  const reports: MetricRow[][] = [];
  const resources: PlatformAdMetricResource[] = [];
  const seen = new Set<string>();
  const fingerprint = (connection: typeof firstConnection.connection) => JSON.stringify([connection.provider, connection.accountId, connection.currency, connection.timezoneName, connection.status, connection.tokenCipher, connection.updatedAt, connection.authorization]);
  const checkedConnections = new Map<string, string>([[firstConnection.connection.id, fingerprint(firstConnection.connection)]]);
  for (const item of creates) {
    const key = `${item.connectionId}:${item.resourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { connection, accessToken } = await getConnectionCredential(tenantId, item.connectionId);
    const identity = fingerprint(connection), previous = checkedConnections.get(item.connectionId);
    if (previous && previous !== identity) throw new AdProviderError('广告账户授权已变化，请重新查询', 'AUTH_CHECK_STALE');
    checkedConnections.set(item.connectionId, identity);
    if (connection.provider !== 'meta' || connection.currency !== task.currency) throw new AdProviderError('此计划存在尚未支持合并口径的渠道或币种', 'METRICS_NOT_READY');
    if (connection.timezoneName !== timezone) throw new AdProviderError('不同时区的平台报告不能合并', 'METRICS_NOT_READY');
    const adapter = new MetaAdsAdapter(accessToken);
    await adapter.assertOwnership(connection.accountId, item.resourceId);
    const response = await adapter.request(`${item.resourceId}/insights`, {
      fields: 'account_id,campaign_id,account_currency,date_start,date_stop,spend,impressions,clicks,inline_link_clicks,video_thruplay_watched_actions,actions',
      time_range: { since, until }, time_increment: 1, limit: 100,
    });
    if (!Array.isArray(response.data) || response.paging?.next) throw new AdProviderError('效果数据不完整，请稍后重试', 'METRICS_NOT_READY');
    validateMetaMetricRows(response.data, connection.accountId, item.resourceId, task.currency, since, until);
    const aggregated = aggregateAdMetrics(response.data, task.goal);
    const resourceKey = `${connection.accountId}:${item.resourceId}`;
    if (resources.some(resource => `${resource.accountId}:${resource.campaignId}` === resourceKey)) continue;
    resources.push({ provider: 'meta', accountId: connection.accountId, campaignId: item.resourceId, currency: task.currency, metricDefinition: (META_AD_GOALS as readonly string[]).includes(task.goal) ? metaAdObjective(task.goal).definition : 'meta:unmapped', metricLabel: aggregated.metricLabel, reportTimezone: connection.timezoneName || '', daily: aggregated.daily });
    reports.push(response.data);
  }
  for (const [connectionId, identity] of checkedConnections) {
    const current = await getConnectionCredential(tenantId, connectionId);
    if (fingerprint(current.connection) !== identity) throw new AdProviderError('广告账户授权已变化，请重新查询', 'AUTH_CHECK_STALE');
  }
  return { provider: 'meta', currency: task.currency, reportedAt: new Date().toISOString(), window: { since, until },
    source: 'provider', resources, ...aggregateMetaResources(reports, task.goal),
    forecast: { status: 'insufficient_data', reason: '当前展示平台报告值；尚未建立经过验证的收益预测模型。' },
    dataNote: `展示该计划${typeof period === 'string' ? period : `近${period}天`}的平台广告消耗，不是账户充值或结算扣款；时间范围以广告账户时区解释，平台报告可能延迟或回补。`,
  };
}
