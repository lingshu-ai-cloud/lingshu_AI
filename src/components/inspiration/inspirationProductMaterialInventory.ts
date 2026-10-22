import { studioApi, type Material } from '../../lib/studioApi';
import { materialMatchesProduct, type ProductMaterialGroupProduct, type ProductScenePreparationSlotView } from '../material-library/ProductMaterialGroup';

export const MATERIAL_LIBRARY_FETCH_PAGE_SIZE = 100;

export type ProductMaterialInventory = {
  materials: Material[];
  slots: ProductScenePreparationSlotView[];
};

export type ProductMaterialSummary = ProductMaterialInventory & {
  loading: boolean;
  error: string;
};

export async function fetchCompleteProductMaterialInventory(product: ProductMaterialGroupProduct,
  list: typeof studioApi.listMaterialLibrary = studioApi.listMaterialLibrary): Promise<ProductMaterialInventory> {
  const first = await list('library', {
    productId: product.id,
    page: 1,
    pageSize: MATERIAL_LIBRARY_FETCH_PAGE_SIZE,
  });
  const pageCount = Math.max(1, Math.ceil(Number(first.total ?? first.items.length) / MATERIAL_LIBRARY_FETCH_PAGE_SIZE));
  const additionalPages = pageCount > 1
    ? await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => list('library', {
      productId: product.id,
      page: index + 2,
      pageSize: MATERIAL_LIBRARY_FETCH_PAGE_SIZE,
    })))
    : [];
  const materials = [...new Map([first, ...additionalPages]
    .flatMap(page => page.items)
    .filter(material => materialMatchesProduct(material, product))
    .map(material => [material.id, material])).values()];
  return {
    materials,
    slots: (first.productSceneSlots || []).filter(slot => slot.productId === product.id),
  };
}

export async function fetchProductMaterialSummaries(
  products: ReadonlyArray<ProductMaterialGroupProduct>,
  list: typeof studioApi.listMaterialLibrary = studioApi.listMaterialLibrary,
): Promise<Record<string, ProductMaterialInventory>> {
  const first = await list('library', {
    page: 1,
    pageSize: MATERIAL_LIBRARY_FETCH_PAGE_SIZE,
  });
  const pages = [first];
  const pageCount = Math.max(1, Math.ceil(Number(first.total ?? first.items.length) / MATERIAL_LIBRARY_FETCH_PAGE_SIZE));
  // Read subsequent pages sequentially so a large tenant does not create a
  // browser-side request burst. Product details still use the exact productId
  // query when the user opens a drawer.
  for (let page = 2; page <= pageCount; page += 1) {
    pages.push(await list('library', {
      page,
      pageSize: MATERIAL_LIBRARY_FETCH_PAGE_SIZE,
    }));
  }
  const allMaterials = [...new Map(pages.flatMap(result => result.items).map(material => [material.id, material])).values()];
  const allSlots = first.productSceneSlots || [];
  return Object.fromEntries(products.map(product => [product.id, {
    materials: allMaterials.filter(material => materialMatchesProduct(material, product)),
    slots: allSlots.filter(slot => slot.productId === product.id),
  }]));
}
