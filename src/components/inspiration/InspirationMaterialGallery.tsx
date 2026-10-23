import { Button, Input, Pagination, Select } from 'antd';
import { ChevronDown, Eye, Film, Loader2, Package, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { canProcessVideo } from '../../lib/inspirationDataQuality';
import { generatedMaterialOriginLabel } from '../../lib/materialAssetOwnership';
import { STUDIO_MATERIAL_FILE_ACCEPT, STUDIO_MATERIAL_VIDEO_ACCEPT } from '../../lib/studioMaterialFile';
import MaterialTaxonomyFilters from '../material-library/MaterialTaxonomyFilters';
import { ProductMaterialGroupCard } from '../material-library/ProductMaterialGroup';
import MaterialLibraryStatus from '../studio/MaterialLibraryStatus';
import { LsMasonryGallery } from '../ui/LsExperiencePrimitives';
import { MATERIAL_LIBRARY_PAGE_SIZE, MATERIAL_PRODUCT_ALL, MATERIAL_PRODUCT_COMMON, MATERIAL_PRODUCT_LINKED_REF } from './inspirationDashboardContracts';
import { canCreateFromLibraryMaterial, MATERIAL_APPLICABILITY_LABELS, MATERIAL_FUNCTION_LABELS, MATERIAL_INDUSTRY_LABELS, materialSemanticLabel, type FavoriteFilter, type MaterialApplicabilityFilter, type MaterialIndustryFilter, type MaterialOrientationFilter, type MaterialTypeFilter } from './inspirationMaterialLibrary';
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
    materialProducts,
    materialProductFilterEnabled,
    materialProductId,
    materialProductRef,
    uploadProductSceneKind,
    setPreviewMaterial,
    setDetailMaterial,
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
    materialsLoading,
    materialPage,
    setMaterialPage,
    materialFacets,
    productMaterialSummaries,
    refreshMaterials,
    loadProductMaterialDetail,
    uploadInputRef,
    materialFunctionOptions,
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
    materialFilterCount,
    materialAdvancedFilterCount
  } = materials;
  return (
<div className="space-y-4">
              <input
                ref={uploadInputRef}
                type="file"
                multiple={!uploadProductSceneKind}
                accept={uploadProductSceneKind ? STUDIO_MATERIAL_VIDEO_ACCEPT : STUDIO_MATERIAL_FILE_ACCEPT}
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
                <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1" aria-label="我的素材筛选">
                  <div className="flex-1" style={{ minWidth: 260 }}>
                    <Input allowClear prefix={<Search size={15} />} value={materialSearch} onChange={event => setMaterialSearch(event.target.value)}
                      aria-label="搜索我的素材" placeholder="搜索素材名称、产品或主要内容" className="w-full" />
                  </div>
                  <Select className="w-32 shrink-0" aria-label="素材分类" value={materialAssetTab} onChange={setMaterialAssetTab} options={[{value:"all",label:"全部素材"},{value:"enterprise",label:"产品素材"},{value:"ai",label:"AI 素材"},{value:"cloud",label:"云素材"}]} />
                  <MaterialTaxonomyFilters source={materialSource} theme={materialTheme} total={visibleMaterialTotal}
                    sourceCounts={materialFacets?.sources || { local_upload: 0, official_import: 0, user_generated: 0 }}
                    onSourceChange={setMaterialSource} onThemeChange={setMaterialTheme} />
                  <Select className="w-32 shrink-0" value={materialType} onChange={value => setMaterialType(value as MaterialTypeFilter)} aria-label="内容形式"
                    options={[{ value: 'all', label: '全部类型' }, { value: 'video', label: '视频' }, { value: 'image', label: '图片' }, { value: 'audio', label: '音频' }]} />
                  <Button className="shrink-0" onClick={() => setMaterialFiltersOpen(value => !value)} aria-expanded={materialFiltersOpen} aria-controls="material-more-filters" icon={<SlidersHorizontal size={15} />}>
                    更多筛选{materialAdvancedFilterCount > 0 ? ` · ${materialAdvancedFilterCount}` : ''}
                  </Button>
                </div>
                <AnimatePresence initial={false}>
                  {materialFiltersOpen && <motion.div id="material-more-filters" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 md:grid-cols-2 xl:grid-cols-3">
                      <label className="space-y-1 text-xs text-text-secondary"><span>收藏状态</span><Select className="w-full" value={materialFavoriteFilter} onChange={value => setMaterialFavoriteFilter(value as FavoriteFilter)} aria-label="素材收藏状态"
                        options={[{ value: 'all', label: '全部收藏状态' }, { value: 'favorite', label: '仅看收藏' }]} /></label>
                      <label className="relative block h-14 rounded-lg border border-border bg-surface-2 transition-colors focus-within:border-accent">
                        <Package size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                        <span className="pointer-events-none absolute left-10 top-1.5 text-[10px] font-semibold text-text-muted">关联产品</span>
                        <select value={materialProductFilterValue} onChange={event => setMaterialProductSelection(event.target.value)} aria-label="按产品筛选素材"
                          className="h-full w-full cursor-pointer appearance-none rounded-lg bg-transparent pl-10 pr-9 pt-3 text-sm font-bold text-text-primary outline-none">
                          <option value={MATERIAL_PRODUCT_ALL}>全部产品素材</option>
                          <option value={MATERIAL_PRODUCT_COMMON}>企业通用素材</option>
                          {materialProductRef && !materialProductId && <option value={MATERIAL_PRODUCT_LINKED_REF}>{materialProductRef}</option>}
                          {materialProductId && materialProductRef && !materialProducts.some(item => item.id === materialProductId) && <option value={materialProductId}>{materialProductRef}</option>}
                          {materialProducts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                        <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                      </label>
                      {[
                        { label: '所属行业', value: materialIndustry, onChange: (value: string) => setMaterialIndustry(value as MaterialIndustryFilter), options: Object.entries(MATERIAL_INDUSTRY_LABELS) },
                        { label: '镜头功能', value: materialFunction, onChange: setMaterialFunction, options: [['all', MATERIAL_FUNCTION_LABELS.all], ...materialFunctionOptions.map(value => [value, MATERIAL_FUNCTION_LABELS[value] || value])] },
                        { label: '适用范围', value: materialApplicability, onChange: (value: string) => setMaterialApplicability(value as MaterialApplicabilityFilter), options: Object.entries(MATERIAL_APPLICABILITY_LABELS) },
                        { label: '画面方向', value: materialOrientation, onChange: (value: string) => setMaterialOrientation(value as MaterialOrientationFilter), options: [['all', '全部方向'], ['vertical', '竖屏 9:16'], ['horizontal', '横屏 16:9']] },
                      ].map(filter => (
                        <label key={filter.label} className="relative block h-14 rounded-lg border border-border bg-surface-2 transition-colors focus-within:border-accent">
                          <Film size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                          <span className="pointer-events-none absolute left-10 top-1.5 text-[10px] font-semibold text-text-muted">{filter.label}</span>
                          <select value={filter.value} onChange={e => filter.onChange(e.target.value)} aria-label={filter.label}
                            className="h-full w-full cursor-pointer appearance-none rounded-lg bg-transparent pl-10 pr-9 pt-3 text-sm font-bold text-text-primary outline-none">
                            {filter.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                          <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 flex justify-end">
                      <button type="button" onClick={clearMaterialFilters} disabled={materialFilterCount === 0}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold text-text-muted transition hover:bg-surface-2 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40">
                        <X size={13} />清除全部筛选
                      </button>
                    </div>
                  </motion.div>}
                </AnimatePresence>
              </div>
              <MaterialLibraryStatus onRetry={refreshMaterials} />
              {materialsLoading ? (
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
                  <div className="space-y-6">
                    {visibleProductGroupsForPage.length > 0 ? (
                      <section aria-labelledby="product-material-groups-title" className="space-y-3">
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
                                materials={summary?.materials || []}
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
                      <section aria-labelledby="ordinary-materials-title" className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <h2 id="ordinary-materials-title" className="ls-type-title-small text-text-primary">普通素材</h2>
                          <span className="ls-type-body-small text-text-muted">共 {ordinaryFilteredTotal} 条 · 当前第 {materialPage} 页</span>
                        </div>
                        <LsMasonryGallery layout="masonry" items={pagedUngroupedFilteredMaterials.map(material => ({ id: material.id, content:
                          <article className="group flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-none transition hover:border-border-bright">
                            <MaterialLibraryCardMedia
                              material={material}
                              favoriting={favoritingMaterialIds.includes(material.id)}
                              onRefresh={() => refreshMaterials(materialPage)}
                              onEdit={() => openManageDialog({ kind: 'material', item: material, action: 'edit' })}
                              onDelete={() => openManageDialog({ kind: 'material', item: material, action: 'delete' })}
                              onFavorite={() => void toggleMaterialFavorite(material)}
                              onPlay={() => setPreviewMaterial(material)}
                            />
                            <div className="flex flex-1 flex-col p-3">
                              <p className="line-clamp-2 text-sm font-bold leading-snug text-text-primary">{material.name}</p>
                              <p className="mt-1 line-clamp-1 text-xs font-semibold leading-5 text-text-muted" title={materialSemanticLabel(material)}>{materialSemanticLabel(material)}</p>
                              {generatedMaterialOriginLabel(material) && <p className="mt-1 line-clamp-1 text-[11px] font-medium leading-5 text-text-muted" title={generatedMaterialOriginLabel(material)}>{generatedMaterialOriginLabel(material)}</p>}
                              <MaterialUsageMark material={material} />
                              <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
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
