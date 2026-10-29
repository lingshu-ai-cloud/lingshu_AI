import { Alert, Upload as AntUpload, Button, Input, Modal, Select, Tabs } from 'antd';
import { Film, Flame, Images, Lightbulb, Loader2, Play, Search, SlidersHorizontal, Upload, Users, X } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { showActionFeedback, showActionSuccess } from '../lib/actionFeedback';
import { AUTH_TOKEN_CHANGED_EVENT, authHeader, getToken } from '../lib/auth';
import { exactReferenceReviewErrorMessage, hasExactReferenceReview, loadExactReferenceReview, parseExactReferenceReview } from '../lib/exactReferenceReview';
import type { AccountSpecialRecommendation, ContentFormat, Platform, TrendVideo } from '../lib/inspirationTypes';
import { studioApi } from '../lib/studioApi';
import { readWeeklyReferenceReviewNavigation } from '../lib/weeklyReferenceReviewNavigationApi';
import CompetitorAccountsModal from './CompetitorAccountsModal';
import DirectorReviewWorkspace, { type DirectorReviewHandoff } from './inspiration/DirectorReviewWorkspace';
import { DirectorVideoDetailPanel } from './inspiration/DirectorVideoDetailPanel';
import InspirationImageCrawlDialog from './inspiration/InspirationImageCrawlDialog';
import InspirationMaterialDetailDrawer from './inspiration/InspirationMaterialDetailDrawer';
import { MaterialManageDialog, MaterialUploadDialog } from './inspiration/InspirationMaterialDialogs';
import InspirationMaterialGallery from './inspiration/InspirationMaterialGallery';
import { AuthenticatedImage, AuthenticatedVideo } from './inspiration/InspirationMedia';
import { InspirationShootingPanel } from './inspiration/InspirationShootingPanel';
import InspirationVideoResults from './inspiration/InspirationVideoResults';
import InspirationWatchDialog from './inspiration/InspirationWatchDialog';
import { inspirationDiscoveryCategory, newestCrawledFirst } from './inspiration/inspirationDiscoveryCategory';
import { matchesInspirationCrawlRange, pageInspirationResults } from './inspiration/inspirationResultPaging';
import { isDisplayableForFormat } from './inspiration/inspirationAnalysisProjection';
import { inspirationViewFromSearch, type BusinessModelFilter, type CrawlTimeRange, type DiscoveryDecisionFilter, INSPIRATION_PAGE_SIZE, type InspirationDashboardProps, type InspirationInnerView, MATERIAL_PRODUCT_COMMON, PLATFORM_FILTERS, type SortMode } from './inspiration/inspirationDashboardContracts';
import { initialMaterialLibraryEntry, isFavoriteMaterial, resolveLinkedFavoriteMaterialId, type FavoriteFilter } from './inspiration/inspirationMaterialLibrary';
import { resolveInspirationReference } from './inspiration/inspirationReferenceResolver';
import { initialInspirationReferenceTarget, parseInspirationReferenceTarget, videoMatchesReference, type InspirationReferenceTarget } from './inspiration/inspirationReferenceTarget';
import { pendingShootingTaskCount } from './inspiration/inspirationShootingNeeds';
import { ACTIVE_PLATFORMS, heatValue, inspirationScoresForVideo, median, recordsToVideos, reliablePublicViews, specialRecommendationForVideo, supplyItemsToVideos, timeValue, type CrawlerRecord } from './inspiration/inspirationVideoProjection';
import { useInspirationAnalysis } from './inspiration/useInspirationAnalysis';
import { useInspirationCreation } from './inspiration/useInspirationCreation';
import { useInspirationDiscoveryInventory } from './inspiration/useInspirationDiscoveryInventory';
import { useInspirationItemManagement } from './inspiration/useInspirationItemManagement';
import { useInspirationMaterials } from './inspiration/useInspirationMaterials';
import { ProductMaterialDetailDrawer } from './material-library/ProductMaterialGroup';
import LsPageHeader from './ui/LsPageHeader';
export { canProcessVideo, displayDuration, resultEmptyState, trendFromEvidence } from '../lib/inspirationDataQuality';
export { generatedMaterialOriginLabel, materialAssetTabOf, type MaterialAssetTab } from '../lib/materialAssetOwnership';
export { asrCandidatesToReviewDraft, reviseDirectorHookAction, splitDirectorReviewedShot } from './inspiration/DirectorReviewWorkspace';
export { DirectorVideoDetailPanel } from './inspiration/DirectorVideoDetailPanel';
export { AuthenticatedVideo, ThumbnailImage, VideoThumbnail } from './inspiration/InspirationMedia';
export { materialPreviewImageSources } from './inspiration/MaterialLibraryCardMedia';
export { directorReviewAction, inspirationCreationAvailability, inspirationCreationShotPreflight, isDisplayableVideoAnalysis } from './inspiration/inspirationAnalysisProjection';
export { parseExactAnalysisResponse } from './inspiration/inspirationExactAnalysisApi';
export { isEnterpriseCommonMaterial, materialAssetBadge, materialMatchesLibraryFilters, materialMatchesOrientation, materialMatchesProductFilter, materialOwnershipTags, materialSemanticLabel, parseMaterialLibraryEntry, resolveLinkedFavoriteMaterialId, visibleMaterialTags, type MaterialLibraryEntryContext } from './inspiration/inspirationMaterialLibrary';
export { candidateDimensionLabels, discoveryOriginTitle, discoverySupplyLabel, getPlatformMeta, inspirationScoresForVideo, latestDiscoveryOrigin } from './inspiration/inspirationVideoProjection';

export default function InspirationDashboard({ onScriptPanelOpen, onScriptPanelClose, onNavigate, onEnterWorkflow, embedded = false }: InspirationDashboardProps) {
  const [materialEntry] = useState(initialMaterialLibraryEntry);
  const [requestedInnerView, setInnerView] = useState<InspirationInnerView>(() => inspirationViewFromSearch(typeof window === 'undefined' ? '' : window.location.search));
  const innerView = embedded ? 'inspiration' : requestedInnerView;
  const [selectedVideo, setSelectedVideo] = useState<TrendVideo | null>(null);
  const [exactReferenceDetail, setExactReferenceDetail] = useState<unknown>(() => typeof window === 'undefined' ? null : window.history.state?.productionDetail);
  const [exactReview, setExactReview] = useState<{recordId:string;handoff:DirectorReviewHandoff;video:TrendVideo}|null>(null);
  const [exactReviewError, setExactReviewError] = useState('');
  const [exactReviewToken,setExactReviewToken] = useState(()=>getToken());
  const [requestedReference, setRequestedReference] = useState<InspirationReferenceTarget | null>(initialInspirationReferenceTarget);
  const openedReferenceTargetRef = useRef('');
  const autoStartedReferenceRef = useRef('');
  const watchTriggerRef = useRef<HTMLElement | null>(null);
  const [watchVideo, setWatchVideo] = useState<TrendVideo | null>(null);
  const [favoritingMaterialIds, setFavoritingMaterialIds] = useState<string[]>([]);
  const [favoritedVideoIds, setFavoritedVideoIds] = useState<string[]>([]);
  const [materialMessage, setMaterialMessage] = useState('');

  useEffect(() => {
    if (embedded) return;
    const url = new URL(window.location.href);
    url.searchParams.set('view', innerView);
    window.history.replaceState(window.history.state, '', url);
  }, [innerView, embedded]);

  const materials = useInspirationMaterials({ materialEntry, innerView, setMaterialMessage, setInnerView, favoritingMaterialIds, setFavoritingMaterialIds });
  const {
    materialProducts, materialProductId, materialProductRef,
    uploadProductId, setUploadProductId, uploadProductSceneKind, setUploadProductSceneKind,
    previewMaterial, setPreviewMaterial, previewMaterialAttempt, previewMaterialLoading,
    setPreviewMaterialLoading, previewMaterialError, setPreviewMaterialError, previewMaterialAutoRetryRef,
    detailMaterial, setDetailMaterial, updatingMaterialTheme, localMaterials,
    setLocalMaterials, productDetailProduct, productDetailMaterials,
    productDetailSlots, productDetailLoading, productDetailError,
    refreshMaterials, loadProductMaterialDetail, closeProductMaterialDetail,
    updateDetailMaterialTheme, uploadingMaterial, materialUploadDialogOpen, setMaterialUploadDialogOpen,
    scriptGapTasks, setUploadingScriptGapId, uploadInputRef, refreshMaterialPreviewUrl,
    handleMaterialPreviewError, materialTotal, handleUploadMaterials, requestMaterialUpload,
    toggleMaterialFavorite,
  } = materials;

  const discovery = useInspirationDiscoveryInventory({ setMaterialMessage, setSelectedVideo, innerView });
  const {
    platform,
    setPlatform,
    search,
    setSearch,
    sortMode,
    setSortMode,
    contentFormat,
    setContentFormat,
    inspirationFavoriteFilter,
    setInspirationFavoriteFilter,
    crawlTimeRange,
    setCrawlTimeRange,
    discoveryDecision,
    setDiscoveryDecision,
    businessModelFilter,
    setBusinessModelFilter,
    minimumDiscoveryScore,
    setMinimumDiscoveryScore,
    discoverySupplyItems,
    serverDiscoveryFilterActive,
    completeInventory,
    discoveryPage,
    setDiscoveryPage,
    discoverySupplyLoading,
    discoverySupplyError,
    inspirationFiltersOpen,
    setInspirationFiltersOpen,
    crawledVideos,
    setCrawledVideos,
    videoPage,
    videoTotalPages,
    videoResultTotalItems,
    tenantVideoTotalItems,
    setTenantVideoTotalItems,
    competitorAccountCount,
    setCompetitorAccountCount,
    setCompetitorCollectionSyncing,
    videosLoading,
    videosLoaded,
    videosError,
    setLastCrawlVideoIds,
    imageCrawlOpen,
    setImageCrawlOpen,
    imageCrawlPlatform,
    setImageCrawlPlatform,
    imageCrawlKeyword,
    setImageCrawlKeyword,
    imageCrawlLimit,
    setImageCrawlLimit,
    imageCrawlBusy,
    imageCrawlError,
    setImageCrawlError,
    importingReference,
    refreshVideos,
    openImageCrawl,
    runImageCrawl,
    importReferenceVideo,
    handlePlatformFilter,
    handleContentFormatFilter,
    resetInspirationFilters,
    clearInspirationFilters,
    inspirationFilterCount,
    inspirationAdvancedFilterCount
  } = discovery;

  const {
    analyzingVideoIds,
    retryVideoPipeline,
    reanalyzeImagePost,
    requestExactFullAnalysis,
    cancelExactFullAnalysis
  } = useInspirationAnalysis({ setMaterialMessage, refreshVideos, setCrawledVideos, setSelectedVideo, setWatchVideo, videoPage });

  const {
    creationAccountId,
    replicationTasks,
    launchingReferences,
    enterMaterialSmartGeneration,
    startImageCreation,
    enterInspirationWorkflow,
    startInspirationCreation
  } = useInspirationCreation({ onEnterWorkflow, setMaterialMessage, setSelectedVideo, requestExactFullAnalysis });

  useEffect(() => {
    if (!requestedReference?.startViralReplication || !selectedVideo || selectedVideo.id.startsWith('weekly-reference-')) return;
    const referenceId = requestedReference.referenceId.replace(/^crawl-/, '');
    const exactMatch = Boolean(referenceId && (selectedVideo.recordId === referenceId || selectedVideo.id === requestedReference.referenceId))
      || Boolean(requestedReference.sourceUrl && selectedVideo.sourceUrl === requestedReference.sourceUrl);
    if (!exactMatch) return;
    const launchKey = [requestedReference.referenceId, requestedReference.sourceUrl, selectedVideo.id].join('|');
    if (!launchKey || autoStartedReferenceRef.current === launchKey) return;
    autoStartedReferenceRef.current = launchKey;
    setRequestedReference(null);
    setSelectedVideo(null);
    startInspirationCreation(selectedVideo);
  }, [requestedReference, selectedVideo, startInspirationCreation]);

  const {
    manageTarget,
    setManageTarget,
    manageName,
    setManageName,
    manageTags,
    setManageTags,
    manageProductId,
    setManageProductId,
    manageBusy,
    openManageDialog,
    saveManagedItem,
    deleteManagedItem
  } = useInspirationItemManagement({ ...materials, setCrawledVideos, setTenantVideoTotalItems, refreshVideos, setMaterialMessage });

  useEffect(()=>{const changed=()=>{setExactReview(null);setSelectedVideo(null);setExactReviewToken(getToken());};window.addEventListener(AUTH_TOKEN_CHANGED_EVENT,changed);window.addEventListener('storage',changed);return()=>{window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT,changed);window.removeEventListener('storage',changed);};},[]);

  useEffect(()=>{let active=true;setExactReview(null);setExactReviewError('');const target=parseExactReferenceReview(exactReferenceDetail);if(!target)return;
    void loadExactReferenceReview(target,{token:getToken,verify:t=>readWeeklyReferenceReviewNavigation({tenantId:t.tenantId,programId:t.programId,packageId:t.packageId,packageVersion:t.packageVersion,executionTaskId:t.executionTaskId},t.recordId,t.contentTaskId),fetch:window.fetch.bind(window)}).then(({record,handoff})=>{const video=recordsToVideos([record as unknown as CrawlerRecord])[0];if(!video||video.recordId!==target.recordId)throw Error('原参考记录无法打开审核');if(active)setExactReview({recordId:target.recordId,handoff:handoff as unknown as DirectorReviewHandoff,video});}).catch(error=>{if(active)setExactReviewError(exactReferenceReviewErrorMessage(error));});return()=>{active=false;};
  },[exactReferenceDetail,exactReviewToken]);

  useEffect(() => {
    const receiveReference = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (detail?.page !== 'socialInspiration' && detail?.page !== 'inspirationMarket') return;
      if (detail.view === 'accounts' || detail.view === 'inspiration' || detail.view === 'library' || detail.view === 'shooting') setInnerView(detail.view);
      setExactReferenceDetail(detail);
      if (hasExactReferenceReview(detail)) { setRequestedReference(null); setSelectedVideo(null); return; }
      const next = parseInspirationReferenceTarget(detail);
      if (!next) return;
      openedReferenceTargetRef.current = '';
      autoStartedReferenceRef.current = '';
      setRequestedReference(next);
    };
    window.addEventListener('lingshu:navigate', receiveReference);
    return () => window.removeEventListener('lingshu:navigate', receiveReference);
  }, []);

  useEffect(() => {
    if (hasExactReferenceReview(exactReferenceDetail) || !requestedReference || !videosLoaded) return;
    const requestKey = [requestedReference.referenceId, requestedReference.sourceUrl, requestedReference.title, requestedReference.startViralReplication].join('|');
    if (!requestKey || openedReferenceTargetRef.current === requestKey) return;
    openedReferenceTargetRef.current = requestKey;
    let cancelled = false;
    const openRequestedReference = async () => {
      setInnerView('inspiration');
      const resolved = await resolveInspirationReference({ target: requestedReference, loadedVideos: crawledVideos, headers: authHeader(), fetcher: window.fetch.bind(window) });
      if (cancelled) return;
      if (resolved.source === 'weekly-plan-snapshot') {
        setMaterialMessage(requestedReference.startViralReplication
          ? '原爆款已从灵感库删除，不能从周计划快照直接发起爆款裂变；请先核对原视频。'
          : '原爆款已从灵感库删除，当前打开的是周计划保存的分析快照。');
        setSelectedVideo(resolved.video);
        return;
      }
      setCrawledVideos(items => [resolved.video, ...items.filter(item => item.id !== resolved.video.id)]);
      setMaterialMessage('');
      setSelectedVideo(resolved.video);
    };
    void openRequestedReference();
    return () => { cancelled = true; };
  }, [requestedReference, videosLoaded, exactReferenceDetail]);

  useEffect(() => {
    if (selectedVideo) { onScriptPanelOpen?.(); }
    else { onScriptPanelClose?.(); }
  }, [selectedVideo?.id]);

  useEffect(() => () => { onScriptPanelClose?.(); }, []);

  useEffect(() => {
    if (!selectedVideo) return;
    const latest = crawledVideos.find(v => v.id === selectedVideo.id);
    if (selectedVideo.id.startsWith('crawl-')) {
      const next = latest || selectedVideo;
      if (!isDisplayableForFormat(next, contentFormat)) {
        setSelectedVideo(null);
        return;
      }
    }
    if (latest && latest !== selectedVideo) setSelectedVideo(latest);
  }, [crawledVideos, selectedVideo]);

  const scoredSupplyVideos = useMemo(() => supplyItemsToVideos(discoverySupplyItems), [discoverySupplyItems]);

  const scoredSupplyByRecordId = useMemo(() => new Map(scoredSupplyVideos.map(video => [video.recordId, video])), [scoredSupplyVideos]);

  const allVideos = useMemo(() => serverDiscoveryFilterActive
    ? scoredSupplyVideos
    : crawledVideos.map(video => {
      const scored = scoredSupplyByRecordId.get(video.recordId);
      return scored ? { ...video, aiAnalysis: { ...video.aiAnalysis, discoveryScore: scored.aiAnalysis?.discoveryScore, discoveryBusinessModel: scored.aiAnalysis?.discoveryBusinessModel } } : video;
    }), [serverDiscoveryFilterActive, scoredSupplyVideos, crawledVideos, scoredSupplyByRecordId]);

  const accountRecommendationByVideoId = useMemo(() => {
    const groups = new Map<string, TrendVideo[]>();
    for (const item of crawledVideos) {
      const accountKey = item.aiAnalysis?.sourceAccount;
      if (!accountKey) continue;
      groups.set(accountKey, [...(groups.get(accountKey) || []), item]);
    }
    const accountMedians = Array.from(groups.values())
      .map(items => median(items.map(item => reliablePublicViews(item.views)).filter(value => value > 0)))
      .filter(value => value > 0);
    const recommendations = new Map<string, AccountSpecialRecommendation>();
    for (const items of groups.values()) {
      for (const item of items) {
        const recommendation = specialRecommendationForVideo(item, items, accountMedians);
        if (recommendation) recommendations.set(item.id, recommendation);
      }
    }
    return recommendations;
  }, [crawledVideos]);

  const visibleVideos = allVideos.filter(v =>
    ACTIVE_PLATFORMS.includes(v.platform)
    && isDisplayableForFormat(v, contentFormat)
  );

  const favoriteSourceUrls = useMemo(() => new Set(localMaterials
    .filter(isFavoriteMaterial)
    .map(material => String(material.sourceUrl || '').trim())
    .filter(Boolean)), [localMaterials]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleVideos
      .filter(v =>
        (platform === 'all' || v.platform === platform) &&
        (businessModelFilter === 'all' || inspirationDiscoveryCategory(v) === businessModelFilter) &&
        (inspirationFavoriteFilter === 'all' || favoritedVideoIds.includes(v.id) || favoriteSourceUrls.has(String(v.sourceUrl || '').trim())) &&
        (!serverDiscoveryFilterActive || matchesInspirationCrawlRange(v, crawlTimeRange)) &&
        (serverDiscoveryFilterActive || !q || v.title.toLowerCase().includes(q) || v.tags.some(t => t.toLowerCase().includes(q)))
      )
      .sort(newestCrawledFirst);
  }, [visibleVideos, platform, inspirationFavoriteFilter, favoritedVideoIds, favoriteSourceUrls, search, sortMode, contentFormat, serverDiscoveryFilterActive, crawlTimeRange, businessModelFilter]);

  const localPagination = serverDiscoveryFilterActive || completeInventory;
  const resultPage = pageInspirationResults(filtered, discoveryPage, INSPIRATION_PAGE_SIZE);

  const shootingNeeds = discovery.shootingNeeds;

  useEffect(() => {
    if (inspirationFavoriteFilter === 'favorite') void refreshMaterials();
  }, [inspirationFavoriteFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleWatch = (video: TrendVideo) => {
    watchTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setWatchVideo(video);
  };

  const openDirectorAnalysis = (video: TrendVideo) => {
    setMaterialMessage('');
    setSelectedVideo(current => current?.id === video.id ? null : video);
  };

  const favoriteMaterial = async (video: TrendVideo, quiet = false) => {
    if (favoritingMaterialIds.includes(video.id)) return;
    let linkedMaterialId = resolveLinkedFavoriteMaterialId(video, localMaterials);
    let linkedMaterial = localMaterials.find(material => material.id === linkedMaterialId);
    setFavoritingMaterialIds(ids => [...ids, video.id]);
    if (!quiet) setMaterialMessage('');
    try {
      if (!linkedMaterialId && video.sourceUrl) {
        const complete = await refreshMaterials();
        linkedMaterialId = resolveLinkedFavoriteMaterialId(video, complete);
        linkedMaterial = complete.find(material => material.id === linkedMaterialId);
      }
      const currentlyFavorite = favoritedVideoIds.includes(video.id) || Boolean(linkedMaterial?.pinned);
      if (currentlyFavorite) {
        if (!linkedMaterial) {
          setMaterialMessage('收藏正在保存，请稍后再取消。');
          return;
        }
        const result = await studioApi.setMaterialPinned(linkedMaterial.id, false);
        if (!result.ok) throw new Error(result.error || '取消收藏失败');
        const linkedId = linkedMaterial.id;
        setLocalMaterials(items => items.map(item => item.id === linkedId ? { ...item, pinned: false } : item));
        setFavoritedVideoIds(ids => ids.filter(id => id !== video.id));
        setMaterialMessage(`已取消收藏：${video.title}`);
        showActionSuccess('已取消收藏', video.title);
        setTimeout(() => setMaterialMessage(''), 3500);
        return;
      }
      if (linkedMaterialId) {
        const result = await studioApi.setMaterialPinned(linkedMaterialId, true);
        if (!result.ok) throw new Error(result.error || '收藏失败');
        setLocalMaterials(items => items.map(item => item.id === linkedMaterialId ? { ...item, pinned: true } : item));
        setFavoritedVideoIds(ids => ids.includes(video.id) ? ids : [...ids, video.id]);
        setMaterialMessage(`已收藏到我的素材：${video.title}`);
        showActionSuccess('收藏成功', '已加入“我的素材”，可以通过收藏筛选快速找到。');
        setTimeout(() => setMaterialMessage(''), 3500);
        return;
      }
      const sourceUrl = String(video.sourceUrl || video.videoUrl || '').trim();
      if (!sourceUrl && !video.recordId) throw new Error('当前视频尚未准备好可收藏的文件');
      const r = await fetch('/api/overseas/videos/download-material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          id: video.recordId,
          sourceUrl,
          title: video.title,
          platform: video.platform,
          async: true,
        }),
      });
      const data = await r.json().catch(() => ({})) as {
        error?: string;
        material?: { name?: string; url?: string; poster?: string; duration?: number };
      };
      if (!r.ok) throw new Error(data.error || '收藏失败');
      if (r.status === 202) {
        setFavoritedVideoIds(ids => ids.includes(video.id) ? ids : [...ids, video.id]);
        setMaterialMessage(`已加入爆款素材收藏队列：${video.title}`);
        showActionFeedback({ title: '正在收藏', description: '视频获取完成后会自动出现在“我的素材”。', tone: 'info' });
        setTimeout(() => setMaterialMessage(''), 3500);
        void refreshVideos();
        window.setTimeout(() => void refreshMaterials(), 5000);
        return;
      }
      const updated: TrendVideo = {
        ...video,
        videoUrl: data.material?.url || video.videoUrl,
        thumbnail: data.material?.poster || video.thumbnail,
        duration: data.material?.duration || video.duration,
      };
      setCrawledVideos(prev => prev.map(v => v.id === video.id ? updated : v));
      setSelectedVideo(v => v?.id === video.id ? updated : v);
      setWatchVideo(v => v?.id === video.id ? updated : v);
      setFavoritedVideoIds(ids => ids.includes(video.id) ? ids : [...ids, video.id]);
      void refreshMaterials();
      setMaterialMessage(`已收藏到爆款素材：${data.material?.name || video.title}`);
      showActionSuccess('收藏成功', '已加入“我的素材”，可以通过收藏筛选快速找到。');
      setTimeout(() => setMaterialMessage(''), 3500);
    } catch (e) {
      const message = e instanceof Error ? e.message : '收藏失败';
      if (!quiet) setMaterialMessage(message);
      showActionFeedback({ title: '收藏失败', description: message, tone: 'error' });
    } finally {
      setFavoritingMaterialIds(ids => ids.filter(id => id !== video.id));
    }
  };

  return (
    <main className={`relative text-text-primary ${embedded ? 'min-h-0' : 'min-h-full bg-ink'}`}>
      {hasExactReferenceReview(exactReferenceDetail) && !exactReview && <p role="alert" className="m-4 rounded border p-3">{exactReviewError} {parseExactReferenceReview(exactReferenceDetail) ? '精确参考审核目标已收到，须核验原周来源回执后才能打开审核。' : '精确参考审核目标无效，请返回原周任务重新打开。'} 不会按标题、链接或快照打开其他参考。</p>}
      {exactReview && <section className="m-4 rounded border p-4"><h2>原参考逐镜审核 · {exactReview.recordId}</h2><DirectorReviewWorkspace key={`${exactReview.recordId}:${exactReviewToken}`} recordId={exactReview.recordId} handoff={exactReview.handoff} onPreview={()=>handleWatch(exactReview.video)} renderVideo={url => <AuthenticatedVideo key={url} apiUrl={url} controls className="max-h-48 w-full rounded bg-black" />} renderImage={(url, alt) => <AuthenticatedImage key={url} src={url} alt={alt} className="max-h-48 w-full rounded object-contain" />} /></section>}
      <div className="transition-all duration-300">
        <div className={embedded ? 'py-5 lg:py-6' : 'px-4 py-5 sm:px-6 lg:py-6'}>
          {!embedded && <LsPageHeader title="灵感集市" description="查看外部参考、管理产品素材，并将内容证据交接到制作流程。" />}
          <div className="mb-4 flex min-w-0 flex-col gap-3 border-b border-border lg:flex-row lg:items-start">
            {embedded ? <h2 className="py-3 text-sm font-semibold text-text-primary">灵小枢，帮我找本周热门素材</h2> : <Tabs className="min-w-0 flex-1" activeKey={innerView} onChange={key => setInnerView(key as InspirationInnerView)} aria-label="灵感集市分类"
              items={[
                { key: 'inspiration', label: `爆款视频 · ${tenantVideoTotalItems ?? '…'}`, icon: <Flame size={16} /> },
                { key: 'library', label: `素材库 · ${!materials.inventoryLoaded ? (materials.materialsLoading ? '加载中' : '待加载') : materialTotal}`, icon: <Film size={16} /> },
                { key: 'accounts', label: `对标账号 · ${competitorAccountCount ?? '…'}`, icon: <Users size={16} /> },
                { key: 'shooting', label: `待拍 · ${shootingNeeds.length + pendingShootingTaskCount(scriptGapTasks)}`, icon: <Lightbulb size={16} /> },
              ]} />}
            {innerView === 'inspiration' && !embedded && <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 pt-1 lg:w-auto">
              <Button type="primary" icon={<Users size={15} />} onClick={() => setInnerView('accounts')}>采集对标账号爆款</Button>
              <Button icon={<Images size={15} />} onClick={openImageCrawl}>关键词补充</Button>
              <AntUpload className="shrink-0 pt-1" accept="video/mp4,.mp4" showUploadList={false} disabled={importingReference} beforeUpload={file => { void importReferenceVideo(file); return false; }}>
                <Button loading={importingReference} icon={<Upload size={15} />}>导入 MP4 并分析</Button>
              </AntUpload>
            </div>}
            <div className="flex shrink-0 items-center gap-2">
              {innerView === 'library' && <Button loading={uploadingMaterial} icon={<Upload size={15} />} onClick={() => { setUploadProductSceneKind(null); setMaterialUploadDialogOpen(true); }}>上传内部素材</Button>}
              {innerView === 'library' && <Button type="primary" icon={<Images size={15} />} onClick={startImageCreation}>生成图片</Button>}
            </div>
          </div>

          <InspirationImageCrawlDialog
            open={imageCrawlOpen}
            busy={imageCrawlBusy}
            platform={imageCrawlPlatform}
            keyword={imageCrawlKeyword}
            limit={imageCrawlLimit}
            error={imageCrawlError}
            onClose={() => setImageCrawlOpen(false)}
            onSubmit={() => void runImageCrawl()}
            onPlatformChange={setImageCrawlPlatform}
            onKeywordChange={value => { setImageCrawlKeyword(value); setImageCrawlError(''); }}
            onLimitChange={setImageCrawlLimit}
          />


            {materialMessage && (
              <div role="status" aria-live="polite" className="mb-3 border-l-2 border-accent bg-accent-glow px-4 py-2.5 text-sm font-semibold text-accent">
                {materialMessage}
              </div>
            )}
            {innerView === 'accounts' && <CompetitorAccountsModal
              embedded
              open
              onClose={() => setInnerView('inspiration')}
              onCountChange={setCompetitorAccountCount}
              onCrawled={(_imported, mode, queued) => {
                clearInspirationFilters();
                const targetFormat = mode === 'mixed' ? 'all' : mode;
                setContentFormat(targetFormat);
                setInnerView('inspiration');
                if (queued) setCompetitorCollectionSyncing(true);
                void discovery.refreshInventory();
                void refreshVideos(1, false, { contentFormat: targetFormat, platform: 'all', crawlTimeRange: 'all', search: '' });
              }}
            />}
            {innerView === 'inspiration' && !embedded && <div className="mb-4 space-y-4 rounded-lg border border-border bg-surface p-4">
              <div className="overflow-x-auto pb-1">
              <div className="grid min-w-[940px] grid-cols-[minmax(240px,2fr)_160px_minmax(130px,1fr)_minmax(170px,1fr)_160px] gap-3">
                <Input allowClear prefix={<Search size={15} />} value={search}
                  onChange={event => { setLastCrawlVideoIds([]); setSearch(event.target.value); }}
                  aria-label="搜索爆款灵感" placeholder="搜索标题或标签" />
                <Select value={platform} onChange={value => handlePlatformFilter(value as Platform)} aria-label="社媒平台" options={PLATFORM_FILTERS.map(item => ({ value: item.id, label: item.label }))} />
                <Select value={contentFormat} onChange={value => handleContentFormatFilter(value as ContentFormat | 'all')} aria-label="内容形式"
                  options={[{ value: 'all', label: '全部' }, { value: 'image', label: '图文' }, { value: 'video', label: '视频' }]} />
                <Select value={inspirationFavoriteFilter} onChange={value => setInspirationFavoriteFilter(value as FavoriteFilter)} aria-label="爆款收藏状态"
                  options={[{ value: 'all', label: '全部收藏状态' }, { value: 'favorite', label: '仅看收藏' }]} />
                <Button loading={discoverySupplyLoading || videosLoading} onClick={() => setInspirationFiltersOpen(value => !value)} icon={<SlidersHorizontal size={15} />} aria-expanded={inspirationFiltersOpen} aria-controls="inspiration-more-filters">
                  更多筛选{inspirationAdvancedFilterCount > 0 ? ` · ${inspirationAdvancedFilterCount}` : ''}
                </Button>
              </div>
              </div>
              {inspirationFiltersOpen && <div id="inspiration-more-filters" className="space-y-3 border-t border-border pt-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="space-y-1 text-xs text-text-secondary"><span>入库时间</span><Select className="w-full" value={crawlTimeRange} onChange={value => { setLastCrawlVideoIds([]); setCrawlTimeRange(value as CrawlTimeRange); }} aria-label="视频抓取入库时间" options={[{ value: 'all', label: '全部时间' }, { value: 'today', label: '今天入库' }, { value: '7d', label: '近 7 天' }, { value: '30d', label: '近 30 天' }]} /></label>
                  <label className="space-y-1 text-xs text-text-secondary"><span>筛选结论</span><Select className="w-full" value={discoveryDecision} onChange={value => setDiscoveryDecision(value as DiscoveryDecisionFilter)} aria-label="服务端筛选结论" options={[{ value: 'all', label: '全部评分结果' }, { value: 'accepted', label: '已入选' }, { value: 'review', label: '待复核' }, { value: 'rejected', label: '已淘汰' }]} /></label>
                  <label className="space-y-1 text-xs text-text-secondary"><span>业务类型</span><Select className="w-full" value={businessModelFilter} onChange={value => setBusinessModelFilter(value as BusinessModelFilter)} aria-label="业务类型" options={[{ value: 'all', label: '全部业务类型' }, { value: 'benchmark', label: '我的对标' }, { value: 'b2b', label: 'B to B素材' }, { value: 'industry', label: '行业泛素材' }]} /></label>
                  <label className="space-y-1 text-xs text-text-secondary"><span>最低综合评分</span><Select className="w-full" value={minimumDiscoveryScore} onChange={setMinimumDiscoveryScore} aria-label="最低综合评分" options={[{ value: 0, label: '不限分数' }, { value: 50, label: '50 分以上' }, { value: 70, label: '70 分以上' }, { value: 85, label: '85 分以上' }]} /></label>
                </div>
                <div className="flex justify-end"><Button type="text" onClick={clearInspirationFilters} disabled={inspirationFilterCount === 0} icon={<X size={13} />}>清除全部筛选</Button></div>
              </div>}
            </div>}


        {innerView === 'inspiration' && videosError && <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-900"><span>{videosError}</span><button type="button" onClick={() => void refreshVideos(videoPage)} className="rounded-md bg-white px-2.5 py-1 font-semibold text-amber-950">重试</button></div>}
        {innerView === 'inspiration' && discoverySupplyError && <Alert className="mb-3" type="warning" showIcon title={discoverySupplyError} />}

        <div>
          {innerView === 'inspiration' && (
            <InspirationVideoResults
              videos={localPagination ? resultPage.items : filtered}
              visibleVideoCount={visibleVideos.length}
              loaded={videosLoaded && (!(serverDiscoveryFilterActive || businessModelFilter !== 'all') || !discoverySupplyLoading)}
              loading={videosLoading || ((serverDiscoveryFilterActive || businessModelFilter !== 'all') && discoverySupplyLoading)}
              search={search}
              platformFiltered={platform !== 'all' || crawlTimeRange !== 'all' || serverDiscoveryFilterActive || businessModelFilter !== 'all' || inspirationFavoriteFilter === 'favorite'}
              contentFormat={contentFormat}
              localMaterialCount={materialTotal}
              launchingReferences={launchingReferences}
              replicationTasks={replicationTasks}
              creationAccountId={creationAccountId}
              favoritingMaterialIds={favoritingMaterialIds}
              favoritedVideoIds={favoritedVideoIds}
              favoriteSourceUrls={favoriteSourceUrls}
              showPagination
              page={localPagination ? resultPage.page : videoPage}
              totalPages={localPagination ? resultPage.totalPages : videoTotalPages}
              totalItems={localPagination ? resultPage.totalItems : videoResultTotalItems}
              pageSize={INSPIRATION_PAGE_SIZE}
              onReset={resetInspirationFilters}
              onOpenLibrary={() => embedded ? onNavigate?.('inspirationMarket') : setInnerView('library')}
              onSelect={openDirectorAnalysis}
              onCreate={startInspirationCreation}
              onWatch={handleWatch}
              onFavorite={video => void favoriteMaterial(video)}
              onManage={(video, action) => openManageDialog({ kind: 'video', item: video, action })}
              onPageChange={page => localPagination ? setDiscoveryPage(page) : void refreshVideos(page)}
            />
          )}

          {innerView === 'library' && <InspirationMaterialGallery materials={materials} favoritingMaterialIds={favoritingMaterialIds} openManageDialog={openManageDialog} enterMaterialSmartGeneration={enterMaterialSmartGeneration} />}

          <ProductMaterialDetailDrawer
            filterActive={materials.hasMaterialFilters}
            product={productDetailProduct}
            materials={materials.filteredProductDetailMaterials}
            slots={materials.filteredProductDetailSlots}
            loading={productDetailLoading}
            error={productDetailError}
            onClose={closeProductMaterialDetail}
            onRetry={product => void loadProductMaterialDetail(product)}
            onPreviewMaterial={setPreviewMaterial}
            onEditMaterial={material => openManageDialog({ kind: 'material', item: material, action: 'edit' })}
            onDeleteMaterial={material => openManageDialog({ kind: 'material', item: material, action: 'delete' })}
            onToggleFavoriteMaterial={material => void toggleMaterialFavorite(material)}
            onOpenMaterialDetail={setDetailMaterial}
            onCreateFromMaterial={enterMaterialSmartGeneration}
            isMaterialFavoriting={material => favoritingMaterialIds.includes(material.id)}
            onUploadSlot={slot => {
              setUploadingScriptGapId('');
              setUploadProductId(slot.productId);
              setUploadProductSceneKind(slot.kind);
              setMaterialUploadDialogOpen(true);
            }}
          />

          {previewMaterial?.type === 'video' && previewMaterial.url && (
            <Modal open title={previewMaterial.name} width={840} footer={null} onCancel={() => setPreviewMaterial(null)}>
                <div className="relative flex min-h-64 items-center justify-center bg-black">
                  <AuthenticatedVideo
                    key={`${previewMaterial.id}:${previewMaterial.url}:${previewMaterialAttempt}`}
                    apiUrl={previewMaterial.url}
                    poster={previewMaterial.poster}
                    controls
                    loadOnMount
                    onReady={() => { setPreviewMaterialLoading(false); setPreviewMaterialError(''); }}
                    onLoadingChange={setPreviewMaterialLoading}
                    onError={handleMaterialPreviewError}
                    className="max-h-[75vh] w-full bg-black object-contain"
                  />
                  {previewMaterialLoading && !previewMaterialError && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40"><span className="inline-flex items-center gap-2 rounded-lg bg-black/65 px-3 py-2 text-xs font-semibold text-white"><Loader2 size={14} className="animate-spin" />正在准备视频…</span></div>}
                  {previewMaterialError && <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 px-6 text-center text-white"><Play size={26} className="opacity-70" /><p className="mt-3 text-sm font-semibold">素材预览暂时失败</p><p className="mt-1 text-xs text-white/65">{previewMaterialError}</p><button type="button" onClick={() => { previewMaterialAutoRetryRef.current = 0; void refreshMaterialPreviewUrl(); }} className="mt-4 rounded-lg bg-white px-3 py-2 text-xs font-bold text-neutral-900">重新获取播放地址</button></div>}
                </div>
            </Modal>
          )}

          {detailMaterial && (
            <InspirationMaterialDetailDrawer
              material={detailMaterial}
              updatingTheme={updatingMaterialTheme}
              onClose={() => setDetailMaterial(null)}
              onUpdateTheme={theme => void updateDetailMaterialTheme(theme)}
              onCreate={material => { setDetailMaterial(null); enterMaterialSmartGeneration(material); }}
            />
          )}

          {innerView === 'shooting' && <InspirationShootingPanel
            error={[materials.shootingTaskError, discovery.shootingVideosError].filter(Boolean).join('；')}
            loading={materials.shootingTasksLoading || discovery.shootingVideosLoading}
            onRetry={() => { void materials.refreshScriptGapTasks(); void discovery.refreshShootingVideos(); }}
            bindingRetry={Boolean(materials.shootingUploadRetry)} onRetryBinding={() => void materials.retryShootingUpload()}
            needs={shootingNeeds} scriptGapTasks={scriptGapTasks} materialCount={materialTotal} uploadingMaterial={uploadingMaterial} onUploadExisting={requestMaterialUpload} onCaptureStart={materials.prepareShootingCapture} onUploadCaptured={files => { void handleUploadMaterials(files); }} />}
        </div>
      </div>
      </div>

      <AnimatePresence>
        {selectedVideo && (
          <DirectorVideoDetailPanel
            key={selectedVideo.id}
            video={selectedVideo}
            onClose={() => setSelectedVideo(null)}
            onPreview={() => handleWatch(selectedVideo)}
            onCreate={() => {
              enterInspirationWorkflow(selectedVideo);
              setSelectedVideo(null);
            }}
            onRetry={() => void retryVideoPipeline(selectedVideo)}
            onReanalyzeImage={() => void reanalyzeImagePost(selectedVideo)}
            onExactAnalysis={() => void requestExactFullAnalysis(selectedVideo)}
            onReanalyze={() => void requestExactFullAnalysis(selectedVideo, true)}
            onCancelAnalysis={() => void cancelExactFullAnalysis(selectedVideo)}
            analyzing={analyzingVideoIds.includes(selectedVideo.id)}
            notice={materialMessage}
            onFavorite={() => void favoriteMaterial(selectedVideo)}
            favoriting={favoritingMaterialIds.includes(selectedVideo.id)}
            isFavorite={favoritedVideoIds.includes(selectedVideo.id) || favoriteSourceUrls.has(String(selectedVideo.sourceUrl || '').trim())}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {watchVideo && <InspirationWatchDialog key={watchVideo.id} video={watchVideo} videos={filtered}
          onClose={() => { setWatchVideo(null); window.requestAnimationFrame(() => watchTriggerRef.current?.focus()); }}
          onOpenDetails={item => { setWatchVideo(null); setSelectedVideo(item); }} />}
      </AnimatePresence>
      <MaterialUploadDialog
        open={materialUploadDialogOpen}
        productId={uploadProductId}
        videoOnly={Boolean(materials.uploadingScriptGapId)}
        productSceneKind={uploadProductSceneKind}
        linkedProductId={materialProductId}
        linkedProductRef={materialProductRef}
        products={materialProducts}
        onProductChange={setUploadProductId}
        onCancel={() => { setMaterialUploadDialogOpen(false); setUploadProductSceneKind(null); setUploadingScriptGapId(''); }}
        onChooseFile={() => { setMaterialUploadDialogOpen(false); uploadInputRef.current?.click(); }}
      />
      <MaterialManageDialog
        target={manageTarget}
        name={manageName}
        tags={manageTags}
        productId={manageProductId}
        products={materialProducts}
        busy={manageBusy}
        commonProductValue={MATERIAL_PRODUCT_COMMON}
        onNameChange={setManageName}
        onTagsChange={setManageTags}
        onProductChange={setManageProductId}
        onCancel={() => setManageTarget(null)}
        onConfirm={() => void (manageTarget?.action === 'delete' ? deleteManagedItem() : saveManagedItem())}
      />

    </main>
  );
}
