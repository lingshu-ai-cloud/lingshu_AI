import { authHeader } from './auth';
import type { AvatarJob, ProductionDefaults, ShotProduction, PresenterAsset } from './shotProduction';
import type { DigitalHumanExecutionRecord, DigitalHumanPlanRecord } from './digitalHumanPlan';
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/overseas/studio/production${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `服务请求失败 (${response.status})`);
  return value;
}
export const productionApi = {
  batchShotRoutes: (projectId: string) => request<{ projectId: string; planningOnly: true; routes: Array<{ shotId: string; slotId: string; order: number; visualTopic: string; expressionPurpose: string; route: string; status: string; matchedMaterialId: string | null; matchedSegmentId: string | null; trimStart: number | null; trimEnd: number | null; reason: string; generated: false }>; counts: Record<string, number> }>(`/batch-shot-routes?projectId=${encodeURIComponent(projectId)}`),
  batchShotJobs: (body: { projectId: string; batchId: string; confirmed: true; slotIds?: string[] }) => request<{ projectId: string; batchId: string; results: Array<{ shotId: string; slotId: string; state: 'submitted' | 'matched' | 'needs_material' | 'blocked'; jobId?: string; reason: string }>; counts: { submitted: number; matched: number; needsMaterial: number; blocked: number } }>('/batch-shot-jobs', body),
  defaults: () => request<ProductionDefaults>('/defaults'),
  saveDefaults: (value: ProductionDefaults) => request<ProductionDefaults>('/defaults', value),
  verifyArkAsset: (value: { projectName: string; groupId: string; assetUri: string }) => request<{ status: 'processing' | 'active' | 'failed'; assetType: 'image' | 'video'; failureReason?: string; syncedAt: string; verificationSource: 'ark_api' }>('/presenters/ark-status', value),
  capabilities: () => request<{ configured: boolean; reason: string; costPerSecond: number | null; referenceBudgetLimitCny: number | null; maxAttemptsPerShot: number; tools: Array<{ id: string; label: string; methods: string[]; planning: boolean; execution: boolean; qualityInspection: boolean; cancellation: boolean; costReconciliation: boolean; reason: string; executionProfile?: { maxDurationSeconds?: number; preserves: string[]; qualityInspection: boolean; estimatedCostCnyPerSecond?: number } }> }>('/capabilities'),
  jobs: (projectId: string) => request<AvatarJob[]>(`/jobs?projectId=${encodeURIComponent(projectId)}`),
  plans: (projectId: string) => request<DigitalHumanPlanRecord[]>(`/plans?projectId=${encodeURIComponent(projectId)}`),
  executions: (projectId: string) => request<DigitalHumanExecutionRecord[]>(`/executions?projectId=${encodeURIComponent(projectId)}`),
  reconcileExecutionCost: (id: string, actualCostCny: number, sourceRef: string) => request<DigitalHumanExecutionRecord>(`/executions/${encodeURIComponent(id)}/cost`, { actualCostCny, sourceRef }),
  reconcileSupplierCost: (id: string) => request<DigitalHumanExecutionRecord>(`/executions/${encodeURIComponent(id)}/reconcile-cost`, {}),
  reviewExecutionQuality: (id: string, decisions: Record<string, { passed: boolean; evidence: string }>, reviewNote = '') => request<DigitalHumanExecutionRecord>(`/executions/${encodeURIComponent(id)}/quality`, { decisions, reviewNote }),
  adoptExecution: (id: string, body: { candidateId: string; materialId: string }) => request<DigitalHumanExecutionRecord>(`/executions/${encodeURIComponent(id)}/adopt`, body),
  savePlan: (body: { projectId: string; assemblyId: string; shotId: string; fingerprint: string }) => request<DigitalHumanPlanRecord>('/plans', body),
  prepareSentenceFirstFrames: (body: { projectId: string; assemblyId: string; shotId: string; fingerprint: string }) => request<{ cues: import('./digitalHumanPlan').DigitalHumanReferenceCue[]; clusterPlan: import('./personShotClustering').PersonShotClusterPlan }>('/sentence-first-frames', body),
  generateSentenceFirstFrameDrafts: (body:{projectId:string;assemblyId:string;shotId:string;fingerprint:string;requestId:string;confirmed:boolean})=>request<import('./digitalHumanPlan').SentenceFirstFrameDraftResult>('/sentence-first-frame-drafts',body),
  runSentenceReplication: (body: { projectId: string; assemblyId: string; shotId: string; fingerprint: string; requestId: string; confirmed: boolean }) => request<import('./digitalHumanPlan').SentenceReplicationResult>('/sentence-replication-jobs', body),
  sentenceReplicationJob: (jobId:string) => request<import('./digitalHumanPlan').SentenceReplicationResult>(`/sentence-replication-jobs/${encodeURIComponent(jobId)}`),
  reviewSentenceCueQuality: (jobId:string,decisions:Record<string,Record<string,{passed:boolean;evidence:string}>>) => request<import('./digitalHumanPlan').SentenceReplicationResult>(`/sentence-replication-jobs/${encodeURIComponent(jobId)}/cue-quality`,{decisions}),
  retryFailedSentenceCues: (jobId:string,requestId:string,confirmed:boolean) => request<import('./digitalHumanPlan').SentenceReplicationResult>(`/sentence-replication-jobs/${encodeURIComponent(jobId)}/retry-failed`,{requestId,confirmed}),
  syncAgentPlans: (projectId: string) => request<DigitalHumanPlanRecord[]>('/plans/sync-agent', { projectId }),
  submit: (body: { projectId: string; assemblyId: string; shotId: string; fingerprint: string; shot: ShotProduction; presenter: PresenterAsset; ratio: string; requestId: string; confirmed: boolean }) => request<AvatarJob>('/jobs', body),
  refresh: (id: string) => request<AvatarJob>(`/jobs/${encodeURIComponent(id)}/refresh`, {}),
  submitReference: (body: { projectId: string; assemblyId: string; shotId: string; fingerprint: string; requestId: string; confirmed: boolean }) => request<DigitalHumanExecutionRecord>('/reference-jobs', body),
  refreshReference: (id: string) => request<DigitalHumanExecutionRecord>(`/reference-jobs/${encodeURIComponent(id)}/refresh`, {}),
  cancelReference: (id: string) => request<DigitalHumanExecutionRecord>(`/reference-jobs/${encodeURIComponent(id)}/cancel`, {}),
};
