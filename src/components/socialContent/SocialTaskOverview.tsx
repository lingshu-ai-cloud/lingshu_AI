import { useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Image,
  Layers3,
  Loader2,
  PackageCheck,
  Plus,
  Send,
  Sparkles,
} from 'lucide-react';
import type { Page } from '../../App';
import type {
  SocialContentArtifact,
  SocialContentTaskDetail,
  SocialContentTaskSummary,
} from '../../../shared/contracts/socialContentWorkflow';
import {
  SOCIAL_CONTENT_STAGES,
  socialContentCanRegisterPublication,
  socialContentCurrentArtifacts,
  socialContentCurrentDelivery,
  socialContentStageIndex,
  socialContentTaskHeadline,
} from '../../lib/socialContentModel';
import SocialArtifactPreviewDialog from './SocialArtifactPreviewDialog';
import SocialTaskCommandPanel from './SocialTaskCommandPanel';
import SocialWeeklySummary from './SocialWeeklySummary';
import { socialArtifactGenerationDisclosure } from '../../lib/socialArtifactGeneration';
import { PLATFORM_OPTIONS, artifactKindLabel, contentLanguageLabel, dueDateLabel, optionLabel, packageVersionLabel } from './socialContentUi';

const ARTIFACT_STATUS: Record<SocialContentArtifact['status'], string> = {
  draft: '制作中',
  review_required: '待确认',
  approved: '已确认',
  changes_requested: '修改中',
  superseded: '历史版本',
};
const READINESS_LABEL: Record<string, string> = {
  product: '产品或业务主题',
  audience: '目标客户',
  market: '目标市场',
  language: '内容语言',
  platform: '发布平台',
  content_format: '内容形式',
  source_material: '本次任务资料',
};

function artifactPreview(content: Record<string, unknown> | null): string {
  if (!content) return '';
  for (const key of ['title', 'headline', 'caption', 'copy', 'text', 'summary']) {
    const value = content[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 120);
  }
  return '';
}

interface SocialTaskOverviewProps {
  task: SocialContentTaskDetail | null;
  tasks: SocialContentTaskSummary[];
  taskTotalItems: number;
  hasMoreTasks: boolean;
  loadingMoreTasks: boolean;
  busy: boolean;
  onSelectTask: (taskId: string) => void;
  onLoadMoreTasks: () => void;
  onCreate: () => void;
  onEdit: () => void;
  onStart: () => void;
  onDownload: () => void;
  onOpenPublication: () => void;
  onOpenMetrics: () => void;
  onArtifactDecision: (artifact: SocialContentArtifact, decision: 'approved' | 'changes_requested') => void;
  onBatchDecision: (decision: 'approved' | 'changes_requested') => void;
  onCreateDeliveryPackage: () => void;
  onRefresh: () => void;
  onNavigate: (page: Page) => void;
}

function TaskStageBar({ task }: { task: SocialContentTaskDetail }) {
  const activeIndex = socialContentStageIndex(task.status);
  return (
    <ol className="mt-5 grid grid-cols-3 gap-y-4 sm:grid-cols-6" aria-label="任务进度">
      {SOCIAL_CONTENT_STAGES.map((stage, index) => {
        const complete = index < activeIndex || task.status === 'reviewed';
        const active = index === activeIndex && task.status !== 'reviewed';
        return (
          <li key={stage.id} className="relative flex min-w-0 flex-col items-center px-1 text-center">
            {index > 0 && <span className={`absolute right-1/2 top-3 hidden h-px w-full sm:block ${index <= activeIndex ? 'bg-emerald-500' : 'bg-border'}`} />}
            <span className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 ${complete ? 'border-emerald-600 bg-emerald-600 text-white' : active ? 'border-emerald-600 bg-white text-emerald-700' : 'border-border bg-white text-text-muted'}`}>{complete ? <Check size={12} strokeWidth={3} /> : active ? <Circle size={8} fill="currentColor" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}</span>
            <span className={`mt-2 text-[10px] font-bold sm:text-[11px] ${active || complete ? 'text-text-primary' : 'text-text-muted'}`}>{stage.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function TaskHeader(props: SocialTaskOverviewProps & { task: SocialContentTaskDetail }) {
  const {
    task,
    tasks,
    taskTotalItems,
    hasMoreTasks,
    loadingMoreTasks,
    busy,
    onSelectTask,
    onLoadMoreTasks,
  } = props;
  const remainingTaskCount = Math.max(0, taskTotalItems - tasks.length);
  return (
    <section className="rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-800">{socialContentTaskHeadline(task)}</span>
            <span className="text-[11px] font-semibold text-text-muted">更新于 {new Date(task.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <h2 className="mt-3 truncate text-xl font-black tracking-tight text-text-primary">{task.brief.title}</h2>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            {task.brief.productRef && <span>{task.brief.productRef}</span>}
            <span>{task.brief.objective}</span>
            {task.brief.markets.length > 0 && <span>{task.brief.markets.join('、')}</span>}
            <span className="inline-flex items-center gap-1"><CalendarDays size={12} />{dueDateLabel(task.brief.dueAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tasks.length > 1 && <label className="relative"><span className="sr-only">切换内容任务</span><select id="social-content-task-selector" value={task.taskId} disabled={busy} onChange={event => onSelectTask(event.target.value)} className="h-10 max-w-52 appearance-none truncate rounded-xl border border-border bg-white pl-3 pr-9 text-xs font-bold text-text-secondary outline-none focus:border-emerald-500 disabled:opacity-50">{tasks.map(item => <option key={item.taskId} value={item.taskId}>{item.brief.title}</option>)}</select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-3 text-text-muted" /></label>}
          {hasMoreTasks && <button type="button" disabled={busy || loadingMoreTasks} onClick={onLoadMoreTasks} aria-label={`加载更多内容任务，尚有 ${remainingTaskCount} 个`} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-bold text-text-secondary hover:bg-surface-2 disabled:opacity-50">{loadingMoreTasks && <Loader2 size={14} className="animate-spin" />}{loadingMoreTasks ? '正在加载' : `更多任务${remainingTaskCount > 0 ? `（${remainingTaskCount}）` : ''}`}</button>}
        </div>
      </div>
      <TaskStageBar task={task} />
    </section>
  );
}

function ReadinessPanel({ task }: { task: SocialContentTaskDetail }) {
  const sources = task.sources.filter(item => item.status === 'active');
  const sourceStats = [
    { label: '素材', value: sources.filter(item => item.kind === 'material').length, icon: Image },
    { label: '企业资料', value: sources.filter(item => item.kind === 'knowledge').length, icon: FileText },
    { label: '参考内容', value: sources.filter(item => item.kind === 'reference_link').length, icon: ExternalLink },
  ];
  return (
    <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-bold text-text-muted">准备情况</p><h3 className="mt-1 text-base font-black text-text-primary">{task.readiness.complete ? '资料准备完成' : `还差 ${task.readiness.missing.length} 项`}</h3></div><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${task.readiness.complete ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{task.readiness.complete ? <CheckCircle2 size={20} /> : <Clock3 size={20} />}</span></div>
      <div className="mt-4 grid grid-cols-3 gap-2">{sourceStats.map(item => <div key={item.label} className="rounded-xl bg-surface-2 px-3 py-2.5"><item.icon size={14} className="text-text-muted" /><strong className="mt-2 block text-lg text-text-primary">{item.value}</strong><span className="text-[10px] font-semibold text-text-muted">{item.label}</span></div>)}</div>
      {!task.readiness.complete && task.readiness.missing.length > 0 && <ul className="mt-4 space-y-1.5">{task.readiness.missing.slice(0, 4).map(item => <li key={item} className="flex items-start gap-2 text-xs text-amber-800"><Circle size={6} fill="currentColor" className="mt-1.5 shrink-0" />请补充{READINESS_LABEL[item] || '任务资料'}</li>)}</ul>}
    </section>
  );
}

function ArtifactPanel({ task, busy, onArtifactDecision, onBatchDecision, onNavigate }: Pick<SocialTaskOverviewProps, 'busy' | 'onArtifactDecision' | 'onBatchDecision' | 'onNavigate'> & { task: SocialContentTaskDetail }) {
  const currentArtifacts = socialContentCurrentArtifacts(task.artifacts);
  const pendingArtifacts = currentArtifacts.filter(artifact => artifact.status === 'review_required' && socialArtifactGenerationDisclosure(artifact).approvalAllowed);
  const [previewArtifact, setPreviewArtifact] = useState<SocialContentArtifact | null>(null);
  return (
    <section id="social-task-artifacts" className="rounded-2xl border border-border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[11px] font-bold text-text-muted">批次验收</p><h3 className="mt-1 text-base font-black text-text-primary">{currentArtifacts.length > 0 ? `${currentArtifacts.length} 项内容` : '内容制作'}</h3></div><div className="flex flex-wrap items-center gap-2">{pendingArtifacts.length > 0 && <><button type="button" disabled={busy} onClick={() => onBatchDecision('changes_requested')} className="rounded-lg border border-border px-3 py-2 text-[11px] font-bold text-text-secondary disabled:opacity-50">批量退回</button><button type="button" disabled={busy} onClick={() => onBatchDecision('approved')} className="rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-black text-white disabled:opacity-50">确认本批 {pendingArtifacts.length} 项</button></>}<button type="button" onClick={() => onNavigate('smartAssets')} className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:underline">打开内容创作<ArrowRight size={13} /></button></div></div>
      {currentArtifacts.length === 0 ? <div className="mt-5 rounded-xl bg-surface-2 px-4 py-6 text-center"><Sparkles size={18} className="mx-auto text-emerald-600" /><p className="mt-2 text-xs font-semibold text-text-muted">首批内容完成后将在这里出现</p></div> : <div role="list" aria-label={`全部 ${currentArtifacts.length} 项内容成品`} className="mt-4 max-h-[34rem] divide-y divide-border overflow-y-auto overscroll-contain pr-1">{currentArtifacts.map(artifact => {
        const preview = artifactPreview(artifact.content);
        const generation = socialArtifactGenerationDisclosure(artifact);
        return <article role="listitem" key={artifact.artifactId} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-text-muted"><FileCheck2 size={16} /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-text-primary">{artifactKindLabel(artifact.kind)}</p><p className="mt-0.5 text-[10px] text-text-muted">{[artifact.platform && optionLabel(PLATFORM_OPTIONS, artifact.platform), contentLanguageLabel(artifact.language), packageVersionLabel(artifact.version)].filter(Boolean).join(' · ')}</p><p className={`mt-1 text-[10px] font-bold ${generation.approvalAllowed ? 'text-emerald-700' : 'text-amber-700'}`}>{generation.sourceLabel} · {generation.verificationLabel}</p>{preview && <p className="mt-1 truncate text-[11px] text-text-secondary">{preview}</p>}</div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${artifact.status === 'review_required' ? 'bg-amber-50 text-amber-800' : artifact.status === 'approved' ? 'bg-emerald-50 text-emerald-800' : 'bg-surface-2 text-text-muted'}`}>{ARTIFACT_STATUS[artifact.status]}</span><button type="button" onClick={() => setPreviewArtifact(artifact)} className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-bold text-text-secondary">预览</button>{artifact.status === 'review_required' && <div className="flex gap-1.5"><button type="button" disabled={busy} onClick={() => onArtifactDecision(artifact, 'changes_requested')} className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-bold text-text-secondary">退回修改</button><button type="button" disabled={busy || !generation.approvalAllowed} title={generation.approvalAllowed ? undefined : generation.verificationLabel} onClick={() => onArtifactDecision(artifact, 'approved')} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">确认</button></div>}</article>;
      })}</div>}
      {previewArtifact && <SocialArtifactPreviewDialog artifact={previewArtifact} onClose={() => setPreviewArtifact(null)} />}
    </section>
  );
}

function DeliveryPanel({ task, busy, onDownload, onOpenPublication, onOpenMetrics }: Pick<SocialTaskOverviewProps, 'busy' | 'onDownload' | 'onOpenPublication' | 'onOpenMetrics'> & { task: SocialContentTaskDetail }) {
  const delivery = socialContentCurrentDelivery(task);
  const lastPublication = task.publications.at(-1);
  const canRegisterPublication = socialContentCanRegisterPublication(task);
  const metricCount = lastPublication ? task.metricSubmissions.filter(item => item.publicationId === lastPublication.publicationId).length : 0;
  const heading = task.metricSubmissions.length > 0 ? '发布数据已回传'
    : lastPublication ? '发布结果已登记'
      : delivery?.status === 'preparing' ? '正在整理交付包'
        : canRegisterPublication ? '交付包已准备好' : '等待交付';
  return (
    <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-bold text-text-muted">交付与回收</p><h3 className="mt-1 text-base font-black text-text-primary">{heading}</h3></div><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><PackageCheck size={20} /></span></div>
      <div className="mt-4 space-y-2.5">
        {delivery && <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-3"><div><p className="text-xs font-bold text-text-primary">交付包 · {packageVersionLabel(delivery.version)}</p><p className="mt-0.5 text-[10px] text-text-muted">{delivery.artifactIds.length} 项内容</p></div>{delivery.downloadHref && <button type="button" disabled={busy} onClick={onDownload} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[10px] font-black text-emerald-700 shadow-sm"><Download size={12} />下载</button>}</div>}
        {lastPublication && <div className="rounded-xl bg-surface-2 px-3 py-3"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold text-text-primary">{optionLabel(PLATFORM_OPTIONS, lastPublication.platform)} 已发布</p><p className="mt-0.5 text-[10px] text-text-muted">{lastPublication.accountLabel || new Date(lastPublication.publishedAt).toLocaleString('zh-CN')}</p></div><span className="text-[10px] font-bold text-text-muted">已回传 {metricCount} 次</span></div></div>}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">{canRegisterPublication && <button type="button" disabled={busy} onClick={onOpenPublication} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-[11px] font-bold text-text-secondary hover:bg-surface-2"><Send size={13} />{task.publications.length > 0 ? '登记其他平台' : '登记发布'}</button>}{task.publications.length > 0 && <button type="button" disabled={busy} onClick={onOpenMetrics} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-[11px] font-bold text-text-secondary hover:bg-surface-2"><BarChart3 size={13} />{task.metricSubmissions.length > 0 ? '继续回传数据' : '回传数据'}</button>}</div>
    </section>
  );
}

export default function SocialTaskOverview(props: SocialTaskOverviewProps) {
  const { task, tasks, onCreate, onNavigate } = props;
  if (!task) {
    return (
      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="grid items-center gap-6 px-6 py-8 lg:grid-cols-[1.3fr_.7fr] lg:px-8">
          <div><span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Sparkles size={20} /></span><h2 className="mt-5 text-2xl font-black tracking-tight text-text-primary">安排本周社媒内容</h2><p className="mt-2 max-w-xl text-sm leading-6 text-text-muted">设置本周重点、数量和预算，灵小枢会安排样片、批量生产和交付。</p><button type="button" onClick={onCreate} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-700"><Plus size={16} />安排本周内容</button></div>
          <div className="grid grid-cols-3 gap-2">{[['周计划', '确定本周重点'], ['代表样片', '一次确认方向'], ['交付包', '批量下载发布']].map(([label, caption]) => <div key={label} className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 text-center"><Layers3 size={16} className="mx-auto text-emerald-700" /><p className="mt-2 text-[11px] font-black text-text-primary">{label}</p><p className="mt-1 text-[10px] text-text-muted">{caption}</p></div>)}</div>
        </div>
        <div className="grid border-t border-border sm:grid-cols-4">{[['企业资料', 'enterprise'], ['灵感中心', 'socialInspiration'], ['内容创作', 'smartAssets'], ['发布与数据', 'traffic']].map(([label, page]) => <button key={page} type="button" onClick={() => onNavigate(page as Page)} className="flex items-center justify-between border-b border-border px-4 py-3 text-xs font-bold text-text-secondary hover:bg-surface-2 sm:border-b-0 sm:border-r last:border-r-0">{label}<ArrowRight size={13} /></button>)}</div>
      </section>
    );
  }
  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <TaskHeader {...props} task={task} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <SocialWeeklySummary task={task} onEdit={props.onEdit} />
          <div className="grid gap-4 xl:grid-cols-2"><ReadinessPanel task={task} /><DeliveryPanel task={task} busy={props.busy} onDownload={props.onDownload} onOpenPublication={props.onOpenPublication} onOpenMetrics={props.onOpenMetrics} /></div>
          <ArtifactPanel task={task} busy={props.busy} onArtifactDecision={props.onArtifactDecision} onBatchDecision={props.onBatchDecision} onNavigate={props.onNavigate} />
        </div>
        <SocialTaskCommandPanel task={task} busy={props.busy} onCreate={props.onCreate} onEdit={props.onEdit} onStart={props.onStart} onDownload={props.onDownload} onOpenPublication={props.onOpenPublication} onOpenMetrics={props.onOpenMetrics} onCreateDeliveryPackage={props.onCreateDeliveryPackage} onRefresh={props.onRefresh} onNavigate={props.onNavigate} />
      </div>
    </div>
  );
}
