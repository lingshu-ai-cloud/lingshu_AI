import { useMemo, useState } from 'react';
import { Alert, Button, Input, Modal, Select } from 'antd';
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

const INPUT_CLASS = 'mt-1.5 w-full';
const TEXTAREA_CLASS = 'mt-1.5 w-full';

function nowForInput(): string {
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return now.toISOString().slice(0, 16);
}

function DialogFrame({ title, eyebrow, busy, onClose, children, footer }: { title: string; eyebrow: string; busy: boolean; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <Modal open title={title} width={640} onCancel={onClose} keyboard={!busy} closable={!busy} mask={{ closable: false }}
      footer={<div className="flex justify-end gap-2">{footer}</div>} styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}>
      <p className="mb-5 text-sm text-text-secondary">{eyebrow}</p>
      {children}
    </Modal>
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
    <DialogFrame title="登记发布结果" eyebrow={task.brief.title} busy={busy} onClose={onClose} footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button type="primary" loading={busy} onClick={() => void submit()}>保存发布记录</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-bold text-text-secondary">交付版本<Select aria-label="交付版本" value={packageId} onChange={setPackageId} className={INPUT_CLASS} options={readyPackages.map(item => ({ value: item.packageId, label: packageVersionLabel(item.version) }))} /></label>
        <label className="text-xs font-bold text-text-secondary">发布平台<Select aria-label="发布平台" value={platform} onChange={setPlatform} className={INPUT_CLASS} options={[...new Set([...task.brief.platforms, ...PLATFORM_OPTIONS.map(item => item[0])])].map(value => ({ value, label: optionLabel(PLATFORM_OPTIONS, value) }))} /></label>
        <label className="text-xs font-bold text-text-secondary">账号名称<Input value={accountLabel} onChange={event => setAccountLabel(event.target.value)} maxLength={120} placeholder="选填" className={INPUT_CLASS} /></label>
        <label className="text-xs font-bold text-text-secondary">实际发布时间<Input type="datetime-local" value={publishedAt} onChange={event => setPublishedAt(event.target.value)} className={INPUT_CLASS} /></label>
        <label className="text-xs font-bold text-text-secondary sm:col-span-2">发布链接<Input type="url" value={publicUrl} onChange={event => { setPublicUrl(event.target.value); setError(''); }} placeholder="https://" className={INPUT_CLASS} /></label>
        <label className="text-xs font-bold text-text-secondary sm:col-span-2">平台作品编号<Input value={platformPostId} onChange={event => { setPlatformPostId(event.target.value); setError(''); }} maxLength={200} placeholder="发布链接和作品编号至少填写一项" className={INPUT_CLASS} /></label>
        <label className="text-xs font-bold text-text-secondary sm:col-span-2">备注<Input.TextArea value={notes} onChange={event => setNotes(event.target.value)} maxLength={1000} rows={3} placeholder="选填" className={TEXTAREA_CLASS} /></label>
      </div>
      {error && <Alert className="mt-4" type="error" showIcon title={error} />}
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
    <DialogFrame title="退回修改" eyebrow={`${artifactKindLabel(artifact.kind)} · ${packageVersionLabel(artifact.version)}`} busy={busy} onClose={onClose} footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button type="primary" loading={busy} onClick={() => void submit()}>提交修改要求</Button></>}>
      <label className="block text-xs font-bold text-text-secondary">修改要求<Input.TextArea autoFocus value={note} onChange={event => { setNote(event.target.value); setError(''); }} maxLength={2000} rows={6} placeholder="请说明需要修改的画面、文案、事实或平台版本" className={TEXTAREA_CLASS} /></label>
      {error && <Alert className="mt-4" type="error" showIcon title={error} />}
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
    <DialogFrame title="批量退回修改" eyebrow={`本批 ${count} 项内容`} busy={busy} onClose={onClose} footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button type="primary" loading={busy} onClick={() => void submit()}>提交本批修改</Button></>}>
      <label className="block text-xs font-bold text-text-secondary">本批统一修改要求<Input.TextArea autoFocus value={note} onChange={event => { setNote(event.target.value); setError(''); }} maxLength={2000} rows={6} placeholder="例如：本批开头过于像广告，保留产品事实，统一改为客户问题切入" className={TEXTAREA_CLASS} /></label>
      <p className="mt-3 text-xs leading-5 text-text-muted">这条要求会应用到本批所有待验收内容；单项例外可在内容创作页单独处理。</p>
      {error && <Alert className="mt-4" type="error" showIcon title={error} />}
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
    <DialogFrame title="回传发布数据" eyebrow={task.brief.title} busy={busy} onClose={onClose} footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button type="primary" loading={busy} onClick={() => void submit()}>保存数据</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-bold text-text-secondary sm:col-span-2">发布记录<Select aria-label="发布记录" value={publicationId || undefined} placeholder="请选择" onChange={setPublicationId} className={INPUT_CLASS} options={task.publications.map(item => ({ value: item.publicationId, label: `${optionLabel(PLATFORM_OPTIONS, item.platform)} · ${new Date(item.publishedAt).toLocaleDateString('zh-CN')}` }))} /></label>
        {selectedPublication && <div className="sm:col-span-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-secondary">{selectedPublication.accountLabel || optionLabel(PLATFORM_OPTIONS, selectedPublication.platform)}{selectedPublication.publicUrl ? ` · ${selectedPublication.publicUrl}` : ''}</div>}
        <label className="text-xs font-bold text-text-secondary">数据时间<Input type="datetime-local" value={capturedAt} onChange={event => setCapturedAt(event.target.value)} className={INPUT_CLASS} /></label>
        <label className="text-xs font-bold text-text-secondary">回传方式<Select aria-label="回传方式" value={method} onChange={value => { setMethod(value as SocialMetricSubmission['method']); setEvidenceFiles([]); setError(''); }} className={INPUT_CLASS} options={[{ value: 'manual', label: '手工填写' }, { value: 'link', label: '发布链接' }, { value: 'platform_id', label: '作品编号' }, { value: 'table', label: '上传表格' }, { value: 'screenshot', label: '上传截图' }]} /></label>
        {(method === 'table' || method === 'screenshot') && <label className="text-xs font-bold text-text-secondary sm:col-span-2">{method === 'table' ? '数据表格' : '数据截图'}<span className="mt-1.5 flex min-h-20 cursor-pointer items-center justify-center rounded-lg border border-dashed border-emerald-300 bg-emerald-50/40 px-4 text-center text-xs font-bold text-emerald-800"><input type="file" multiple={method === 'screenshot'} accept={method === 'table' ? '.csv,.xlsx' : '.jpg,.jpeg,.png,.webp,.gif'} className="sr-only" onChange={event => { selectEvidence(event.target.files); event.currentTarget.value = ''; }} />{evidenceFiles.length > 0 ? evidenceFiles.map(file => file.name).join('、') : method === 'table' ? '选择 CSV 或 XLSX 文件，单个不超过 110 MB' : '选择图片，单个不超过 110 MB'}</span></label>}
        {METRIC_FIELDS.map(([key, label]) => <label key={key} className="text-xs font-bold text-text-secondary">{label}<Input type="number" min={0} step={1} value={metrics[key] || ''} onChange={event => { setMetrics(current => ({ ...current, [key]: event.target.value })); setError(''); }} placeholder="未获取可留空" className={INPUT_CLASS} /></label>)}
        <label className="text-xs font-bold text-text-secondary sm:col-span-2">备注<Input.TextArea value={notes} onChange={event => setNotes(event.target.value)} maxLength={1000} rows={3} placeholder="选填" className={TEXTAREA_CLASS} /></label>
      </div>
      {error && <Alert className="mt-4" type="error" showIcon title={error} />}
    </DialogFrame>
  );
}
