import { authHeader } from './auth';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation';
import type { SocialImageLayerGraph } from '../../shared/contracts/socialImageLayerGraph';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/overseas/social-images${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...authHeader(), ...(init?.headers || {}) },
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), { status: response.status, payload });
  return payload;
}

export const socialImageApi = {
  createTask: (input: Record<string, unknown>) => request<{ ok: true; task: SocialImageCreationTask }>('/tasks', { method: 'POST', body: JSON.stringify(input) }),
  createFromReference: (input: Record<string, unknown>) => request<{ ok: true; task: SocialImageCreationTask }>('/tasks/from-reference', { method: 'POST', body: JSON.stringify(input) }),
  getTask: (id: string) => request<{ ok: true; task: SocialImageCreationTask }>(`/tasks/${encodeURIComponent(id)}`),
  updateTask: (task: SocialImageCreationTask, patch: Partial<SocialImageCreationTask>) => request<{ ok: true; task: SocialImageCreationTask }>(`/tasks/${encodeURIComponent(task.id)}`, {
    method: 'PATCH', body: JSON.stringify({ expectedVersion: task.version, patch }),
  }),
  runPreflight: (task: SocialImageCreationTask) => request<{ ok: true; task: SocialImageCreationTask }>(`/tasks/${encodeURIComponent(task.id)}/quality/preflight`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: task.version }),
  }),
  compileLayered: (task: SocialImageCreationTask) => request<{ ok: true; task: SocialImageCreationTask; layerGraph: SocialImageLayerGraph }>(`/tasks/${encodeURIComponent(task.id)}/compile-layered`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: task.version }),
  }),
  renderLayered: (task: SocialImageCreationTask) => request<{ ok: true; task: SocialImageCreationTask; layerGraph: SocialImageLayerGraph; url: string; sha256: string; mimeType: string }>(`/tasks/${encodeURIComponent(task.id)}/render-layered`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: task.version }),
  }),
  repairLayered: (task: SocialImageCreationTask, instruction: string) => request<{ ok: true; task: SocialImageCreationTask; layerGraph: SocialImageLayerGraph; targetLayer: string }>(`/tasks/${encodeURIComponent(task.id)}/repair-layered`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: task.version, instruction }),
  }),
};
