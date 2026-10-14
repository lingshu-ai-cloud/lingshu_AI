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

export function scheduledCollectionFailureCanRetry(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  // Repeating invalid credentials or configuration cannot heal them and can
  // create avoidable provider traffic. Network/worker/no-result failures are
  // read-only and safe for the bounded workflow retry policy.
  return !/(?:401|403|unauthori[sz]ed|forbidden|credential|token expired|授权.*失效|missing.*(?:config|scope|keyword)|尚未配置|未启用的关键词)/i.test(message);
}

export function shouldRunScheduledCollection(input: {
  enabled: boolean;
  created: boolean;
  updated: boolean;
  lastRun?: string;
  executionState: string;
  rerunRequestedAt?: string;
  retryAt?: string | null;
  now?: number;
}): boolean {
  if (!input.enabled) return false;
  if (input.created || input.updated || !input.lastRun) return true;
  const lastRunAt = Date.parse(input.lastRun) || 0;
  const explicitRetryDue = (Date.parse(input.rerunRequestedAt || '') || 0) > lastRunAt;
  if (explicitRetryDue) return true;
  const retryAt = Date.parse(input.retryAt || '');
  return ['failed', 'worker_offline', 'no_data'].includes(input.executionState)
    && Number.isFinite(retryAt)
    && retryAt <= (input.now ?? Date.now());
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
  state: 'pending' | 'ready' | 'failed';
  usable: number;
  blockedReason: string;
  latest?: DiscoveryRunRecord;
} {
  const allowed = new Set(scopeIds.filter(Boolean));
  const latest = runs
    .filter(run => !allowed.size || allowed.has(String(run.discoveryScopeId || '')))
    .sort((a, b) => timestamp(b) - timestamp(a))[0];
  if (!latest) return { ready: false, state: 'pending', usable: 0, blockedReason: '定时采集已创建，等待首轮平台采集结果。' };
  const usable = Object.values(latest.modeStats || {}).reduce((sum, row) => sum + Math.max(0, Number(row.accepted || 0)), 0);
  const failedPlatforms = Object.entries(latest.platformStats || {})
    .filter(([, row]) => Number(row.failed || 0) > 0)
    .map(([platform]) => platform);
  const status = String(latest.status || '').toLowerCase();
  const stopReason = String(latest.stopReason || '').toLowerCase();
  const failed = ['failed', 'source_failed'].includes(status)
    || String(latest.stopReason || '').toLowerCase() === 'source_failed';
  const settled = failed
    || ['succeeded', 'completed', 'stopped', 'partial'].includes(status)
    || ['completed', 'no_valid_results'].includes(stopReason)
    || Boolean(latest.finishedAt);
  // A freshly created run is expected to have no accepted results while it is
  // queued/running. Treating that normal state as a failure made weekly work
  // pause immediately after the user clicked Start.
  if (!settled && usable === 0) {
    return { ready: false, state: 'pending', usable, latest, blockedReason: '平台采集正在进行，等待可用内容回写。' };
  }
  if (failed || usable === 0) {
    const platformText = failedPlatforms.length ? `（${failedPlatforms.join('、')}）` : '';
    const detail = String(latest.error || '').trim();
    return { ready: false, state: 'failed', usable, latest, blockedReason: `平台采集失败${platformText}：${detail || '本轮未采集到可用内容'}；当前 ${usable} 条可用内容。` };
  }
  return { ready: true, state: 'ready', usable, latest, blockedReason: '' };
}
