import { Button } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Eye, Images, Loader2, Pencil, Play, Star, Trash2 } from 'lucide-react';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import type { TrendVideo } from '../lib/inspirationTypes';
import { AuthenticatedVideo, ThumbnailImage, VideoThumbnail } from './inspiration/InspirationMedia';
import { imagePostAnalysisQueuePresentation } from './inspiration/imagePostAnalysisPresentation';
import { candidateDimensionLabels, discoveryOriginTitle, discoverySupplyLabel, getPlatformMeta, inspirationScoresForVideo } from './inspiration/inspirationVideoProjection';
import { LsMediaStateFrame } from './ui/LsExperiencePrimitives';

interface VideoCardProps {
  video: TrendVideo;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onCreate: () => void;
  onWatch: () => void;
  onEditManage?: () => void;
  onDeleteManage?: () => void;
  onFavoriteMaterial?: () => void;
  favoritingMaterial?: boolean;
  isFavoriteMaterial?: boolean;
  createLabel?: string;
  creating?: boolean;
  createDisabled?: boolean;
  createDisabledReason?: string;
}

// Retained for legacy deep links; the current collection route only renders masonry cards.
const HIDDEN_DISCOVERY_TAGS = new Set(['来源待归类', '相关性待确认', '趋势未知', '迁移性待确认']);

function visibleDiscoverySignals(video: TrendVideo) {
  const dimensions = candidateDimensionLabels(video);
  const visible = (label: string) => HIDDEN_DISCOVERY_TAGS.has(label) ? '' : label;
  return {
    supply: visible(discoverySupplyLabel(video)),
    relevance: visible(dimensions.relevance),
    momentum: visible(dimensions.momentum),
    transferability: visible(dimensions.transferability),
  };
}

export function trendVideoAspectRatio(video: TrendVideo): number {
  const ratioText = String(video.aiAnalysis?.gemini?.globalSettings?.aspectRatio || '').trim();
  const match = ratioText.match(/(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)/);
  if (match) {
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width > 0 && height > 0) return width / height;
  }
  return video.contentFormat === 'image' ? 1 : 9 / 16;
}

function useNearViewportMedia(mediaKey: string) {
  const cardRef = useRef<HTMLElement>(null);
  const [enabledKey, setEnabledKey] = useState('');
  const enabled = Boolean(mediaKey) && enabledKey === mediaKey;
  useEffect(() => {
    const card = cardRef.current;
    if (!card || !mediaKey || enabled || typeof IntersectionObserver === 'undefined') return;
    let root = card.parentElement;
    while (root && !/(auto|scroll|overlay)/.test(window.getComputedStyle(root).overflowY)) root = root.parentElement;
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!active || !entries.some(entry => entry.isIntersecting)) return;
      setEnabledKey(mediaKey);
      observer.disconnect();
    }, { root, rootMargin: '240px 0px', threshold: 0 });
    // Ant Masonry first measures all cards at the same origin. Observe only
    // after its layout/ResizeObserver pass has placed the following rows.
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => { if (active) observer.observe(card); });
    });
    return () => { active = false; window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, [enabled, mediaKey]);
  // Focus/pointer entry also works when IntersectionObserver is unavailable.
  return { cardRef, enabled, enable: () => setEnabledKey(mediaKey) };
}

export function VideoCard({ video, isSelected, onSelect, onCreate, onWatch, onEditManage, onDeleteManage, onFavoriteMaterial, favoritingMaterial, isFavoriteMaterial, createLabel, creating, createDisabled, createDisabledReason }: VideoCardProps) {
  const meta = getPlatformMeta(video.platform);
  const isImagePost = video.contentFormat === 'image';
  const media = useNearViewportMedia(video.videoUrl ? JSON.stringify([video.id, video.videoUrl]) : '');
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaAspectRatio, setMediaAspectRatio] = useState(() => trendVideoAspectRatio(video));
  const videoAspectRatioLockedRef = useRef(false);
  useEffect(() => {
    videoAspectRatioLockedRef.current = false;
    setMediaReady(false);
    setMediaAspectRatio(trendVideoAspectRatio(video));
  }, [video.id, video.thumbnail, video.videoUrl]);
  const imageQueue = imagePostAnalysisQueuePresentation(video);
  const imageAnalyzed = !imageQueue && video.aiAnalysis?.imageEvidence?.status === 'analyzed' && Boolean(video.aiAnalysis.imageEvidence.observedFacts?.length);
  const imageFailed = video.aiAnalysis?.imageAnalysisStatus === 'failed' || video.status === 'failed';
  const trendLabel = isImagePost
    ? (imageAnalyzed ? '✓ 已完成拆解' : imageQueue?.label || (imageFailed ? '! 分析失败' : '… 待分析'))
    : video.trend === 'hot' ? '🔥 热门' : video.trend === 'rising' ? '↑ 上升' : '— 平稳';
  const analysisProgress = video.aiAnalysis?.analysisProgress;
  const analysisStage = analysisProgress?.stage;
  const analysisPaused = ['paused', 'cancelled'].includes(String(analysisStage || '')) || video.aiAnalysis?.geminiStatus === 'paused';
  const analysisActive = ['queued', 'downloading', 'transcoding', 'analyzing', 'extracting_evidence'].includes(String(analysisStage || ''));
  const mediaState = !analysisPaused && (imageQueue?.state === 'unknown' || imageFailed || analysisStage === 'failed')
    ? 'error'
    : analysisActive || (video.status === 'pending' && !analysisPaused)
      ? 'processing'
      : 'ready';
  return (
    <article ref={media.cardRef} onPointerEnter={media.enable} onFocusCapture={media.enable}
      className={`ls-viral-card group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface transition-colors duration-[var(--ls-motion-fast)] ease-[var(--ls-ease-standard)] hover:border-border-bright ${isSelected ? 'border-accent ring-1 ring-accent/20' : ''}`}>
      <div
        className="relative block w-full overflow-hidden text-left"
        style={{ background: 'var(--color-surface-2)', aspectRatio: mediaAspectRatio }}>
        <LsMediaStateFrame state={mediaState} percent={analysisProgress?.percent} label={imageQueue?.label || (isImagePost && mediaState === 'processing' ? '分析中' : isImagePost && mediaState === 'error' ? '分析失败，可查看详情后重试' : analysisProgress?.stageLabel)} className="absolute inset-0">
          <VideoThumbnail platform={video.platform} title={video.title} />
          {video.thumbnail && (
            <ThumbnailImage src={video.thumbnail} platform={video.platform} title={video.title} className="absolute inset-0 h-full w-full object-cover" onNaturalAspectRatio={ratio => {
              if (!videoAspectRatioLockedRef.current) setMediaAspectRatio(ratio);
            }} />
          )}
          {video.videoUrl && media.enabled ? (
            <AuthenticatedVideo
              apiUrl={video.videoUrl}
              poster={/^https?:\/\//i.test(video.thumbnail) ? video.thumbnail : undefined}
              loadOnMount
              previewFrame
              preload="auto"
              hoverPlay
              className={`absolute inset-0 w-full h-full object-cover ls-media-reveal ${mediaReady ? 'opacity-100' : 'opacity-0'}`}
              onMetadata={metadata => {
                if (metadata.width > 0 && metadata.height > 0) {
                  videoAspectRatioLockedRef.current = true;
                  setMediaAspectRatio(metadata.width / metadata.height);
                }
              }}
              onReady={() => setMediaReady(true)}
              onError={() => setMediaReady(false)}
            />
          ) : null}
        </LsMediaStateFrame>
        <button
          type="button"
          aria-label={`${isImagePost ? '查看图文' : '播放视频'} ${video.title}`}
          onClick={onWatch}
          className="ls-touch-media-reveal absolute inset-0 z-10 flex items-center justify-center bg-black/25 opacity-0 transition-opacity duration-[var(--ls-motion-fast)] ease-[var(--ls-ease-standard)] group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-neutral-900 shadow-none" aria-hidden="true">
            {isImagePost ? <Images size={16} /> : <Play size={16} fill="currentColor" />}
          </span>
        </button>
        {(onDeleteManage || (!isImagePost && onFavoriteMaterial)) && <div className="ls-touch-media-reveal absolute right-2 top-2 z-40 flex gap-1.5 opacity-0 transition-opacity duration-[var(--ls-motion-fast)] ease-[var(--ls-ease-standard)] group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
          {!isImagePost && onFavoriteMaterial && <Button size="small" shape="circle"
            icon={favoritingMaterial ? <Loader2 size={13} className="animate-spin"/> : <Star size={13} fill={isFavoriteMaterial ? 'currentColor' : 'none'}/>} onClick={onFavoriteMaterial} disabled={favoritingMaterial}
            title={isFavoriteMaterial ? '取消收藏' : '收藏'} aria-label={isFavoriteMaterial ? `取消收藏 ${video.title}` : `收藏 ${video.title}`}
            className="!border-white/25 !bg-black/65 !text-white hover:!bg-black/80" />}
          {onDeleteManage && <Button size="small" shape="circle" danger icon={<Trash2 size={13}/>} onClick={onDeleteManage}
            title="删除" aria-label={`删除 ${video.title}`} className="!border-white/25 !bg-black/65 !text-white hover:!bg-red-600" />}
        </div>}
        <div className="ls-touch-media-reveal absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-3 pb-3 pt-10 text-white opacity-0 transition-opacity duration-[var(--ls-motion-fast)] ease-[var(--ls-ease-standard)] group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
          <p className="mb-1 inline-flex items-center gap-1.5 text-xs text-white/80"><SocialPlatformIcon platform={video.platform} size={13} />{meta.label}<span aria-hidden="true">·</span>{isImagePost ? '图文' : `${Math.floor(video.duration / 60)}:${String(video.duration % 60).padStart(2, '0')}`}</p>
          {mediaState !== 'ready' && <p role="status" className="mb-1 text-xs text-white/80">{mediaState === 'error' ? '分析失败' : analysisProgress?.stageLabel || '分析中'}</p>}
          <p className="line-clamp-2 text-sm font-semibold" title={video.title}>{video.title}</p>
          <p className="mt-1 truncate text-xs text-white/80">{trendLabel} · {video.views} 次播放 · {video.aiAnalysis?.author || video.aiAnalysis?.sourceAccountName || '来源账号待获取'}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="small" onClick={onSelect} icon={<Eye size={13}/>}>查看详情</Button>
            <Button size="small" type="primary" onClick={onCreate} loading={creating} disabled={createDisabled} title={createDisabled ? createDisabledReason : undefined}>{createLabel || '用于创作'}</Button>
            {onEditManage && <Button size="small" onClick={onEditManage} icon={<Pencil size={13}/>} aria-label="编辑素材" />}
          </div>
        </div>
      </div>
    </article>
  );
}

// ── Video List Item ───────────────────────────────────────────────────────────
export function VideoListItem({ video, isSelected, onSelect, onCreate, onWatch, onFavoriteMaterial, favoritingMaterial, isFavoriteMaterial, createLabel, creating, createDisabled, createDisabledReason }: {
  video: TrendVideo;
  isSelected: boolean;
  onSelect: () => void;
  onCreate: () => void;
  onWatch: () => void;
  onFavoriteMaterial?: () => void;
  favoritingMaterial?: boolean;
  isFavoriteMaterial?: boolean;
  createLabel?: string;
  creating?: boolean;
  createDisabled?: boolean;
  createDisabledReason?: string;
}) {
  const meta = getPlatformMeta(video.platform);
  const trendColor = video.trend === 'hot' ? 'text-accent' : video.trend === 'rising' ? 'text-green' : 'text-text-muted';
  const trendLabel = video.trend === 'hot' ? '热门' : video.trend === 'rising' ? '上升' : '平稳';
  const crawlRule = video.aiAnalysis?.crawlRule || '关键词检索';
  const isImagePost = video.contentFormat === 'image';
  const inspirationScores = inspirationScoresForVideo(video);
  const serverScore = video.aiAnalysis?.discoveryScore;
  const visibleSignals = visibleDiscoverySignals(video);
  const hasVisibleSignals = Boolean(serverScore || visibleSignals.relevance || visibleSignals.momentum || visibleSignals.transferability);
  return (
    <div className={`flex flex-wrap items-center gap-3 px-4 py-3 transition-colors duration-[var(--ls-motion-fast)] ease-[var(--ls-ease-standard)] group sm:flex-nowrap ${isSelected ? 'bg-accent-glow' : 'hover:bg-surface-2'}`}>
      <button type="button" onClick={e => { e.stopPropagation(); onWatch(); }}
        className="w-16 h-10 rounded-lg overflow-hidden flex-shrink-0 border border-border bg-surface-2 relative group/thumb">
        <VideoThumbnail platform={video.platform} title={video.title} />
        {video.thumbnail && <ThumbnailImage src={video.thumbnail} platform={video.platform} title={video.title} className="absolute inset-0 w-full h-full object-cover" />}
        {video.videoUrl && <AuthenticatedVideo apiUrl={video.videoUrl} loadOnMount previewFrame preload="auto" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />}
        <span className="absolute inset-0 bg-black/35 opacity-0 group-hover/thumb:opacity-100 group-focus-within/thumb:opacity-100 transition-opacity duration-[var(--ls-motion-fast)] ease-[var(--ls-ease-standard)] flex items-center justify-center text-white">
          {isImagePost ? <Images size={13} /> : <Play size={13} fill="currentColor" />}
        </span>
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="platform-badge inline-flex items-center gap-1 ls-type-label-small" style={{ background: '#fff', color: 'var(--color-text-primary)' }}><SocialPlatformIcon platform={video.platform} size={12} />{meta.label}</span>
          {video.id.startsWith('material-') && <span className="rounded bg-green-100 px-1.5 py-0.5 ls-type-label-medium text-green-700">收藏 · 片段已分析</span>}
          <span className={`ls-type-label-medium ${trendColor}`}>{trendLabel}</span>
        </div>
        <p className="ls-type-title-small text-text-primary line-clamp-2" title={video.title}>{video.title}</p>
        {!video.id.startsWith('material-') && <p className="truncate ls-type-body-small text-text-muted">账号：{video.aiAnalysis?.author || video.aiAnalysis?.sourceAccountName || '未抓取'}</p>}
      </div>
      <span className="hidden xl:inline-flex flex-shrink-0 px-2 py-1 rounded-md ls-type-label-medium bg-surface-2 border border-border text-text-muted">
        {crawlRule}
      </span>
      {!video.id.startsWith('material-') && hasVisibleSignals && <span className="hidden 2xl:inline-flex shrink-0 gap-1 ls-type-label-medium" title={serverScore ? serverScore.reasons.join('；') : `来源优先 ${inspirationScores.sourcePriority}；内容机会 ${inspirationScores.contentOpportunityScore}`}>
        {serverScore && <span className={`rounded px-1.5 py-1 ${serverScore.decision === 'accepted' ? 'bg-emerald-100 text-emerald-900' : serverScore.decision === 'review' ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-800'}`}>{serverScore.overall} 分</span>}
        {visibleSignals.relevance && <span className="rounded bg-cyan-50 px-1.5 py-1 text-cyan-900">{visibleSignals.relevance}</span>}
        {visibleSignals.momentum && <span className="rounded bg-amber-50 px-1.5 py-1 text-amber-900">{visibleSignals.momentum}</span>}
        {visibleSignals.transferability && <span className="rounded bg-emerald-50 px-1.5 py-1 text-emerald-800">{visibleSignals.transferability}</span>}
      </span>}
      <div className="flex-shrink-0 text-right min-w-[52px]">
        <p className="ls-type-body-small tabular-nums text-text-secondary">{isImagePost ? '图文' : `${Math.floor(video.duration / 60)}:${String(video.duration % 60).padStart(2, '0')}`}</p>
        <p className="ls-type-body-small tabular-nums text-text-muted">{video.views}</p>
      </div>
      <div className="ml-auto flex w-full items-center justify-end gap-1.5 sm:ml-0 sm:w-auto">
        <Button type="primary" onClick={onCreate} loading={creating} disabled={createDisabled} title={createDisabled ? createDisabledReason : undefined}>{createLabel || '用此灵感创作'}</Button>
        <Button onClick={onSelect} icon={<Eye size={14} />}>查看详情</Button>
      </div>
      {!isImagePost && onFavoriteMaterial && (
        <button onClick={e => { e.stopPropagation(); onFavoriteMaterial?.(); }} disabled={favoritingMaterial}
          aria-label={isFavoriteMaterial ? `取消收藏 ${video.title}` : `收藏 ${video.title}`}
          title={isFavoriteMaterial ? '取消收藏' : '收藏到我的素材'}
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border transition-colors duration-[var(--ls-motion-fast)] ease-[var(--ls-ease-standard)] ${isFavoriteMaterial ? 'border-amber-300 bg-amber-50 text-amber-500' : 'border-border text-text-muted hover:border-amber-300 hover:text-amber-500'} disabled:cursor-wait disabled:opacity-60`}>
          {favoritingMaterial ? <Loader2 size={13} className="animate-spin" /> : <Star size={15} fill={isFavoriteMaterial ? 'currentColor' : 'none'} />}
        </button>
      )}
    </div>
  );
}
