import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import type { StoredRecord } from './records.js';
import { evaluatePlannedReferenceReuse } from './viralAnalysisCoverage.js';

/** A proposed week is not established until every independent clone has a
 * distinct, production-admissible reference ID. This is a read-only decision. */
export function weeklyReferenceCreationGate(pack: WeeklyPackage, library: StoredRecord[]) {
  const plans = pack.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
  const independentClones = plans.filter(plan => plan.route === 'clone' && plan.productionRole !== 'platform_adaptation');
  if (!independentClones.length) return { ready: true, requiredCount: 0, boundCount: 0, missingCount: 0 };
  const result = evaluatePlannedReferenceReuse(plans, library, []);
  return {
    ready: result.ready,
    requiredCount: result.requiredCount,
    boundCount: result.reusableCount,
    missingCount: result.missingCount,
  };
}
