import { authHeader } from '../../lib/auth';
import { normalizeEnterpriseProfile, normalizeProductItems } from './enterpriseProfileNormalization';
import { DEFAULT } from './enterpriseProfileState';
import type { Profile } from './enterpriseProfileTypes';

export async function saveEnterpriseProfileAndVerify(
  profile: Profile,
  fetcher: typeof fetch = fetch,
  headers: () => Record<string, string> = authHeader,
): Promise<Profile> {
  const profileToSave = normalizeEnterpriseProfile(profile);
  const response = await fetcher('/api/overseas/enterprise/profile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-enterprise-save-source': 'enterprise_center',
      ...(profile.factVersion?.contentHash ? { 'If-Match': `"${profile.factVersion.contentHash}"` } : {}),
      ...headers(),
    },
    body: JSON.stringify(profileToSave),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || result.error || `保存失败（${response.status}）`);

  const verifyResponse = await fetcher('/api/overseas/enterprise/profile', { headers: headers() });
  const verified = await verifyResponse.json().catch(() => ({})) as Partial<Profile> & { message?: string; error?: string };
  if (!verifyResponse.ok) throw new Error(verified.message || verified.error || '保存后校验失败');
  const expectedProducts = normalizeProductItems(profileToSave.products);
  const verifiedProducts = normalizeProductItems({ ...DEFAULT.products, ...verified.products });
  const verifiedProductNames = new Set(verifiedProducts.map(item => item.name.trim()));
  if (expectedProducts.length !== verifiedProducts.length || expectedProducts.some(item => !verifiedProductNames.has(item.name.trim()))) {
    throw new Error('产品资料保存后校验失败，请重试');
  }
  return normalizeEnterpriseProfile(verified as Profile);
}
