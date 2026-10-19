import { WEEKLY_DISCOVERY_PRODUCT_BINDING_VERSION, type ConfirmedWeeklyDiscoveryBoundary } from '../digitalEmployees/weeklyDiscoveryScope.js';

export interface DiscoveryScopeUpgradeRequest {
  tenantId: string;
  workflowRunId: string;
  workflowTaskId: string;
  keywords: string;
  platforms: string[];
  limit: number;
  dateWindowDays: number;
  confirmedWeeklyBoundary: ConfirmedWeeklyDiscoveryBoundary;
}

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, any> : {};

export function discoveryScopeUpgradeRequest(scope: Record<string, any>, tenantId: string): DiscoveryScopeUpgradeRequest | null {
  const payload = object(scope.payload);
  if (payload.productFactBinding?.version === WEEKLY_DISCOVERY_PRODUCT_BINDING_VERSION) return null;
  const brief = object(payload.discoveryBrief), authorization = object(payload.authorizationSource);
  const productRef = String(brief.productRef || payload.keywordSet?.scope?.productRef || '').trim();
  const workflowRunId = String(authorization.workflowRunId || '').trim();
  const workflowTaskId = String(authorization.workflowTaskId || '').trim();
  const approvedBy = String(authorization.approvedBy || scope.created_by || '').trim();
  const platforms = Array.isArray(brief.platforms) ? brief.platforms.map((value: unknown) => String(value).trim()).filter(Boolean) : [];
  if (!productRef || !workflowRunId || !workflowTaskId || !approvedBy || !platforms.length) return null;
  const lookbackDays = Number(brief.lookbackDays || 7), resultLimit = Number(brief.resultLimit || 10);
  return { tenantId, workflowRunId, workflowTaskId, keywords: productRef, platforms, limit: resultLimit, dateWindowDays: lookbackDays,
    confirmedWeeklyBoundary: { businessGoal: String(payload.businessGoal || '为已确认周计划采集可复刻的爆款内容证据'), products: [productRef],
      market: String(brief.market || payload.market || '').trim(), language: String(payload.language || 'en').trim(),
      audience: String(brief.audience || payload.keywordSet?.scope?.audienceRole || '').trim(), platforms, lookbackDays, resultLimit,
      approvedBy, workflowRunId, workflowTaskId } };
}
