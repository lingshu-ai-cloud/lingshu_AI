import { digitalEmployeeApi } from './digitalEmployeeApi';
import { enterpriseFactsRebuildInput, type DigitalEmployeeOverview, type WeeklyGoal } from './digitalEmployees';

/** Rebuild one guarded draft from confirmed facts; never approves or starts it. */
export async function synchronizeWeeklyPlanFacts(
  goal: Pick<WeeklyGoal, 'id' | 'version'>,
  recovery: Readonly<Record<string, unknown>>,
  rebuild: typeof digitalEmployeeApi.rebuildGoalFromLatestFacts = digitalEmployeeApi.rebuildGoalFromLatestFacts,
): Promise<DigitalEmployeeOverview> {
  const input = enterpriseFactsRebuildInput(goal, recovery);
  const updated = await rebuild(goal.id, input);
  if (!updated.goal || updated.goal.id === goal.id || !updated.plan?.businessPackage
    || updated.plan.status !== 'draft' || updated.run)
    throw new Error('新版周计划尚未完整，请刷新后查看。');
  return updated;
}
