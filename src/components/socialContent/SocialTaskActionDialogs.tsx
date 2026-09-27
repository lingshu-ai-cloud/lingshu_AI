import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Loader2, Send, X } from 'lucide-react';
import type {
  RegisterSocialPublicationInput,
  SocialContentArtifact,
  SocialContentTaskDetail,
  SocialMetricSubmission,
  SubmitSocialMetricsInput,
} from '../../../shared/contracts/socialContentWorkflow';
import { SOCIAL_CONTENT_MAX_TASK_FILE_BYTES, validateSocialContentFile } from '../../lib/socialContentFiles';
import { socialContentCanRegisterPublication, socialContentCurrentDelivery } from '../../lib/socialContentModel';
import { PLATFORM_OPTIONS, artifactKindLabel, optionLabel, packageVersionLabel } from './socialContentUi';

const INPUT_CLASS = 'mt-1.5 h-11 w-full rounded-xl border border-border bg-white px-3 text-sm text-text-primary outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';
const TEXTAREA_CLASS = 'mt-1.5 w-full resize-y rounded-xl border border-border bg-white px-3 py-2.5 text-sm leading-6 text-text-primary outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';

function nowForInput(): string {
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return now.toISOString().slice(0, 16);
}

function DialogFrame({ title, eyebrow, busy, onClose, children, footer }: { title: string; eyebrow: string; busy: boolean; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { window.setTimeout(() => ref.current?.focus(), 0); }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);
  return (
    <div className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="social-action-dialog-title" className="ui-modal-frame ui-modal-frame--compact outline-none">
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4"><div><p className="text-[11px] font-bold text-emerald-700">{eyebrow}</p><h2 id="social-action-dialog-title" className="mt-1 text-lg font-black text-text-primary">{title}</h2></div><button type="button" disabled={busy} aria-label="关闭" onClick={onClose} className="rounded-lg p-2 text-text-muted hover:bg-surface-2"><X size={18} /></button></header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        <footer className="flex justify-end gap-2 border-t border-border px-5 py-4">{footer}</footer>
      </div>
    </div>
  );
}

export function PublicationDialog({ task, busy, onClose, onSubmit }: { task: SocialContentTaskDetail; busy: boolean; onClose: () => void; onSubmit: (input: RegisterSocialPublicationInput) => Promise<void> }) {
  const currentDelivery = socialContentCurrentDelivery(task);
  const readyPackages = currentDelivery && socialContentCanRegisterPublication(task) ? [currentDelivery] : [];
  const [packageId, setPackageId] = useState(readyPackages.at(-1)?.packageId || '');
  const [platform, setPlatform] = useState(task.brief.platforms[0] || 'tiktok');
  const [accountLabel, setAccountLabel] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [platformPostId, setPlatformPostId] = useState('');
  const [publishedAt, setPublishedAt] = useState(nowForInput);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const submit = async () => {
    if (!packageId || !platform || !publishedAt) { setError('请补全交付版本、平台和发布时间'); return; }
    if (!publicUrl.trim() && !platformPostId.trim()) { setError('请填写发布链接或作品编号'); return; }
    if (publicUrl.trim()) {
      try { const url = new URL(publicUrl.trim()); if (url.protocol !== 'https:') throw new Error(); }
      catch { setError('请填写完整的 https 发布链接'); return; }
    }
    try {
      await onSubmit({
        expectedTaskVersion: task.version,
        packageId,
        platform,
        accountLabel: accountLabel.trim() || null,
        publicUrl: publicUrl.trim() || null,
        platformPostId: platformPostId.trim() || null,
        publishedAt: new Date(publishedAt).toISOString(),
        notes: notes.trim() || null,
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '发布记录未保存，请重试');
    }
  };
  return (
    <DialogFrame title="登记发布结果" eyebrow={task.brief.title} busy={busy} onClose={onClose} footer={<><button type="button" disabled={busy} onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-xs font-bold text-text-secondary">取消</button><button type="button" disabled={busy} onClick={() => void submit()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}保存发布记录</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-bold text-text-secondary">交付版本<select value={packageId} onChange={event => setPackageId(event.target.value)} className={INPUT_CLASS}>{readyPackages.map(item => <option key={item.packageId} value={item.packageId}>{packageVersionLabel(item.version)}</option>)}</select></label>
        <label className="text-xs font-bold text-text-secondary">发布平台<select value={platform} onChange={event => setPlatform(event.target.value)} className={INPUT_CLASS}>{[...new Set([...task.brief.platforms, ...PLATFORM_OPTIONS.map(item => item[0])])].map(value => <option key={value} value={value}>{optionLabel(PLATFORM_OPTIONS, value)}</option>)}</select></label>
        <label className="text-xs font-bold text-text-secondary">账号名称<input value={accountLabel} onChange={event => setAccountLabel(event.target.value)} maxLength={120} placeholder="选填" className={INPUT_CLASS} /></label>
        <label className="text-xs font-bold text-text-secondary">实际发布时间<input type="datetime-local" value={publishedAt} onChange={event => setPublishedAt(event.target.value)} className={INPUT_CLASS} /></label>
        <label className="text-xs font-bold text-text-secondary sm:col-span-2">发布链接<input type="url" value={publicUrl} onChange={event => { setPublicUrl(event.target.value); setError(''); }} placeholder="https://" className={INPUT_CLASS} /></label>
        <label className="text-xs font-bold text-text-secondary sm:col-span-2">平台作品编号<input value={platformPostId} onChange={event => { setPlatformPostId(event.target.value); setError(''); }} maxLength={200} placeholder="发布链接和作品编号至少填写一项" className={INPUT_CLASS} /></label>
        <label className="text-xs font-bold text-text-secondary sm:col-span-2">备注<textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={1000} rows={3} placeholder="选填" className={TEXTAREA_CLASS} /></label>
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p>}
    </DialogFrame>
  );
}

export function ArtifactChangesDialog({ artifact, busy, onClose, onSubmit }: { artifact: SocialContentArtifact; busy: boolean; onClose: () => void; onSubmit: (note: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const submit = async () => {
    if (note.trim().length < 3) { setError('请填写需要调整的内容'); return; }
    try {
      await onSubmit(note.trim());
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '修改要求未提交，请重试');
    }
  };
  return (
    <DialogFrame title="退回修改" eyebrow={`${artifactKindLabel(artifact.kind)} · ${packageVersionLabel(artifact.version)}`} busy={busy} onClose={onClose} footer={<><button type="button" disabled={busy} onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-xs font-bold text-text-secondary">取消</button><button type="button" disabled={busy} onClick={() => void submit()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white disabled:opacity-50">{busy && <Loader2 size={14} className="animate-spin" />}提交修改要求</button></>}>
      <label className="block text-xs font-bold text-text-secondary">修改要求<textarea autoFocus value={note} onChange={event => { setNote(event.target.value); setError(''); }} maxLength={2000} rows={6} placeholder="请说明需要修改的画面、文案、事实或平台版本" className={TEXTAREA_CLASS} /></label>
      {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p>}
    </DialogFrame>
  );
}

export function ArtifactBatchChangesDialog({ count, busy, onClose, onSubmit }: { count: number; busy: boolean; onClose: () => void; onSubmit: (note: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const submit = async () => {
    if (note.trim().length < 3) { setError('请填写本批统一修改要求'); return; }
    try {
      await onSubmit(note.trim());
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '修改要求未提交，请重试');
    }
  };
  return (
    <DialogFrame title="批量退回修改" eyebrow={`本批 ${count} 项内容`} busy={busy} onClose={onClose} footer={<><button type="button" disabled={busy} onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-xs font-bold text-text-secondary">取消</button><button type="button" disabled={busy} onClick={() => void submit()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white disabled:opacity-50">{busy && <Loader2 size={14} className="animate-spin" />}提交本批修改</button></>}>
      <label className="block text-xs font-bold text-text-secondary">本批统一修改要求<textarea autoFocus value={note} onChange={event => { setNote(event.target.value); setError(''); }} maxLength={2000} rows={6} placeholder="例如：本批开头过于像广告，保留产品事实，统一改为客户问题切入" className={TEXTAREA_CLASS} /></label>
      <p className="mt-3 text-xs leading-5 text-text-muted">这条要求会应用到本批所有待验收内容；单项例外可在内容创作页单独处理。</p>
      {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p>}
    </DialogFrame>
  );
}

const METRIC_FIELDS = [
  ['views', '播放／浏览'],
  ['likes', '点赞'],
  ['comments', '评论'],
  ['shares', '分享'],
  ['saves', '收藏'],
  ['inquiries', '咨询'],
] as const;

export function MetricsDialog({ task, busy, onClose, onSubmit }: { task: SocialContentTaskDetail; busy: boolean; onClose: () => void; onSubmit: (publicationId: string, input: SubmitSocialMetricsInput, files: File[]) => Promise<void> }) {
  const [publicationId, setPublicationId] = useState(task.publications.at(-1)?.publicationId || '');
  const [capturedAt, setCapturedAt] = useState(nowForInput);
  const [method, setMethod] = useState<SocialMetricSubmission['method']>('manual');
  const [metrics, setMetrics] = useState<Record<string, string>>({});
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const selectedPublication = useMemo(() => task.publications.find(item => item.publicationId === publicationId), [task.publications, publicationId]);
  const selectEvidence = (incoming: FileList | null) => {
    const next = Array.from(incoming || []);
    const allowedExtensions = method === 'table' ? new Set(['csv', 'xlsx']) : new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
    if (next.length > (method === 'table' ? 1 : 10)) { setError(method === 'table' ? '数据表格一次只能选择 1 个' : '数据截图一次最多 10 张'); return; }
    for (const file of next) {
      const extension = file.name.toLowerCase().split('.').at(-1) || '';
      const issue = validateSocialContentFile(file);
      if (issue) { setError(issue); return; }
      if (!allowedExtensions.has(extension)) { setError(method === 'table' ? '请选择 CSV 或 XLSX 数据表格' : '请选择 JPG、PNG、WEBP 或 GIF 截图'); return; }
    }
    if (next.reduce((total, file) => total + file.size, 0) > SOCIAL_CONTENT_MAX_TASK_FILE_BYTES) { setError('本次待上传文件合计不能超过 512 MB'); return; }
    setEvidenceFiles(next);
    setError('');
  };
  const submit = async () => {
    const supplied = Object.entries(metrics).filter(([, value]) => value.trim() !== '');
    if (!publicationId || !capturedAt) { setError('请选择发布记录和数据时间'); return; }
    if (supplied.length === 0) { setError('请至少填写一项实际数据'); return; }
    if ((method === 'table' || method === 'screenshot') && evidenceFiles.length === 0) { setError(method === 'table' ? '请选择数据表格' : '请选择数据截图'); return; }
    const normalized = Object.fromEntries(supplied.map(([key, value]) => [key, Number(value)]));
    if (Object.values(normalized).some(value => !Number.isFinite(value) || value < 0)) { setError('数据应为不小于 0 的数字'); return; }
    try {
      await onSubmit(publicationId, { method, capturedAt: new Date(capturedAt).toISOString(), metrics: normalized, notes: notes.trim() || null }, evidenceFiles);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '发布数据未保存，请重试');
    }
  };
  return (
    <DialogFrame title="回传发布数据" eyebrow={task.brief.title} busy={busy} onClose={onClose} footer={<><button type="button" disabled={busy} onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-xs font-bold text-text-secondary">取消</button><button type="button" disabled={busy} onClick={() => void submit()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}保存数据</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-bold text-text-secondary sm:col-span-2">发布记录<select value={publicationId} onChange={event => setPublicationId(event.target.value)} className={INPUT_CLASS}><option value="">请选择</option>{task.publications.map(item => <option key={item.publicationId} value={item.publicationId}>{optionLabel(PLATFORM_OPTIONS, item.platform)} · {new Date(item.publishedAt).toLocaleDateString('zh-CN')}</option>)}</select></label>
        {selectedPublication && <div className="sm:col-span-2 rounded-xl bg-surface-2 px-3 py-2 text-xs text-text-secondary">{selectedPublication.accountLabel || optionLabel(PLATFORM_OPTIONS, selectedPublication.platform)}{selectedPublication.publicUrl ? ` · ${selectedPublication.publicUrl}` : ''}</div>}
        <label className="text-xs font-bold text-text-secondary">数据时间<input type="datetime-local" value={capturedAt} onChange={event => setCapturedAt(event.target.value)} className={INPUT_CLASS} /></label>
        <label className="text-xs font-bold text-text-secondary">回传方式<select value={method} onChange={event => { setMethod(event.target.value as SocialMetricSubmission['method']); setEvidenceFiles([]); setError(''); }} className={INPUT_CLASS}><option value="manual">手工填写</option><option value="link">发布链接</option><option value="platform_id">作品编号</option><option value="table">上传表格</option><option value="screenshot">上传截图</option></select></label>
        {(method === 'table' || method === 'screenshot') && <label className="text-xs font-bold text-text-secondary sm:col-span-2">{method === 'table' ? '数据表格' : '数据截图'}<span className="mt-1.5 flex min-h-20 cursor-pointer items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/40 px-4 text-center text-xs font-bold text-emerald-800"><input type="file" multiple={method === 'screenshot'} accept={method === 'table' ? '.csv,.xlsx' : '.jpg,.jpeg,.png,.webp,.gif'} className="sr-only" onChange={event => { selectEvidence(event.target.files); event.currentTarget.value = ''; }} />{evidenceFiles.length > 0 ? evidenceFiles.map(file => file.name).join('、') : method === 'table' ? '选择 CSV 或 XLSX 文件，单个不超过 110 MB' : '选择图片，单个不超过 110 MB'}</span></label>}
        {METRIC_FIELDS.map(([key, label]) => <label key={key} className="text-xs font-bold text-text-secondary">{label}<input type="number" min={0} step={1} value={metrics[key] || ''} onChange={event => { setMetrics(current => ({ ...current, [key]: event.target.value })); setError(''); }} placeholder="未获取可留空" className={INPUT_CLASS} /></label>)}
        <label className="text-xs font-bold text-text-secondary sm:col-span-2">备注<textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={1000} rows={3} placeholder="选填" className={TEXTAREA_CLASS} /></label>
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p>}
    </DialogFrame>
  );
}
