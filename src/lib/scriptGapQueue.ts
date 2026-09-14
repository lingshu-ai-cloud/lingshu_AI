import { authHeader } from './auth';
import type { ScriptGapTask } from './shootingWorkflow';
export type { ScriptGapTask } from './shootingWorkflow';

export const SCRIPT_GAP_QUEUE_EVENT = 'lingshu:script-gap-queue-updated';

async function request<T>(path = '', body?: unknown): Promise<T> {
  const response = await fetch(`/api/overseas/studio/shooting-tasks${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '待拍任务服务暂不可用');
  return result as T;
}

export function readScriptGapTasks(): Promise<ScriptGapTask[]> { return request(); }

export async function updateScriptGapTask(id: string, patch: { uploadedMaterialIds: string[] }): Promise<void> {
  await request(`/${encodeURIComponent(id)}/uploads`, patch);
  window.dispatchEvent(new Event(SCRIPT_GAP_QUEUE_EVENT));
}

export async function createScriptGapTask(input: Omit<ScriptGapTask, 'id' | 'origin' | 'createdAt' | 'uploadedMaterialIds'>): Promise<ScriptGapTask> {
  const task = await request<ScriptGapTask>('', input);
  window.dispatchEvent(new Event(SCRIPT_GAP_QUEUE_EVENT));
  return task;
}
