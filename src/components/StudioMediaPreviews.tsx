import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Music } from 'lucide-react';
import type { CoverStyle, StudioProject } from '../lib/studioApi';
import type { Clip } from './AiCreateStudio';
import { fontCss } from './AiCreateStudio';

export function Thumb({ seed: _seed, label, ratio = 'aspect-video', src }: { seed: string; label?: string; ratio?: string; src?: string }) {
  const fallbackSrc = src;
  if (fallbackSrc) {
    return (
      <div className={`relative w-full ${ratio} overflow-hidden rounded-lg bg-surface-2`}>
        <img src={fallbackSrc} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
        {label && (
          <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-white bg-black/45">{label}</span>
        )}
      </div>
    );
  }
  return (
    <div className={`relative flex w-full ${ratio} items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-100 text-slate-400`}>
      <div className="flex flex-col items-center gap-1">
        <ImageIcon size={20} aria-hidden="true" />
        <span className="text-[9px] font-semibold">预览不可用</span>
      </div>
      {label && (
        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-white bg-black/45">
          {label}
        </span>
      )}
    </div>
  );
}

export function FirstVideoFrameThumb({ clip }: { clip: Clip }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setReady(false);
    setFailed(false);
  }, [clip.id, clip.url]);

  if (!clip.url || failed) return <Thumb seed={clip.id} ratio="aspect-video" />;
  return (
    <div className="relative w-full aspect-video overflow-hidden rounded-lg bg-surface-2">
      {!ready && <div className="absolute inset-0 animate-pulse bg-slate-200" />}
      <video
        ref={videoRef}
        src={clip.url}
        muted
        playsInline
        preload="auto"
        className={`absolute inset-0 h-full w-full object-cover ${ready ? 'opacity-100' : 'opacity-0'}`}
        onLoadedData={() => {
          const video = videoRef.current;
          if (!video) return;
          const target = Number.isFinite(video.duration) && video.duration > 0
            ? Math.min(0.05, video.duration / 2)
            : 0;
          if (target <= 0) { setReady(true); return; }
          try { video.currentTime = target; } catch { setReady(true); }
        }}
        onSeeked={() => setReady(true)}
        onError={() => { setReady(true); setFailed(true); }}
      />
    </div>
  );
}

export function ProjectFirstFrameThumb({ project, materials }: { project: StudioProject; materials: Clip[] }) {
  const spec = project.spec || {};
  const assemblies = Array.isArray(spec.storyboardAssemblies)
    ? spec.storyboardAssemblies as Array<{ id?: string; assignments?: Record<string, string>; selected?: string[] }>
    : [];
  const activeAssemblyId = typeof spec.activeAssemblyId === 'string' ? spec.activeAssemblyId : '';
  const assembly = assemblies.find(item => item.id === activeAssemblyId) || assemblies[0];
  const legacyAssignments = spec.storyboardAssignments && typeof spec.storyboardAssignments === 'object'
    ? spec.storyboardAssignments as Record<string, string>
    : {};
  const legacySelected = Array.isArray(spec.selected) ? spec.selected.filter((id): id is string => typeof id === 'string') : [];
  const firstMaterialId = [
    ...Object.values(assembly?.assignments || {}),
    ...(assembly?.selected || []),
    ...Object.values(legacyAssignments),
    ...legacySelected,
  ].find(Boolean);
  const clip = firstMaterialId ? materials.find(item => item.id === firstMaterialId) : undefined;

  if (!clip) return <Thumb seed={project.thumbSeed ?? firstMaterialId ?? 'cv1'} ratio="aspect-video" />;
  if (clip.poster || clip.type === 'image') {
    return <Thumb seed={clip.id} ratio="aspect-video" src={clip.poster || clip.url} />;
  }
  if (clip.type === 'video') return <FirstVideoFrameThumb clip={clip} />;
  return <Thumb seed={clip.id} ratio="aspect-video" />;
}

const VIDEO_THUMB_CACHE = new Map<string, string>();

/* 真实素材的缩略图：优先服务端 poster；缺失/失效时在浏览器取约 1 秒处画面并缓存。 */
export function RealThumb({ clip, onSourceError }: { clip: Clip; onSourceError?: () => void }) {
  const label = clip.type === 'image' ? 'IMG' : `0:${String(clip.duration).padStart(2, '0')}`;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [posterFailed, setPosterFailed] = useState(false);
  const [capturedPoster, setCapturedPoster] = useState(() => VIDEO_THUMB_CACHE.get(clip.id) || '');
  const [frameReady, setFrameReady] = useState(false);

  useEffect(() => {
    setPosterFailed(false);
    setCapturedPoster(VIDEO_THUMB_CACHE.get(clip.id) || '');
    setFrameReady(false);
  }, [clip.id, clip.poster, clip.url]);

  const seekThumbnailFrame = () => {
    const video = videoRef.current;
    if (!video) return;
    const videoDuration = Number.isFinite(video.duration) ? video.duration : Number(clip.duration || 0);
    const target = Math.max(0.05, Math.min(1, videoDuration > 0 ? videoDuration * 0.2 : 1));
    try { video.currentTime = target; } catch { setFrameReady(true); }
  };
  const captureThumbnailFrame = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    setFrameReady(true);
    try {
      const width = 480;
      const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(video, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.76);
      VIDEO_THUMB_CACHE.set(clip.id, dataUrl);
      setCapturedPoster(dataUrl);
    } catch {
      // 即使浏览器禁止 canvas 抽帧，已 seek 的 video 元素仍可直接显示该帧。
    }
  };
  const useServerPoster = Boolean(clip.poster && !posterFailed);
  return (
    <div className="relative w-full aspect-video overflow-hidden rounded-lg bg-surface-2">
      {clip.type === 'image' && (
        <img src={clip.url} alt={clip.name} className="w-full h-full object-cover" loading="lazy" onError={() => { setPosterFailed(true); onSourceError?.(); }} />
      )}
      {clip.type === 'video' && (
        <>
          {useServerPoster && (
            <img
              src={clip.poster}
              alt={clip.name}
              className="absolute inset-0 h-full w-full object-cover"
              loading="eager"
              draggable={false}
              onError={() => { setPosterFailed(true); onSourceError?.(); }}
            />
          )}
          {!useServerPoster && (capturedPoster
            ? <img src={capturedPoster} alt={clip.name} className="h-full w-full object-cover" draggable={false} />
            : <>
                {!frameReady && <div className="absolute inset-0 animate-pulse bg-slate-200" />}
                <video
                  ref={videoRef}
                  src={clip.url}
                  muted
                  playsInline
                  preload="metadata"
                  className={`h-full w-full object-cover transition-opacity ${frameReady ? 'opacity-100' : 'opacity-0'}`}
                  onLoadedMetadata={seekThumbnailFrame}
                  onLoadedData={seekThumbnailFrame}
                  onSeeked={captureThumbnailFrame}
                  onError={() => { setFrameReady(true); onSourceError?.(); }}
                />
              </>)}
        </>
      )}
      {clip.type === 'audio' && (
        <div className="w-full h-full flex items-center justify-center"><Music size={20} className="text-text-muted" /></div>
      )}
      <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-white bg-black/45">{label}</span>
    </div>
  );
}

/* 封面预览：优先用已生成的封面 SVG；否则用所选帧 + 标题叠层。
   字号用 cqw（容器宽度百分比）与 SVG 的 fontSize 比例一致，预览即所见。 */
const WEIGHT_MAP = { regular: 600, bold: 800, heavy: 900 } as const;
export function coverArtCss(style: CoverStyle): React.CSSProperties {
  switch (style.artPreset) {
    case 'outline':
      return { WebkitTextStroke: '0.08em #111827', paintOrder: 'stroke fill', textShadow: '0 0.08em 0 rgba(0,0,0,.7)' };
    case 'highlight':
      return { background: '#facc15', color: '#111827', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone', padding: '0.08em 0.18em', borderRadius: '0.12em', lineHeight: 1.18 };
    case 'magazine':
      return { textTransform: 'uppercase', letterSpacing: '-0.045em', fontStyle: 'italic', textShadow: '0.06em 0.06em 0 #ef4444' };
    case 'neon':
      return { color: '#fff', textShadow: `0 0 0.08em #fff, 0 0 0.22em ${style.color}, 0 0 0.45em ${style.color}` };
    case 'sticker':
      return { color: '#111827', WebkitTextStroke: '0.14em #fff', paintOrder: 'stroke fill', textShadow: '0.13em 0.13em 0 #16a34a' };
    default:
      return {};
  }
}

/** 视频元素本身不会保证在静止状态绘出首帧；主动 seek 后转成 JPEG，供封面预览和最终 SVG 共用。 */
export function VideoCoverStill({ src, onFrameReady, onSourceError }: { src: string; onFrameReady?: (dataUrl: string) => void; onSourceError?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const callbackRef = useRef(onFrameReady);
  const [still, setStill] = useState<string>();
  callbackRef.current = onFrameReady;

  useEffect(() => setStill(undefined), [src]);

  const seekToFrame = () => {
    const video = videoRef.current;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    video.currentTime = Math.min(duration > 0.3 ? 0.2 : 0, Math.max(0, duration - 0.05));
  };
  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    try {
      const canvas = document.createElement('canvas');
      const maxWidth = 1080;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
      setStill(dataUrl);
      callbackRef.current?.(dataUrl);
    } catch {
      // 跨域或解码异常时保留已 seek 的 video 画面，不让候选卡退回空白。
    }
  };

  return (
    <>
      {still && <img src={still} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      <video ref={videoRef} src={src} muted playsInline preload="auto"
        onLoadedMetadata={seekToFrame} onLoadedData={captureFrame} onSeeked={captureFrame}
        onError={onSourceError}
        className={`absolute inset-0 h-full w-full object-cover ${still ? 'invisible' : ''}`} />
    </>
  );
}

export function CoverFrameMedia({ frameUrl, frameType, fallbackVideoUrl, onFrameReady, onSourceError }: { frameUrl?: string; frameType?: Clip['type']; fallbackVideoUrl?: string; onFrameReady?: (dataUrl: string) => void; onSourceError?: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [failedVideos, setFailedVideos] = useState<string[]>([]);
  const refreshRequestedRef = useRef('');
  useEffect(() => {
    setImageFailed(false);
    setFailedVideos([]);
    refreshRequestedRef.current = '';
  }, [frameUrl, fallbackVideoUrl]);
  const reportSourceError = (source?: string) => {
    if (!source || refreshRequestedRef.current === source) return;
    refreshRequestedRef.current = source;
    onSourceError?.();
  };
  if (frameUrl && frameType === 'video' && !failedVideos.includes(frameUrl)) return <VideoCoverStill src={frameUrl} onFrameReady={onFrameReady} onSourceError={() => { setFailedVideos(prev => [...prev, frameUrl]); reportSourceError(frameUrl); }} />;
  if (frameUrl && frameType !== 'video' && !imageFailed) return <img src={frameUrl} alt="" className="absolute inset-0 h-full w-full object-cover" onError={() => { setImageFailed(true); reportSourceError(frameUrl); }} />;
  if (fallbackVideoUrl && !failedVideos.includes(fallbackVideoUrl)) return <VideoCoverStill src={fallbackVideoUrl} onFrameReady={onFrameReady} onSourceError={() => { setFailedVideos(prev => [...prev, fallbackVideoUrl]); reportSourceError(fallbackVideoUrl); }} />;
  return <div className="absolute inset-0 flex items-center justify-center bg-surface-2 text-xs font-semibold text-text-muted">封面加载失败，请重新选择素材</div>;
}

export function CoverFace({ coverUrl, frameUrl, frameType, fallbackVideoUrl, title, style, editable, onTitleChange, onStyleChange, onFrameReady, onSourceError }: { coverUrl?: string | null; frameUrl?: string; frameType?: Clip['type']; fallbackVideoUrl?: string; title: string; style: CoverStyle; editable?: boolean; onTitleChange?: (t: string) => void; onStyleChange?: (style: CoverStyle) => void; onFrameReady?: (dataUrl: string) => void; onSourceError?: () => void }) {
  const dragRef = useRef<{ pointerId: number; startY: number; startPosition: number; height: number } | null>(null);
  const [failedCover, setFailedCover] = useState<string | null>(null);
  useEffect(() => setFailedCover(null), [coverUrl]);
  if (coverUrl && failedCover !== coverUrl) return <img src={coverUrl} alt="封面" className="absolute inset-0 w-full h-full object-cover" onError={() => { setFailedCover(coverUrl); onSourceError?.(); }} />;
  const verticalPosition = style.verticalPosition ?? (style.position === 'top' ? 14 : style.position === 'center' ? 50 : 86);
  const cqw = style.size === 'S' ? 6.2 : style.size === 'L' ? 9.8 : 7.8;
  const scrimPosition = verticalPosition < 34 ? 'top' : verticalPosition > 66 ? 'bottom' : 'center';
  const scrim = scrimPosition === 'top'
    ? 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent 52%)'
    : scrimPosition === 'center'
      ? 'rgba(0,0,0,0.3)'
      : 'linear-gradient(to top, rgba(0,0,0,0.6), transparent 52%)';
  const titleStyle: React.CSSProperties = {
    width: '100%', color: style.color, fontSize: `${cqw}cqw`,
    fontWeight: WEIGHT_MAP[style.weight ?? 'bold'],
    textAlign: style.align, fontFamily: style.fontFamily ?? fontCss(style.font),
    ...coverArtCss(style),
  };
	  const startTitleDrag = (event: React.PointerEvent<HTMLDivElement>) => {
	    if (!editable || !onStyleChange) return;
	    event.stopPropagation();
	    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
	    if (!bounds?.height) return;
	    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startPosition: verticalPosition, height: bounds.height };
	    event.currentTarget.setPointerCapture(event.pointerId);
	  };
	  const moveTitle = (event: React.PointerEvent<HTMLDivElement>) => {
	    const drag = dragRef.current;
	    if (!drag || drag.pointerId !== event.pointerId || !onStyleChange) return;
	    const next = Math.max(8, Math.min(92, drag.startPosition + ((event.clientY - drag.startY) / drag.height) * 100));
	    onStyleChange({
	      ...style,
	      position: next < 34 ? 'top' : next > 66 ? 'bottom' : 'center',
	      verticalPosition: Math.round(next * 10) / 10,
	    });
	  };
	  const stopTitleDrag = (event: React.PointerEvent<HTMLDivElement>) => {
	    if (dragRef.current?.pointerId !== event.pointerId) return;
	    dragRef.current = null;
	    event.currentTarget.releasePointerCapture(event.pointerId);
	  };
	  return (
	    <div className="absolute inset-0" style={{ containerType: 'inline-size' }}>
	      <CoverFrameMedia frameUrl={frameUrl} frameType={frameType} fallbackVideoUrl={fallbackVideoUrl} onFrameReady={onFrameReady} onSourceError={onSourceError} />
      <div className="pointer-events-none absolute inset-0" style={{ background: scrim }} />
      <div
        className={`absolute inset-x-[5cqw] -translate-y-1/2 ${editable ? 'pointer-events-auto cursor-ns-resize touch-none select-none' : ''}`}
        style={{ top: `${verticalPosition}%` }}
        onPointerDown={startTitleDrag}
        onPointerMove={moveTitle}
        onPointerUp={stopTitleDrag}
        onPointerCancel={stopTitleDrag}
        title={editable ? '上下拖动可批量调整所有封面的标题位置；点击文字可编辑' : undefined}
      >
        {editable ? (
          // 直接在封面上唤起文本框编辑标题（失焦提交）
          <p contentEditable suppressContentEditableWarning spellCheck={false}
            onClick={e => e.stopPropagation()}
            onBlur={e => onTitleChange?.(e.currentTarget.textContent ?? '')}
            className="leading-tight outline-none rounded-[1cqw]"
            style={{ ...titleStyle, boxShadow: '0 0 0 0.4cqw rgba(255,255,255,0.55)' }}>
            {title}
          </p>
        ) : (
          <p className="leading-tight" style={titleStyle}>{title}</p>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */
