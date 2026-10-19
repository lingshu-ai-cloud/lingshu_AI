export interface WeeklyAuthorizationRecoveryAudit {
  action?: unknown;
  actorUserId?: unknown;
  targetType?: unknown;
  targetId?: unknown;
  metadata?: unknown;
  createdAt?: unknown;
}

export interface WeeklyAuthorizationRecoveryEvent {
  type?: unknown;
  payload?: unknown;
  occurred_at?: unknown;
}

export interface WeeklyAuthorizationRecoveryInput {
  goalId: string;
  planId: string;
  runId: string;
  approvedAt: unknown;
  approvedBy: unknown;
  invalidatedAt: unknown;
  audits: readonly WeeklyAuthorizationRecoveryAudit[];
  events: readonly WeeklyAuthorizationRecoveryEvent[];
}

export type WeeklyAuthorizationRecoveryDecision =
  | { restore: true; actorUserId: string; approvedAt: string; invalidatedAt: string }
  | { restore: false; reason: string };

const AUTHORIZATION_BOUNDARY_ACTIONS = new Set([
  'weekly_package.updated',
  'weekly_package.production_budget_mode_selected',
  'director_direction.adjust',
  'director_direction.abandon',
  'content.node_revised',
  'content.narration_revised',
  'weekly_publication.rescheduled',
  'workflow_task.skip',
  'workflow_task.manual_complete',
  'workflow_task.replan',
]);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function time(value: unknown): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function exactTaskExecutionOnly(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && String(value[0] || '') === 'taskExecution';
}

export function weeklyAuthorizationRecoveryDecision(
  input: WeeklyAuthorizationRecoveryInput,
): WeeklyAuthorizationRecoveryDecision {
  if (String(input.approvedBy || '').trim()) return { restore: false, reason: 'authorization_present' };
  const approvedAtMs = time(input.approvedAt);
  const invalidatedAtMs = time(input.invalidatedAt);
  if (!Number.isFinite(approvedAtMs) || !Number.isFinite(invalidatedAtMs) || invalidatedAtMs <= approvedAtMs) {
    return { restore: false, reason: 'authorization_timestamps_invalid' };
  }

  const approvalAudits = input.audits.filter(audit => {
    const metadata = object(audit.metadata);
    const auditAt = time(audit.createdAt);
    return String(audit.action || '') === 'weekly_goal.approved'
      && String(audit.targetType || '') === 'weekly_goal'
      && String(audit.targetId || '') === input.goalId
      && String(metadata.planId || '') === input.planId
      && String(metadata.runId || '') === input.runId
      && String(audit.actorUserId || '').trim().length > 0
      && Number.isFinite(auditAt)
      && Math.abs(auditAt - approvedAtMs) <= 5 * 60_000;
  });
  if (approvalAudits.length !== 1) return { restore: false, reason: 'approval_audit_not_unique' };

  const boundaryAudit = input.audits.find(audit => {
    const auditAt = time(audit.createdAt);
    if (!Number.isFinite(auditAt) || auditAt <= approvedAtMs) return false;
    const metadata = object(audit.metadata);
    const belongsToRun = String(metadata.runId || '') === input.runId
      || String(audit.targetId || '') === input.planId
      || String(audit.targetId || '') === input.goalId;
    return belongsToRun && AUTHORIZATION_BOUNDARY_ACTIONS.has(String(audit.action || ''));
  });
  if (boundaryAudit) return { restore: false, reason: 'business_boundary_changed' };

  const invalidations = input.events.filter(event => (
    String(event.type || '') === 'authorization_required'
    && time(event.occurred_at) > approvedAtMs
    && time(event.occurred_at) <= invalidatedAtMs + 5 * 60_000
  ));
  if (invalidations.length === 0) return { restore: false, reason: 'invalidation_evidence_missing' };
  if (invalidations.some(event => {
    const payload = object(event.payload);
    return String(payload.reason || '') !== 'package_adjusted'
      || !exactTaskExecutionOnly(payload.changedFields);
  })) return { restore: false, reason: 'invalidation_changed_business_boundary' };

  const latestInvalidationAt = Math.max(...invalidations.map(event => time(event.occurred_at)));
  if (Math.abs(latestInvalidationAt - invalidatedAtMs) > 5 * 60_000) {
    return { restore: false, reason: 'invalidation_receipt_mismatch' };
  }

  return {
    restore: true,
    actorUserId: String(approvalAudits[0]!.actorUserId).trim(),
    approvedAt: new Date(approvedAtMs).toISOString(),
    invalidatedAt: new Date(invalidatedAtMs).toISOString(),
  };
}
