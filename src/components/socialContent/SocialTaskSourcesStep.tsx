import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  FilePlus2,
  FileText,
  FolderOpen,
  Image,
  Loader2,
  RefreshCcw,
  Search,
  Trash2,
} from 'lucide-react';
import type { SocialContentSourceOption, SocialContentTaskDetail } from '../../../shared/contracts/socialContentWorkflow';
import { socialContentMaterialPolicy } from '../../../shared/socialContentMaterialPolicy';
import { socialContentApi } from '../../lib/socialContentApi';
import { SOCIAL_CONTENT_MAX_TASK_FILE_BYTES, validateSocialContentFile } from '../../lib/socialContentFiles';
import type { SocialContentDraft } from '../../lib/socialContentModel';
import {
  SOCIAL_CONTENT_SOURCE_QUERY_MAX_LENGTH,
  mergeSocialContentSourceOptions,
  plannedSocialContentSourceCount,
  socialContentSourceLimitMessage,
  socialContentSourceOptionsAfterFailure,
} from '../../lib/socialContentSourcePicker';

const INPUT_CLASS = 'mt-1.5 h-11 w-full rounded-xl border border-border bg-white px-3 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';
const TEXTAREA_CLASS = 'mt-1.5 w-full resize-y rounded-xl border border-border bg-white px-3 py-2.5 text-sm leading-6 text-text-primary outline-none transition placeholder:text-text-muted focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';

interface SocialTaskSourcesStepProps {
  draft: SocialContentDraft;
  update: (changes: Partial<SocialContentDraft>) => void;
  files: File[];
  setFiles: (files: File[]) => void;
  onFileError: (message: string) => void;
  task: SocialContentTaskDetail | null;
}

function SourceOptionIcon({ option }: { option: SocialContentSourceOption }) {
  if (option.kind === 'knowledge') return <Building2 size={16} />;
  if (option.type?.toLowerCase().includes('image')) return <Image size={16} />;
  return <FileText size={16} />;
}

function sourceTypeLabel(option: SocialContentSourceOption): string {
  if (option.kind === 'knowledge') return '企业知识';
  const type = option.type.toLowerCase();
  if (type.includes('image')) return '图片';
  if (type.includes('video')) return '视频';
  if (type.includes('audio')) return '音频';
  return '文件';
}

function SourceLibraryPicker({
  draft,
  update,
  task,
  files,
  onFileError,
}: Pick<SocialTaskSourcesStepProps, 'draft' | 'update' | 'task' | 'files' | 'onFileError'>) {
  const [kind, setKind] = useState<SocialContentSourceOption['kind']>('knowledge');
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<SocialContentSourceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'ready' | 'partial' | 'unavailable'>('ready');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const existingRefs = useMemo(() => new Set(
    (task?.sources || []).filter(source => source.status === 'active' && !draft.removedSourceIds.includes(source.sourceId)).map(source => `${source.kind}:${source.sourceRef}`),
  ), [task, draft.removedSourceIds]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      void socialContentApi.getSourceOptions(kind, query, page).then(result => {
        if (!cancelled) {
          setOptions(current => mergeSocialContentSourceOptions(current, result.items, page));
          setStatus(result.status);
          setTotalPages(result.totalPages);
        }
      }).catch(loadError => {
        if (!cancelled) {
          setOptions(current => socialContentSourceOptionsAfterFailure(current, page));
          setError(loadError instanceof Error ? loadError.message : '暂时无法读取已有资料');
        }
      }).finally(() => { if (!cancelled) setLoading(false); });
    }, query ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [kind, query, page, reloadKey]);

  const toggle = (option: SocialContentSourceOption) => {
    if (existingRefs.has(`${option.kind}:${option.sourceRef}`)) return;
    const active = draft.selectedSources.some(item => item.kind === option.kind && item.sourceRef === option.sourceRef);
    const selectedSources = active
      ? draft.selectedSources.filter(item => item.kind !== option.kind || item.sourceRef !== option.sourceRef)
      : [...draft.selectedSources, option];
    const limitMessage = socialContentSourceLimitMessage(plannedSocialContentSourceCount(
      task?.sources || [],
      { ...draft, selectedSources },
      files.length,
    ));
    if (!active && limitMessage) { onFileError(limitMessage); return; }
    update({ selectedSources });
  };

  return (
    <section className="rounded-2xl border border-border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-sm font-black text-text-primary">从已有资料选择</h3><p className="mt-0.5 text-[11px] text-text-muted">选中后将仅用于本次内容任务</p></div>
        {draft.selectedSources.length > 0 && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-800">已选 {draft.selectedSources.length} 项</span>}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl bg-surface-2 p-1">
          {([['knowledge', '企业资料'], ['material', '素材库']] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => { setKind(value); setPage(1); setTotalPages(1); setStatus('ready'); setOptions([]); }} className={`rounded-lg px-3 py-2 text-xs font-bold ${kind === value ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>{label}</button>
          ))}
        </div>
        <label className="relative min-w-[190px] flex-1"><span className="sr-only">搜索资料</span><Search size={14} className="pointer-events-none absolute left-3 top-3 text-text-muted" /><input value={query} maxLength={SOCIAL_CONTENT_SOURCE_QUERY_MAX_LENGTH} onChange={event => { setQuery(event.target.value); setPage(1); setTotalPages(1); setStatus('ready'); setOptions([]); }} placeholder={kind === 'knowledge' ? '搜索企业资料' : '搜索素材库'} className="h-10 w-full rounded-xl border border-border bg-white pl-9 pr-3 text-xs text-text-primary outline-none focus:border-emerald-500" /></label>
      </div>
      {status === 'partial' && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">目前仅显示部分可用资料</p>}
      <div className="mt-3 max-h-52 overflow-y-auto rounded-xl border border-border">
        {loading && options.length === 0 ? <div className="flex min-h-28 items-center justify-center gap-2 text-xs font-semibold text-text-muted"><Loader2 size={15} className="animate-spin text-emerald-600" />正在读取资料</div> : (error && options.length === 0) || status === 'unavailable' ? <div className="flex min-h-28 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-text-muted"><span>{error || '资料库暂时无法读取'}</span><button type="button" onClick={() => { setPage(1); setOptions([]); setReloadKey(value => value + 1); }} className="inline-flex items-center gap-1 font-bold text-emerald-700"><RefreshCcw size={12} />重新读取</button></div> : options.length === 0 ? <div className="flex min-h-28 items-center justify-center px-4 text-center text-xs text-text-muted">{query ? '没有找到匹配的资料' : kind === 'knowledge' ? '暂无可选的企业资料，可直接填写下方关键信息' : '暂无可选素材，可从本地上传'}</div> : <><ul className="divide-y divide-border">{options.map(option => {
          const key = `${option.kind}:${option.sourceRef}`;
          const alreadyLinked = existingRefs.has(key);
          const selected = alreadyLinked || draft.selectedSources.some(item => item.kind === option.kind && item.sourceRef === option.sourceRef);
          return <li key={option.optionId}><button type="button" disabled={alreadyLinked} aria-pressed={selected} onClick={() => toggle(option)} className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition ${selected ? 'bg-emerald-50/70' : 'hover:bg-surface-2'} disabled:cursor-default`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${selected ? 'bg-emerald-600 text-white' : 'bg-surface-2 text-text-muted'}`}>{selected ? <Check size={15} strokeWidth={3} /> : <SourceOptionIcon option={option} />}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-text-primary">{option.label}</span><span className="mt-0.5 block truncate text-[10px] text-text-muted">{sourceTypeLabel(option)}</span></span>{alreadyLinked && <span className="shrink-0 text-[10px] font-bold text-emerald-700">已关联</span>}</button></li>;
        })}</ul>{error ? <div className="flex items-center justify-center gap-2 border-t border-border p-2 text-[11px] text-amber-800"><span>{error}</span><button type="button" onClick={() => setReloadKey(value => value + 1)} className="font-bold text-emerald-700">重试</button></div> : page < totalPages && <div className="border-t border-border p-2 text-center"><button type="button" disabled={loading} onClick={() => setPage(value => value + 1)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">{loading && <Loader2 size={12} className="animate-spin" />}加载更多</button></div>}</>}
      </div>
    </section>
  );
}

export default function SocialTaskSourcesStep({ draft, update, files, setFiles, onFileError, task }: SocialTaskSourcesStepProps) {
  const materialPolicy = socialContentMaterialPolicy(draft.themeId || null);
  const existingSources = task?.sources.filter(source => source.status === 'active' && !draft.removedSourceIds.includes(source.sourceId)) || [];
  const removedSources = task?.sources.filter(source => source.status === 'active' && draft.removedSourceIds.includes(source.sourceId)) || [];
  const hasKnowledge = existingSources.some(source => source.kind === 'knowledge') || draft.selectedSources.some(source => source.kind === 'knowledge');
  const imagePattern = /\.(?:jpe?g|png|webp|gif)$/i;
  const videoPattern = /\.(?:mp4|mov|webm)$/i;
  const selectedMaterials = draft.selectedSources.filter(source => source.kind === 'material');
  const hasVideo = existingSources.some(source => source.kind === 'material' && videoPattern.test(source.label))
    || selectedMaterials.some(source => /video/i.test(source.type) || videoPattern.test(source.label))
    || files.some(file => /^video\//i.test(file.type) || videoPattern.test(file.name));
  const imageCount = existingSources.filter(source => source.kind === 'material' && imagePattern.test(source.label)).length
    + selectedMaterials.filter(source => /image/i.test(source.type) || imagePattern.test(source.label)).length
    + files.filter(file => /^image\//i.test(file.type) || imagePattern.test(file.name)).length;
  const hasMaterial = hasVideo || imageCount >= 2;
  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const next = [...files];
    Array.from(incoming).forEach(file => {
      const issue = validateSocialContentFile(file);
      if (issue) { onFileError(issue); return; }
      if (next.length >= 20) { onFileError('一次最多上传 20 个文件'); return; }
      if (next.reduce((total, item) => total + item.size, 0) + file.size > SOCIAL_CONTENT_MAX_TASK_FILE_BYTES) { onFileError('本次待上传文件合计不能超过 512 MB'); return; }
      if (next.includes(file)) return;
      const limitMessage = socialContentSourceLimitMessage(plannedSocialContentSourceCount(task?.sources || [], draft, next.length + 1));
      if (limitMessage) { onFileError(limitMessage); return; }
      next.push(file);
    });
    setFiles(next);
  };
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-xs leading-5 text-emerald-950"><span className="font-black">最省事的方式：{materialPolicy.quickStartTitle}。</span> 不需要先剪辑，也不用写脚本；系统会自动挑选不同镜头、生成自然口播和字幕。{materialPolicy.quickStartDetail}</div>
      <div className="grid gap-2 sm:grid-cols-2" aria-label="可发布质量准备情况">
        {[
          { ready: hasMaterial, label: materialPolicy.subjectLabel, detail: hasMaterial ? '已就绪，可以生成可发布成片' : '必需：上传视频，或至少 2 份不同图片/短片', icon: Image, required: true },
          { ready: hasKnowledge, label: '企业资料', detail: hasKnowledge ? '已选择可核验资料' : '选填：不提供时不会编造参数或功效', icon: Building2, required: false },
        ].map(item => <div key={item.label} className={`flex items-center gap-3 rounded-lg border px-3 py-3 ${item.ready ? 'border-emerald-100 bg-emerald-50/65' : item.required ? 'border-amber-200 bg-amber-50/70' : 'border-slate-200 bg-slate-50/70'}`}><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white ${item.ready ? 'text-emerald-700' : item.required ? 'text-amber-700' : 'text-slate-600'}`}>{item.ready ? <CheckCircle2 size={17} /> : <item.icon size={17} />}</span><div><p className="text-xs font-black text-text-primary">{item.label}<span className={`ml-2 text-[10px] ${item.ready ? 'text-emerald-700' : item.required ? 'text-amber-700' : 'text-slate-500'}`}>{item.ready ? '已就绪' : item.required ? '生成前必需' : '选填增强'}</span></p><p className="mt-0.5 text-[10px] text-text-muted">{item.detail}</p></div></div>)}
      </div>
      {existingSources.length > 0 && <section className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3"><p className="text-xs font-bold text-emerald-900">已关联 {existingSources.length} 项资料</p><div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">{existingSources.map(source => <span key={source.sourceId} className="inline-flex max-w-[260px] items-center gap-1 rounded-lg bg-white py-1 pl-2 pr-1 text-[11px] text-text-secondary"><span className="truncate">{source.label}</span><button type="button" aria-label={`移除关联 ${source.label}`} onClick={() => update({ removedSourceIds: [...draft.removedSourceIds, source.sourceId] })} className="shrink-0 rounded p-1 text-text-muted hover:bg-rose-50 hover:text-rose-600"><Trash2 size={11} /></button></span>)}</div></section>}
      {removedSources.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-900"><span className="font-bold">将移除 {removedSources.length} 项关联</span>{removedSources.map(source => <button key={source.sourceId} type="button" onClick={() => update({ removedSourceIds: draft.removedSourceIds.filter(id => id !== source.sourceId) })} className="rounded-lg bg-white px-2 py-1 font-bold shadow-sm">撤销 {source.label}</button>)}</div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.25fr]">
        <label className="group flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-emerald-400 bg-emerald-50/55 p-5 text-center transition hover:bg-emerald-50"><FilePlus2 size={24} className="text-emerald-700" /><span className="mt-3 text-sm font-black text-text-primary">{materialPolicy.uploadTitle}</span><span className="mt-1 text-xs text-text-muted">也支持 JPG、PNG、WebP 图片；视频无需提前剪辑，单个不超过 110 MB</span><span className="mt-2 rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-800 shadow-sm">推荐 9:16 · 画面清晰 · {materialPolicy.recommendedShots}</span><input type="file" multiple className="sr-only" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" onChange={event => { addFiles(event.target.files); event.currentTarget.value = ''; }} /></label>
        <div className="rounded-2xl border border-border bg-white p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-text-primary">待上传文件</p><p className="mt-0.5 text-[11px] text-text-muted">最多 20 个，合计不超过 512 MB</p></div><span className="rounded-full bg-surface-2 px-2 py-1 text-[11px] font-bold text-text-secondary">{files.length}</span></div>{files.length === 0 ? <div className="mt-5 flex items-center gap-2 text-xs text-text-muted"><FolderOpen size={15} />尚未选择新文件</div> : <ul className="mt-3 max-h-36 space-y-2 overflow-y-auto">{files.map(file => <li key={`${file.name}:${file.size}:${file.lastModified}`} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2"><span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{file.name}</span><span className="shrink-0 text-[10px] text-text-muted">{file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(file.size / 1024)} KB`}</span><button type="button" aria-label={`移除 ${file.name}`} onClick={() => setFiles(files.filter(item => item !== file))} className="rounded p-1 text-text-muted hover:bg-white hover:text-rose-600"><Trash2 size={13} /></button></li>)}</ul>}</div>
      </div>
      <SourceLibraryPicker draft={draft} update={update} task={task} files={files} onFileError={onFileError} />
      <details className="rounded-lg border border-border bg-surface-2/45 px-3 py-2.5">
        <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-black text-text-secondary">参考信息与表达限制<span className="inline-flex items-center gap-1 text-[10px] font-semibold text-text-muted">选填<ChevronDown size={13} /></span></summary>
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          <label className="block text-xs font-bold text-text-secondary">参考链接<textarea value={draft.referenceLinks.join('\n')} onChange={event => update({ referenceLinks: event.target.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean) })} rows={3} placeholder="每行一个公开链接" className={TEXTAREA_CLASS} /></label>
          <div className="grid gap-4 md:grid-cols-2"><label className="text-xs font-bold text-text-secondary">待核实任务备注<textarea value={draft.keyFacts} onChange={event => update({ keyFacts: event.target.value })} rows={5} maxLength={3000} placeholder="可填写产品、品牌或客户场景线索；这些内容不会替代企业中心已确认资料" className={TEXTAREA_CLASS} /><span className="mt-1 block text-[10px] font-semibold text-amber-700">备注仅作创作线索，需在企业中心确认后才能作为对外事实。</span></label><div className="space-y-4"><label className="block text-xs font-bold text-text-secondary">不能使用的表达<textarea value={draft.prohibitedClaims} onChange={event => update({ prohibitedClaims: event.target.value })} rows={2} maxLength={2000} placeholder="每行一项" className={TEXTAREA_CLASS} /></label><label className="block text-xs font-bold text-text-secondary">希望客户采取的行动<input value={draft.callToAction} onChange={event => update({ callToAction: event.target.value })} maxLength={500} placeholder="例如：发送产品手册、预约咨询" className={INPUT_CLASS} /></label></div></div>
        </div>
      </details>
    </div>
  );
}
