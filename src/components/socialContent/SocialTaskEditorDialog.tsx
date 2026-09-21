import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  SocialContentTaskDetail,
  SocialContentTaskMode,
  SocialContentThemeId,
  SocialWorkPackageCard,
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
  PLATFORM_OPTIONS,
  SOCIAL_THEME_OPTIONS,
  optionLabel,
  taskToDraft,
} from './socialContentUi';
import SocialTaskSourcesStep from './SocialTaskSourcesStep';
import SocialThemeCards from './SocialThemeCards';

const STEPS = ['内容目标', '准备素材', '确认生成'] as const;
const INPUT_CLASS = 'mt-1.5 h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/10';

const DEFAULT_GOAL_BY_THEME: Record<SocialContentThemeId, string> = {
  product_value: '产品种草',
  scenario_solution: '客户教育',
  supplier_capability: '品牌认知',
  customization_process: '获取咨询',
  customer_case: '品牌认知',
};

function suggestedGoal(themeId: SocialContentThemeId | ''): string {
  return themeId ? DEFAULT_GOAL_BY_THEME[themeId] : '获取咨询';
}

function suggestedTaskTitle(draft: Pick<SocialContentDraft, 'mode' | 'themeId' | 'customTopic' | 'productName'>): string {
  const product = draft.productName.trim();
  if (draft.mode === 'weekly') return product ? `${product} · 本周内容计划` : '本周内容计划';
  const theme = draft.customTopic.trim().slice(0, 40) || SOCIAL_THEME_OPTIONS.find(item => item.id === draft.themeId)?.title || '自定义主题';
  return product ? `${product} · ${theme}` : `${theme}内容`;
}

interface SocialTaskEditorDialogProps {
  open: boolean;
  sessionKey: string;
  task: SocialContentTaskDetail | null;
  initialThemeId?: SocialContentThemeId | '';
  initialMode?: SocialContentTaskMode;
  lockMode?: boolean;
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
      <legend className="text-xs font-black text-text-primary">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map(([value, title]) => {
          const active = selected.includes(value);
          return (
            <button key={value} type="button" aria-pressed={active} onClick={() => onChange(active ? selected.filter(item => item !== value) : [...selected, value])} className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${active ? 'border-accent bg-accent-glow text-accent-dim shadow-[0_0_0_1px_var(--color-accent)]' : 'border-border bg-white text-text-secondary hover:border-border-bright'}`}>
              {active && <Check size={12} className="mr-1 inline" strokeWidth={3} />}{title}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function ModeSelector({ draft, update, locked }: { draft: SocialContentDraft; update: (changes: Partial<SocialContentDraft>) => void; locked: boolean }) {
  if (locked) {
    const weekly = draft.mode === 'weekly';
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-100 bg-emerald-50/65 px-3 py-2.5">
        <div><p className="text-xs font-black text-emerald-900">{weekly ? '周计划 · 批量安排' : '立即创作 · 单条内容'}</p><p className="mt-0.5 text-[10px] text-emerald-800">{weekly ? '本周计划在首页统一调整' : '周计划请从首页的数字员工进入'}</p></div>
        <span className="rounded-md bg-white px-2 py-1 text-[10px] font-black text-emerald-800 shadow-sm">{weekly ? `${draft.quantity} 条` : '1 条'}</span>
      </div>
    );
  }
  return (
    <fieldset>
      <legend className="text-xs font-bold text-text-secondary">创作方式</legend>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1">
        <button type="button" aria-pressed={draft.mode === 'instant'} onClick={() => update({ mode: 'instant', quantity: 1 })} className={`rounded-md px-4 py-2.5 text-left text-xs font-bold ${draft.mode === 'instant' ? 'bg-white text-accent-dim shadow-sm' : 'text-text-muted'}`}><strong className="block text-sm">立即创作</strong><span className="mt-0.5 block font-medium">生成 1 条内容</span></button>
        <button type="button" aria-pressed={draft.mode === 'weekly'} onClick={() => update({ mode: 'weekly' })} className={`rounded-md px-4 py-2.5 text-left text-xs font-bold ${draft.mode === 'weekly' ? 'bg-white text-accent-dim shadow-sm' : 'text-text-muted'}`}><strong className="block text-sm">周计划</strong><span className="mt-0.5 block font-medium">安排整周内容</span></button>
      </div>
    </fieldset>
  );
}

function BriefStep({ draft, update, lockMode }: { draft: SocialContentDraft; update: (changes: Partial<SocialContentDraft>) => void; lockMode: boolean }) {
  const selectedTheme = SOCIAL_THEME_OPTIONS.find(item => item.id === draft.themeId);
  const customSelected = !draft.themeId;
  const updateWithSuggestions = (changes: Partial<SocialContentDraft>) => {
    const keepSuggestedTitle = !draft.title.trim() || draft.title === suggestedTaskTitle(draft);
    const keepSuggestedGoal = !draft.primaryGoal.trim() || draft.primaryGoal === suggestedGoal(draft.themeId);
    const nextDraft = { ...draft, ...changes };
    update({
      ...changes,
      ...(keepSuggestedTitle ? { title: suggestedTaskTitle(nextDraft) } : {}),
      ...(keepSuggestedGoal ? { primaryGoal: suggestedGoal(nextDraft.themeId) } : {}),
    });
  };
  return (
    <div className="space-y-5">
      <ModeSelector draft={draft} update={update} locked={lockMode} />

      <fieldset>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><legend className="text-sm font-black text-text-primary">这条内容主要讲什么？<span className="text-rose-600"> *</span></legend><p className="mt-1 text-[11px] text-text-muted">主题只决定表达方向，拍摄建议不会阻止你开始。</p></div>
        </div>
        <div className="mt-3"><SocialThemeCards compact includeCustom selected={draft.themeId} onSelect={themeId => updateWithSuggestions({ themeId })} /></div>
        {customSelected && <label className="mt-3 block text-xs font-bold text-text-secondary">写下你的主题<input autoFocus value={draft.customTopic} onChange={event => updateWithSuggestions({ customTopic: event.target.value })} maxLength={300} placeholder="例如：展示我们给连锁美容院做小批量面膜定制的过程" className={INPUT_CLASS} /></label>}
        {selectedTheme && <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted"><span className="mr-1 font-black text-text-secondary">可准备</span>{selectedTheme.shots.map(shot => <span key={shot} className="rounded-md bg-surface-2 px-2 py-1 font-semibold">{shot}</span>)}</div>}
      </fieldset>

      <section className="rounded-xl border border-border bg-white p-4 sm:p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-xs font-bold text-text-secondary">产品或业务<span className="text-rose-600"> *</span><input value={draft.productName} onChange={event => updateWithSuggestions({ productName: event.target.value })} maxLength={160} placeholder="填写主推产品、服务或活动" className={INPUT_CLASS} /></label>
          <label className="text-xs font-bold text-text-secondary">目标客户<span className="text-rose-600"> *</span><input value={draft.audience} onChange={event => update({ audience: event.target.value })} maxLength={500} placeholder="例如：德国户外露营家庭" className={INPUT_CLASS} /></label>
          <label className="text-xs font-bold text-text-secondary md:col-span-2">{draft.mode === 'instant' ? <>具体想讲什么<span className="text-rose-600"> *</span></> : <>本周内容重点<span className="ml-1 font-medium text-text-muted">选填</span></>}<input value={draft.topic} onChange={event => update({ topic: event.target.value })} maxLength={300} placeholder="例如：3 个镜头看懂一支精华从打样到出货" className={INPUT_CLASS} /></label>
          <fieldset className="md:col-span-2"><legend className="text-xs font-bold text-text-secondary">希望客户看完后<span className="ml-1 font-medium text-text-muted">已推荐，可调整</span></legend><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{GOAL_OPTIONS.map(goal => <button key={goal} type="button" aria-pressed={draft.primaryGoal === goal} onClick={() => update({ primaryGoal: goal })} className={`rounded-lg border px-3 py-2.5 text-left text-xs font-bold transition ${draft.primaryGoal === goal ? 'border-accent bg-accent-glow text-accent-dim shadow-[0_0_0_1px_var(--color-accent)]' : 'border-border bg-white text-text-secondary hover:border-border-bright'}`}>{draft.primaryGoal === goal && <Check size={12} className="mr-1.5 inline" strokeWidth={3} />}{goal}</button>)}</div></fieldset>
        </div>

        <details className="mt-4 rounded-lg border border-border bg-surface-2/45 px-3 py-2.5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-black text-text-secondary">任务命名、市场与交付<span className="inline-flex items-center gap-1 text-[10px] font-semibold text-text-muted">当前：{draft.market} · {draft.language}<ChevronDown size={13} /></span></summary>
          <div className="mt-3 grid gap-4 border-t border-border pt-3 md:grid-cols-2">
            <label className="text-xs font-bold text-text-secondary md:col-span-2">任务名称<span className="ml-1 font-medium text-text-muted">已自动生成，可修改</span><input value={draft.title} onChange={event => update({ title: event.target.value })} maxLength={100} className={INPUT_CLASS} /></label>
            <label className="text-xs font-bold text-text-secondary">目标市场<span className="text-rose-600"> *</span><input value={draft.market} onChange={event => update({ market: event.target.value })} maxLength={160} placeholder="多个市场用逗号分隔" className={INPUT_CLASS} /></label>
            <label className="text-xs font-bold text-text-secondary">内容语言<span className="text-rose-600"> *</span><input value={draft.language} onChange={event => update({ language: event.target.value })} maxLength={120} placeholder="多个语言用逗号分隔" className={INPUT_CLASS} /></label>
            <label className="text-xs font-bold text-text-secondary md:col-span-2">期望交付日期<input type="date" value={draft.desiredDeliveryAt} min={new Date().toISOString().slice(0, 10)} onChange={event => update({ desiredDeliveryAt: event.target.value })} className={INPUT_CLASS} /></label>
          </div>
        </details>
      </section>
    </div>
  );
}

function optionalNumber(value: string): number | null {
  return value === '' ? null : Number(value);
}

function ScaleStep({ draft, update }: { draft: SocialContentDraft; update: (changes: Partial<SocialContentDraft>) => void }) {
  return (
    <section className="rounded-xl border border-border bg-white p-4 sm:p-5">
      <h3 className="text-sm font-black text-text-primary">输出设置</h3>
      <p className="mt-1 text-[11px] text-text-muted">先确认发布平台与内容形式，其余参数可保持默认。</p>
      <div className="mt-5 space-y-5">
        <ToggleGroup label="发布平台 *" options={PLATFORM_OPTIONS} selected={draft.platforms} onChange={platforms => update({ platforms })} />
        <ToggleGroup label="内容形式 *" options={FORMAT_OPTIONS} selected={draft.formats} onChange={formats => update({ formats })} />
        <div className="grid gap-4 md:grid-cols-2">
          {draft.mode === 'weekly' && <label className="text-xs font-bold text-text-secondary">计划内容数量<input type="number" min={1} max={100} value={draft.quantity} onChange={event => update({ quantity: Number(event.target.value) })} className={INPUT_CLASS} /></label>}
          <label className="text-xs font-bold text-text-secondary">画面比例<select value={draft.aspectRatio} onChange={event => update({ aspectRatio: event.target.value })} className={INPUT_CLASS}><option>9:16</option><option>1:1</option><option>4:5</option><option>16:9</option></select></label>
        </div>
      </div>

      <details className="mt-5 rounded-lg border border-border bg-surface-2/45 px-3 py-2.5">
        <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-black text-text-secondary">高级设置<span className="inline-flex items-center gap-1 text-[10px] font-semibold text-text-muted">选填<ChevronDown size={13} /></span></summary>
        <div className="mt-4 space-y-5 border-t border-border pt-4">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-xs font-bold text-text-secondary">任务预算<input type="number" min={0} step="0.01" value={draft.weeklyBudgetCny ?? ''} onChange={event => update({ weeklyBudgetCny: optionalNumber(event.target.value) })} placeholder="人民币" className={INPUT_CLASS} /></label>
            <label className="text-xs font-bold text-text-secondary">单条预算上限<input type="number" min={0} step="0.01" value={draft.perItemBudgetCny ?? ''} onChange={event => update({ perItemBudgetCny: optionalNumber(event.target.value) })} placeholder="人民币" className={INPUT_CLASS} /></label>
            <label className="text-xs font-bold text-text-secondary">重试预留<input type="number" min={0} step="0.01" value={draft.retryReserveCny ?? ''} onChange={event => update({ retryReserveCny: optionalNumber(event.target.value) })} placeholder="人民币" className={INPUT_CLASS} /></label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-xs font-bold text-text-secondary">发布节奏<input value={draft.cadence} onChange={event => update({ cadence: event.target.value })} maxLength={200} placeholder="例如：每周二、四发布" className={INPUT_CLASS} /></label>
            <label className="text-xs font-bold text-text-secondary">可集中拍摄时间<input type="number" min={0} max={10080} value={draft.shootingWindowMinutes ?? ''} onChange={event => update({ shootingWindowMinutes: optionalNumber(event.target.value) })} placeholder="分钟" className={INPUT_CLASS} /></label>
          </div>
          <label className="block text-xs font-bold text-text-secondary">特殊要求<textarea value={draft.specialRequirements} onChange={event => update({ specialRequirements: event.target.value })} maxLength={2000} rows={3} placeholder="例如：新品上市，本次暂不使用促销表达" className="mt-1.5 w-full resize-y rounded-lg border border-border bg-white px-3 py-2.5 text-sm leading-6 text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/10" /></label>
        </div>
      </details>
    </section>
  );
}

function ReviewStep({ draft, files, task }: { draft: SocialContentDraft; files: File[]; task: SocialContentTaskDetail | null }) {
  const activeSources = task?.sources.filter(source => source.status === 'active' && !draft.removedSourceIds.includes(source.sourceId)) || [];
  const existingCount = activeSources.length;
  const existingRefs = new Set(activeSources.map(source => `${source.kind}:${source.sourceRef}`));
  const existingMaterialLabels = new Set(activeSources.filter(source => source.kind === 'material').map(source => source.label.trim().toLowerCase()));
  const pendingSelectedCount = draft.selectedSources.filter(source => !existingRefs.has(`${source.kind}:${source.sourceRef}`)).length;
  const pendingFileCount = files.filter(file => !existingMaterialLabels.has(file.name.trim().toLowerCase())).length;
  const pendingLinkCount = draft.referenceLinks.filter(link => !existingRefs.has(`reference_link:${link}`)).length;
  const pendingCount = pendingSelectedCount + pendingFileCount + pendingLinkCount;
  const theme = draft.customTopic || SOCIAL_THEME_OPTIONS.find(item => item.id === draft.themeId)?.title || '待确认';
  const output = `${draft.platforms.map(value => optionLabel(PLATFORM_OPTIONS, value)).join('、')} · ${draft.formats.map(value => optionLabel(FORMAT_OPTIONS, value)).join('、')}`;

  return (
    <aside className="rounded-xl border border-border bg-[#173d31] p-5 text-white lg:sticky lg:top-0">
      <div className="flex items-center gap-2 text-[10px] font-black tracking-[0.1em] text-emerald-200"><Sparkles size={13} />READY TO CREATE</div>
      <h3 className="mt-3 text-base font-black">{draft.title || '待命名内容任务'}</h3>
      <dl className="mt-5 space-y-3 text-xs">
        {[['主题', theme], ['具体内容', draft.topic], ['产品', draft.productName], ['客户', draft.audience], ['目标', draft.primaryGoal], ['输出', output], ['资料', `${existingCount} 项已关联 · ${pendingCount} 项待新增`]].map(([label, value]) => <div key={label} className="border-b border-white/10 pb-3 last:border-0 last:pb-0"><dt className="text-[10px] font-bold text-emerald-200/80">{label}</dt><dd className="mt-1 leading-5 text-white/90">{value || '未填写'}</dd></div>)}
      </dl>
      <div className="mt-5 rounded-lg bg-white/10 px-3 py-3 text-[11px] leading-5 text-white/80">确认后，编导 Agent 会自动准备脚本、口播、字幕与镜头节奏，内容 Agent 再按方案生成视频；你无需逐项填写，只需审核成品。</div>
      {draft.desiredDeliveryAt && <div className="mt-3 flex items-center gap-2 text-[11px] font-bold text-emerald-100"><CalendarDays size={13} />期望 {new Date(`${draft.desiredDeliveryAt}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })} 交付</div>}
    </aside>
  );
}

export default function SocialTaskEditorDialog({
  open,
  sessionKey,
  task,
  initialThemeId,
  initialMode,
  lockMode = false,
  catalog,
  busy,
  onClose,
  onSubmit,
}: SocialTaskEditorDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(() => taskToDraft(task, catalog));
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const sourceLimitMessage = useMemo(() => socialContentSourceLimitMessage(plannedSocialContentSourceCount(task?.sources || [], draft, files.length)), [draft, files.length, task]);

  useEffect(() => {
    if (!open) return;
    const nextDraft = taskToDraft(task, catalog);
    if (!task && initialThemeId !== undefined) nextDraft.themeId = initialThemeId;
    if (!task && initialMode) {
      nextDraft.mode = initialMode;
      if (initialMode === 'instant') nextDraft.quantity = 1;
    }
    if (!task) {
      nextDraft.primaryGoal = nextDraft.primaryGoal || suggestedGoal(nextDraft.themeId);
      nextDraft.title = nextDraft.title || suggestedTaskTitle(nextDraft);
    }
    setDraft(nextDraft);
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
    if (draft.mode === 'instant' && !draft.topic.trim()) next[0] = [...(next[0] || []), '请用一句话说明这条内容具体想讲什么'];
    const activeSources = task?.sources.filter(source => source.status === 'active' && !draft.removedSourceIds.includes(source.sourceId)) || [];
    if (sourceLimitMessage) next[1] = [...(next[1] || []), sourceLimitMessage];
    if ((files.length > 0 || activeSources.some(source => source.kind === 'material')) && next[1]) next[1] = next[1].filter(item => !item.includes('素材'));
    if (activeSources.some(source => source.kind === 'knowledge') && next[1]) next[1] = next[1].filter(item => !item.includes('企业资料'));
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
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="social-task-editor-title" className="flex h-full w-full max-w-6xl flex-col overflow-hidden bg-[#f6f8f5] shadow-2xl outline-none sm:max-h-[92vh] sm:rounded-xl sm:border sm:border-border">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-white px-5 py-4 sm:px-6">
          <div><p className="text-[10px] font-black tracking-[0.1em] text-accent">内容任务</p><h2 id="social-task-editor-title" className="mt-1 text-lg font-black text-text-primary">{task ? '完善内容任务' : initialMode === 'instant' ? '创建一条内容' : '新建内容任务'}</h2></div>
          <button type="button" aria-label="关闭" disabled={busy} onClick={onClose} className="rounded-lg p-2 text-text-muted hover:bg-surface-2 disabled:opacity-50"><X size={19} /></button>
        </header>

        <nav className="shrink-0 border-b border-border bg-white px-4 py-3 sm:px-6" aria-label="新建任务步骤">
          <ol className="mx-auto flex max-w-2xl items-center gap-2">
            {STEPS.map((label, index) => <li key={label} className="flex min-w-0 flex-1 items-center"><button type="button" onClick={() => index < step && setStep(index)} disabled={index > step || busy} className={`flex min-w-max items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-bold ${index === step ? 'bg-accent-glow text-accent-dim' : index < step ? 'text-text-secondary hover:bg-surface-2' : 'text-text-muted'}`}><span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] ${index <= step ? 'bg-accent text-white' : 'bg-surface-2'}`}>{index < step ? <Check size={11} strokeWidth={3} /> : index + 1}</span><span className="hidden sm:inline">{label}</span></button>{index < STEPS.length - 1 && <span className={`mx-1 h-px min-w-4 flex-1 ${index < step ? 'bg-accent' : 'bg-border'}`} />}</li>)}
          </ol>
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
          {step === 0 && <BriefStep draft={draft} update={update} lockMode={lockMode} />}
          {step === 1 && <SocialTaskSourcesStep draft={draft} update={update} files={files} setFiles={setFiles} onFileError={message => setErrors([message])} task={task} />}
          {step === 2 && <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"><ScaleStep draft={draft} update={update} /><ReviewStep draft={draft} files={files} task={task} /></div>}
          {errors.length > 0 && <div role="alert" className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3"><p className="text-xs font-bold text-rose-800">请先完成以下内容</p><ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-rose-700">{errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
        </main>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-white px-5 py-4 sm:px-6">
          <button type="button" disabled={busy || step === 0} onClick={() => { setErrors([]); setStep(value => Math.max(0, value - 1)); }} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-bold text-text-secondary hover:bg-surface-2 disabled:invisible"><ArrowLeft size={14} />上一步</button>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" disabled={busy || !draft.title.trim() || !draft.primaryGoal.trim()} onClick={() => void submit(false)} className="rounded-lg border border-border bg-white px-4 py-2.5 text-xs font-bold text-text-secondary hover:bg-surface-2 disabled:opacity-50">保存草稿</button>
            {step < STEPS.length - 1 ? <button type="button" disabled={busy} onClick={next} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-xs font-black text-white hover:bg-accent-dim disabled:opacity-50">继续<ArrowRight size={14} /></button> : <button type="button" disabled={busy} onClick={() => void submit(true)} className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-xs font-black text-white hover:bg-accent-dim disabled:opacity-50">{busy && <Loader2 size={14} className="animate-spin" />}{task?.status === 'paused' ? '重试自动生成' : '确认并开始自动制作'}</button>}
          </div>
        </footer>
      </div>
    </div>
  );
}
