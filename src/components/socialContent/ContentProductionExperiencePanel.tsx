import { Tabs } from 'antd';
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Film,
  Images,
  Loader2,
  PackageCheck,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
  Trophy,
  XCircle,
} from 'lucide-react';
import type { SocialContentTaskDetail } from '../../../shared/contracts/socialContentWorkflow';
import {
  contentAchievementSummary,
  contentProductionExceptions,
  contentProgressNodes,
  contentShotProgress,
  formatContentDuration,
  type ContentExceptionKind,
  type ContentShotProgressState,
} from '../../lib/contentProductionExperience';

export type ContentProductionView = 'overview' | 'shots' | 'exceptions';

interface ContentProductionExperiencePanelProps {
  task: SocialContentTaskDetail;
  busy: boolean;
  view: ContentProductionView;
  onViewChange: (view: ContentProductionView) => void;
  onOpenWorkbench: () => void;
  onRetry: () => void;
}

const SHOT_LABELS: Record<ContentShotProgressState, string> = {
  queued: '排队中',
  producing: '制作中',
  quality: '质检中',
  rework: '返工中',
  completed: '已完成',
  failed: '制作失败',
};

const SHOT_TONES: Record<ContentShotProgressState, string> = {
  queued: 'border-slate-200 bg-slate-50 text-slate-700',
  producing: 'border-blue-200 bg-blue-50 text-blue-800',
  quality: 'border-border bg-surface-2 text-text-secondary',
  rework: 'border-amber-200 bg-amber-50 text-amber-900',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  failed: 'border-rose-200 bg-rose-50 text-rose-800',
};

const EXCEPTION_LABELS: Record<ContentExceptionKind, string> = {
  missing_material: '缺素材',
  quality_failed: '质量失败',
  model_failed: '模型调用失败',
};

function ShotStateIcon({ state }: { state: ContentShotProgressState }) {
  if (state === 'completed') return <CheckCircle2 size={15} />;
  if (state === 'failed') return <XCircle size={15} />;
  if (state === 'rework') return <RefreshCcw size={15} className="motion-safe:animate-spin [animation-duration:2s]" />;
  if (state === 'producing' || state === 'quality') return <Loader2 size={15} className="animate-spin motion-reduce:animate-none" />;
  return <Clock3 size={15} />;
}

function TaskOverview({ task }: { task: SocialContentTaskDetail }) {
  const nodes = contentProgressNodes(task);
  const current = nodes.find(node => ['active', 'blocked', 'failed'].includes(node.state)) || nodes.at(-1);
  const completed = nodes.filter(node => node.state === 'complete').length;
  const shots = contentShotProgress(task);
  const doneShots = shots.filter(shot => shot.state === 'completed').length;
  const totalCost = task.agentWorkflow?.executionPlan.estimatedTotalCostCny;
  const remaining = task.productionProgress?.estimatedRemainingSeconds ?? null;

  return (
    <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]" data-content-task-overview>
      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
        <p className="text-[10px] font-semibold tracking-[0.08em] text-slate-500">当前节点</p>
        <div className="mt-2 flex items-start gap-3">
          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${current?.state === 'failed' ? 'bg-rose-100 text-rose-700' : current?.state === 'blocked' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-700'}`}>
            {current?.state === 'failed' ? <XCircle size={18} /> : current?.state === 'blocked' ? <AlertTriangle size={18} /> : <Loader2 size={18} className="animate-spin motion-reduce:animate-none" />}
          </span>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-slate-950">{current?.label || '等待任务进度'}</h4>
            <p className="mt-1 text-xs leading-5 text-slate-600">{current?.result || '任务进度会在提交后自动更新'}</p>
            <p className="mt-2 text-[10px] font-semibold text-slate-500">最近更新 {new Date(task.updatedAt).toLocaleString('zh-CN')}</p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-border border border-border">
        <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-[9px] font-bold text-slate-500">任务节点</p><strong className="mt-1 block text-sm text-slate-950">{completed}/7 已完成</strong></div>
        <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-[9px] font-bold text-slate-500">逐镜结果</p><strong className="mt-1 block text-sm text-slate-950">{shots.length ? `${doneShots}/${shots.length} 镜` : '等待方案'}</strong></div>
        <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="flex items-center gap-1 text-[9px] font-bold text-slate-500"><CircleDollarSign size={11} />预计费用</p><strong className="mt-1 block text-sm text-slate-950">{totalCost == null ? '核算中' : `¥${totalCost.toFixed(2)}`}</strong></div>
        <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="flex items-center gap-1 text-[9px] font-bold text-slate-500"><Clock3 size={11} />预计剩余</p><strong className="mt-1 block text-sm text-slate-950">{formatContentDuration(remaining)}</strong></div>
      </div>
    </div>
  );
}

function ShotProgressView({ task, onOpenWorkbench }: Pick<ContentProductionExperiencePanelProps, 'task' | 'onOpenWorkbench'>) {
  const shots = contentShotProgress(task);
  const [filter, setFilter] = useState<'all' | ContentShotProgressState>('all');
  const counts = useMemo(() => Object.fromEntries(Object.keys(SHOT_LABELS).map(state => [state, shots.filter(shot => shot.state === state).length])) as Record<ContentShotProgressState, number>, [shots]);
  const visibleShots = filter === 'all' ? shots : shots.filter(shot => shot.state === filter);
  const estimatedCost = task.agentWorkflow?.executionPlan.estimatedTotalCostCny;
  const remaining = task.productionProgress?.estimatedRemainingSeconds ?? null;

  if (!shots.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
        <Film size={22} className="mx-auto text-slate-400" />
        <h4 className="mt-3 text-sm font-semibold text-slate-900">逐镜方案生成后显示进度</h4>
        <p className="mt-1 text-xs text-slate-500">每个镜头会分别显示排队、制作、质检、返工、完成或失败。</p>
      </div>
    );
  }

  return (
    <div data-content-shot-progress>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-50 px-3 py-2.5"><p className="text-[9px] font-bold text-slate-500">完成镜头</p><strong className="mt-1 block text-sm text-slate-950">{counts.completed}/{shots.length}</strong></div>
        <div className="rounded-lg bg-blue-50 px-3 py-2.5"><p className="text-[9px] font-bold text-blue-700">制作 / 质检</p><strong className="mt-1 block text-sm text-blue-950">{counts.producing + counts.quality} 镜</strong></div>
        <div className="rounded-lg bg-amber-50 px-3 py-2.5"><p className="text-[9px] font-bold text-amber-700">返工 / 失败</p><strong className="mt-1 block text-sm text-amber-950">{counts.rework + counts.failed} 镜</strong></div>
        <div className="rounded-lg bg-slate-50 px-3 py-2.5"><p className="text-[9px] font-bold text-slate-500">时间与费用</p><strong className="mt-1 block text-[11px] text-slate-950">剩余 {formatContentDuration(remaining)} · 预计 {estimatedCost == null ? '核算中' : `¥${estimatedCost.toFixed(2)}`}</strong><span className="mt-0.5 block text-[9px] text-slate-500">实际费用待对账</span></div>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="筛选镜头状态">
        <button type="button" onClick={() => setFilter('all')} aria-pressed={filter === 'all'} className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${filter === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>全部 {shots.length}</button>
        {(Object.keys(SHOT_LABELS) as ContentShotProgressState[]).map(state => (
          <button key={state} type="button" onClick={() => setFilter(state)} aria-pressed={filter === state} className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${filter === state ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>{SHOT_LABELS[state]} {counts[state]}</button>
        ))}
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        {visibleShots.map(shot => (
          <article key={shot.sceneId} className="rounded-lg border border-slate-200 bg-white p-4" data-shot-status={shot.state}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="text-[10px] font-semibold text-slate-500">镜头 {shot.order} · {shot.timeRange}</p><h4 className="mt-1 line-clamp-2 text-sm font-semibold text-slate-950">{shot.title}</h4></div>
              <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${SHOT_TONES[shot.state]}`}><ShotStateIcon state={shot.state} />{SHOT_LABELS[shot.state]}</span>
            </div>
            <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5"><p className="text-[9px] font-semibold text-slate-500">制作方式</p><p className="mt-1 text-[11px] font-bold text-slate-800">{shot.sourceLabel}</p></div>
            <p className={`mt-3 text-xs leading-5 ${shot.state === 'failed' || shot.state === 'rework' ? 'text-amber-800' : 'text-slate-600'}`}>{shot.detail}</p>
            {shot.qualityIssues.length > 0 && <ul className="mt-2 space-y-1">{shot.qualityIssues.map(issue => <li key={issue} className="flex items-start gap-1.5 text-[10px] leading-4 text-rose-700"><XCircle size={11} className="mt-0.5 shrink-0" />{issue}</li>)}</ul>}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[10px] text-slate-500"><span>预计 {formatContentDuration(shot.estimatedSeconds)}</span><span>预计 ¥{shot.estimatedCostCny.toFixed(2)}</span></div>
            {(shot.state === 'failed' || shot.state === 'rework') && <button type="button" onClick={onOpenWorkbench} className="mt-3 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800">查看本镜头处理要求<ChevronRight size={12} /></button>}
          </article>
        ))}
      </div>
      {!visibleShots.length && <p className="mt-4 rounded-lg bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">当前没有“{filter === 'all' ? '全部' : SHOT_LABELS[filter]}”镜头。</p>}
    </div>
  );
}

function ExceptionView({ task, busy, onOpenWorkbench, onRetry }: Pick<ContentProductionExperiencePanelProps, 'task' | 'busy' | 'onOpenWorkbench' | 'onRetry'>) {
  const exceptions = contentProductionExceptions(task);
  if (!exceptions.length) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-8 text-center" data-content-exception-empty>
        <CheckCircle2 size={24} className="mx-auto text-emerald-700" />
        <h4 className="mt-3 text-sm font-semibold text-emerald-950">当前没有需要你处理的异常</h4>
        <p className="mt-1 text-xs text-emerald-800">系统恢复和重试会自动进行；只有需要事实、权利、预算或质量决策时才会提醒你。</p>
      </div>
    );
  }
  const recoveringCount = exceptions.filter(item => item.recovering).length;
  const userActionCount = exceptions.length - recoveringCount;
  return (
    <div className="space-y-3" data-content-exceptions>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-slate-50 px-3 py-2.5"><p className="text-[9px] font-bold text-slate-500">当前异常</p><strong className="mt-1 block text-sm text-slate-950">{exceptions.length} 项</strong></div>
        <div className="rounded-lg bg-amber-50 px-3 py-2.5"><p className="text-[9px] font-bold text-amber-700">需要你处理</p><strong className="mt-1 block text-sm text-amber-950">{userActionCount} 项</strong></div>
        <div className="rounded-lg bg-blue-50 px-3 py-2.5"><p className="text-[9px] font-bold text-blue-700">自动恢复中</p><strong className="mt-1 block text-sm text-blue-950">{recoveringCount} 项</strong></div>
      </div>
      {exceptions.map(exception => {
        const canRetry = exception.kind === 'model_failed' && !exception.recovering;
        return (
          <article key={exception.id} className="overflow-hidden rounded-lg border border-amber-200 bg-white">
            <div className="flex items-start justify-between gap-3 bg-amber-50/70 px-4 py-3">
              <div className="flex min-w-0 items-start gap-2.5"><span className="mt-0.5 text-amber-800">{exception.kind === 'quality_failed' ? <ShieldAlert size={17} /> : exception.kind === 'model_failed' ? <XCircle size={17} /> : <Images size={17} />}</span><div><p className="text-[9px] font-semibold tracking-[0.08em] text-amber-800">{EXCEPTION_LABELS[exception.kind]}</p><h4 className="mt-0.5 text-sm font-semibold text-slate-950">{exception.title}</h4></div></div>
              {exception.recovering && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-[9px] font-semibold text-blue-800"><Loader2 size={10} className="animate-spin motion-reduce:animate-none" />自动恢复中</span>}
            </div>
            <dl className="grid gap-px bg-slate-100 sm:grid-cols-2">
              <div className="bg-white px-4 py-3"><dt className="text-[9px] font-semibold text-slate-500">影响范围</dt><dd className="mt-1 text-[11px] leading-5 text-slate-800">{exception.impact}</dd></div>
              <div className="bg-white px-4 py-3"><dt className="text-[9px] font-semibold text-slate-500">系统已经做了什么</dt><dd className="mt-1 text-[11px] leading-5 text-slate-800">{exception.systemAction}</dd></div>
              <div className="bg-white px-4 py-3"><dt className="text-[9px] font-semibold text-slate-500">需要你做什么</dt><dd className="mt-1 text-[11px] leading-5 font-bold text-amber-900">{exception.userAction}</dd></div>
              <div className="bg-white px-4 py-3"><dt className="text-[9px] font-semibold text-slate-500">完成后从哪里继续</dt><dd className="mt-1 text-[11px] leading-5 text-slate-800">{exception.resumeFrom}</dd></div>
            </dl>
            <div className="flex justify-end border-t border-slate-100 px-4 py-3">
              <button type="button" disabled={busy || exception.recovering} onClick={canRetry ? onRetry : onOpenWorkbench} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3 py-2 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                {busy || exception.recovering ? <Loader2 size={12} className="animate-spin motion-reduce:animate-none" /> : <ChevronRight size={12} />}
                {exception.recovering ? '系统正在恢复' : canRetry ? '重试当前节点' : exception.kind === 'quality_failed' ? '查看修改要求' : '补充对应资料'}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function AchievementCard({ task }: { task: SocialContentTaskDetail }) {
  const achievement = contentAchievementSummary(task);
  if (!achievement.visible) return null;
  return (
    <section className="overflow-hidden rounded-lg border border-emerald-200 bg-surface p-5 shadow-none" data-content-achievement>
      <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700"><Trophy size={20} /></span><div><p className="text-[10px] font-semibold tracking-[0.08em] text-emerald-700">本次制作成果</p><h3 className="mt-1 text-base font-semibold text-slate-950">完成了一次可复用的内容生产</h3><p className="mt-1 text-xs text-slate-600">只展示系统已有的真实结果，让进步来自看得见的作品。</p></div></div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg bg-white/80 px-3 py-3"><p className="text-[9px] font-bold text-slate-500">完成镜头</p><strong className="mt-1 block text-base text-slate-950">{achievement.completedScenes}/{achievement.totalScenes}</strong></div>
        <div className="rounded-lg bg-white/80 px-3 py-3"><p className="text-[9px] font-bold text-slate-500">质检通过</p><strong className="mt-1 block text-base text-slate-950">{achievement.qualityPassedScenes} 镜</strong></div>
        <div className="rounded-lg bg-white/80 px-3 py-3"><p className="text-[9px] font-bold text-slate-500">可查看成果</p><strong className="mt-1 block text-base text-slate-950">{achievement.artifactCount} 项</strong></div>
        <div className="rounded-lg bg-white/80 px-3 py-3"><p className="text-[9px] font-bold text-slate-500">内容时长</p><strong className="mt-1 block text-base text-slate-950">{formatContentDuration(achievement.durationSeconds)}</strong></div>
      </div>
    </section>
  );
}

export default function ContentProductionExperiencePanel({ task, busy, view, onViewChange, onOpenWorkbench, onRetry }: ContentProductionExperiencePanelProps) {
  const shotCount = contentShotProgress(task).length;
  const exceptionCount = contentProductionExceptions(task).length;
  const tabs: Array<{ id: ContentProductionView; label: string; count?: number }> = [
    { id: 'overview', label: '任务概览' },
    { id: 'shots', label: '逐镜进度', count: shotCount },
    { id: 'exceptions', label: '异常任务', count: exceptionCount },
  ];
  return (
    <>
      <section id="social-production-experience" className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-none" data-content-production-experience>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
          <div><p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-emerald-700"><Sparkles size={12} />制作过程与结果</p><h3 className="mt-1 text-base font-semibold text-slate-950">每一步发生了什么，都可以回来看</h3><p className="mt-1 text-xs text-slate-500">进度、逐镜结果和异常会随任务保存；刷新或离开页面不会重新分析。</p></div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-[10px] font-semibold text-slate-700"><PackageCheck size={12} />自动保存</span>
        </div>
        <Tabs className="px-4" activeKey={view} onChange={key => onViewChange(key as ContentProductionView)} aria-label="内容制作任务视图"
          items={tabs.map(tab => ({ key: tab.id, label: `${tab.label}${typeof tab.count === 'number' ? ` · ${tab.count}` : ''}` }))} />

        <div className="p-4 sm:p-5" role="tabpanel">
          {view === 'overview' && <TaskOverview task={task} />}
          {view === 'shots' && <ShotProgressView task={task} onOpenWorkbench={onOpenWorkbench} />}
          {view === 'exceptions' && <ExceptionView task={task} busy={busy} onOpenWorkbench={onOpenWorkbench} onRetry={onRetry} />}
        </div>
      </section>
      <AchievementCard task={task} />
    </>
  );
}
