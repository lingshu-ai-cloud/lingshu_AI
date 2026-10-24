import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';

export const VIDEO_PROGRESS_STAGES = [
  { key: 'benchmark', label: '对标分析', steps: ['benchmark_collection', 'benchmark_scoring', 'director_analysis'] },
  { key: 'planning', label: '脚本与分镜', steps: ['business_schedule', 'script', 'storyboard'] },
  { key: 'generation', label: '成片制作', steps: ['material_preparation', 'material_readiness', 'asset_generation', 'video_generation', 'rework'] },
  { key: 'quality', label: '质量检查', steps: ['quality_check'] },
  { key: 'delivery', label: '审阅交付', steps: ['user_approval', 'publishing', 'performance_monitoring'] },
] as const;

type StageState = 'completed' | 'active' | 'attention' | 'planned' | 'empty';

export type VideoProgressStage = {
  key: typeof VIDEO_PROGRESS_STAGES[number]['key'];
  label: string;
  state: StageState;
  tasks: AgentCalendarTask[];
};

export type VideoProgressRow = {
  id: string;
  title: string;
  platform: string;
  dateRange: string;
  completedStages: number;
  stages: VideoProgressStage[];
};

function sourceTasks(task: AgentCalendarTask): AgentCalendarTask[] {
  return task.dailyTaskGroup?.tasks ?? task.internalNodes ?? [task];
}

function deliverablePublicationId(task: AgentCalendarTask): string | undefined {
  if (!task.deliverableGroup) return undefined;
  try {
    const value = JSON.parse(task.deliverableGroup) as unknown;
    return Array.isArray(value) && typeof value.at(-1) === 'string' ? value.at(-1) as string : task.deliverableGroup;
  } catch { return task.deliverableGroup; }
}

function conciseVideoTitle(tasks: AgentCalendarTask[], index: number): string {
  const topic = tasks.map(task => task.title.split(' · ').slice(1).join(' · ').trim()).find(value => value && !value.includes('待编导明确'));
  if (topic) return topic.slice(0, 54);
  const outputTopic = tasks.map(task => task.output?.split(' · ')[0]?.trim()).find(value => value && !value.startsWith('待交付'));
  if (outputTopic) return outputTopic.slice(0, 54);
  const contexts = tasks.map(task => task.context?.trim()).filter(Boolean);
  const candidate = contexts.find(value => value.length <= 48) ?? contexts[0];
  if (candidate) return candidate.split(/[。；;\n]/)[0].slice(0, 54);
  const output = tasks.map(task => task.output?.trim()).find(Boolean);
  return output?.split(/[·。；;\n]/)[0].slice(0, 54) || `视频 ${String(index + 1).padStart(2, '0')}`;
}

function stageState(tasks: AgentCalendarTask[]): StageState {
  if (!tasks.length) return 'empty';
  if (tasks.some(task => task.status === 'failed' || task.status === 'blocked')) return 'attention';
  if (tasks.some(task => task.status === 'active')) return 'active';
  if (tasks.some(task => ['completed', 'no_data'].includes(task.status))) return 'completed';
  return 'planned';
}

export function buildVideoProgressRows(input: AgentCalendarTask[]): VideoProgressRow[] {
  const flattened = [...new Map(input.flatMap(sourceTasks).map(task => [task.id, task])).values()];
  const publicationGroups = new Map<string, string>();
  for (const task of flattened) {
    const publicationId = deliverablePublicationId(task) ?? task.publicationExecutionTarget?.publicationTaskId ?? task.customerExecutionTarget?.publicationTaskId;
    if (publicationId) publicationGroups.set(publicationId, task.productionTaskId ?? publicationId);
  }
  const groups = new Map<string, AgentCalendarTask[]>();
  for (const task of flattened) {
    const publicationId = deliverablePublicationId(task) ?? task.publicationExecutionTarget?.publicationTaskId ?? task.customerExecutionTarget?.publicationTaskId;
    const identities = new Set<string>();
    if (task.productionTaskId) identities.add(task.productionTaskId);
    if (publicationId) identities.add(publicationGroups.get(publicationId) ?? publicationId);
    for (const affectedId of task.affectedPublicationIds ?? []) identities.add(publicationGroups.get(affectedId) ?? affectedId);
    if (!identities.size && task.productionExecutionTaskId) identities.add(task.productionExecutionTaskId);
    for (const identity of identities) {
      const group = groups.get(identity) ?? [];
      if (!group.some(item => item.id === task.id)) group.push(task);
      groups.set(identity, group);
    }
  }
  const rows = [...groups.entries()].map(([id, tasks], index) => {
    const dates = tasks.map(task => task.date).filter(Boolean).sort();
    const stages = VIDEO_PROGRESS_STAGES.map(stage => {
      const stageTasks = tasks.filter(task => stage.steps.includes((task.executionStep ?? '') as never));
      return { key: stage.key, label: stage.label, state: stageState(stageTasks), tasks: stageTasks };
    });
    return {
      id,
      title: conciseVideoTitle(tasks, index),
      platform: [...new Set(tasks.map(task => task.platform).filter(Boolean))].join('、') || '待确认渠道',
      dateRange: dates.length ? dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} — ${dates.at(-1)}` : '待排期',
      completedStages: stages.filter(stage => stage.state === 'completed').length,
      stages,
    };
  }).sort((a, b) => a.dateRange.localeCompare(b.dateRange));
  const titleCounts = new Map<string, number>();
  for (const row of rows) titleCounts.set(row.title, (titleCounts.get(row.title) ?? 0) + 1);
  return rows.map((row, index) => titleCounts.get(row.title)! > 1
    ? { ...row, title: `视频 ${String(index + 1).padStart(2, '0')} · 主题待编导明确` }
    : row);
}

const stageLabels: Record<StageState, string> = {
  completed: '已完成', active: '进行中', attention: '需处理', planned: '待执行', empty: '未排期',
};

export function videoProgressPosition(stages: VideoProgressStage[]): { percent: number; currentIndex: number; state: StageState } {
  const currentIndex = stages.findIndex(stage => stage.state !== 'completed');
  if (currentIndex < 0) return { percent: 100, currentIndex: stages.length - 1, state: 'completed' };
  const state = stages[currentIndex]!.state;
  return { percent: (currentIndex / stages.length) * 100, currentIndex, state };
}

export default function VideoProgressTable({ tasks, hideCompleted = false, onOpenTask }: {
  tasks: AgentCalendarTask[];
  hideCompleted?: boolean;
  onOpenTask: (task: AgentCalendarTask) => void;
}) {
  const rows = buildVideoProgressRows(tasks).filter(row => !hideCompleted || row.completedStages < VIDEO_PROGRESS_STAGES.length);
  if (!rows.length) return <div className="m-4 rounded-xl border border-dashed border-border p-8 text-center"><p className="text-sm font-medium text-text-primary">暂无视频生产任务</p><p className="mt-1 text-xs text-text-secondary">生成视频任务或调整当前筛选后，进度会显示在这里。</p></div>;
  return <div className="overflow-x-auto border-t border-border bg-slate-50/40" aria-label="视频生产进度表">
    <div className="min-w-[920px]">
      <div className="grid grid-cols-[180px_1fr] border-b border-slate-200 bg-slate-50/90 text-xs font-medium text-text-secondary">
        <div className="sticky left-0 z-20 bg-slate-50 px-5 py-3">视频</div>
        <div className="grid grid-cols-5 px-5">{VIDEO_PROGRESS_STAGES.map(stage => <div key={stage.key} className="px-2 py-3 text-center">{stage.label}</div>)}</div>
      </div>
      {rows.map((row, index) => {
        const progress = videoProgressPosition(row.stages);
        const currentStage = row.stages[progress.currentIndex];
        const markerPosition = progress.percent === 0 ? 'translate-x-0' : progress.percent === 100 ? '-translate-x-full' : '-translate-x-1/2';
        const showMarker = progress.percent > 0 || !['planned','empty'].includes(progress.state);
        return <div key={row.id} className="grid min-h-12 grid-cols-[180px_1fr] border-b border-slate-100 bg-white last:border-b-0 hover:bg-blue-50/20">
        <div className="sticky left-0 z-10 flex min-w-0 items-center gap-2.5 bg-inherit px-5 py-2">
          <span className="shrink-0 text-xs tabular-nums text-text-tertiary">{String(index + 1).padStart(2, '0')}</span>
          <p className="truncate text-sm font-medium text-text-primary" title={row.title}>{row.title}</p>
        </div>
        <div className="relative flex items-center px-5 py-2">
          <div className="relative h-2.5 w-full overflow-visible rounded-full bg-slate-100" aria-label={`${row.title} · 已完成 ${Math.floor(progress.percent)}%`}>
            <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sky-500 via-blue-500 to-violet-500 transition-[width] duration-300" style={{width:`${progress.percent}%`}}/>
            {showMarker&&<span className={`absolute top-1/2 z-[2] flex ${progress.state==='attention'||progress.state==='completed'?'h-4 w-4':'h-4 w-2'} ${markerPosition} -translate-y-1/2 items-center justify-center rounded-full border border-white shadow-sm ${progress.state==='attention'?'bg-red-500':progress.state==='completed'?'bg-emerald-500':'bg-violet-500'}`} style={{left:`${progress.percent}%`}} title={currentStage?`${currentStage.label} · ${stageLabels[progress.state]}`:undefined}>
              {progress.state==='attention'?<AlertTriangle size={8} className="text-white"/>:progress.state==='completed'?<CheckCircle2 size={9} className="text-white"/>:null}
            </span>}
          </div>
          <div className="absolute inset-x-5 inset-y-2 grid grid-cols-5 gap-px">
          {row.stages.map(stage => {
            const task = stage.tasks.find(item => ['failed', 'blocked', 'active'].includes(item.status)) ?? stage.tasks.at(-1);
            return <button key={stage.key} type="button" disabled={!task} onClick={() => task && onOpenTask(task)} className={`min-w-0 rounded-md bg-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${task?'cursor-pointer hover:bg-blue-500/10':'cursor-default'}`} aria-label={`${row.title} · ${stage.label} · ${stageLabels[stage.state]} · 点击查看任务详情`} title={`${stage.label} · ${stageLabels[stage.state]} · 点击查看任务详情`}/>;
          })}
          </div>
        </div>
      </div>;})}
    </div>
  </div>;
}
