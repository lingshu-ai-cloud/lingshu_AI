import { authHeader, getToken } from './auth';
import type { WeeklyScheduleCapacityInput, WeeklyScheduleProposal } from '../../shared/contracts/socialWeeklyScheduleRevision';

export interface WeeklyCapacityProposal {
  snapshotRef: { id: string; version: number }; capacityPlanRef: { type: 'capacity_plan'; id: string; version: number };
  publicationQuota: number; originalContentQuota: number; estimatedCostCny: number; weeklyBudgetCny: number;
  status: string; limitingFactors: string[]; proposalHash: string; canAdd: boolean;
}
export interface WeeklyCapacityConfirmation { capacityPlanRef: WeeklyCapacityProposal['capacityPlanRef']; operatingDecisionSnapshotRef: WeeklyCapacityProposal['snapshotRef']; capacityAuthorization: { operationId: string; proposalHash: string; approvedPublicationQuota: number; approvedMaximumCostCny: number }; state: string }

export type WeeklyAssistantAction = 'create' | 'revise' | 'publish';
export interface WeeklyActionPackage {
  programId: string; packageId: string; packageVersion: number; title: string;
  allowedProductIds?: string[];
  model?: 'canonical' | 'legacy';
  goalId?: string; planId?: string; planVersion?: number; runId?: string;
  expectedPlanHash?: string; expectedHash?: string;
  [key: string]: unknown;
}
export interface WeeklyActionOption { id: string; name: string }
export interface WeeklyActionTarget extends WeeklyActionOption {
  programId: string; packageId: string; packageVersion: number;
  model?: 'canonical' | 'legacy';
  [key: string]: unknown;
}
export interface WeeklyActionContext {
  packages: WeeklyActionPackage[];
  products: WeeklyActionOption[];
  accounts: Array<WeeklyActionOption & { programId: string; platform: string; packageIds?: string[] }>;
  publishingAccounts?: Array<{ accountId: string; accountLabel: string; platform: string; status: string }>;
  revisionTargets: WeeklyActionTarget[];
  publishTargets: WeeklyActionTarget[];
}
export interface WeeklyActionReceipt {
  state: string; programId: string; packageId: string; packageVersion: number;
  model?: 'canonical' | 'legacy';
  message: string; navigation?: { page?: string; href?: string; businessRef?: Record<string, unknown> };
  [key: string]: unknown;
}

/** Echo frozen server-authored lineage, never identity or display-only fields. */
export function weeklyActionScopeTokens(value: WeeklyActionPackage | WeeklyActionTarget): Record<string, unknown> {
  const excluded = new Set(['id', 'name', 'title', 'allowedProductIds', 'tenantId', 'tenant_id', 'userId', 'actorUserId', 'role', 'authorization']);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)));
}

async function request(path: string, input?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const token = getToken();
  if (!token) throw new Error('请登录后操作周任务。');
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
  try {
  const response = await fetch(`/api/overseas/assistant-weekly-actions${path}`, {
    method: input ? 'POST' : 'GET', headers: { ...authHeader(), ...(input ? { 'Content-Type': 'application/json' } : {}) },
    ...(input ? { body: JSON.stringify(input) } : {}), signal: controller.signal, cache: 'no-store', redirect: 'error',
  });
  const payload = await response.json().catch(() => null);
  if (getToken() !== token) throw new Error('登录身份已变化，请重新读取周任务。');
  if (!response.ok) throw new Error(payload?.message || payload?.error || '周任务操作未完成，请查看原任务状态后重试。');
  if (!payload || typeof payload !== 'object') throw new Error('周任务服务未返回有效结果。');
  return payload.item ?? payload;
  } catch (error) {
    if (timedOut) throw new Error(input ? '本次操作确认超时，请先查看周任务中的实际结果，勿重复创建。' : '周任务读取超时，请稍后重新读取。');
    throw error;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', onAbort); }
}

export function parseWeeklyActionContext(value: unknown): WeeklyActionContext {
  const item = value as WeeklyActionContext;
  if (!item || !['packages', 'products', 'accounts', 'revisionTargets', 'publishTargets'].every(key => Array.isArray((item as unknown as Record<string, unknown>)[key]))) {
    throw new Error('周任务选项不完整，请刷新后重试。');
  }
  if (item.publishingAccounts !== undefined && (!Array.isArray(item.publishingAccounts) || item.publishingAccounts.some(account => !account.accountId || !account.accountLabel || !account.platform || !account.status))) throw new Error('真实发布账号信息不完整，请重新读取。');
  if (item.packages.some(p => !p.programId || !p.packageId || !Number.isSafeInteger(p.packageVersion) || p.packageVersion < 1)
    || item.products.some(p => !p.id || !p.name)
    || item.accounts.some(p => !p.id || !p.name || !p.programId || !p.platform)
    || [...item.revisionTargets, ...item.publishTargets].some(p => !p.id || !p.name || !p.programId || !p.packageId || !Number.isSafeInteger(p.packageVersion)
      || (p.model !== 'legacy' && !['publicationTaskId', 'taskId', 'artifactId', 'expectedArtifactVersion'].every(key => typeof p[key] === 'string' && Boolean((p[key] as string).trim()))))) {
    throw new Error('周任务选项缺少真实对象或版本，请刷新后重试。');
  }
  return item;
}

export const assistantWeeklyActionsApi = {
  context: async (signal?: AbortSignal) => parseWeeklyActionContext(await request('/context', undefined, signal)),
  submit: async (action: WeeklyAssistantAction, input: Record<string, unknown>, signal?: AbortSignal) => {
    const item = await request(`/${action}`, input, signal) as WeeklyActionReceipt;
    if (!item.programId || !item.packageId || !Number.isSafeInteger(item.packageVersion) || item.packageVersion < 1 || !item.message || !item.state
      || item.programId !== input.programId || item.packageId !== input.packageId) {
      throw new Error('未收到可核验的周任务回执。请先查看周任务，勿重复提交。');
    }
    return item;
  },
  previewCapacity: async (input: Record<string, unknown>, signal?: AbortSignal) => {
    const result = await request('/create/capacity/preview', input, signal) as WeeklyCapacityProposal;
    if (!result.snapshotRef?.id || !result.capacityPlanRef?.id || !result.proposalHash || !Number.isFinite(result.estimatedCostCny) || !Number.isFinite(result.weeklyBudgetCny) || !Number.isSafeInteger(result.publicationQuota) || !Number.isSafeInteger(result.originalContentQuota) || result.estimatedCostCny < 0 || result.weeklyBudgetCny < 0 || typeof result.canAdd !== 'boolean' || !Array.isArray(result.limitingFactors)) throw new Error('新增内容容量信息不完整，请重新核验。');
    return result;
  },
  confirmCapacity: async (input: Record<string, unknown>, proposal: WeeklyCapacityProposal, maximumCostCny: number, signal?: AbortSignal) => {
    const result = await request('/create/capacity/confirm', { ...input, confirmation: { snapshotRef: proposal.snapshotRef, proposalHash: proposal.proposalHash, approvedPublicationQuota: proposal.publicationQuota, approvedMaximumCostCny: maximumCostCny, confirmed: true } }, signal) as WeeklyCapacityConfirmation;
    if (result.state !== 'capacity_confirmed' || !result.capacityPlanRef?.id || !result.operatingDecisionSnapshotRef?.id
      || !result.capacityAuthorization?.operationId || result.capacityAuthorization.proposalHash !== proposal.proposalHash
      || result.capacityAuthorization.approvedMaximumCostCny !== maximumCostCny || result.capacityAuthorization.approvedPublicationQuota !== proposal.publicationQuota) throw new Error('容量确认尚未完成，请查看周任务状态。');
    return result;
  },
  previewSchedule: async (input: Record<string, unknown>, capacity: WeeklyScheduleCapacityInput, signal?: AbortSignal) => {
    const result = await request('/create/preview', { ...input, capacity }, signal) as { proposal: WeeklyScheduleProposal; message: string };
    if (!result.proposal?.proposalId || !result.proposal.inputEvidenceHash || !result.proposal.plan || !result.proposal.targetGraph
      || result.proposal.packageVersion !== input.expectedVersion
      || !Number.isFinite(result.proposal.plan.reservedCostCny) || !Number.isSafeInteger(result.proposal.plan.targetPublicationCount)
      || !Number.isSafeInteger(result.proposal.plan.conditionallyReachableCount) || typeof result.proposal.plan.fullGraphConditionallyReachable !== 'boolean') throw new Error('未收到完整排期预览，不能确认。');
    return result;
  },
  scheduleInput: async (input: Record<string, unknown>, signal?: AbortSignal) => {
    const result = await request('/create/schedule-input', input, signal) as { capacity: WeeklyScheduleCapacityInput; summary: string[] };
    if (!result.capacity?.constraints || !result.capacity.resources || !Number.isFinite(result.capacity.remainingBudgetCny) || !Array.isArray(result.summary)) throw new Error('尚未读取到可核验的资源与工时，不能自动排期。');
    return result;
  },
  confirmSchedule: async (input: Record<string, unknown>, proposal: WeeklyScheduleProposal, signal?: AbortSignal) => {
    const item = await request('/create/confirm', { ...input, confirmation: { proposalId: proposal.proposalId, expectedVersion: proposal.packageVersion, inputEvidenceHash: proposal.inputEvidenceHash, confirmedTemplateCarryoverPlanHashes: (proposal.templateCarryovers ?? []).map(plan => plan.planHash) } }, signal) as WeeklyActionReceipt;
    if (!item.programId || item.programId !== input.programId || item.packageId !== input.packageId || !item.packageVersion || !item.message || !item.state) throw new Error('未收到正式周任务回执，请查看周任务状态。');
    return item;
  },
};
