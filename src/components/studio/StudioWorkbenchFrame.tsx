import { Button, Segmented } from 'antd';
import { StoryboardFirstFrame } from './StoryboardFirstFrame';
import ReplicationWorkbenchHeader from '../socialContent/ReplicationWorkbenchHeader';
import { useEffect, useState, type ReactNode } from 'react';
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
  /** Kept as machine-readable action metadata when the next step is unavailable. */
  blockReason?: string;
  icon?: ReactNode;
  type?: 'button' | 'submit';
};

export type StudioWorkbenchFrameProps = {
  replicationWorkflow?: boolean;
  replicationActiveStep?: number;
  showPanelHeadings?: boolean;
  showHeaderSaveStatus?: boolean;
  projectTitle: string;
  projectSubtitle?: string;
  onProjectTitleChange?: (title: string) => void;
  onProjectTitleCommit?: () => void;
  projectTitlePlaceholder?: string;
  saveStatus: StudioSaveStatus;
  headerActions?: ReactNode;
  onSave?: () => void;
  activeStepId: StudioWorkbenchStep['id'];
  objectTitle?: string;
  objectDescription?: string;
  objectPanel: ReactNode;
  children: ReactNode;
  canvasTitle?: string;
  canvasToolbar?: ReactNode;
  propertyTitle?: string;
  propertyDescription?: string;
  propertyAction?: ReactNode;
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

export type StudioStoryboardProductionSummary = {
  routeLabel: string;
  identityLabel?: string;
  expectedCostCny?: number | null;
  upperBoundCostCny?: number | null;
  missingInputs?: string[];
  blockers?: string[];
};

export type StudioStoryboardItem = {
  id: string;
  index: number;
  title?: string;
  thumbnailUrl?: string;
  duration?: string;
  voiceover?: string;
  status?: StudioStoryboardStatus;
  statusLabel?: string;
  topicLabel?: string;
  livePresenter?: boolean;
  presenterCandidate?: boolean;
  presenterDecision?: boolean;
  frameSource?: string;
  firstFrameRef?: string;
  frameTime?: number;
  frameLabel?: string;
  production?: StudioStoryboardProductionSummary;
};

export type StudioStoryboardListProps = {
  items: StudioStoryboardItem[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  onMore?: (id: string) => void;
  onPresenterDecision?: (id: string, decision: boolean | undefined) => void;
  emptyState?: ReactNode;
  previewOnly?: boolean;
};

type MobilePanel = 'objects' | 'canvas' | 'properties';

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
      <span className="truncate" title={label}>{label}</span>
    </>
  );

  const className = joinClassNames(
    'inline-flex shrink-0 items-center justify-end gap-1.5 whitespace-nowrap font-medium tabular-nums',
    compact ? 'w-36 text-[11px]' : 'w-40 text-xs',
    status.state === 'error' ? 'text-red-600' : status.state === 'saved' ? 'text-emerald-700' : 'text-text-muted',
  );

  if (status.state === 'error' && status.onRetry) {
    return (
      <button type="button" className={joinClassNames(className, 'rounded-md hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-200')} onClick={status.onRetry}>
        {content}
      </button>
    );
  }
  return <span className={className} role="status" aria-live="polite" aria-atomic="true">{content}</span>;
}

function MobilePanelTabs({ active, onChange }: { active: MobilePanel; onChange: (panel: MobilePanel) => void }) {
  const items: Array<{ id: MobilePanel; label: string; icon: ReactNode }> = [
    { id: 'objects', label: '分镜脚本', icon: <ListTree size={15} /> },
    { id: 'canvas', label: '创作画布', icon: <LayoutPanelLeft size={15} /> },
    { id: 'properties', label: '步骤设置', icon: <Settings2 size={15} /> },
  ];
  return (
    <div className="border-b border-border bg-surface p-2 md:hidden">
      <Segmented block value={active} onChange={value => onChange(value as MobilePanel)}
        options={items.map(item => ({ value: item.id, label: item.label, icon: item.icon }))} aria-label="工作台面板" />
    </div>
  );
}

function PanelHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border/80 px-4 py-2.5">
      <div className="min-w-0">
        <h2 className="truncate text-xs font-semibold text-text-primary">{title}</h2>
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
  onProjectTitleCommit,
  projectTitlePlaceholder = '未命名项目',
  replicationWorkflow = false,
  replicationActiveStep = 1,
  showPanelHeadings = true,
  showHeaderSaveStatus = true,
  saveStatus,
  headerActions,
  onSave,
  activeStepId,
  objectTitle = '创作内容',
  objectDescription,
  objectPanel,
  children,
  canvasTitle = '',
  canvasToolbar,
  propertyTitle = '当前属性',
  propertyDescription,
  propertyAction,
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
  const [timelineExpanded, setTimelineExpanded] = useState(activeStepId === 'preview' || replicationWorkflow && replicationActiveStep === 2);
  useEffect(() => { if (activeStepId === 'preview' || replicationWorkflow && replicationActiveStep === 2) setTimelineExpanded(true); }, [activeStepId, replicationWorkflow, replicationActiveStep]);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('properties');
  const projectTitleIsEditable = Boolean(onProjectTitleChange);

  return (
    <section
      className={joinClassNames(
        'flex h-full min-h-0 flex-col overflow-hidden bg-surface',
        className,
        replicationWorkflow ? 'replication-workbench' : '',
      )}
      aria-label="内容创作工作台"
    >
      <ReplicationWorkbenchHeader
        activeStep={replicationWorkflow ? replicationActiveStep : 0}
        compact
        showTaskIdentity
        title={projectTitle || projectTitlePlaceholder}
        subtitle={projectSubtitle}
        editableTitle={projectTitleIsEditable}
        onTitleChange={onProjectTitleChange}
        onTitleCommit={onProjectTitleCommit}
        actions={<>{headerActions}{showHeaderSaveStatus && <SaveStatusView status={saveStatus} compact />}{onSave && <Button onClick={onSave} loading={saveStatus.state === 'saving'} icon={<Save size={14} />}>保存草稿</Button>}</>}
      />

      <MobilePanelTabs active={mobilePanel} onChange={setMobilePanel} />

      <div className="social-creation-workbench-layout studio-workbench-panel-layout grid min-h-0 flex-1 overflow-hidden bg-surface-2">
        <aside
          role="tabpanel"
          aria-label="分镜与脚本"
          className={joinClassNames(
            'min-h-0 flex-col border-border bg-surface md:flex md:border-r',
            mobilePanel === 'objects' ? 'flex' : 'hidden',
          )}
        >
          {showPanelHeadings && <PanelHeading title={objectTitle} description={objectDescription} />}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{objectPanel}</div>
        </aside>

        <main
          role="tabpanel"
          aria-label="创作画布"
          className={joinClassNames(
            'min-h-0 flex-col bg-surface-2 md:flex',
            mobilePanel === 'canvas' ? 'flex' : 'hidden',
          )}
        >
          {showPanelHeadings && canvasTitle ? <PanelHeading title={canvasTitle} action={canvasToolbar} /> : canvasToolbar ? <div className="flex min-h-12 shrink-0 items-center justify-end border-b border-border/80 px-4 py-2.5">{canvasToolbar}</div> : null}
          <div className="flex min-h-[420px] flex-1 items-stretch justify-stretch overflow-x-hidden overflow-y-auto overscroll-contain p-2.5 pb-4 sm:p-3 sm:pb-4 md:min-h-0">{children}</div>
          {replicationWorkflow && timelinePanel && <section className="shrink-0 border-t border-border bg-white" aria-label={timelineTitle}>
            <div className="flex h-10 items-center justify-between gap-2 px-4"><button type="button" aria-expanded={timelineExpanded} onClick={() => setTimelineExpanded(value => !value)} className="text-xs font-bold text-text-secondary">{timelineExpanded ? '收起' : '展开'}时间轴</button>{timelineToolbar}</div>
            <div hidden={!timelineExpanded} className="h-20 overflow-x-auto overflow-y-hidden px-4 pb-2">{timelinePanel}</div>
          </section>}

        </main>

        <aside
          role="tabpanel"
          aria-label="步骤和属性设置"
          className={joinClassNames(
            'min-h-0 flex-col border-border bg-surface md:flex md:border-l',
            mobilePanel === 'properties' ? 'flex' : 'hidden',
          )}
        >
          {showPanelHeadings && <PanelHeading title={propertyTitle} description={propertyDescription} action={propertyAction} />}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{propertyPanel}</div>
        </aside>
      </div>

      {timelinePanel && !replicationWorkflow && (
        <section className="flex h-[122px] shrink-0 flex-col border-t border-border bg-surface xl:h-[142px]" aria-label={timelineTitle}>
          <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="shrink-0 text-[11px] font-semibold text-text-primary">{timelineTitle}</h2>
              {timelineDescription && <p className="truncate text-[10px] text-text-muted">{timelineDescription}</p>}
            </div>
            {timelineToolbar}
          </div>
          <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-4 py-2.5">{timelinePanel}</div>
        </section>
      )}

      <footer className="relative z-20 shrink-0 border-t border-border bg-surface px-4 py-2.5 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {previousAction && (
              <Button disabled={previousAction.disabled} loading={previousAction.loading} onClick={previousAction.onClick} icon={previousAction.icon || <ChevronLeft size={15} />}>
                {previousAction.loading ? previousAction.loadingLabel || previousAction.label : previousAction.label}
              </Button>
            )}
            <div className="hidden min-w-0 sm:block"><SaveStatusView status={saveStatus} /></div>
          </div>

          <div className="flex items-center justify-end gap-2">
            {previewAction && (
              <Button disabled={previewAction.disabled} loading={previewAction.loading} onClick={previewAction.onClick} icon={previewAction.icon || <Play size={14} />}>
                {previewAction.loading ? previewAction.loadingLabel || previewAction.label : previewAction.label}
              </Button>
            )}
            <Button type="primary" htmlType={primaryAction.type || 'button'} data-agent-action="studio-primary"
              data-agent-block-reason={primaryAction.blockReason || undefined} disabled={primaryAction.disabled}
              loading={primaryAction.loading} onClick={primaryAction.onClick} icon={primaryAction.icon}>
              {primaryAction.loading ? primaryAction.loadingLabel || `${primaryAction.label}中` : primaryAction.label}
            </Button>
          </div>
        </div>
      </footer>
    </section>
  );
}

export function StudioInputSummary({ items, title = '创作输入摘要', description, emptyAction }: StudioInputSummaryProps) {
  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface-2 p-4 text-center">
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
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">{title}</h3>
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

function storyboardCostLabel(production: StudioStoryboardProductionSummary): string {
  const expected = production.expectedCostCny;
  const upperBound = production.upperBoundCostCny;
  if (expected == null && upperBound == null) return '待核算';
  if (expected != null && upperBound != null && upperBound > expected) {
    return `预计 ¥${expected.toFixed(2)} · 上限 ¥${upperBound.toFixed(2)}`;
  }
  const amount = expected ?? upperBound;
  return `${expected != null ? '预计' : '上限'} ¥${amount!.toFixed(2)}`;
}

function StoryboardProductionSummary({ item }: { item: StudioStoryboardItem }) {
  const production = item.production;
  if (!production) return null;
  const missingInputs = production.missingInputs?.filter(Boolean) || [];
  const blockers = production.blockers?.filter(Boolean) || [];
  return (
    <div className="mt-2 border-t border-border-secondary pt-2 text-[11px] leading-[18px]" aria-label={`分镜 ${item.index} 生产信息`}>
      <dl className="grid min-w-0 grid-cols-1 gap-x-2 sm:grid-cols-2">
        <div className="flex min-w-0 gap-1"><dt className="shrink-0 text-text-muted">路线</dt><dd className="min-w-0 break-words font-semibold text-text-primary">{production.routeLabel}</dd></div>
        <div className="flex min-w-0 gap-1"><dt className="shrink-0 text-text-muted">成本</dt><dd className="min-w-0 break-words font-semibold text-text-primary">{storyboardCostLabel(production)}</dd></div>
        {production.identityLabel ? <div className="flex min-w-0 gap-1 sm:col-span-2"><dt className="shrink-0 text-text-muted">产品精度</dt><dd className="min-w-0 break-words font-semibold text-text-primary">{production.identityLabel}</dd></div> : null}
      </dl>
      {missingInputs.length ? <p className="mt-1 break-words text-amber-700"><span className="font-semibold">缺少：</span>{missingInputs.join('；')}</p> : null}
      {blockers.length ? <p className="mt-1 break-words text-red-700"><span className="font-semibold">阻塞：</span>{blockers.join('；')}</p> : null}
    </div>
  );
}

export function StudioStoryboardList({ items, selectedId, onSelect, onMore, onPresenterDecision, emptyState, previewOnly = false }: StudioStoryboardListProps) {
  if (!items.length) {
    return emptyState || (
      <div className="rounded-lg border border-dashed border-border bg-surface-2 p-5 text-center">
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
                selected ? 'border-emerald-200 bg-emerald-50/80 shadow-none' : 'border-transparent bg-white hover:border-emerald-100 hover:bg-emerald-50/35',
              )}
            >
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect?.(item.id)}
                className="flex w-full items-start gap-2.5 text-left focus:outline-none"
              >
                <span className="relative h-[72px] w-[86px] shrink-0 overflow-hidden rounded-lg bg-slate-950">
                  <StoryboardFirstFrame source={item.frameSource} firstFrameRef={item.firstFrameRef} imageUrl={item.thumbnailUrl} time={item.frameTime || 0} label={`分镜 ${item.index}`} className="h-full w-full" />
                  <span className="absolute left-1 top-1 rounded bg-black/75 px-1.5 py-0.5 text-[8px] font-semibold text-white">{item.index}</span>
                </span>
                <span className="min-w-0 flex-1 pr-1">
                  <span className="flex items-start justify-between gap-1">
                    <span className="line-clamp-1 text-[11px] font-semibold text-text-primary">{item.title || `分镜 ${String(item.index).padStart(2, '0')}`}</span>
                    {item.duration && <span className="shrink-0 text-[9px] font-bold text-text-muted">{item.duration}</span>}
                  </span>
                  {!previewOnly && item.topicLabel && <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-800">题材：{item.topicLabel}</span>}
                  {!previewOnly && item.frameLabel && <span className="mt-1 block text-[9px] text-text-muted">{item.frameLabel}</span>}
                  {!previewOnly && item.presenterCandidate && <span className="mt-1 block text-[10px] font-bold text-amber-700">人物待确认 · 暂不生成数字人</span>}
                  {!previewOnly && item.livePresenter && <span className="mt-1 block text-[10px] font-bold text-red-600">销售人物已确认 · 数字人复刻</span>}
                  <span className="mt-1 line-clamp-3 text-[10px] leading-[15px] text-text-secondary">{item.voiceover || '尚未添加口播文案'}</span>
                  {!previewOnly && <span className="mt-1 inline-flex"><StoryboardStatus status={item.status} label={item.statusLabel} /></span>}
                </span>
              </button>
              {!previewOnly && <StoryboardProductionSummary item={item} />}
              {!previewOnly && onPresenterDecision && (item.livePresenter || item.presenterCandidate || item.presenterDecision === false) && <label className="mt-2 flex items-center gap-2 border-t border-border pt-2 text-[10px] text-text-muted">人物识别<select aria-label={`分镜 ${item.index} 人物识别`} value={item.presenterDecision === undefined ? 'auto' : item.presenterDecision ? 'sales' : 'other'} onChange={event => onPresenterDecision(item.id, event.target.value === 'auto' ? undefined : event.target.value === 'sales')} className="min-w-0 flex-1 rounded border border-border bg-white p-1">
                <option value="auto">按分析证据识别</option><option value="sales">确认：固定销售主讲人物</option><option value="other">排除：路人／其他人物</option>
              </select></label>}
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
