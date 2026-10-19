import { useEffect, useMemo, useState } from 'react';
import { Button } from 'antd';
import { ArrowRight, Check, Circle, Film, Loader2, RotateCcw, Volume2 } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { requestProductionBack } from '../lib/productionNavigation';
import { LsMetricStrip } from './ui/LsExperiencePrimitives';
import {
  canonicalProductionReadView,
  isProductionReadModelV1,
  productionStatusLabel,
  type ProductionReadView,
} from '../lib/productionReadModel';
import type { RunEvent } from '../lib/digitalEmployees';

const statuses: Record<string, string> = {
  pending: '等待开始', running: '制作中', planning: '准备中', waiting_external: '等待生成结果',
  waiting_approval: '等待确认', waiting_human: '需要处理', handed_off: '人工处理中', paused: '已暂停',
  failed: '生成失败', succeeded: '已完成', completed: '已完成', cancelled: '已取消',
};

const stages = ['script', 'material_match', 'voice_subtitles', 'heygen', 'render', 'quality', 'completed'] as const;
type Stage = typeof stages[number];
type Snapshot = {
  task: { id: string; task_key?: string; title: string; status: string; blocker_reason?: string; output?: Record<string, unknown> };
  stage?: string;
  events: RunEvent[];
  production?: unknown;
};
type ProgressState = 'complete' | 'current' | 'pending' | 'failed';

const agentSteps = [
  { id: 'script', label: '脚本与分镜', agent: '编导 Agent', duration: '约 65 分钟', stage: 'script' as Stage, matcher: /脚本|分镜|文案/, fallback: '经营 Agent 派单后，编导 Agent 根据爆款分析和企业事实生成适配脚本与逐镜分镜' },
  { id: 'materials', label: '逐镜素材', agent: '内容 Agent', duration: '约 45 分钟', stage: 'material_match' as Stage, matcher: /素材|首帧|授权/, fallback: '脚本锁定后匹配企业素材或最高档 AIGC' },
  { id: 'voice', label: '配音、字幕与人物', agent: '内容 Agent', duration: '约 90 分钟', stage: 'voice_subtitles' as Stage, matcher: /字幕|口播|配音|声音|数字人/, fallback: '素材就绪后按镜头需求生成配音、字幕和人物镜头' },
  { id: 'editing', label: '剪辑与渲染', agent: '内容 Agent', duration: '约 90 分钟', stage: 'render' as Stage, matcher: /剪辑|合成|渲染|成片/, fallback: '合成画面、音频和字幕，并生成可验收成片' },
  { id: 'quality', label: '质检与局部返工', agent: '内容 Agent · 质检能力', duration: '约 25–55 分钟', stage: 'quality' as Stage, matcher: /质检|质量|返工|验收/, fallback: '检查事实、画面、音频、版权和平台要求；仅重做不合格镜头' },
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
function productionViewFromSnapshot(snapshot: Snapshot | null): ProductionReadView | null {
  if (!snapshot) return null;
  const output = snapshot.task.output || {};
  const candidates = [snapshot.production, output.productionReadModel, output.production];
  const canonical = candidates.find(isProductionReadModelV1);
  return canonical ? canonicalProductionReadView(canonical) : null;
}
function productionCostLabel(view: ProductionReadView): string {
  const { expectedCny, upperBoundCny, status } = view.aggregate.cost;
  if (status === 'free') return '无额外生成费';
  if (expectedCny != null && upperBoundCny != null && upperBoundCny > expectedCny) {
    return `预计 ¥${expectedCny.toFixed(2)} · 上限 ¥${upperBoundCny.toFixed(2)}`;
  }
  if (expectedCny != null) return `预计 ¥${expectedCny.toFixed(2)}`;
  if (upperBoundCny != null) return `上限 ¥${upperBoundCny.toFixed(2)}`;
  return '待生成执行报价';
}
export function ProductionAggregateSummary({ view, onOpenProduction }: {
  view: ProductionReadView;
  onOpenProduction?: () => void;
}) {
  const counts = view.aggregate.counts;
  const blocker = view.aggregate.blockers[0];
  const missing = view.aggregate.inputs.missing;
  const waitingCount = counts.needsInput + counts.blocked + counts.review;
  return <section aria-label="生产能力与成本摘要" className="mb-4 rounded-xl border border-border bg-surface-2/60 p-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-bold text-text-primary">统一生产状态</p><p className="mt-1 text-xs text-text-secondary">{productionStatusLabel(view.aggregate.status)} · {counts.total} 个分镜</p></div>
      {onOpenProduction ? <Button type="default" size="small" onClick={onOpenProduction} icon={<ArrowRight size={13} />}>打开内容制作</Button> : null}
    </div>
    <LsMetricStrip
      className="mt-3"
      ariaLabel="生产任务指标"
      items={[
        { key: 'ready', label: '已就绪', value: `${counts.ready} / ${counts.total}` },
        { key: 'running', label: '制作中', value: counts.running },
        { key: 'completed', label: '已完成', value: counts.completed },
        { key: 'waiting', label: '等待处理', value: waitingCount, description: `待输入 ${counts.needsInput} · 阻塞 ${counts.blocked} · 待验收 ${counts.review}` },
        { key: 'cost', label: '预计成本', value: productionCostLabel(view) },
      ]}
    />
    {missing.length ? <p role="status" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">缺少输入：{missing.slice(0, 3).join('、')}{missing.length > 3 ? ` 等 ${missing.length} 项` : ''}</p> : null}
    {blocker ? <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{blocker.message}</p> : null}
  </section>;
}

const canonicalPhaseLabels: Record<ProductionReadView['aggregate']['phases'][number]['phase'], string> = {
  planning: '规划与分镜',
  input: '素材与授权',
  production: '逐镜制作',
  render: '剪辑与渲染',
  qa: '质量检查',
  review: '验收与交付',
};

const canonicalPhaseStatusLabels: Record<ProductionReadView['aggregate']['phases'][number]['status'], string> = {
  pending: '等待',
  active: '进行中',
  completed: '已完成',
  blocked: '需处理',
  not_applicable: '不适用',
};

function canonicalProgressState(status: ProductionReadView['aggregate']['phases'][number]['status']): ProgressState {
  if (status === 'completed') return 'complete';
  if (status === 'active') return 'current';
  if (status === 'blocked') return 'failed';
  return 'pending';
}

export function CanonicalProductionProgress({ view }: { view: ProductionReadView }) {
  return <section aria-label="服务端生产阶段" className="mt-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-bold text-text-primary">生产阶段</h3>
        <p className="mt-1 text-xs leading-5 text-text-muted">阶段和状态来自统一生产任务；没有服务端证据时不显示预计耗时。</p>
      </div>
      <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-text-secondary">{productionStatusLabel(view.aggregate.status)}</span>
    </div>
    <ol className="mt-3 divide-y divide-border rounded-xl border border-border bg-white">
      {view.aggregate.phases.map((item, index) => (
        <li key={item.phase} className="flex items-center gap-3 px-3 py-3" aria-current={item.status === 'active' ? 'step' : undefined}>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-text-secondary">{index + 1}</span>
          <ProgressIcon state={canonicalProgressState(item.status)} />
          <span className="min-w-0 flex-1 text-sm font-semibold text-text-primary">{canonicalPhaseLabels[item.phase]}</span>
          <span className="text-xs text-text-muted">{canonicalPhaseStatusLabels[item.status]}</span>
        </li>
      ))}
    </ol>
  </section>;
}
function ProgressIcon({ state }: { state: ProgressState }) {
  if (state === 'complete') return <Check size={14} className="text-emerald-600" />;
  if (state === 'current') return <Loader2 size={14} className="animate-spin text-blue-600" />;
  if (state === 'failed') return <RotateCcw size={14} className="text-red-600" />;
  return <Circle size={12} className="text-slate-300" />;
}

/** The same production scene is rendered in Content Creation and Smart Operations. */
export default function ProductionTaskScene({ runId, taskId, embedded = false, onOpenProduction }: {
  runId: string;
  taskId: string;
  initialExpanded?: boolean;
  directorContext?: { taskKey?: string; entityId?: string; contentId?: string; referenceId?: string };
  embedded?: boolean;
  onOpenProduction?: () => void;
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
  const productionView = productionViewFromSnapshot(snapshot);
  const previewUrl = videoUrl(task?.output);
  const selected = agentSteps.find(item => item.id === selectedAgent) || agentSteps[0];
  const selectedState = progressState(currentStage, selected.stage, task?.status);
  const progress = useMemo(() => agentSteps.map(item => ({
    ...item,
    state: progressState(currentStage, item.stage, task?.status),
    detail: eventDetail(events, item.matcher, item.fallback),
  })), [currentStage, events, task?.status]);
  const canonicalPreviewDetail = productionView
    ? productionView.aggregate.inputs.missing[0]
      || productionView.aggregate.blockers[0]?.message
      || '任务会按统一生产阶段继续推进，成片就绪后自动显示。'
    : '';

  return <section data-testid="production-task-scene" className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-white text-text-primary shadow-sm">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div><h2 className="font-bold">内容生产现场</h2><p className="mt-1 text-xs text-text-muted">{productionView?.project.title || task?.title || '正在读取任务'} · {error || (productionView ? productionStatusLabel(productionView.aggregate.status) : statuses[task?.status || 'pending'])}</p></div>
      {!embedded && <button type="button" onClick={requestProductionBack} className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2">返回内容制作</button>}
    </header>
    {!productionView ? <nav aria-label="Agent 制作顺序" className="grid shrink-0 grid-cols-2 gap-2 border-b border-border bg-surface-2/60 p-3 sm:grid-cols-3 xl:grid-cols-5">
      {agentSteps.map((agent, index) => { const state = progressState(currentStage, agent.stage, task?.status); return <button key={agent.id} type="button" aria-pressed={selectedAgent === agent.id} onClick={() => setSelectedAgent(agent.id)} className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${selectedAgent === agent.id ? 'border-emerald-300 bg-white shadow-sm' : 'border-transparent hover:border-border hover:bg-white'}`}><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-black text-text-secondary">{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{agent.label}</span><span className="block truncate text-xs text-text-muted">{agent.agent} · {agent.duration}</span></span><ProgressIcon state={state} /></button>; })}
    </nav> : null}
    <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
      <div className="flex min-h-[360px] items-center justify-center bg-slate-950 p-4 lg:min-h-[520px]">
        {previewUrl ? <video src={previewUrl} controls preload="metadata" className="max-h-[70vh] max-w-full rounded-xl bg-black" /> : <div className="flex max-w-sm flex-col items-center text-center text-slate-300"><Film size={42} className="text-slate-500"/><p className="mt-4 text-sm font-bold">视频生成后会显示在这里</p><p className="mt-2 text-xs leading-5 text-slate-500">{productionView ? canonicalPreviewDetail : `${selected.agent} 负责“${selected.label}”，该步${selected.duration}，页面会自动刷新。`}</p></div>}
      </div>
      <aside className="min-h-0 overflow-y-auto border-t border-border p-5 lg:border-l lg:border-t-0">
        {productionView ? <>
          <ProductionAggregateSummary view={productionView} onOpenProduction={onOpenProduction} />
          <CanonicalProductionProgress view={productionView} />
        </> : <>
          <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-black">{selected.label}</p><p className="mt-1 text-xs text-text-muted">负责：{selected.agent} · 预计：{selected.duration}</p></div><span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-bold text-text-secondary">{selectedState === 'complete' ? '已完成' : selectedState === 'current' ? '生成中' : selectedState === 'failed' ? '需重试' : '等待中'}</span></div>
          <ol className="mt-5 space-y-3">{progress.map((item, index) => <li key={item.id} className="rounded-xl border border-border p-3"><div className="flex items-center gap-2"><ProgressIcon state={item.state}/><p className="text-xs font-black">{index + 1}. {item.label}</p><span className="ml-auto text-xs text-text-muted">{item.state === 'complete' ? '完成' : item.state === 'current' ? '生成中' : item.state === 'failed' ? '失败' : '等待'}</span></div><div className="mt-2 flex flex-wrap gap-x-3 text-xs text-text-muted"><span>负责：{item.agent}</span><span>预计：{item.duration}</span></div><p className="mt-2 text-xs leading-5 text-text-secondary">{item.detail}</p></li>)}</ol>
        </>}
        {!productionView && task?.blocker_reason && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{task.blocker_reason}</p>}
        {error && <p role="alert" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">{error}</p>}
        {!productionView && <div className="mt-5 flex items-center gap-2 rounded-xl bg-surface-2 p-3 text-xs text-text-secondary"><Volume2 size={15}/><span>脚本、字幕和口播会随任务自动更新。</span></div>}
      </aside>
    </div>
  </section>;
}
