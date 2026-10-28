import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import type { StoredRecord } from './records.js';
import { evaluatePlannedReferenceReuse } from './viralAnalysisCoverage.js';
import { usableWeeklyImageReference } from './weeklyImageReferences.js';

/** A proposed week is not established until every independent clone has a
 * distinct, production-admissible reference ID. This is a read-only decision. */
export function weeklyReferenceCreationGate(pack: WeeklyPackage, library: StoredRecord[]) {
  const plans = pack.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
  const independentClones = plans.filter(plan => plan.route === 'clone' && plan.productionRole !== 'platform_adaptation');
  const imageSlots = (pack.mixedContentSlots || []).filter(slot => slot.kind === 'image' && slot.productionRole === 'original');
  const imageRecords = new Map(library.filter(usableWeeklyImageReference).map(record => [record.id, record]));
  const imageIds = imageSlots.map(slot => slot.referenceId || '').filter(id => imageRecords.has(id));
  const imageBoundCount = new Set(imageIds).size;
  const result = independentClones.length ? evaluatePlannedReferenceReuse(plans, library, [])
    : { ready: true, requiredCount: 0, reusableCount: 0, missingCount: 0 };
  const videoMissingCount = result.missingCount;
  const imageMissingCount = Math.max(0, imageSlots.length - imageBoundCount);
  return {
    ready: result.ready && imageMissingCount === 0,
    requiredCount: result.requiredCount + imageSlots.length,
    boundCount: result.reusableCount + imageBoundCount,
    missingCount: videoMissingCount + imageMissingCount,
    videoMissingCount,
    imageMissingCount,
  };
}
