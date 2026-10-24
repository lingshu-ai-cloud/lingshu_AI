import { useEffect, useRef, useState } from 'react';
import { studioApi, type Material } from '../../lib/studioApi';
import type { MaterialLibraryFacets } from '../../lib/studioDigitalHuman';
import { materialMatchesProduct, type ProductMaterialGroupProduct, type ProductScenePreparationSlotView } from '../material-library/ProductMaterialGroup';
import type { MaterialSourceFilter, MaterialThemeFilter } from '../material-library/MaterialTaxonomyFilters';
import { MATERIAL_LIBRARY_FETCH_PAGE_SIZE, fetchCompleteProductMaterialInventory, type ProductMaterialSummary } from './inspirationProductMaterialInventory';

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
  const [inventorySlots, setInventorySlots] = useState<ProductScenePreparationSlotView[]>([]);
  const [inventoryError, setInventoryError] = useState('');
  const inFlightRef = useRef(0);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialPage, setMaterialPage] = useState(1);
  const [materialFacets, setMaterialFacets] = useState<MaterialLibraryFacets | null>(null);
  const materialLibraryRequestRef = useRef(0);

  const refreshMaterials = async (page?: number): Promise<Material[]> => {
    const requestId = ++materialLibraryRequestRef.current;
    inFlightRef.current += 1;
    if (!localMaterials.length) setMaterialsLoading(true);
    try {
      const inventory = await studioApi.listMaterialLibrary('library', {
        page: 1,
        pageSize: MATERIAL_LIBRARY_FETCH_PAGE_SIZE,
      });
      const pageCount = Math.max(1, Math.ceil(Number(inventory.total ?? inventory.items.length) / MATERIAL_LIBRARY_FETCH_PAGE_SIZE));
      const additionalPages = pageCount > 1
        ? await (async () => {
          const pages = [];
          for (let next = 2; next <= pageCount; next += 1) pages.push(await studioApi.listMaterialLibrary('library', { page: next, pageSize: MATERIAL_LIBRARY_FETCH_PAGE_SIZE }));
          return pages;
        })()
        : [];
      const materials = [...new Map([inventory, ...additionalPages]
        .flatMap(result => result.items)
        .map(material => [material.id, material])).values()];
      if (requestId !== materialLibraryRequestRef.current) return localMaterials;
      setLocalMaterials(materials);
      setInventorySlots(inventory.productSceneSlots || []);
      setInventoryError('');
      setMaterialFacets(inventory.facets || null);
      if (page !== undefined) setMaterialPage(page);
      return materials;
    } catch (error) {
      if (requestId === materialLibraryRequestRef.current) setInventoryError(error instanceof Error ? error.message : '素材读取失败');
      // Keep last successful items; callers can still decide whether the stale
      // signed media URL is usable.
      return localMaterials;
    } finally {
      inFlightRef.current -= 1;
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

  const refreshRef = useRef(refreshMaterials);
  refreshRef.current = refreshMaterials;
  const initialRead = useRef(false);
  useEffect(() => {
    if (!initialRead.current || (innerView === 'library' || innerView === 'shooting')) {
      initialRead.current = true;
      if (!inFlightRef.current) void refreshRef.current(1);
    }
  }, [innerView]);

  useEffect(() => {
    if (innerView !== 'library' && innerView !== 'shooting') return;
    const refresh = (event?: Event) => {
      if ((event as CustomEvent | undefined)?.detail?.origin === 'inspiration-library') return;
      if (document.visibilityState !== 'hidden' && !inFlightRef.current) void refreshRef.current();
    };
    window.addEventListener('lingshu:materials-updated', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const pending = localMaterials.some(item => ['pending', 'analyzing'].includes(String(item.segmentAnalysisStatus)));
    const timer = window.setInterval(refresh, pending ? 3000 : 15000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('lingshu:materials-updated', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [innerView, localMaterials.some(item => ['pending', 'analyzing'].includes(String(item.segmentAnalysisStatus)))]);

  useEffect(() => {
    setProductMaterialSummaries(Object.fromEntries(materialProducts.map(product => [product.id, {
      materials: localMaterials.filter(material => materialMatchesProduct(material, product)),
      slots: inventorySlots.filter(slot => slot.productId === product.id),
      loading: materialsLoading,
      error: inventoryError,
    }])));
    if (productDetailProduct) {
      setProductDetailMaterials(localMaterials.filter(material => materialMatchesProduct(material, productDetailProduct)));
      setProductDetailSlots(inventorySlots.filter(slot => slot.productId === productDetailProduct.id));
    }
  }, [localMaterials, materialProducts, inventorySlots, materialsLoading, inventoryError, productSummaryRefreshVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    localMaterials, setLocalMaterials, materialsLoading, materialPage, setMaterialPage, materialFacets,
    productDetailProduct, productDetailMaterials, setProductDetailMaterials, productDetailSlots,
    setProductDetailSlots, productDetailLoading, productDetailError, productMaterialSummaries,
    setProductMaterialSummaries, setProductSummaryRefreshVersion, refreshMaterials,
    loadProductMaterialDetail, closeProductMaterialDetail,
  };
}
