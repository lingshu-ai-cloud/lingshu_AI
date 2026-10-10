import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCopy,
  Download,
  ExternalLink,
  FileArchive,
  Link2,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import {
  createSocialPublicationPackage,
  getPublishingVideoManifest,
  submitSocialPublicationEvidence,
  type PublicationEvidence,
  type PublicationPackage,
} from '../../lib/socialChannels';

type PackageSource = {
  id: string;
  videoPath: string;
  title: string;
  description: string;
  firstComment?: string;
  sourceProjectId?: string;
  generationRecordId?: string;
};

function safeBusinessId(value: string | undefined, fallback: string) {
  const normalized = String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').replace(/^-+|-+$/g, '');
  return (normalized || fallback).slice(0, 190);
}

function hashtags(value: string): string[] {
  return [...new Set(value.match(/#[\p{L}\p{N}_-]+/gu)?.map(item => item.slice(1)) ?? [])].slice(0, 30);
}

function fingerprintSource(source: PackageSource | null): string {
  if (!source) return '';
  const value = [source.id, source.videoPath, source.title, source.description, source.firstComment || ''].join('\u001f');
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `ui-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function downloadManifest(publicationPackage: PublicationPackage) {
  const blob = new Blob([JSON.stringify(publicationPackage, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${publicationPackage.packageId}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function DouyinPublicationPackagePanel({ source }: { source: PackageSource | null }) {
  const [publicationPackage, setPublicationPackage] = useState<PublicationPackage | null>(null);
  const [currentEvidence, setCurrentEvidence] = useState<PublicationEvidence | null>(null);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [publicUrl, setPublicUrl] = useState('');
  const [externalContentId, setExternalContentId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sourceFingerprint = useMemo(() => fingerprintSource(source), [source]);
  const packageMatchesSource = Boolean(publicationPackage
    && publicationPackage.contentId === safeBusinessId(source?.sourceProjectId || source?.id, 'content')
    && publicationPackage.sourceTracking?.sourceFingerprint === sourceFingerprint);

  const createPackage = async () => {
    if (!source?.videoPath.trim()) { setError('请先选择并保存一条完整视频。'); return; }
    if (!source.title.trim() || !source.description.trim()) { setError('请先填写标题和发布配文。'); return; }
    setCreating(true); setError(''); setNotice('');
    try {
      const asset = await getPublishingVideoManifest(source.videoPath.trim());
      const result = await createSocialPublicationPackage({
        channelId: 'douyin_cn',
        contentId: safeBusinessId(source.sourceProjectId || source.id, 'content'),
        contentVersion: safeBusinessId(source.generationRecordId, `v-${asset.contentHash.slice(0, 12)}`),
        contentHash: asset.contentHash,
        copy: {
          title: source.title.trim(),
          body: source.description.trim(),
          hashtags: hashtags(source.description),
          firstComment: source.firstComment?.trim() || undefined,
        },
        assets: [asset],
        sourceTracking: {
          queueItemId: safeBusinessId(source.id, 'queue-item'),
          ...(source.sourceProjectId ? { projectId: safeBusinessId(source.sourceProjectId, 'project') } : {}),
          sourceFingerprint,
        },
      });
      setPublicationPackage(result);
      setCurrentEvidence(null);
      setPublicUrl('');
      setExternalContentId('');
      setNotice('国内抖音发布包已冻结。之后如修改视频或文案，请重新生成，旧包不要继续使用。');
    } catch (createError) { setError(createError instanceof Error ? createError.message : '发布包生成失败'); }
    finally { setCreating(false); }
  };

  const copyText = async () => {
    if (!publicationPackage) return;
    const text = [publicationPackage.copy.title, publicationPackage.copy.body, publicationPackage.copy.hashtags.map(item => `#${item}`).join(' ')].filter(Boolean).join('\n\n');
    try { await navigator.clipboard.writeText(text); setNotice('标题、正文和标签已复制。'); }
    catch { setError('浏览器没有允许复制，请在发布包 JSON 中查看文案。'); }
  };

  const submitEvidence = async () => {
    if (!publicationPackage || (!publicUrl.trim() && !externalContentId.trim())) {
      setError('发布后请填写抖音公开链接或作品 ID。'); return;
    }
    setSubmitting(true); setError(''); setNotice('');
    try {
      const result = await submitSocialPublicationEvidence({
        publicationPackage,
        publicUrl,
        externalContentId,
        correctsEvidenceId: currentEvidence?.evidenceId,
      });
      setCurrentEvidence(result.evidence);
      setNotice(result.correctionAccepted
        ? '凭证更正已提交，并重新进入人工核验队列。'
        : '发布凭证已提交人工核验；内部核验员确认前不会标成已发布。');
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : '发布凭证登记失败'); }
    finally { setSubmitting(false); }
  };

  return (
    <section className="rounded-2xl border border-rose-200 bg-gradient-to-br from-white to-rose-50/50 p-4 shadow-sm">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black text-sm font-black text-white">抖</span>
          <div>
            <h3 className="text-sm font-black text-text-primary">国内抖音发布包</h3>
            <p className="mt-1 text-xs leading-5 text-text-muted">不要求客户把抖音账号登录进系统。先冻结视频、文案和校验值，再由客户在抖音端确认发布。</p>
          </div>
        </div>
        <button type="button" onClick={() => void createPackage()} disabled={creating || !source?.videoPath.trim()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40">
          {creating ? <Loader2 size={14} className="animate-spin" /> : <FileArchive size={14} />}{publicationPackage ? '重新生成发布包' : '生成发布包'}
        </button>
      </div>

      {(error || notice) && <div role="status" className={`mt-3 rounded-xl border px-3 py-2 text-xs ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{error || notice}</div>}

      {publicationPackage && packageMatchesSource && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(330px,0.7fr)]">
          <div className="rounded-xl border border-border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-xs font-black text-text-primary">发布包已就绪</p><p className="mt-1 font-mono text-[10px] text-text-muted">{publicationPackage.packageId} · {publicationPackage.packageHash.slice(0, 16)}…</p></div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700"><ShieldCheck size={11} />版本已冻结</span>
            </div>
            <ol className="mt-3 space-y-2 text-xs leading-5 text-text-secondary">
              {publicationPackage.publishingInstructions.map((instruction, index) => <li key={instruction} className="flex gap-2"><span className="font-black text-accent">{index + 1}.</span><span>{instruction}</span></li>)}
            </ol>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => downloadManifest(publicationPackage)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary"><Download size={13} />下载清单 JSON</button>
              <a href={publicationPackage.assets[0]?.downloadUrl} download={publicationPackage.assets[0]?.fileName} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary"><ExternalLink size={13} />下载冻结视频</a>
              <button type="button" onClick={() => void copyText()} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary"><ClipboardCopy size={13} />复制发布文案</button>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-white p-4">
            <div className="flex items-start gap-2"><Link2 size={16} className="mt-0.5 text-accent" /><div><p className="text-xs font-black text-text-primary">发布后登记结果</p><p className="mt-1 text-[11px] leading-5 text-text-muted">“已提交”不等于“已核验”。系统保留待对账状态，避免数据被误标。</p></div></div>
            {currentEvidence && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">
                当前凭证：{currentEvidence.verificationStatus === 'pending'
                  ? '待内部人工核验'
                  : currentEvidence.verificationStatus === 'verified'
                    ? '人工核验通过'
                    : currentEvidence.verificationStatus === 'rejected'
                      ? '人工核验未通过，可更正后重提'
                      : '需要补充核对，可更正后重提'}
              </div>
            )}
            <input value={publicUrl} onChange={event => setPublicUrl(event.target.value)} placeholder="抖音公开作品链接（https://www.douyin.com/...）" className="mt-3 w-full rounded-lg border border-border px-3 py-2 text-xs outline-none focus:border-accent" />
            <input value={externalContentId} onChange={event => setExternalContentId(event.target.value)} placeholder="作品 ID（链接和 ID 填一个即可）" className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-xs outline-none focus:border-accent" />
            <button type="button" onClick={() => void submitEvidence()} disabled={submitting || currentEvidence?.verificationStatus === 'verified'} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-xs font-black text-white disabled:opacity-50">{submitting ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}{currentEvidence?.verificationStatus === 'verified' ? '凭证已核验' : currentEvidence ? '更正并重新提交凭证' : '登记发布凭证'}</button>
          </div>
        </div>
      )}
    </section>
  );
}
