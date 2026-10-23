import { useEffect, useState } from 'react';
import { Button, Input } from 'antd';
import { CheckCircle2, Download, FileArchive, ImageOff, Loader2, RefreshCw } from 'lucide-react';
import type { ContentProductionTaskCard, ContentTaskArtifactCard } from '../../../shared/contracts/assistantContentTaskCard';
import { socialContentApi } from '../../lib/socialContentApi';

export type ContentTaskActionResult = { ok: true } | { ok: false; message: string };

const artifactStatusLabel: Record<ContentTaskArtifactCard['status'], string> = {
  draft: '草稿', review_required: '待人工验收', approved: '已采纳',
  changes_requested: '已要求修改', superseded: '已被新版本替代',
};

function ArtifactPreview({ taskId, artifact }: { taskId: string; artifact: ContentTaskArtifactCard }) {
  const [preview, setPreview] = useState<{ url: string; kind: 'image' | 'video' } | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'unavailable'>(artifact.previewAvailable ? 'loading' : 'unavailable');
  useEffect(() => {
    if (!artifact.previewAvailable) return;
    let active = true;
    let objectUrl = '';
    const controller = new AbortController();
    setState('loading');
    void socialContentApi.fetchArtifactMedia(taskId, artifact.artifactId, controller.signal).then(result => {
      if (!active) return;
      objectUrl = URL.createObjectURL(result.blob);
      setPreview({ url: objectUrl, kind: result.blob.type.startsWith('video/') ? 'video' : 'image' });
      setState('idle');
    }).catch(() => { if (active) setState('unavailable'); });
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [artifact.artifactId, artifact.previewAvailable, artifact.version, taskId]);
  if (state === 'loading') return <div role="status" className="flex h-44 items-center justify-center bg-surface-2 text-text-muted"><Loader2 className="animate-spin" size={18} /><span className="sr-only">正在读取候选产物</span></div>;
  if (!preview) return <div className="flex h-28 items-center justify-center gap-2 bg-surface-2 text-xs text-text-muted"><ImageOff size={16} />暂无可核验预览</div>;
  return preview.kind === 'video'
    ? <video src={preview.url} className="max-h-64 w-full bg-black object-contain" controls preload="metadata" />
    : <img src={preview.url} alt={`候选产物 ${artifact.artifactId}`} className="max-h-64 w-full bg-surface-2 object-contain" />;
}

export default function AssistantContentTaskDetail({ card, busy, onArtifactDecision, onCreateDelivery, onDownloadDelivery }: {
  card: ContentProductionTaskCard;
  busy: boolean;
  onArtifactDecision: (artifact: ContentTaskArtifactCard, decision: 'approved' | 'changes_requested', note: string) => Promise<ContentTaskActionResult>;
  onCreateDelivery: () => Promise<ContentTaskActionResult>;
  onDownloadDelivery: (href: string) => Promise<ContentTaskActionResult>;
}) {
  const artifacts = card.artifacts ?? [];
  const receipts = card.deliveryReceipts ?? [];
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const reviewRequired = artifacts.filter(artifact => artifact.status === 'review_required');
  const approved = artifacts.filter(artifact => artifact.status === 'approved');
  const readyReceipt = receipts.some(receipt => receipt.status === 'ready' || receipt.status === 'confirmed');
  const run = async (operation: () => Promise<ContentTaskActionResult>) => {
    setFeedback('');
    const result = await operation();
    setFeedback('message' in result ? result.message : '');
  };
  if (!artifacts.length && !receipts.length) return null;
  return <section className="mt-5 border-t border-border pt-4" aria-label="真实产物与交付">
    <div className="flex items-center justify-between gap-3"><h3 className="ls-type-title-small text-text-primary">产物版本与交付</h3><span className="text-xs text-text-muted">以服务端回执为准</span></div>
    <div className="mt-3 space-y-3">{artifacts.map(artifact => <article key={`${artifact.artifactId}:${artifact.version}`} className="overflow-hidden rounded-lg border border-border bg-surface">
      <ArtifactPreview taskId={card.contentTaskId} artifact={artifact} />
      <div className="p-3">
        <div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-text-primary">{artifact.kind || '内容产物'} · v{artifact.version}</strong><span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-text-secondary">{artifactStatusLabel[artifact.status]}</span>{artifact.parentArtifactId ? <span className="text-[10px] text-text-muted">修改自 {artifact.parentArtifactId}</span> : null}</div>
        {(artifact.platform || artifact.language) ? <p className="mt-1 text-xs text-text-muted">{[artifact.platform, artifact.language].filter(Boolean).join(' · ')}</p> : null}
        {artifact.status === 'approved' ? <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-success"><CheckCircle2 size={14} />该精确版本已通过服务端质量门并被采纳。</p> : null}
        {artifact.status === 'review_required' ? <div className="mt-3 space-y-2">
          <Input.TextArea rows={2} value={notes[artifact.artifactId] || ''} onChange={event => setNotes(current => ({ ...current, [artifact.artifactId]: event.target.value }))} placeholder="如要求修改，请说明需要调整的地方" maxLength={2_000} />
          <div className="flex flex-wrap justify-end gap-2"><Button disabled={busy || !(notes[artifact.artifactId] || '').trim()} icon={<RefreshCw size={14} />} onClick={() => void run(() => onArtifactDecision(artifact, 'changes_requested', notes[artifact.artifactId] || ''))}>要求修改</Button><Button disabled={busy} onClick={() => void run(() => onArtifactDecision(artifact, 'approved', ''))}>采纳此版本</Button></div>
        </div> : null}
      </div>
    </article>)}</div>
    {approved.length > 0 && reviewRequired.length === 0 && !readyReceipt ? <div className="mt-4 flex justify-end"><Button disabled={busy} icon={<FileArchive size={15} />} onClick={() => void run(onCreateDelivery)}>生成真实交付包</Button></div> : null}
    {receipts.length ? <div className="mt-4 space-y-2" aria-label="交付回执">{receipts.map(receipt => <div key={`${receipt.packageId}:${receipt.version}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 p-3"><FileArchive size={16} className="text-accent" /><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-text-primary">交付包 {receipt.packageId} · v{receipt.version}</p><p className="mt-0.5 text-[10px] text-text-muted">{receipt.status} · {receipt.artifactIds.length} 个已采纳产物</p></div>{receipt.downloadHref && (receipt.status === 'ready' || receipt.status === 'confirmed') ? <Button disabled={busy} icon={<Download size={14} />} onClick={() => void run(() => onDownloadDelivery(receipt.downloadHref!))}>下载</Button> : null}</div>)}</div> : null}
    {feedback ? <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{feedback}</p> : null}
  </section>;
}
