import { Button, Spin } from 'antd';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { AuthenticatedImage } from './InspirationMedia';

/** A collected image post may have several source images; the card thumbnail is only a fallback. */
export function inspirationImageSources(video: TrendVideo): string[] {
  const raw = video.aiAnalysis?.imageUrls;
  const images = (Array.isArray(raw) ? raw : []).filter((url): url is string => typeof url === 'string' && Boolean(url.trim())).map(url => url.trim());
  return images.length ? [...new Set(images)] : video.thumbnail ? [video.thumbnail] : [];
}

export function imagePreviewGesture(dx: number, dy: number): 'previous' | 'next' | 'post' | null {
  if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'next' : 'previous';
  if (Math.abs(dy) >= 72 && Math.abs(dy) > Math.abs(dx)) return 'post';
  return null;
}

export default function InspirationImagePreview({ video, onSwipePost }: { video: TrendVideo; onSwipePost?: (delta: number) => void }) {
  const images = inspirationImageSources(video);
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [fallback, setFallback] = useState(false);
  const pointerStart = useRef<{ id: number; x: number; y: number } | null>(null);
  const current = images[index];
  const fallbackUrl = index === 0 && video.thumbnail && video.thumbnail !== current ? video.thumbnail : '';
  const src = fallback && fallbackUrl ? fallbackUrl : current;
  const changeImage = (next: number) => { setIndex(next); setFallback(false); setStatus('loading'); setAttempt(value => value + 1); };
  const moveImage = (direction: -1 | 1) => { const next = index + direction; if (next >= 0 && next < images.length) changeImage(next); };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('button, a')) return;
    pointerStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    const gesture = imagePreviewGesture(dx, dy);
    if (gesture === 'next' || gesture === 'previous') moveImage(gesture === 'next' ? 1 : -1);
    else if (gesture === 'post') onSwipePost?.(-dy);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, a')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); moveImage(event.key === 'ArrowLeft' ? -1 : 1); }
  };
  const arrowClass = 'absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border-0 bg-black/50 text-white opacity-0 transition-opacity duration-150 hover:bg-black/70 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white group-hover:opacity-100 disabled:invisible motion-reduce:transition-none [@media(hover:none)]:opacity-100';
  return <div className="group relative flex h-full w-full items-center justify-center" role="group" tabIndex={0} aria-label="图片内容预览，可左右滑动或按左右方向键切换"
    style={{ touchAction: 'none' }} onDragStart={event => event.preventDefault()} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { pointerStart.current = null; }} onKeyDown={onKeyDown}>
    {src && <AuthenticatedImage key={`${src}:${attempt}`} src={src} alt={`${video.title}，图片 ${index + 1} / ${images.length}`}
      className="max-h-[68dvh] w-full object-contain" onReady={() => setStatus('ready')}
      onError={() => { if (!fallback && fallbackUrl) setFallback(true); else setStatus('error'); }}/>}
    {src && status === 'loading' && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 text-white"><Spin size="small"/><span className="ml-2">正在加载图片…</span></div>}
    {(!src || status === 'error') && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center text-white">
      <p>{src ? '图片暂时无法加载，可重试或从原站查看。' : '未采集到可查看的图片，可从原站查看。'}</p>
      {src && <Button onClick={() => { setFallback(false); setStatus('loading'); setAttempt(value => value + 1); }}>重新加载</Button>}
    </div>}
    {images.length > 1 && <>
      <button type="button" className={`${arrowClass} left-3`} disabled={index === 0} aria-label="上一张图片" onClick={() => moveImage(-1)}><ChevronLeft size={24} aria-hidden="true"/></button>
      <button type="button" className={`${arrowClass} right-3`} disabled={index === images.length - 1} aria-label="下一张图片" onClick={() => moveImage(1)}><ChevronRight size={24} aria-hidden="true"/></button>
      <span aria-live="polite" className="pointer-events-none absolute bottom-3 rounded-full bg-black/70 px-3 py-1 text-sm text-white">{index + 1} / {images.length}</span>
    </>}
  </div>;
}
