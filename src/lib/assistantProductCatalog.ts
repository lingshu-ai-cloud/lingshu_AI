import { authHeader } from './auth';

export type AssistantCatalogProduct = { id: string; name: string; highlights?: string };
type ProductRecord = { id?: string; productId?: string; sku?: string; name?: string; highlights?: string; [key: string]: unknown };
type Profile = { products?: { items?: ProductRecord[]; [key: string]: unknown }; factVersion?: { contentHash?: string } };

async function readProfile(headers = authHeader()): Promise<Profile> {
  const response = await fetch('/api/overseas/enterprise/profile', { headers, credentials: 'same-origin' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || '企业知识库读取失败，请重试。');
  return data.profile || data;
}

async function catalogProduct(item: ProductRecord): Promise<AssistantCatalogProduct> {
  const name = item.name!.trim();
  let id = String(item.id || item.productId || item.sku || '').trim();
  if (!id) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name));
    id = `product-${Array.from(new Uint8Array(hash)).map(value => value.toString(16).padStart(2, '0')).join('').slice(0, 16)}`;
  }
  return { id, name, highlights: item.highlights };
}

export async function readAssistantProductCatalog(headers = authHeader()): Promise<AssistantCatalogProduct[]> {
  const profile = await readProfile(headers);
  return Promise.all((profile.products?.items || []).filter(item => item.name?.trim()).map(catalogProduct));
}

/** Fresh version + If-Match prevents a quick add overwriting another editor's catalog. */
export async function createAssistantCatalogProduct(name: string, highlights: string): Promise<AssistantCatalogProduct> {
  name = name.trim(); highlights = highlights.trim();
  if (!name || name.length > 120 || highlights.length > 2000) throw new Error('产品名称必填且不超过120字，说明不超过2000字。');
  const headers = authHeader();
  const current = await readProfile(headers);
  if (!current.factVersion?.contentHash) throw new Error('缺少企业资料版本，请到企业知识库刷新后再新增。');
  const items = current.products?.items || [];
  if (items.some(item => item.name?.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('知识库中已有同名产品，请直接选择。');
  const product = { id: `product-${crypto.randomUUID()}`, name, highlights };
  const response = await fetch('/api/overseas/enterprise/profile', {
    method: 'PATCH', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...headers, 'If-Match': `"${current.factVersion.contentHash}"` },
    body: JSON.stringify({ products: { ...current.products, items: [...items, product] } }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || '产品保存失败，请重试。');
  const saved = await readAssistantProductCatalog(headers);
  const verified = saved.find(item => item.id === product.id);
  if (!verified) throw new Error('产品保存后校验失败，请刷新产品列表确认。');
  return verified;
}
