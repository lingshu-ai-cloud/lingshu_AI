import { useEffect, useRef, useState } from 'react';
import type { SocialDiscoverySupplyItem } from '../../../shared/contracts/socialContentWorkflow';
import { authHeader } from '../../lib/auth';
import type { InspirationImageCrawlPlatform } from '../../lib/inspirationImageCrawl';
import type { ContentFormat, Platform, TrendVideo } from '../../lib/inspirationTypes';
import { socialDiscoveryApi } from '../../lib/socialDiscoveryApi';
import { runInspirationImageCrawl } from './inspirationImageCrawlAction';
import { type FavoriteFilter } from './inspirationMaterialLibrary';
import { createInspirationReferenceImporter } from './inspirationReferenceImport';
import { recordsToVideos, type CrawlerRecord } from './inspirationVideoProjection';
import { analysisProgressIsActive } from './VideoAnalysisProgressPanel';

import { type BusinessModelFilter, type CrawlTimeRange, type DiscoveryDecisionFilter, INSPIRATION_PAGE_SIZE, type InspirationInnerView, PLATFORM_FILTERS, type SortMode, type StateSetter } from './inspirationDashboardContracts';

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

  const [importingReference, setImportingReference] = useState(false);

  const referenceUploadInputRef = useRef<HTMLInputElement | null>(null);

  const videoRequestRef = useRef(0);

  const inventoryRequestRef = useRef(0);

  const platformLabel = PLATFORM_FILTERS.find(f => f.id === platform)?.label ?? '全部平台';

  const sortLabel = sortMode === 'crawlTime' ? '按爬取时间' : '按内容机会';

  const contentFormatLabel = contentFormat === 'video' ? '视频' : '图文';

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
  }, [contentFormat, crawlTimeRange, platform]);

  useEffect(() => {
    setTenantVideoTotalItems(null);
  }, [contentFormat]);

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
  }, [hasPendingVideos, contentFormat, videoPage]);

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
  }, [competitorCollectionSyncing, contentFormat]);

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
  };

  const inspirationFilterCount = Number(search.trim().length > 0)
    + Number(platform !== 'all')
    + Number(contentFormat !== 'video')
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

  return {
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
    discoverySupplyLoading,
    discoverySupplyError,
    inspirationFiltersOpen,
    setInspirationFiltersOpen,
    crawledVideos,
    setCrawledVideos,
    videoPage,
    videoTotalPages,
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
  };
}
