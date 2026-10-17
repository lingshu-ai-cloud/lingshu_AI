import { Drawer, Modal, Tag } from 'antd';
import { AlertTriangle, Check, ChevronRight, CircleDashed, Clapperboard, Play, Workflow } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LsCalendarEvent } from '../../lib/calendarModel';
import { authHeader } from '../../lib/auth';
import { resolveInspirationPlaybackUrl } from '../../lib/inspirationVideoPlayback';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
import AgentRoleIcon, { type AgentVisualRole } from '../ui/AgentRoleIcon';
import { buildVideoProductionLanes, VIDEO_PRODUCTION_STAGES, type VideoProductionLane } from './agentVideoProductionModel';

const statusLabel: Record<AgentCalendarTask['status'], string> = {
  planned: '待执行', active: '进行中', completed: '已完成', blocked: '需处理',
  cancelled: '已取消', failed: '执行失败', no_data: '无数据',
};

const stageRole: Record<string, AgentVisualRole> = {
  planning: 'business', directing: 'director', materials: 'content', production: 'content',
  quality: 'content', distribution: 'customer', learning: 'business',
};

function stateTone(status: AgentCalendarTask['status']): string {
  if (status === 'completed' || status === 'no_data') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'active') return 'border-blue-200 bg-blue-50 text-blue-800';
  if (status === 'blocked' || status === 'failed') return 'border-amber-300 bg-amber-50 text-amber-900';
  if (status === 'cancelled') return 'border-slate-200 bg-slate-50 text-slate-500';
  return 'border-border bg-white text-text-primary';
}

function laneTag(lane: VideoProductionLane) {
  const color = lane.status === 'completed' ? 'success' : lane.status === 'active' ? 'processing' : ['blocked', 'failed'].includes(lane.status) ? 'warning' : 'default';
  return <Tag color={color}>{statusLabel[lane.status]}</Tag>;
}

export default function AgentVideoProductionBoard({
  events,
  renderDetails,
  demo = false,
}: {
  events: LsCalendarEvent[];
  renderDetails: (event: LsCalendarEvent, close: () => void) => ReactNode;
  demo?: boolean;
}) {
  const tasks = useMemo(() => events.map(event => event.data as AgentCalendarTask), [events]);
  const { lanes, shared } = useMemo(() => buildVideoProductionLanes(tasks), [tasks]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewLane, setPreviewLane] = useState<VideoProductionLane | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [previewError, setPreviewError] = useState('');
  const selected = events.find(event => event.id === selectedId) ?? null;
  const close = () => setSelectedId(null);
  const attention = lanes.filter(lane => ['blocked', 'failed'].includes(lane.status)).length;
  const active = lanes.filter(lane => lane.status === 'active').length;
  useEffect(() => {
    setPlaybackUrl(''); setPreviewError('');
    if (!previewLane?.previewVideoUrl) return;
    const controller = new AbortController();
    void resolveInspirationPlaybackUrl(previewLane.previewVideoUrl, { signal: controller.signal, headers: authHeader() })
      .then(url => { if (!controller.signal.aborted) setPlaybackUrl(url); })
      .catch(error => { if (!controller.signal.aborted) setPreviewError(error instanceof Error ? error.message : '视频预览暂时不可用'); });
    return () => controller.abort();
  }, [previewLane]);

  return <div className="border-t border-border bg-white">
    <header className="border-b border-border px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-accent"><Workflow size={16}/><span className="text-xs font-bold">固定生产路径</span></div>
          <h3 className="mt-1 text-lg font-semibold text-text-primary">按视频推进的 Agent 生产轨道</h3>
          <p className="mt-1 text-xs leading-5 text-text-secondary">一条视频对应一条轨道；任务按真实依赖向右交接，未创建的节点保持空缺，不按日期制造虚假进度。</p>
        </div>
        <div className="flex min-h-11 items-center divide-x divide-border rounded-lg border border-border bg-surface-2 px-1 text-xs text-text-secondary">
          <span className="px-3"><strong className="mr-1 text-base text-text-primary">{lanes.length}</strong>条视频</span>
          <span className="px-3"><strong className="mr-1 text-base text-blue-700">{active}</strong>生产中</span>
          <span className="px-3"><strong className="mr-1 text-base text-amber-700">{attention}</strong>需处理</span>
        </div>
      </div>
      <details className="mt-4 rounded-lg border border-border bg-surface-2/60">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 text-xs font-semibold text-text-primary">查看固定路径的调用、交接与稳定性规则 <ChevronRight size={14}/></summary>
        <div className="grid gap-px border-t border-border bg-border lg:grid-cols-7">
          {VIDEO_PRODUCTION_STAGES.map((stage, index) => <section key={stage.key} className="bg-white p-3">
            <div className="flex items-center gap-2"><span className="text-[10px] font-bold text-text-muted">{index + 1}</span><AgentRoleIcon role={stageRole[stage.key]} size="sm" className="h-7 w-7" label={stage.owner}/><strong className="text-xs text-text-primary">{stage.title}</strong></div>
            <dl className="mt-3 space-y-2 text-[11px] leading-4"><div><dt className="font-semibold text-text-secondary">调用</dt><dd className="text-text-muted">{stage.invocation}</dd></div><div><dt className="font-semibold text-text-secondary">交接</dt><dd className="text-text-muted">{stage.handoff}</dd></div><div><dt className="font-semibold text-text-secondary">质量门</dt><dd className="text-text-muted">{stage.qualityGate}</dd></div></dl>
          </section>)}
        </div>
      </details>
      {demo && <p className="mt-3 text-xs text-amber-700">当前为参考排期，状态仅用于交互验收。</p>}
    </header>

    {lanes.length === 0 && <div className="px-6 py-12 text-center"><CircleDashed className="mx-auto text-text-muted"/><h4 className="mt-3 text-sm font-semibold text-text-primary">尚无可归属到视频的执行任务</h4><p className="mt-1 text-xs text-text-secondary">视频任务生成后，会按固定生产路径自动进入独立轨道。</p></div>}

    {lanes.length > 0 && <div className="overflow-x-auto" aria-label="视频生产任务轨道">
      <div className="min-w-[1320px]">
        <div className="grid grid-cols-[260px_repeat(7,minmax(142px,1fr))] border-b border-border bg-surface-2/70">
          <div className="px-5 py-3 text-[11px] font-semibold text-text-secondary">视频任务</div>
          {VIDEO_PRODUCTION_STAGES.map(stage => <div key={stage.key} className="border-l border-border px-3 py-3"><div className="flex items-center gap-2"><AgentRoleIcon role={stageRole[stage.key]} size="sm" className="h-7 w-7" label={stage.owner}/><span className="text-xs font-semibold text-text-primary">{stage.title}</span></div><p className="mt-1 truncate text-[10px] text-text-muted">{stage.owner}</p></div>)}
        </div>
        {lanes.map((lane, laneIndex) => <article key={lane.id} className={`grid grid-cols-[260px_repeat(7,minmax(142px,1fr))] border-b border-border last:border-b-0 ${laneIndex % 2 ? 'bg-surface-2/20' : 'bg-white'}`}>
          <div className="min-w-0 px-4 py-3">
            <button type="button" onClick={() => lane.previewVideoUrl ? setPreviewLane(lane) : setSelectedId(lane.tasks[0]?.id || null)} className="group flex w-full gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30" aria-label={`预览 ${lane.title}`}>
              <span className="relative h-[112px] w-[72px] shrink-0 overflow-hidden rounded-lg bg-slate-900">
                {lane.previewThumbnailUrl ? <img src={lane.previewThumbnailUrl} alt={`${lane.title}视频封面`} className="h-full w-full object-cover"/> : <span className="flex h-full items-center justify-center text-white/45"><Clapperboard size={22}/></span>}
                <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover:bg-black/25"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-accent shadow-sm"><Play size={14} fill="currentColor"/></span></span>
                <span className="absolute left-1.5 top-1.5 rounded-full bg-black/65 px-1.5 py-0.5 text-[8px] font-bold text-white">视频预览</span>
              </span>
              <span className="min-w-0 flex-1 py-0.5">
                <span className="flex flex-wrap items-center gap-1.5">{laneTag(lane)}<span className="text-[10px] text-text-muted">{lane.completed}/{lane.total} 步</span></span>
                <span className="mt-2 line-clamp-3 text-xs font-semibold leading-5 text-text-primary">{lane.title}</span>
                <span className="mt-1 block truncate text-[10px] text-text-secondary">{[lane.platform?.toUpperCase(), lane.publishWindow].filter(Boolean).join(' · ') || '点击查看参考视频'}</span>
              </span>
            </button>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-label={`完成 ${lane.completed} / ${lane.total}`}><div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-violet-600" style={{width:`${lane.total ? Math.round(lane.completed / lane.total * 100) : 0}%`}}/></div>
          </div>
          {VIDEO_PRODUCTION_STAGES.map(stage => {
            const stageTasks = lane.stages[stage.key];
            const task = stageTasks.find(item => ['failed', 'blocked', 'active'].includes(item.status)) ?? stageTasks.at(-1);
            if (!task) return <div key={stage.key} className="flex min-h-[138px] items-center border-l border-border px-3 py-4"><div className="w-full rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-[10px] text-text-muted"><CircleDashed className="mx-auto mb-2" size={14}/>尚未派生</div></div>;
            const Icon = task.status === 'completed' ? Check : ['blocked', 'failed'].includes(task.status) ? AlertTriangle : task.status === 'active' ? Play : CircleDashed;
            return <div key={stage.key} className="flex min-h-[138px] items-stretch border-l border-border px-2.5 py-3">
              <button type="button" onClick={() => setSelectedId(task.id)} className={`w-full rounded-lg border p-3 text-left transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${stateTone(task.status)}`}>
                <div className="flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1 text-[10px] font-semibold"><Icon size={12}/>{statusLabel[task.status]}</span>{stageTasks.length > 1 && <span className="text-[10px] opacity-70">{stageTasks.length} 项</span>}</div>
                <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5">{task.title.replace(/^\s*\d+[.、．]\s*/, '').split(/\s+·\s+/)[0]}</p>
                {task.reason && ['blocked', 'failed'].includes(task.status)
                  ? <p className="mt-2 line-clamp-2 text-[10px] leading-4 opacity-80" title={task.reason}>{task.reason.split('；')[0]}</p>
                  : <p className="mt-2 text-[10px] opacity-70">{task.minutes === null ? '工时待估' : `预计 ${task.minutes} 分钟`} · {task.date}</p>}
              </button>
            </div>;
          })}
        </article>)}
      </div>
    </div>}

    {shared.length > 0 && <details className="border-t border-border bg-surface-2/40 px-5 py-3 sm:px-6"><summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-text-primary">本周共同前置、保障与复盘任务（{shared.length}）</summary><div className="grid gap-2 pb-3 md:grid-cols-2 xl:grid-cols-3">{shared.map(task => <button key={task.id} type="button" onClick={() => setSelectedId(task.id)} className={`min-h-11 rounded-lg border p-3 text-left text-xs ${stateTone(task.status)}`}><span className="font-semibold">{task.title}</span><span className="mt-1 block text-[10px] opacity-70">{statusLabel[task.status]} · {task.agent === 'business' ? '经营 Agent' : task.agent === 'director' ? '编导 Agent' : task.agent === 'content' ? '内容 Agent' : task.agent === 'customer' ? '客服 Agent' : '人工处理'}</span></button>)}</div></details>}

    <Drawer title="视频生产步骤详情" size={560} open={Boolean(selected)} onClose={close} destroyOnHidden>
      {selected && renderDetails(selected, close)}
    </Drawer>
    <Modal title={previewLane?.title || '视频预览'} open={Boolean(previewLane)} onCancel={() => setPreviewLane(null)} footer={null} width={760} destroyOnHidden>
      <div className="flex min-h-[420px] items-center justify-center overflow-hidden rounded-lg bg-slate-950">
        {playbackUrl ? <video src={playbackUrl} poster={previewLane?.previewThumbnailUrl || undefined} controls autoPlay playsInline className="max-h-[70vh] w-full object-contain">您的浏览器暂不支持视频预览。</video>
          : previewError ? <div className="px-6 text-center text-sm text-white"><AlertTriangle className="mx-auto mb-3 text-amber-400"/><p>{previewError}</p></div>
          : <div className="text-center text-sm text-white/80"><CircleDashed className="mx-auto mb-3 animate-spin"/><p>正在准备视频预览…</p></div>}
      </div>
    </Modal>
  </div>;
}
