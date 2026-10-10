import type { PlatformAdMetricResource } from '../../shared/platformAdMetricHistory.js';
import { getPlatformAdTask } from './tasks.js';
import { listAdExecutions } from './execution.js';
import { getConnectionCredential } from './connections.js';
import { MetaAdsAdapter, AdProviderError } from './metaAdapter.js';
import { TikTokExecutionAdapter } from './tiktokExecutionAdapter.js';
import { getTikTokCampaignMetrics } from './tiktokMetrics.js';

type MetricRow = { date_start?: string; date_stop?: string; spend?: string; impressions?: string; clicks?: string; inline_link_clicks?: string; video_thruplay_watched_actions?: Array<{ action_type: string; value: string }> };
const number = (value: unknown) => value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0 ? null : Number(value);
const sum = (values: Array<number | null>) => values.every(value => value !== null) ? values.reduce<number>((total, value) => total + value!, 0) : null;

export function aggregateAdMetrics(rows: MetricRow[], goal: string) {
  const videoGoal = goal === '提升有效视频观看';
  const clickGoal = goal === '提升网站访问';
  const daily = rows.map(row => ({
    date: row.date_start || '', spend: number(row.spend), impressions: number(row.impressions), clicks: number(row.clicks),
    results: videoGoal ? number(row.video_thruplay_watched_actions?.find(item => item.action_type === 'video_view')?.value) : clickGoal ? number(row.inline_link_clicks) : null,
  }));
  if (!rows.length) return { spend: null, impressions: null, clicks: null, results: null, costPerResult: null, daily, metricLabel: videoGoal ? 'Meta ThruPlay' : clickGoal ? '链接点击' : '目标口径尚未映射' };
  const spend = sum(daily.map(day => day.spend)), results = sum(daily.map(day => day.results));
  return { spend, impressions: sum(daily.map(day => day.impressions)), clicks: sum(daily.map(day => day.clicks)), results,
    costPerResult: spend !== null && results !== null && results > 0 ? spend / results : null,
    daily, metricLabel: videoGoal ? 'Meta ThruPlay' : clickGoal ? '链接点击' : '目标口径尚未映射' };
}

export async function getAdTaskMetrics(tenantId: string, taskId: string) {
  const task = await getPlatformAdTask(tenantId, taskId);
  if (!task) throw new AdProviderError('未找到投放任务', 'NOT_FOUND');
  const executions = await listAdExecutions(tenantId, taskId);
  const creates = executions.filter(item => item.action === 'create' && item.status === 'VERIFIED' && item.resourceId);
  if (!creates.length) return {
    status: 'not_ready', source: 'none', currency: task.currency, reportedAt: '',
    spend: null, impressions: null, clicks: null, results: null, costPerResult: null, daily: [],
    metricLabel: task.goal === '提升网站访问' ? '链接点击' : task.goal === '提升有效视频观看' ? '视频观看' : '目标口径尚未映射',
    reason: '尚无已核验的平台计划，效果数据未就绪。',
    forecast: { status: 'insufficient_data', reason: '尚无已核验的平台计划及平台报告，不提供预测。' },
    dataNote: '当前仅有本地计划或尚未核验的执行记录，未读取平台效果；空值不表示零消耗。',
  };
  const today = new Date();
  const until = today.toISOString().slice(0, 10);
  const since = new Date(today.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  const firstConnection = await getConnectionCredential(tenantId, creates[0].connectionId);
  if (firstConnection.connection.provider === 'tiktok') {
    if (creates.length !== 1 || firstConnection.connection.currency !== task.currency) throw new AdProviderError('不同渠道或币种效果不能混合汇总', 'METRICS_NOT_READY');
    const ids = creates[0].result as { adgroupId?: string } | undefined;
    if (!ids?.adgroupId) throw new AdProviderError('缺少已核验的 TikTok 广告组', 'METRICS_NOT_READY');
    const group = await new TikTokExecutionAdapter(firstConnection.accessToken).read(firstConnection.connection.accountId, 'adgroup', ids.adgroupId);
    if (String(group.campaign_id) !== creates[0].resourceId) throw new AdProviderError('TikTok 广告组关联已变化', 'RESOURCE_MISMATCH');
    const result = await getTikTokCampaignMetrics({ accessToken: firstConnection.accessToken, accountId: firstConnection.connection.accountId, campaignId: creates[0].resourceId, since, until, optimizationGoal: String(group.optimization_goal || '') });
    return { ...result, resources: [{ provider: 'tiktok' as const, accountId: firstConnection.connection.accountId, campaignId: creates[0].resourceId, currency: task.currency, metricDefinition: `tiktok:${String(group.optimization_goal || 'unknown')}`, metricLabel: result.metricLabel, reportTimezone: '', daily: result.daily }], currency: task.currency, forecast: { status: 'insufficient_data', reason: '当前展示平台报告值；尚未建立经过验证的收益预测模型。' } };
  }
  const rows: MetricRow[] = [];
  const resources: PlatformAdMetricResource[] = [];
  const seen = new Set<string>();
  for (const item of creates) {
    const key = `${item.connectionId}:${item.resourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { connection, accessToken } = await getConnectionCredential(tenantId, item.connectionId);
    if (connection.provider !== 'meta' || connection.currency !== task.currency) throw new AdProviderError('此计划存在尚未支持合并口径的渠道或币种', 'METRICS_NOT_READY');
    const adapter = new MetaAdsAdapter(accessToken);
    await adapter.assertOwnership(connection.accountId, item.resourceId);
    const response = await adapter.request(`${item.resourceId}/insights`, {
      fields: 'date_start,date_stop,spend,impressions,clicks,inline_link_clicks,video_thruplay_watched_actions',
      time_range: { since, until }, time_increment: 1, limit: 100,
    });
    if (!Array.isArray(response.data) || response.paging?.next) throw new AdProviderError('效果数据不完整，请稍后重试', 'METRICS_NOT_READY');
    const aggregated = aggregateAdMetrics(response.data, task.goal);
    const resourceKey = `${connection.accountId}:${item.resourceId}`;
    if (resources.some(resource => `${resource.accountId}:${resource.campaignId}` === resourceKey)) continue;
    resources.push({ provider: 'meta', accountId: connection.accountId, campaignId: item.resourceId, currency: task.currency, metricDefinition: task.goal === '提升有效视频观看' ? 'meta:thruplay' : task.goal === '提升网站访问' ? 'meta:inline_link_clicks' : 'meta:unmapped', metricLabel: aggregated.metricLabel, reportTimezone: '', daily: aggregated.daily });
    rows.push(...response.data);
  }
  return { provider: 'meta', currency: task.currency, reportedAt: new Date().toISOString(), window: { since, until },
    source: 'provider', resources, ...aggregateAdMetrics(rows, task.goal),
    forecast: { status: 'insufficient_data', reason: '当前展示平台报告值；尚未建立经过验证的收益预测模型。' },
    dataNote: '时间范围以广告账户时区解释，平台报告可能延迟或回补；空数据不表示零消耗。',
  };
}
