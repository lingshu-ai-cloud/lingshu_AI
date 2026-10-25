import type {
  SocialContentTaskDetail,
  SocialContentTaskSummary,
  SocialContentWorkspace,
} from '../../shared/contracts/socialContentWorkflow';

/** Merge independently fetched task pages without duplicating records or losing a newer local summary. */
export function mergeSocialContentTaskSummaries(
  existing: SocialContentTaskSummary[],
  incoming: SocialContentTaskSummary[],
): SocialContentTaskSummary[] {
  const tasksById = new Map(existing.map(task => [task.taskId, task]));
  for (const task of incoming) {
    const current = tasksById.get(task.taskId);
    const taskUpdatedAt = Date.parse(task.updatedAt);
    const currentUpdatedAt = current ? Date.parse(current.updatedAt) : Number.NEGATIVE_INFINITY;
    const taskVersion = Number(task.version);
    const currentVersion = Number(current?.version);
    if (!current || taskUpdatedAt > currentUpdatedAt
      || (taskUpdatedAt === currentUpdatedAt && Number.isFinite(taskVersion)
        && (!Number.isFinite(currentVersion) || taskVersion > currentVersion))) tasksById.set(task.taskId, task);
  }
  return [...tasksById.values()].sort((left, right) => {
    const recency = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    return recency || left.taskId.localeCompare(right.taskId);
  });
}

export async function restoreSavedSocialContentTask(
  workspace: SocialContentWorkspace,
  savedTaskId: string | null,
  readTask: (taskId: string) => Promise<SocialContentTaskDetail>,
  requireExact = false,
): Promise<SocialContentWorkspace> {
  if (!savedTaskId || workspace.currentTask?.taskId === savedTaskId) return workspace;
  try {
    const task = await readTask(savedTaskId);
    if (task.taskId !== savedTaskId) { if (requireExact) throw new Error('任务身份与当前链接不一致'); return workspace; }
    return {
      ...workspace,
      currentTask: task,
      tasks: mergeSocialContentTaskSummaries(workspace.tasks, [task]),
    };
  } catch (error) {
    if (requireExact) throw error;
    return workspace;
  }
}
