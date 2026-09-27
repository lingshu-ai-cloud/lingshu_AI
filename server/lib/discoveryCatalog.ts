import { createHash } from 'node:crypto';
import type { EnterpriseProfile } from '../routes/enterprise.js';
import type { DiscoveryCatalogProduct } from '../../shared/discoveryCatalog.js';
export function discoveryCatalog(profile: EnterpriseProfile): DiscoveryCatalogProduct[] {
  return (profile.products.items ?? []).map((product, index) => {
    const id = createHash('sha256').update(JSON.stringify([index, product.sku, product.name])).digest('hex').slice(0, 20);
    return {
      id, name: product.name, category: product.category || '',
      text: JSON.stringify({ name: product.name, sku: product.sku, category: product.category, material: product.material, highlights: product.highlights, attributes: product.attributes }),
      files: (product.documents ?? []).map((file, fileIndex) => ({ id: `${id}:${fileIndex}`, name: file.name, url: /^\/api\/overseas\/enterprise\/assets\/[^/?#]+$/.test(file.url || '') ? file.url! : '', size: file.size, available: /^\/api\/overseas\/enterprise\/assets\/[^/?#]+$/.test(file.url || '') && /\.(pdf|xlsx?|csv|txt)$/i.test(file.name) })),
    };
  });
}
