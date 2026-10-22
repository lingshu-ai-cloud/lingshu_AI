import { useEffect, useRef, useState } from 'react';
import { SocialPlatformIcon } from '../SocialPlatformIcon';
import { LsProgressiveMedia } from '../ui/LsExperiencePrimitives';
import { authHeader } from '../../lib/auth';
import { resolveInspirationPlaybackUrl } from '../../lib/inspirationVideoPlayback';
import type { Platform } from '../../lib/inspirationTypes';

// ── Fallback thumbnail ────────────────────────────────────────────────────────
export function VideoThumbnail({ platform, title }: { platform: Exclude<Platform, 'all'>; title: string }) {
  const shortTitle = title.length > 86 ? `${title.slice(0, 83)}...` : title;
  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-text-primary p-4">
      <div className="absolute inset-x-0 bottom-0 h-px bg-white/20" />
      <div className="relative">
        <SocialPlatformIcon platform={platform} size={38} className="mb-3 drop-shadow-none" />
        <p className="line-clamp-3 text-sm font-semibold leading-snug text-white/90 drop-shadow-none">{shortTitle}</p>
      </div>
    </div>
  );
}

export function ThumbnailImage({
  src,
  platform,
  title,
  className,
  onNaturalAspectRatio,
}: {
  src: string;
  platform: Exclude<Platform, 'all'>;
  title: string;
  className: string;
  onNaturalAspectRatio?: (ratio: number) => void;
}) {
  const isDirectUrl = /^https?:\/\//i.test(src) || src.startsWith('/media/') || src.startsWith('blob:') || src.startsWith('data:');
  const [blobUrl, setBlobUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    setBlobUrl('');
    if (!src || isDirectUrl) return;
    const controller = new AbortController();
    let createdUrl = '';
    void fetch(src, { headers: authHeader(), cache: 'no-store', signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(String(response.status));
        return response.blob();
      })
      .then(blob => {
        if (controller.signal.aborted) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [src, isDirectUrl]);
  if (failed || !src) return null;
  const reportAspectRatio = (image: HTMLImageElement) => {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) onNaturalAspectRatio?.(image.naturalWidth / image.naturalHeight);
  };
  if (isDirectUrl) return <LsProgressiveMedia src={src} alt={`${title} · ${platform} 缩略图`} className={className} draggable={false} loading="lazy" preview={false} onLoad={event => reportAspectRatio(event.target as HTMLImageElement)} onError={() => setFailed(true)} />;
  return blobUrl ? <img src={blobUrl} alt={`${title} · ${platform} 缩略图`} className={className} draggable={false} loading="lazy" decoding="async" onLoad={event => reportAspectRatio(event.currentTarget)} onError={() => setFailed(true)} /> : null;
}

export function AuthenticatedImage({ src, alt, className, onReady, onError, onNaturalAspectRatio }: { src: string; alt: string; className: string; onReady?: () => void; onError?: () => void; onNaturalAspectRatio?: (ratio: number) => void }) {
  const isRemoteSignedUrl = /^https?:\/\//i.test(src);
  const [blobUrl, setBlobUrl] = useState('');
  useEffect(() => {
    // COS returns a time-limited signed HTTPS URL. Loading it directly avoids an
    // unnecessary Authorization header/CORS preflight that can leave cards blank.
    if (isRemoteSignedUrl) return;
    const controller = new AbortController();
    let createdUrl = '';
    setBlobUrl('');
    void fetch(src, { headers: authHeader(), cache: 'no-store', signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(String(response.status));
        return response.blob();
      })
      .then(blob => {
        if (controller.signal.aborted) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch(() => { if (!controller.signal.aborted) onError?.(); });
    return () => {
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [src, isRemoteSignedUrl]);
  const reportReady = (image: HTMLImageElement) => {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) onNaturalAspectRatio?.(image.naturalWidth / image.naturalHeight);
    onReady?.();
  };
  if (isRemoteSignedUrl) return <LsProgressiveMedia src={src} alt={alt} className={className} decoding="async" preview={false} onLoad={event => reportReady(event.target as HTMLImageElement)} onError={onError} />;
  return blobUrl
    ? <img src={blobUrl} alt={alt} className={className} decoding="async" onLoad={event => reportReady(event.currentTarget)} onError={onError} />
    : <div className={`${className} bg-surface-2`} aria-label={alt} />;
}

export function AuthenticatedVideo({ apiUrl, poster, className, controls = false, autoPlay = false, loadOnMount = autoPlay, hoverPlay = false, previewFrame = false, preload = previewFrame ? 'auto' : 'metadata', onReady, onError, onLoadingChange, onMetadata }: { apiUrl: string; poster?: string; className: string; controls?: boolean; autoPlay?: boolean; loadOnMount?: boolean; hoverPlay?: boolean; previewFrame?: boolean; preload?: 'none' | 'metadata' | 'auto'; onReady?: () => void; onError?: (message?: string) => void; onLoadingChange?: (loading: boolean) => void; onMetadata?: (metadata: { width: number; height: number; duration: number }) => void }) {
  const [playbackUrl, setPlaybackUrl] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestRef = useRef<Promise<string> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const mediaRetryRef = useRef(0);
  const mediaReadyTimerRef = useRef<number | null>(null);
  const readyReportedRef = useRef(false);

  const clearMediaReadyTimer = () => {
    if (mediaReadyTimerRef.current === null) return;
    window.clearTimeout(mediaReadyTimerRef.current);
    mediaReadyTimerRef.current = null;
  };

  const reportMediaReady = () => {
    clearMediaReadyTimer();
    mediaRetryRef.current = 0;
    onLoadingChange?.(false);
    if (readyReportedRef.current) return;
    readyReportedRef.current = true;
    onReady?.();
  };

  const load = async (force = false) => {
    if (playbackUrl && !force) return playbackUrl;
    if (requestRef.current && !force) return requestRef.current;
    if (force) controllerRef.current?.abort();
    const generation = ++generationRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    onLoadingChange?.(true);
    let resolverTimedOut = false;
    const resolverTimer = window.setTimeout(() => {
      resolverTimedOut = true;
      controller.abort();
    }, 15_000);
    const request = resolveInspirationPlaybackUrl(apiUrl, { signal: controller.signal, headers: authHeader() })
      .then(next => {
        if (generation === generationRef.current) {
          setPlaybackUrl(next);
          clearMediaReadyTimer();
          mediaReadyTimerRef.current = window.setTimeout(() => {
            if (generation !== generationRef.current || (videoRef.current?.readyState || 0) >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
            onLoadingChange?.(false);
            onError?.('视频加载超时，请重新获取播放地址');
          }, 20_000);
        }
        return next;
      })
      .catch(error => {
        if ((!resolverTimedOut && controller.signal.aborted) || generation !== generationRef.current) return '';
        const message = resolverTimedOut ? '视频地址获取超时' : error instanceof Error ? error.message : '视频地址获取失败';
        onLoadingChange?.(false);
        onError?.(message);
        return '';
      })
      .finally(() => {
        window.clearTimeout(resolverTimer);
        if (generation !== generationRef.current) return;
        requestRef.current = null;
      });
    requestRef.current = request;
    return request;
  };
  useEffect(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    requestRef.current = null;
    mediaRetryRef.current = 0;
    readyReportedRef.current = false;
    clearMediaReadyTimer();
    setPlaybackUrl('');
    onLoadingChange?.(false);
    if (loadOnMount) void load(true);
    return () => {
      generationRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      requestRef.current = null;
      clearMediaReadyTimer();
    };
  }, [apiUrl, loadOnMount]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (autoPlay && playbackUrl) void videoRef.current?.play().catch(() => {}); }, [autoPlay, playbackUrl]);
  return <video ref={videoRef} src={playbackUrl || undefined} poster={poster} controls={controls} autoPlay={autoPlay} muted={!controls} playsInline loop={hoverPlay} preload={preload} className={className}
    onLoadedMetadata={() => {
      const video = videoRef.current;
      if (video) onMetadata?.({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
      // Safari can paint a playable frame while delaying loadeddata/canplay.
      // A controls-based preview is already useful once metadata is available,
      // so do not leave the loading state over visible media.
      if (controls) reportMediaReady();
      if (!previewFrame || !video || !Number.isFinite(video.duration) || video.duration <= 0) return;
      // A tiny seek paints a reliable first frame for uploaded MP4s whose frame
      // at 0s is transparent/black and which do not yet have a poster asset.
      video.currentTime = Math.min(0.12, Math.max(0.01, video.duration / 20));
    }}
    onLoadedData={() => { if (previewFrame) videoRef.current?.pause(); reportMediaReady(); }}
    onCanPlay={reportMediaReady}
    onPlaying={reportMediaReady}
    onError={() => {
      if (!playbackUrl) return;
      clearMediaReadyTimer();
      if (mediaRetryRef.current < 1) {
        mediaRetryRef.current += 1;
        setPlaybackUrl('');
        void load(true);
        return;
      }
      onError?.('视频文件加载或解码失败');
    }}
    onMouseEnter={async () => { if (!hoverPlay) return; await load(); setTimeout(() => void videoRef.current?.play().catch(() => {}), 0); }}
    onMouseLeave={() => { if (!hoverPlay || !videoRef.current) return; videoRef.current.pause(); videoRef.current.currentTime = 0; }} />;
}
