import { DirectorVideoDetailPanel } from './inspiration/DirectorVideoDetailPanel';
export { DirectorVideoDetailPanel } from './inspiration/DirectorVideoDetailPanel';
import { MaterialUsageMark, MaterialUsagePanel } from './inspiration/MaterialUsageHistory';
import { MaterialLibraryCardMedia } from './inspiration/MaterialLibraryCardMedia';
import { WatchModal, sourceEmbedUrl } from './inspiration/InspirationWatchModal';
import { buildShootingNeeds } from './inspiration/inspirationShootingNeeds';
import { InspirationShootingPanel } from './inspiration/InspirationShootingPanel';
import InspirationImageCrawlDialog from './inspiration/InspirationImageCrawlDialog';
import { MATERIAL_LIBRARY_FETCH_PAGE_SIZE, fetchCompleteProductMaterialInventory, fetchProductMaterialSummaries, type ProductMaterialSummary } from './inspiration/inspirationProductMaterialInventory';
import { initialInspirationReferenceTarget, normalizedReferenceText, parseInspirationReferenceTarget, videoMatchesReference, type InspirationReferenceTarget } from './inspiration/inspirationReferenceTarget';
export { materialPreviewImageSources } from './inspiration/MaterialLibraryCardMedia';
import DirectorReviewWorkspace, { type DirectorReviewHandoff } from './inspiration/DirectorReviewWorkspace';
import { AuthenticatedImage, AuthenticatedVideo } from './inspiration/InspirationMedia';
export { AuthenticatedVideo, ThumbnailImage, VideoThumbnail } from './inspiration/InspirationMedia';
import { analysisProgressIsActive } from './inspiration/VideoAnalysisProgressPanel';
import { Alert, Button, Drawer, Input, Modal, Pagination, Segmented, Select, Tabs, Upload as AntUpload } from 'antd';
import LsPageHeader from './ui/LsPageHeader';
import { LsLoadingState, LsMasonryGallery } from './ui/LsExperiencePrimitives';
import { hasExactReferenceReview, parseExactReferenceReview, loadExactReferenceReview, exactReferenceReviewErrorMessage } from '../lib/exactReferenceReview';
import BenchmarkAnalysisSections from './inspiration/BenchmarkAnalysisSections';
import type { BenchmarkAnalysis } from '../../shared/benchmarkAnalysis';
import MaterialLibraryStatus from './studio/MaterialLibraryStatus';
import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, Play, Sparkles, FileText, Layout as LayoutIcon,
  Clock, Globe, ChevronDown, X, Loader2,
  Copy, ArrowRight, LayoutGrid, List,
  Lightbulb, Flame, Film,
  Bookmark, Maximize2, Minimize2, Lock, Upload, Users, Images, Pencil, Trash2, Music2,
  SlidersHorizontal, Package, Eye,
} from 'lucide-react';
import { studioApi, type Material } from '../lib/studioApi';
import {
  initialMaterialLibraryEntry, initialMaterialTaxonomyFilters,
  materialDirectorUi, materialMatchesProductFilter, materialMatchesLibraryFilters, isFavoriteMaterial,
  materialOwnershipTags, materialSemanticLabel, materialAssetBadge,
  resolveLinkedFavoriteMaterialId, visibleMaterialTags,
  MATERIAL_APPLICABILITY_LABELS, MATERIAL_FUNCTION_LABELS, MATERIAL_INDUSTRY_LABELS,
  type FavoriteFilter, type MaterialGalleryFilterSnapshot, type MaterialIndustryFilter,
  type MaterialApplicabilityFilter, type MaterialOrientationFilter, type MaterialTypeFilter,
  type MaterialLibraryEntryContext,
} from './inspiration/inspirationMaterialLibrary';
export {
  parseMaterialLibraryEntry, isEnterpriseCommonMaterial, materialOwnershipTags,
  visibleMaterialTags, resolveLinkedFavoriteMaterialId, materialSemanticLabel,
  materialMatchesProductFilter, materialAssetBadge, materialMatchesOrientation,
  materialMatchesLibraryFilters, type MaterialLibraryEntryContext,
} from './inspiration/inspirationMaterialLibrary';
import { getAnalysis, inspirationCreationAvailability, isDisplayableForFormat } from './inspiration/inspirationAnalysisProjection';
import { imagePostAnalysisQueuePresentation } from './inspiration/imagePostAnalysisPresentation';
export { directorReviewAction, inspirationCreationShotPreflight, inspirationCreationAvailability, isDisplayableVideoAnalysis } from './inspiration/inspirationAnalysisProjection';
import { ACTIVE_PLATFORMS, getPlatformMeta, heatValue, inspirationScoresForVideo, median, metadataPanelFallback, recordsToVideos, reliablePublicViews, specialRecommendationForVideo, supplyItemsToVideos, timeValue, type CrawlerRecord } from './inspiration/inspirationVideoProjection';
export { getPlatformMeta, inspirationScoresForVideo, candidateDimensionLabels, latestDiscoveryOrigin, discoverySupplyLabel, discoveryOriginTitle } from './inspiration/inspirationVideoProjection';
import type { MaterialLibraryFacets } from '../lib/studioDigitalHuman';
import { authHeader, getToken, AUTH_TOKEN_CHANGED_EVENT } from '../lib/auth';
import { readWeeklyReferenceReviewNavigation } from '../lib/weeklyReferenceReviewNavigationApi';
import CompetitorAccountsModal from './CompetitorAccountsModal';
import type { Page } from '../App';
import { useModalFocus } from '../hooks/useModalFocus';
import { updateScriptGapTask } from '../lib/scriptGapQueue';
import { canProcessVideo, displayDuration, resultEmptyState } from '../lib/inspirationDataQuality';
export { canProcessVideo, displayDuration, resultEmptyState, trendFromEvidence } from '../lib/inspirationDataQuality';
import { useScriptGapTasks } from '../hooks/useScriptGapTasks';
import InspirationEmptyState from './InspirationEmptyState';
import { cachedProductInspirationCandidate, resumeOrCreateInspirationTask, soleInspirationCreationAccount } from '../lib/socialInspirationTask';
import { useSocialProgram } from '../contexts/SocialProgramContext';
import { VideoCard, VideoListItem } from './InspirationVideoCards';
import { showActionFeedback, showActionSuccess } from '../lib/actionFeedback';
import type { AccountSpecialRecommendation, ContentFormat, GeminiVideoAnalysis, Platform, ScriptAnalysis, TrendVideo, VideoAnalysisPayload } from '../lib/inspirationTypes';
import { socialDiscoveryApi } from '../lib/socialDiscoveryApi';
import { crawlInspirationImages, type InspirationImageCrawlPlatform } from '../lib/inspirationImageCrawl';
import type { SocialBusinessModel, SocialDiscoveryScoreDecision, SocialDiscoverySupplyItem } from '../../shared/contracts/socialContentWorkflow';
import { MATERIAL_THEME_LABELS, materialPrimaryThemeOf, materialSourceCategoryOf } from '../../shared/materialTaxonomy';
import MaterialTaxonomyFilters, { type MaterialSourceFilter, type MaterialThemeFilter } from './material-library/MaterialTaxonomyFilters';
import {
  ProductMaterialDetailDrawer,
  ProductMaterialGroupCard,
  materialBelongsToKnownProduct,
  neutralProductSceneLabel,
  type ProductMaterialGroupProduct,
  type ProductScenePreparationSlotView,
} from './material-library/ProductMaterialGroup';
import { PRODUCT_SCENE_KINDS, type ProductSceneKind } from '../../shared/contracts/productScenePreparation';
import {
  STUDIO_MATERIAL_FILE_ACCEPT,
  STUDIO_MATERIAL_VIDEO_ACCEPT,
  studioMaterialFileKind,
} from '../lib/studioMaterialFile';
import { generatedMaterialOriginLabel, type MaterialAssetTab } from '../lib/materialAssetOwnership';
export { generatedMaterialOriginLabel, materialAssetTabOf, type MaterialAssetTab } from '../lib/materialAssetOwnership';
// ── Types ─────────────────────────────────────────────────────────────────────
type SortMode = 'heat' | 'crawlTime';
type ScriptType = 'voiceover' | 'storyboard';
type InspirationInnerView = 'inspiration' | 'accounts' | 'library' | 'shooting';
type CrawlTimeRange = 'all' | 'today' | '7d' | '30d';
type DiscoveryDecisionFilter = 'all' | SocialDiscoveryScoreDecision;
type BusinessModelFilter = 'all' | SocialBusinessModel;

// The inspiration inventory is intentionally fetched in one tenant-scoped page.
// A smaller page made the tab count look like missing content after client-side
// quality checks removed non-video records from that page.
const INSPIRATION_PAGE_SIZE = 100;
const MATERIAL_LIBRARY_PAGE_SIZE = 20;

const MATERIAL_PRODUCT_ALL = '__all_products__';
const MATERIAL_PRODUCT_COMMON = '__enterprise_common__';
const MATERIAL_PRODUCT_LINKED_REF = '__linked_product_ref__';




const PLATFORM_FILTERS: { id: Platform; label: string }[] = [
  { id: 'all',       label: '全部平台' },
  { id: 'youtube',   label: 'YouTube' },
  { id: 'tiktok',    label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook',  label: 'Facebook' },
  { id: 'linkedin',  label: 'LinkedIn' },
];



// Frame matching and replication feasibility are evaluated by the pure inspiration module.


// ── Script Panel ──────────────────────────────────────────────────────────────
// ── Video Card (grid) ─────────────────────────────────────────────────────────

export function parseExactAnalysisResponse(raw: string, status: number): { error?: string; status?: string; reused?: boolean; id?: string } {
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; status?: unknown; reused?: unknown; id?: unknown };
    return {
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
      status: typeof parsed.status === 'string' ? parsed.status : undefined,
      reused: typeof parsed.reused === 'boolean' ? parsed.reused : undefined,
      id: typeof parsed.id === 'string' ? parsed.id : undefined,
    };
  } catch {
    return { error: `全片精确分析接口返回异常（HTTP ${status}）` };
  }
}



export { splitDirectorReviewedShot, reviseDirectorHookAction, asrCandidatesToReviewDraft } from './inspiration/DirectorReviewWorkspace';

// ── Main page ─────────────────────────────────────────────────────────────────
interface GeneratedVideo {
  id: string;
  title: string;
  url?: string;
  poster?: string;
  duration: number;
  createdAt: string;
  source?: string;
  material?: Material;
  error?: string;
}

interface InspirationDashboardProps {
  onScriptPanelOpen?: () => void;
  onScriptPanelClose?: () => void;
  onNavigate?: (p: Page) => void;
  onEnterWorkflow?: (payload: {
    source?: string;
    script?: string;
    video: TrendVideo;
    scriptType?: ScriptType;
    language?: string;
    productInfo?: string;
    materialRole?: 'hook';
    generatedVideo?: GeneratedVideo;
    referenceAnalysis?: {
      title?: string;
      visualStyle?: string;
      coreEmotion?: string;
      benchmarkAnalysis?: BenchmarkAnalysis;
      details?: { time: string; shot: string; camera: string; visual: string; subtitle?: string; audio?: string; note?: string }[];
    };
  }) => void;
}

export default function InspirationDashboard({ onScriptPanelOpen, onScriptPanelClose, onNavigate, onEnterWorkflow }: InspirationDashboardProps) {
  const { activeProgram, accounts } = useSocialProgram();
  const [creationAccountId, setCreationAccountId] = useState('');
  useEffect(() => {
    setCreationAccountId(soleInspirationCreationAccount(accounts, activeProgram?.programId));
  }, [activeProgram?.programId, accounts]);
  const inspirationLaunches = useRef(new Set<string>());
  const [replicationTasks, setReplicationTasks] = useState<Record<string, string>>({});
  const [launchingReferences, setLaunchingReferences] = useState<string[]>([]);
  const [materialEntry] = useState(initialMaterialLibraryEntry);
  const [innerView, setInnerView] = useState<InspirationInnerView>(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'shooting' ? 'shooting' : materialEntry.openLibrary ? 'library' : 'inspiration');
  const [platform, setPlatform] = useState<Platform>('all');
  const [search, setSearch] = useState(() => typeof window === 'undefined'
    ? ''
    : String(new URLSearchParams(window.location.search).get('search') || '').trim());
  // 搜索改为服务端执行：此前只在已加载的那一页做前端过滤，翻页之外的记录搜不到。
  const searchRef = useRef('');
  searchRef.current = search;
  const [selectedVideo, setSelectedVideo] = useState<TrendVideo | null>(null);
  const [exactReferenceDetail, setExactReferenceDetail] = useState<unknown>(() => typeof window === 'undefined' ? null : window.history.state?.productionDetail);
  const [exactReview, setExactReview] = useState<{recordId:string;handoff:DirectorReviewHandoff;video:TrendVideo}|null>(null);
  const [exactReviewError, setExactReviewError] = useState('');
  const [exactReviewToken,setExactReviewToken] = useState(()=>getToken());
  useEffect(()=>{const changed=()=>{setExactReview(null);setSelectedVideo(null);setExactReviewToken(getToken());};window.addEventListener(AUTH_TOKEN_CHANGED_EVENT,changed);window.addEventListener('storage',changed);return()=>{window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT,changed);window.removeEventListener('storage',changed);};},[]);
  useEffect(()=>{let active=true;setExactReview(null);setExactReviewError('');const target=parseExactReferenceReview(exactReferenceDetail);if(!target)return;
    void loadExactReferenceReview(target,{token:getToken,verify:t=>readWeeklyReferenceReviewNavigation({tenantId:t.tenantId,programId:t.programId,packageId:t.packageId,packageVersion:t.packageVersion,executionTaskId:t.executionTaskId},t.recordId,t.contentTaskId),fetch:window.fetch.bind(window)}).then(({record,handoff})=>{const video=recordsToVideos([record as unknown as CrawlerRecord])[0];if(!video||video.recordId!==target.recordId)throw Error('原参考记录无法打开审核');if(active)setExactReview({recordId:target.recordId,handoff:handoff as unknown as DirectorReviewHandoff,video});}).catch(error=>{if(active)setExactReviewError(exactReferenceReviewErrorMessage(error));});return()=>{active=false;};
  },[exactReferenceDetail,exactReviewToken]);
  const [requestedReference, setRequestedReference] = useState<InspirationReferenceTarget | null>(initialInspirationReferenceTarget);
  const openedReferenceTargetRef = useRef('');
  const [watchVideo, setWatchVideo] = useState<TrendVideo | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortMode, setSortMode] = useState<SortMode>('crawlTime');
  const [contentFormat, setContentFormat] = useState<ContentFormat>('video');
  const [inspirationFavoriteFilter, setInspirationFavoriteFilter] = useState<FavoriteFilter>('all');
  const [crawlTimeRange, setCrawlTimeRange] = useState<CrawlTimeRange>('all');
  const [discoveryDecision, setDiscoveryDecision] = useState<DiscoveryDecisionFilter>('all');
  const [businessModelFilter, setBusinessModelFilter] = useState<BusinessModelFilter>('all');
  const [minimumDiscoveryScore, setMinimumDiscoveryScore] = useState(0);
  const [discoverySupplyItems, setDiscoverySupplyItems] = useState<SocialDiscoverySupplyItem[]>([]);
  const [discoverySupplyLoading, setDiscoverySupplyLoading] = useState(false);
  const [discoverySupplyError, setDiscoverySupplyError] = useState('');
  const [inspirationFiltersOpen, setInspirationFiltersOpen] = useState(false);
  const [crawledVideos, setCrawledVideos] = useState<TrendVideo[]>([]);
  const [videoPage, setVideoPage] = useState(1);
  const [videoTotalPages, setVideoTotalPages] = useState(1);
  const [tenantVideoTotalItems, setTenantVideoTotalItems] = useState<number | null>(null);
  const [competitorAccountCount, setCompetitorAccountCount] = useState<number | null>(null);
  const [competitorCollectionSyncing, setCompetitorCollectionSyncing] = useState(false);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosLoaded, setVideosLoaded] = useState(false);
  const [videosError, setVideosError] = useState('');
  const [lastCrawlVideoIds, setLastCrawlVideoIds] = useState<string[]>([]);
  const [imageCrawlOpen, setImageCrawlOpen] = useState(false);
  const [imageCrawlPlatform, setImageCrawlPlatform] = useState<InspirationImageCrawlPlatform>('instagram');
  const [imageCrawlKeyword, setImageCrawlKeyword] = useState('');
  const [imageCrawlLimit, setImageCrawlLimit] = useState(12);
  const [imageCrawlBusy, setImageCrawlBusy] = useState(false);
  const [imageCrawlError, setImageCrawlError] = useState('');
  const [analyzingVideoIds, setAnalyzingVideoIds] = useState<string[]>([]);
  const [favoritingMaterialIds, setFavoritingMaterialIds] = useState<string[]>([]);
  const [favoritedVideoIds, setFavoritedVideoIds] = useState<string[]>([]);
  const [materialMessage, setMaterialMessage] = useState('');
  const [localMaterials, setLocalMaterials] = useState<Material[]>([]);
  const [manageTarget, setManageTarget] = useState<(({ kind: 'video'; item: TrendVideo } | { kind: 'material'; item: Material }) & { action: 'edit' | 'delete' }) | null>(null);
  const [manageName, setManageName] = useState('');
  const [manageTags, setManageTags] = useState('');
  const [manageProductId, setManageProductId] = useState('');
  const [materialProducts, setMaterialProducts] = useState<Array<{id:string;name:string}>>([]);
  const [materialProductFilterEnabled, setMaterialProductFilterEnabled] = useState(() => Boolean(materialEntry.productId || materialEntry.productRef));
  const [materialProductId, setMaterialProductId] = useState(materialEntry.productId);
  const [materialProductRef, setMaterialProductRef] = useState(materialEntry.productRef);
  const [uploadProductId, setUploadProductId] = useState(() => materialEntry.productId || '');
  const [uploadProductSceneKind, setUploadProductSceneKind] = useState<ProductSceneKind | null>(null);
  const [productDetailProduct, setProductDetailProduct] = useState<ProductMaterialGroupProduct | null>(null);
  const [productDetailMaterials, setProductDetailMaterials] = useState<Material[]>([]);
  const [productDetailSlots, setProductDetailSlots] = useState<ProductScenePreparationSlotView[]>([]);
  const [productDetailLoading, setProductDetailLoading] = useState(false);
  const [productDetailError, setProductDetailError] = useState('');
  const productDetailRequestRef = useRef(0);
  const [productMaterialSummaries, setProductMaterialSummaries] = useState<Record<string, ProductMaterialSummary>>({});
  const [productSummaryRefreshVersion, setProductSummaryRefreshVersion] = useState(0);
  const productSummaryRequestRef = useRef(0);
  const [manageBusy, setManageBusy] = useState(false);
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
  const manageDialogRef = useModalFocus<HTMLDivElement>({
    open: Boolean(manageTarget),
    onClose: () => { if (!manageBusy) setManageTarget(null); },
    closeOnEscape: () => !manageBusy,
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
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialPage, setMaterialPage] = useState(1);
  const [materialFacets, setMaterialFacets] = useState<MaterialLibraryFacets | null>(null);
  const [uploadingMaterial, setUploadingMaterial] = useState(false);
  const [materialUploadDialogOpen, setMaterialUploadDialogOpen] = useState(false);
  const [importingReference, setImportingReference] = useState(false);
  const referenceUploadInputRef = useRef<HTMLInputElement | null>(null);
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
  const videoRequestRef = useRef(0);
  const inventoryRequestRef = useRef(0);
  const materialLibraryRequestRef = useRef(0);
  const platformLabel = PLATFORM_FILTERS.find(f => f.id === platform)?.label ?? '全部平台';
  const sortLabel = sortMode === 'crawlTime' ? '按爬取时间' : '按内容机会';
  const contentFormatLabel = contentFormat === 'video' ? '视频' : '图文';
  useEffect(() => {
    const receiveReference = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (detail?.page !== 'socialInspiration') return;
      setExactReferenceDetail(detail);
      if (hasExactReferenceReview(detail)) { setRequestedReference(null); setSelectedVideo(null); return; }
      const next = parseInspirationReferenceTarget(detail);
      if (!next) return;
      openedReferenceTargetRef.current = '';
      setRequestedReference(next);
    };
    window.addEventListener('lingshu:navigate', receiveReference);
    return () => window.removeEventListener('lingshu:navigate', receiveReference);
  }, []);
  useEffect(() => {
    if (hasExactReferenceReview(exactReferenceDetail) || !requestedReference || !videosLoaded) return;
    const requestKey = [requestedReference.referenceId, requestedReference.sourceUrl, requestedReference.title].join('|');
    if (!requestKey || openedReferenceTargetRef.current === requestKey) return;
    openedReferenceTargetRef.current = requestKey;
    let cancelled = false;
    const openRequestedReference = async () => {
      setInnerView('inspiration');
      const normalizedId = requestedReference.referenceId.replace(/^crawl-/, '');
      let match = crawledVideos.find(video => videoMatchesReference(video, requestedReference));
      if (!match && normalizedId) {
        try {
          const response = await fetch(`/api/overseas/videos/${encodeURIComponent(normalizedId)}`, { headers: authHeader() });
          if (response.ok) {
            const record = await response.json() as CrawlerRecord;
            match = recordsToVideos([record])[0];
          }
        } catch {
          // The loaded inventory is still searched by source URL and title below.
        }
      }
      if (!match && requestedReference.title) {
        try {
          const searchTitle = normalizedReferenceText(requestedReference.title).split(' ').slice(0, 10).join(' ');
          const response = await fetch(`/api/overseas/videos?page=1&perPage=100&contentFormat=video&crawlRange=all&search=${encodeURIComponent(searchTitle)}`, { headers: authHeader() });
          if (response.ok) {
            const payload = await response.json() as { items?: CrawlerRecord[] };
            const candidates = recordsToVideos(payload.items || []);
            match = candidates.find(video => videoMatchesReference(video, requestedReference));
          }
        } catch {
          // The reference may have been removed after the weekly plan was created.
        }
      }
      if (cancelled) return;
      if (!match) {
        const platform = ACTIVE_PLATFORMS.includes(requestedReference.platform as Exclude<Platform, 'all'>)
          ? requestedReference.platform as Exclude<Platform, 'all'>
          : 'tiktok';
        const snapshot: TrendVideo = {
          id: `weekly-reference-${requestedReference.referenceId || normalizedReferenceText(requestedReference.title)}`,
          platform,
          title: requestedReference.title || '周计划爆款参考',
          thumbnail: requestedReference.thumbnailUrl,
          duration: requestedReference.duration,
          tags: [],
          views: '—',
          trend: 'stable',
          sourceUrl: requestedReference.sourceUrl || undefined,
          status: 'analyzed',
          contentFormat: 'video',
          aiAnalysis: {
            benchmarkAnalysis: requestedReference.benchmarkAnalysis,
            analysisSource: 'weekly-plan-snapshot',
            analysisQuality: 'snapshot',
            geminiStatus: 'analyzed',
            gemini: { theme: requestedReference.title || '周计划爆款参考' },
          },
        };
        setMaterialMessage('原爆款已从灵感库删除，当前打开的是周计划保存的分析快照。');
        setSelectedVideo(snapshot);
        return;
      }
      setCrawledVideos(items => [match!, ...items.filter(item => item.id !== match!.id)]);
      setMaterialMessage('');
      setSelectedVideo(match);
    };
    void openRequestedReference();
    return () => { cancelled = true; };
  }, [requestedReference, videosLoaded, exactReferenceDetail]); // crawledVideos is intentionally read from the request-triggered render
  useEffect(() => {
    if (selectedVideo) { onScriptPanelOpen?.(); }
    else { onScriptPanelClose?.(); }
  }, [selectedVideo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up on unmount
  useEffect(() => () => { onScriptPanelClose?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const refreshInventory = async (requestedFormat: ContentFormat = contentFormat) => {
    const requestId = ++inventoryRequestRef.current;
    try {
      const response = await fetch(`/api/overseas/videos/inventory-summary?contentFormat=${requestedFormat}`, { headers: authHeader() });
      const data = await response.json().catch(() => ({})) as { totalItems?: number; visibleItems?: number };
      if (!response.ok) throw new Error('库存统计加载失败');
      if (requestId === inventoryRequestRef.current) setTenantVideoTotalItems(Math.max(0, Number(data.visibleItems ?? data.totalItems ?? 0)));
    } catch {
      // Keep the last successful inventory value. The list response carries
      // the same authoritative total and can repair this value later.
    }
  };

  const refreshVideos = async (nextPage = 1, quiet = false, requestedFilters?: {
    contentFormat?: ContentFormat;
    crawlTimeRange?: CrawlTimeRange;
    platform?: Platform;
    search?: string;
  }) => {
    const requestId = ++videoRequestRef.current;
    if (!quiet) {
      setVideosLoading(true);
      setVideosError('');
    }
    try {
      const requestedContentFormat = requestedFilters?.contentFormat ?? contentFormat;
      const requestedCrawlTimeRange = requestedFilters?.crawlTimeRange ?? crawlTimeRange;
      const requestedPlatform = requestedFilters?.platform ?? platform;
      const keyword = (requestedFilters?.search ?? searchRef.current).trim();
      const query = `page=${nextPage}&perPage=${INSPIRATION_PAGE_SIZE}&contentFormat=${requestedContentFormat}`
        + `&crawlRange=${requestedCrawlTimeRange}`
        + (requestedPlatform !== 'all' ? `&platform=${requestedPlatform}` : '')
        + (keyword ? `&search=${encodeURIComponent(keyword)}` : '');
      const r = await fetch(`/api/overseas/videos?${query}`, { headers: authHeader() });
      let data = await r.json().catch(() => ({})) as {
        items?: CrawlerRecord[];
        page?: number;
        totalPages?: number;
        totalItems?: number;
        inventoryTotalItems?: number;
      };
      if (!r.ok) data = {};
      const applyResult = (result: typeof data) => {
        if (requestId !== videoRequestRef.current) return;
        setVideosError('');
        const videos = recordsToVideos(result.items || []);
        if (!keyword && requestedPlatform === 'all' && requestedCrawlTimeRange === 'all') setTenantVideoTotalItems(Math.max(0, Number(result.totalItems ?? 0)));
        setVideoPage(Number(result.page || nextPage));
        setVideoTotalPages(Math.max(1, Number(result.totalPages || nextPage)));
        setCrawledVideos(prev => {
          const next = videos;
          const unchanged = prev.length === next.length && prev.every((item, index) => {
            const candidate = next[index];
            return candidate
              && item.id === candidate.id
              && item.status === candidate.status
              && item.thumbnail === candidate.thumbnail
              && item.crawledAt === candidate.crawledAt
              && JSON.stringify(item.aiAnalysis || {}) === JSON.stringify(candidate.aiAnalysis || {});
          });
          return unchanged ? prev : next;
        });
      };

      // “我的社媒” is tenant-scoped even for an administrator. A successful
      // cross-tenant admin response used to overwrite these records (including
      // with an empty array), producing an impossible "179 total / 0 cards" UI.
      if (data.items) {
        applyResult(data);
        setVideosLoaded(true);
      } else {
        throw new Error('视频列表加载失败');
      }
    } catch {
      if (requestId === videoRequestRef.current && !quiet) {
        setVideosError(crawledVideos.length > 0 ? '刷新失败，已保留上次成功加载的内容。' : '灵感库存暂时无法读取，请重试。');
        setVideosLoaded(true);
      }
    } finally {
      if (requestId === videoRequestRef.current && !quiet) setVideosLoading(false);
    }
  };

  const openImageCrawl = () => {
    setImageCrawlPlatform(platform === 'all' ? 'instagram' : platform);
    setImageCrawlKeyword(search.trim());
    setImageCrawlError('');
    setImageCrawlOpen(true);
  };

  const runImageCrawl = async () => {
    if (imageCrawlBusy) return;
    setImageCrawlBusy(true);
    setImageCrawlError('');
    try {
      const result = await crawlInspirationImages({
        platform: imageCrawlPlatform,
        keyword: imageCrawlKeyword,
        limit: imageCrawlLimit,
      }, { headers: authHeader() });
      if (!result.items.length) {
        setImageCrawlError(result.message || '未找到可入库图片，请换一个关键词或平台');
        return;
      }
      const crawled = recordsToVideos(result.items as CrawlerRecord[]);
      setContentFormat('image');
      setPlatform(imageCrawlPlatform);
      setCrawlTimeRange('all');
      setSearch('');
      searchRef.current = '';
      setSortMode('crawlTime');
      setLastCrawlVideoIds(crawled.map(item => item.id));
      setImageCrawlOpen(false);
      setMaterialMessage(result.message || `图片采集完成，共返回 ${result.items.length} 条`);
      await Promise.all([
        refreshInventory('image'),
        refreshVideos(1, false, {
          contentFormat: 'image',
          crawlTimeRange: 'all',
          platform: imageCrawlPlatform,
          search: '',
        }),
      ]);
    } catch (error) {
      setImageCrawlError(error instanceof Error ? error.message : '图片采集失败');
    } finally {
      setImageCrawlBusy(false);
    }
  };

  const importReferenceVideo = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'video/mp4' && !/\.mp4$/i.test(file.name)) {
      setMaterialMessage('对标视频请使用 MP4 文件');
      return;
    }
    if (file.size > 32 * 1024 * 1024) {
      setMaterialMessage('对标视频不能超过 32 MB');
      return;
    }
    setImportingReference(true);
    setMaterialMessage(`正在导入对标视频：${file.name}`);
    try {
      const params = new URLSearchParams({ title: file.name.replace(/\.mp4$/i, ''), platform: 'tiktok' });
      const response = await fetch(`/api/overseas/videos/import-reference-file?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'video/mp4', ...authHeader() },
        body: file,
      });
      const result = await response.json().catch(() => ({})) as { id?: string; error?: string; deduplicated?: boolean; analysisQueued?: boolean };
      if (!response.ok || !result.id) throw new Error(result.error || `导入失败（HTTP ${response.status}）`);
      const recordId = result.id;
      const readRecord = async (open = false) => {
        const latestResponse = await fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}`, { headers: authHeader() });
        if (!latestResponse.ok) throw new Error('对标视频记录读取失败');
        const record = await latestResponse.json() as CrawlerRecord;
        const video = recordsToVideos([record])[0];
        if (!video) throw new Error('对标视频记录格式异常');
        setCrawledVideos(items => [video, ...items.filter(item => item.id !== video.id)]);
        setSelectedVideo(current => open || current?.id === video.id ? video : current);
        return video;
      };
      await readRecord(true);
      setMaterialMessage(result.deduplicated
        ? result.analysisQueued
          ? '已找到相同对标视频，并已重新提交全片逐镜分析。'
          : '已找到相同对标视频，正在打开分析记录。'
        : '对标视频已入库，正在进行全片逐镜分析。');
      void refreshInventory();
      void (async () => {
        for (let attempt = 0; attempt < 120; attempt += 1) {
          await new Promise(resolve => window.setTimeout(resolve, 3000));
          try {
            const latest = await readRecord();
            const status = latest.aiAnalysis?.geminiStatus;
            if (status === 'analyzed' || status === 'needs_review' || status === 'analysis_retryable' || status === 'video_failed' || latest.status === 'failed') {
              setMaterialMessage(status === 'analyzed' ? '逐镜分析完成，请检查编导交接结果。' : '逐镜分析需要复核，请查看记录中的具体原因。');
              void refreshVideos(1, true);
              return;
            }
          } catch {
            // A brief backend reload must not discard a queued import.
          }
        }
        setMaterialMessage('分析仍在后台运行，请稍后刷新灵感大屏查看结果。');
      })();
    } catch (error) {
      setMaterialMessage(error instanceof Error ? error.message : '对标视频导入失败');
    } finally {
      setImportingReference(false);
      if (referenceUploadInputRef.current) referenceUploadInputRef.current.value = '';
    }
  };

  useEffect(() => {
    setVideosLoaded(false);
    setVideoPage(1);
    void refreshInventory();
    void refreshVideos(1);
  }, [contentFormat, crawlTimeRange, platform]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setTenantVideoTotalItems(null);
  }, [contentFormat]);

  // 输入过程中不逐字请求，停顿 400ms 后再查。
  const searchDebounceRef = useRef(false);
  useEffect(() => {
    if (!searchDebounceRef.current) { searchDebounceRef.current = true; return; }
    const timer = window.setTimeout(() => {
      setVideosLoaded(false);
      setVideoPage(1);
      void refreshVideos(1);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (innerView !== 'inspiration') return;
    let active = true;
    const timer = window.setTimeout(() => {
      setDiscoverySupplyLoading(true);
      setDiscoverySupplyError('');
      void socialDiscoveryApi.listSupply({
        candidateType: 'video',
        platform: platform === 'all' ? undefined : platform,
        businessModel: businessModelFilter === 'all' ? undefined : businessModelFilter,
        decision: discoveryDecision === 'all' ? undefined : discoveryDecision,
        minScore: minimumDiscoveryScore || undefined,
        search: search.trim() || undefined,
        sort: sortMode === 'heat' ? 'score' : 'latest',
        page: 1,
        perPage: 100,
      }).then(result => {
        if (active) setDiscoverySupplyItems(result.items);
      }).catch(error => {
        if (active) setDiscoverySupplyError(error instanceof Error ? error.message : '服务端评分暂时无法读取');
      }).finally(() => {
        if (active) setDiscoverySupplyLoading(false);
      });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [innerView, platform, businessModelFilter, discoveryDecision, minimumDiscoveryScore, search, sortMode]);

  const hasPendingVideos = crawledVideos.some(v =>
    v.aiAnalysis?.analysisProgress
      ? analysisProgressIsActive(v.aiAnalysis.analysisProgress)
      : v.status === 'pending' ||
        v.aiAnalysis?.downloadStatus === 'queued' ||
        v.aiAnalysis?.downloadStatus === 'downloading' ||
        v.aiAnalysis?.downloadStatus === 'analyzing' ||
        v.aiAnalysis?.downloadStatus === 'ops_queued'
  );

  useEffect(() => {
    if (!hasPendingVideos) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      if (document.visibilityState === 'visible') await refreshVideos(videoPage, true);
      if (!cancelled) timer = window.setTimeout(() => void poll(), 8000);
    };
    timer = window.setTimeout(() => void poll(), 8000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasPendingVideos, contentFormat, videoPage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!competitorCollectionSyncing) return;
    let cancelled = false;
    const startedAt = Date.now();
    const poll = async () => {
      if (document.visibilityState === 'visible') {
        await refreshVideos(1, true);
        await refreshInventory();
      }
      if (!cancelled && Date.now() - startedAt < 5 * 60_000) {
        window.setTimeout(() => void poll(), 4000);
      } else if (!cancelled) {
        setCompetitorCollectionSyncing(false);
      }
    };
    void poll();
    return () => { cancelled = true; };
  }, [competitorCollectionSyncing, contentFormat]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const enterMaterialSmartGeneration = (material: Material) => {
    const usableUrl = String(material.url || material.poster || '').trim();
    const invalidVideo = material.type === 'video' && !canProcessVideo({ contentFormat: 'video', duration: material.duration });
    if (material.type === 'audio' || invalidVideo || !usableUrl) {
      showActionFeedback({
        title: '当前素材无法直接创作',
        description: material.type === 'audio'
          ? '请选择视频或图片素材。'
          : invalidVideo
            ? '视频时长尚未识别完成，请等待素材分析后重试。'
            : '素材文件尚未准备好，请稍后重试。',
        tone: 'warning',
      });
      return;
    }
    const platform: TrendVideo['platform'] = /facebook/i.test(material.name) ? 'facebook'
      : /youtube/i.test(material.name) ? 'youtube' : /instagram/i.test(material.name) ? 'instagram' : 'tiktok';
    const title = material.name.replace(/\.[a-z0-9]+$/i, '');
    const isImageMaterial = material.type === 'image';
    const video: TrendVideo = {
      id: `material-${material.id}`,
      platform,
      title,
      thumbnail: material.poster || material.segments?.[0]?.poster || '',
      duration: isImageMaterial ? 1 : Math.max(1, Number(material.duration) || 0),
      tags: Array.from(new Set(['本地素材', ...visibleMaterialTags(material.tags).split(/[,，]/).map(tag => tag.trim()).filter(Boolean)])),
      views: '本地素材',
      trend: 'stable',
      videoUrl: material.type === 'video' ? usableUrl : undefined,
      sourceUrl: material.sourceUrl || usableUrl,
      status: 'analyzed',
      crawledAt: material.createdAt,
      contentFormat: isImageMaterial ? 'image' : 'video',
    };
    onEnterWorkflow?.({
      source: 'material_library',
      materialRole: 'hook',
      video,
      generatedVideo: {
        id: material.id,
        title: material.name,
        url: usableUrl,
        poster: material.poster,
        duration: isImageMaterial ? 1 : Math.max(1, Number(material.duration) || 0),
        createdAt: material.createdAt,
        source: 'material_library',
        material,
      },
    });
    showActionSuccess('已带入自由创作', `正在打开“${material.name}”的制作页面。`);
  };

  const startImageCreation = () => {
    const now = new Date().toISOString();
    onEnterWorkflow?.({
      source: 'material_library',
      video: {
        id: `material-image-create-${Date.now()}`,
        platform: 'facebook',
        title: '新图片内容',
        thumbnail: '',
        duration: 1,
        tags: ['素材库图片制作'],
        views: '素材库',
        trend: 'stable',
        status: 'analyzed',
        crawledAt: now,
        contentFormat: 'image',
      },
    });
    showActionSuccess('已打开图片制作', '先选择产品，系统会根据编导分析推荐可用素材。');
  };
  // 爆款页只展示灵感采集结果；已入库素材统一留在“我的素材”，
  // 避免把本地片段伪装成爆款视频并混用两套交互。
  const serverDiscoveryFilterActive = discoveryDecision !== 'all'
    || businessModelFilter !== 'all'
    || minimumDiscoveryScore > 0
    || sortMode === 'heat';
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
        (inspirationFavoriteFilter === 'all' || favoritedVideoIds.includes(v.id) || favoriteSourceUrls.has(String(v.sourceUrl || '').trim())) &&
        (!q || v.title.toLowerCase().includes(q) || v.tags.some(t => t.toLowerCase().includes(q)))
      )
      .sort((a, b) => {
        if (contentFormat === 'image') {
          const analyzedRank = Number(b.aiAnalysis?.imageEvidence?.status === 'analyzed') - Number(a.aiAnalysis?.imageEvidence?.status === 'analyzed');
          if (analyzedRank) return analyzedRank;
        }
        if (sortMode === 'crawlTime') {
          return timeValue(b.crawledAt) - timeValue(a.crawledAt) || heatValue(b.views) - heatValue(a.views);
        }
        const scoreA = inspirationScoresForVideo(a);
        const scoreB = inspirationScoresForVideo(b);
        return scoreB.contentOpportunityScore - scoreA.contentOpportunityScore
          || scoreB.sourcePriority - scoreA.sourcePriority
          || timeValue(b.crawledAt) - timeValue(a.crawledAt);
      });
  }, [visibleVideos, platform, inspirationFavoriteFilter, favoritedVideoIds, favoriteSourceUrls, search, sortMode, contentFormat]);

  const shootingNeeds = useMemo(() => buildShootingNeeds(visibleVideos, localMaterials), [visibleVideos, localMaterials]);
  const materialFunctionOptions = useMemo(() => {
    const values = new Set<string>();
    const productMaterials = Object.values(productMaterialSummaries).flatMap(summary => summary.materials);
    [...localMaterials, ...productMaterials].forEach(material => String(material.shotFunction || '').split(',').map(item => item.trim()).filter(Boolean).forEach(item => values.add(item)));
    return [...values].sort((a, b) => (MATERIAL_FUNCTION_LABELS[a] || a).localeCompare(MATERIAL_FUNCTION_LABELS[b] || b, 'zh-CN'));
  }, [localMaterials, productMaterialSummaries]);
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
  const filteredMaterials = useMemo(() => {
    return localMaterials.filter(material => {
      const productMatches = materialMatchesProductFilter(material, {
        enabled: materialProductFilterEnabled,
        productId: materialProductId,
        productRef: materialProductRef,
      });
      return materialMatchesLibraryFilters(material, activeMaterialFilters) && productMatches;
    }).sort((a, b) => {
      // User uploads are the primary working set. Seed/demo library records may
      // have a later migration timestamp, which must not push fresh uploads down.
      const sourcePriority = Number(materialSourceCategoryOf(b) === 'local_upload') - Number(materialSourceCategoryOf(a) === 'local_upload');
      return sourcePriority || (Date.parse(String(b.createdAt || '')) || 0) - (Date.parse(String(a.createdAt || '')) || 0);
    });
  }, [localMaterials, activeMaterialFilters, materialProductFilterEnabled, materialProductId, materialProductRef]);

  const ungroupedFilteredMaterials = useMemo(
    () => filteredMaterials.filter(material => !materialBelongsToKnownProduct(material, materialProducts)),
    [filteredMaterials, materialProducts],
  );
  const visibleProductGroups = useMemo(() => {
    const query = materialSearch.trim().toLowerCase();
    return materialProducts.filter(product => {
      if (materialProductFilterEnabled) {
        if (materialProductId && product.id !== materialProductId) return false;
        if (!materialProductId && materialProductRef && product.name !== materialProductRef) return false;
        if (!materialProductId && !materialProductRef) return false;
      }
      const summary = productMaterialSummaries[product.id];
      const productNameMatches = Boolean(query && product.name.toLowerCase().includes(query));
      const requiresMaterialMatch = materialAssetTab === 'ai'
        || materialAssetTab === 'cloud'
        || materialType !== 'all'
        || materialIndustry !== 'all'
        || materialFunction !== 'all'
        || materialApplicability !== 'all'
        || materialOrientation !== 'all'
        || materialSource !== 'all'
        || materialTheme !== 'all'
        || materialFavoriteFilter !== 'all'
        || Boolean(query && !productNameMatches);
      if (!requiresMaterialMatch) return !query || productNameMatches;
      if (!summary) return false;
      const productFilters = productNameMatches
        ? { ...activeMaterialFilters, query: '' }
        : activeMaterialFilters;
      return summary.materials.some(material => materialMatchesLibraryFilters(material, productFilters));
    });
  }, [activeMaterialFilters, materialApplicability, materialAssetTab, materialFavoriteFilter, materialFunction, materialIndustry, materialOrientation, materialProductFilterEnabled, materialProductId, materialProductRef, materialProducts, materialSearch, materialSource, materialTheme, materialType, productMaterialSummaries]);
  const ordinaryFilteredTotal = ungroupedFilteredMaterials.length;
  const pagedUngroupedFilteredMaterials = useMemo(() => {
    const offset = (materialPage - 1) * MATERIAL_LIBRARY_PAGE_SIZE;
    return ungroupedFilteredMaterials.slice(offset, offset + MATERIAL_LIBRARY_PAGE_SIZE);
  }, [materialPage, ungroupedFilteredMaterials]);
  const visibleProductGroupsForPage = materialPage === 1 ? visibleProductGroups : [];
  const visibleMaterialTotal = visibleProductGroups.length + ordinaryFilteredTotal;
  const visibleMaterialGalleryCount = visibleProductGroupsForPage.length + pagedUngroupedFilteredMaterials.length;
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

  const handlePlatformFilter = (nextPlatform: Platform) => {
    setLastCrawlVideoIds([]);
    setPlatform(nextPlatform);
  };

  const handleContentFormatFilter = (nextFormat: ContentFormat) => {
    setLastCrawlVideoIds([]);
    setSelectedVideo(null);
    setContentFormat(nextFormat);
  };

  const resetInspirationFilters = () => {
    setLastCrawlVideoIds([]);
    setSearch('');
    setPlatform('all');
    setInspirationFavoriteFilter('all');
    setCrawlTimeRange('all');
    setDiscoveryDecision('all');
    setBusinessModelFilter('all');
    setMinimumDiscoveryScore(0);
  };

  const handleWatch = (video: TrendVideo) => {
    if (video.videoUrl || sourceEmbedUrl(video)) {
      setWatchVideo(video);
      return;
    }
    if (video.sourceUrl) {
      window.open(video.sourceUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    setWatchVideo(video);
  };

  const openDirectorAnalysis = (video: TrendVideo) => {
    setMaterialMessage('');
    setSelectedVideo(current => current?.id === video.id ? null : video);
  };

  const analyzeVideoOnly = async (video: TrendVideo, quiet = false) => {
    if (!video.sourceUrl || analyzingVideoIds.includes(video.id)) return;
    setAnalyzingVideoIds(ids => [...ids, video.id]);
    if (!quiet) setMaterialMessage('');
    try {
      const r = await fetch('/api/overseas/videos/analyze-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          id: video.recordId,
          sourceUrl: video.sourceUrl,
          title: video.title,
          platform: video.platform,
          async: true,
        }),
      });
      const data = await r.json().catch(() => ({})) as {
        error?: string;
        analysis?: GeminiVideoAnalysis;
      };
      if (!r.ok) throw new Error(data.error || '视频分析失败');
      if (r.status === 202) {
        setMaterialMessage(`已加入视频获取队列，获取成功后自动进入 Gemini 分析：${video.title}`);
        setTimeout(() => setMaterialMessage(''), 3500);
        void refreshVideos();
        return;
      }
      const updated: TrendVideo = {
        ...video,
        status: 'analyzed',
        aiAnalysis: {
          ...(video.aiAnalysis || {}),
          gemini: data.analysis,
          analysisSource: 'gemini-temp-video',
          downloadStatus: 'analyzed',
          analyzedAt: new Date().toISOString(),
        },
      };
      setCrawledVideos(prev => prev.map(v => v.id === video.id ? updated : v));
      setSelectedVideo(v => v?.id === video.id ? updated : v);
      setWatchVideo(v => v?.id === video.id ? updated : v);
      setMaterialMessage(`Gemini 分析完成：${video.title}`);
      setTimeout(() => setMaterialMessage(''), 3500);
    } catch (e) {
      if (!quiet) setMaterialMessage(e instanceof Error ? e.message : '视频分析失败');
    } finally {
      setAnalyzingVideoIds(ids => ids.filter(id => id !== video.id));
    }
  };

  const enterInspirationWorkflow = async (video: TrendVideo) => {
    const availability = inspirationCreationAvailability(video);
    if (!availability.ready) {
      setMaterialMessage(availability.reason);
      showActionFeedback({ title: '当前内容还不能开始创作', description: availability.reason, tone: 'warning' });
      return;
    }
    if (video.contentFormat === 'image') {
      window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: {
        page: 'smartAssets',
        view: 'create',
        directStudio: false,
        contentCreationRequest: {
          requestId: Date.now(),
          themeId: 'product_value',
          mode: 'instant',
          creationPath: 'viral_replication',
          materialInput: video.thumbnail ? 'ready' : 'limited',
          managedMode: 'one_click_managed',
          prefill: {
            title: `${video.title || '图文作品'} · 爆款复刻`,
            topic: video.title || '',
            referenceLinks: [video.sourceUrl || ''].filter(Boolean),
            platforms: video.platform ? [video.platform] : undefined,
          },
          sourceContext: {
            originLabel: '来自灵感中心',
            referenceTitle: video.title || '已选对标图文',
            referenceThumbnail: video.thumbnail,
            referenceMediaUrl: video.thumbnail,
            referenceContentType: 'image', referenceCaption: video.aiAnalysis?.caption || '',
            referenceLayerBlueprints: video.aiAnalysis?.imageEvidence?.layerBlueprints || [],
          },
        },
      } }));
      return;
    }
    if (video.id.startsWith('material-')) {
      const analysis = getAnalysis(video);
      onEnterWorkflow?.({
        source: 'inspiration_analysis',
        video, scriptType: 'storyboard',
        referenceAnalysis: analysis ? { title: video.title, visualStyle: analysis.scriptSummary15s.visualStyle,
          coreEmotion: analysis.scriptSummary15s.coreEmotion, details: analysis.scriptDetails15s } : undefined,
      });
      return;
    }
    if (inspirationLaunches.current.has(video.id)) return;
    const openTask = (taskId: string) => {
      window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: {
        page: 'smartAssets', view: 'create',
        directStudio: true,
        socialContentTaskId: taskId,
        socialContentPage: 'smartAssets',
        contentCreationRequest: {
          requestId: Date.now(),
          themeId: 'product_value',
          mode: 'instant',
          creationPath: 'viral_replication',
          materialInput: video.videoUrl ? 'ready' : 'limited',
          managedMode: 'one_click_managed',
          continueTaskId: taskId,
          prefill: {
            title: `${video.title || '灵感视频'} · 爆款复刻`,
            topic: video.title || '',
            referenceLinks: [video.sourceUrl || video.videoUrl || ''].filter(Boolean),
            platforms: video.platform ? [video.platform] : undefined,
          },
          sourceContext: {
            originLabel: '来自灵感中心',
            referenceTitle: video.title || '已选参考视频',
            referenceThumbnail: video.thumbnail,
            referenceMediaUrl: video.videoUrl || undefined,
            referenceContentType: 'video', referenceCaption: video.aiAnalysis?.caption || '',
            aspectRatio: video.aiAnalysis?.gemini?.globalSettings?.aspectRatio,
            referenceShots: getAnalysis(video)?.scriptDetails15s.map(detail => ({ time: detail.time, dialogue: detail.dialogue, subtitle: detail.subtitle, visual: detail.visual, firstFrameRef: detail.materialEvidence?.firstFrameRef || undefined, firstFrameSeconds: detail.materialEvidence?.firstFrameSeconds })) || [],
          },
        },
      } }));
    };
    const candidateKey = `${video.id}:${creationAccountId}`;
    const existing = replicationTasks[candidateKey];
    if (existing) { openTask(existing); return; }
    inspirationLaunches.current.add(video.id);
    setLaunchingReferences(ids => [...ids, video.id]);
    setMaterialMessage('正在关联参考与经营背景，交给编导 Agent 和内容 Agent 执行…');
    try {
      const program = activeProgram?.status === 'active' ? activeProgram : undefined;
      const creationAccount = accounts.find(account => account.accountId === creationAccountId && account.status === 'active');
      const result = await resumeOrCreateInspirationTask(cachedProductInspirationCandidate(video,
        creationAccount ? {
          targetAccountRef: { objectType: 'social_owned_account', id: creationAccount.accountId, version: String(creationAccount.version) },
          platforms: [creationAccount.platform],
        } : undefined), program);
      setReplicationTasks(tasks => ({ ...tasks, [candidateKey]: result.task.taskId }));
      if (result.warning) {
        setMaterialMessage(`${result.warning} 已保留原任务，点击“继续制作”查看和恢复。`);
      }
      openTask(result.task.taskId);
    } catch (error) {
      setMaterialMessage(error instanceof Error ? error.message : '复刻任务暂时无法创建，请重试。');
    } finally {
      inspirationLaunches.current.delete(video.id);
      setLaunchingReferences(ids => ids.filter(id => id !== video.id));
    }
  };

  const favoriteMaterial = async (video: TrendVideo, quiet = false) => {
    if (favoritingMaterialIds.includes(video.id)) return;
    const linkedMaterialId = resolveLinkedFavoriteMaterialId(video, localMaterials);
    const linkedMaterial = localMaterials.find(material => material.id === linkedMaterialId);
    const currentlyFavorite = favoritedVideoIds.includes(video.id) || Boolean(linkedMaterial?.pinned);
    setFavoritingMaterialIds(ids => [...ids, video.id]);
    if (!quiet) setMaterialMessage('');
    try {
      if (currentlyFavorite) {
        if (!linkedMaterial) {
          setMaterialMessage('收藏正在保存，请稍后再取消。');
          return;
        }
        const result = await studioApi.setMaterialPinned(linkedMaterial.id, false);
        if (!result.ok) throw new Error(result.error || '取消收藏失败');
        setLocalMaterials(items => items.map(item => item.id === linkedMaterial.id ? { ...item, pinned: false } : item));
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

  const retryVideoPipeline = async (video: TrendVideo) => {
    if (video.recordId) {
      setMaterialMessage(`已重新提交 Gemini 分析：${video.title}`);
      try {
        const r = await fetch(`/api/overseas/videos/${video.recordId}/reanalyze`, {
          method: 'PATCH',
          headers: authHeader(),
        });
        const data = await r.json().catch(() => ({})) as { error?: string };
        if (!r.ok) throw new Error(data.error || '重新分析失败');
        void refreshVideos();
      } catch (e) {
        setMaterialMessage(e instanceof Error ? e.message : '重新分析失败');
      }
      setTimeout(() => setMaterialMessage(''), 3500);
      return;
    }
    await analyzeVideoOnly(video);
  };

  const reanalyzeImagePost = async (video: TrendVideo) => {
    const queued = imagePostAnalysisQueuePresentation(video);
    if (queued) { setMaterialMessage(queued.detail); return; }
    const recordId = video.recordId || video.id.replace(/^crawl-/, '');
    if (!recordId || analyzingVideoIds.includes(video.id)) return;
    setAnalyzingVideoIds(ids => [...ids, video.id]);
    setMaterialMessage(`正在重新分析图文证据：${video.title}`);
    try {
      const response = await fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/reanalyze-image`, {
        method: 'POST',
        headers: authHeader(),
      });
      const data = await response.json().catch(() => ({})) as {
        error?: string;
        analysis?: NonNullable<VideoAnalysisPayload['imageEvidence']>;
      };
      if (!response.ok || !data.analysis) throw new Error(data.error || '图文证据分析失败');
      const markAnalyzed = (item: TrendVideo): TrendVideo => item.id !== video.id ? item : {
        ...item,
        status: 'analyzed',
        aiAnalysis: {
          ...(item.aiAnalysis || {}),
          imageEvidence: data.analysis,
          imageAnalysisStatus: 'analyzed',
          imageAnalysisError: undefined,
          analysisError: undefined,
          analyzedAt: new Date().toISOString(),
        },
      };
      setCrawledVideos(items => items.map(markAnalyzed));
      setSelectedVideo(item => item ? markAnalyzed(item) : item);
      setWatchVideo(item => item ? markAnalyzed(item) : item);
      setMaterialMessage('图文证据分析已完成，可以开始创作。');
      await refreshVideos(videoPage, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : '图文证据分析失败';
      setMaterialMessage(message);
      showActionFeedback({ title: '图文分析失败', description: message, tone: 'error' });
      await refreshVideos(videoPage, true);
    } finally {
      setAnalyzingVideoIds(ids => ids.filter(id => id !== video.id));
      window.setTimeout(() => setMaterialMessage(''), 3500);
    }
  };

  const requestExactFullAnalysis = async (video: TrendVideo, force = false) => {
    if (analyzingVideoIds.includes(video.id)) return;
    const materialId = video.id.startsWith('material-') ? video.id.slice('material-'.length) : '';
    if (!video.recordId && !materialId) {
      setMaterialMessage('当前视频缺少可分析的入库记录或素材文件');
      return;
    }
    setAnalyzingVideoIds(ids => [...ids, video.id]);
    setMaterialMessage(`正在提交全片精确分析：${video.title}`);
    try {
      const response = await fetch(video.recordId
        ? `/api/overseas/videos/${video.recordId}/reanalyze`
        : '/api/overseas/videos/material-exact-analysis', {
        method: video.recordId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(video.recordId
          ? { analysisMode: 'exact', ...(force ? { force: true } : {}) }
          : { materialId, title: video.title, platform: video.platform, duration: video.duration }),
      });
      const data = parseExactAnalysisResponse(await response.text(), response.status);
      if (!response.ok) throw new Error(data.error || '全片精确分析提交失败');
      if (data.status === 'analyzed') {
        const markCompleted = (item: TrendVideo): TrendVideo => ({
          ...item,
          status: 'analyzed',
          aiAnalysis: { ...(item.aiAnalysis || {}), analysisMode: 'exact', requestedAnalysisMode: undefined },
        });
        setCrawledVideos(items => items.map(item => item.id === video.id ? markCompleted(item) : item));
        setSelectedVideo(item => item?.id === video.id ? markCompleted(item) : item);
        setMaterialMessage(data.reused ? '现有全片拆解已达到精确密度，已升级为全片精确分析版。' : '全片精确分析已完成。');
        return;
      }
      const markQueued = (item: TrendVideo): TrendVideo => ({
        ...item,
        recordId: data.id || item.recordId,
        status: 'pending',
        aiAnalysis: {
          ...(item.aiAnalysis || {}),
          analysisProgress: undefined,
          requestedAnalysisMode: 'exact',
          geminiStatus: 'queued',
          analysisError: undefined,
          videoLevelFailureStatus: undefined,
        },
      });
      setCrawledVideos(items => items.map(item => item.id === video.id ? markQueued(item) : item));
      setSelectedVideo(item => item?.id === video.id ? markQueued(item) : item);
      const recordId = data.id || video.recordId;
      if (recordId) {
        void (async () => {
          let completed = false;
          for (let attempt = 0; attempt < 90; attempt += 1) {
            await new Promise(resolve => window.setTimeout(resolve, 2000));
            try {
              const latestResponse = await fetch(`/api/overseas/videos/${recordId}`, { headers: authHeader() });
              if (!latestResponse.ok) continue;
              const latest = await latestResponse.json() as CrawlerRecord;
              let latestAnalysis: VideoAnalysisPayload = {};
              try { latestAnalysis = JSON.parse(latest.aiAnalysis || '{}') as VideoAnalysisPayload; } catch {}
              const applyLatest = (item: TrendVideo): TrendVideo => item.id !== video.id ? item : {
                ...item,
                recordId,
                status: latest.status || item.status,
                aiAnalysis: { ...(item.aiAnalysis || {}), ...latestAnalysis },
              };
              setCrawledVideos(items => items.map(applyLatest));
              setSelectedVideo(item => item ? applyLatest(item) : item);
              const progressFinished = Boolean(latestAnalysis.analysisProgress)
                && !analysisProgressIsActive(latestAnalysis.analysisProgress);
              if (!latestAnalysis.requestedAnalysisMode || progressFinished) {
                completed = true;
                setMaterialMessage(latestAnalysis.analysisError || latestAnalysis.analysisProgress?.stage === 'failed'
                  ? `全片精确分析未完成，可重新尝试。`
                  : '全片精确分析已完成。');
                window.setTimeout(() => setMaterialMessage(''), 3500);
                break;
              }
            } catch {
              // A transient backend reload should not lose the visible queued state.
            }
          }
          if (!completed) {
            setMaterialMessage('暂未收到分析终态；请以详情中的后台进度凭证、当前步骤和预计完成时间为准。');
          }
        })();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '全片精确分析提交失败';
      const markFailed = (item: TrendVideo): TrendVideo => ({
        ...item,
        status: item.aiAnalysis?.gemini ? 'analyzed' : 'failed',
        aiAnalysis: { ...(item.aiAnalysis || {}), requestedAnalysisMode: undefined, analysisError: message },
      });
      setCrawledVideos(items => items.map(item => item.id === video.id ? markFailed(item) : item));
      setSelectedVideo(item => item?.id === video.id ? markFailed(item) : item);
      setMaterialMessage(message);
    } finally {
      setAnalyzingVideoIds(ids => ids.filter(id => id !== video.id));
      setTimeout(() => setMaterialMessage(''), 3500);
    }
  };

  const cancelExactFullAnalysis = async (video: TrendVideo) => {
    if (!video.recordId) return;
    setMaterialMessage('正在停止本次精确分析…');
    try {
      const response = await fetch(`/api/overseas/videos/${video.recordId}/analysis-pause`, {
        method: 'POST',
        headers: authHeader(),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || '停止分析失败');
      const markPaused = (item: TrendVideo): TrendVideo => item.id !== video.id ? item : {
        ...item,
        status: item.aiAnalysis?.gemini || item.aiAnalysis?.analysisQuality ? 'analyzed' : 'failed',
        aiAnalysis: { ...(item.aiAnalysis || {}), analysisProgress: undefined, requestedAnalysisMode: undefined, geminiStatus: 'paused' },
      };
      setCrawledVideos(items => items.map(markPaused));
      setSelectedVideo(item => item ? markPaused(item) : item);
      setMaterialMessage('已停止。本次未产生的结果不会进入后续制作，可以重新分析。');
      window.setTimeout(() => setMaterialMessage(''), 3500);
    } catch (error) {
      setMaterialMessage(error instanceof Error ? error.message : '停止分析失败');
    }
  };

  const startInspirationCreation = (video: TrendVideo) => {
    const availability = inspirationCreationAvailability(video);
    if (!availability.ready && video.contentFormat === 'video') {
      setSelectedVideo(video);
      setMaterialMessage('正在先补齐详细分析；分析完成后即可继续爆款复刻。');
      void requestExactFullAnalysis(video, ['paused', 'cancelled'].includes(String(video.aiAnalysis?.analysisProgress?.stage || '')) || video.aiAnalysis?.geminiStatus === 'paused');
      return;
    }
    void enterInspirationWorkflow(video);
  };


  const openManageDialog = (target: ({ kind: 'video'; item: TrendVideo } | { kind: 'material'; item: Material }) & { action?: 'edit' | 'delete' }) => {
    if (!target.item.canManage) return;
    setManageTarget({ ...target, action: target.action || 'edit' });
    setManageProductId(target.kind === 'material'
      ? target.item.productId || ''
      : '');
    if (target.kind === 'material') void studioApi.materialProducts().then(result => setMaterialProducts(result.items));
    setManageName(target.kind === 'video' ? target.item.title : target.item.name);
    setManageTags(target.kind === 'video' ? target.item.tags.join(', ') : visibleMaterialTags(target.item.tags));
  };

  const saveManagedItem = async () => {
    if (!manageTarget || !manageName.trim() || manageBusy) return;
    setManageBusy(true);
    try {
      if (manageTarget.kind === 'video') {
        const recordId = manageTarget.item.recordId;
        if (!recordId) throw new Error('视频记录不存在');
        const response = await fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}`, {
          method: 'PATCH',
          headers: { ...authHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: manageName.trim(), tags: manageTags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '编辑失败');
        setCrawledVideos(items => items.map(item => item.id === manageTarget.item.id
          ? { ...item, title: manageName.trim(), tags: manageTags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) }
          : item));
      } else {
        const result = await studioApi.updateMaterial(manageTarget.item.id, {
          name: manageName.trim(),
          tags: materialOwnershipTags(manageTags.trim(), manageProductId),
          productId: manageProductId,
          enterpriseCommon: !manageProductId,
        });
        if (!result.ok) throw new Error(result.error || '编辑失败');
        await refreshMaterials();
        setProductSummaryRefreshVersion(version => version + 1);
        if (productDetailProduct) await loadProductMaterialDetail(productDetailProduct);
      }
      setMaterialMessage('已保存修改');
      setManageTarget(null);
    } catch (error) {
      setMaterialMessage(error instanceof Error ? error.message : '编辑失败');
    } finally {
      setManageBusy(false);
    }
  };

  const deleteManagedItem = async () => {
    if (!manageTarget || manageBusy) return;
    setManageBusy(true);
    try {
      if (manageTarget.kind === 'video') {
        const recordId = manageTarget.item.recordId;
        if (!recordId) throw new Error('视频记录不存在');
        const response = await fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}`, {
          method: 'DELETE',
          headers: authHeader(),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '删除失败');
        setCrawledVideos(items => items.filter(item => item.id !== manageTarget.item.id));
        setTenantVideoTotalItems(value => value === null ? null : Math.max(0, value - 1));
        // Re-read the authoritative tenant list so a deleted record cannot
        // linger in another page/count cache.
        await refreshVideos(1, true);
      } else {
        const result = await studioApi.deleteMaterial(manageTarget.item.id);
        if (!result.ok) throw new Error(result.error || '删除失败');
        setLocalMaterials(items => items.filter(item => item.id !== manageTarget.item.id));
        setProductDetailMaterials(items => items.filter(item => item.id !== manageTarget.item.id));
        await refreshMaterials(materialPage);
        setProductSummaryRefreshVersion(version => version + 1);
        if (productDetailProduct) await loadProductMaterialDetail(productDetailProduct);
        setMaterialMessage(result.retainedForProjectReferences ? '已从我的素材移除；制作项目中的既有引用仍保留' : '已删除');
      }
      if (manageTarget.kind === 'video') setMaterialMessage('已删除');
      setManageTarget(null);
    } catch (error) {
      setMaterialMessage(error instanceof Error ? error.message : '删除失败');
    } finally {
      setManageBusy(false);
    }
  };

  const clearInspirationFilters = () => {
    setLastCrawlVideoIds([]);
    setSearch('');
    setPlatform('all');
    setContentFormat('video');
    setInspirationFavoriteFilter('all');
    setCrawlTimeRange('all');
    setDiscoveryDecision('all');
    setBusinessModelFilter('all');
    setMinimumDiscoveryScore(0);
    setSortMode('crawlTime');
    setViewMode('grid');
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

  const inspirationFilterCount = Number(search.trim().length > 0)
    + Number(platform !== 'all')
    + Number(contentFormat !== 'video')
    + Number(inspirationFavoriteFilter !== 'all')
    + Number(crawlTimeRange !== 'all')
    + Number(discoveryDecision !== 'all')
    + Number(businessModelFilter !== 'all')
    + Number(minimumDiscoveryScore > 0)
    + Number(sortMode !== 'crawlTime')
    + Number(viewMode !== 'grid');
  const inspirationAdvancedFilterCount = Number(crawlTimeRange !== 'all')
    + Number(discoveryDecision !== 'all')
    + Number(businessModelFilter !== 'all')
    + Number(minimumDiscoveryScore > 0)
    + Number(sortMode !== 'crawlTime')
    + Number(viewMode !== 'grid');
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

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/overseas/competitor-accounts', { headers: authHeader() })
      .then(async response => {
        if (!response.ok) return;
        const data = await response.json().catch(() => ({})) as { items?: unknown[] };
        if (!cancelled) setCompetitorAccountCount(Array.isArray(data.items) ? data.items.length : 0);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="relative min-h-full bg-ink text-text-primary">
      {hasExactReferenceReview(exactReferenceDetail) && !exactReview && <p role="alert" className="m-4 rounded border p-3">{exactReviewError} {parseExactReferenceReview(exactReferenceDetail) ? '精确参考审核目标已收到，须核验原周来源回执后才能打开审核。' : '精确参考审核目标无效，请返回原周任务重新打开。'} 不会按标题、链接或快照打开其他参考。</p>}
      {exactReview && <section className="m-4 rounded border p-4"><h2>原参考逐镜审核 · {exactReview.recordId}</h2><DirectorReviewWorkspace key={`${exactReview.recordId}:${exactReviewToken}`} recordId={exactReview.recordId} handoff={exactReview.handoff} onPreview={()=>handleWatch(exactReview.video)} renderVideo={url => <AuthenticatedVideo key={url} apiUrl={url} controls className="max-h-48 w-full rounded bg-black" />} renderImage={(url, alt) => <AuthenticatedImage key={url} src={url} alt={alt} className="max-h-48 w-full rounded object-contain" />} /></section>}
      <div className="transition-all duration-300">
        <div className="px-4 py-5 sm:px-6 lg:py-6">
          <LsPageHeader title="灵感中心" description="查看外部参考、管理产品素材，并将内容证据交接到制作流程。" />
          <div className="mb-4 flex min-w-0 flex-col gap-3 border-b border-border lg:flex-row lg:items-start">
            <Tabs className="min-w-0 flex-1" activeKey={innerView} onChange={key => setInnerView(key as InspirationInnerView)} aria-label="灵感中心分类"
              items={[
                { key: 'inspiration', label: `灵感发现 · ${tenantVideoTotalItems ?? '…'}`, icon: <Flame size={16} /> },
                { key: 'library', label: `我的素材 · ${visibleMaterialTotal}`, icon: <Film size={16} /> },
                { key: 'accounts', label: `对标账号 · ${competitorAccountCount ?? '…'}`, icon: <Users size={16} /> },
                { key: 'shooting', label: `待拍任务 · ${shootingNeeds.length + scriptGapTasks.length}`, icon: <Lightbulb size={16} /> },
              ]} />
            {innerView === 'inspiration' && <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 pt-1 lg:w-auto">
              <Button type="primary" icon={<Users size={15} />} onClick={() => setInnerView('accounts')}>采集对标账号爆款</Button>
              <Button icon={<Images size={15} />} onClick={openImageCrawl}>关键词补充</Button>
              <AntUpload className="shrink-0 pt-1" accept="video/mp4,.mp4" showUploadList={false} disabled={importingReference} beforeUpload={file => { void importReferenceVideo(file); return false; }}>
                <Button loading={importingReference} icon={<Upload size={15} />}>导入 MP4 并分析</Button>
              </AntUpload>
            </div>}
            <div className="flex shrink-0 items-center gap-2">
              {innerView === 'library' && <Button loading={uploadingMaterial} icon={<Upload size={15} />} onClick={() => { setUploadProductSceneKind(null); setMaterialUploadDialogOpen(true); }}>上传素材</Button>}
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
                setSortMode('crawlTime');
                setPlatform('all');
                setSearch('');
                if (mode === 'image') {
                  setContentFormat('image');
                  setInnerView('inspiration');
                }
                if (queued) setCompetitorCollectionSyncing(true);
                if (!queued && mode !== 'image') void refreshVideos(1, false);
              }}
            />}
            {innerView === 'inspiration' && <div className="mb-4 space-y-4 rounded-lg border border-border bg-surface p-4">
              <div className="overflow-x-auto pb-1">
              <div className="grid min-w-[940px] grid-cols-[minmax(240px,2fr)_160px_minmax(130px,1fr)_minmax(170px,1fr)_160px] gap-3">
                <Input allowClear prefix={<Search size={15} />} value={search}
                  onChange={event => { setLastCrawlVideoIds([]); setSearch(event.target.value); }}
                  aria-label="搜索爆款灵感" placeholder="搜索标题或标签" />
                <Select value={platform} onChange={value => handlePlatformFilter(value as Platform)} aria-label="社媒平台" options={PLATFORM_FILTERS.map(item => ({ value: item.id, label: item.label }))} />
                <Select value={contentFormat} onChange={value => handleContentFormatFilter(value as ContentFormat)} aria-label="内容形式"
                  options={[{ value: 'video', label: '视频' }, { value: 'image', label: '图文' }]} />
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
                  <label className="space-y-1 text-xs text-text-secondary"><span>排序方法</span><Select className="w-full" value={sortMode} onChange={value => { setLastCrawlVideoIds([]); setSortMode(value as SortMode); }} aria-label="排序方法" options={[{ value: 'crawlTime', label: '按爬取时间' }, { value: 'heat', label: '按内容机会' }]} /></label>
                  <label className="space-y-1 text-xs text-text-secondary"><span>筛选结论</span><Select className="w-full" value={discoveryDecision} onChange={value => setDiscoveryDecision(value as DiscoveryDecisionFilter)} aria-label="服务端筛选结论" options={[{ value: 'all', label: '全部评分结果' }, { value: 'accepted', label: '已入选' }, { value: 'review', label: '待复核' }, { value: 'rejected', label: '已淘汰' }]} /></label>
                  <label className="space-y-1 text-xs text-text-secondary"><span>业务类型</span><Select className="w-full" value={businessModelFilter} onChange={value => setBusinessModelFilter(value as BusinessModelFilter)} aria-label="业务类型" options={[{ value: 'all', label: '全部业务类型' }, { value: 'b2b', label: 'B2B 对标' }, { value: 'mixed', label: '混合业务' }, { value: 'd2c', label: 'DTC 卖货' }, { value: 'unknown', label: '待识别' }]} /></label>
                  <label className="space-y-1 text-xs text-text-secondary"><span>最低综合评分</span><Select className="w-full" value={minimumDiscoveryScore} onChange={setMinimumDiscoveryScore} aria-label="最低综合评分" options={[{ value: 0, label: '不限分数' }, { value: 50, label: '50 分以上' }, { value: 70, label: '70 分以上' }, { value: 85, label: '85 分以上' }]} /></label>
                  <div className="space-y-1 text-xs text-text-secondary"><span>展示方式</span><Segmented block value={viewMode} onChange={value => setViewMode(value as 'grid' | 'list')} aria-label="大屏视图" options={[{ value: 'grid', label: '卡片', icon: <LayoutGrid size={14}/> }, { value: 'list', label: '列表', icon: <List size={14}/> }]} /></div>
                </div>
                <div className="flex justify-end"><Button type="text" onClick={clearInspirationFilters} disabled={inspirationFilterCount === 0} icon={<X size={13} />}>清除全部筛选</Button></div>
              </div>}
            </div>}


        {innerView === 'inspiration' && videosError && <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-900"><span>{videosError}</span><button type="button" onClick={() => void refreshVideos(videoPage)} className="rounded-md bg-white px-2.5 py-1 font-semibold text-amber-950">重试</button></div>}
        {innerView === 'inspiration' && discoverySupplyError && <Alert className="mb-3" type="warning" showIcon title={discoverySupplyError} />}

        <div>
          {innerView === 'inspiration' && (
            <>
              {!videosLoaded && videosLoading ? (
                <LsLoadingState loading mode="spin" label="正在读取真实视频库存" description="正在同步全部可展示灵感" className="min-h-[360px] rounded-lg border border-border bg-surface">
                  <span />
                </LsLoadingState>
              ) : filtered.length === 0 ? (
                <InspirationEmptyState state={resultEmptyState(visibleVideos.length, search, platform !== 'all' || crawlTimeRange !== 'all')} contentFormat={contentFormat} search={search} localMaterialCount={localMaterials.length} onReset={resetInspirationFilters} onOpenLibrary={() => setInnerView('library')} />
              ) : viewMode === 'grid' ? (
                <LsMasonryGallery layout="masonry" items={filtered.map((video, i) => ({ id: video.id, content:
                    <div className="relative h-full">
                      <VideoCard video={video} index={i} isSelected={false}
                        onSelect={() => openDirectorAnalysis(video)}
                        onCreate={() => startInspirationCreation(video)}
                        createLabel={launchingReferences.includes(video.id) ? '正在启动…' : replicationTasks[`${video.id}:${creationAccountId}`] ? '继续制作' : video.id.startsWith('material-') ? '开始创作' : '爆款裂变'}
                        creating={launchingReferences.includes(video.id)}
                        createDisabled={video.contentFormat === 'image' && !inspirationCreationAvailability(video).ready}
                        createDisabledReason={inspirationCreationAvailability(video).reason}
                        onWatch={() => handleWatch(video)}
                        onFavoriteMaterial={() => void favoriteMaterial(video)}
                        favoritingMaterial={favoritingMaterialIds.includes(video.id)}
                        isFavoriteMaterial={favoritedVideoIds.includes(video.id) || favoriteSourceUrls.has(String(video.sourceUrl || '').trim())} />
              {video.canManage && (
                <div className="absolute right-12 top-2 z-30 flex gap-1">
                  <button type="button" title="编辑素材" aria-label="编辑素材" onClick={() => openManageDialog({ kind: 'video', item: video, action: 'edit' })} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/95 text-text-secondary shadow transition hover:text-accent"><Pencil size={14} /></button>
                  <button type="button" title="删除素材" aria-label="删除素材" onClick={() => openManageDialog({ kind: 'video', item: video, action: 'delete' })} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/95 text-text-secondary shadow transition hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              )}

                    </div>
                }))} />
              ) : (
                <div className="card overflow-hidden divide-y divide-border">
                  {filtered.map(video => (
                    <VideoListItem key={video.id} video={video} isSelected={false}
                      onSelect={() => openDirectorAnalysis(video)}
                      onCreate={() => startInspirationCreation(video)}
                        createLabel={launchingReferences.includes(video.id) ? '正在启动…' : replicationTasks[`${video.id}:${creationAccountId}`] ? '继续制作' : video.id.startsWith('material-') ? '开始创作' : '爆款裂变'}
                        creating={launchingReferences.includes(video.id)}
                      createDisabled={video.contentFormat === 'image' && !inspirationCreationAvailability(video).ready}
                      createDisabledReason={inspirationCreationAvailability(video).reason}
                      onWatch={() => handleWatch(video)}
                      onFavoriteMaterial={() => void favoriteMaterial(video)}
                      favoritingMaterial={favoritingMaterialIds.includes(video.id)}
                      isFavoriteMaterial={favoritedVideoIds.includes(video.id) || favoriteSourceUrls.has(String(video.sourceUrl || '').trim())} />
                  ))}
                </div>
              )}
              {videosLoaded && !serverDiscoveryFilterActive && videoTotalPages > 1 && (
                <nav className="flex justify-center py-4" aria-label="灵感发现分页">
                  <Pagination current={videoPage} total={videoTotalPages * INSPIRATION_PAGE_SIZE} pageSize={INSPIRATION_PAGE_SIZE}
                    showSizeChanger={false} disabled={videosLoading} onChange={page => void refreshVideos(page)}
                    showTotal={() => `第 ${videoPage} / ${videoTotalPages} 页`} />
                </nav>
              )}
            </>
          )}

          {innerView === 'library' && (
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
                                  disabled={material.type === 'audio' || (material.type === 'video' && !canProcessVideo({ contentFormat: 'video', duration: material.duration })) || !String(material.url || material.poster || '').trim()}
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
          )}

          <ProductMaterialDetailDrawer
            product={productDetailProduct}
            materials={productDetailMaterials}
            slots={productDetailSlots}
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
            <Drawer open title={detailMaterial.name} size={800} onClose={() => setDetailMaterial(null)} styles={{ body: { padding: 0 } }}>
                <section className="border-b border-border bg-surface-2 px-5 py-4" aria-label="素材标签">
                  <p className="text-xs font-semibold text-text-primary">素材标签</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(() => { const badge = materialAssetBadge(detailMaterial); return <span className="rounded-md border border-border bg-white px-2 py-1 text-xs font-semibold text-text-secondary">{badge.label}</span>; })()}
                    <span className={`rounded-md border border-border px-2 py-1 text-xs font-semibold ${materialPrimaryThemeOf(detailMaterial) ? 'bg-accent-glow text-accent' : 'bg-white text-text-secondary'}`}>{materialPrimaryThemeOf(detailMaterial) ? MATERIAL_THEME_LABELS[materialPrimaryThemeOf(detailMaterial)!] : '主题待识别'}</span>
                    {visibleMaterialTags(detailMaterial.tags).split(/[,，]/).map(tag => tag.trim()).filter(Boolean).map(tag => <span key={`detail-tag-${tag}`} className="rounded-md border border-border bg-white px-2 py-1 text-xs font-semibold text-text-secondary">{tag}</span>)}
                  </div>
                </section>
                <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1.2fr)_minmax(240px,0.8fr)]">
                  <div className="overflow-hidden rounded-lg border border-border bg-black">
                    {detailMaterial.type === 'video' ? <video src={detailMaterial.url} poster={detailMaterial.poster} controls playsInline preload="metadata" className="aspect-video h-full max-h-[54vh] w-full object-contain" />
                      : detailMaterial.type === 'image' ? <img src={detailMaterial.poster || detailMaterial.url} alt={detailMaterial.name} className="max-h-[54vh] w-full object-contain" />
                      : <div className="flex min-h-44 flex-col items-center justify-center gap-4 bg-surface-2 p-6"><Music2 size={28} className="text-text-muted" /><audio src={detailMaterial.url} controls className="w-full" /></div>}
                  </div>
                  <div className="space-y-3 text-xs">
                    {(() => {
                      const director = materialDirectorUi(detailMaterial);
                      return <div className="rounded-xl border border-accent/20 bg-accent-glow px-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-bold text-text-primary">编导 Agent 识别</p>
                          <span className="text-[10px] font-bold text-accent">{director.status}</span>
                        </div>
                        <p className="mt-2 font-semibold text-text-primary">{director.role} · {director.content}</p>
                        {director.uses.length > 0 && <p className="mt-1 leading-5 text-text-secondary">可用于：{director.uses.join('、')}</p>}
                        {director.cautions.length > 0 && <p className="mt-1 leading-5 text-text-muted">注意：{director.cautions.join('；')}</p>}
                      </div>;
                    })()}
                    <div className="rounded-xl border border-border bg-surface px-3 py-2.5"><p className="text-[10px] font-bold text-text-muted">主题标签</p><div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(MATERIAL_THEME_LABELS).map(([id,label]) => <button type="button" key={id} disabled={updatingMaterialTheme} onClick={() => void updateDetailMaterialTheme(id as keyof typeof MATERIAL_THEME_LABELS)} className={`rounded-full px-2.5 py-1 text-[11px] font-bold disabled:opacity-50 ${materialPrimaryThemeOf(detailMaterial) === id ? 'bg-accent text-white' : 'bg-surface-2 text-text-secondary'}`}>{label}</button>)}</div></div>
                    {[
                      ['素材类型', detailMaterial.type === 'video' ? '视频' : detailMaterial.type === 'image' ? '图片' : '音频'],
                      ['关联产品', detailMaterial.productName || '企业通用素材'],
                      ['主要内容', materialSemanticLabel(detailMaterial)],
                      ['素材来源', generatedMaterialOriginLabel(detailMaterial) || detailMaterial.sourceName || detailMaterial.sourceProvider || (detailMaterial.scope === 'shared' ? '共享素材' : '我的素材')],
                      ['时长', detailMaterial.type === 'video' || detailMaterial.type === 'audio' ? displayDuration(detailMaterial.duration) : '—'],
                      ['入库时间', detailMaterial.createdAt ? new Date(detailMaterial.createdAt).toLocaleString('zh-CN') : '—'],
                    ].map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-surface px-3 py-2.5"><p className="text-[10px] font-bold text-text-muted">{label}</p><p className="mt-1 break-words font-bold leading-5 text-text-primary">{value}</p></div>)}
                    <Button type="primary" block onClick={() => { const material = detailMaterial; setDetailMaterial(null); enterMaterialSmartGeneration(material); }} disabled={detailMaterial.type === 'audio' || (detailMaterial.type === 'video' && !canProcessVideo({ contentFormat: 'video', duration: detailMaterial.duration })) || !String(detailMaterial.url || detailMaterial.poster || '').trim()}>{detailMaterial.type === 'image' ? '用此图制作图片' : '自由创作'}</Button>
                  </div>
                </div>
                <MaterialUsagePanel material={detailMaterial} />
            </Drawer>
          )}

          {innerView === 'shooting' && <InspirationShootingPanel needs={shootingNeeds} scriptGapTasks={scriptGapTasks} materialCount={localMaterials.length} uploadingMaterial={uploadingMaterial} onUploadExisting={requestMaterialUpload} onCaptureStart={setUploadingScriptGapId} onUploadCaptured={files => { void handleUploadMaterials(files); }} />}
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
        {watchVideo && <WatchModal key={watchVideo.id} video={watchVideo} onClose={() => setWatchVideo(null)} />}
      </AnimatePresence>
      <Modal
        open={materialUploadDialogOpen}
        title={uploadProductSceneKind
          ? `补充${neutralProductSceneLabel(Math.max(0, PRODUCT_SCENE_KINDS.indexOf(uploadProductSceneKind)))}`
          : '上传素材'}
        width={480}
        okText="选择文件"
        cancelText="取消"
        okButtonProps={{ disabled: Boolean(uploadProductSceneKind && !uploadProductId) }}
        onCancel={() => { setMaterialUploadDialogOpen(false); setUploadProductSceneKind(null); }}
        onOk={() => {
          setMaterialUploadDialogOpen(false);
          uploadInputRef.current?.click();
        }}
      >
        <label className="block text-xs font-semibold text-text-secondary">
          素材归属（可选）<span className="sr-only">可关联产品，也可作为企业通用素材上传</span>
          <Select
            aria-label="本次上传素材归属"
            className="mt-2 w-full"
            value={uploadProductId || undefined}
            placeholder={uploadProductSceneKind ? '请选择对应产品' : '企业通用素材（不绑定产品）'}
            disabled={Boolean(uploadProductSceneKind)}
            onChange={setUploadProductId}
            options={[
              { value: '', label: '企业通用素材（不绑定产品）' },
              ...(materialProductId && materialProductRef && !materialProducts.some(item => item.id === materialProductId)
                ? [{ value: materialProductId, label: materialProductRef }]
                : []),
              ...materialProducts.map(item => ({ value: item.id, label: item.name })),
            ]}
          />
        </label>
        <p className="mt-3 text-xs leading-5 text-text-muted">工厂、展会、办公、人物动作和通用转场等素材可直接作为企业通用素材；只有需要锁定具体商品身份时才关联产品。</p>
        {uploadProductSceneKind && (
          <div role="status" className="mt-4 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-text-secondary">
            该素材会归入当前产品的
            <strong className="mx-1 text-text-primary">{neutralProductSceneLabel(Math.max(0, PRODUCT_SCENE_KINDS.indexOf(uploadProductSceneKind)))}</strong>
            。请选择视频文件。
          </div>
        )}
      </Modal>
      {manageTarget && (
        <Modal open title={`${manageTarget.action === 'delete' ? '删除' : '编辑'}${manageTarget.kind === 'video' ? '爆款视频' : '素材'}`}
          width={480} onCancel={() => setManageTarget(null)} mask={{ closable: false }} keyboard={!manageBusy} closable={!manageBusy}
          confirmLoading={manageBusy} okText={manageTarget.action === 'delete' ? '确认删除' : '保存'} cancelText="取消"
          okButtonProps={{ danger: manageTarget.action === 'delete', disabled: manageTarget.action === 'edit' && !manageName.trim() }}
          cancelButtonProps={{ disabled: manageBusy }} onOk={() => void (manageTarget.action === 'delete' ? deleteManagedItem() : saveManagedItem())}>
            {manageTarget.action === 'edit' ? <>
              <label className="mt-4 block text-xs font-bold text-text-secondary">名称</label>
              <Input value={manageName} onChange={event => setManageName(event.target.value)} maxLength={160} className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-accent" />
              <label className="mt-3 block text-xs font-bold text-text-secondary">标签</label>
              <Input value={manageTags} onChange={event => setManageTags(event.target.value)} placeholder="用逗号分隔" className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-accent" />
              {manageTarget.kind === 'material' && <label className="mt-3 block text-xs font-bold text-text-secondary">关联产品
                <Select aria-label="素材关联产品" value={manageProductId || MATERIAL_PRODUCT_COMMON} onChange={value => setManageProductId(value === MATERIAL_PRODUCT_COMMON ? '' : value)} className="mt-1 w-full" options={[{ value: MATERIAL_PRODUCT_COMMON, label: '不指定（系统自动匹配）' }, ...materialProducts.map(item => ({ value: item.id, label: item.name }))]} /><span className="mt-1 block font-normal text-text-muted">可选。未指定时系统会按口播与画面语义自动匹配，也可作为企业通用素材使用。</span>
              </label>}
              <p className="mt-3 text-xs text-text-muted">仅当前租户自己采集或本地上传的素材可修改；共享素材保持只读。</p>
            </> : <p className="mt-4 border-l-2 border-red bg-red/5 p-3 text-sm text-red">确认删除“{manageName}”？删除后无法恢复。</p>}
        </Modal>
      )}

    </main>
  );
}
