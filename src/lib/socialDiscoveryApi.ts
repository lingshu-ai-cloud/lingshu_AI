import type {
  SocialAudienceRole,
  SocialCompanyRole,
  SocialCrawlStrategy,
  SocialDiscoveryMode,
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
};
