import { authHeader } from './auth';
import type { AvatarJob, ProductionDefaults, ShotProduction, PresenterAsset } from './shotProduction';
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/overseas/studio/production${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `服务请求失败 (${response.status})`);
  return value;
}
export const productionApi = {
  defaults: () => request<ProductionDefaults>('/defaults'),
  saveDefaults: (value: ProductionDefaults) => request<ProductionDefaults>('/defaults', value),
  capabilities: () => request<{ configured: boolean; reason: string; costPerSecond: number | null }>('/capabilities'),
  jobs: (projectId: string) => request<AvatarJob[]>(`/jobs?projectId=${encodeURIComponent(projectId)}`),
  submit: (body: { projectId: string; assemblyId: string; shotId: string; fingerprint: string; shot: ShotProduction; presenter: PresenterAsset; ratio: string; requestId: string; confirmed: boolean }) => request<AvatarJob>('/jobs', body),
  refresh: (id: string) => request<AvatarJob>(`/jobs/${encodeURIComponent(id)}/refresh`, {}),
};
