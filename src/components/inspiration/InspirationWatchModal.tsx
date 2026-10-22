import { useState } from 'react';
import { Button, Modal } from 'antd';
import { Loader2, Play } from 'lucide-react';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { AuthenticatedVideo } from './InspirationMedia';
import { PLATFORM_META } from './inspirationVideoProjection';
import { SocialPlatformIcon } from '../SocialPlatformIcon';

export function sourceEmbedUrl(video: TrendVideo): string {
  const source = String(video.sourceUrl || '').trim();
  if (!source) return '';
  try {
    const url = new URL(source);
    if (video.platform === 'youtube') {
      const id = url.hostname.includes('youtu.be')
        ? url.pathname.split('/').filter(Boolean)[0]
        : url.searchParams.get('v') || url.pathname.match(/\/(?:shorts|embed)\/([^/?#]+)/)?.[1];
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0` : '';
    }
    if (video.platform === 'tiktok') {
      const id = url.pathname.match(/\/video\/(\d+)/)?.[1];
      return id ? `https://www.tiktok.com/player/v1/${id}?autoplay=1` : '';
    }
    if (video.platform === 'instagram' && /\/(?:reel|p|tv)\//i.test(url.pathname)) {
      return `${source.replace(/[?#].*$/, '').replace(/\/$/, '')}/embed/`;
    }
  } catch { /* malformed URLs fall back to the original-site action */ }
  return '';
}

export function WatchModal({ video, onClose }: { video: TrendVideo; onClose: () => void }) {
  const embedUrl = sourceEmbedUrl(video);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(Boolean(video.videoUrl));
  const [previewError, setPreviewError] = useState('');
  const [useEmbedPlayer, setUseEmbedPlayer] = useState(false);
  const retryPreview = () => {
    setPreviewError('');
    setPreviewLoading(Boolean(video.videoUrl));
    setUseEmbedPlayer(false);
    setPreviewAttempt(value => value + 1);
  };
  return (
    <Modal open title={video.title} width={840} zIndex={2200} onCancel={onClose}
      footer={<div className="flex justify-end gap-2">{video.sourceUrl && <Button onClick={() => window.open(video.sourceUrl, '_blank', 'noopener,noreferrer')}>原站打开</Button>}<Button onClick={onClose}>关闭</Button></div>}>
      <p className="mb-3 flex items-center gap-2 text-xs text-text-secondary"><SocialPlatformIcon platform={video.platform} size={14}/>{PLATFORM_META[video.platform]?.label ?? video.platform} · 视频预览</p>
        <div className="bg-black">
          {video.videoUrl && !useEmbedPlayer ? (
            <div className="relative flex min-h-64 items-center justify-center bg-black">
              <AuthenticatedVideo
                key={`${video.id}:${previewAttempt}`}
                apiUrl={video.videoUrl}
                poster={video.thumbnail}
                controls
                autoPlay
                className="max-h-[72vh] w-full bg-black"
                onReady={() => { setPreviewLoading(false); setPreviewError(''); }}
                onLoadingChange={setPreviewLoading}
                onError={message => {
                  setPreviewLoading(false);
                  if (embedUrl) {
                    setPreviewError('');
                    setUseEmbedPlayer(true);
                    return;
                  }
                  setPreviewError(message || '视频预览失败');
                }}
              />
              {previewLoading && !previewError && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 text-white">
                  <span className="inline-flex items-center gap-2 rounded-lg bg-black/65 px-3 py-2 text-xs font-semibold"><Loader2 size={14} className="animate-spin" />正在准备视频…</span>
                </div>
              )}
              {previewError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 px-6 text-center text-white">
                  <Play size={28} className="opacity-70" />
                  <p className="mt-3 text-sm font-semibold">视频预览暂时失败</p>
                  <p className="mt-1 max-w-md text-xs leading-relaxed text-white/65">{previewError}</p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <button type="button" onClick={retryPreview} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-neutral-900">重新获取播放地址</button>
                    {embedUrl && <button type="button" onClick={() => { setPreviewError(''); setUseEmbedPlayer(true); }} className="rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-xs font-bold text-white">使用原站播放器</button>}
                  </div>
                </div>
              )}
            </div>
          ) : embedUrl ? (
            <iframe
              src={embedUrl}
              title={`${video.title} 站内播放器`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="aspect-video w-full border-0 bg-black"
            />
          ) : (
            <div className="aspect-video flex flex-col items-center justify-center gap-3 text-white/70">
              <Play size={28} />
              <p className="text-sm">当前仅支持跳转原视频；分析用临时视频不会进入素材库</p>
            </div>
          )}
        </div>
    </Modal>
  );
}
