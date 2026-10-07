import type { WeeklyAgentPlanningState, WeeklyAgentPlanningMutation } from '../../shared/contracts/socialProgram';
import { socialProgramApi } from './socialProgramApi';

/** Shared by the workbench and the real HTTP lifecycle regression. */
export async function advanceWeeklyPlanning(
  programId: string,
  packageId: string,
  packageVersion: number,
  planning: WeeklyAgentPlanningState,
  onProgress: (state: WeeklyAgentPlanningState) => void,
): Promise<WeeklyAgentPlanningState> {
  if (planning.programId !== programId || planning.packageId !== packageId || planning.packageVersion !== packageVersion) {
    throw new Error('周任务包与当前计划不一致，请从后端刷新后重试。');
  }
  const versions = (state: WeeklyAgentPlanningState): WeeklyAgentPlanningMutation => ({
    expectedPackageVersion: packageVersion,
    expectedPlanningVersion: state.version,
  });
  if (planning.status === 'outline_ready') {
    const analyzed = await socialProgramApi.runDirectorPlanning(programId, packageId, versions(planning));
    // Retain successful analysis even if the following merge is interrupted.
    onProgress(analyzed);
    return socialProgramApi.mergeAgentSchedule(programId, packageId, versions(analyzed));
  }
  if (planning.status === 'director_analyzing') return socialProgramApi.mergeAgentSchedule(programId, packageId, versions(planning));
  if (planning.status === 'awaiting_confirmation') return socialProgramApi.confirmAgentSchedule(programId, packageId, versions(planning));
  if (planning.status === 'confirmed') return socialProgramApi.dispatchAgentSchedule(programId, packageId, versions(planning));
  return planning;
}
