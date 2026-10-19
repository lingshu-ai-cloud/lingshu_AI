export interface AssistantWeeklyNavigation {
  programId: string; packageId: string; packageVersion: number;
  taskId?: string; publicationTaskId?: string; repairCaseId?: string;
}
export function readAssistantWeeklyNavigation(search: string): AssistantWeeklyNavigation | null {
  const query = new URLSearchParams(search);
  if (query.get('page') !== 'digitalEmployees' || query.get('weeklyView') !== 'production') return null;
  const programId = query.get('weeklyProgramId') || '', packageId = query.get('weeklyPackageId') || '';
  const packageVersion = Number(query.get('weeklyPackageVersion'));
  if (!programId || !packageId || !Number.isSafeInteger(packageVersion) || packageVersion < 1) return null;
  return { programId, packageId, packageVersion,
    ...(query.get('weeklyTaskId') ? { taskId: query.get('weeklyTaskId')! } : {}),
    ...(query.get('weeklyPublicationTaskId') ? { publicationTaskId: query.get('weeklyPublicationTaskId')! } : {}),
    ...(query.get('weeklyRepairCaseId') ? { repairCaseId: query.get('weeklyRepairCaseId')! } : {}),
  };
}
export function assistantWeeklyNavigationHref(scope: AssistantWeeklyNavigation): string {
  const query = new URLSearchParams({ page: 'digitalEmployees', weeklyView: 'production', weeklyProgramId: scope.programId, weeklyPackageId: scope.packageId, weeklyPackageVersion: String(scope.packageVersion) });
  if (scope.taskId) query.set('weeklyTaskId', scope.taskId);
  if (scope.publicationTaskId) query.set('weeklyPublicationTaskId', scope.publicationTaskId);
  if (scope.repairCaseId) query.set('weeklyRepairCaseId', scope.repairCaseId);
  return `/?${query}`;
}
