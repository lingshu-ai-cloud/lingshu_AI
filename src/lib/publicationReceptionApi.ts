import { getToken } from './auth';
import type { ReceptionBinding } from '../../server/socialPrograms/publicationReceptionReadiness';

export interface ReceptionEnterpriseFacts { version: { contentHash: string; revision: number }; profile: { products?: { items?: Array<{ name: string; documents?: Array<{ name: string; url?: string }> }> } } }
export interface ReceptionEmployee { id: string; name: string; email: string; role: string }
async function request<T>(path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const response = await fetch(`/api/overseas${path}`, { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== 'object') throw new Error(data?.message || '承接配置服务暂不可用，请重新加载。');
  return data as T;
}
export const publicationReceptionApi = {
  async facts() {
    const data = await request<ReceptionEnterpriseFacts>('/enterprise/facts');
    if (typeof data.version?.contentHash !== 'string' || !data.version.contentHash || !Number.isSafeInteger(data.version.revision) || data.version.revision < 1 || !data.profile) throw Error('企业确认资料版本不可用，请先完成企业资料确认。');
    const products = data.profile.products?.items;
    if (products !== undefined && (!Array.isArray(products) || products.some(product => !product || typeof product.name !== 'string'
      || (product.documents !== undefined && (!Array.isArray(product.documents) || product.documents.some(document => !document || typeof document.name !== 'string' || (document.url !== undefined && typeof document.url !== 'string'))))))) throw Error('企业资料目录格式异常，请重新加载企业资料。');
    return data;
  },
  async employees() { const data = await request<{ employees: ReceptionEmployee[] }>('/auth/employees'); if (!Array.isArray(data.employees)) throw Error('接待人员目录不可用。'); return data.employees.filter(person => person && typeof person.id === 'string' && person.id && ['super_admin', 'admin', 'social_operator', 'customer_service'].includes(person.role)); },
  async save(binding: Omit<ReceptionBinding, 'tenantId'>) {
    const encoded = [binding.programId, binding.packageId, binding.publicationId].map(encodeURIComponent);
    const data = await request<{ item: { bindingId: string; bindingHash: string }; planningRevisionRequired: boolean }>(`/social-programs/${encoded[0]}/operating-packages/${encoded[1]}/publications/${encoded[2]}/reception-binding`, { packageVersion: binding.packageVersion, cta: binding.cta, enterpriseFactHash: binding.enterpriseFactHash, targets: binding.targets });
    if (!data.item?.bindingId || data.planningRevisionRequired !== true) throw Error('承接绑定未确认，请重试。'); return data.item;
  },
};
