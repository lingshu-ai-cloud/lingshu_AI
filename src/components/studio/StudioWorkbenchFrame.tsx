import { useId, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  Clock3,
  Image as ImageIcon,
  LayoutPanelLeft,
  ListTree,
  Loader2,
  MoreHorizontal,
  Play,
  RefreshCw,
  Save,
  Settings2,
} from 'lucide-react';

export type StudioWorkbenchStepId = 'settings' | 'script' | 'production';

export type StudioWorkbenchStep = {
  id: StudioWorkbenchStepId | string;
  label: string;
  shortLabel?: string;
  status?: 'complete' | 'active' | 'upcoming' | 'blocked';
};

export type StudioSaveState = 'idle' | 'saving' | 'saved' | 'error';

export type StudioSaveStatus = {
  state: StudioSaveState;
  /** Overrides the standard status copy. */
  label?: string;
  /** A display-ready time, for example “14:32”. */
  savedAt?: string;
  onRetry?: () => void;
};

export type StudioWorkbenchAction = {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  /** Shown immediately above the action when the next step is unavailable. */
  blockReason?: string;
  icon?: ReactNode;
  type?: 'button' | 'submit';
};

export type StudioWorkbenchFrameProps = {
  projectTitle: string;
  projectSubtitle?: string;
  onProjectTitleChange?: (title: string) => void;
  projectTitlePlaceholder?: string;
  saveStatus: StudioSaveStatus;
  onSave?: () => void;
  steps?: StudioWorkbenchStep[];
  activeStepId: StudioWorkbenchStep['id'];
  onStepChange?: (stepId: StudioWorkbenchStep['id']) => void;
  allowForwardStepNavigation?: boolean;
  objectTitle?: string;
  objectDescription?: string;
  objectPanel: ReactNode;
  children: ReactNode;
  canvasTitle?: string;
  canvasToolbar?: ReactNode;
  propertyTitle?: string;
  propertyDescription?: string;
  propertyPanel: ReactNode;
  timelineTitle?: string;
  timelineDescription?: string;
  timelinePanel?: ReactNode;
  timelineToolbar?: ReactNode;
  previousAction?: Omit<StudioWorkbenchAction, 'blockReason'>;
  previewAction?: Omit<StudioWorkbenchAction, 'blockReason'>;
  primaryAction: StudioWorkbenchAction;
  className?: string;
};

export type StudioInputSummaryItem = {
  id: string;
  label: string;
  value?: ReactNode;
  emptyLabel?: string;
  thumbnailUrl?: string;
  icon?: ReactNode;
};

export type StudioInputSummaryProps = {
  items: StudioInputSummaryItem[];
  title?: string;
  description?: string;
  emptyAction?: ReactNode;
};

export type StudioStoryboardStatus = 'idle' | 'ready' | 'working' | 'warning' | 'error';

export type StudioStoryboardItem = {
  id: string;
  index: number;
  title?: string;
  thumbnailUrl?: string;
  duration?: string;
  voiceover?: string;
  status?: StudioStoryboardStatus;
  statusLabel?: string;
};

export type StudioStoryboardListProps = {
  items: StudioStoryboardItem[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  onMore?: (id: string) => void;
  emptyState?: ReactNode;
};

type MobilePanel = 'objects' | 'canvas' | 'properties';

const defaultSteps: StudioWorkbenchStep[] = [
  { id: 'settings', label: '创作设置' },
  { id: 'script', label: '脚本与声音' },
  { id: 'production', label: '成片制作' },
];

const joinClassNames = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ');

function getSaveLabel(status: StudioSaveStatus): string {
  if (status.label) return status.label;
  if (status.state === 'saving') return '保存中';
  if (status.state === 'error') return '保存失败，点击重试';
  if (status.state === 'saved') return status.savedAt ? `已自动保存 ${status.savedAt}` : '已自动保存';
  return '等待保存';
}

function SaveStatusView({ status, compact = false }: { status: StudioSaveStatus; compact?: boolean }) {
  const label = getSaveLabel(status);
  const content = (
    <>
      {status.state === 'saving' && <Loader2 size={compact ? 13 : 14} className="animate-spin" aria-hidden="true" />}
      {status.state === 'saved' && <Check size={compact ? 13 : 14} aria-hidden="true" />}
      {status.state === 'error' && <AlertCircle size={compact ? 13 : 14} aria-hidden="true" />}
      {status.state === 'idle' && <Save size={compact ? 13 : 14} aria-hidden="true" />}
      <span>{label}</span>
    </>
  );

  const className = joinClassNames(
    'inline-flex items-center gap-1.5 font-medium',
    compact ? 'text-[11px]' : 'text-xs',
    status.state === 'error' ? 'text-red-600' : status.state === 'saved' ? 'text-emerald-700' : 'text-text-muted',
  );

  if (status.state === 'error' && status.onRetry) {
    return (
      <button type="button" className={joinClassNames(className, 'rounded-md hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-200')} onClick={status.onRetry}>
        {content}
      </button>
    );
  }
  return <span className={className}>{content}</span>;
}

export function StudioStepProgress({
  steps = defaultSteps,
  activeStepId,
  onStepChange,
  allowForwardStepNavigation = false,
}: Pick<StudioWorkbenchFrameProps, 'steps' | 'activeStepId' | 'onStepChange' | 'allowForwardStepNavigation'>) {
  const activeIndex = Math.max(0, steps.findIndex(step => step.id === activeStepId));

  return (
    <nav aria-label="内容创作步骤" className="w-full min-w-0">
      <ol className="grid grid-cols-3 border-b border-border">
        {steps.map((step, index) => {
          const complete = step.status === 'complete' || index < activeIndex;
          const active = step.status === 'active' || step.id === activeStepId;
          const blocked = step.status === 'blocked';
          const upcoming = step.status === 'upcoming' || index > activeIndex;
          const canNavigate = Boolean(onStepChange) && !blocked && (!upcoming || allowForwardStepNavigation);
          return (
            <li key={step.id} className="relative min-w-0">
              <button
                type="button"
                disabled={!canNavigate}
                aria-current={active ? 'step' : undefined}
                onClick={() => onStepChange?.(step.id)}
                className={joinClassNames(
                  '-mb-px flex h-10 w-full min-w-0 items-center justify-center gap-1.5 border-b-2 px-2 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30',
                  canNavigate && 'cursor-pointer',
                  !canNavigate && 'cursor-default',
                  active ? 'border-accent text-text-primary' : 'border-transparent text-text-muted',
                  canNavigate && !active && 'hover:border-border-bright hover:bg-surface-2/50 hover:text-text-secondary',
                )}
              >
                <span
                  className={joinClassNames(
                    'flex h-5 w-5 items-center justify-center text-[9px] font-black transition-colors',
                    complete && 'text-emerald-700',
                    active && !complete && 'text-accent',
                    !active && !complete && 'text-text-muted',
                    blocked && 'text-red-600',
                  )}
                >
                  {complete ? <Check size={13} aria-hidden="true" /> : index + 1}
                </span>
                <span className={joinClassNames('truncate text-[11px] font-bold', active ? 'text-text-primary' : 'text-text-muted')}>
                  {step.shortLabel || step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function MobilePanelTabs({ active, onChange }: { active: MobilePanel; onChange: (panel: MobilePanel) => void }) {
  const items: Array<{ id: MobilePanel; label: string; icon: ReactNode }> = [
    { id: 'objects', label: '分镜脚本', icon: <ListTree size={15} /> },
    { id: 'canvas', label: '创作画布', icon: <LayoutPanelLeft size={15} /> },
    { id: 'properties', label: '步骤设置', icon: <Settings2 size={15} /> },
  ];
  return (
    <div className="grid grid-cols-3 border-b border-border bg-surface px-2 xl:hidden" role="tablist" aria-label="工作台面板">
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={active === item.id}
          onClick={() => onChange(item.id)}
          className={joinClassNames(
            '-mb-px flex h-10 items-center justify-center gap-1.5 border-b-2 text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30',
            active === item.id ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:border-border-bright hover:text-text-secondary',
          )}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function PanelHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border/80 px-4 py-2.5">
      <div className="min-w-0">
        <h2 className="truncate text-xs font-black text-text-primary">{title}</h2>
        {description && <p className="mt-0.5 truncate text-[10px] leading-4 text-text-muted">{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function StudioWorkbenchFrame({
  projectTitle,
  projectSubtitle,
  onProjectTitleChange,
  projectTitlePlaceholder = '未命名项目',
  saveStatus,
  onSave,
  steps = defaultSteps,
  activeStepId,
  onStepChange,
  allowForwardStepNavigation = false,
  objectTitle = '创作内容',
  objectDescription,
  objectPanel,
  children,
  canvasTitle = '',
  canvasToolbar,
  propertyTitle = '当前属性',
  propertyDescription,
  propertyPanel,
  timelineTitle = '内容时间轨',
  timelineDescription,
  timelinePanel,
  timelineToolbar,
  previousAction,
  previewAction,
  primaryAction,
  className,
}: StudioWorkbenchFrameProps) {
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('properties');
  const blockReasonId = useId();
  const projectTitleIsEditable = Boolean(onProjectTitleChange);

  return (
    <section
      className={joinClassNames(
        'flex h-full min-h-0 flex-col overflow-hidden bg-surface',
        className,
      )}
      aria-label="内容创作工作台"
    >
      <header className="grid shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-2.5 xl:grid-cols-[minmax(180px,1fr)_minmax(320px,460px)_minmax(160px,1fr)] xl:px-5">
        <div className="min-w-0">
          {projectTitleIsEditable ? (
            <input
              value={projectTitle}
              onChange={event => onProjectTitleChange?.(event.target.value)}
              placeholder={projectTitlePlaceholder}
              aria-label="项目名称"
              className="h-8 w-full max-w-xl truncate rounded-md border border-transparent bg-transparent px-1.5 text-sm font-black text-text-primary outline-none transition hover:border-border hover:bg-surface-2 focus:border-accent focus:bg-surface"
            />
          ) : (
            <h1 className="truncate px-1.5 text-sm font-black text-text-primary">{projectTitle || projectTitlePlaceholder}</h1>
          )}
          {projectSubtitle && <p className="truncate px-1.5 text-[10px] text-text-muted">{projectSubtitle}</p>}
        </div>
        <div className="hidden min-w-0 xl:block">
          <StudioStepProgress steps={steps} activeStepId={activeStepId} onStepChange={onStepChange} allowForwardStepNavigation={allowForwardStepNavigation} />
        </div>
        <div className="flex items-center gap-3 justify-self-end">
          <SaveStatusView status={saveStatus} compact />
          {onSave && <button type="button" onClick={onSave} disabled={saveStatus.state === 'saving'} className="rounded-md border border-border bg-white px-3 py-1 text-xs font-bold text-text-primary transition-colors hover:bg-surface-2 disabled:opacity-50">保存草稿</button>}
        </div>
      </header>

      <div className="border-b border-border bg-surface px-3 py-2 xl:hidden">
        <StudioStepProgress steps={steps} activeStepId={activeStepId} onStepChange={onStepChange} allowForwardStepNavigation={allowForwardStepNavigation} />
      </div>

      <MobilePanelTabs active={mobilePanel} onChange={setMobilePanel} />

      <div className="grid min-h-0 flex-1 grid-cols-1 bg-surface-2 xl:grid-cols-[minmax(220px,0.8fr)_minmax(360px,1.5fr)_minmax(300px,1fr)] 2xl:grid-cols-[320px_minmax(520px,1fr)_400px]">
        <aside
          role="tabpanel"
          aria-label="分镜与脚本"
          className={joinClassNames(
            'min-h-0 flex-col border-border bg-surface xl:flex xl:border-r',
            mobilePanel === 'objects' ? 'flex' : 'hidden',
          )}
        >
          <PanelHeading title={objectTitle} description={objectDescription} />
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{objectPanel}</div>
        </aside>

        <main
          role="tabpanel"
          aria-label="创作画布"
          className={joinClassNames(
            'min-h-0 flex-col bg-surface-2 xl:flex',
            mobilePanel === 'canvas' ? 'flex' : 'hidden',
          )}
        >
          {canvasTitle ? <PanelHeading title={canvasTitle} action={canvasToolbar} /> : canvasToolbar ? <div className="flex min-h-12 shrink-0 items-center justify-end border-b border-border/80 px-4 py-2.5">{canvasToolbar}</div> : null}
          <div className="flex min-h-[420px] flex-1 items-stretch justify-stretch overflow-hidden p-2.5 sm:p-3 xl:min-h-0">{children}</div>
        </main>

        <aside
          role="tabpanel"
          aria-label="步骤和属性设置"
          className={joinClassNames(
            'min-h-0 flex-col border-border bg-surface xl:flex xl:border-l',
            mobilePanel === 'properties' ? 'flex' : 'hidden',
          )}
        >
          <PanelHeading title={propertyTitle} description={propertyDescription} />
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{propertyPanel}</div>
        </aside>
      </div>

      {timelinePanel && (
        <section className="flex h-[122px] shrink-0 flex-col border-t border-border bg-surface xl:h-[142px]" aria-label={timelineTitle}>
          <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="shrink-0 text-[11px] font-black text-text-primary">{timelineTitle}</h2>
              {timelineDescription && <p className="truncate text-[10px] text-text-muted">{timelineDescription}</p>}
            </div>
            {timelineToolbar}
          </div>
          <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-4 py-2.5">{timelinePanel}</div>
        </section>
      )}

      <footer className="sticky bottom-0 z-20 shrink-0 border-t border-border bg-surface px-4 py-2.5 shadow-[0_-2px_8px_rgba(15,23,42,0.025)] sm:px-5">
        <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <div className="flex min-w-0 items-center gap-3">
            {previousAction && (
              <button
                type="button"
                disabled={previousAction.disabled || previousAction.loading}
                onClick={previousAction.onClick}
                className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-bold text-text-secondary transition hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {previousAction.loading ? <Loader2 size={14} className="animate-spin" /> : previousAction.icon || <ChevronLeft size={15} />}
                {previousAction.loading ? previousAction.loadingLabel || previousAction.label : previousAction.label}
              </button>
            )}
            <div className="hidden min-w-0 sm:block"><SaveStatusView status={saveStatus} /></div>
          </div>

          <div className="hidden items-center justify-center text-center sm:flex">
            {primaryAction.blockReason && (
              <p id={blockReasonId} className="max-w-sm text-[11px] font-medium leading-4 text-amber-700">
                {primaryAction.blockReason}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            {previewAction && (
              <button
                type="button"
                disabled={previewAction.disabled || previewAction.loading}
                onClick={previewAction.onClick}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-4 text-xs font-bold text-text-secondary transition-colors hover:border-accent/40 hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {previewAction.loading ? <Loader2 size={14} className="animate-spin" /> : previewAction.icon || <Play size={14} />}
                {previewAction.loading ? previewAction.loadingLabel || previewAction.label : previewAction.label}
              </button>
            )}
            <button
              data-agent-action="studio-primary"
              data-agent-block-reason={primaryAction.blockReason || undefined}
              type={primaryAction.type || 'button'}
              disabled={primaryAction.disabled || primaryAction.loading}
              onClick={primaryAction.onClick}
              aria-describedby={primaryAction.blockReason ? blockReasonId : undefined}
              className="inline-flex h-10 min-w-28 items-center justify-center gap-2 rounded-md bg-accent px-5 text-xs font-black text-white transition-colors hover:bg-accent-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {primaryAction.loading ? <Loader2 size={15} className="animate-spin" /> : primaryAction.icon}
              {primaryAction.loading ? primaryAction.loadingLabel || `${primaryAction.label}中` : primaryAction.label}
            </button>
          </div>
          {primaryAction.blockReason && (
            <p className="text-center text-[11px] font-medium leading-4 text-amber-700 sm:hidden">{primaryAction.blockReason}</p>
          )}
        </div>
      </footer>
    </section>
  );
}

export function StudioInputSummary({ items, title = '创作输入摘要', description, emptyAction }: StudioInputSummaryProps) {
  if (!items.length) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface-2 p-4 text-center">
        <ImageIcon size={22} className="mx-auto text-text-muted" aria-hidden="true" />
        <p className="mt-2 text-xs font-bold text-text-primary">尚未添加创作信息</p>
        <p className="mt-1 text-[11px] leading-4 text-text-muted">完善主题或添加素材后，这里会持续显示项目摘要。</p>
        {emptyAction && <div className="mt-3">{emptyAction}</div>}
      </div>
    );
  }
  return (
    <section aria-label={title}>
      <div className="mb-2 px-1">
        <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-text-muted">{title}</h3>
        {description && <p className="mt-0.5 text-[10px] leading-4 text-text-muted">{description}</p>}
      </div>
      <div className="divide-y divide-border/70 border-y border-border/70">
        {items.map(item => (
        <article key={item.id} className="flex min-h-12 items-center gap-2.5 px-1 py-2.5 transition hover:bg-surface-2/70">
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />
          ) : item.icon ? (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-muted">{item.icon}</span>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold text-text-muted">{item.label}</p>
            <div className={joinClassNames('mt-0.5 truncate text-[11px] font-semibold', item.value ? 'text-text-primary' : 'text-text-muted')}>
              {item.value || item.emptyLabel || '待完善'}
            </div>
          </div>
        </article>
        ))}
      </div>
      {emptyAction && <div className="mt-3 px-1">{emptyAction}</div>}
    </section>
  );
}

function StoryboardStatus({ status = 'idle', label }: { status?: StudioStoryboardStatus; label?: string }) {
  const styles: Record<StudioStoryboardStatus, string> = {
    idle: 'bg-surface-2 text-text-muted',
    ready: 'bg-emerald-50 text-emerald-700',
    working: 'bg-blue-50 text-blue-700',
    warning: 'bg-amber-50 text-amber-700',
    error: 'bg-red-50 text-red-600',
  };
  const fallback: Record<StudioStoryboardStatus, string> = {
    idle: '待处理', ready: '已完成', working: '处理中', warning: '需更新', error: '失败',
  };
  return <span className={joinClassNames('rounded-full px-2 py-0.5 text-[9px] font-bold', styles[status])}>{label || fallback[status]}</span>;
}

export function StudioStoryboardList({ items, selectedId, onSelect, onMore, emptyState }: StudioStoryboardListProps) {
  if (!items.length) {
    return emptyState || (
      <div className="rounded-xl border border-dashed border-border bg-surface-2 p-5 text-center">
        <Clock3 size={22} className="mx-auto text-text-muted" aria-hidden="true" />
        <p className="mt-2 text-xs font-bold text-text-primary">分镜尚未准备</p>
        <p className="mt-1 text-[11px] leading-4 text-text-muted">选择企业产品并生成逐句口播方案后，参考视频的分镜会显示在这里。</p>
      </div>
    );
  }
  return (
    <ol className="space-y-1.5" aria-label="分镜列表">
      {items.map(item => {
        const selected = item.id === selectedId;
        return (
          <li key={item.id}>
            <article
              className={joinClassNames(
                'group relative rounded-lg border p-2 transition',
                selected ? 'border-emerald-200 bg-emerald-50/80 shadow-sm' : 'border-transparent bg-white hover:border-emerald-100 hover:bg-emerald-50/35',
              )}
            >
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect?.(item.id)}
                className="flex w-full items-start gap-2.5 text-left focus:outline-none"
              >
                <span className="relative h-[72px] w-[86px] shrink-0 overflow-hidden rounded-lg bg-slate-950">
                  {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className="h-full w-full object-contain" /> : <ImageIcon size={19} className="absolute inset-0 m-auto text-white/55" />}
                  <span className="absolute left-1 top-1 rounded bg-black/75 px-1.5 py-0.5 text-[8px] font-black text-white">{item.index}</span>
                </span>
                <span className="min-w-0 flex-1 pr-1">
                  <span className="flex items-start justify-between gap-1">
                    <span className="line-clamp-1 text-[11px] font-black text-text-primary">{item.title || `分镜 ${String(item.index).padStart(2, '0')}`}</span>
                    {item.duration && <span className="shrink-0 text-[9px] font-bold text-text-muted">{item.duration}</span>}
                  </span>
                  <span className="mt-1 line-clamp-3 text-[10px] leading-[15px] text-text-secondary">{item.voiceover || '尚未添加口播文案'}</span>
                  <span className="mt-1 inline-flex"><StoryboardStatus status={item.status} label={item.statusLabel} /></span>
                </span>
              </button>
              {onMore && (
                <button
                  type="button"
                  aria-label={`分镜 ${item.index} 更多操作`}
                  onClick={event => { event.stopPropagation(); onMore(item.id); }}
                  className="absolute right-1.5 top-7 flex h-7 w-7 items-center justify-center rounded-md text-text-muted opacity-60 transition hover:bg-surface-2 hover:text-text-primary group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                >
                  <MoreHorizontal size={15} />
                </button>
              )}
            </article>
          </li>
        );
      })}
    </ol>
  );
}

export function StudioRetryButton({ label = '重试', onClick, disabled }: { label?: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold text-text-secondary transition hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
    >
      <RefreshCw size={12} aria-hidden="true" />
      {label}
    </button>
  );
}
