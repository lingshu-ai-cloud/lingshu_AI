import fs from 'node:fs';
import type { LocalBusinessPreview } from '../../shared/localBusinessPreview.js';
/** An explicitly configured, tenant-bound local fixture. No database or external writes. */
export function readLocalBusinessPreview(tenantId: string, remoteAddress: string | undefined): LocalBusinessPreview | null {
  if (process.env.NODE_ENV !== 'development' || process.env.LINGSHU_BUSINESS_PREVIEW_TENANT !== tenantId || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress || '')) return null;
  const file = process.env.LINGSHU_BUSINESS_PREVIEW_FILE;
  if (!file) return null;
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as LocalBusinessPreview;
  if (!value.companyName || !Array.isArray(value.products) || !value.products.length || value.products.some(item => !item.id || !item.name)) throw Error('invalid_local_business_preview');
  return { companyName: value.companyName, industry: value.industry, markets: value.markets, description: value.description, productCount: value.productCount, products: value.products };
}
