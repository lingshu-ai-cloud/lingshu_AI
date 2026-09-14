import type { PlatformAdTask } from './platformAds';
export type ManagedRecord = Record<string, unknown>;
export type ManagedSnapshot = { approvals: ManagedRecord[]; executions: ManagedRecord[]; runs: ManagedRecord[]; errors: string[] };
export function managedSummary(tasks: PlatformAdTask[], snapshots: ManagedSnapshot[], now = Date.now()) {
  return {
    authorized: tasks.filter(t => t.managementMode === 'managed' && t.authorization && Date.parse(t.authorization.expiresAt) > now).length,
    pending: snapshots.flatMap(s => s.approvals).filter(r => r.status === 'PENDING').length,
    verified: snapshots.flatMap(s => s.executions).filter(r => r.status === 'VERIFIED').length,
    issues: snapshots.filter(s => s.errors.length || [...s.executions, ...s.approvals, ...s.runs].some(r => ['FAILED', 'UNKNOWN', 'BLOCKED'].includes(String(r.status)))).length,
  };
}
