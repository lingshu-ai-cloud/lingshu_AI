export interface ProductSearchTerm {
  term: string;
  sourceQuote: string;
  reason: string;
}
export interface ProductKeywordRecommendation {
  broadTerms: ProductSearchTerm[];
  mediumTerms: ProductSearchTerm[];
  perspective: 'factory' | 'supplier' | 'consumer';
  sourceName: string;
  sourceRefs?: string[];
}
export function fiveProductKeywords(value: ProductKeywordRecommendation): string[] {
  if (value.broadTerms.length !== 2 || value.mediumTerms.length !== 3) throw new Error('必须包含 2 个大词和 3 个中词');
  const terms = [...value.broadTerms, ...value.mediumTerms].map(row => row.term.trim());
  if (terms.some(term => !term || term.length > 80 || /[\n,，;；|#]/.test(term)) || new Set(terms.map(term => term.toLowerCase())).size !== 5) throw new Error('搜索词必须简短、独立且不重复');
  return terms;
}
