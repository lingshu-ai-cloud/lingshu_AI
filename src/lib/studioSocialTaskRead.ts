import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow';

/** Accept only the requested task while the editor's authenticated read is current. */
export async function readCurrentStudioSocialTask(
  taskId: string,
  read: () => Promise<SocialContentTaskDetail>,
  isCurrent: () => boolean,
  apply: (task: SocialContentTaskDetail) => void,
): Promise<void> {
  if (!isCurrent()) return;
  const task = await read();
  if (!isCurrent()) return;
  if (task.taskId !== taskId || !task.version?.trim()
    || task.sources.some(source => source.taskId !== taskId)
    || task.artifacts.some(artifact => artifact.taskId !== taskId)) {
    throw new Error('工作台任务身份不一致，请返回原任务重新打开。');
  }
  apply(task);
}
