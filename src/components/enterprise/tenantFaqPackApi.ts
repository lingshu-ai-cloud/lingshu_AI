import type { TenantFaqPackOverrides } from '../../../shared/contracts/tenantFaqPacks';
import { normalizeTenantFaqPacks } from '../../../shared/contracts/tenantFaqPacks';
import { authHeader } from '../../lib/auth';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import type { Profile } from './enterpriseProfileTypes';

export async function saveTenantFaqPack(profile: Profile, packId: string, items: Array<{q: string; a: string}>, identity: string,
  fetcher: typeof fetch = fetch, readIdentity = productionNavigationIdentity, readHeaders = authHeader,
): Promise<Pick<Profile, 'faqPackOverrides' | 'factVersion'>> {
  if (identity !== readIdentity()) throw Error('登录身份已变化，请重新打开场景卡片');
  if (!profile.factVersion?.contentHash) throw Error('企业资料版本尚未加载，请刷新后重试');
  let overrides: TenantFaqPackOverrides;
  try { overrides = normalizeTenantFaqPacks({ ...(profile.faqPackOverrides || {}), [packId]: { items } }); }
  catch { throw Error('请完整填写问题和答案，问题不能重复，每个场景最多 50 条问答。'); }
  const headers = { ...readHeaders(), 'Content-Type': 'application/json', 'If-Match': `"${profile.factVersion.contentHash}"` };
  const response = await fetcher('/api/overseas/enterprise/profile', { method: 'PATCH', headers, body: JSON.stringify({ faqPackOverrides: overrides }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(body.message || body.error || '场景保存失败，请重试');
  if (identity !== readIdentity()) throw Error('登录身份已变化，保存结果请在原租户核对');
  const check = await fetcher('/api/overseas/enterprise/profile', { headers, cache: 'no-store' });
  const confirmed = await check.json().catch(() => ({})) as Profile;
  if (!check.ok || !confirmed.factVersion?.contentHash || JSON.stringify(confirmed.faqPackOverrides?.[packId]) !== JSON.stringify(overrides[packId])) throw Error('保存后核对失败，请保留当前内容并重试');
  if (identity !== readIdentity()) throw Error('登录身份已变化，请在原租户核对保存结果');
  return { faqPackOverrides: confirmed.faqPackOverrides, factVersion: confirmed.factVersion };
}
