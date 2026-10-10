import { cyclesOverlap } from './continuationPolicy.js';
import { isDigitalEmployeeOperatingGoal } from './overviewGoalScope.js';

type OperatingGoal = {
  id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  metric?: unknown;
  scope?: unknown;
};

type OperatingRun = { id: string; goal_id: string; status: string };

function terminalRun(run: OperatingRun): boolean {
  return ['succeeded', 'failed', 'cancelled'].includes(run.status);
}

/** Shared storage also contains independent social-video execution lineage. */
export async function findOperatingGoalConflict<G extends OperatingGoal, R extends OperatingRun>(input: {
  goal: G;
  goals: readonly G[];
  runs: readonly R[];
  allowDisjoint: boolean;
  loadGoal: (id: string) => Promise<G | null>;
}): Promise<{ goal: G | null; run: R | null } | null> {
  const goalsById = new Map(input.goals.map(goal => [goal.id, goal]));
  const otherLiveRuns = input.runs.filter(run => run.goal_id !== input.goal.id && !terminalRun(run));
  // Resolve missing lineage even when overlapping cycles are prohibited. Its
  // business identity, not only its date range, determines whether it applies.
  const missingIds = [...new Set(otherLiveRuns.map(run => run.goal_id).filter(id => !goalsById.has(id)))];
  const missingGoals = await Promise.all(missingIds.map(id => input.loadGoal(id)));
  missingGoals.forEach((goal, index) => {
    if (goal?.id === missingIds[index]) goalsById.set(goal.id, goal);
  });
  const conflicts = (goal: G | undefined) => {
    if (!goal) return true;
    if (!isDigitalEmployeeOperatingGoal(goal)) return false;
    return !input.allowDisjoint || cyclesOverlap(input.goal, goal);
  };

  // Inspect live runs before stale goal status: one completed attempt must not
  // conceal a second active attempt for the same operating goal.
  const run = otherLiveRuns.find(candidate => conflicts(goalsById.get(candidate.goal_id)));
  if (run) return { goal: goalsById.get(run.goal_id) || null, run };

  const goal = [...goalsById.values()].find(candidate => candidate.id !== input.goal.id
    && ['active', 'paused'].includes(candidate.status)
    && conflicts(candidate)
    && !input.runs.some(run => run.goal_id === candidate.id && terminalRun(run)));
  return goal ? { goal, run: null } : null;
}
