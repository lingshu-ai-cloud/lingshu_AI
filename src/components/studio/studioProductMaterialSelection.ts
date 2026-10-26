import { isAutomaticViralMaterialCandidate, type Clip } from './studioSourceMaterial';
import type { VideoKickoff } from './studioVideoKickoff';

export interface ProductMaterialSelectionState {
  productIds: string[];
  selectedIds: string[];
  automaticIds: string[];
  dismissedIds: string[];
  preservedProductIds: string[];
  candidateProductIds: Record<string, string>;
}

export interface ProductMaterialSelectionInput {
  productIds: string[];
  materials: Clip[];
  selectedIds: string[];
  kickoff?: VideoKickoff | null;
  preserveInitialSelection?: boolean;
}

const unique = (ids: string[]) => [...new Set(ids.filter(Boolean))];

/** Match only durable product IDs in this tenant's own production material inventory. */
export function productMaterialCandidates({ productIds, materials, kickoff = null }: ProductMaterialSelectionInput): Clip[] {
  const products = new Set(productIds.filter(Boolean));
  const seen = new Set<string>();
  return materials.filter(material => {
    if (!material.id || !material.productId || !products.has(material.productId) || material.scope === 'shared'
      || material.capabilityManifest?.status === 'blocked'
      || material.materialV2?.assetRole === 'person_authorization' || material.materialV2?.assetRole === 'digital_human_input'
      || (material.type !== 'image' && material.type !== 'video')
      || !(material.url || (material.type === 'image' && material.poster))
      || !isAutomaticViralMaterialCandidate(material, kickoff) || seen.has(material.id)) return false;
    seen.add(material.id);
    return true;
  });
}

/** Reconcile automatic additions without treating unrelated/manual choices as product-owned. */
export function reconcileProductMaterialSelection(
  previous: ProductMaterialSelectionState | null,
  input: ProductMaterialSelectionInput,
): ProductMaterialSelectionState {
  const productIds = unique(input.productIds);
  const current = unique(input.selectedIds);
  const productSet = new Set(productIds);
  const candidates = productMaterialCandidates(input);
  const candidateIds = new Set(candidates.map(item => item.id));
  const currentSet = new Set(current);
  const previousAutomatic = new Set(previous?.automaticIds || []);
  const previousSelected = new Set(previous?.selectedIds || []);
  const preservedProductIds = previous
    ? previous.preservedProductIds.filter(id => productSet.has(id))
    : input.preserveInitialSelection ? productIds : [];
  const preservedProducts = new Set(preservedProductIds);
  const candidateProductIds = Object.fromEntries(
    Object.entries(previous?.candidateProductIds || {}).filter(([, id]) => productSet.has(id)),
  );
  for (const item of candidates) candidateProductIds[item.id] = item.productId!;
  const dismissed = new Set((previous?.dismissedIds || []).filter(id => Boolean(candidateProductIds[id])));
  for (const id of previousSelected) {
    if (candidateIds.has(id) && !currentSet.has(id)) dismissed.add(id);
  }
  // An explicit manual re-selection cancels a previous opt-out.
  for (const id of current) if (!previousSelected.has(id)) dismissed.delete(id);
  const automaticIds = current.filter(id => previousAutomatic.has(id) && candidateIds.has(id));
  const selectedIds = current.filter(id => !previousAutomatic.has(id) || candidateIds.has(id));
  const selected = new Set(selectedIds);
  for (const material of candidates) {
    if (selected.has(material.id) || dismissed.has(material.id) || preservedProducts.has(material.productId!)) continue;
    selectedIds.push(material.id);
    selected.add(material.id);
    automaticIds.push(material.id);
  }
  return { productIds, selectedIds, automaticIds, dismissedIds: [...dismissed], preservedProductIds, candidateProductIds };
}
