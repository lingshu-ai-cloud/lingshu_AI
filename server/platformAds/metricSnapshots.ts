import { createHash } from 'node:crypto';
import type { PlatformAdMetricHistory, PlatformAdMetricResource, PlatformAdMetricSnapshot, PlatformAdMetricValues } from '../../shared/platformAdMetricHistory.js';
import { store } from '../storage/index.js';
import type { DataStore } from '../storage/datastore.js';
import { getAdTaskMetrics } from './metrics.js';
import { getPlatformAdTask } from './tasks.js';
import { withPlatformAdTaskLock } from './taskLock.js';
export const AD_METRIC_SNAPSHOTS = 'platform_ad_metric_snapshots';
type StoredSnapshot = PlatformAdMetricSnapshot & { tenant_id: string; taskIds: string[] };
export class AdMetricSnapshotError extends Error { constructor(message: string, public status = 503) { super(message); } }
const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export function metricHistoryWindow(since: unknown, until: unknown) {
  if (!validDate(since) || !validDate(until) || since > until || Date.parse(until) - Date.parse(since) > 365 * 86400000) throw new AdMetricSnapshotError('日期须为有效日期，范围不超过 366 天', 400);
  return { since, until };
}
type Report = { source: string; reportedAt: string; window?: { since: string; until: string }; resources?: PlatformAdMetricResource[] };
export function createAdMetricSnapshotService(deps: { dataStore: DataStore; taskExists: (tenantId: string, taskId: string) => Promise<unknown>; readMetrics: (tenantId: string, taskId: string) => Promise<Report>; lock: typeof withPlatformAdTaskLock; now?: () => Date }) {
  async function assertTask(tenantId: string, taskId: string) { if (!await deps.taskExists(tenantId, taskId)) throw new AdMetricSnapshotError('未找到投放计划', 404); }
  return {
    async sync(tenantId: string, taskId: string) {
      return deps.lock(tenantId, 'metric-snapshot-sync', async guard => {
        await assertTask(tenantId, taskId);
        const report = await deps.readMetrics(tenantId, taskId);
        if (report.source !== 'provider' || !report.resources || !report.window || !Number.isFinite(Date.parse(report.reportedAt))) throw new AdMetricSnapshotError('尚无可持久化的平台报告', 409);
        const window = metricHistoryWindow(report.window.since, report.window.until);
        const prepared = new Map<string, StoredSnapshot>();
        for (const resource of report.resources) {
          if (!['meta', 'tiktok'].includes(resource.provider) || !resource.accountId || !resource.campaignId || !/^[A-Z]{3}$/.test(resource.currency) || !resource.metricDefinition) throw new AdMetricSnapshotError('平台报告资源标识不完整');
          for (const row of resource.daily) {
            if (!validDate(row.date) || row.date < window.since || row.date > window.until) throw new AdMetricSnapshotError('平台报告日期超出范围');
            const values: PlatformAdMetricValues = { spend: row.spend, impressions: row.impressions, clicks: row.clicks, results: row.results };
            for (const value of Object.values(values)) if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new AdMetricSnapshotError('平台报告指标无效');
            const id = createHash('sha256').update(JSON.stringify([tenantId, resource.provider, resource.accountId, resource.campaignId, row.date, resource.currency, resource.metricDefinition])).digest('hex').slice(0, 15);
            const { daily: _daily, ...identity } = resource;
            const entry: StoredSnapshot = { ...identity, id, tenant_id: tenantId, taskIds: [taskId], date: row.date, values, reportedAt: report.reportedAt, updatedAt: (deps.now?.() ?? new Date()).toISOString() };
            const duplicate = prepared.get(id);
            if (duplicate && JSON.stringify(duplicate.values) !== JSON.stringify(values)) throw new AdMetricSnapshotError('同一平台资源报告重复且不一致');
            prepared.set(id, entry);
          }
        }
        for (const entry of prepared.values()) {
          await guard.beforeEffect();
          const existing = await deps.dataStore.getById<StoredSnapshot>(AD_METRIC_SNAPSHOTS, entry.id);
          if (existing) {
            if (existing.tenant_id !== tenantId || ['provider', 'accountId', 'campaignId', 'date', 'currency', 'metricDefinition'].some(key => existing[key as keyof StoredSnapshot] !== entry[key as keyof StoredSnapshot]) || !Array.isArray(existing.taskIds)) throw new AdMetricSnapshotError('指标存储归属异常');
            entry.taskIds = [...new Set([...existing.taskIds, taskId])].sort();
            if (!await deps.dataStore.update(AD_METRIC_SNAPSHOTS, entry.id, entry)) throw new AdMetricSnapshotError('指标保存失败');
          } else if (!await deps.dataStore.create(AD_METRIC_SNAPSHOTS, entry)) throw new AdMetricSnapshotError('指标保存失败');
          await guard.beforeEffect();
          const saved = await deps.dataStore.getById<StoredSnapshot>(AD_METRIC_SNAPSHOTS, entry.id);
          if (!saved || Object.keys(entry).some(key => JSON.stringify(saved[key as keyof StoredSnapshot]) !== JSON.stringify(entry[key as keyof StoredSnapshot]))) throw new AdMetricSnapshotError('指标读回校验失败，请检查数据库迁移');
        }
        return { savedRows: prepared.size, window, reportedAt: report.reportedAt, dataNote: '仅同步平台最近 7 天报告；可重复同步修正值，不支持任意历史补采。空报告不补零、不删除已有快照；账户时区未知时明确标为空。' };
      });
    },
    async history(tenantId: string, taskId: string, since: unknown, until: unknown): Promise<PlatformAdMetricHistory> {
      await assertTask(tenantId, taskId);
      const window = metricHistoryWindow(since, until);
      const items: PlatformAdMetricSnapshot[] = [];
      for (let page = 1; ; page++) {
        const result = await deps.dataStore.list<StoredSnapshot>(AD_METRIC_SNAPSHOTS, { where: { tenant_id: tenantId }, page, perPage: 200, sort: 'date' });
        for (const row of result.items) {
          if (row.tenant_id !== tenantId) throw new AdMetricSnapshotError('指标存储归属异常');
          if (!row.taskIds?.includes(taskId) || row.date < window.since || row.date > window.until) continue;
          const { id, provider, accountId, campaignId, date, currency, metricDefinition, metricLabel, reportTimezone, values, reportedAt, updatedAt } = row;
          items.push({ id, provider, accountId, campaignId, date, currency, metricDefinition, metricLabel, reportTimezone, values, reportedAt, updatedAt });
        }
        if (page >= result.totalPages) break;
      }
      return { items, window, source: 'local_snapshots', dataNote: '仅展示已同步快照，不触发平台查询；缺失日期不补零。不同币种及结果口径分别展示；reportTimezone 为空表示账户时区未知。' };
    },
  };
}
const service = createAdMetricSnapshotService({ dataStore: store, taskExists: getPlatformAdTask, readMetrics: getAdTaskMetrics, lock: withPlatformAdTaskLock });
export const syncAdTaskMetricSnapshots = service.sync;
export const getAdTaskMetricHistory = service.history;
