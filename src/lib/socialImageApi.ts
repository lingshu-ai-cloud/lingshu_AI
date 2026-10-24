import { authHeader } from './auth';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation';
import type { SocialImageLayerGraph } from '../../shared/contracts/socialImageLayerGraph';
import type { SocialImageDeliveryPackage, SocialImageProductionEvent, SocialImageProductionSnapshot } from '../../shared/contracts/socialImageProduction';

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
  createOrResumeRun: (contentTaskId: string, input: {
    expectedContentTaskVersion: string;
    idempotencyKey: string;
    deliverableKey?: string;
    entrySource: 'assistant' | 'workspace' | 'weekly_package';
    imageType?: SocialImageCreationTask['imageType'];
  }) => request<{ ok: true; task: SocialImageCreationTask; resumed: boolean; snapshot: SocialImageProductionSnapshot }>(
    `/content-tasks/${encodeURIComponent(contentTaskId)}/runs`, {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: JSON.stringify({ ...input, idempotencyKey: undefined }),
    },
  ),
  getTask: (id: string) => request<{ ok: true; task: SocialImageCreationTask }>(`/tasks/${encodeURIComponent(id)}`),
  continueTask: (task: SocialImageCreationTask) => request<{
    ok: true; task: SocialImageCreationTask; snapshot: SocialImageProductionSnapshot;
    advancedNodes: Array<'director_review' | 'delivery'>; deliveryPackage?: SocialImageDeliveryPackage;
  }>(`/tasks/${encodeURIComponent(task.id)}/continue`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: task.version }),
  }),
  getProduction: (id: string, afterSequence = 0) => request<{ ok: true; snapshot: SocialImageProductionSnapshot; events: SocialImageProductionEvent[] }>(
    `/tasks/${encodeURIComponent(id)}/production?afterSequence=${encodeURIComponent(String(afterSequence))}`,
  ),
  prepareEvidence: (task: SocialImageCreationTask) => request<{ ok: true; task: SocialImageCreationTask; snapshot: SocialImageProductionSnapshot }>(
    `/tasks/${encodeURIComponent(task.id)}/evidence/prepare`, {
      method: 'POST', body: JSON.stringify({ expectedVersion: task.version }),
    },
  ),
  compilePaidPlan: (task: SocialImageCreationTask) => request<{ ok: true; task: SocialImageCreationTask; snapshot: SocialImageProductionSnapshot }>(
    `/tasks/${encodeURIComponent(task.id)}/compile-paid-plan`, {
      method: 'POST', body: JSON.stringify({ expectedVersion: task.version }),
    },
  ),
  refreshContentTask: (task: SocialImageCreationTask, expectedContentTaskVersion: string) => request<{
    ok: true; task: SocialImageCreationTask; snapshot: SocialImageProductionSnapshot;
  }>(`/tasks/${encodeURIComponent(task.id)}/refresh-content-task`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: task.version, expectedContentTaskVersion }),
  }),
  runDirectorReview: (task: SocialImageCreationTask, candidateId: string, candidateVersion: number) => request<{
    ok: true; task: SocialImageCreationTask; snapshot: SocialImageProductionSnapshot;
  }>(`/tasks/${encodeURIComponent(task.id)}/director-review`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: task.version, candidateId, candidateVersion }),
  }),
  decideCandidate: (task: SocialImageCreationTask, input: {
    candidateId: string;
    candidateVersion: number;
    expectedContentHash: string;
    decision: 'approved' | 'rejected';
    idempotencyKey: string;
    note?: string;
  }) => request<{ ok: true; task: SocialImageCreationTask; snapshot: SocialImageProductionSnapshot; deliveryPackage?: SocialImageDeliveryPackage }>(
    `/tasks/${encodeURIComponent(task.id)}/decision`, {
      method: 'POST', body: JSON.stringify({ expectedVersion: task.version, ...input }),
    },
  ),
  createDeliveryPackage: (task: SocialImageCreationTask) => request<{
    ok: true; task: SocialImageCreationTask; deliveryPackage: SocialImageDeliveryPackage; snapshot: SocialImageProductionSnapshot;
  }>(`/tasks/${encodeURIComponent(task.id)}/delivery-packages`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: task.version }),
  }),
  reconcileMaterial: (taskId: string, jobId: string) => request<{ ok: true; recovered: true; task: SocialImageCreationTask; materialId: string; url: string }>(`/tasks/${encodeURIComponent(taskId)}/jobs/${encodeURIComponent(jobId)}/reconcile-material`, { method: 'POST' }),
  planUnits: (task: SocialImageCreationTask) => request<{ ok: true; task: SocialImageCreationTask; paidExecutionEnabled: boolean }>(`/tasks/${encodeURIComponent(task.id)}/plan-units`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: task.version }),
  }),
  abandonPlan: (task: SocialImageCreationTask) => request<{ ok: true; task: SocialImageCreationTask }>(`/tasks/${encodeURIComponent(task.id)}/abandon-plan`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: task.version }),
  }),
  finalizeGif: (task: SocialImageCreationTask) => request<{ ok: true; task: SocialImageCreationTask; url: string }>(`/tasks/${encodeURIComponent(task.id)}/finalize-gif`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: task.version }),
  }),
  renderPlannedUnit: async (taskId: string, jobId: string, signal?: AbortSignal): Promise<{ ok: boolean; task?: SocialImageCreationTask; url?: string; error?: string }> => {
    const response = await fetch('/api/overseas/studio/fb-poster/render', {
      method: 'POST', credentials: 'same-origin', signal,
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ imageTaskId: taskId, imageJobId: jobId }),
    });
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; task?: SocialImageCreationTask; url?: string; error?: string };
    return { ...payload, ok: response.ok && payload.ok === true };
  },
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
