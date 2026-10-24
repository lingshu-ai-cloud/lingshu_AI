import { authHeader } from './auth';
import type { ScriptGapTask } from './shootingWorkflow';
export { shootingSourceBinding } from '../../shared/shootingReference.js';
export type { ScriptGapTask } from './shootingWorkflow';

export const SCRIPT_GAP_QUEUE_EVENT = 'lingshu:script-gap-queue-updated';

async function request<T>(path = '', body?: unknown): Promise<T> {
  const response = await fetch(`/api/overseas/studio/shooting-tasks${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    ...(body === undefined ? { cache: 'no-store', signal: AbortSignal.timeout(15000) } : {}),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '待拍任务服务暂不可用');
  return result as T;
}

export async function readScriptGapTasks(): Promise<ScriptGapTask[]> {
  const result = await request<ScriptGapTask[]>();
  if (!Array.isArray(result) || result.some(task => !task || typeof task.id !== 'string' || typeof task.title !== 'string')) throw new Error('待拍任务返回格式不正确，请重试');
  return result.map(task => ({ ...task, uploadedMaterialIds: Array.isArray(task.uploadedMaterialIds) ? task.uploadedMaterialIds.filter(id => typeof id === 'string' && id) : [] }));
}

export async function updateScriptGapTask(id: string, patch: { uploadedMaterialIds: string[] }): Promise<void> {
  await request(`/${encodeURIComponent(id)}/uploads`, patch);
  window.dispatchEvent(new Event(SCRIPT_GAP_QUEUE_EVENT));
}

export type BoundShootingTaskInput = Omit<ScriptGapTask, 'id' | 'origin' | 'createdAt' | 'uploadedMaterialIds' | 'referenceClip'>
  & Required<Pick<ScriptGapTask, 'sourceProjectId' | 'sourceAssemblyId' | 'sourceStoryboardSlotId' | 'sourceShotId' | 'requirements'>>;
export async function createScriptGapTask(input: BoundShootingTaskInput): Promise<ScriptGapTask> {
  const task = await request<ScriptGapTask>('', input);
  window.dispatchEvent(new Event(SCRIPT_GAP_QUEUE_EVENT));
  return task;
}
