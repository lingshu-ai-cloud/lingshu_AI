import type { VersionedSocialRef } from '../../shared/contracts/socialProgram.js';
import { parseStoredSocialDirectorPlan } from '../starter198/socialContentDirectorPlan.js';
import { weeklyScriptEvidence } from './socialWeeklyScriptEvidence.js';
import { parseStoredSocialScriptBaseline } from '../starter198/socialContentScriptBaseline.js';

/** A locked, integrity-checked handoff can finish before the rendered video exists. */
export function weeklyStoryboardEvidence(row: Record<string, unknown>, candidateIds: string[]): VersionedSocialRef | null {
  const script = weeklyScriptEvidence(row, candidateIds);
  if (!script) return null;
  const plan = parseStoredSocialDirectorPlan(row.director_plan);
  const baseline = parseStoredSocialScriptBaseline(row.script_baseline);
  if (!plan || plan.status !== 'ready' || plan.lockStatus !== 'locked'
    || !Number.isFinite(Date.parse(plan.lockedAt ?? ''))
    || plan.scriptSource.kind !== 'inspiration_script'
    || Number(plan.scriptSource.baselineVersion) !== script.version
    || !plan.scriptSource.inspirationReference
    || plan.scriptSource.inspirationReference.recordId !== baseline?.match?.inspirationReference?.recordId
    || !candidateIds.includes(plan.scriptSource.inspirationReference.recordId)
    || !plan.scenes.length || plan.qualityGates.some(gate => gate.status === 'blocked')) return null;
  const version = Number(plan.version);
  return Number.isSafeInteger(version) && version > 0
    ? { type: 'starter_social_content_director_plan', id: script.id, version } : null;
}
