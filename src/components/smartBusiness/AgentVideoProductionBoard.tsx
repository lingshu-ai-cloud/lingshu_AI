import { Drawer, Modal, Tag } from 'antd';
import { AlertTriangle, Check, CircleDashed, Clapperboard, Film, Images, Mic2, Play, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { productPointRate } from '../../../shared/pointsPolicy';
import type { LsCalendarEvent } from '../../lib/calendarModel';
import { authHeader } from '../../lib/auth';
import { resolveInspirationPlaybackUrl } from '../../lib/inspirationVideoPlayback';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
import AgentRoleIcon, { type AgentVisualRole } from '../ui/AgentRoleIcon';
import PointsValue from '../ui/PointsValue';
import { LsGradientProgress } from '../ui/LsExperiencePrimitives';
import { buildVideoProductionLanes, type VideoProductionDisplayStatus, type VideoProductionLane } from './agentVideoProductionModel';

const statusLabel: Record<VideoProductionDisplayStatus, string> = {
  planned: '待执行', active: '进行中', completed: '已完成', blocked: '需处理', cancelled: '已取消',
  failed: '执行失败', no_data: '无数据', waiting_upstream: '等待上游', not_created: '尚未派生',
};

const stageRole: Record<string, AgentVisualRole> = {
  planning: 'business', directing: 'director', materials: 'content', production: 'content',
  quality: 'content', distribution: 'customer', learning: 'business',
};

function stateTone(status: VideoProductionDisplayStatus): string {
  if (status === 'completed' || status === 'no_data') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'active') return 'border-blue-200 bg-blue-50 text-blue-800';
  if (status === 'blocked' || status === 'failed') return 'border-amber-300 bg-amber-50 text-amber-900';
  if (status === 'waiting_upstream') return 'border-slate-200 bg-slate-50 text-slate-500';
  return 'border-border bg-white text-text-secondary';
}

function laneTag(lane: VideoProductionLane) {
  const color = lane.status === 'completed' ? 'success' : lane.status === 'active' ? 'processing' : ['blocked', 'failed'].includes(lane.status) ? 'warning' : 'default';
  return <Tag color={color}>{statusLabel[lane.status]}</Tag>;
}

function ProductionRecipe() {
  const avatar = productPointRate('digital-human-video');
  const library = productPointRate('material-library-reuse');
  const aigc = productPointRate('aigc-video-generation');
  const voice = productPointRate('voice-consistency');
  const items = [
    { icon: <Clapperboard size={15}/>, title: '数字人 + 背景', detail: '本人形象与背景合成', rate: avatar },
    { icon: <Images size={15}/>, title: '产品 / 工厂素材', detail: '优先匹配企业素材库', rate: library },
    { icon: <Sparkles size={15}/>, title: 'AIGC 补充镜头', detail: '仅缺镜头时调用', rate: aigc },
    { icon: <Mic2 size={15}/>, title: '统一音色', detail: '独立口播音轨调用', rate: voice },
  ];
  return <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 xl:grid-cols-4" aria-label="视频生产构成">
    {items.map(item => <div key={item.title} className="min-w-0 bg-white p-3">
      <div className="flex items-center gap-2 text-text-primary">{item.icon}<strong className="text-xs">{item.title}</strong></div>
      <p className="mt-1 truncate text-[11px] text-text-secondary">{item.detail}</p>
      <PointsValue className="mt-2 text-xs font-semibold text-text-primary" value={item.rate.points} estimated={item.rate.estimated} suffix="/ 秒"/>
    </div>)}
  </div>;
}

function StageIcon({ status }: { status: VideoProductionDisplayStatus }) {
  if (status === 'completed' || status === 'no_data') return <Check size={13}/>;
  if (status === 'blocked' || status === 'failed') return <AlertTriangle size={13}/>;
  if (status === 'active') return <Play size={12} fill="currentColor"/>;
  return <CircleDashed size={13}/>;
}

export default function AgentVideoProductionBoard({ events, renderDetails, demo = false }: {
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

  useEffect(() => {
    setPlaybackUrl('');
    setPreviewError('');
    if (!previewLane?.previewVideoUrl) return;
    const controller = new AbortController();
    void resolveInspirationPlaybackUrl(previewLane.previewVideoUrl, { signal: controller.signal, headers: authHeader() })
      .then(url => { if (!controller.signal.aborted) setPlaybackUrl(url); })
      .catch(error => { if (!controller.signal.aborted) setPreviewError(error instanceof Error ? error.message : '视频预览暂时不可用'); });
    return () => controller.abort();
  }, [previewLane]);

  return <div className="bg-white">
    <header className="border-b border-border px-4 py-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-accent"><Film size={16}/><span className="text-xs font-bold">内容生产档案</span></div>
          <h3 className="mt-1 text-base font-semibold text-text-primary">本周视频生产总线</h3>
          <p className="mt-1 text-xs text-text-secondary">每行一条视频；节点按真实依赖推进，点击节点查看执行详情。</p>
        </div>
        <div className="flex min-h-11 items-center gap-4 rounded-lg border border-border bg-surface-2 px-4 text-xs text-text-secondary">
          <span><strong className="mr-1 text-base text-text-primary">{lanes.length}</strong>条视频</span>
          <span><strong className="mr-1 text-base text-blue-700">{lanes.filter(lane => lane.status === 'active').length}</strong>生产中</span>
          <span><strong className="mr-1 text-base text-amber-700">{lanes.filter(lane => ['blocked', 'failed'].includes(lane.status)).length}</strong>需处理</span>
        </div>
      </div>
      <div className="mt-3"><ProductionRecipe/></div>
      {demo && <p className="mt-3 text-xs text-amber-700">当前为参考排期，状态仅用于交互验收。</p>}
    </header>

    {lanes.length === 0 && <div className="px-6 py-12 text-center"><CircleDashed className="mx-auto text-text-muted"/><h4 className="mt-3 text-sm font-semibold text-text-primary">尚无视频生产档案</h4><p className="mt-1 text-xs text-text-secondary">视频任务产生真实执行节点后，会在这里自动形成档案。</p></div>}

    {lanes.length > 0 && <div className="max-h-[min(62vh,680px)] divide-y divide-border overflow-y-auto" aria-label="视频生产档案">
      {lanes.map(lane => {
        const percent = lane.total ? Math.round(lane.completed / lane.total * 100) : 0;
        return <article key={lane.id} className="p-3">
          <div className="grid gap-3 sm:grid-cols-[84px_minmax(0,1fr)]">
            <button type="button" onClick={() => lane.previewVideoUrl ? setPreviewLane(lane) : setSelectedId(lane.tasks[0]?.id || null)} className="group relative aspect-video overflow-hidden rounded-lg bg-slate-950 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 sm:aspect-[3/4]" aria-label={`预览 ${lane.title}`}>
              {lane.previewThumbnailUrl ? <img src={lane.previewThumbnailUrl} alt={`${lane.title}视频封面`} className="h-full w-full object-cover"/> : <span className="flex h-full items-center justify-center text-white/45"><Clapperboard size={28}/></span>}
              <span className="absolute inset-0 flex items-center justify-center bg-black/15 transition-colors group-hover:bg-black/30"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-accent shadow-sm"><Play size={13} fill="currentColor"/></span></span>
            </button>

            <div className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2">{laneTag(lane)}<span className="text-xs text-text-muted">{lane.completed}/{lane.total} 个里程碑</span></div><h4 className="mt-1 truncate text-sm font-semibold text-text-primary">{lane.title}</h4><p className="mt-0.5 truncate text-[11px] text-text-secondary">{[lane.platform?.toUpperCase(), lane.publishWindow].filter(Boolean).join(' · ') || lane.context}</p></div>
                <div className="text-right"><span className="block text-[11px] text-text-muted">产品功能积分</span><span className="mt-1 block text-xs font-semibold text-text-secondary">待按交付动作结算</span></div>
              </div>
              <LsGradientProgress className="mt-2" percent={percent} showInfo={false} size="small" status={lane.status === 'failed' || lane.status === 'blocked' ? 'exception' : lane.status === 'completed' ? 'success' : 'active'} aria-label={`${lane.title} 完成 ${lane.completed} / ${lane.total}`}/>

              <div className="mt-2 grid grid-cols-4 gap-1.5 lg:grid-cols-7" aria-label={`${lane.title}生产里程碑`}>
                {lane.stageProjections.map(projection => {
                  const task = projection.primaryTask;
                  return <button key={projection.stage.key} type="button" disabled={!task} onClick={() => task && setSelectedId(task.id)} className={`min-h-[62px] rounded-lg border p-2 text-left transition-colors enabled:hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-default ${stateTone(projection.displayStatus)}`}>
                    <div className="flex items-center justify-between gap-1"><AgentRoleIcon role={stageRole[projection.stage.key]} size="sm" className="h-5 w-5" label={projection.stage.owner}/><span className="inline-flex items-center gap-1 text-[9px] font-semibold"><StageIcon status={projection.displayStatus}/>{statusLabel[projection.displayStatus]}</span></div>
                    <strong className="mt-1.5 block truncate text-[11px] leading-4">{projection.stage.title}</strong>
                  </button>;
                })}
              </div>
            </div>
          </div>
        </article>;
      })}
    </div>}

    {shared.length > 0 && <details className="border-t border-border bg-surface-2/40 px-4 py-2 sm:px-5"><summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-text-primary">本周共同前置、保障与复盘任务（{shared.length}）</summary><div className="grid gap-2 pb-3 md:grid-cols-2 xl:grid-cols-3">{shared.map(task => <button key={task.id} type="button" onClick={() => setSelectedId(task.id)} className={`min-h-11 rounded-lg border p-3 text-left text-xs ${stateTone(task.status)}`}><span className="font-semibold">{task.title}</span><span className="mt-1 block text-[10px] opacity-70">{statusLabel[task.status]}</span></button>)}</div></details>}

    <Drawer title="视频生产步骤详情" size={560} open={Boolean(selected)} onClose={close} destroyOnHidden>{selected && renderDetails(selected, close)}</Drawer>
    <Modal title={previewLane?.title || '视频预览'} open={Boolean(previewLane)} onCancel={() => setPreviewLane(null)} footer={null} width={760} destroyOnHidden>
      <div className="flex min-h-[420px] items-center justify-center overflow-hidden rounded-lg bg-slate-950">
        {playbackUrl ? <video src={playbackUrl} poster={previewLane?.previewThumbnailUrl || undefined} controls autoPlay playsInline className="max-h-[70vh] w-full object-contain">您的浏览器暂不支持视频预览。</video> : previewError ? <div className="px-6 text-center text-sm text-white"><AlertTriangle className="mx-auto mb-3 text-amber-400"/><p>{previewError}</p></div> : <div className="text-center text-sm text-white/80"><CircleDashed className="mx-auto mb-3 animate-spin"/><p>正在准备视频预览…</p></div>}
      </div>
    </Modal>
  </div>;
}
