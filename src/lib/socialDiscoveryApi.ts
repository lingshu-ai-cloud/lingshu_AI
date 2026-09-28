import type { DiscoveryCatalogProduct } from '../../shared/discoveryCatalog';
import type { ProductKeywordRecommendation } from '../../shared/productDiscovery';
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
  productQueries?: string[];
  keywordRecommendation?: ProductKeywordRecommendation;
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
  if (response.status === 401) throw new Error('登录已失效，请重新登录后再生成推荐。');
  if (!response.ok) throw new Error(data.message || data.error || (response.status === 404 ? '推荐接口尚未加载，请更新本地服务后重试。' : `灵感发现范围请求失败（HTTP ${response.status}）`));
  return data;
}

export const socialDiscoveryApi = {
  recommend: (input: SocialDiscoveryScopeInput & { scenes: string[] }) => request<{ productQueries: string[]; sceneClusters: SocialDiscoveryScopeInput['sceneClusters'] }>('/recommend', { method: 'POST', body: JSON.stringify(input) }),
  recommendProducts: (input: SocialDiscoveryScopeInput & { documentText?: string; sourceName?: string; sourceRefs?: string[]; focus?: string }) => request<ProductKeywordRecommendation>('/product-keywords', { method: 'POST', body: JSON.stringify(input) }),
  getProductSources: () => request<{ products: DiscoveryCatalogProduct[] }>('/product-sources'),
  getScope: () => request<ScopeResponse>('/scope'),
  saveScope: (input: SocialDiscoveryScopeInput) => request<ScopeResponse>('/scope', { method: 'PUT', body: JSON.stringify(input) }),
};
