import { useEffect, useRef, useState } from 'react';
import type { StudioProject } from '../../lib/studioApi';
import { creationHistoryCoverSources } from '../../lib/creationHistoryCover';
import { authHeader } from '../../lib/auth';
import { resolveInspirationPlaybackUrl } from '../../lib/inspirationVideoPlayback';

export default function CreationHistoryCover({ project, className = 'h-16 w-24', firstFrameRef }: { project: StudioProject; className?: string; firstFrameRef?: string }) {
  const container = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [url, setUrl] = useState('');
  const [captured, setCaptured] = useState('');
  const candidates = creationHistoryCoverSources(project.spec, firstFrameRef);
  const candidate = candidates[index];
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '160px' });
    observer.observe(node); return () => observer.disconnect();
  }, []);
  useEffect(() => { setIndex(0); }, [project.id, project.spec, firstFrameRef]);
  useEffect(() => {
    setUrl(''); setCaptured('');
    if (!visible || !candidate) return;
    const controller = new AbortController(); let objectUrl = '';
    const load = async () => {
      if (candidate.kind === 'video') return resolveInspirationPlaybackUrl(candidate.url, { signal: controller.signal, headers: authHeader() });
      const sameOrigin = new URL(candidate.url, window.location.href).origin === window.location.origin;
      if (!sameOrigin) return candidate.url;
      const response = await fetch(candidate.url, { headers: authHeader(), credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      if (controller.signal.aborted) throw new Error('aborted');
      objectUrl = URL.createObjectURL(blob); return objectUrl;
    };
    void load().then(value => { if (!controller.signal.aborted) setUrl(value); }).catch(() => { if (!controller.signal.aborted) setIndex(value => value + 1); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [visible, candidate?.url, candidate?.kind, project.id]);
  const next = () => { setUrl(''); setCaptured(''); setIndex(value => value + 1); };
  const capture = (video: HTMLVideoElement) => {
    video.pause();
    if (!video.videoWidth || !video.videoHeight) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 240; canvas.height = Math.max(1, Math.round(240 * video.videoHeight / video.videoWidth));
      const context = canvas.getContext('2d'); if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      setCaptured(canvas.toDataURL('image/jpeg', .85));
    } catch { /* A decoded cross-origin video frame remains visible when canvas access is blocked. */ }
  };
  return <span ref={container} className={`relative block shrink-0 overflow-hidden rounded-lg bg-slate-900 ${className}`}>
    {captured || url && candidate?.kind === 'image' ? <img src={captured || url} alt={`${project.title}首帧封面`} onError={next} className="h-full w-full object-cover" />
      : url && candidate?.kind === 'video' ? <video src={url} muted playsInline preload="auto" aria-label={`${project.title}首帧封面`} onError={next} onSeeked={event => capture(event.currentTarget)} onLoadedMetadata={event => { const video = event.currentTarget; video.pause(); video.currentTime = Math.min(.01, Number.isFinite(video.duration) ? Math.max(0, video.duration - .01) : .01); }} className="pointer-events-none h-full w-full object-cover" />
      : <span className="flex h-full items-center justify-center text-[10px] text-white/70">{candidate ? '正在提取首帧' : '首帧暂不可用'}</span>}
  </span>;
}
