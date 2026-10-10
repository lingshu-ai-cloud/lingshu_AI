import type { PlatformAdDecisionEvidence } from '../../shared/platformAdAutomation.js';
import type { AdAutomationRule, AdAutomationMetrics } from './automation.js';
import type { PlatformAdTask } from './tasks.js';
export function buildDecisionEvidence(task: PlatformAdTask, rule: AdAutomationRule, reason: string, metrics?: AdAutomationMetrics, action: PlatformAdDecisionEvidence['action'] = null, dailyBudget?: number, executionId?: string): PlatformAdDecisionEvidence {
  const finite = (value: number | undefined) => value !== undefined && Number.isFinite(value) ? value : null;
  return { schemaVersion: 1, planVersion: task.version, ruleVersion: rule.updatedAt, connectionId: rule.connectionId, resourceId: rule.resourceId, action, reason,
    evidence: { availability: metrics ? 'available' : 'unknown', period: 'last_7d', fetchedAt: metrics?.fetchedAt || null, clicks: finite(metrics?.clicks), spend: finite(metrics?.spend), lifetimeSpend: finite(metrics?.lifetimeSpend), currency: task.currency },
    budgetBefore: finite(metrics?.dailyBudget), budgetAfter: action === 'adjust_budget' ? finite(dailyBudget) : finite(metrics?.dailyBudget), executionId: executionId || null };
}
