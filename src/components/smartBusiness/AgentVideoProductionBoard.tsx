import { Drawer, Modal } from 'antd';
import { Gantt, type ITask } from '@svar-ui/react-gantt';
import { AlertTriangle, CalendarRange, Check, CircleDashed, Play } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LsCalendarEvent } from '../../lib/calendarModel';
import { authHeader } from '../../lib/auth';
import { resolveInspirationPlaybackUrl } from '../../lib/inspirationVideoPlayback';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
import {
  VIDEO_PRODUCTION_STAGES,
  buildVideoProductionLanes,
  persistedVideoTasks,
  productionStageForTask,
  type VideoProductionDisplayStatus,
  type VideoProductionLane,
  type VideoProductionStage,
  type VideoProductionStageProjection,
} from './agentVideoProductionModel';

const statusLabel: Record<VideoProductionDisplayStatus, string> = {
  planned: '待执行', active: '进行中', completed: '已完成', blocked: '需处理', cancelled: '已取消',
  failed: '执行失败', no_data: '无数据', waiting_upstream: '等待上游', not_created: '尚未派生',
};

const agentLabel: Record<AgentCalendarTask['agent'], string> = {
  human: '人工处理', business: '经营 Agent', director: '编导 Agent', content: '内容 Agent', customer: '客服 Agent',
};

function StageIcon({ status }: { status: VideoProductionDisplayStatus }) {
  if (status === 'completed' || status === 'no_data') return <Check size={13}/>;
  if (status === 'blocked' || status === 'failed') return <AlertTriangle size={13}/>;
  if (status === 'active') return <Play size={12} fill="currentColor"/>;
  return <CircleDashed size={13}/>;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateAtNoon(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shiftDay(date: Date, amount: number): Date {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + amount);
  return shifted;
}

export function ganttDateKeys(tasks: AgentCalendarTask[]): string[] {
  const dated = tasks.map(task => task.date).filter(value => dateAtNoon(value)).sort();
  const seed = dateAtNoon(dated[0] || dateKey(new Date())) || new Date();
  const last = dateAtNoon(dated.at(-1) || dated[0] || dateKey(new Date())) || seed;
  const start = shiftDay(seed, -((seed.getDay() + 6) % 7));
  const minimumEnd = shiftDay(start, 6);
  const today = dateAtNoon(dateKey(new Date())) || seed;
  const currentWeekEnd = shiftDay(today, 6 - ((today.getDay() + 6) % 7));
  const lastWeekEnd = shiftDay(last, 6 - ((last.getDay() + 6) % 7));
  const end = [lastWeekEnd, minimumEnd, currentWeekEnd].reduce((latest, value) => value > latest ? value : latest);
  const result: string[] = [];
  for (let cursor = start; cursor <= end; cursor = shiftDay(cursor, 1)) result.push(dateKey(cursor));
  return result;
}

export type GanttWeek = { key: string; start: string; end: string; days: string[] };

export function ganttWeeks(tasks: AgentCalendarTask[]): GanttWeek[] {
  const days = ganttDateKeys(tasks);
  const weeks: GanttWeek[] = [];
  for (let index = 0; index < days.length; index += 7) {
    const weekDays = days.slice(index, index + 7);
    if (!weekDays.length) continue;
    weeks.push({ key: weekDays[0]!, start: weekDays[0]!, end: weekDays.at(-1)!, days: weekDays });
  }
  return weeks;
}

export function ganttFocusDay(tasks: AgentCalendarTask[], today: string): string {
  const dated = tasks.map(task => task.date).filter(value => dateAtNoon(value)).sort();
  if (!dated.length) return today;
  const first = dateAtNoon(dated[0]!)!;
  const rangeStart = dateKey(shiftDay(first, -((first.getDay() + 6) % 7)));
  const last = dateAtNoon(dated.at(-1)!)!;
  const rangeEnd = dateKey(shiftDay(last, 6 - ((last.getDay() + 6) % 7)));
  if (today >= rangeStart && today <= rangeEnd) return today;
  return today < rangeStart ? dated[0]! : dated.at(-1)!;
}

export type GanttRow = {
  id: string;
  stage: VideoProductionStage | null;
  task: AgentCalendarTask | null;
  status: VideoProductionDisplayStatus;
  label: string;
  owner: string;
};

function taskDisplayStatus(task: AgentCalendarTask, projection?: VideoProductionStageProjection): VideoProductionDisplayStatus {
  if (projection && !projection.upstreamReady && !['failed', 'blocked'].includes(task.status)) return 'waiting_upstream';
  return task.status;
}

export function ganttRows(lane: VideoProductionLane): GanttRow[] {
  const rows: GanttRow[] = lane.stageProjections.flatMap((projection): GanttRow[] => projection.tasks.length
    ? projection.tasks.map(task => ({
        id: task.id,
        stage: projection.stage,
        task,
        status: taskDisplayStatus(task, projection),
        label: task.title,
        owner: task.assignee || agentLabel[task.agent] || projection.stage.owner,
      }))
    : [{
        id: `${lane.id}:${projection.stage.key}:uncreated`,
        stage: projection.stage,
        task: null,
        status: projection.displayStatus,
        label: projection.stage.title,
        owner: projection.stage.owner,
      }]);
  const unmapped: GanttRow[] = lane.tasks.filter(task => !productionStageForTask(task)).map(task => ({
    id: task.id,
    stage: null,
    task,
    status: task.status as VideoProductionDisplayStatus,
    label: task.title,
    owner: task.assignee || agentLabel[task.agent],
  }));
  return [...rows, ...unmapped];
}

function barTone(status: VideoProductionDisplayStatus): string {
  if (status === 'completed' || status === 'no_data') return 'border-emerald-700 bg-emerald-700 text-white';
  if (status === 'active') return 'border-blue-600 bg-gradient-to-r from-blue-600 to-violet-600 text-white';
  if (status === 'blocked') return 'border-amber-400 bg-amber-100 text-amber-950';
  if (status === 'failed') return 'border-red-500 bg-red-50 text-red-800';
  if (status === 'waiting_upstream') return 'border-zinc-300 bg-zinc-100 text-zinc-500';
  if (status === 'not_created') return 'border-zinc-200 bg-white text-zinc-400';
  if (status === 'cancelled') return 'border-zinc-300 bg-zinc-100 text-zinc-500 line-through';
  return 'border-violet-300 bg-violet-50 text-violet-800';
}

export function groupGanttNodesByWeek(rows: GanttRow[], weeks: GanttWeek[]): GanttRow[][] {
  const grouped = weeks.map((): GanttRow[] => []);
  for (const row of rows) {
    if (!row.task) continue;
    const weekIndex = weeks.findIndex(week => row.task!.date >= week.start && row.task!.date <= week.end);
    if (weekIndex >= 0) grouped[weekIndex]!.push(row);
  }
  return grouped;
}

function compactOwner(owner: string): string {
  return owner.replace(/\s*Agent/g, '').replace(' + 人工', '+人工');
}

function shortDay(day: string): string {
  return day.slice(5).replace('-', '/');
}

function mondayOf(value: string): Date {
  const seed = dateAtNoon(value) || new Date();
  const monday = shiftDay(seed, -((seed.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function endOfWeekExclusive(value: string): Date {
  return shiftDay(mondayOf(value), 7);
}

type ProductionGanttTask = ITask & {
  id: string;
  laneId: string;
  nodes: GanttRow[];
};

export function productionGanttTasks(lanes: VideoProductionLane[], actualTasksOnly = false): ProductionGanttTask[] {
  return lanes.map(lane => {
    const sourceRows = actualTasksOnly ? persistedVideoTasks(lane.tasks).map(task => ({ id: task.id, stage: productionStageForTask(task), task, status: task.status as VideoProductionDisplayStatus, label: task.title, owner: task.assignee || agentLabel[task.agent] })) : ganttRows(lane);
    const rows = actualTasksOnly ? sourceRows : sourceRows.sort((left, right) => {
      const leftStage = VIDEO_PRODUCTION_STAGES.findIndex(stage => stage.key === left.stage?.key);
      const rightStage = VIDEO_PRODUCTION_STAGES.findIndex(stage => stage.key === right.stage?.key);
      return leftStage - rightStage || String(left.task?.time || '').localeCompare(String(right.task?.time || ''));
    });
    const dated = lane.tasks.map(task => task.date).filter(value => dateAtNoon(value)).sort();
    const startKey = dated[0] || dateKey(new Date());
    const endKey = dated.at(-1) || startKey;
    const completed = rows.filter(row => row.status === 'completed' || row.status === 'no_data').length;
    return {
      id: lane.id,
      laneId: lane.id,
      text: lane.title,
      details: lane.title,
      type: 'task',
      start: mondayOf(startKey),
      end: endOfWeekExclusive(endKey),
      duration: Math.max(1, Math.round((endOfWeekExclusive(endKey).getTime() - mondayOf(startKey).getTime()) / 86_400_000)),
      progress: rows.length ? Math.round(completed / rows.length * 100) : 0,
      nodes: rows,
    };
  });
}

export default function AgentVideoProductionBoard({ events, renderDetails, demo = false, actualTasksOnly = false, onOpenTask }: {
  events: LsCalendarEvent[];
  renderDetails: (event: LsCalendarEvent, close: () => void) => ReactNode;
  demo?: boolean;
  actualTasksOnly?: boolean;
  onOpenTask?: (task: AgentCalendarTask) => void;
}) {
  const tasks = useMemo(() => { const actual = events.map(event => event.data as AgentCalendarTask); return actualTasksOnly ? persistedVideoTasks(actual) : actual; }, [events, actualTasksOnly]);
  const { lanes, shared } = useMemo(() => buildVideoProductionLanes(tasks), [tasks]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewLane, setPreviewLane] = useState<VideoProductionLane | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [previewError, setPreviewError] = useState('');
  const selected = events.find(event => event.id === selectedId) ?? null;
  const close = () => setSelectedId(null);
  const weeks = useMemo(() => ganttWeeks(tasks), [tasks]);
  const today = dateKey(new Date());
  const focusDay = useMemo(() => ganttFocusDay(tasks, today), [tasks, today]);
  const eventByTaskId = useMemo(() => new Map(events.map(event => [event.id, event])), [events]);
  const ganttTasks = useMemo(() => productionGanttTasks(lanes, actualTasksOnly), [lanes, actualTasksOnly]);
  const chartStart = weeks[0] ? mondayOf(weeks[0].start) : mondayOf(focusDay);
  const chartEnd = weeks.at(-1) ? endOfWeekExclusive(weeks.at(-1)!.end) : endOfWeekExclusive(focusDay);

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
    <header className="flex items-center gap-2.5 border-b border-border px-4 py-3"><CalendarRange size={18} className="shrink-0 text-accent"/><h3 className="text-base font-semibold text-text-primary">Agent 工作排期</h3>{demo && <span className="text-xs text-amber-700">参考排期</span>}</header>

    {lanes.length === 0 && <div className="px-6 py-12 text-center"><CircleDashed className="mx-auto text-text-muted"/><h4 className="mt-3 text-sm font-semibold text-text-primary">尚无生产排期</h4><p className="mt-1 text-xs text-text-secondary">真实执行节点派生后会自动进入甘特图。</p></div>}

    {actualTasksOnly && lanes.length > 0 && <div aria-label="视频真实执行进展" className="divide-y divide-border">
      {ganttTasks.map(row => <article key={row.id} className="grid min-w-0 gap-3 p-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="min-w-0"><h4 className="text-sm font-medium text-text-primary">{row.text}</h4><p className="mt-2 text-xs text-text-secondary">{row.nodes.filter(node => node.status === 'completed' || node.status === 'no_data').length}/{row.nodes.length} 个节点已完成</p><div role="progressbar" aria-label={`${row.text}节点完成进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.progress} className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-accent" style={{width:`${row.progress}%`}}/></div></div>
        <div className="flex min-w-0 gap-2 overflow-x-auto pb-2" aria-label={`${row.text}执行节点`}>
          {row.nodes.map(node => <button key={node.id} data-execution-task-id={node.task?.workspaceTarget?.executionTaskId || node.task?.productionTaskId || node.id} type="button" className={`flex w-36 shrink-0 flex-col gap-1 rounded-lg border p-2 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${barTone(node.status)}`} onClick={() => { setSelectedId(node.id); if(node.task)onOpenTask?.(node.task); }}>
            <span className="flex items-center gap-1"><StageIcon status={node.status}/>{statusLabel[node.status]}</span><strong>{node.label}</strong><span>{node.owner}</span><span>{node.task?.date} {node.task?.time}</span>
          </button>)}
        </div>
      </article>)}
    </div>}

    {!actualTasksOnly && lanes.length > 0 && <div aria-label="Agent 生产甘特图" className="agent-production-gantt min-h-[430px] overflow-hidden" style={{ height: `${Math.max(430, 62 + ganttTasks.length * 54)}px` }}>
      <Gantt
        tasks={ganttTasks}
        readonly
        start={chartStart}
        end={chartEnd}
        autoScale={false}
        lengthUnit="day"
        durationUnit="day"
        cellWidth={92}
        cellHeight={54}
        scaleHeight={30}
        gridWidth={286}
        cellBorders="full"
        scales={[
          { unit: 'week', step: 1, format: date => `${shortDay(dateKey(date))} 起` },
          { unit: 'day', step: 1, format: date => `${date.getDate()} · 周${'日一二三四五六'[date.getDay()]}` },
        ]}
        init={api => {
          const focusDate = dateAtNoon(focusDay) || new Date();
          queueMicrotask(() => void api.exec('scroll-chart', { date: focusDate }));
        }}
        columns={[{ id: 'text', header: '内容', width: 286, flexgrow: 1, resize: true }]}
        highlightTime={(date, unit) => unit === 'day' && dateKey(date) === today ? 'agent-gantt-today' : ''}
        taskTemplate={({ data }) => {
          const item = data as ProductionGanttTask;
          return <div className="grid h-full w-full gap-1 p-1" style={{ gridTemplateColumns: `repeat(${Math.max(1, item.nodes.length)}, minmax(72px, 88px))`, justifyContent: 'space-between' }}>
            {item.nodes.map(node => {
              const clickable = Boolean(node.task && eventByTaskId.has(node.task.id));
              return <button key={node.id} type="button" disabled={!clickable} onClick={event => { event.stopPropagation(); if (node.task) { setSelectedId(node.task.id); onOpenTask?.(node.task); } }} data-production-node={node.stage?.key || node.task?.executionStep || 'unmapped'} title={`${node.label} · ${node.owner} · ${statusLabel[node.status]} · ${node.task?.date || '尚未排期'}${node.task?.time ? ` ${node.task.time}` : ''}`} className={`flex min-w-0 items-center gap-1 overflow-hidden rounded-md border px-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-default ${barTone(node.status)}`}>
                <StageIcon status={node.status}/><span className="min-w-0 flex-1 leading-none"><strong className="block truncate text-[10px] font-semibold leading-[12px]">{actualTasksOnly ? node.label.split(/\s+·\s+/)[0] : node.stage?.title || node.label}</strong><span className="block truncate text-[9px] leading-[11px] opacity-80">{compactOwner(node.owner)}</span></span>
              </button>;
            })}
          </div>;
        }}
        onSelectTask={({ id }) => {
          const lane = lanes.find(item => item.id === String(id));
          if (!lane) return;
          if (lane.previewVideoUrl) setPreviewLane(lane);
          else if (lane.tasks[0]) { setSelectedId(lane.tasks[0].id); onOpenTask?.(lane.tasks[0]); }
        }}
      />
      {!actualTasksOnly && shared.length > 0 && <div className="sr-only">共同任务：{shared.map(task => task.title).join('、')}</div>}
    </div>}

    {actualTasksOnly && shared.length > 0 && <details className="border-t border-border p-4"><summary className="cursor-pointer text-sm font-medium">共同前置与复盘任务 · {shared.length} 项</summary><div className="mt-3 flex flex-wrap gap-2">{shared.map(task => <button key={task.id} type="button" className="rounded-lg border border-border px-3 py-2 text-xs" onClick={() => { setSelectedId(task.id); onOpenTask?.(task); }}>{task.title}</button>)}</div></details>}
    <Drawer title="视频生产步骤详情" size={560} open={Boolean(selected)} onClose={close} destroyOnHidden>{selected && renderDetails(selected, close)}</Drawer>
    <Modal title={previewLane?.title || '视频预览'} open={Boolean(previewLane)} onCancel={() => setPreviewLane(null)} footer={null} width={760} destroyOnHidden>
      <div className="flex min-h-[420px] items-center justify-center overflow-hidden rounded-lg bg-slate-950">
        {playbackUrl ? <video src={playbackUrl} poster={previewLane?.previewThumbnailUrl || undefined} controls autoPlay playsInline className="max-h-[70vh] w-full object-contain">您的浏览器暂不支持视频预览。</video> : previewError ? <div className="px-6 text-center text-sm text-white"><AlertTriangle className="mx-auto mb-3 text-amber-400"/><p>{previewError}</p></div> : <div className="text-center text-sm text-white/80"><CircleDashed className="mx-auto mb-3 animate-spin"/><p>正在准备视频预览…</p></div>}
      </div>
    </Modal>
  </div>;
}
