import { store } from '../../storage/index.js';
import { summarizeCustomerCoverage } from '../customerCoverage.js';
import { AD_METRIC_SNAPSHOTS } from '../../platformAds/metricSnapshots.js';
import { listPlatformAdTasks } from '../../platformAds/tasks.js';
import type { BusinessSceneSelection } from '../../../shared/contracts/assistantBusinessScene.js';
import { inWindow, object, scanTenantRecords } from './readScope.js';
import { readSceneCustomers } from './customerEvidence.js';
export async function customerOverview(tenantId: string, selection: BusinessSceneSelection) {
  const rows = await readSceneCustomers(tenantId);
  const usable = rows.filter(row => row.isReal === true && row.isMock !== true && row.isHistorical !== true && row.readOnly !== true);
  const byStage: Record<string, number> = Object.create(null);
  let activeInPeriod = 0, optedOut = 0;
  for (const row of usable) {
    const key = typeof row.stage === 'string' ? row.stage : 'unknown'; byStage[key] = (byStage[key] || 0) + 1;
    if (row.optedOut === true) optedOut++;
    if (Array.isArray(row.timeline) && row.timeline.map(object).some(t => inWindow(t.timestamp || t.originalTime, selection.from, selection.to))) activeInPeriod++;
  }
  return { ...summarizeCustomerCoverage(rows), state: 'available', authorizedReturnedProfiles: rows.length, usableLiveProfiles: usable.length, activeInPeriod, optedOut, byStage,
    scope: '当前授权读模型范围内的客户档案；不是渠道全量客户，也不是询盘事件、订单或成交统计。历史与测试资料排除；未返回档案的渠道不能推断为零。' };
}
export async function adOverview(tenantId: string, selection: BusinessSceneSelection) {
  const [tasks, snapshots] = await Promise.all([listPlatformAdTasks(tenantId), scanTenantRecords(store, AD_METRIC_SNAPSHOTS, tenantId)]);
  const taskIds = new Set(tasks.map(t => t.id)), groups = new Map<string, { currency: string; metricDefinition: string; accountId: string; timezone: string; values: Record<string, number | null>; rows: number }>();
  const semanticIds = new Set<string>(); let excluded = 0;
  for (const row of snapshots) {
    if (!Array.isArray(row.taskIds) || !row.taskIds.some(id => typeof id === 'string' && taskIds.has(id)) || !inWindow(`${row.date}T12:00:00+08:00`, selection.from, selection.to)) { excluded++; continue; }
    const identity = JSON.stringify([row.provider, row.accountId, row.campaignId, row.date]);
    if (semanticIds.has(identity)) throw Error('ad_snapshot_duplicate_scope'); semanticIds.add(identity);
    const key = JSON.stringify([row.provider, row.accountId, row.currency, row.metricDefinition, row.reportTimezone]);
    const group = groups.get(key) || { currency: String(row.currency || 'unknown'), metricDefinition: String(row.metricDefinition || 'unknown'), accountId: String(row.accountId || ''), timezone: String(row.reportTimezone || 'unknown'), values: { spend: 0, impressions: 0, clicks: 0, results: 0 }, rows: 0 };
    const values = object(row.values);
    for (const metric of Object.keys(group.values)) {
      const value = values[metric];
      group.values[metric] = group.values[metric] === null || typeof value !== 'number' || !Number.isFinite(value) || value < 0 ? null : group.values[metric]! + value;
    }
    group.rows++; groups.set(key, group);
  }
  return { state: 'available', taskCount: tasks.length, statusCounts: tasks.reduce<Record<string, number>>((out, task) => { out[task.status] = (out[task.status] || 0) + 1; return out; }, Object.create(null)), storedSnapshotCount: snapshots.length, excludedSnapshots: excluded, platformAccountHistory: { state: 'not_loaded', reason: '本场景只读本地已同步快照，未调用投流页的账户历史报告；本地无计划或快照不代表平台无历史广告。' }, groups: [...groups.values()],
    scope: '仅汇总原投流模块已同步的所选日期快照，不调用平台、不补零、不表示实时总消耗。不同账户、币种、指标定义及时区分组；未同步日期不能当零。细节请用投流卡选择具体计划读取原多层报告。' };
}
