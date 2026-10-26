import { LeadContentPackagePreview } from './studioLazyPanels.js';
import { enterpriseBuyerText } from '../../lib/studioValidation';
import { Suspense } from 'react';
import { Film, Check, Search, Sparkles, Upload, X, FolderOpen, ChevronDown } from 'lucide-react';
import { Field, Pill, SectionTitle } from '../StudioFormPrimitives';
import { LANGS } from './studioLanguageRules';
import { IMAGE_DELIVERABLE_LABELS } from '../../../shared/imageCreativePlanning';
import { STUDIO_ACCENT } from './studioWorkspaceConfig.js';
import { DEFAULT_VIDEO_CONVERSION_GOAL, VIDEO_THEMES, IMAGE_DELIVERABLE_OPTIONS, POSTER_STYLES } from './studioWorkspaceCatalog.js';
import type { VideoThemeId } from './studioWorkspaceContracts.js';
import type { StudioStepViewInputs } from './studioStepViewInputs.js';

export function renderStudioStep(input: StudioStepViewInputs) {
  const {
    step, fileInputRef, handleUpload,
    socialContentTaskId, contentMode, setStepIdx,
    setModeNotice, setContentMode, setPlatform,
    setRatio, ratio, selectedProductOptions,
    productInfo, productSelectorRef, setProductSelectorOpen,
    productOptions, selectedProductIds, productSelectorOpen,
    productSearch, setProductSearch, productCategoryFilter,
    setProductCategoryFilter, productCategories, setShowSelectedProductsOnly,
    showSelectedProductsOnly, visibleProductOptions, setSelectedProductIds,
    productSelectMode, setProductInfo, toggleProductSelection,
    socialViralTask, referenceProducts, referenceBrandLabel,
    referenceProductTerms, invalidateShotsForReferenceProduct, referenceProductAssignments,
    setReferenceProductTerms, setReferenceProductAssignments, referenceSpeechPlan,
    videoThemeId, setVideoThemeId, setThemePainPoint,
    setThemeConversionGoal, script, cooperationRoute,
    availableCooperationRoutes, enterpriseRouteStrategies, setCooperationRoute,
    setAudience, setEnterprisePrimaryCta, setPrimaryCta,
    audience, studioSettingsEditedRef, activeVideoTheme,
    mode, productContentGoal, setProductContentGoal,
    effectiveContentGoal, effectivePrimaryCta, setReachCta,
    presentationMode, setPresentationMode, setPresenterMode,
    setRendered, setRenderOutputPath, setRenderOutputPreviewUrl,
    setActiveFolder, selectedVisualClips, frozenAssets,
    selectedVideoCount, selectedImageCount, effectiveSelectedDuration,
    unknownDurationCount, ratioCompatibleCount, setShowSetupMaterialPicker,
    materialCoverageReady, recommendedMaterialDuration, duration,
    setHookMaterialId, hookMaterialId, removeSelectedVisualClip,
    showSetupMaterialPicker, search, setSearch,
    materials, selected, setSelected,
    referenceSourceLanguage, voiceLangs, lang,
    setVoiceLangs, setLang, setActiveVoiceLang,
    setShowAdvancedSetup, provider, showAdvancedSetup,
    visibleRatios, setDuration, setProvider,
    migrationRecommendation, setMigrationMode, migrationMode,
    posterStyle, setPosterStyle, setImageDeliverable,
    imageDeliverable, posterLoading, posterGenerationIsVerified,
    posterJsonText, posterDraft, markPosterJsonAsManualDraft,
    videoKickoff, leadContentPackage, posterImageUrl,
    posterImageReviewStatus, confirmPosterImage, posterImageReviewing,
    posterImageMaterialId, caption, platform,
    selectedClips,
  } = input;

  switch (step) {
    /* ① 选模式 */
    case 'mode':
      return (
        <div className="w-full min-w-0 overflow-x-hidden">
          <input ref={fileInputRef} type="file" multiple accept="video/*,image/*" className="hidden" onChange={event => { void handleUpload(event.target.files); event.target.value = ''; }} />
          <div className="mb-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">内容类型</p>
            {socialContentTaskId ? (
              <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs font-bold text-text-primary">
                {contentMode === 'video' ? '视频内容' : '图文内容'} · 已从任务带入
              </div>
            ) : (
              <div className="grid grid-cols-2 rounded-lg bg-surface-2 p-1">
                {([
                  ['video', '视频模式'],
                  ['poster', '图片制作'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      if (value !== contentMode) {
                        setStepIdx(0);
                        setModeNotice('已切换内容模式，产品、主题、目标客户和合作路线均已保留。');
                      }
                      setContentMode(value);
                      if (value === 'poster') {
                        setPlatform('facebook');
                        setRatio(ratio === '9:16' ? '1:1' : ratio);
                      } else if (contentMode === 'poster') {
                        setPlatform('tiktok');
                        setRatio('9:16');
                      }
                    }}
                    className={`rounded-md px-3 py-2 text-[11px] font-bold transition ${contentMode === value ? 'bg-surface text-text-primary shadow-none' : 'text-text-muted hover:text-text-secondary'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">内容信息</p>
          <div className="space-y-4">
            {socialContentTaskId ? (
              <div className="rounded-lg border border-border bg-surface-2 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">任务产品</p>
                <p className="mt-1 text-xs font-bold text-text-primary">{selectedProductOptions.map(option => option.label).join('、') || productInfo || '任务暂未绑定产品'}</p>
                <p className="mt-2 text-[10px] leading-4 text-text-muted">产品绑定沿用已确认任务；系统按产品带入关联素材与文案，可在素材区取消或补充，制作前仍需逐镜核对。</p>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1">
                  <span className="mb-1.5 block text-xs font-semibold text-text-secondary">产品信息（多选）</span>
                  <div ref={productSelectorRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setProductSelectorOpen(value => !value)}
                      className="flex h-9 w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 text-left text-xs font-semibold text-text-primary transition hover:border-accent/50"
                    >
                      <span className="truncate">
                        {productOptions.length === 0
                          ? '暂无可选产品'
                          : selectedProductIds.length === 0
                            ? '请选择产品'
                            : `已选 ${selectedProductIds.length} 个产品`}
                      </span>
                      <ChevronDown size={15} className={`shrink-0 text-text-muted transition ${productSelectorOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {productSelectorOpen && (
                      <div className="mt-2 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-none">
                        <div className="space-y-2 border-b border-border bg-surface p-2.5">
                          <div className="relative">
                            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                            <input
                              value={productSearch}
                              onChange={event => setProductSearch(event.target.value)}
                              placeholder="搜索产品名、SKU 或卖点"
                              className="h-9 w-full rounded-lg border border-border bg-white pl-8 pr-3 text-xs font-semibold text-text-primary outline-none focus:border-accent"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              value={productCategoryFilter}
                              onChange={event => setProductCategoryFilter(event.target.value)}
                              className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-white px-2 text-[11px] font-bold text-text-secondary outline-none focus:border-accent"
                            >
                              <option value="">全部类目</option>
                              {productCategories.map(category => <option key={category} value={category}>{category}</option>)}
                            </select>
                            <button
                              type="button"
                              onClick={() => setShowSelectedProductsOnly(value => !value)}
                              className={`h-8 rounded-lg border px-2.5 text-[11px] font-bold ${showSelectedProductsOnly ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-border bg-white text-text-secondary'}`}
                            >
                              仅看已选
                            </button>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-text-muted">当前 {visibleProductOptions.length} 款 · 已选 {selectedProductIds.length} 款</span>
                            <span className="flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={visibleProductOptions.length === 0}
                                onClick={() => setSelectedProductIds(current => productSelectMode === 'single' && !socialContentTaskId
                                  ? visibleProductOptions.slice(0, 1).map(option => option.id)
                                  : Array.from(new Set([...current, ...visibleProductOptions.map(option => option.id)])))}
                                className="rounded-md px-2 py-1 font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                              >
                                全选当前结果
                              </button>
                              <button
                                type="button"
                                onClick={() => { setSelectedProductIds([]); setProductInfo(''); }}
                                className="rounded-md px-2 py-1 font-bold text-text-muted hover:bg-surface-2 hover:text-red"
                              >
                                清空
                              </button>
                            </span>
                          </div>
                        </div>
                        <div className="max-h-72 overflow-y-auto p-2">
                          {productOptions.length > 0 && visibleProductOptions.length > 0 ? visibleProductOptions.map(option => {
                            const active = selectedProductIds.includes(option.id);
                            return (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => toggleProductSelection(option.id)}
                                className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-surface-2"
                              >
                                <span
                                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border"
                                  style={active ? { borderColor: STUDIO_ACCENT, background: STUDIO_ACCENT, color: '#fff' } : { borderColor: 'var(--color-border)' }}
                                >
                                  {active && <Check size={11} />}
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-bold text-text-primary">{option.label}</span>
                                  {option.info && <span className="mt-0.5 block line-clamp-1 text-[11px] text-text-muted">{option.info}</span>}
                                </span>
                              </button>
                            );
                          }) : productOptions.length === 0 ? (
                            <div className="px-2.5 py-3 text-xs leading-relaxed text-text-muted">
                              企业中心暂无产品信息，请先完成配置。
                            </div>
                          ) : (
                            <div className="px-2.5 py-6 text-center text-xs leading-relaxed text-text-muted">
                              没有匹配的产品，请调整搜索词或筛选条件。
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {!socialContentTaskId && selectedProductOptions.length > 0 && <p className="text-xs text-text-muted">已按所选产品默认带入关联图片、视频和产品文案，可在素材区取消或补充；没有关联素材的产品需另行上传。</p>}
            {socialViralTask && referenceProducts.length > 0 && <section aria-label="原片产品位映射" className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs font-semibold text-text-primary">原片产品位映射 · {referenceProducts.length} 个</p>
              <p className="mt-1 text-[11px] text-text-muted">默认全部使用同一款企业产品；需要区别替换时，再逐项调整。</p>
              <div className="mt-3 rounded-lg border border-border bg-white p-2.5 text-[10px] text-text-secondary"><p className="font-bold">企业品牌 · 自动读取</p><p className="mt-1">{referenceBrandLabel || '企业知识库尚未填写品牌名称'}</p></div>
              {!selectedProductOptions.length && <p role="status" className="mt-2 text-[11px] font-bold text-amber-700">请选择一款企业产品，系统将默认用于所有产品位。</p>}
              <div className="mt-3 space-y-2">{referenceProducts.map((slot, index) => <div key={slot.shotId} className="grid gap-2 rounded-lg border border-border bg-white p-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div><p className="text-[11px] font-bold text-text-primary">{index + 1}. {slot.time} · {slot.sourceLabel}</p><label className="mt-1 block text-[10px] text-text-muted">原口播中的产品词<input aria-label={`原片产品 ${index + 1} 的口播词`} value={referenceProductTerms[slot.shotId] ?? slot.sourceLabel} onChange={event => { invalidateShotsForReferenceProduct(referenceProductTerms[slot.shotId] || slot.sourceLabel, referenceProductAssignments[slot.shotId]); setReferenceProductTerms(current => ({ ...current, [slot.shotId]: event.target.value })); }} className="mt-1 h-8 w-full rounded-md border border-border px-2 text-xs text-text-primary" /></label></div>
                <label className="block text-[10px] text-text-muted">替换为企业产品<select aria-label={`原片产品 ${index + 1} 对应企业产品`} value={referenceProductAssignments[slot.shotId] || ''} onChange={event => { invalidateShotsForReferenceProduct(referenceProductTerms[slot.shotId] || slot.sourceLabel, referenceProductAssignments[slot.shotId]); setReferenceProductAssignments(current => ({ ...current, [slot.shotId]: event.target.value })); }} className="mt-1 h-8 w-full rounded-md border border-border bg-white px-2 text-xs text-text-primary"><option value="">请选择</option>{selectedProductOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
              </div>)}</div>
            </section>}
            {socialViralTask && (
              <section aria-label="爆款口播方案" className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div><p className="text-xs font-semibold text-emerald-950">原片逐句口播</p><p className="mt-1 text-[10px] text-emerald-800">只替换交接物已识别的品牌、产品等关键词；分镜按原片画面切点生成。</p></div>
                  <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-emerald-800">{referenceSpeechPlan.lines.length} 句</span>
                </div>
                {referenceSpeechPlan.error && <p role="status" className="mt-3 rounded-lg bg-white p-3 text-[11px] text-amber-800">{referenceSpeechPlan.error}</p>}
                {referenceSpeechPlan.lines.length > 0 && (
                  <ol className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                    {referenceSpeechPlan.lines.map((line, index) => <li key={line.id} className="rounded-lg border border-emerald-100 bg-white p-2.5 text-[11px] leading-5">
                      <p className="font-semibold text-emerald-900">{String(index + 1).padStart(2, '0')} · {line.time}</p>
                      <p className="mt-1 text-text-muted">原句：{line.source}</p>
                      <p className="text-text-primary">新口播：{line.draft}</p>
                      {line.visuals.length > 0 && <p className="mt-1 text-[10px] text-emerald-800">对应原片分镜：{line.visuals.map(item => `${item.time} ${item.label}`).join('；')}</p>}
                    </li>)}
                  </ol>
                )}
              </section>
            )}
            {contentMode === 'video' && (
              <section className="border-t border-border pt-4">
                <div className="mb-3">
                  <p className="text-xs font-semibold text-text-primary">创作主题</p>
                  <p className="mt-0.5 text-[10px] text-text-muted">项目基础设置只在这里编辑，后续分镜与成片步骤直接复用。</p>
                </div>
                <div className="grid gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-text-secondary">主题</span>
                    <span className="relative block">
                      <select
                        value={videoThemeId}
                        onChange={event => {
                          const nextTheme = VIDEO_THEMES.find(item => item.id === event.target.value as VideoThemeId) || VIDEO_THEMES[0]!;
                          setVideoThemeId(nextTheme.id);
                          setThemePainPoint(nextTheme.painPoint);
                          setThemeConversionGoal(DEFAULT_VIDEO_CONVERSION_GOAL);
                          if (script.trim()) setModeNotice(`视频主题已切换为“${nextTheme.title}”，请重新生成可执行分镜。`);
                        }}
                        className="h-9 w-full appearance-none rounded-lg border border-border bg-surface-2 px-3 pr-9 text-xs font-semibold text-text-primary outline-none transition focus:border-accent"
                      >
                        {VIDEO_THEMES.map(theme => <option key={theme.id} value={theme.id}>{theme.title}</option>)}
                      </select>
                      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
                    </span>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-text-secondary">合作路线</span>
                    <span className="relative block">
                      <select
                        value={cooperationRoute}
                        disabled={availableCooperationRoutes.length <= 1}
                        onChange={event => {
                          const route = event.target.value;
                          const defaults = enterpriseRouteStrategies[route];
                          setCooperationRoute(route);
                          setAudience(enterpriseBuyerText(defaults?.targetBuyerRoles));
                          setEnterprisePrimaryCta(defaults?.primaryCta || '');
                          setPrimaryCta(defaults?.primaryCta || '');
                        }}
                        className="h-9 w-full appearance-none rounded-lg border border-border bg-surface-2 px-3 pr-9 text-xs font-semibold text-text-primary outline-none transition focus:border-accent disabled:cursor-default disabled:opacity-80"
                      >
                        {availableCooperationRoutes.map(route => <option key={route} value={route}>{route === 'oem_odm' ? 'OEM / ODM' : route === 'wholesale_distribution' ? '现货批发 / 经销' : 'C 端零售'}</option>)}
                      </select>
                      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
                    </span>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-text-secondary">目标客户</span>
                    <input
                      value={audience}
                      onChange={event => { studioSettingsEditedRef.current = true; setAudience(event.target.value); }}
                      placeholder={activeVideoTheme.painPoint}
                      className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none transition focus:border-accent"
                    />
                  </label>
                  {mode === 'product' && (
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-text-secondary">内容目标</span>
                      <select value={productContentGoal} onChange={event => setProductContentGoal(event.target.value as 'reach' | 'leads')}
                        className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary">
                        <option value="reach">观看与互动</option>
                        <option value="leads">获取询盘</option>
                      </select>
                    </label>
                  )}
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-text-secondary">{effectiveContentGoal === 'reach' ? '行动引导（可选）' : '主 CTA'}</span>
                    <input
                      value={effectivePrimaryCta || (effectiveContentGoal === 'reach' ? '' : DEFAULT_VIDEO_CONVERSION_GOAL)}
                      onChange={event => {
                        if (effectiveContentGoal === 'reach') setReachCta(event.target.value);
                        else { setEnterprisePrimaryCta(event.target.value); setPrimaryCta(event.target.value); }
                      }}
                      placeholder={effectiveContentGoal === 'reach' ? '留空则自然收尾，也可填写希望观众讨论的问题' : DEFAULT_VIDEO_CONVERSION_GOAL}
                      className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none transition focus:border-accent"
                    />
                  </label>
                  <fieldset className="md:col-span-2">
                    <legend className="mb-1.5 block text-xs font-semibold text-text-secondary">成片方式</legend>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { id: 'material', label: '纯素材剪辑', description: '画面使用已授权素材，不生成数字人' },
                        { id: 'avatar', label: '纯数字人口播', description: '全片数字人出镜，配完整口播和字幕' },
                        { id: 'heygen', label: '数字人 + 素材混剪', description: '在分镜表逐镜选择数字人或具体素材' },
                      ] as const).map(option => {
                        const selectedMode = presentationMode === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            role="radio"
                            aria-checked={selectedMode}
                            onClick={() => {
                              setPresentationMode(option.id); setPresenterMode(option.id === 'material' ? 'real' : 'digital'); setRendered(false); setRenderOutputPath(null); setRenderOutputPreviewUrl(null);
                              if (option.id !== 'material') setActiveFolder('presenter');
                              if (script.trim()) setModeNotice(`出镜方式已切换为“${option.label}”，请重新确认分镜与人物素材。`);
                            }}
                            className={`flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-accent/30 ${selectedMode ? 'border-accent bg-accent-glow shadow-[0_0_0_1px_var(--color-accent)]' : 'border-border bg-surface-2 hover:border-accent/50'}`}
                          >
                            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selectedMode ? 'border-accent' : 'border-border-bright'}`}>
                              {selectedMode && <span className="h-2 w-2 rounded-full bg-accent" />}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-xs font-semibold text-text-primary">{option.label}</span>
                              <span className="mt-0.5 block truncate text-[10px] text-text-muted">{option.description}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                </div>
              </section>
            )}
            <section className="border-t border-border pt-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-text-primary">本次创作素材</p>
                  <p className="mt-0.5 text-[10px] text-text-muted">优先选择已有素材可让脚本更贴合真实画面；不要求上传新素材，参考爆款和产品模式也可稍后补充。</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${selectedVisualClips.length ? 'bg-emerald-50 text-emerald-700' : 'bg-surface-2 text-text-muted'}`}>
                  {selectedVisualClips.length ? `${selectedVisualClips.length} 项已准备` : (mode === 'material' ? '待选择' : '可稍后补充')}
                </span>
              </div>
              {frozenAssets?.adoptedAssets && <p className="mt-2 text-xs">已采纳原始视频：{Object.values(frozenAssets.adoptedAssets).filter(asset => asset.url && /^[a-f0-9]{64}$/.test(asset.sha256 || '')).length} 个 · 待整片验收；所选素材统计单独保留。</p>}
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {[
                  ['视频', `${selectedVideoCount} 个`],
                  ['图片', `${selectedImageCount} 张`],
                  ['有效时长', `${effectiveSelectedDuration.toFixed(1)}s`],
                  ['时长未知', `${unknownDurationCount} 项`],
                  ['比例适配', `${ratioCompatibleCount}/${selectedVisualClips.length}`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-surface-2 px-2.5 py-2">
                    <p className="text-[9px] font-bold text-text-muted">{label}</p>
                    <p className="mt-0.5 text-xs font-semibold text-text-primary">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowSetupMaterialPicker(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-white px-2.5 text-[10px] font-bold text-text-secondary transition hover:border-accent/40 hover:bg-surface-2"
                >
                  <FolderOpen size={13} /> 从素材库选择
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-white px-2.5 text-[10px] font-bold text-text-secondary transition hover:border-accent/40 hover:bg-surface-2"
                >
                  <Upload size={13} /> 上传素材
                </button>
                <span className={`text-[10px] font-semibold ${materialCoverageReady ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {!selectedVisualClips.length ? (mode === 'material' ? '从素材库选择至少 1 项即可，不强制上传' : '可先生成脚本，成片前再补素材') : materialCoverageReady ? '有效镜头时长可覆盖当前目标' : `建议时长改为 ${recommendedMaterialDuration}s，或再补 ${Math.max(0, duration - effectiveSelectedDuration).toFixed(1)}s 素材`}
                </span>
              </div>
              {mode === 'material' && selectedVisualClips.length > 0 && (
                <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3">
                  <p className="text-[10px] font-semibold text-text-secondary">这批素材怎么用</p>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <button type="button" onClick={() => setHookMaterialId('')} className={`rounded-lg border px-2 py-2 text-[10px] font-bold ${!hookMaterialId ? 'border-emerald-400 bg-white text-emerald-700' : 'border-border bg-white text-text-muted'}`}>
                      整段规划
                      <span className="mt-0.5 block font-normal">围绕全部已选素材写脚本</span>
                    </button>
                    <button type="button" onClick={() => setHookMaterialId(current => selectedVisualClips.some(item => item.id === current) ? current : selectedVisualClips[0]!.id)} className={`rounded-lg border px-2 py-2 text-[10px] font-bold ${hookMaterialId ? 'border-emerald-400 bg-white text-emerald-700' : 'border-border bg-white text-text-muted'}`}>
                      指定开场钩子
                      <span className="mt-0.5 block font-normal">指定 1 个开场素材，其余用于后续分镜匹配</span>
                    </button>
                  </div>
                  {hookMaterialId && <p className="mt-2 text-[10px] font-semibold text-emerald-700">已指定 1 个开场钩子；点击下方素材可切换，其他已选素材仍作为后续候选。</p>}
                </div>
              )}
              {selectedVisualClips.length > 0 && (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {selectedVisualClips.map(clip => {
                    const isHook = hookMaterialId === clip.id;
                    return <div key={clip.id} className={`group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-surface-2 ${isHook ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-border'}`}>
                      <button
                        type="button"
                        title={hookMaterialId ? (isHook ? '当前开场钩子' : '设为开场钩子') : `移除${clip.name}`}
                        aria-label={hookMaterialId ? (isHook ? `${clip.name}，当前开场钩子` : `将${clip.name}设为开场钩子`) : `移除${clip.name}`}
                        onClick={() => hookMaterialId ? setHookMaterialId(clip.id) : removeSelectedVisualClip(clip.id)}
                        className="relative h-full w-full overflow-hidden"
                      >
                        {clip.poster || clip.type === 'image' ? <img src={clip.poster || clip.url} alt={clip.name} className="h-full w-full object-cover" /> : <Film size={16} className="absolute inset-0 m-auto text-text-muted" />}
                        {isHook
                          ? <span className="absolute bottom-0 left-0 right-0 bg-emerald-600/95 py-0.5 text-center text-[8px] font-semibold text-white">开场钩子</span>
                          : hookMaterialId && <span className="absolute inset-0 hidden items-center justify-center bg-black/55 text-[9px] font-bold text-white group-hover:flex">设为钩子</span>}
                      </button>
                      <button type="button" title={`移除${clip.name}`} aria-label={`移除${clip.name}`} onClick={() => removeSelectedVisualClip(clip.id)} className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/65 text-white"><X size={10} /></button>
                    </div>;
                  })}
                </div>
              )}
            </section>
            {showSetupMaterialPicker && (
              <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/45 p-4" onClick={() => setShowSetupMaterialPicker(false)}>
                <div role="dialog" aria-modal="true" aria-label="选择本次创作素材" className="flex max-h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
                  <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                    <div><p className="text-sm font-semibold text-text-primary">选择本次创作素材</p><p className="mt-1 text-[11px] text-text-muted">选择即时生效；只有你明确勾选的素材会用于脚本和后续分镜。</p></div>
                    <button type="button" onClick={() => setShowSetupMaterialPicker(false)} className="rounded-lg p-2 text-text-muted hover:bg-surface-2"><X size={18} /></button>
                  </header>
                  <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                    <div className="relative min-w-0 flex-1"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索素材名称" className="h-9 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-3 text-xs outline-none focus:border-accent" /></div>
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-bold text-text-secondary hover:bg-surface-2"><Upload size={14} />上传素材</button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-5">
                    {materials.filter(item => item.type !== 'audio' && (!search.trim() || item.name.toLowerCase().includes(search.trim().toLowerCase()))).length ? (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {materials.filter(item => item.type !== 'audio' && (!search.trim() || item.name.toLowerCase().includes(search.trim().toLowerCase()))).map(clip => {
                          const checked = selected.includes(clip.id);
                          const isHook = hookMaterialId === clip.id;
                          return <div key={clip.id} className={`relative overflow-hidden rounded-lg border text-left transition ${isHook ? 'border-emerald-500 ring-2 ring-emerald-500/20' : checked ? 'border-accent ring-2 ring-accent/15' : 'border-border hover:border-accent/40'}`}>
                            <button type="button" onClick={() => checked ? removeSelectedVisualClip(clip.id) : setSelected(current => [...current, clip.id])} className="block w-full text-left">
                              <span className="relative block aspect-video bg-slate-900">{clip.poster || clip.type === 'image' ? <img src={clip.poster || clip.url} alt="" className="h-full w-full object-cover" /> : <Film size={20} className="absolute inset-0 m-auto text-white/55" />}{checked && <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white"><Check size={14} /></span>}</span>
                              <span className="block truncate px-3 py-2 text-[11px] font-bold text-text-primary">{clip.name}</span>
                            </button>
                            {checked && hookMaterialId && <button type="button" onClick={() => setHookMaterialId(clip.id)} className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[9px] font-semibold shadow-none ${isHook ? 'bg-blue-600 text-white' : 'bg-white/90 text-emerald-700 hover:bg-white'}`}>{isHook ? '开场钩子' : '设为钩子'}</button>}
                          </div>;
                        })}
                      </div>
                    ) : <div className="py-16 text-center text-xs text-text-muted">暂无可用素材，请先上传视频或图片。</div>}
                  </div>
                  <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-4"><p className="text-xs font-bold text-text-secondary">已选择 {selectedVisualClips.length} 项 · 已即时保存</p><button type="button" onClick={() => setShowSetupMaterialPicker(false)} disabled={mode === 'material' && !selectedVisualClips.length} className="rounded-lg bg-accent px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-40">{selectedVisualClips.length ? '完成选择' : '暂不选择'}</button></footer>
                </div>
              </div>
            )}
            <section aria-label="输出语言与配乐说明" className="space-y-2 border-t border-border px-4 py-3">
              <p className="text-xs font-semibold text-text-primary">输出语言与配乐</p>
              <label className="block text-[11px] font-bold text-text-secondary">原文语言
                <select aria-label="原文语言" value={socialViralTask && referenceSourceLanguage ? referenceSourceLanguage : voiceLangs[0] || lang} disabled={Boolean(script.trim()) || Boolean(socialViralTask && referenceSourceLanguage)} onChange={event => { const code = event.target.value; setVoiceLangs(current => [code, ...current.slice(1).filter(item => item !== code)]); setLang(code); setActiveVoiceLang(code); }} className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-xs disabled:opacity-60">
                  {LANGS.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
                </select>
              </label>
              <p className="text-[11px] leading-5 text-text-secondary">原文语言：{LANGS.find(item => item.code === (socialViralTask && referenceSourceLanguage ? referenceSourceLanguage : voiceLangs[0] || lang))?.label || lang}。{socialViralTask ? '按原片 ASR 口播自动识别。' : '在下一步“脚本与声音”添加翻译语种，分别生成配音、字幕和成片。'}</p>
              <p className="text-[11px] leading-5 text-text-secondary">在“脚本与声音 → 配乐”选择音乐和音量；未选音乐时，导出不会自动添加配乐。</p>
              {selectedVisualClips.filter(clip => clip.type === 'video').length > 0 && selectedVisualClips.filter(clip => clip.type === 'video').length < 3 && <p role="status" className="rounded-lg bg-amber-50 p-2 text-[11px] leading-5 text-amber-800">当前只有 {selectedVisualClips.filter(clip => clip.type === 'video').length} 段视频。不同截取时间不代表不同画面；自动选材不会循环使用同一视频。需要更多分镜时，请补充不同角度、动作或场景的素材。</p>}
            </section>
            <div className="overflow-hidden border-y border-border bg-surface">
              <button
                type="button"
                onClick={() => setShowAdvancedSetup(open => !open)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-2/60"
              >
                <span>
                  <span className="block text-xs font-semibold text-text-primary">高级设置</span>
                  <span className="mt-0.5 block text-[10px] text-text-muted">{ratio} · {duration}s · {provider === 'qwen' ? '千问' : 'Gemini'}</span>
                </span>
                <ChevronDown size={15} className={`text-text-muted transition ${showAdvancedSetup ? 'rotate-180' : ''}`} />
              </button>
              {showAdvancedSetup && (
                <div className="grid grid-cols-1 gap-3 border-t border-border bg-surface-2/40 p-4">
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-bold text-text-secondary">画面比例</span>
                    <select value={ratio} onChange={event => setRatio(event.target.value)} className="h-9 w-full rounded-lg border border-border bg-white px-2 text-xs font-semibold text-text-primary outline-none focus:border-accent">
                      {visibleRatios.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-bold text-text-secondary">目标时长</span>
                    <input type="number" min={5} max={180} value={duration} onChange={event => setDuration(Math.max(5, Number(event.target.value) || 5))} className="h-9 w-full rounded-lg border border-border bg-white px-2 text-xs font-semibold text-text-primary outline-none focus:border-accent" />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-bold text-text-secondary">生成引擎</span>
                    <select value={provider} onChange={event => setProvider(event.target.value as 'gemini' | 'qwen')} className="h-9 w-full rounded-lg border border-border bg-white px-2 text-xs font-semibold text-text-primary outline-none focus:border-accent">
                      <option value="qwen">千问（默认）</option>
                    </select>
                  </label>
                </div>
              )}
            </div>
            {false && contentMode === 'video' && mode === 'clone' && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Sparkles size={14} className="text-accent" />
                      <p className="text-sm font-semibold text-text-primary">AI 推荐迁移方案：{migrationRecommendation.label}</p>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold text-emerald-700">已采用</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-text-secondary">{migrationRecommendation.reason}</p>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <div className="rounded-lg border border-emerald-100 bg-white/80 p-3">
                    <p className="text-[10px] font-semibold text-emerald-700">保留的爆点机制</p>
                    {migrationRecommendation.preserve.map(item => <p key={item} className="mt-1 text-[11px] leading-relaxed text-text-secondary">• {item}</p>)}
                  </div>
                  <div className="rounded-lg border border-amber-100 bg-white/80 p-3">
                    <p className="text-[10px] font-semibold text-amber-700">按企业产品重建</p>
                    {migrationRecommendation.rebuild.map(item => <p key={item} className="mt-1 text-[11px] leading-relaxed text-text-secondary">• {item}</p>)}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {([
                    ['fidelity', '高保真复刻'],
                    ['structure', '结构迁移'],
                    ['mechanism', '机制借鉴'],
                  ] as const).map(([value, label]) => {
                    const recommended = migrationRecommendation.mode === value;
                    const risky = value === 'fidelity' && migrationRecommendation.mode !== 'fidelity';
                    return (
                      <button key={value} type="button" disabled={risky}
                        onClick={() => setMigrationMode(value)}
                        title={risky ? '当前对标视频与企业产品不兼容，禁止直接高保真替换' : undefined}
                        className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition ${migrationMode === value ? 'border-slate-400 bg-slate-100 text-text-primary' : 'border-border bg-white text-text-secondary'} disabled:cursor-not-allowed disabled:opacity-40`}>
                        {label}{recommended ? '（推荐）' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {false && contentMode === 'poster' && (
              <Field label="海报风格">
                <div className="flex flex-wrap gap-2">
                  {POSTER_STYLES.map(style => (
                    <Pill key={style.id} active={posterStyle === style.id} onClick={() => setPosterStyle(style.id)}>
                      {style.label}
                    </Pill>
                  ))}
                </div>
              </Field>
            )}
          </div>
        </div>
      );

    case 'poster':
      return (
        <div className="max-w-4xl">
          <SectionTitle title="生成图文" />
          <div className="grid gap-4">
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-sm font-bold text-text-primary">选择要交付的图片</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {IMAGE_DELIVERABLE_OPTIONS.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setImageDeliverable(option.id)}
                    className={`rounded-lg border p-3 text-left transition ${imageDeliverable === option.id
                      ? 'border-accent bg-accent-glow'
                      : 'border-border bg-white hover:bg-surface-2'}`}
                  >
                    <span className="block text-xs font-bold text-text-primary">{option.title}</span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-text-muted">{option.desc}</span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-text-secondary">
                你只选成品类型；内容 Agent 会根据统一素材分析，自动决定直接复用、素材合成、参考重制或补充生成。
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-text-primary">图文内容</p>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${posterLoading ? 'bg-amber-50 text-amber-700' : posterGenerationIsVerified ? 'bg-emerald-50 text-emerald-700' : posterJsonText ? 'bg-amber-50 text-amber-800' : 'bg-surface-2 text-text-muted'}`}>
                  {posterLoading ? '生成中' : posterGenerationIsVerified ? 'AI 生成 · 已校验' : posterDraft?.provenance === 'manual_draft' ? '手动草稿 · 待复核' : posterJsonText ? '草稿 · 待确认' : '待生成'}
                </span>
              </div>
              <textarea
                value={posterJsonText}
                onChange={event => markPosterJsonAsManualDraft(event.target.value)}
                rows={posterJsonText ? 12 : 6}
                placeholder={videoKickoff?.video?.contentFormat === 'image'
                  ? '生成后这里会出现三组内容 JSON：买家注意、合作能力、供应商信任，以及每组轮播结构、配文、CTA 和私信开场。'
                  : '生成后这里会出现海报文案 JSON：标题、副标题、认证徽章、流程六步、产品分类卡、底部卖点和 CTA。'}
                className="mt-3 w-full rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed text-text-secondary outline-none focus:border-accent"
              />
              {posterJsonText && !posterGenerationIsVerified && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                  当前图文不是“已核实可提交”成品。{posterDraft?.fieldsToConfirm?.length
                    ? `仍需确认：${posterDraft.fieldsToConfirm.join('、')}。`
                    : '需重新生成并通过企业资料事实校验。'}系统不会自动提交或交付此草稿。
                </div>
              )}
              {leadContentPackage && <Suspense fallback={<div role="status" className="p-3 text-xs text-text-muted">正在打开图文预览…</div>}><LeadContentPackagePreview value={leadContentPackage} imageUrl={posterImageUrl} /></Suspense>}
              {posterImageUrl && posterImageReviewStatus === 'needs_review' && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-xs leading-relaxed text-amber-800">请核对产品外观、包装文字和版式；确认结果会写入统一素材记录，确认前图片不会成为可交付成品或后续 Agent 输入。</p>
                  <button
                    type="button"
                    onClick={() => void confirmPosterImage()}
                    disabled={posterImageReviewing || !posterImageMaterialId}
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {posterImageReviewing ? '正在保存…' : '确认图片正确'}
                  </button>
                </div>
              )}
              {posterDraft && !leadContentPackage && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {posterImageUrl && (
                    <div className="md:col-span-2 overflow-hidden rounded-lg border border-border bg-surface-2">
                      <img src={posterImageUrl} alt="AI 图文海报" className="max-h-[520px] w-full object-contain bg-white" />
                    </div>
                  )}
                  {posterDraft.layoutModules?.length ? (
                    <div className="md:col-span-2 rounded-lg border border-border bg-surface-2 p-3">
                      <p className="text-xs font-bold text-text-primary">爆款模块拆解与本地素材替换</p>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        {posterDraft.layoutModules.slice(0, 6).map((item, index) => (
                          <div key={`${item.module}-${index}`} className="rounded-lg bg-white p-2 text-[11px] leading-relaxed text-text-secondary">
                            <p className="font-bold text-text-primary">{item.module}</p>
                            <p className="mt-1">参考：{item.referencePattern}</p>
                            <p className="mt-1">素材：{item.localAssetRole}</p>
                            <p className="mt-1 text-text-muted">{item.replacementInstruction}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="rounded-lg border border-border bg-surface-2 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-text-primary">发布配文</p>
                      <button type="button" onClick={() => navigator.clipboard?.writeText(caption)} className="text-xs font-bold text-accent">复制</button>
                    </div>
                    <p className="whitespace-pre-line text-xs leading-relaxed text-text-secondary">{caption}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-surface-2 p-3">
                    <p className="text-xs font-bold text-text-primary">承接话术</p>
                    <p className="mt-2 text-xs leading-relaxed text-text-secondary">评论 CTA：{posterDraft.commentCta || '待生成'}</p>
                    <p className="mt-2 text-xs leading-relaxed text-text-secondary">私信开场：{posterDraft.dmOpening || '待生成'}</p>
                  </div>
                  <div className="md:col-span-2 rounded-lg border border-border bg-surface-2 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-text-primary">图片模型 Prompt</p>
                      <button type="button" onClick={() => navigator.clipboard?.writeText(posterDraft.imagePrompt || '')} className="text-xs font-bold text-accent">复制</button>
                    </div>
                    <p className="text-xs leading-relaxed text-text-muted">{posterDraft.imagePrompt || '待生成'}</p>
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-xs font-bold text-text-primary">当前配置</p>
                <div className="mt-3 space-y-2 text-xs leading-relaxed text-text-secondary">
                  <p>平台：{platform === 'instagram' ? 'Instagram' : 'Facebook'}</p>
                  <p>比例：{ratio}</p>
                  <p>风格：{POSTER_STYLES.find(item => item.id === posterStyle)?.label}</p>
                  <p>图片成品：{IMAGE_DELIVERABLE_LABELS[imageDeliverable]}</p>
                  <p>制作方法：内容 Agent 自动决策</p>
                  <p>参考素材：{selectedClips.filter(item => item.type !== 'audio').length} 个</p>
                </div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs font-bold text-amber-900">生成前确认</p>
                <p className="mt-2 text-xs leading-relaxed text-amber-800">
                  MOQ、认证、交期、价格、出口国家、工厂资质等商业承诺必须来自企业中心或用户确认，AI 只优化表达，不编造承诺。
                </p>
              </div>
            </div>
          </div>
        </div>
      );

  }
}
