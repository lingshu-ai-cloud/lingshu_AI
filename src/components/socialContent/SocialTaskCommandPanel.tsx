import type { ReactNode } from 'react';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Download,
  FileCheck2,
  FolderKanban,
  PackageCheck,
  PencilLine,
  Plus,
  RefreshCcw,
  RotateCcw,
  Send,
  Sparkles,
} from 'lucide-react';
import type { Page } from '../../App';
import type { SocialContentTaskDetail } from '../../../shared/contracts/socialContentWorkflow';
import {
  SOCIAL_CONTENT_STAGES,
  socialContentAssetReviewAction,
  socialContentCurrentArtifacts,
  socialContentCurrentDelivery,
  socialContentPrimaryActionForTask,
  socialContentProgress,
  socialContentStageIndex,
  socialContentTaskHeadline,
} from '../../lib/socialContentModel';

export interface SocialTaskCommandPanelProps {
  task: SocialContentTaskDetail;
  busy: boolean;
  onCreate: () => void;
  onEdit: () => void;
  onStart: () => void;
  onDownload: () => void;
  onOpenPublication: () => void;
  onOpenMetrics: () => void;
  onCreateDeliveryPackage: () => void;
  onRefresh: () => void;
  onNavigate: (page: Page) => void;
}

const EDITABLE_STATUSES = ['draft', 'needs_input', 'plan_review', 'attention', 'paused'] as const;

function primaryAction(props: SocialTaskCommandPanelProps): { label: string; icon: ReactNode; onClick: () => void } {
  const { task } = props;
  const action = socialContentPrimaryActionForTask(task);
  if (action === 'continue') return { label: '继续填写', icon: <PencilLine size={16} />, onClick: props.onEdit };
  if (action === 'start') return { label: '确认制作方案', icon: <Sparkles size={16} />, onClick: props.onStart };
  if (action === 'resume') return { label: '继续制作', icon: <Sparkles size={16} />, onClick: props.onStart };
  if (action === 'open_studio') return { label: '进入内容创作', icon: <ArrowRight size={16} />, onClick: () => props.onNavigate('smartAssets') };
  if (action === 'review_assets') {
    const assetAction = socialContentAssetReviewAction(task.artifacts);
    if (assetAction === 'review') return { label: '确认成品', icon: <CheckCircle2 size={16} />, onClick: () => document.getElementById('social-task-artifacts')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) };
    if (assetAction === 'package') return { label: '整理交付包', icon: <PackageCheck size={16} />, onClick: props.onCreateDeliveryPackage };
  }
  if (action === 'download') return { label: '下载交付包', icon: <Download size={16} />, onClick: props.onDownload };
  if (action === 'register_publication') return { label: '登记发布结果', icon: <Send size={16} />, onClick: props.onOpenPublication };
  if (action === 'submit_metrics') return { label: task.metricSubmissions.length > 0 ? '继续回传数据' : '回传发布数据', icon: <BarChart3 size={16} />, onClick: props.onOpenMetrics };
  if (action === 'create_next') return { label: '创建下一轮任务', icon: <RotateCcw size={16} />, onClick: props.onCreate };
  return { label: '查看制作进度', icon: <ArrowRight size={16} />, onClick: () => props.onNavigate('smartAssets') };
}

function PrimaryButton({ props, compact = false }: { props: SocialTaskCommandPanelProps; compact?: boolean }) {
  const action = primaryAction(props);
  return (
    <button type="button" disabled={props.busy} onClick={action.onClick} className={`inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50 ${compact ? 'h-11 shrink-0 px-4 text-xs' : 'w-full px-4 py-3 text-sm'}`}>
      {action.icon}{action.label}
    </button>
  );
}

function resultCounts(task: SocialContentTaskDetail) {
  const artifacts = socialContentCurrentArtifacts(task.artifacts);
  return [
    { label: '内容', value: artifacts.length },
    { label: '待确认', value: artifacts.filter(item => item.status === 'review_required').length },
    { label: '交付包', value: task.deliveryPackages.filter(item => item.status === 'ready' || item.status === 'confirmed').length },
  ];
}

export default function SocialTaskCommandPanel(props: SocialTaskCommandPanelProps) {
  const { task } = props;
  const stageIndex = Math.max(0, socialContentStageIndex(task.status));
  const stage = SOCIAL_CONTENT_STAGES[stageIndex];
  const counts = resultCounts(task);
  const canEdit = EDITABLE_STATUSES.some(status => status === task.status);
  const delivery = socialContentCurrentDelivery(task);
  const resultLabel = task.metricSubmissions.length > 0
    ? '数据已回传'
    : task.publications.length > 0
      ? '发布已登记'
      : delivery?.status === 'ready' || delivery?.status === 'confirmed'
        ? '交付包已就绪'
        : socialContentTaskHeadline(task);

  return (
    <>
      <aside data-social-command-panel className="sticky top-4 hidden self-start overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_45px_rgba(15,23,42,0.08)] lg:block" aria-labelledby="social-command-panel-title">
        <div className="border-b border-border bg-slate-950 px-5 py-4 text-white">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10"><FolderKanban size={16} /></span><div className="min-w-0"><p className="text-[10px] font-bold text-emerald-300">灵小枢</p><h3 id="social-command-panel-title" className="truncate text-sm font-black">操作台</h3></div></div>
            <button type="button" disabled={props.busy} onClick={props.onRefresh} aria-label="刷新当前任务" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-50"><RefreshCcw size={14} /></button>
          </div>
          <p className="mt-3 truncate text-xs font-semibold text-slate-300">{task.brief.title}</p>
        </div>

        <div className="p-5">
          <div className="flex items-end justify-between gap-3"><div><p className="text-[10px] font-bold text-text-muted">当前进度</p><p className="mt-1 text-sm font-black text-text-primary">{stage?.label || '任务进行中'}</p></div><span className="text-xs font-black tabular-nums text-emerald-700">{socialContentProgress(task.status)}%</span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${socialContentProgress(task.status)}%` }} /></div>
          <p className="mt-3 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-800">{resultLabel}</p>

          <div className="mt-5 grid grid-cols-3 gap-2" aria-label="当前任务结果">
            {counts.map(item => <div key={item.label} className="rounded-xl bg-slate-50 px-2 py-3 text-center"><strong className="block text-lg font-black tabular-nums text-text-primary">{item.value}</strong><span className="mt-0.5 block text-[9px] font-bold text-text-muted">{item.label}</span></div>)}
          </div>

          <div className="mt-5"><p className="mb-2 text-[10px] font-bold text-text-muted">下一步</p><PrimaryButton props={props} /></div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {canEdit && <button type="button" disabled={props.busy} onClick={props.onEdit} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2.5 text-[11px] font-bold text-text-secondary hover:bg-slate-50 disabled:opacity-50"><PencilLine size={13} />编辑任务</button>}
            <button type="button" disabled={props.busy} onClick={props.onCreate} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2.5 text-[11px] font-bold text-text-secondary hover:bg-slate-50 disabled:opacity-50"><Plus size={13} />新建任务</button>
          </div>

          <div className="mt-5 border-t border-border pt-4"><p className="mb-2 text-[10px] font-bold text-text-muted">工作区</p><div className="grid grid-cols-2 gap-1.5">
            {([['企业资料', 'enterprise'], ['灵感中心', 'socialInspiration'], ['内容创作', 'smartAssets'], ['发布与数据', 'traffic']] as const).map(([label, page]) => <button key={page} type="button" onClick={() => props.onNavigate(page)} className="rounded-lg px-2 py-2 text-left text-[10px] font-bold text-text-secondary hover:bg-slate-50 hover:text-emerald-700">{label}</button>)}
          </div></div>
        </div>
      </aside>

      <div data-social-mobile-command-bar className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-40 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 p-2.5 shadow-[0_16px_45px_rgba(15,23,42,0.2)] backdrop-blur lg:hidden" aria-label="灵小枢操作台">
        <div className="min-w-0 flex-1 px-1"><p className="truncate text-[10px] font-bold text-text-muted">{task.brief.title}</p><p className="mt-0.5 truncate text-xs font-black text-text-primary">{stage?.label || '任务进行中'} · {socialContentProgress(task.status)}%</p></div>
        <PrimaryButton props={props} compact />
      </div>
    </>
  );
}
