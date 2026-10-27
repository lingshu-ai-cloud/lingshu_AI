import { useEffect, useRef, useState } from 'react';
import type { SocialDiscoverySupplyItem } from '../../../shared/contracts/socialContentWorkflow';
import { readCompetitorAccounts } from '../../lib/competitorAccountsApi';
import { authHeader } from '../../lib/auth';
import type { InspirationImageCrawlPlatform } from '../../lib/inspirationImageCrawl';
import type { ContentFormat, Platform, TrendVideo } from '../../lib/inspirationTypes';
import type { ShootingNeed } from '../../lib/inspirationTypes';
import { socialDiscoveryApi } from '../../lib/socialDiscoveryApi';
import { runInspirationImageCrawl } from './inspirationImageCrawlAction';
import { type FavoriteFilter } from './inspirationMaterialLibrary';
import { createInspirationReferenceImporter } from './inspirationReferenceImport';
import { recordsToVideos, type CrawlerRecord } from './inspirationVideoProjection';
import { readAllInspirationPages, readInspirationInventory } from './inspirationResultPaging';
import { analysisProgressIsActive } from './VideoAnalysisProgressPanel';

import { type BusinessModelFilter, type CrawlTimeRange, type DiscoveryDecisionFilter, INSPIRATION_PAGE_SIZE, type InspirationInnerView, type InspirationContentFormat, PLATFORM_FILTERS, type SortMode, type StateSetter } from './inspirationDashboardContracts';

interface Dependencies {
  innerView: InspirationInnerView;
  setMaterialMessage: StateSetter<string>;
  setSelectedVideo: StateSetter<TrendVideo | null>;
}

export function useInspirationDiscoveryInventory({ setMaterialMessage, setSelectedVideo, innerView }: Dependencies) {
  const [platform, setPlatform] = useState<Platform>('all');

  const [search, setSearch] = useState(() => typeof window === 'undefined'
    ? ''
    : String(new URLSearchParams(window.location.search).get('search') || '').trim());

  const searchRef = useRef('');

  searchRef.current = search;


  const [sortMode, setSortMode] = useState<SortMode>('crawlTime');

  const [contentFormat, setContentFormat] = useState<InspirationContentFormat>('all');

  const [inspirationFavoriteFilter, setInspirationFavoriteFilter] = useState<FavoriteFilter>('all');

  const [crawlTimeRange, setCrawlTimeRange] = useState<CrawlTimeRange>('all');

  const [discoveryDecision, setDiscoveryDecision] = useState<DiscoveryDecisionFilter>('all');

  const [businessModelFilter, setBusinessModelFilter] = useState<BusinessModelFilter>('all');

  const [minimumDiscoveryScore, setMinimumDiscoveryScore] = useState(0);

  const serverDiscoveryFilterActive = discoveryDecision !== 'all'
    || minimumDiscoveryScore > 0 || sortMode === 'heat';

  const completeInventory = contentFormat === 'all' || businessModelFilter !== 'all' || inspirationFavoriteFilter === 'favorite';

  const [discoverySupplyItems, setDiscoverySupplyItems] = useState<SocialDiscoverySupplyItem[]>([]);

  const [discoveryPage, setDiscoveryPage] = useState(1);

  const [discoverySupplyLoading, setDiscoverySupplyLoading] = useState(false);

  const [discoverySupplyError, setDiscoverySupplyError] = useState('');

  const [inspirationFiltersOpen, setInspirationFiltersOpen] = useState(false);

  const [crawledVideos, setCrawledVideos] = useState<TrendVideo[]>([]);

  const [videoPage, setVideoPage] = useState(1);

  const [videoResultTotalItems, setVideoResultTotalItems] = useState(0);

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

  const [importingReference, setImportingReference] = useState(false);

  const referenceUploadInputRef = useRef<HTMLInputElement | null>(null);

  const videoRequestRef = useRef(0);

  const inventoryRequestRef = useRef(0);

  const platformLabel = PLATFORM_FILTERS.find(f => f.id === platform)?.label ?? '全部平台';

  const sortLabel = sortMode === 'crawlTime' ? '按爬取时间' : '按内容机会';

  const contentFormatLabel = contentFormat === 'all' ? '全部' : contentFormat === 'video' ? '视频' : '图文';

  const refreshInventory = async (requestedFormat: InspirationContentFormat = contentFormat) => {
    const requestId = ++inventoryRequestRef.current;
    try {
      const formats = ['video', 'image'];
      const counts = await Promise.all(formats.map(async format => {
        const response = await fetch(`/api/overseas/videos/inventory-summary?contentFormat=${format}`, { headers: authHeader() });
        if (!response.ok) throw new Error('库存统计加载失败');
        const data = await response.json() as { totalItems?: number; visibleItems?: number };
        return Math.max(0, Number(data.visibleItems ?? data.totalItems ?? 0));
      }));
      const total = counts.reduce((sum, count) => sum + count, 0);
      if (requestId === inventoryRequestRef.current) setTenantVideoTotalItems(total);
      return total;
    } catch { /* The last authoritative count survives temporary read failure. */ }
  };

  const refreshVideos = async (nextPage = 1, quiet = false, requestedFilters?: {
    contentFormat?: InspirationContentFormat;
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
      const readPage = async (format: 'video' | 'image', page: number) => {
        const query = new URLSearchParams({ page: String(page), perPage: String(INSPIRATION_PAGE_SIZE), contentFormat: format, crawlRange: requestedCrawlTimeRange });
        if (requestedPlatform !== 'all') query.set('platform', requestedPlatform);
        if (keyword) query.set('search', keyword);
        const response = await fetch(`/api/overseas/videos?${query}`, { headers: authHeader() });
        if (!response.ok) throw new Error('灵感库存读取失败');
        return await response.json() as { items: CrawlerRecord[]; totalItems: number; page?: number; totalPages?: number };
      };
      const data = await readInspirationInventory(readPage, requestedContentFormat, nextPage,
        completeInventory, item => item.id, () => requestId === videoRequestRef.current);
      const applyResult = (result: typeof data) => {
        if (requestId !== videoRequestRef.current) return;
        setVideosError('');
        const videos = recordsToVideos(result.items || []);
        if (requestedContentFormat === 'all' && !keyword && requestedPlatform === 'all' && requestedCrawlTimeRange === 'all') setTenantVideoTotalItems(Math.max(0, Number(result.totalItems ?? 0)));
        setVideoResultTotalItems(Math.max(0, Number(result.totalItems ?? 0)));
        setVideoPage(Number(result.page || nextPage));
        setVideoTotalPages(Math.max(1, Number(result.totalPages || nextPage)));
        setCrawledVideos(prev => JSON.stringify(prev) === JSON.stringify(videos) ? prev : videos);
        if (requestedContentFormat === 'all' && !keyword && requestedPlatform === 'all' && requestedCrawlTimeRange === 'all') {
          setShootingVideos(videos);
          setShootingVideosError('');
        }
      };

      // “我的社媒” is tenant-scoped even for an administrator. A successful
      // cross-tenant admin response used to overwrite these records (including
      // with an empty array), producing an impossible "179 total / 0 cards" UI.
      if (data.items) {
        applyResult(data);
        if (requestId === videoRequestRef.current) setVideosLoaded(true);
      } else {
        throw new Error('视频列表加载失败');
      }
    } catch {
      if (requestId === videoRequestRef.current && !quiet) {
        setVideosError(crawledVideos.length > 0 ? '刷新失败，已保留上次成功加载的内容。' : '灵感库存暂时无法读取，请重试。');
        setVideosLoaded(true);
      }
    } finally {
      if (requestId === videoRequestRef.current) setVideosLoading(false);
    }
  };

  const [shootingVideos, setShootingVideos] = useState<TrendVideo[]>([]);
  const [shootingNeeds, setShootingNeeds] = useState<ShootingNeed[]>([]);
  const [shootingVideosLoading, setShootingVideosLoading] = useState(false);
  const [shootingVideosError, setShootingVideosError] = useState('');
  const shootingRequestRef = useRef(0);
  const shootingReadsInFlight = useRef(0);
  const refreshShootingVideos = async () => {
    const requestId = ++shootingRequestRef.current;
    shootingReadsInFlight.current += 1;
    setShootingVideosLoading(true);
    try {
      const response = await fetch('/api/overseas/videos/shooting-needs', { headers: authHeader(), signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('高频需求来源读取失败，请重试');
      const data = await response.json() as { needs: ShootingNeed[] };
      if (requestId === shootingRequestRef.current) { setShootingNeeds(data.needs); setShootingVideosError(''); }
    } catch (error) {
      if (requestId === shootingRequestRef.current) setShootingVideosError(error instanceof Error ? error.message : '待拍来源读取失败');
    } finally { shootingReadsInFlight.current -= 1; if (requestId === shootingRequestRef.current) setShootingVideosLoading(false); }
  };
  const shootingRefreshRef = useRef(refreshShootingVideos);
  shootingRefreshRef.current = refreshShootingVideos;
  useEffect(() => {
    if (innerView !== 'shooting') return;
    void shootingRefreshRef.current();
    const refresh = () => { if (document.visibilityState !== 'hidden' && !shootingReadsInFlight.current) void shootingRefreshRef.current(); };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => { shootingRequestRef.current += 1; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [innerView]);

  const openImageCrawl = () => {
    setImageCrawlPlatform(platform === 'all' ? 'instagram' : platform);
    setImageCrawlKeyword(search.trim());
    setImageCrawlError('');
    setImageCrawlOpen(true);
  };

  const runImageCrawl = async () => {
    await runInspirationImageCrawl({
      busy: imageCrawlBusy, platform: imageCrawlPlatform, keyword: imageCrawlKeyword, limit: imageCrawlLimit,
      setBusy: setImageCrawlBusy, setError: setImageCrawlError, setContentFormat, setPlatform,
      setCrawlTimeRange, setSearch, searchRef, setSortMode, setLastCrawlVideoIds,
      setOpen: setImageCrawlOpen, setMaterialMessage, refreshInventory, refreshVideos,
    });
  };

  const importReferenceVideo = createInspirationReferenceImporter({
    setImportingReference, setMaterialMessage, setCrawledVideos, setSelectedVideo,
    referenceUploadInputRef, refreshInventory, refreshVideos,
  });

  useEffect(() => {
    setVideosLoaded(false);
    setVideoPage(1);
    void refreshInventory();
    void refreshVideos(1);
  }, [contentFormat, crawlTimeRange, platform, inspirationFavoriteFilter, businessModelFilter]);


  const searchDebounceRef = useRef(false);

  useEffect(() => {
    if (!searchDebounceRef.current) { searchDebounceRef.current = true; return; }
    const timer = window.setTimeout(() => {
      setVideosLoaded(false);
      setVideoPage(1);
      void refreshVideos(1);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (innerView !== 'inspiration') return;
    let active = true;
    setDiscoverySupplyLoading(true);
    setDiscoverySupplyItems([]);
    const timer = window.setTimeout(() => {
      setDiscoverySupplyLoading(true);
      setDiscoverySupplyError('');
      const readSupplyPage = (page: number) => socialDiscoveryApi.listSupply({
        candidateType: 'video',
        platform: platform === 'all' ? undefined : platform,
        decision: discoveryDecision === 'all' ? undefined : discoveryDecision,
        minScore: minimumDiscoveryScore || undefined,
        search: search.trim() || undefined,
        sort: sortMode === 'heat' ? 'score' : 'latest',
        page,
        perPage: 100,
      });
      const request = serverDiscoveryFilterActive || businessModelFilter !== 'all'
        ? readAllInspirationPages(readSupplyPage, item => item.candidateId, () => active)
        : readSupplyPage(1).then(result => result.items);
      void request.then(items => {
        if (active) setDiscoverySupplyItems(items);
      }).catch(error => {
        if (active) setDiscoverySupplyItems([]);
        if (active) setDiscoverySupplyError(error instanceof Error ? error.message : '服务端评分暂时无法读取');
      }).finally(() => {
        if (active) setDiscoverySupplyLoading(false);
      });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [innerView, platform, businessModelFilter, discoveryDecision, minimumDiscoveryScore, search, sortMode, contentFormat, serverDiscoveryFilterActive]);

  useEffect(() => { setDiscoveryPage(1); }, [contentFormat, platform, crawlTimeRange, inspirationFavoriteFilter, businessModelFilter, discoveryDecision, minimumDiscoveryScore, search, sortMode]);

  const refreshVideosRef = useRef(refreshVideos);
  refreshVideosRef.current = refreshVideos;
  const refreshInventoryRef = useRef(refreshInventory);
  refreshInventoryRef.current = refreshInventory;
  const videoPageRef = useRef(videoPage);
  videoPageRef.current = videoPage;

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
      if (document.visibilityState === 'visible') await refreshVideosRef.current(videoPageRef.current, true);
      if (!cancelled) timer = window.setTimeout(() => void poll(), 8000);
    };
    timer = window.setTimeout(() => void poll(), 8000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasPendingVideos, contentFormat, videoPage]);

  useEffect(() => {
    if (!competitorCollectionSyncing) return;
    let cancelled = false;
    let timer = 0;
    const startedAt = Date.now();
    const poll = async () => {
      if (document.visibilityState === 'visible') {
        await refreshVideosRef.current(videoPageRef.current, true);
        await refreshInventoryRef.current();
      }
      if (!cancelled && Date.now() - startedAt < 5 * 60_000) {
        timer = window.setTimeout(() => void poll(), 4000);
      } else if (!cancelled) {
        setCompetitorCollectionSyncing(false);
      }
    };
    void poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [competitorCollectionSyncing, contentFormat]);

  const handlePlatformFilter = (nextPlatform: Platform) => {
    setLastCrawlVideoIds([]);
    setPlatform(nextPlatform);
  };

  const handleContentFormatFilter = (nextFormat: InspirationContentFormat) => {
    setLastCrawlVideoIds([]);
    setSelectedVideo(null);
    setContentFormat(nextFormat);
  };

  const resetInspirationFilters = () => {
    setContentFormat('all');
    setLastCrawlVideoIds([]);
    setSortMode('crawlTime');
    setSearch('');
    setPlatform('all');
    setInspirationFavoriteFilter('all');
    setCrawlTimeRange('all');
    setDiscoveryDecision('all');
    setBusinessModelFilter('all');
    setMinimumDiscoveryScore(0);
  };

  const clearInspirationFilters = () => {
    setLastCrawlVideoIds([]);
    setSearch('');
    setPlatform('all');
    setContentFormat('all');
    setInspirationFavoriteFilter('all');
    setCrawlTimeRange('all');
    setDiscoveryDecision('all');
    setBusinessModelFilter('all');
    setMinimumDiscoveryScore(0);
    setSortMode('crawlTime');
  };

  const inspirationFilterCount = Number(search.trim().length > 0)
    + Number(platform !== 'all')
    + Number(contentFormat !== 'all')
    + Number(inspirationFavoriteFilter !== 'all')
    + Number(crawlTimeRange !== 'all')
    + Number(discoveryDecision !== 'all')
    + Number(businessModelFilter !== 'all')
    + Number(minimumDiscoveryScore > 0)
    + Number(sortMode !== 'crawlTime');

  const inspirationAdvancedFilterCount = Number(crawlTimeRange !== 'all')
    + Number(discoveryDecision !== 'all')
    + Number(businessModelFilter !== 'all')
    + Number(minimumDiscoveryScore > 0)
    + Number(sortMode !== 'crawlTime');

  useEffect(() => {
    let requestId = 0;
    const refresh = async () => {
      const current = ++requestId;
      try { const items = await readCompetitorAccounts(); if (current === requestId) setCompetitorAccountCount(items.length); }
      catch { /* Keep the last authoritative count; the accounts page exposes retry. */ }
    };
    void refresh();
    window.addEventListener('lingshu:competitor-accounts-updated', refresh);
    return () => { requestId += 1; window.removeEventListener('lingshu:competitor-accounts-updated', refresh); };
  }, []);

  return {
    shootingVideos, shootingNeeds, shootingVideosLoading, shootingVideosError, refreshShootingVideos,
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
    refreshVideos, refreshInventory,
    openImageCrawl,
    runImageCrawl,
    importReferenceVideo,
    handlePlatformFilter,
    handleContentFormatFilter,
    resetInspirationFilters,
    clearInspirationFilters,
    inspirationFilterCount,
    inspirationAdvancedFilterCount
  };
}
