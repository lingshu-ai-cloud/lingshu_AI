import type { ProductItem } from './enterpriseProfileTypes';

/** Keep original indexes so edits/deletes after filtering target the correct product. */
export function searchEnterpriseProducts(products: ProductItem[], query: string) {
  const terms = query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return products.map((product, index) => ({ product, index })).filter(({ product }) => {
    const text = [product.name, product.sku, product.brand].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
}
