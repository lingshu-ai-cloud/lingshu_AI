import { Alert, Button, Input, Pagination, Select, TreeSelect } from 'antd';
import { Eye, Film, Loader2, Search, Sparkles, X } from 'lucide-react';
import { canProcessVideo } from '../../lib/inspirationDataQuality';
import { generatedMaterialOriginLabel } from '../../lib/materialAssetOwnership';
import { STUDIO_MATERIAL_FILE_ACCEPT, STUDIO_MATERIAL_VIDEO_ACCEPT } from '../../lib/studioMaterialFile';
import { MATERIAL_THEME_LABELS } from '../../../shared/materialTaxonomy';
import { MATERIAL_LIBRARY_CATEGORY_LABELS, materialLibraryCategoryOf, normalizeMaterialLibrarySelection } from '../../../shared/materialLibraryKinds';
import { ProductMaterialGroupCard } from '../material-library/ProductMaterialGroup';
import MaterialLibraryStatus from '../studio/MaterialLibraryStatus';
import { LsMasonryGallery } from '../ui/LsExperiencePrimitives';
import { MATERIAL_LIBRARY_PAGE_SIZE, MATERIAL_PRODUCT_ALL, MATERIAL_PRODUCT_COMMON, MATERIAL_PRODUCT_LINKED_REF } from './inspirationDashboardContracts';
import { canCreateFromLibraryMaterial, materialSemanticLabel, type MaterialTypeFilter } from './inspirationMaterialLibrary';
import { MaterialLibraryCardMedia } from './MaterialLibraryCardMedia';
import { MaterialUsageMark } from './MaterialUsageHistory';
import type { useInspirationCreation } from './useInspirationCreation';
import type { useInspirationItemManagement } from './useInspirationItemManagement';
import type { useInspirationMaterials } from './useInspirationMaterials';

interface Props {
  materials: ReturnType<typeof useInspirationMaterials>;
  favoritingMaterialIds: string[];
  openManageDialog: ReturnType<typeof useInspirationItemManagement>['openManageDialog'];
  enterMaterialSmartGeneration: ReturnType<typeof useInspirationCreation>['enterMaterialSmartGeneration'];
}

export default function InspirationMaterialGallery({ materials, favoritingMaterialIds, openManageDialog, enterMaterialSmartGeneration }: Props) {
  const {
    materialCategories, setMaterialCategories, setMaterialGroup, setMaterialCategory,
    materialProducts, materialProductsError, refreshMaterialProducts,
    materialProductFilterEnabled,
    materialProductId,
    materialProductRef,
    uploadProductSceneKind, uploadingScriptGapId,
    setPreviewMaterial,
    setDetailMaterial,
    materialSearch,
    setMaterialSearch,
    materialAssetTab,
    setMaterialAssetTab,
    setMaterialSource,
    materialTheme,
    setMaterialTheme,
    materialType,
    setMaterialType,
    localMaterials,
    materialsLoading, inventoryError,
    materialPage,
    setMaterialPage,
    filteredProductMaterialSummaries: productMaterialSummaries,
    refreshMaterials,
    loadProductMaterialDetail,
    uploadInputRef,
    visibleProductGroups,
    ordinaryFilteredTotal,
    pagedUngroupedFilteredMaterials,
    visibleProductGroupsForPage,
    visibleMaterialTotal,
    visibleMaterialGalleryCount,
    handleUploadMaterials,
    toggleMaterialFavorite,
    setMaterialProductSelection,
    materialProductFilterValue,
    clearMaterialFilters,
    materialFilterCount
  } = materials;
  return (
<div className="space-y-4">
              <input
                ref={uploadInputRef}
                type="file"
                multiple={!uploadProductSceneKind}
                accept={uploadProductSceneKind || uploadingScriptGapId ? STUDIO_MATERIAL_VIDEO_ACCEPT : STUDIO_MATERIAL_FILE_ACCEPT}
                className="hidden"
                onChange={e => void handleUploadMaterials(e.currentTarget.files)}
              />

              {materialProductFilterEnabled && (
                <div className="flex flex-col gap-2 rounded-lg border border-blue-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">正在查看：{materialProductRef || (materialProductId ? '指定产品' : '企业通用素材')}</p>
                    <p className="mt-1 text-xs text-zinc-500">从企业知识库进入时，系统会自动带上产品筛选；上传前仍需确认本次素材归属。</p>
                  </div>
                  <button type="button" onClick={() => setMaterialProductSelection(MATERIAL_PRODUCT_ALL)} className="shrink-0 text-xs font-semibold text-blue-600 hover:text-blue-700">查看全部素材</button>
                </div>
              )}

              <div className="space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
                <div className="inspiration-material-filters flex flex-wrap items-center gap-2" aria-label="我的素材筛选">
                  <div className="w-full min-w-0 xl:w-auto xl:min-w-52 xl:flex-1">
                    <Input allowClear prefix={<Search size={15} />} value={materialSearch} onChange={event => setMaterialSearch(event.target.value)}
                      aria-label="搜索我的素材" placeholder="搜索素材名称、产品或主要内容" className="w-full" />
                  </div>
                  <TreeSelect style={{ minWidth: 224 }} className="flex-1 xl:w-56 xl:flex-none" aria-label="素材来源" placeholder="素材来源（全部来源）"
                    styles={{ input: { border: 0, boxShadow: 'none', outline: 'none', background: 'transparent' }, placeholder: { color: 'var(--color-text-primary)' } }}
                    value={materialCategories} treeCheckable treeDefaultExpandAll treeLine allowClear
                    showCheckedStrategy={TreeSelect.SHOW_PARENT} maxTagCount={1} popupMatchSelectWidth={320}
                    onChange={(values: string[]) => { setMaterialCategories(normalizeMaterialLibrarySelection(values)); setMaterialGroup('all'); setMaterialCategory('all'); setMaterialAssetTab('all'); setMaterialSource('all'); }}
                    treeData={[
                      { value: 'internal', title: '内部素材', children: ['product', 'enterprise', 'generated'].map(value => ({ value, title: MATERIAL_LIBRARY_CATEGORY_LABELS[value as keyof typeof MATERIAL_LIBRARY_CATEGORY_LABELS] })) },
                      { value: 'external', title: '外部素材', children: [{ value: 'industry', title: MATERIAL_LIBRARY_CATEGORY_LABELS.industry }] },
                    ]} />
                  <Select style={{ minWidth: 128 }} className="flex-1 xl:w-32 xl:flex-none" value={materialType} onChange={value => setMaterialType(value as MaterialTypeFilter)} aria-label="内容形式"
                    options={[{ value: 'all', label: '全部类型' }, { value: 'video', label: '视频' }, { value: 'image', label: '图片' }, { value: 'audio', label: '音频' }]} />
                  <Select style={{ minWidth: 192 }} className="flex-1 xl:w-48 xl:flex-none" aria-label="按产品筛选素材"
                    value={materialProductFilterValue} onChange={setMaterialProductSelection}
                    options={[
                      { value: MATERIAL_PRODUCT_ALL, label: '全部产品' },
                      { value: MATERIAL_PRODUCT_COMMON, label: '企业通用素材' },
                      ...(materialProductRef && !materialProductId ? [{ value: MATERIAL_PRODUCT_LINKED_REF, label: materialProductRef }] : []),
                      ...(materialProductId && materialProductRef && !materialProducts.some(item => item.id === materialProductId) ? [{ value: materialProductId, label: materialProductRef }] : []),
                      ...materialProducts.map(item => ({ value: item.id, label: item.name })),
                    ]} />
                  <Select style={{ minWidth: 144 }} className="flex-1 xl:w-36 xl:flex-none" aria-label="主题标签" value={materialTheme} onChange={setMaterialTheme}
                    options={[{ value: 'all', label: '全部主题' }, ...Object.entries(MATERIAL_THEME_LABELS).map(([value, label]) => ({ value, label }))]} />
                  <Button type="text" className="shrink-0" onClick={clearMaterialFilters} disabled={materialFilterCount === 0} icon={<X size={14} />}>重置</Button>
                </div>
              </div>
              {materialProductsError && <Alert type="error" showIcon title={materialProductsError}
                action={<Button size="small" onClick={() => void refreshMaterialProducts()}>重试读取产品</Button>} />}
              <div className="flex flex-wrap items-center gap-2" aria-label="工厂素材快捷筛选">
                {['工厂实拍', '产线', '灌装', '包装', '产品实拍'].map(term => <Button key={term} size="small" onClick={() => {
                  clearMaterialFilters(); setMaterialSearch(term === '产线' ? '生产线' : term);
                }}>{term}</Button>)}
              </div>
              {inventoryError && <Alert type="warning" showIcon title="素材未完整加载" description={inventoryError} action={<Button onClick={() => void refreshMaterials()}>重新加载</Button>} />}
              {materialsLoading && localMaterials.length > 0 && <p role="status" className="text-xs text-text-muted">已显示首批素材，正在加载其余素材；搜索结果与数量将在加载完成后更新。</p>}
              <MaterialLibraryStatus onRetry={refreshMaterials} />
              {materialsLoading && !localMaterials.length ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-muted">
                    <Loader2 size={16} className="animate-spin" /> 正在读取素材库...
                  </div>
                ) : localMaterials.length === 0 && materialProducts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
                    <Film size={30} className="mx-auto mb-3 text-text-muted opacity-50" />
                    <p className="text-sm font-bold text-text-primary">还没有本地社媒素材</p>
                    <p className="mt-1 text-xs text-text-muted">可上传企业通用素材或具体产品素材；待拍任务会先由系统匹配复用、合成和已接入生成能力。</p>
                  </div>
                ) : visibleMaterialGalleryCount === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
                    <Search size={30} className="mx-auto mb-3 text-text-muted opacity-50" />
                    <p className="text-sm font-bold text-text-primary">没有符合当前标签的素材</p>
                    <button type="button" onClick={clearMaterialFilters} className="mt-2 text-xs font-bold text-accent">清空筛选条件</button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-6">
                    {visibleProductGroupsForPage.length > 0 ? (
                      <section aria-labelledby="product-material-groups-title" className="order-2 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <h2 id="product-material-groups-title" className="ls-type-title-small text-text-primary">产品素材集合</h2>
                          <span className="ls-type-body-small text-text-muted">{visibleProductGroups.length} 个产品</span>
                        </div>
                        <LsMasonryGallery layout="masonry" items={visibleProductGroupsForPage.map(product => {
                          const summary = productMaterialSummaries[product.id];
                          const hasSummaryData = Boolean(summary?.materials.length || summary?.slots.length);
                          return {
                            id: `product-${product.id}`,
                            content: (
                              <ProductMaterialGroupCard
                                product={product}
                                materials={(summary?.materials || []).filter(material => materialLibraryCategoryOf(material) === 'product')}
                                slots={summary?.slots || []}
                                loading={Boolean(summary?.loading && !hasSummaryData)}
                                error={Boolean(summary?.error && !hasSummaryData)}
                                onOpen={item => void loadProductMaterialDetail(item)}
                              />
                            ),
                          };
                        })} />
                      </section>
                    ) : null}
                    {pagedUngroupedFilteredMaterials.length > 0 ? (
                      <section aria-labelledby="ordinary-materials-title" className="order-1 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <h2 id="ordinary-materials-title" className="ls-type-title-small text-text-primary">普通素材</h2>
                          <span className="ls-type-body-small text-text-muted">共 {ordinaryFilteredTotal} 条 · 当前第 {materialPage} 页</span>
                        </div>
                        <LsMasonryGallery layout="masonry" items={pagedUngroupedFilteredMaterials.map(material => ({ id: material.id, content:
                          <article className="group relative overflow-hidden rounded-lg border border-border bg-surface shadow-none transition hover:border-border-bright focus-within:border-accent">
                            <MaterialLibraryCardMedia
                              material={material}
                              favoriting={favoritingMaterialIds.includes(material.id)}
                              onRefresh={() => refreshMaterials(materialPage)}
                              onEdit={() => openManageDialog({ kind: 'material', item: material, action: 'edit' })}
                              onDelete={() => openManageDialog({ kind: 'material', item: material, action: 'delete' })}
                              onFavorite={() => void toggleMaterialFavorite(material)}
                              onPlay={() => setPreviewMaterial(material)}
                            />
                            <div className="ls-touch-media-reveal absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/90 via-black/65 to-transparent px-3 pb-3 pt-10 text-white opacity-0 transition-opacity duration-[var(--ls-motion-fast)] group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
                              <p className="line-clamp-2 text-sm font-bold leading-snug text-text-primary">{material.name}</p>
                              <p className="mt-1 line-clamp-1 text-xs font-semibold leading-5 text-text-muted" title={materialSemanticLabel(material)}>{materialSemanticLabel(material)}</p>
                              {generatedMaterialOriginLabel(material) && <p className="mt-1 line-clamp-1 text-[11px] font-medium leading-5 text-text-muted" title={generatedMaterialOriginLabel(material)}>{generatedMaterialOriginLabel(material)}</p>}
                              <MaterialUsageMark material={material} />
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <button type="button" onClick={() => setDetailMaterial(material)} className="inline-flex h-9 min-w-0 flex-nowrap items-center justify-center gap-0.5 rounded-lg border border-border bg-white px-1.5 text-[11px] font-bold text-text-secondary transition hover:border-accent hover:text-accent">
                                  <Eye size={12} className="shrink-0" /><span className="whitespace-nowrap">查看详情</span>
                                </button>
                                <button type="button" onClick={() => enterMaterialSmartGeneration(material)}
                                  disabled={!canCreateFromLibraryMaterial(material)}
                                  title={material.type === 'audio' ? '音频素材不能单独进入画面创作' : material.type === 'video' && !canProcessVideo({ contentFormat: 'video', duration: material.duration }) ? '视频时长尚未识别完成' : '带入内容制作的自由创作'}
                                  className="inline-flex h-9 min-w-0 flex-nowrap items-center justify-center gap-0.5 rounded-lg bg-accent px-1.5 text-[11px] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45">
                                  <Sparkles size={12} className="shrink-0" /><span className="whitespace-nowrap">{material.type === 'image' ? '用此图创作' : '自由创作'}</span>
                                </button>
                              </div>
                            </div>
                          </article>
                        }))} />
                      </section>
                    ) : null}
                  </div>
                )}
              {ordinaryFilteredTotal > MATERIAL_LIBRARY_PAGE_SIZE && (
                <nav className="flex justify-center border-t border-border pt-5" aria-label="普通素材分页">
                  <Pagination
                    current={materialPage}
                    total={ordinaryFilteredTotal}
                    pageSize={MATERIAL_LIBRARY_PAGE_SIZE}
                    showSizeChanger={false}
                    responsive
                    disabled={materialsLoading}
                    onChange={setMaterialPage}
                    showTotal={(total, range) => `普通素材 ${range[0]}–${range[1]} / ${total} 条`}
                  />
                </nav>
              )}
            </div>
  );
}
