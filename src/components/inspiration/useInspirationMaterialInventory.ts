import { useEffect, useRef, useState } from 'react';
import { studioApi, type Material } from '../../lib/studioApi';
import type { MaterialLibraryFacets } from '../../lib/studioDigitalHuman';
import type { ProductMaterialGroupProduct, ProductScenePreparationSlotView } from '../material-library/ProductMaterialGroup';
import type { MaterialSourceFilter, MaterialThemeFilter } from '../material-library/MaterialTaxonomyFilters';
import { MATERIAL_LIBRARY_FETCH_PAGE_SIZE, fetchCompleteProductMaterialInventory, fetchProductMaterialSummaries, type ProductMaterialSummary } from './inspirationProductMaterialInventory';

// Own the library inventory and exact-product reads together so refreshes,
// drawer cancellation and summary invalidation use the same request fences.
export function useInspirationMaterialInventory({ innerView, materialSource, materialTheme, materialProducts }: {
  innerView: string;
  materialSource: MaterialSourceFilter;
  materialTheme: MaterialThemeFilter;
  materialProducts: ProductMaterialGroupProduct[];
}) {
  const [localMaterials, setLocalMaterials] = useState<Material[]>([]);
  const [productDetailProduct, setProductDetailProduct] = useState<ProductMaterialGroupProduct | null>(null);
  const [productDetailMaterials, setProductDetailMaterials] = useState<Material[]>([]);
  const [productDetailSlots, setProductDetailSlots] = useState<ProductScenePreparationSlotView[]>([]);
  const [productDetailLoading, setProductDetailLoading] = useState(false);
  const [productDetailError, setProductDetailError] = useState('');
  const productDetailRequestRef = useRef(0);
  const [productMaterialSummaries, setProductMaterialSummaries] = useState<Record<string, ProductMaterialSummary>>({});
  const [productSummaryRefreshVersion, setProductSummaryRefreshVersion] = useState(0);
  const productSummaryRequestRef = useRef(0);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialPage, setMaterialPage] = useState(1);
  const [materialFacets, setMaterialFacets] = useState<MaterialLibraryFacets | null>(null);
  const materialLibraryRequestRef = useRef(0);

  const refreshMaterials = async (page = materialPage): Promise<Material[]> => {
    const requestId = ++materialLibraryRequestRef.current;
    if (!localMaterials.length) setMaterialsLoading(true);
    try {
      const filters = {
        excludeProductAssociated: true,
        ...(materialSource !== 'all' ? { sourceCategory: materialSource } : {}),
        ...(materialTheme !== 'all' ? { theme: materialTheme } : {}),
      } as const;
      const inventory = await studioApi.listMaterialLibrary('library', {
        ...filters,
        page: 1,
        pageSize: MATERIAL_LIBRARY_FETCH_PAGE_SIZE,
      });
      const pageCount = Math.max(1, Math.ceil(Number(inventory.total ?? inventory.items.length) / MATERIAL_LIBRARY_FETCH_PAGE_SIZE));
      const additionalPages = pageCount > 1
        ? await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => studioApi.listMaterialLibrary('library', {
          ...filters,
          page: index + 2,
          pageSize: MATERIAL_LIBRARY_FETCH_PAGE_SIZE,
        })))
        : [];
      const materials = [...new Map([inventory, ...additionalPages]
        .flatMap(result => result.items)
        .map(material => [material.id, material])).values()];
      if (requestId !== materialLibraryRequestRef.current) return localMaterials;
      setLocalMaterials(materials);
      setMaterialFacets(inventory.facets || null);
      setMaterialPage(page);
      return materials;
    } catch {
      // Keep last successful items; callers can still decide whether the stale
      // signed media URL is usable.
      return localMaterials;
    } finally {
      if (requestId === materialLibraryRequestRef.current) setMaterialsLoading(false);
    }
  };

  const loadProductMaterialDetail = async (product: ProductMaterialGroupProduct) => {
    const requestId = ++productDetailRequestRef.current;
    const cached = productMaterialSummaries[product.id];
    setProductDetailProduct(product);
    setProductDetailMaterials(cached?.materials || []);
    setProductDetailSlots(cached?.slots || []);
    setProductDetailLoading(true);
    setProductDetailError('');
    try {
      const inventory = await fetchCompleteProductMaterialInventory(product);
      if (requestId !== productDetailRequestRef.current) return;
      setProductDetailMaterials(inventory.materials);
      setProductDetailSlots(inventory.slots);
      setProductMaterialSummaries(current => ({
        ...current,
        [product.id]: { ...inventory, loading: false, error: '' },
      }));
    } catch (error) {
      if (requestId !== productDetailRequestRef.current) return;
      setProductDetailMaterials([]);
      setProductDetailSlots([]);
      setProductDetailError(error instanceof Error ? error.message : '产品素材暂时无法读取，请重试');
    } finally {
      if (requestId === productDetailRequestRef.current) setProductDetailLoading(false);
    }
  };

  const closeProductMaterialDetail = () => {
    productDetailRequestRef.current += 1;
    setProductDetailProduct(null);
    setProductDetailMaterials([]);
    setProductDetailSlots([]);
    setProductDetailError('');
    setProductDetailLoading(false);
  };

  useEffect(() => { void refreshMaterials(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (innerView !== 'library') return;
    const timer = window.setTimeout(() => void refreshMaterials(1), 250);
    return () => window.clearTimeout(timer);
  }, [innerView, materialSource, materialTheme]); // eslint-disable-line react-hooks/exhaustive-deps
  const materialProductIdsKey = materialProducts.map(product => product.id).join('|');
  useEffect(() => {
    if (innerView !== 'library' || !materialProducts.length) return;
    const requestId = ++productSummaryRequestRef.current;
    setProductMaterialSummaries(current => Object.fromEntries(materialProducts.map(product => {
      const previous = current[product.id];
      return [product.id, {
        materials: previous?.materials || [],
        slots: previous?.slots || [],
        loading: true,
        error: '',
      } satisfies ProductMaterialSummary];
    })));
    void fetchProductMaterialSummaries(materialProducts).then(inventories => {
      if (requestId !== productSummaryRequestRef.current) return;
      setProductMaterialSummaries(Object.fromEntries(materialProducts.map(product => [product.id, {
        ...(inventories[product.id] || { materials: [], slots: [] }),
        loading: false,
        error: '',
      } satisfies ProductMaterialSummary])));
    }).catch(error => {
      if (requestId !== productSummaryRequestRef.current) return;
      setProductMaterialSummaries(current => Object.fromEntries(materialProducts.map(product => {
        const previous = current[product.id];
        return [product.id, {
          materials: previous?.materials || [],
          slots: previous?.slots || [],
          loading: false,
          error: error instanceof Error ? error.message : '产品素材暂时无法读取',
        } satisfies ProductMaterialSummary];
      })));
    });
    return () => { productSummaryRequestRef.current += 1; };
  }, [innerView, materialProductIdsKey, productSummaryRefreshVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    localMaterials, setLocalMaterials, materialsLoading, materialPage, setMaterialPage, materialFacets,
    productDetailProduct, productDetailMaterials, setProductDetailMaterials, productDetailSlots,
    setProductDetailSlots, productDetailLoading, productDetailError, productMaterialSummaries,
    setProductMaterialSummaries, setProductSummaryRefreshVersion, refreshMaterials,
    loadProductMaterialDetail, closeProductMaterialDetail,
  };
}
