import { beijingDate } from './runtimeSchedule.js';
import { applyManagedPublishingGrant } from './managedPublishingGrant.js';
import type { DigitalEmployeeConfig } from './domain.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';

/** Advance to the current aligned window; never backfill missed paid cycles. */
export function nextManagedCycleWindow(source: { starts_at: string; ends_at: string }, now = new Date()): { startsAt: string; endsAt: string } | null {
  const day = 86_400_000;
  const start = Date.parse(`${source.starts_at}T00:00:00Z`), end = Date.parse(`${source.ends_at}T00:00:00Z`);
  const today = Date.parse(`${beijingDate(now)}T00:00:00Z`);
  const days = (end - start) / day + 1;
  if (![start, end, today].every(Number.isFinite) || !Number.isInteger(days) || days < 1 || days > 31 || today <= end) return null;
  const first = end + day;
  const next = first + Math.floor((today - first) / (days * day)) * days * day;
  return { startsAt: new Date(next).toISOString().slice(0, 10), endsAt: new Date(next + (days - 1) * day).toISOString().slice(0, 10) };
}

/** Repeat only previously approved social work, with unchanged per-cycle quotas. */
export function prepareManagedCyclePackage(source: WeeklyPackage, config: DigitalEmployeeConfig, endsAt: string, recommendations: string[] = [], now = new Date()): { pack: WeeklyPackage; grantId: string } | null {
  if (source.participation !== 'agent' || source.tasks.some(task => task.ownerId)) return null;
  if (!source.directorPlan || !Number.isFinite(source.directorPlan.productionBudget) || source.directorPlan.productionBudget < 0) return null;
  if (!source.tasks.some(task => task.templateId === 'production') || !source.tasks.some(task => task.templateId === 'publishing')) return null;
  const pack = structuredClone(source);
  pack.revision = 1;
  delete pack.reviewTodos;
  pack.tasks = pack.tasks.filter(task => !['customers', 'followup'].includes(task.templateId));
  for (const task of pack.tasks) {
    task.dueAt = endsAt;
    task.sourceProjectIds = [];
    if (task.templateId === 'director') task.notes = [task.notes, ...recommendations.slice(0, 5).map(note => `上周期复盘建议：${note.slice(0, 300)}`)].join('\n').slice(0, 1000);
    task.videoPlans?.forEach(plan => { delete plan.reviewRequirements; });
  }
  if (pack.directorPlan) {
    // The prior approved per-cycle cap is retained, never raised by a review.
    pack.directorPlan.productionReserved = 0;
    pack.directorPlan.productionSpent = 0;
    pack.directorPlan.progress = [];
  }
  const recurring = applyManagedPublishingGrant(pack, config, endsAt, now.toISOString());
  return recurring.grantId ? { pack: recurring.pack, grantId: recurring.grantId } : null;
}
