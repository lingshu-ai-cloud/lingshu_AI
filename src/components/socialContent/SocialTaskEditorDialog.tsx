import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  Loader2,
  PackageCheck,
  X,
} from 'lucide-react';
import type {
  SocialContentTaskDetail,
  SocialWorkPackageCard,
  SocialWorkPackageKind,
} from '../../../shared/contracts/socialContentWorkflow';
import {
  validateSocialContentDraft,
  type SocialContentDraft,
} from '../../lib/socialContentModel';
import {
  plannedSocialContentSourceCount,
  socialContentSourceLimitMessage,
} from '../../lib/socialContentSourcePicker';
import {
  FORMAT_OPTIONS,
  GOAL_OPTIONS,
  PACKAGE_META,
  PLATFORM_OPTIONS,
  availablePackagesByKind,
  optionLabel,
  packageVersionLabel,
  taskToDraft,
} from './socialContentUi';
import SocialTaskSourcesStep from './SocialTaskSourcesStep';

const STEPS = ['任务', '资料', '发布要求', '作业方案', '确认'] as const;
const PACKAGE_KINDS: SocialWorkPackageKind[] = ['industry_launch', 'content_rocket', 'task_express'];
const INPUT_CLASS = 'mt-1.5 h-11 w-full rounded-xl border border-border bg-white px-3 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';

interface SocialTaskEditorDialogProps {
  open: boolean;
  sessionKey: string;
  task: SocialContentTaskDetail | null;
  catalog: SocialWorkPackageCard[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: SocialContentDraft, files: File[], start: boolean) => Promise<void>;
}

function ToggleGroup({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: readonly (readonly [string, string])[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="text-xs font-bold text-text-secondary">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map(([value, title]) => {
          const active = selected.includes(value);
          return (
            <button key={value} type="button" aria-pressed={active} onClick={() => onChange(active ? selected.filter(item => item !== value) : [...selected, value])} className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${active ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-border bg-white text-text-secondary hover:border-emerald-200'}`}>
              {active && <Check size={12} className="mr-1 inline" />}{title}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function BriefStep({ draft, update }: { draft: SocialContentDraft; update: (changes: Partial<SocialContentDraft>) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className="text-xs font-bold text-text-secondary md:col-span-2">任务名称<span className="text-rose-600"> *</span><input autoFocus value={draft.title} onChange={event => update({ title: event.target.value })} maxLength={100} placeholder="例如：九月新品社媒内容" className={INPUT_CLASS} /></label>
      <label className="text-xs font-bold text-text-secondary">产品或业务主题<span className="text-rose-600"> *</span><input value={draft.productName} onChange={event => update({ productName: event.target.value })} maxLength={160} placeholder="填写产品、服务或活动" className={INPUT_CLASS} /></label>
      <label className="text-xs font-bold text-text-secondary">主要目标<span className="text-rose-600"> *</span><select value={draft.primaryGoal} onChange={event => update({ primaryGoal: event.target.value })} className={INPUT_CLASS}><option value="">请选择</option>{GOAL_OPTIONS.map(goal => <option key={goal}>{goal}</option>)}</select></label>
      <label className="text-xs font-bold text-text-secondary">目标客户<span className="text-rose-600"> *</span><input value={draft.audience} onChange={event => update({ audience: event.target.value })} maxLength={500} placeholder="例如：德国户外露营家庭" className={INPUT_CLASS} /></label>
      <label className="text-xs font-bold text-text-secondary">目标市场<span className="text-rose-600"> *</span><input value={draft.market} onChange={event => update({ market: event.target.value })} maxLength={160} placeholder="多个市场用逗号分隔" className={INPUT_CLASS} /></label>
      <label className="text-xs font-bold text-text-secondary">内容语言<span className="text-rose-600"> *</span><input value={draft.language} onChange={event => update({ language: event.target.value })} maxLength={120} placeholder="多个语言用逗号分隔" className={INPUT_CLASS} /></label>
      <label className="text-xs font-bold text-text-secondary">期望交付日期<input type="date" value={draft.desiredDeliveryAt} min={new Date().toISOString().slice(0, 10)} onChange={event => update({ desiredDeliveryAt: event.target.value })} className={INPUT_CLASS} /></label>
    </div>
  );
}

function PublishingStep({ draft, update }: { draft: SocialContentDraft; update: (changes: Partial<SocialContentDraft>) => void }) {
  return (
    <div className="space-y-6">
      <ToggleGroup label="发布平台 *" options={PLATFORM_OPTIONS} selected={draft.platforms} onChange={platforms => update({ platforms })} />
      <ToggleGroup label="内容形式 *" options={FORMAT_OPTIONS} selected={draft.formats} onChange={formats => update({ formats })} />
      <div className="grid gap-4 md:grid-cols-3">
        <label className="text-xs font-bold text-text-secondary">内容数量<input type="number" min={1} max={50} value={draft.quantity} onChange={event => update({ quantity: Number(event.target.value) })} className={INPUT_CLASS} /></label>
        <label className="text-xs font-bold text-text-secondary">画面比例<select value={draft.aspectRatio} onChange={event => update({ aspectRatio: event.target.value })} className={INPUT_CLASS}><option>9:16</option><option>1:1</option><option>4:5</option><option>16:9</option></select></label>
        <label className="text-xs font-bold text-text-secondary">发布节奏<input value={draft.cadence} onChange={event => update({ cadence: event.target.value })} maxLength={200} placeholder="例如：每周二、四发布" className={INPUT_CLASS} /></label>
      </div>
    </div>
  );
}

function PackagesStep({ draft, update, catalog }: { draft: SocialContentDraft; update: (changes: Partial<SocialContentDraft>) => void; catalog: SocialWorkPackageCard[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {PACKAGE_KINDS.map(kind => {
        const options = availablePackagesByKind(catalog, kind);
        const selectedKey = draft.packageSelection[kind];
        const selected = options.find(item => item.packageKey === selectedKey);
        return (
          <section key={kind} className="rounded-2xl border border-emerald-200 bg-emerald-50/35 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm"><PackageCheck size={18} /></div>
            <h3 className="mt-4 text-sm font-black text-text-primary">{PACKAGE_META[kind].title}</h3>
            <p className="mt-1 text-xs text-text-muted">{PACKAGE_META[kind].caption}</p>
            <label className="mt-5 block text-[11px] font-bold text-text-secondary">本次使用<select value={selectedKey} onChange={event => update({ packageSelection: { ...draft.packageSelection, [kind]: event.target.value } })} className={INPUT_CLASS} disabled={options.length <= 1}>{options.map(item => <option key={`${item.packageKey}:${item.version}`} value={item.packageKey}>{item.name}</option>)}</select></label>
            {selected?.summary && <p className="mt-3 text-[11px] leading-5 text-text-secondary">{selected.summary}</p>}
            {selected?.requiredInputs.length ? <div className="mt-3"><p className="text-[10px] font-bold text-text-muted">需要资料</p><ul className="mt-1 space-y-1 text-[11px] text-text-secondary">{selected.requiredInputs.slice(0, 3).map(item => <li key={item}>· {item}</li>)}</ul></div> : null}
            {selected?.deliverables.length ? <div className="mt-3"><p className="text-[10px] font-bold text-text-muted">会完成</p><ul className="mt-1 space-y-1 text-[11px] text-text-secondary">{selected.deliverables.slice(0, 3).map(item => <li key={item}>· {item}</li>)}</ul></div> : null}
            {selected?.version && <p className="mt-3 text-[10px] font-semibold text-text-muted">{packageVersionLabel(selected.version)}</p>}
          </section>
        );
      })}
    </div>
  );
}

function ReviewStep({ draft, files, task }: { draft: SocialContentDraft; files: File[]; task: SocialContentTaskDetail | null }) {
  const existingCount = task?.sources.filter(source => source.status === 'active' && !draft.removedSourceIds.includes(source.sourceId)).length || 0;
  const rows = [
    ['任务', draft.title],
    ['产品', draft.productName],
    ['目标', draft.primaryGoal],
    ['市场与语言', [draft.market, draft.language].filter(Boolean).join(' · ')],
    ['发布平台', draft.platforms.map(value => optionLabel(PLATFORM_OPTIONS, value)).join('、')],
    ['内容形式', `${draft.formats.map(value => optionLabel(FORMAT_OPTIONS, value)).join('、')} · ${draft.quantity} 项`],
    ['本次资料', `${existingCount} 项已关联 · ${draft.selectedSources.length + files.length + draft.referenceLinks.length} 项新增`],
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
      <section className="rounded-2xl border border-border bg-white p-5"><h3 className="text-sm font-black text-text-primary">任务摘要</h3><dl className="mt-4 divide-y divide-border">{rows.map(([label, value]) => <div key={label} className="grid gap-1 py-3 sm:grid-cols-[120px_1fr]"><dt className="text-xs font-semibold text-text-muted">{label}</dt><dd className="text-xs font-bold text-text-primary">{value || '未填写'}</dd></div>)}</dl></section>
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5"><div className="flex items-center gap-2"><Building2 size={17} className="text-emerald-700" /><h3 className="text-sm font-black text-text-primary">本次方案</h3></div><div className="mt-4 space-y-3">{PACKAGE_KINDS.map(kind => <div key={kind} className="rounded-xl bg-white px-3 py-2.5"><p className="text-xs font-bold text-text-primary">{PACKAGE_META[kind].title}</p><p className="mt-0.5 text-[10px] text-text-muted">{PACKAGE_META[kind].caption}</p></div>)}</div>{draft.desiredDeliveryAt && <div className="mt-4 flex items-center gap-2 text-xs font-bold text-text-secondary"><CalendarDays size={14} />期望 {new Date(`${draft.desiredDeliveryAt}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })} 交付</div>}</section>
    </div>
  );
}

export default function SocialTaskEditorDialog({ open, sessionKey, task, catalog, busy, onClose, onSubmit }: SocialTaskEditorDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(() => taskToDraft(task, catalog));
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const sourceLimitMessage = useMemo(() => socialContentSourceLimitMessage(
    plannedSocialContentSourceCount(task?.sources || [], draft, files.length),
  ), [draft, files.length, task]);

  useEffect(() => {
    if (!open) return;
    setDraft(taskToDraft(task, catalog));
    setFiles([]);
    setErrors([]);
    setStep(0);
    window.setTimeout(() => dialogRef.current?.focus(), 0);
  }, [open, sessionKey]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  const issues = useMemo(() => {
    const next = validateSocialContentDraft(draft);
    const activeSources = task?.sources.filter(source => source.status === 'active' && !draft.removedSourceIds.includes(source.sourceId)) || [];
    if (sourceLimitMessage) next[1] = [...(next[1] || []), sourceLimitMessage];
    if ((files.length > 0 || activeSources.some(source => source.kind === 'material' || source.kind === 'reference_link')) && next[1]) {
      next[1] = next[1].filter(item => !item.includes('素材'));
    }
    if (activeSources.some(source => source.kind === 'knowledge') && next[1]) {
      next[1] = next[1].filter(item => !item.includes('企业资料'));
    }
    return next;
  }, [draft, files, sourceLimitMessage, task]);
  const update = (changes: Partial<SocialContentDraft>) => { setDraft(current => ({ ...current, ...changes })); setErrors([]); };
  const next = () => {
    const currentIssues = issues[step] || [];
    if (currentIssues.length) { setErrors(currentIssues); return; }
    setErrors([]);
    setStep(value => Math.min(STEPS.length - 1, value + 1));
  };
  const submit = async (start: boolean) => {
    const allIssues = Object.values(issues).flat();
    if (sourceLimitMessage) { setErrors([sourceLimitMessage]); return; }
    if (start && allIssues.length) { setErrors(allIssues); return; }
    try {
      await onSubmit(draft, files, start);
    } catch (submitError) {
      setErrors([submitError instanceof Error ? submitError.message : '操作未完成，请重试']);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:p-5" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="social-task-editor-title" className="flex h-full w-full max-w-5xl flex-col overflow-hidden bg-[#f8faf9] shadow-2xl outline-none sm:max-h-[92vh] sm:rounded-2xl sm:border sm:border-border">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-white px-5 py-4 sm:px-6">
          <div><p className="text-[11px] font-bold text-emerald-700">社媒内容任务</p><h2 id="social-task-editor-title" className="mt-1 text-lg font-black text-text-primary">{task ? '完善任务' : '新建任务'}</h2></div>
          <button type="button" aria-label="关闭" disabled={busy} onClick={onClose} className="rounded-lg p-2 text-text-muted hover:bg-surface-2 disabled:opacity-50"><X size={19} /></button>
        </header>
        <nav className="shrink-0 border-b border-border bg-white px-4 py-3 sm:px-6" aria-label="新建任务步骤"><ol className="flex items-center gap-1 overflow-x-auto">{STEPS.map((label, index) => <li key={label} className="flex min-w-0 flex-1 items-center"><button type="button" onClick={() => index < step && setStep(index)} disabled={index > step || busy} className={`flex min-w-max items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-bold ${index === step ? 'bg-emerald-50 text-emerald-800' : index < step ? 'text-text-secondary hover:bg-surface-2' : 'text-text-muted'}`}><span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${index <= step ? 'bg-emerald-600 text-white' : 'bg-surface-2'}`}>{index < step ? <Check size={11} /> : index + 1}</span>{label}</button>{index < STEPS.length - 1 && <span className="mx-1 h-px min-w-3 flex-1 bg-border" />}</li>)}</ol></nav>
        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
          {step === 0 && <BriefStep draft={draft} update={update} />}
          {step === 1 && <SocialTaskSourcesStep draft={draft} update={update} files={files} setFiles={setFiles} onFileError={message => setErrors([message])} task={task} />}
          {step === 2 && <PublishingStep draft={draft} update={update} />}
          {step === 3 && <PackagesStep draft={draft} update={update} catalog={catalog} />}
          {step === 4 && <ReviewStep draft={draft} files={files} task={task} />}
          {errors.length > 0 && <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3"><p className="text-xs font-bold text-rose-800">请先完成以下内容</p><ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-rose-700">{errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
        </main>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-white px-5 py-4 sm:px-6">
          <button type="button" disabled={busy || step === 0} onClick={() => { setErrors([]); setStep(value => Math.max(0, value - 1)); }} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-bold text-text-secondary hover:bg-surface-2 disabled:invisible"><ArrowLeft size={14} />上一步</button>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" disabled={busy || !draft.title.trim() || !draft.primaryGoal.trim()} onClick={() => void submit(false)} className="rounded-xl border border-border bg-white px-4 py-2.5 text-xs font-bold text-text-secondary hover:bg-surface-2 disabled:opacity-50">保存草稿</button>
            {step < STEPS.length - 1 ? <button type="button" disabled={busy} onClick={next} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50">继续<ArrowRight size={14} /></button> : <button type="button" disabled={busy} onClick={() => void submit(true)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50">{busy && <Loader2 size={14} className="animate-spin" />}{task?.status === 'paused' ? '继续制作' : '开始制作'}</button>}
          </div>
        </footer>
      </div>
    </div>
  );
}
