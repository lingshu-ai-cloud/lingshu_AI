import { authHeader } from './auth';
import type { MaterialConsumer, WeeklyMaterialRequest } from '../../server/socialPrograms/weeklyMaterialRequests';
type Create = { requirementKey: string; requirements: string; assigneeUserId: string; reviewerUserId: string; dueAt: string; verificationDueAt?: string; timeZone: string; consumers: MaterialConsumer[] };
export type MaterialReviewDecision = { taskId: string; accepted: boolean; factCheck: string; rightsCheck: string; visualCheck: string };
async function request<T>(programId: string, suffix = '', body?: unknown): Promise<T> {
  const response = await fetch(`/api/overseas/social-programs/${encodeURIComponent(programId)}/material-requests${suffix}`, { method: body ? 'POST' : 'GET', headers: { ...authHeader(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== 'object') throw Error(payload?.message || '人工素材任务服务暂不可用。');
  return payload as T;
}
export function materialCanonicalId(material: { id: string }): string | null { return /^pb-[a-z0-9]{15}$/.test(material.id) ? material.id.slice(3) : null; }
export const weeklyMaterialRequestsApi = {
  async list(programId: string) { const result = await request<{ items: WeeklyMaterialRequest[] }>(programId); if (!Array.isArray(result.items)) throw Error('素材任务列表格式异常。'); return result.items; },
  async create(programId: string, body: Create) { return (await request<{ item: WeeklyMaterialRequest }>(programId, '', body)).item; },
  async submit(programId: string, requestId: string, materialRecordIds: string[], expectedSubmissionVersion: number) { return (await request<{ item: WeeklyMaterialRequest }>(programId, `/${encodeURIComponent(requestId)}/submissions`, { materialRecordIds, expectedSubmissionVersion })).item; },
  async review(programId: string, requestId: string, submissionVersion: number, consumerDecisions: MaterialReviewDecision[]) { return (await request<{ item: WeeklyMaterialRequest }>(programId, `/${encodeURIComponent(requestId)}/reviews`, { submissionVersion, consumerDecisions })).item; },
  async revise(programId: string, requestId: string, body: { reason: string; dueAt?: string; verificationDueAt?: string; timeZone?: string; addConsumers?: MaterialConsumer[] }) { return (await request<{ item: WeeklyMaterialRequest }>(programId, `/${encodeURIComponent(requestId)}/revisions`, body)).item; },
};
