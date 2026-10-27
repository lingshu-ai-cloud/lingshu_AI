import { formatMediaDuration } from '../lib/mediaDuration';
import { Button } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Eye, Images, Loader2, Pencil, Play, Star, Trash2 } from 'lucide-react';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import type { TrendVideo } from '../lib/inspirationTypes';
import { AuthenticatedVideo, ThumbnailImage, VideoThumbnail } from './inspiration/InspirationMedia';
import { imagePostAnalysisQueuePresentation } from './inspiration/imagePostAnalysisPresentation';
import { discoverySupplyLabel, getPlatformMeta } from './inspiration/inspirationVideoProjection';
import { LsMediaStateFrame } from './ui/LsExperiencePrimitives';

interface VideoCardProps {
  video: TrendVideo;
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

export function trendVideoAspectRatio(video: TrendVideo): number {
  const ratioText = String(video.aiAnalysis?.gemini?.globalSettings?.aspectRatio || '').trim();
  const match = ratioText.match(/(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)/);
  if (match) {
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width > 0 && height > 0) return width / height;
  }
  return 1;
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
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => { if (active) observer.observe(card); });
    });
    return () => { active = false; window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, [enabled, mediaKey]);
  return { cardRef, enabled, enable: () => setEnabledKey(mediaKey) };
}

const HIDDEN_DISCOVERY_TAGS = new Set(['来源待归类', '相关性待确认', '趋势未知', '迁移性待确认']);

export function VideoCard({ video, onSelect, onCreate, onWatch, onEditManage, onDeleteManage, onFavoriteMaterial, favoritingMaterial, isFavoriteMaterial, createLabel, creating, createDisabled, createDisabledReason }: VideoCardProps) {
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
  const supplyLabel = discoverySupplyLabel(video);
  const compactOverlay = mediaAspectRatio >= 1.25;
  const actionsOnlyOverlay = mediaAspectRatio >= 1.7;
  return (
    <article ref={media.cardRef} onFocusCapture={media.enable} onPointerEnter={media.enable}
      className="ls-viral-card group relative overflow-hidden rounded-lg border border-border bg-surface transition-colors duration-[var(--ls-motion-fast)] ease-[var(--ls-ease-standard)] hover:border-border-bright">
      <div
        className="relative block w-full overflow-hidden text-left"
        style={{ background: 'var(--color-surface-2)', aspectRatio: mediaAspectRatio > 0 ? mediaAspectRatio : 9 / 16 }}>
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
          onClick={event => { event.stopPropagation(); onWatch(); }}
          className="ls-touch-media-reveal absolute inset-0 z-10 flex items-center justify-center bg-black/25 opacity-0 transition-opacity duration-[var(--ls-motion-fast)] ease-[var(--ls-ease-standard)] group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-neutral-900 shadow-none" aria-hidden="true">
            {isImagePost ? <Images size={16} /> : <Play size={16} fill="currentColor" />}
          </span>
        </button>
        {!HIDDEN_DISCOVERY_TAGS.has(supplyLabel) && <span className="pointer-events-none absolute left-2 top-2 z-40 rounded-md border border-white/20 bg-black/65 px-2 py-1 text-xs font-medium text-white">
          {supplyLabel}
        </span>}
        {(onDeleteManage || (!isImagePost && onFavoriteMaterial)) && <div className="ls-touch-media-reveal absolute right-2 top-2 z-40 flex gap-1.5 opacity-0 transition-opacity duration-[var(--ls-motion-fast)] ease-[var(--ls-ease-standard)] group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
          {!isImagePost && onFavoriteMaterial && <Button size="small" shape="circle"
            icon={favoritingMaterial ? <Loader2 size={13} className="animate-spin"/> : <Star size={13} fill={isFavoriteMaterial ? 'currentColor' : 'none'}/>} onClick={onFavoriteMaterial} disabled={favoritingMaterial}
            title={isFavoriteMaterial ? '取消收藏' : '收藏'} aria-label={isFavoriteMaterial ? `取消收藏 ${video.title}` : `收藏 ${video.title}`}
            className="!border-white/25 !bg-black/65 !text-white hover:!bg-black/80" />}
          {onDeleteManage && <Button size="small" shape="circle" danger icon={<Trash2 size={13}/>} onClick={onDeleteManage}
            title="删除" aria-label={`删除 ${video.title}`} className="!border-white/25 !bg-black/65 !text-white hover:!bg-red-600" />}
        </div>}
        <div data-compact-overlay={compactOverlay || undefined} className={`ls-touch-media-reveal absolute inset-x-0 bottom-0 z-30 max-h-full overflow-hidden bg-gradient-to-t from-black/90 via-black/60 to-transparent text-white opacity-0 transition-opacity duration-[var(--ls-motion-fast)] ease-[var(--ls-ease-standard)] group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100 ${compactOverlay ? 'px-2 pb-2 pt-7' : 'px-3 pb-3 pt-10'}`}>
          {!compactOverlay && <p className="mb-1 inline-flex items-center gap-1.5 text-xs text-white/80"><SocialPlatformIcon platform={video.platform} size={13} />{meta.label}<span aria-hidden="true">·</span>{isImagePost ? '图文' : formatMediaDuration(video.duration)}</p>}
          {!compactOverlay && mediaState !== 'ready' && <p role="status" className="mb-1 text-xs text-white/80">{mediaState === 'error' ? '分析失败' : imageQueue?.label || analysisProgress?.stageLabel || '分析中'}</p>}
          {!actionsOnlyOverlay && <p className={`${compactOverlay ? 'line-clamp-1 text-xs' : 'line-clamp-2 text-sm'} font-semibold`} title={video.title}>{video.title}</p>}
          {!compactOverlay && <p className="mt-1 truncate text-xs text-white/80">{trendLabel} · {video.views} 次播放 · {video.aiAnalysis?.author || video.aiAnalysis?.sourceAccountName || '来源账号待获取'}</p>}
          <div className={`${compactOverlay ? 'mt-1 flex-nowrap' : 'mt-2 flex-wrap'} flex gap-1.5 overflow-hidden`}>
            <Button size="small" onClick={onSelect} icon={actionsOnlyOverlay ? undefined : <Eye size={13}/>} className={compactOverlay ? '!h-7 !px-2' : undefined}>{compactOverlay ? '详情' : '查看详情'}</Button>
            <Button size="small" type="primary" onClick={onCreate} loading={creating} disabled={createDisabled} title={createDisabled ? createDisabledReason : undefined} className={compactOverlay ? '!h-7 !px-2' : undefined}>{createLabel || (compactOverlay ? '裂变' : '爆款裂变')}</Button>
            {onEditManage && <Button size="small" onClick={onEditManage} icon={<Pencil size={13}/>} aria-label={`编辑 ${video.title}`} />}
          </div>
        </div>
      </div>
    </article>
  );
}
