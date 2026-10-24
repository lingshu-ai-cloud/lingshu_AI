import { materialLibraryCategoryOf } from '../../../shared/materialLibraryKinds';
import type { Material } from '../../lib/studioApi';
import { materialSourceCategoryOf } from '../../../shared/materialTaxonomy';
import { materialBelongsToKnownProduct, type ProductMaterialGroupProduct } from '../material-library/ProductMaterialGroup';
import { MATERIAL_FUNCTION_LABELS, materialMatchesLibraryFilters, materialMatchesProductFilter, type MaterialGalleryFilterSnapshot } from './inspirationMaterialLibrary';
import type { ProductMaterialSummary } from './inspirationProductMaterialInventory';

export type MaterialProductFilter = { enabled: boolean; productId: string; productRef: string };

export function projectMaterialGallery({
  materials,
  products,
  summaries,
  filters,
  productFilter,
  page,
  pageSize,
}: {
  materials: readonly Material[];
  products: readonly ProductMaterialGroupProduct[];
  summaries: Readonly<Record<string, ProductMaterialSummary>>;
  filters: MaterialGalleryFilterSnapshot;
  productFilter: MaterialProductFilter;
  page: number;
  pageSize: number;
}) {
  const functions = new Set<string>();
  const productMaterials = Object.values(summaries).flatMap(summary => summary.materials);
  for (const material of [...materials, ...productMaterials]) {
    for (const value of String(material.shotFunction || '').split(',').map(item => item.trim()).filter(Boolean)) {
      functions.add(value);
    }
  }
  const materialFunctionOptions = [...functions]
    .sort((a, b) => (MATERIAL_FUNCTION_LABELS[a] || a).localeCompare(MATERIAL_FUNCTION_LABELS[b] || b, 'zh-CN'));

  const inventory = [...new Map([...materials, ...productMaterials].map(material => [material.id, material])).values()];
  const filteredMaterials = inventory.filter(material =>
    materialMatchesLibraryFilters(material, filters) && materialMatchesProductFilter(material, productFilter)
  ).sort((a, b) => {
    // User uploads remain ahead of migrated seed records with later timestamps.
    const sourcePriority = Number(materialSourceCategoryOf(b) === 'local_upload') - Number(materialSourceCategoryOf(a) === 'local_upload');
    return sourcePriority || (Date.parse(String(b.createdAt || '')) || 0) - (Date.parse(String(a.createdAt || '')) || 0);
  });
  const ungrouped = filteredMaterials.filter(material => !materialBelongsToKnownProduct(material, products)
    || ((filters.categories !== undefined || filters.category !== undefined) && materialLibraryCategoryOf(material) !== 'product'));
  const query = filters.query.trim().toLowerCase();
  const visibleProductGroups = products.filter(product => {
    if (filters.categories !== undefined ? filters.categories.length > 0 && !filters.categories.includes('product')
      : filters.category !== undefined && !['all', 'product'].includes(filters.category)) return false;
    if (productFilter.enabled) {
      if (productFilter.productId && product.id !== productFilter.productId) return false;
      if (!productFilter.productId && productFilter.productRef && product.name !== productFilter.productRef) return false;
      if (!productFilter.productId && !productFilter.productRef) return false;
    }
    const summary = summaries[product.id];
    const productNameMatches = Boolean(query && product.name.toLowerCase().includes(query));
    const requiresMaterialMatch = (filters.categories !== undefined ? filters.categories.length > 0 : filters.category !== undefined && filters.category !== 'all')
      || filters.assetTab === 'ai'
      || filters.assetTab === 'cloud'
      || filters.type !== 'all'
      || filters.industry !== 'all'
      || filters.shotFunction !== 'all'
      || filters.applicability !== 'all'
      || filters.orientation !== 'all'
      || filters.source !== 'all'
      || filters.theme !== 'all'
      || filters.favorite !== 'all'
      || Boolean(query && !productNameMatches);
    if (!requiresMaterialMatch) return !query || productNameMatches;
    if (!summary) return false;
    const productFilters = productNameMatches ? { ...filters, query: '' } : filters;
    return summary.materials.some(material => materialMatchesLibraryFilters(material, productFilters));
  });
  const ordinaryFilteredTotal = ungrouped.length;
  const offset = (page - 1) * pageSize;
  const pagedUngroupedFilteredMaterials = ungrouped.slice(offset, offset + pageSize);
  const visibleProductGroupsForPage = page === 1 ? visibleProductGroups : [];
  return {
    materialFunctionOptions,
    visibleProductGroups,
    ordinaryFilteredTotal,
    pagedUngroupedFilteredMaterials,
    visibleProductGroupsForPage,
    materialTotal: inventory.length,
    visibleMaterialTotal: filteredMaterials.length,
    visibleMaterialGalleryCount: visibleProductGroupsForPage.length + pagedUngroupedFilteredMaterials.length,
  };
}

/** Use the same narrowed inventory for group covers and their detail drawer. */
export function projectProductMaterialView(summary: ProductMaterialSummary, filters: MaterialGalleryFilterSnapshot, productName: string) {
  const query = filters.query.trim().toLowerCase();
  const effectiveFilters = query && productName.toLowerCase().includes(query) ? { ...filters, query: '' } : filters;
  const materials = summary.materials.filter(material => materialMatchesLibraryFilters(material, effectiveFilters));
  const filtered = Boolean(query || filters.categories?.length || filters.type !== 'all' || filters.theme !== 'all');
  return { ...summary, materials, slots: filtered ? summary.slots.filter(slot => materials.some(material => material.id === slot.materialId)) : summary.slots };
}
