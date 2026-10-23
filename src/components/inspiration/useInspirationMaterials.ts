import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProductSceneKind } from '../../../shared/contracts/productScenePreparation';
import { MATERIAL_THEME_LABELS } from '../../../shared/materialTaxonomy';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useScriptGapTasks } from '../../hooks/useScriptGapTasks';
import { showActionFeedback, showActionSuccess } from '../../lib/actionFeedback';
import { type MaterialAssetTab } from '../../lib/materialAssetOwnership';
import { updateScriptGapTask } from '../../lib/scriptGapQueue';
import { studioApi, type Material } from '../../lib/studioApi';
import { studioMaterialFileKind } from '../../lib/studioMaterialFile';
import { type MaterialSourceFilter, type MaterialThemeFilter } from '../material-library/MaterialTaxonomyFilters';
import { projectMaterialGallery } from './inspirationMaterialGalleryProjection';
import { initialMaterialTaxonomyFilters, isFavoriteMaterial, materialOwnershipTags, type FavoriteFilter, type MaterialApplicabilityFilter, type MaterialGalleryFilterSnapshot, type MaterialIndustryFilter, type MaterialLibraryEntryContext, type MaterialOrientationFilter, type MaterialTypeFilter } from './inspirationMaterialLibrary';
import { fetchCompleteProductMaterialInventory } from './inspirationProductMaterialInventory';
import { useInspirationMaterialInventory } from './useInspirationMaterialInventory';

import { type InspirationInnerView, MATERIAL_LIBRARY_PAGE_SIZE, MATERIAL_PRODUCT_ALL, MATERIAL_PRODUCT_COMMON, MATERIAL_PRODUCT_LINKED_REF, type StateSetter } from './inspirationDashboardContracts';

interface Dependencies {
  materialEntry: MaterialLibraryEntryContext;
  innerView: InspirationInnerView;
  setInnerView: StateSetter<InspirationInnerView>;
  favoritingMaterialIds: string[];
  setFavoritingMaterialIds: StateSetter<string[]>;
  setMaterialMessage: StateSetter<string>;
}

export function useInspirationMaterials({ materialEntry, innerView, setMaterialMessage, setInnerView, favoritingMaterialIds, setFavoritingMaterialIds }: Dependencies) {
  const [materialProducts, setMaterialProducts] = useState<Array<{id:string;name:string}>>([]);

  const [materialProductFilterEnabled, setMaterialProductFilterEnabled] = useState(() => Boolean(materialEntry.productId || materialEntry.productRef));

  const [materialProductId, setMaterialProductId] = useState(materialEntry.productId);

  const [materialProductRef, setMaterialProductRef] = useState(materialEntry.productRef);

  const [uploadProductId, setUploadProductId] = useState(() => materialEntry.productId || '');

  const [uploadProductSceneKind, setUploadProductSceneKind] = useState<ProductSceneKind | null>(null);

  const [previewMaterial, setPreviewMaterial] = useState<Material | null>(null);

  const [previewMaterialAttempt, setPreviewMaterialAttempt] = useState(0);

  const [previewMaterialLoading, setPreviewMaterialLoading] = useState(false);

  const [previewMaterialError, setPreviewMaterialError] = useState('');

  const previewMaterialAutoRetryRef = useRef(0);

  const [detailMaterial, setDetailMaterial] = useState<Material | null>(null);

  const [updatingMaterialTheme, setUpdatingMaterialTheme] = useState(false);

  const detailMaterialDialogRef = useModalFocus<HTMLDivElement>({
    open: Boolean(detailMaterial),
    onClose: () => setDetailMaterial(null),
  });

  const [materialSearch, setMaterialSearch] = useState('');

  const [materialAssetTab, setMaterialAssetTab] = useState<MaterialAssetTab>('all');

  const [materialIndustry, setMaterialIndustry] = useState<MaterialIndustryFilter>('all');

  const [materialFunction, setMaterialFunction] = useState('all');

  const [materialApplicability, setMaterialApplicability] = useState<MaterialApplicabilityFilter>('all');

  const [materialOrientation, setMaterialOrientation] = useState<MaterialOrientationFilter>('all');

  const [initialTaxonomyFilters] = useState(initialMaterialTaxonomyFilters);

  const [materialSource, setMaterialSource] = useState<MaterialSourceFilter>(initialTaxonomyFilters.source);

  const [materialTheme, setMaterialTheme] = useState<MaterialThemeFilter>(initialTaxonomyFilters.theme);

  const [materialType, setMaterialType] = useState<MaterialTypeFilter>('all');

  const [materialFavoriteFilter, setMaterialFavoriteFilter] = useState<FavoriteFilter>('all');

  const [materialFiltersOpen, setMaterialFiltersOpen] = useState(false);

  const {
    localMaterials, setLocalMaterials, materialsLoading, materialPage, setMaterialPage, materialFacets,
    productDetailProduct, productDetailMaterials, setProductDetailMaterials, productDetailSlots,
    setProductDetailSlots, productDetailLoading, productDetailError, productMaterialSummaries,
    setProductMaterialSummaries, setProductSummaryRefreshVersion, refreshMaterials,
    loadProductMaterialDetail, closeProductMaterialDetail,
  } = useInspirationMaterialInventory({ innerView, materialSource, materialTheme, materialProducts });

  const updateDetailMaterialTheme = async (theme: keyof typeof MATERIAL_THEME_LABELS) => {
    if (!detailMaterial || updatingMaterialTheme) return;
    setUpdatingMaterialTheme(true);
    try {
      const result = await studioApi.updateMaterial(detailMaterial.id, { name: detailMaterial.name, primaryTheme: theme });
      if (!result.ok || !result.material) throw new Error(result.error || '主题标签保存失败');
      setDetailMaterial(result.material);
      setLocalMaterials(items => items.map(item => item.id === result.material!.id ? result.material! : item));
      setProductDetailMaterials(items => items.map(item => item.id === result.material!.id ? result.material! : item));
      setProductMaterialSummaries(current => Object.fromEntries(Object.entries(current).map(([productId, summary]) => [
        productId,
        { ...summary, materials: summary.materials.map(item => item.id === result.material!.id ? result.material! : item) },
      ])));
    } catch (error) { setMaterialMessage(error instanceof Error ? error.message : '主题标签保存失败'); }
    finally { setUpdatingMaterialTheme(false); }
  };

  const [uploadingMaterial, setUploadingMaterial] = useState(false);

  const [materialUploadDialogOpen, setMaterialUploadDialogOpen] = useState(false);

  const { scriptGapTasks, shootingTaskError: _shootingTaskError } = useScriptGapTasks();

  const [uploadingScriptGapId, setUploadingScriptGapId] = useState('');

  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const taskId = new URLSearchParams(window.location.search).get('task');
    if (taskId) document.getElementById(`shooting-task-${taskId}`)?.scrollIntoView({ block: 'center' });
  }, [scriptGapTasks]);

  useEffect(() => {
    if (innerView !== 'library') return;
    const url = new URL(window.location.href);
    materialSource === 'all' ? url.searchParams.delete('source') : url.searchParams.set('source', materialSource);
    materialTheme === 'all' ? url.searchParams.delete('theme') : url.searchParams.set('theme', materialTheme);
    window.history.replaceState(window.history.state, '', url);
  }, [innerView, materialSource, materialTheme]);

  useEffect(() => {
    previewMaterialAutoRetryRef.current = 0;
    setPreviewMaterialAttempt(0);
    setPreviewMaterialError('');
    setPreviewMaterialLoading(Boolean(previewMaterial));
  }, [previewMaterial?.id]);

  const refreshMaterialPreviewUrl = async () => {
    const current = previewMaterial;
    if (!current) return;
    setPreviewMaterialLoading(true);
    setPreviewMaterialError('');
    try {
      let items: Material[];
      const previewProductId = String(current.productId || '').trim()
        || (productDetailMaterials.some(item => item.id === current.id) ? productDetailProduct?.id || '' : '');
      if (previewProductId) {
        const product = materialProducts.find(item => item.id === previewProductId) || {
          id: previewProductId,
          name: current.productName || current.name,
        };
        const inventory = await fetchCompleteProductMaterialInventory(product);
        items = inventory.materials;
        setProductMaterialSummaries(summaries => ({
          ...summaries,
          [product.id]: { ...inventory, loading: false, error: '' },
        }));
        if (productDetailProduct?.id === product.id) {
          setProductDetailMaterials(inventory.materials);
          setProductDetailSlots(inventory.slots);
        }
      } else {
        items = await refreshMaterials();
      }
      const fresh = items.find(item => item.id === current.id);
      if (!fresh?.url) {
        setPreviewMaterialLoading(false);
        setPreviewMaterialError('素材文件暂时不可用，请稍后重试。');
        return;
      }
      setPreviewMaterial(fresh);
      setPreviewMaterialAttempt(value => value + 1);
    } catch (error) {
      setPreviewMaterialLoading(false);
      setPreviewMaterialError(error instanceof Error ? error.message : '素材文件暂时不可用，请稍后重试。');
    }
  };

  const handleMaterialPreviewError = (message?: string) => {
    if (previewMaterialAutoRetryRef.current < 1) {
      previewMaterialAutoRetryRef.current += 1;
      void refreshMaterialPreviewUrl();
      return;
    }
    setPreviewMaterialLoading(false);
    setPreviewMaterialError(message || '视频文件加载或解码失败，请重新获取播放地址。');
  };

  useEffect(() => {
    let active = true;
    void studioApi.materialProducts().then(result => {
      if (!active) return;
      setMaterialProducts(result.items);
      if (!materialEntry.productRef) return;
      const matched = materialEntry.productId
        ? result.items.find(item => item.id === materialEntry.productId)
        : result.items.find(item => item.name === materialEntry.productRef);
      if (!matched) return;
      setMaterialProductFilterEnabled(true);
      setMaterialProductId(matched.id);
      setMaterialProductRef(matched.name);
      setUploadProductId(current => current || matched.id);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [materialEntry.productId, materialEntry.productRef]);

  const activeMaterialFilters = useMemo<MaterialGalleryFilterSnapshot>(() => ({
    query: materialSearch,
    assetTab: materialAssetTab,
    type: materialType,
    industry: materialIndustry,
    shotFunction: materialFunction,
    applicability: materialApplicability,
    orientation: materialOrientation,
    source: materialSource,
    theme: materialTheme,
    favorite: materialFavoriteFilter,
  }), [materialSearch, materialAssetTab, materialType, materialIndustry, materialFunction, materialApplicability, materialOrientation, materialSource, materialTheme, materialFavoriteFilter]);

  const {
    materialFunctionOptions,
    visibleProductGroups,
    ordinaryFilteredTotal,
    pagedUngroupedFilteredMaterials,
    visibleProductGroupsForPage,
    visibleMaterialTotal,
    visibleMaterialGalleryCount,
  } = useMemo(() => projectMaterialGallery({
    materials: localMaterials,
    products: materialProducts,
    summaries: productMaterialSummaries,
    filters: activeMaterialFilters,
    productFilter: { enabled: materialProductFilterEnabled, productId: materialProductId, productRef: materialProductRef },
    page: materialPage,
    pageSize: MATERIAL_LIBRARY_PAGE_SIZE,
  }), [localMaterials, materialProducts, productMaterialSummaries, activeMaterialFilters, materialProductFilterEnabled, materialProductId, materialProductRef, materialPage]);

  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(ordinaryFilteredTotal / MATERIAL_LIBRARY_PAGE_SIZE));
    setMaterialPage(current => Math.min(current, lastPage));
  }, [ordinaryFilteredTotal]);

  useEffect(() => {
    setMaterialPage(1);
  }, [materialSearch, materialAssetTab, materialType, materialIndustry, materialFunction, materialApplicability, materialOrientation, materialSource, materialTheme, materialFavoriteFilter, materialProductFilterEnabled, materialProductId, materialProductRef]);

  const handleUploadMaterials = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadingMaterial(true);
    setMaterialMessage('');
    try {
      if (uploadProductSceneKind && files.length !== 1) {
        throw new Error('每个预制场景一次上传一个视频');
      }
      const uploadedAnalyzable: Material[] = [];
      const uploadedIds: string[] = [];
      for (const file of Array.from(files)) {
        const type = studioMaterialFileKind(file);
        if (!type) {
          throw new Error(`「${file.name}」的文件格式无法识别，请使用受支持的视频、图片或音频格式`);
        }
        if (uploadProductSceneKind && type !== 'video') {
          throw new Error('预制场景仅支持上传视频');
        }
        const result = await studioApi.uploadMaterialFile(file, {
          folder: uploadProductSceneKind ? 'product-scenes' : 'social',
          type,
          sourceType: uploadProductSceneKind ? 'product-scene-preparation' : 'local-upload',
          ...(uploadProductSceneKind ? { productId: uploadProductId, productSceneType: uploadProductSceneKind } : {}),
        });
        if (!result.ok || !result.material?.id) throw new Error(result.error || `「${file.name}」上传失败，请检查素材服务后重试`);
        uploadedIds.push(result.material.id);
        if (type === 'video' || type === 'image') uploadedAnalyzable.push(result.material);
        // Product-scene uploads are verified and bound to the selected product
        // and slot by the upload endpoint itself. Do not turn that successful
        // atomic write into a reported failure with a second PATCH request.
        if (uploadProductSceneKind) continue;
        const linked = await studioApi.updateMaterial(result.material.id, {
          name: result.material.name || file.name,
          tags: materialOwnershipTags(result.material.tags, uploadProductId),
          productId: uploadProductId,
          enterpriseCommon: !uploadProductId,
        });
        if (!linked.ok) throw new Error(`「${file.name}」已上传，但素材归属保存失败，请在素材卡片中编辑后重试`);
      }
      const ownershipLabel = uploadProductId ? '指定产品素材' : '企业通用素材';
      setMaterialMessage(uploadedAnalyzable.length ? `已作为${ownershipLabel}上传，编导 Agent 正在识别 ${uploadedAnalyzable.length} 个图片/视频素材…` : `已上传 ${files.length} 个${ownershipLabel}`);
      await refreshMaterials();
      setProductSummaryRefreshVersion(version => version + 1);
      if (productDetailProduct) await loadProductMaterialDetail(productDetailProduct);
      window.dispatchEvent(new Event('lingshu:materials-updated'));
      if (uploadingScriptGapId && uploadedIds.length) await updateScriptGapTask(uploadingScriptGapId, { uploadedMaterialIds: uploadedIds });
      setMaterialMessage(uploadedAnalyzable.length
        ? `已上传 ${files.length} 个${ownershipLabel}，图片/视频已进入编导分析队列，可在素材详情查看用途`
        : `已上传 ${files.length} 个${ownershipLabel}`);
      setUploadProductSceneKind(null);
      setTimeout(() => setMaterialMessage(''), 2800);
    } catch (e) {
      setMaterialMessage(e instanceof Error ? e.message : '素材上传失败');
    } finally {
      setUploadingMaterial(false);
      setUploadingScriptGapId('');
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  const requestMaterialUpload = (scriptGapId = '') => {
    setInnerView('library');
    setUploadingScriptGapId(scriptGapId);
    setUploadProductSceneKind(null);
    setMaterialUploadDialogOpen(true);
  };

  const toggleMaterialFavorite = async (material: Material) => {
    if (favoritingMaterialIds.includes(material.id)) return;
    if (!material.canManage) {
      showActionFeedback({ title: '共享素材暂不能收藏', description: '请先复制到企业素材库后再收藏。', tone: 'warning' });
      return;
    }
    const nextPinned = !isFavoriteMaterial(material);
    setFavoritingMaterialIds(ids => [...ids, material.id]);
    setMaterialMessage('');
    try {
      const result = await studioApi.setMaterialPinned(material.id, nextPinned);
      if (!result.ok) throw new Error(result.error || '收藏状态保存失败');
      const applyPinned = (item: Material) => item.id === material.id ? { ...item, pinned: nextPinned } : item;
      setLocalMaterials(items => items.map(applyPinned));
      setProductDetailMaterials(items => items.map(applyPinned));
      setProductMaterialSummaries(current => Object.fromEntries(Object.entries(current).map(([productId, summary]) => [
        productId,
        { ...summary, materials: summary.materials.map(applyPinned) },
      ])));
      setMaterialMessage(nextPinned ? `已收藏素材：${material.name}` : `已取消收藏：${material.name}`);
      showActionSuccess(nextPinned ? '收藏成功' : '已取消收藏', nextPinned ? '可通过“仅看收藏”快速筛选。' : material.name);
      setTimeout(() => setMaterialMessage(''), 3500);
      window.dispatchEvent(new Event('lingshu:materials-updated'));
    } catch (error) {
      const message = error instanceof Error ? error.message : '收藏状态保存失败';
      setMaterialMessage(message);
      showActionFeedback({ title: '操作失败', description: message, tone: 'error' });
    } finally {
      setFavoritingMaterialIds(ids => ids.filter(id => id !== material.id));
    }
  };

  const setMaterialProductSelection = (value: string) => {
    const url = new URL(window.location.href);
    if (value === MATERIAL_PRODUCT_ALL) {
      setMaterialProductFilterEnabled(false);
      setMaterialProductId('');
      setMaterialProductRef('');
      url.searchParams.delete('productId');
      url.searchParams.delete('productRef');
    } else if (value === MATERIAL_PRODUCT_COMMON) {
      setMaterialProductFilterEnabled(true);
      setMaterialProductId('');
      setMaterialProductRef('');
      url.searchParams.set('productId', '');
      url.searchParams.set('productRef', '');
    } else if (value === MATERIAL_PRODUCT_LINKED_REF) {
      setMaterialProductFilterEnabled(true);
      setMaterialProductId('');
      url.searchParams.set('productId', '');
      url.searchParams.set('productRef', materialProductRef);
    } else {
      const product = materialProducts.find(item => item.id === value);
      setMaterialProductFilterEnabled(true);
      setMaterialProductId(value);
      setMaterialProductRef(product?.name || materialProductRef);
      url.searchParams.set('productId', value);
      url.searchParams.set('productRef', product?.name || materialProductRef);
    }
    const productId = String(url.searchParams.get('productId') || '');
    const productRef = String(url.searchParams.get('productRef') || '');
    window.history.replaceState({
      ...window.history.state,
      productionDetail: {
        ...(window.history.state?.productionDetail || {}),
        page: 'socialInspiration',
        view: 'library',
        productId,
        productRef,
      },
    }, '', url);
  };

  const materialProductFilterValue = !materialProductFilterEnabled
    ? MATERIAL_PRODUCT_ALL
    : materialProductId || (materialProductRef ? MATERIAL_PRODUCT_LINKED_REF : MATERIAL_PRODUCT_COMMON);

  const clearMaterialFilters = () => {
    setMaterialSearch('');
    setMaterialAssetTab('all');
    setMaterialSource('all');
    setMaterialTheme('all');
    setMaterialType('all');
    setMaterialFavoriteFilter('all');
    setMaterialIndustry('all');
    setMaterialFunction('all');
    setMaterialApplicability('all');
    setMaterialOrientation('all');
    setMaterialProductSelection(MATERIAL_PRODUCT_ALL);
  };

  const materialFilterCount = Number(materialSearch.trim().length > 0)
    + Number(materialAssetTab !== 'all')
    + Number(materialTheme !== 'all')
    + Number(materialSource !== 'all')
    + Number(materialType !== 'all')
    + Number(materialFavoriteFilter !== 'all')
    + Number(materialIndustry !== 'all')
    + Number(materialFunction !== 'all')
    + Number(materialApplicability !== 'all')
    + Number(materialOrientation !== 'all')
    + Number(materialProductFilterEnabled);

  const materialAdvancedFilterCount = Number(materialIndustry !== 'all')
    + Number(materialFavoriteFilter !== 'all')
    + Number(materialFunction !== 'all')
    + Number(materialApplicability !== 'all')
    + Number(materialOrientation !== 'all')
    + Number(materialProductFilterEnabled);

  return {
    materialProducts,
    setMaterialProducts,
    materialProductFilterEnabled,
    materialProductId,
    materialProductRef,
    uploadProductId,
    setUploadProductId,
    uploadProductSceneKind,
    setUploadProductSceneKind,
    previewMaterial,
    setPreviewMaterial,
    previewMaterialAttempt,
    previewMaterialLoading,
    setPreviewMaterialLoading,
    previewMaterialError,
    setPreviewMaterialError,
    previewMaterialAutoRetryRef,
    detailMaterial,
    setDetailMaterial,
    updatingMaterialTheme,
    materialSearch,
    setMaterialSearch,
    materialAssetTab,
    setMaterialAssetTab,
    materialIndustry,
    setMaterialIndustry,
    materialFunction,
    setMaterialFunction,
    materialApplicability,
    setMaterialApplicability,
    materialOrientation,
    setMaterialOrientation,
    materialSource,
    setMaterialSource,
    materialTheme,
    setMaterialTheme,
    materialType,
    setMaterialType,
    materialFavoriteFilter,
    setMaterialFavoriteFilter,
    materialFiltersOpen,
    setMaterialFiltersOpen,
    localMaterials,
    setLocalMaterials,
    materialsLoading,
    materialPage,
    setMaterialPage,
    materialFacets,
    productDetailProduct,
    productDetailMaterials,
    setProductDetailMaterials,
    productDetailSlots,
    productDetailLoading,
    productDetailError,
    productMaterialSummaries,
    setProductSummaryRefreshVersion,
    refreshMaterials,
    loadProductMaterialDetail,
    closeProductMaterialDetail,
    updateDetailMaterialTheme,
    uploadingMaterial,
    materialUploadDialogOpen,
    setMaterialUploadDialogOpen,
    scriptGapTasks,
    setUploadingScriptGapId,
    uploadInputRef,
    refreshMaterialPreviewUrl,
    handleMaterialPreviewError,
    materialFunctionOptions,
    visibleProductGroups,
    ordinaryFilteredTotal,
    pagedUngroupedFilteredMaterials,
    visibleProductGroupsForPage,
    visibleMaterialTotal,
    visibleMaterialGalleryCount,
    handleUploadMaterials,
    requestMaterialUpload,
    toggleMaterialFavorite,
    setMaterialProductSelection,
    materialProductFilterValue,
    clearMaterialFilters,
    materialFilterCount,
    materialAdvancedFilterCount
  };
}
