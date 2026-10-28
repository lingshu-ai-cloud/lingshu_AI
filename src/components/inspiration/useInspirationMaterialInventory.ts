import { useEffect, useRef, useState } from 'react';
import { studioApi, type Material } from '../../lib/studioApi';
import type { MaterialLibraryFacets } from '../../lib/studioDigitalHuman';
import { materialMatchesProduct, type ProductMaterialGroupProduct, type ProductScenePreparationSlotView } from '../material-library/ProductMaterialGroup';
import type { MaterialSourceFilter, MaterialThemeFilter } from '../material-library/MaterialTaxonomyFilters';
import { MATERIAL_LIBRARY_FETCH_PAGE_SIZE, fetchCompleteProductMaterialInventory, type ProductMaterialSummary } from './inspirationProductMaterialInventory';
import { MATERIAL_LIBRARY_PAGE_SIZE } from './inspirationDashboardContracts';

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
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialPage, setMaterialPage] = useState(1);
  const [materialFacets, setMaterialFacets] = useState<MaterialLibraryFacets | null>(null);
  const [ordinaryPageItems, setOrdinaryPageItems] = useState<Material[]>([]);
  const [ordinaryTotal, setOrdinaryTotal] = useState(0);
  const [inventoryTotal, setInventoryTotal] = useState(0);
  const [allMaterialsLoaded, setAllMaterialsLoaded] = useState(false);
  const materialLibraryRequestRef = useRef(0);
  const lastInventoryReadAtRef = useRef(0);

  const refreshPage = async (page = materialPage, compact = false): Promise<Material[]> => {
    const requestId = ++materialLibraryRequestRef.current;
    inFlightRef.current += 1;
    setMaterialsLoading(true);
    try {
      const ordinary = await studioApi.listMaterialLibrary('library', { excludeProductAssociated: true, page, pageSize: MATERIAL_LIBRARY_PAGE_SIZE });
      if (requestId !== materialLibraryRequestRef.current) return ordinaryPageItems;
      if (!allMaterialsLoaded || compact) setLocalMaterials(ordinary.items);
      setInventorySlots(ordinary.productSceneSlots || []);
      setOrdinaryPageItems(ordinary.items);
      setOrdinaryTotal(Number(ordinary.total ?? ordinary.items.length));
      setInventoryTotal(Number(ordinary.inventoryTotal ?? ordinary.total ?? ordinary.items.length));
      if (compact) setAllMaterialsLoaded(false);
      setInventoryLoaded(true);
      setInventoryError('');
      setMaterialFacets(ordinary.facets || null);
      lastInventoryReadAtRef.current = Date.now();
      return ordinary.items;
    } catch (error) {
      if (requestId === materialLibraryRequestRef.current) setInventoryError(error instanceof Error ? error.message : '素材读取失败');
      return ordinaryPageItems;
    } finally {
      inFlightRef.current -= 1;
      if (requestId === materialLibraryRequestRef.current) setMaterialsLoading(false);
    }
  };

  const refreshMaterials = async (page?: number): Promise<Material[]> => {
    const requestId = ++materialLibraryRequestRef.current;
    inFlightRef.current += 1;
    const progressive = !localMaterials.length;
    setMaterialsLoading(true);
    try {
      const inventory = await studioApi.listMaterialLibrary('library', {
        page: 1,
        pageSize: MATERIAL_LIBRARY_FETCH_PAGE_SIZE,
      });
      const pageCount = Math.max(1, Math.ceil(Number(inventory.total ?? inventory.items.length) / MATERIAL_LIBRARY_FETCH_PAGE_SIZE));
      if (requestId !== materialLibraryRequestRef.current) return localMaterials;
      if (progressive) { setLocalMaterials(inventory.items); setInventorySlots(inventory.productSceneSlots || []); }
      const additionalPages: typeof inventory[] = [];
      // Publish the first page immediately; bound background reads to four.
      for (let next = 2; next <= pageCount; next += 4) {
        const batch = await Promise.all(Array.from({ length: Math.min(4, pageCount - next + 1) }, (_, index) =>
          studioApi.listMaterialLibrary('library', { page: next + index, pageSize: MATERIAL_LIBRARY_FETCH_PAGE_SIZE })));
        if (requestId !== materialLibraryRequestRef.current) return localMaterials;
        additionalPages.push(...batch);
        // Keep the first page usable while the remaining pages load. Publishing
        // every batch re-runs the gallery filters and all product summaries.
      }
      const materials = [...new Map([inventory, ...additionalPages]
        .flatMap(result => result.items)
        .map(material => [material.id, material])).values()];
      if (requestId !== materialLibraryRequestRef.current) return localMaterials;
      setLocalMaterials(materials);
      setInventorySlots(inventory.productSceneSlots || []);
      setInventoryError('');
      setInventoryLoaded(true);
      setMaterialFacets(inventory.facets || null);
      setInventoryTotal(materials.length);
      setAllMaterialsLoaded(true);
      lastInventoryReadAtRef.current = Date.now();
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

  const refreshRef = useRef(refreshPage);
  refreshRef.current = refreshPage;
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
      if (event?.type !== 'lingshu:materials-updated' && Date.now() - lastInventoryReadAtRef.current < 30_000) return;
      if (document.visibilityState !== 'hidden' && !inFlightRef.current) {
        if (event?.type === 'lingshu:materials-updated' && allMaterialsLoaded) void refreshMaterials();
        else void refreshRef.current();
      }
    };
    window.addEventListener('lingshu:materials-updated', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const pending = localMaterials.some(item => ['pending', 'analyzing'].includes(String(item.segmentAnalysisStatus))
      || ['queued', 'running'].includes(String(item.productImageProcessing?.cutout)));
    // Poll only the visible page; full inventory is loaded on explicit filters.
    const timer = window.setInterval(refresh, pending ? 30_000 : 120_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('lingshu:materials-updated', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [innerView, allMaterialsLoaded, localMaterials.some(item => ['pending', 'analyzing'].includes(String(item.segmentAnalysisStatus))
    || ['queued', 'running'].includes(String(item.productImageProcessing?.cutout)))]);

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
    localMaterials, setLocalMaterials, materialsLoading, inventoryLoaded, inventoryError, materialPage, setMaterialPage, materialFacets,
    ordinaryPageItems, ordinaryTotal, inventoryTotal, allMaterialsLoaded, refreshPage,
    productDetailProduct, productDetailMaterials, setProductDetailMaterials, productDetailSlots,
    setProductDetailSlots, productDetailLoading, productDetailError, productMaterialSummaries,
    setProductMaterialSummaries, setProductSummaryRefreshVersion, refreshMaterials,
    loadProductMaterialDetail, closeProductMaterialDetail,
  };
}
