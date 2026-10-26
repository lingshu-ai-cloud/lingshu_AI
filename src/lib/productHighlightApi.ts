import { authHeader } from './auth';
import type { ProductItem } from '../components/enterprise/enterpriseProfileTypes';
import { productHighlightDraftSchema, type ProductHighlightDraft } from '../../shared/contracts/productHighlight';

export type HighlightProductSnapshot = { products: { items: ProductItem[] }; factVersion: { contentHash: string } };
async function json(response: Response) {
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.message || `请求未完成（${response.status}），请刷新产品资料后再试。`);
  return value;
}
export async function readHighlightProducts(): Promise<HighlightProductSnapshot> {
  const data = await json(await fetch('/api/overseas/enterprise/profile', { headers: authHeader(), cache: 'no-store' }));
  if (!Array.isArray(data.products?.items) || !data.factVersion?.contentHash) throw new Error('产品资料暂时无法读取，请先完善企业知识库。');
  return data;
}
export async function generateProductHighlight(snapshot: HighlightProductSnapshot, productId: string) {
  const result = await json(await fetch('/api/overseas/enterprise/knowledge-intake/product-highlight', {
    method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, factVersion: snapshot.factVersion.contentHash }),
  }));
  return productHighlightDraftSchema.parse(result.draft);
}
export async function saveProductHighlight(snapshot: HighlightProductSnapshot, draft: ProductHighlightDraft, highlight: string,
  isCurrent: () => boolean = () => true) {
  const value = highlight.trim();
  if (!value || value.length > 300) throw new Error('请填写一条300字以内的核心卖点。');
  if (snapshot.factVersion.contentHash !== draft.factVersion) throw new Error('产品资料版本已变化，请重新选择产品。');
  const selected = snapshot.products.items.filter(item => item.id === draft.productId);
  if (selected.length !== 1) throw new Error('无法确定所选产品，请重新选择。');
  if (!isCurrent()) throw new Error('登录状态已变化，请重新打开。');
  let response: Response;
  try { response = await fetch('/api/overseas/enterprise/profile', {
    method: 'PATCH', headers: { ...authHeader(), 'Content-Type': 'application/json', 'If-Match': draft.factVersion },
    body: JSON.stringify({ products: { items: snapshot.products.items.map(item => item.id === draft.productId ? { ...item, highlights: value } : item) } }),
  }); } catch { throw new Error('回填结果尚未确认，请刷新企业知识库核对。'); }
  await json(response);
  if (!isCurrent()) throw new Error('登录状态已变化，请在原企业知识库核对保存结果。');
  const saved = await readHighlightProducts();
  if (saved.products.items.find(item => item.id === draft.productId)?.highlights !== value) throw new Error('暂未确认回填结果，请刷新知识库核对。');
  return saved;
}
