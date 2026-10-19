import { useEffect, useRef, useState } from 'react';
import { CircleAlert, Loader2 } from 'lucide-react';
import { authHeader } from '../../lib/auth';
import { resolveInspirationPlaybackUrl } from '../../lib/inspirationVideoPlayback';

export function WorkbenchVideoPreview({ source, poster, title, seekSeconds, seekRequestId, onResolved, onPlaybackTime }: { source: string; poster?: string; title: string; seekSeconds?: number; seekRequestId?: number; onResolved?: (url: string) => void; onPlaybackTime?: (seconds: number) => void }) {
  const [attempt, setAttempt] = useState(0);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const playbackCallback = useRef(onPlaybackTime);
  playbackCallback.current = onPlaybackTime;

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video && !video.paused) playbackCallback.current?.(video.currentTime);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playbackUrl]);

  useEffect(() => {
    if (videoRef.current && Number.isFinite(seekSeconds)) {
      try { videoRef.current.currentTime = Math.max(0, seekSeconds || 0); } catch { /* metadata pending */ }
    }
  }, [seekSeconds, seekRequestId, playbackUrl]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    setPlaybackUrl('');
    setStatus('loading');
    setMessage('');
    void resolveInspirationPlaybackUrl(source, { signal: controller.signal, headers: authHeader() })
      .then(url => {
        if (controller.signal.aborted) return;
        setPlaybackUrl(url);
        onResolved?.(url);
      })
      .catch(error => {
        setMessage(controller.signal.aborted ? '视频地址获取超时，请重试'
          : error instanceof Error ? error.message : '视频地址获取失败');
        setStatus('error');
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [attempt, source]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-100">
      {poster && status !== 'ready' && <img src={poster} alt={`${title}封面`} className="absolute inset-0 h-full w-full object-contain" />}
      {playbackUrl && <video
        ref={videoRef}
        src={playbackUrl}
        poster={poster}
        controls
        playsInline
        preload="metadata"
        onTimeUpdate={event => onPlaybackTime?.(event.currentTarget.currentTime)}
        onSeeking={event => onPlaybackTime?.(event.currentTarget.currentTime)}
        onSeeked={event => onPlaybackTime?.(event.currentTarget.currentTime)}
        onLoadedMetadata={event => { if (seekSeconds) event.currentTarget.currentTime = seekSeconds; }}
        aria-label={title}
        className={`h-full w-full object-contain transition-opacity ${status === 'ready' ? 'opacity-100' : 'opacity-0'}`}
        onLoadedData={() => setStatus('ready')}
        onCanPlay={() => setStatus('ready')}
        onError={() => {
          setMessage('视频文件加载或解码失败，请重新获取播放地址');
          setStatus('error');
        }}
      />}
      {status === 'loading' && <div className="absolute inset-0 flex items-center justify-center bg-white/35 -[1px]"><span className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-2 text-xs font-bold text-[#38594d] shadow-none"><Loader2 size={14} className="animate-spin" />正在加载视频</span></div>}
      {status === 'error' && <div className="absolute inset-0 flex items-center justify-center bg-white/88 p-6 text-center "><div><CircleAlert size={24} className="mx-auto text-amber-700" /><p className="mt-2 text-sm font-semibold text-text-primary">视频暂时无法预览</p><p className="mt-1 max-w-sm text-[11px] leading-5 text-text-muted">{message}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-3 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white">重新加载</button></div></div>}
    </div>
  );
}
