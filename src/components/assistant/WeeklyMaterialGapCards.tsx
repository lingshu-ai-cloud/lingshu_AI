import { useState } from 'react';
import { Modal } from 'antd';
import { AuthenticatedImage, AuthenticatedVideo } from '../inspiration/InspirationMedia';
import { StoryboardFirstFrame } from '../studio/StoryboardFirstFrame';
import type { WeeklyMaterialGap } from '../../lib/weeklyMaterialGap';

const PAGE_SIZE = 6;
const safePreviewUrl = (value: string | null): string => {
  const url = String(value || '').trim();
  if (url.startsWith('/api/') || url.startsWith('/media/') || /^https:\/\//i.test(url)) return url;
  if (typeof window !== 'undefined' && /^http:\/\//i.test(url)) {
    try { if (new URL(url).origin === window.location.origin) return url; } catch { /* Invalid preview URL. */ }
  }
  return '';
};

type Preview = { kind: 'video' | 'shot'; gap: WeeklyMaterialGap };

export default function WeeklyMaterialGapCards({ gaps, onUpload, uploadBusy = false }: {
  gaps: WeeklyMaterialGap[]; onUpload: (gap: WeeklyMaterialGap) => void; uploadBusy?: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [page, setPage] = useState(0);
  if (!gaps.length) return null;

  // The readiness endpoint counts unmatched shots, not videos. Show one next
  // actionable shot per video and keep the complete count visible.
  const firstByVideo = new Map<string, WeeklyMaterialGap>();
  for (const gap of gaps) if (!firstByVideo.has(gap.video)) firstByVideo.set(gap.video, gap);
  const nextShots = [...firstByVideo.values()];
  const pageCount = Math.ceil(nextShots.length / PAGE_SIZE);
  const currentPage = Math.min(page, pageCount - 1);
  const visible = nextShots.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return <section aria-label="本周缺少素材的镜头" className="my-3 space-y-2">
    <p className="text-xs leading-5 text-text-secondary">涉及 {nextShots.length} 条视频、{gaps.length} 个待匹配镜头；每条视频先展示最早需要补齐的镜头。</p>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {visible.map((gap, index) => {
      const reference = safePreviewUrl(gap.referenceThumbnailUrl);
      const video = safePreviewUrl(gap.referenceVideoUrl);
      const shot = safePreviewUrl(gap.shotFirstFrameRef);
      const footage = gap.footage.split('（参考画面：')[0];
      return <article key={gap.requirementId} className="min-w-0 rounded-lg border border-border bg-white p-2">
        <div className="flex min-w-0 items-start gap-2 text-xs">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-glow text-xs font-semibold text-accent">{currentPage * PAGE_SIZE + index + 1}</span>
          <div className="min-w-0 flex-1"><strong className="block truncate font-medium text-text-primary" title={gap.video}>{gap.video}</strong>
            <p className="mt-0.5 truncate text-xs text-text-secondary" title={gap.product || undefined}>镜头 {gap.shot} · 缺{footage}{gap.minimumSeconds > 0 ? ` · ≥${gap.minimumSeconds} 秒` : ''}</p>
          </div>
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <button type="button" disabled={!video} onClick={() => { setPreviewError(''); setPreview({ kind: 'video', gap }); }}
            aria-label={video ? `播放${gap.video}参考视频` : `${gap.video}参考视频暂不可播放`}
            className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default">
            <div className="aspect-video w-full overflow-hidden bg-surface-2">
              {reference ? <AuthenticatedImage src={reference} alt={`${gap.video}封面`} className="h-full w-full object-cover" />
                : <span className="flex h-full items-center justify-center px-2 text-xs text-text-muted">{video ? '点击播放' : '视频暂不可播放'}</span>}
            </div>
            <span className="block truncate px-1.5 py-1 text-xs text-text-secondary">参考视频 · 播放</span>
          </button>
          <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface-2">
            <button type="button" disabled={!shot && !video} onClick={() => { setPreviewError(''); setPreview({ kind: 'shot', gap }); }}
              aria-label={shot || video ? `查看镜头 ${gap.shot} 截图` : `镜头 ${gap.shot} 截图暂不可用`}
              className="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default">
              <div className="aspect-video w-full overflow-hidden bg-surface-2">
                {shot || video ? <StoryboardFirstFrame source={video} firstFrameRef={shot} time={gap.shotStartSeconds}
                  label={`镜头 ${gap.shot}`} className="h-full w-full" />
                  : <span className="flex h-full items-center justify-center px-2 text-xs text-text-muted">截图暂不可用</span>}
              </div>
            </button>
            <div className="flex min-w-0 items-center justify-between gap-1 px-1.5 py-1 text-xs text-text-secondary">
              <span className="min-w-0 truncate">镜头 {gap.shot} · 截图</span>
              <button type="button" disabled={uploadBusy} onClick={() => onUpload(gap)}
                aria-label={`上传${gap.video}镜头 ${gap.shot} 素材`}
                className="shrink-0 rounded border border-border bg-white px-1.5 py-0.5 text-xs text-accent hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">上传素材</button>
            </div>
          </div>
        </div>
      </article>;
      })}
    </div>
    {pageCount > 1 ? <div className="flex items-center justify-between gap-2 text-xs text-text-secondary">
      <span>视频 {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, nextShots.length)} / {nextShots.length}</span>
      <span className="flex gap-2"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="rounded border border-border px-2 py-1 disabled:opacity-50">上一组</button>
        <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} className="rounded border border-border px-2 py-1 disabled:opacity-50">下一组</button></span>
    </div> : null}
    <Modal open={Boolean(preview)} title={preview ? `${preview.gap.video} · ${preview.kind === 'video' ? '参考视频' : `镜头 ${preview.gap.shot} 截图`}` : '查看预览'}
      footer={null} onCancel={() => setPreview(null)} width={720} destroyOnHidden>
      {preview?.kind === 'video' ? <>
        <AuthenticatedVideo apiUrl={safePreviewUrl(preview.gap.referenceVideoUrl)}
          poster={safePreviewUrl(preview.gap.referenceThumbnailUrl)} className="max-h-[70vh] w-full bg-black object-contain"
          controls loadOnMount onError={message => setPreviewError(message || '视频暂不可播放')} />
        {previewError ? <p role="alert" className="mt-2 text-sm text-error">{previewError}</p> : null}
      </> : null}
      {preview?.kind === 'shot' ? <StoryboardFirstFrame source={safePreviewUrl(preview.gap.referenceVideoUrl)}
        firstFrameRef={safePreviewUrl(preview.gap.shotFirstFrameRef)} time={preview.gap.shotStartSeconds}
        label={`镜头 ${preview.gap.shot}`} className="aspect-video max-h-[70vh] w-full" /> : null}
    </Modal>
  </section>;
}
