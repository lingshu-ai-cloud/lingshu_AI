import { useEffect, useMemo, useState } from 'react';
import { Check, Circle, Film, Loader2, RotateCcw, Volume2 } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { requestProductionBack } from '../lib/productionNavigation';
import type { RunEvent } from '../lib/digitalEmployees';

const statuses: Record<string, string> = {
  pending: '等待开始', running: '制作中', planning: '准备中', waiting_external: '等待生成结果',
  waiting_approval: '等待确认', waiting_human: '需要处理', handed_off: '人工处理中', paused: '已暂停',
  failed: '生成失败', succeeded: '已完成', completed: '已完成', cancelled: '已取消',
};

const stages = ['script', 'material_match', 'voice_subtitles', 'heygen', 'render', 'quality', 'completed'] as const;
type Stage = typeof stages[number];
type Snapshot = { task: { id: string; task_key?: string; title: string; status: string; blocker_reason?: string; output?: Record<string, unknown> }; stage?: string; events: RunEvent[] };
type ProgressState = 'complete' | 'current' | 'pending' | 'failed';

const agentSteps = [
  { id: 'director', label: '编导 Agent', stage: 'script' as Stage },
  { id: 'subtitle', label: '字幕 Agent', stage: 'voice_subtitles' as Stage },
  { id: 'voice', label: '口播 Agent', stage: 'voice_subtitles' as Stage },
  { id: 'editing', label: '成片 Agent', stage: 'render' as Stage },
];

function stageIndex(stage?: string) { const index = stages.indexOf(stage as Stage); return index < 0 ? 0 : index; }
function progressState(currentStage: string | undefined, target: Stage, taskStatus?: string): ProgressState {
  if (taskStatus === 'failed') return 'failed';
  const current = stageIndex(currentStage);
  const expected = stageIndex(target);
  if (current > expected || currentStage === 'completed' || ['succeeded', 'completed'].includes(taskStatus || '')) return 'complete';
  if (current === expected && ['running', 'planning', 'waiting_external'].includes(taskStatus || '')) return 'current';
  return 'pending';
}
function eventDetail(events: RunEvent[], matcher: RegExp, fallback: string) { return [...events].reverse().find(event => matcher.test(event.summary))?.summary || fallback; }
function videoUrl(output?: Record<string, unknown>): string {
  if (!output) return '';
  const production = output.production && typeof output.production === 'object' ? output.production as Record<string, unknown> : {};
  return [output.videoUrl, output.previewUrl, output.renderOutputPreviewUrl, output.outputUrl, production.videoUrl, production.previewUrl, production.outputUrl]
    .map(value => String(value || '')).find(value => /^(?:https?:|data:|blob:|\/api\/)/.test(value)) || '';
}
function ProgressIcon({ state }: { state: ProgressState }) {
  if (state === 'complete') return <Check size={14} className="text-emerald-600" />;
  if (state === 'current') return <Loader2 size={14} className="animate-spin text-emerald-600" />;
  if (state === 'failed') return <RotateCcw size={14} className="text-red-600" />;
  return <Circle size={12} className="text-slate-300" />;
}

/** The same production scene is rendered in Content Creation and Smart Operations. */
export default function ProductionTaskScene({ runId, taskId, embedded = false }: {
  runId: string;
  taskId: string;
  initialExpanded?: boolean;
  directorContext?: { taskKey?: string; entityId?: string; contentId?: string; referenceId?: string };
  embedded?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [selectedAgent, setSelectedAgent] = useState(agentSteps[0].id);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/overseas/digital-employees/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/workspace`, { headers: authHeader(), signal: abort.signal });
        if (!response.ok) throw Error('暂时无法读取制作进度');
        const data = await response.json();
        if (!data.task) throw Error('制作任务还没有开始');
        if (!abort.signal.aborted) { setSnapshot(data); setError(''); }
      } catch (failure) {
        if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : '制作进度读取失败');
      } finally { if (!abort.signal.aborted) timer = setTimeout(refresh, 5000); }
    };
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [runId, taskId]);

  const task = snapshot?.task;
  const currentStage = snapshot?.stage;
  const events = snapshot?.events || [];
  const previewUrl = videoUrl(task?.output);
  const selected = agentSteps.find(item => item.id === selectedAgent) || agentSteps[0];
  const selectedState = progressState(currentStage, selected.stage, task?.status);
  const progress = useMemo(() => [
    { id: 'script', label: '脚本', state: progressState(currentStage, 'script', task?.status), detail: eventDetail(events, /脚本|分镜|文案/, '等待编导 Agent 生成脚本') },
    { id: 'subtitle', label: '字幕', state: progressState(currentStage, 'voice_subtitles', task?.status), detail: eventDetail(events, /字幕/, '脚本完成后自动生成字幕') },
    { id: 'voice', label: '口播', state: progressState(currentStage, 'voice_subtitles', task?.status), detail: eventDetail(events, /口播|配音|声音/, '脚本完成后自动生成口播') },
  ], [currentStage, events, task?.status]);

  return <section data-testid="production-task-scene" className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-white text-text-primary shadow-sm">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div><h2 className="font-bold">内容生产现场</h2><p className="mt-1 text-xs text-text-muted">{task?.title || '正在读取任务'} · {error || statuses[task?.status || 'pending']}</p></div>
      {!embedded && <button type="button" onClick={requestProductionBack} className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2">返回内容制作</button>}
    </header>
    <nav aria-label="Agent 制作顺序" className="grid shrink-0 grid-cols-2 gap-2 border-b border-border bg-surface-2/60 p-3 sm:grid-cols-4">
      {agentSteps.map((agent, index) => { const state = progressState(currentStage, agent.stage, task?.status); return <button key={agent.id} type="button" aria-pressed={selectedAgent === agent.id} onClick={() => setSelectedAgent(agent.id)} className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${selectedAgent === agent.id ? 'border-emerald-300 bg-white shadow-sm' : 'border-transparent hover:border-border hover:bg-white'}`}><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-black text-text-secondary">{index + 1}</span><span className="min-w-0 flex-1 truncate text-xs font-bold">{agent.label}</span><ProgressIcon state={state} /></button>; })}
    </nav>
    <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
      <div className="flex min-h-[360px] items-center justify-center bg-slate-950 p-4 lg:min-h-[520px]">
        {previewUrl ? <video src={previewUrl} controls preload="metadata" className="max-h-[70vh] max-w-full rounded-xl bg-black" /> : <div className="flex max-w-sm flex-col items-center text-center text-slate-300"><Film size={42} className="text-slate-500"/><p className="mt-4 text-sm font-bold">视频生成后会显示在这里</p><p className="mt-2 text-xs leading-5 text-slate-500">当前由 {selected.label} 处理，页面会自动刷新。</p></div>}
      </div>
      <aside className="min-h-0 overflow-y-auto border-t border-border p-5 lg:border-l lg:border-t-0">
        <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-black">{selected.label}</p><p className="mt-1 text-xs text-text-muted">只展示与成片直接相关的进度</p></div><span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-bold text-text-secondary">{selectedState === 'complete' ? '已完成' : selectedState === 'current' ? '生成中' : selectedState === 'failed' ? '需重试' : '等待中'}</span></div>
        <ol className="mt-5 space-y-3">{progress.map(item => <li key={item.id} className="rounded-xl border border-border p-3"><div className="flex items-center gap-2"><ProgressIcon state={item.state}/><p className="text-xs font-black">{item.label}</p><span className="ml-auto text-[10px] text-text-muted">{item.state === 'complete' ? '完成' : item.state === 'current' ? '生成中' : item.state === 'failed' ? '失败' : '等待'}</span></div><p className="mt-2 text-xs leading-5 text-text-secondary">{item.detail}</p></li>)}</ol>
        {task?.blocker_reason && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{task.blocker_reason}</p>}
        {error && <p role="alert" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">{error}</p>}
        <div className="mt-5 flex items-center gap-2 rounded-xl bg-surface-2 p-3 text-xs text-text-secondary"><Volume2 size={15}/><span>脚本、字幕和口播会随任务自动更新。</span></div>
      </aside>
    </div>
  </section>;
}
