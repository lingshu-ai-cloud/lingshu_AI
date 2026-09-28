import { useEffect, useRef, useState } from 'react';
import { authHeader } from '../../lib/auth';
import { resolveInspirationPlaybackUrl } from '../../lib/inspirationVideoPlayback';

const frameCache = new Map<string, string>();
/** Every shot shows its own frame; decoding is deferred until the card is near the viewport. */
export function StoryboardFirstFrame({ source, firstFrameRef, time, label, className = 'h-16 w-12', imageUrl }: {
  source?: string; firstFrameRef?: string; time: number; label: string; className?: string; imageUrl?: string;
}) {
  const container = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [frameUrl, setFrameUrl] = useState('');
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const key = `${source || ''}:${Math.max(0, time).toFixed(3)}`;
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '160px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    let objectUrl = '';
    setFrameUrl(imageUrl || frameCache.get(key) || ''); setPlaybackUrl(''); setFailed(false);
    if (imageUrl || frameCache.has(key)) return;
    const videoFallback = async () => {
      if (!source) { setFailed(true); return; }
      try {
        const url = await resolveInspirationPlaybackUrl(source, { signal: controller.signal, headers: authHeader() });
        if (!controller.signal.aborted) setPlaybackUrl(url);
      } catch { if (!controller.signal.aborted) setFailed(true); }
    };
    if (firstFrameRef) {
      const sameOrigin = new URL(firstFrameRef, window.location.href).origin === window.location.origin;
      void fetch(firstFrameRef, { headers: sameOrigin ? authHeader() : undefined, signal: controller.signal })
        .then(response => { if (!response.ok) throw new Error(String(response.status)); return response.blob(); })
        .then(blob => { if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setFrameUrl(objectUrl); } })
        .catch(() => { if (!controller.signal.aborted) void videoFallback(); });
    } else void videoFallback();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [visible, source, firstFrameRef, imageUrl, key]);
  const capture = (video: HTMLVideoElement) => {
    video.pause();
    if (!video.videoWidth) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 180; canvas.height = Math.max(1, Math.round(180 * video.videoHeight / video.videoWidth));
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/jpeg', .8);
      if (frameCache.size >= 256) frameCache.delete(frameCache.keys().next().value!);
      frameCache.set(key, url); setFrameUrl(url); setPlaybackUrl('');
    } catch { /* Cross-origin video may still display its decoded frame without canvas access. */ }
  };
  return <span ref={container} className={`relative block shrink-0 overflow-hidden rounded-md bg-slate-900 ${className}`}>
    {frameUrl ? <img src={frameUrl} alt={`${label}首帧`} className="h-full w-full object-contain" onError={() => { setFrameUrl(''); if (source) void resolveInspirationPlaybackUrl(source, { headers: authHeader() }).then(setPlaybackUrl).catch(() => setFailed(true)); else setFailed(true); }} />
      : playbackUrl ? <video src={playbackUrl} muted playsInline preload="auto" aria-label={`${label}首帧`} onError={() => { setFailed(true); setPlaybackUrl(''); }} onLoadedMetadata={event => {
        const video = event.currentTarget;
        video.currentTime = Math.min(Math.max(0, time + .01), Math.max(0, (Number.isFinite(video.duration) ? video.duration : time + 1) - .01));
      }} onSeeked={event => capture(event.currentTarget)} className="h-full w-full object-contain" />
      : <span role="status" className="flex h-full items-center justify-center px-1 text-center text-[9px] text-white/70">{failed ? '首帧暂不可用' : '正在提取首帧'}</span>}
  </span>;
}
