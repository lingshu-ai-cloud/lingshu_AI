import { materialSourceCategoryOf } from './materialTaxonomy.js';

export type MaterialLibraryGroup = 'all' | 'internal' | 'external';
export type MaterialLibraryCategory = 'all' | 'product' | 'enterprise' | 'generated' | 'industry';
export type MaterialLibraryLeaf = Exclude<MaterialLibraryCategory, 'all'>;
export const MATERIAL_LIBRARY_CATEGORY_LABELS = { product: '产品素材', enterprise: '企业素材', generated: '用户生成素材', industry: '行业素材' } as const;

export function normalizeMaterialLibrarySelection(values: readonly string[]): MaterialLibraryLeaf[] {
  const expanded = values.flatMap(value => value === 'internal' ? ['product', 'enterprise', 'generated'] : value === 'external' ? ['industry'] : [value]);
  return (Object.keys(MATERIAL_LIBRARY_CATEGORY_LABELS) as MaterialLibraryLeaf[]).filter(value => expanded.includes(value));
}

export function materialMatchesLibrarySelection(material: LibraryAsset, selection: readonly MaterialLibraryLeaf[]): boolean {
  const category = materialLibraryCategoryOf(material);
  return selection.length === 0 || (category !== null && selection.includes(category));
}

type LibraryAsset = Parameters<typeof materialSourceCategoryOf>[0] & { productId?: unknown; productName?: unknown; tags?: unknown };
export function materialLibraryCategoryOf(material: LibraryAsset): Exclude<MaterialLibraryCategory, 'all'> | null {
  if (material.scope === 'shared') return materialSourceCategoryOf(material) === 'official_import' ? 'industry' : null;
  if (materialSourceCategoryOf(material) === 'user_generated' || /^ai[-_]/i.test(String(material.sourceType || ''))) return 'generated';
  return material.productId || material.productName ? 'product' : 'enterprise';
}

export function materialMatchesLibraryCategory(material: LibraryAsset, group: MaterialLibraryGroup = 'all', category: MaterialLibraryCategory = 'all'): boolean {
  // User rule: selecting a parent only changes the child choices. Until a
  // child is selected, both internal and external inventories remain visible.
  if (category === 'all') return true;
  const expectedGroup = category === 'industry' ? 'external' : 'internal';
  return (group === 'all' || group === expectedGroup) && materialLibraryCategoryOf(material) === category;
}
