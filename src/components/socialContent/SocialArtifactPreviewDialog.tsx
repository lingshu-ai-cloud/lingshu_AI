import { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, FileText, Loader2, X } from 'lucide-react';
import type { SocialContentArtifact } from '../../../shared/contracts/socialContentWorkflow';
import { useModalFocus } from '../../hooks/useModalFocus';
import { socialContentApi } from '../../lib/socialContentApi';
import {
  PLATFORM_OPTIONS,
  artifactKindLabel,
  contentLanguageLabel,
  optionLabel,
  packageVersionLabel,
} from './socialContentUi';

const ARCHIVED_MEDIA_REF = /^socialfile:socialfile_[a-f0-9]{24}$/;
const CONTENT_FIELDS = ['body', 'caption', 'copy', 'text', 'summary', 'script'] as const;

function readableText(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

export function socialArtifactReadableCopy(artifact: SocialContentArtifact): { title: string; body: string } {
  const content = artifact.content;
  const title = readableText(content?.title, 300)
    || readableText(content?.headline, 300)
    || artifactKindLabel(artifact.kind);
  const body = CONTENT_FIELDS.map(field => readableText(content?.[field], 12_000)).find(Boolean) || '';
  return { title, body };
}

export function socialArtifactHasArchivedMedia(artifact: SocialContentArtifact): boolean {
  return ARCHIVED_MEDIA_REF.test(artifact.resourceRef || '');
}

export default function SocialArtifactPreviewDialog({ artifact, onClose }: {
  artifact: SocialContentArtifact;
  onClose: () => void;
}) {
  const [media, setMedia] = useState<{ url: string; filename: string; type: string } | null>(null);
  const [loading, setLoading] = useState(socialArtifactHasArchivedMedia(artifact));
  const [error, setError] = useState('');
  const dialogRef = useModalFocus<HTMLDivElement>({ open: true, onClose });
  const copy = useMemo(() => socialArtifactReadableCopy(artifact), [artifact]);

  useEffect(() => {
    if (!socialArtifactHasArchivedMedia(artifact)) return;
    const controller = new AbortController();
    let objectUrl = '';
    void socialContentApi.fetchArtifactMedia(artifact.taskId, artifact.artifactId, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(result.blob);
        setMedia({ url: objectUrl, filename: result.filename, type: result.blob.type });
      })
      .catch(loadError => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : '成品暂时无法预览');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifact]);

  const details = [
    artifact.platform ? optionLabel(PLATFORM_OPTIONS, artifact.platform) : null,
    contentLanguageLabel(artifact.language),
    packageVersionLabel(artifact.version),
  ].filter(Boolean).join(' · ');
  const isVideo = media?.type.startsWith('video/');

  return (
    <div className="fixed inset-0 z-[195] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="social-artifact-preview-title" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl outline-none">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0"><p className="text-[11px] font-bold text-emerald-700">{artifactKindLabel(artifact.kind)}</p><h2 id="social-artifact-preview-title" className="mt-1 truncate text-lg font-black text-text-primary">{copy.title}</h2>{details && <p className="mt-1 text-[11px] text-text-muted">{details}</p>}</div>
          <button type="button" aria-label="关闭预览" onClick={onClose} className="shrink-0 rounded-lg p-2 text-text-muted hover:bg-surface-2"><X size={18} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#f8faf9] p-5">
          {loading && <div role="status" className="flex min-h-64 items-center justify-center gap-2 rounded-xl border border-border bg-white text-sm font-semibold text-text-muted"><Loader2 size={18} className="animate-spin text-emerald-600" />正在打开成品</div>}
          {!loading && media && (isVideo
            ? <video controls preload="metadata" src={media.url} className="mx-auto max-h-[68vh] w-full rounded-xl bg-black shadow-sm">您的浏览器暂不支持视频预览。</video>
            : <img src={media.url} alt={copy.title} className="mx-auto max-h-[68vh] max-w-full rounded-xl bg-white object-contain shadow-sm" />)}
          {!loading && !media && copy.body && <article className="rounded-xl border border-border bg-white p-5"><div className="flex items-center gap-2 text-xs font-bold text-text-muted"><FileText size={14} />内容预览</div><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-text-primary">{copy.body}</p></article>}
          {!loading && !media && !copy.body && !error && <div className="flex min-h-48 items-center justify-center rounded-xl border border-border bg-white px-6 text-center text-sm font-semibold text-text-muted">此成品暂无可预览内容</div>}
          {error && <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p>}
        </div>
        <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-xs font-bold text-text-secondary">关闭</button>
          {media && <><a href={media.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-xs font-bold text-text-secondary"><ExternalLink size={14} />单独打开</a><a href={media.url} download={media.filename} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white"><Download size={14} />下载成品</a></>}
        </footer>
      </div>
    </div>
  );
}
