import type { PlatformAdWorkerStatus } from '../../shared/platformAdAutomation';
import type { PlatformAdTask } from './platformAds';
export type ManagedRecord = Record<string, unknown>;
export type ManagedSnapshot = { approvals: ManagedRecord[]; executions: ManagedRecord[]; runs: ManagedRecord[]; errors: string[] };
export function managedSummary(tasks: PlatformAdTask[], snapshots: ManagedSnapshot[], now = Date.now()) {
  return {
    authorized: tasks.filter(t => t.managementMode === 'managed' && t.authorization && Date.parse(t.authorization.expiresAt) > now).length,
    pending: snapshots.flatMap(s => s.approvals).filter(r => r.status === 'PENDING').length,
    verified: snapshots.flatMap(s => s.executions).filter(r => r.status === 'VERIFIED').length,
    issues: snapshots.filter(s => s.errors.length || [...s.executions, ...s.approvals, ...s.runs].some(r => ['FAILED', 'UNKNOWN', 'BLOCKED', 'EXTERNAL_CHANGE'].includes(String(r.status)))).length,
  };
}

/** Display only measured numbers; a missing metric is never a zero sample. */
export function managedMetric(value: unknown, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value.toLocaleString('zh-CN', { maximumFractionDigits: digits }) : '未记录';
}
export function managedRecord(value: unknown): ManagedRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ManagedRecord : null;
}

export function managedWorkerView(worker: PlatformAdWorkerStatus | null) {
  if (!worker) return { state: 'unknown', title: '运行状态未知', note: '运行证据尚未返回，不能确认后台是否完成检查。' };
  if (!worker.configuredEnabled) return { state: 'disabled', title: '当前配置未启用', note: '配置未启用；下方历史检查时间不代表现在仍在托管。' };
  const titles = { unknown: '运行状态未知', checking: '最近心跳：检查中', completed: '最近检查已完成', failed: '最近检查失败', stale: '运行证据已过期' };
  return { state: worker.state, title: titles[worker.state] || titles.unknown, note: worker.explanation || '以持久化检查记录为准，检查完成不等于执行了广告操作。' };
}
export function managedDecisionView(run: ManagedRecord) {
  const decision = managedRecord(run.decision);
  if (!decision || decision.schemaVersion !== 1) return null;
  const evidence = managedRecord(decision.evidence);
  const available = evidence?.availability === 'available';
  const clicks = available && typeof evidence?.clicks === 'number' ? evidence.clicks : null;
  const spend = available && typeof evidence?.spend === 'number' ? evidence.spend : null;
  return {
    decision, evidence,
    clicks: managedMetric(clicks, 0), spend: managedMetric(spend),
    cpc: clicks !== null && clicks > 0 && spend !== null && spend >= 0 ? managedMetric(spend / clicks) : '样本不足或未记录',
    before: managedMetric(decision.budgetBefore), after: managedMetric(decision.budgetAfter),
    currency: typeof evidence?.currency === 'string' ? evidence.currency : '币种未记录',
    period: evidence?.period === 'last_7d' ? '平台最近 7 日' : '窗口未记录',
  };
}
