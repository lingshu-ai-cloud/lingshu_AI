export type PlatformAdDecisionEvidence = {
  schemaVersion: 1;
  planVersion: number;
  ruleVersion: string;
  connectionId: string;
  resourceId: string;
  action: 'pause' | 'adjust_budget' | null;
  reason: string;
  evidence: { availability: 'available' | 'unknown'; period: 'last_7d'; fetchedAt: string | null; clicks: number | null; spend: number | null; lifetimeSpend: number | null; currency: string };
  budgetBefore: number | null;
  /** Proposed budget at decision time; execution receipt determines actual outcome. */
  budgetAfter: number | null;
  executionId: string | null;
};
export type PlatformAdWorkerStatus = {
  state: 'unknown' | 'checking' | 'completed' | 'failed' | 'stale';
  configuredEnabled: boolean;
  explanation: string;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  nextCheckAt: string | null;
};
