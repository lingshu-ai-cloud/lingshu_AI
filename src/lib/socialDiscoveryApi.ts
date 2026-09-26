import type {
  SocialAudienceRole,
  SocialCompanyRole,
  SocialCrawlStrategy,
  SocialDiscoveryModePolicy,
  SocialDiscoveryMode,
  SocialDiscoverySummary,
  SocialInspirationCollectionRun,
  SocialAccountTrackingDecision,
  SocialBenchmarkAccountType,
} from '../../shared/contracts/socialContentWorkflow';
import { authHeader } from './auth';

export type SocialDiscoveryScopeInput = {
  productRef: string;
  productTerms: string[];
  market: string;
  language: string;
  companyRole: SocialCompanyRole;
  audienceRole: SocialAudienceRole;
  platforms: string[];
  discoveryModes: SocialDiscoveryMode[];
  lookbackDays: number;
  resultLimit: number;
  budgetLimitCny?: number | null;
  productionGap?: string | null;
  competitorTerms?: string[];
  benchmarkAccounts?: Array<{ accountRef: string; type: SocialBenchmarkAccountType; weight?: number }>;
  modePolicies?: Partial<Record<SocialDiscoveryMode, Partial<SocialDiscoveryModePolicy>>>;
  sceneClusters: Array<{ label: string; productTask?: string; demandDimension?: string; queryVariants?: string[]; status?: string }>;
};

type ScopeResponse = { scope: SocialCrawlStrategy; persisted: boolean; needsConfirmation: boolean; message?: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/overseas/social-discovery${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeader(), ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({})) as T & { message?: string; error?: string };
  if (!response.ok) throw new Error(data.message || data.error || '灵感发现范围请求失败');
  return data;
}

export const socialDiscoveryApi = {
  getScope: () => request<ScopeResponse>('/scope'),
  saveScope: (input: SocialDiscoveryScopeInput) => request<ScopeResponse>('/scope', { method: 'PUT', body: JSON.stringify(input) }),
  listRuns: (page = 1, perPage = 30) => request<{ items: SocialInspirationCollectionRun[]; page: number; perPage: number; totalItems: number }>(`/runs?page=${page}&perPage=${perPage}`),
  run: (input: { discoveryModes?: SocialDiscoveryMode[]; triggerType?: 'manual' | 'production_gap' } = {}) => request<{ run?: SocialInspirationCollectionRun; skipped?: boolean; reason?: string; nextRunAt?: string | null }>('/runs', { method: 'POST', body: JSON.stringify(input) }),
  getSummary: () => request<{ summary: SocialDiscoverySummary }>('/summary'),
  listAccounts: () => request<{ items: SocialAccountTrackingDecision[] }>('/accounts'),
  recommendAccountDecision: (accountId: string, input: Omit<SocialAccountTrackingDecision, 'accountId' | 'status' | 'recommendedBy' | 'businessConfirmation'>) => request<{ item: SocialAccountTrackingDecision }>(`/accounts/${encodeURIComponent(accountId)}/decision`, { method: 'PUT', body: JSON.stringify(input) }),
  confirmAccountPromotion: (accountId: string, approved: boolean, businessDecisionRef: string, reason?: string) => request<{ item: SocialAccountTrackingDecision }>(`/accounts/${encodeURIComponent(accountId)}/business-confirmation`, { method: 'POST', body: JSON.stringify({ approved, businessDecisionRef, reason }) }),
};
