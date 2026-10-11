export interface ScheduledCollectionRecord {
  id: string;
  task_id?: string;
  updated?: string;
  updated_at?: string;
  config?: unknown;
}

export interface DiscoveryRunRecord {
  id: string;
  discoveryScopeId?: string;
  status?: string;
  stopReason?: string;
  error?: string;
  modeStats?: Record<string, { accepted?: number }>;
  platformStats?: Record<string, { failed?: number }>;
  updated?: string;
  updated_at?: string;
  finishedAt?: string;
}

const timestamp = (row: { updated?: string; updated_at?: string; finishedAt?: string }) =>
  Date.parse(String(row.finishedAt || row.updated || row.updated_at || '')) || 0;

export function canonicalScheduledCollectionRecords(records: ScheduledCollectionRecord[]): ScheduledCollectionRecord[] {
  const canonical = new Map<string, ScheduledCollectionRecord>();
  for (const record of records) {
    const id = String(record.task_id || record.id);
    const previous = canonical.get(id);
    if (!previous || timestamp(record) >= timestamp(previous)) canonical.set(id, record);
  }
  return [...canonical.values()];
}

/** Collection success is provisional: later provider completion can reveal a failed/empty run. */
export function mustReobserveSucceededCollection(taskKey: string, status: string): boolean {
  return taskKey === 'scheduled_source_collection' && status === 'succeeded';
}

export function evaluateScheduledDiscoveryRuns(runs: DiscoveryRunRecord[], scopeIds: string[]): {
  ready: boolean;
  usable: number;
  blockedReason: string;
  latest?: DiscoveryRunRecord;
} {
  const allowed = new Set(scopeIds.filter(Boolean));
  const latest = runs
    .filter(run => !allowed.size || allowed.has(String(run.discoveryScopeId || '')))
    .sort((a, b) => timestamp(b) - timestamp(a))[0];
  if (!latest) return { ready: false, usable: 0, blockedReason: '定时采集已创建，等待首轮平台采集结果。' };
  const usable = Object.values(latest.modeStats || {}).reduce((sum, row) => sum + Math.max(0, Number(row.accepted || 0)), 0);
  const failedPlatforms = Object.entries(latest.platformStats || {})
    .filter(([, row]) => Number(row.failed || 0) > 0)
    .map(([platform]) => platform);
  const failed = ['failed', 'source_failed'].includes(String(latest.status || '').toLowerCase())
    || String(latest.stopReason || '').toLowerCase() === 'source_failed';
  if (failed || usable === 0) {
    const platformText = failedPlatforms.length ? `（${failedPlatforms.join('、')}）` : '';
    const detail = String(latest.error || '').trim();
    return { ready: false, usable, latest, blockedReason: `平台采集失败${platformText}：${detail || '本轮未采集到可用内容'}；当前 ${usable} 条可用内容。` };
  }
  return { ready: true, usable, latest, blockedReason: '' };
}
