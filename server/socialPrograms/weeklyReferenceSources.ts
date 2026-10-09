import type { SocialWeeklyPublicationTask, WeeklyReferenceSourcePolicy } from '../../shared/contracts/socialProgram.js';
/** Count mothers once; platform variants inherit the same explicitly frozen source allocation. */
export function allocateWeeklyReferenceSources(publications: SocialWeeklyPublicationTask[], policy: WeeklyReferenceSourcePolicy | null | undefined) {
  const mothers = [...new Set(publications.map(item => item.motherContentId))];
  const ownedCount = policy ? Math.round(mothers.length * policy.ownedPercent / 100) : 0;
  return new Map(mothers.map((id, index) => [id, policy ? index < ownedCount ? 'owned' as const : 'external' as const : 'unknown' as const]));
}
