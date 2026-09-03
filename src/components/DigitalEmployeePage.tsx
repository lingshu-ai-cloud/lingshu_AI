import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Bot, Check, Clock3, FileCheck2, Hand, Loader2, Pause, Play,
  RotateCcw, Settings2, Sparkles, Target, Users, XCircle,
} from 'lucide-react';
import {
  digitalEmployeeApi,
  streamRunEvents,
  type ApprovalDecision,
  type ApprovalRequest,
  type DigitalEmployeeConfig,
  type DigitalEmployeeOverview,
  type PublishingReconciliationDecision,
  type RunEvent,
  type StreamConnectionStatus,
  type WeeklyGoal,
  type WorkItem,
  type WorkflowTask,
} from '../lib/digitalEmployees';
import { DashboardHeader } from './digitalEmployees/DashboardHeader';
import { ExecutionContractPanel } from './digitalEmployees/ExecutionContractPanel';
import { OverviewCards } from './digitalEmployees/OverviewCards';
import { PlanSummary } from './digitalEmployees/PlanSummary';
import { ProductionFeed } from './digitalEmployees/ProductionFeed';
import { TaskDetailDrawer } from './digitalEmployees/TaskDetailDrawer';
import { WeeklyReviewSummary } from './digitalEmployees/WeeklyReviewSummary';
import { WorkInbox } from './digitalEmployees/WorkInbox';
import { agentLabel } from './digitalEmployees/presentation';
import { mergeOverview, mergeRunEvents, selectActionableWorkItemCount, selectWorkItems } from './digitalEmployees/selectors';
import { StatusBadge } from './digitalEmployees/StatusBadge';

const EMPTY_CONFIG: DigitalEmployeeConfig = {
  companyName: '', industry: '', primaryBusiness: '', targetMarkets: '', customerProfile: '',
  autonomyMode: 'managed', weeklyBudget: 500, approvalOwner: '',
  constraints: ['禁止未经确认的价格、交期和效果承诺', '所有真实对外发布必须人工审批'],
  team: ['planner', 'knowledge', 'content', 'risk', 'review'],
};

function isoDay(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

const EMPTY_GOAL = {
  title: '本周内容增长目标', objective: '形成一组面向目标市场、证据充分且可进入审批的内容执行包',
  metric: 'approved_content_packages', baseline: 0, target: 5, unit: '项', startsAt: isoDay(0), endsAt: isoDay(6),
  scope: '', budgetLimit: 500, constraints: ['对外发布必须审批'],
};

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={wide ? 'md:col-span-2' : ''}><span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>{children}</label>;
}

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';

function OnboardingPanel({ initial, busy, onSave }: { initial: DigitalEmployeeConfig; busy: boolean; onSave: (config: DigitalEmployeeConfig) => void }) {
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);
  const set = <K extends keyof DigitalEmployeeConfig>(key: K, value: DigitalEmployeeConfig[K]) => setForm(current => ({ ...current, [key]: value }));
  return <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-start gap-3"><div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700"><Settings2 size={22} /></div><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">首次配置</p><h2 className="mt-1 text-xl font-bold text-slate-950">初始化企业数字员工系统</h2><p className="mt-1 text-sm text-slate-500">真实外部发布、商业承诺和预算扩容始终进入审批。</p></div></div>
    <div className="mt-6 grid gap-4 md:grid-cols-2"><Field label="企业名称"><input className={inputClass} value={form.companyName} onChange={event => set('companyName', event.target.value)} /></Field><Field label="行业"><input className={inputClass} value={form.industry} onChange={event => set('industry', event.target.value)} /></Field><Field label="主要业务" wide><textarea className={`${inputClass} min-h-20 resize-y`} value={form.primaryBusiness} onChange={event => set('primaryBusiness', event.target.value)} /></Field><Field label="目标市场"><input className={inputClass} value={form.targetMarkets} onChange={event => set('targetMarkets', event.target.value)} /></Field><Field label="核心客户"><input className={inputClass} value={form.customerProfile} onChange={event => set('customerProfile', event.target.value)} /></Field><Field label="自主等级"><select className={inputClass} value={form.autonomyMode} onChange={event => set('autonomyMode', event.target.value as DigitalEmployeeConfig['autonomyMode'])}><option value="suggest">建议：只分析，不执行写操作</option><option value="collaborate">协同：生成草稿，对外动作确认</option><option value="managed">托管：低风险自动，关键节点审批</option><option value="automatic">自动：在授权边界内持续运行</option></select></Field><Field label="每周预算上限"><input className={inputClass} type="number" min={0} value={form.weeklyBudget} onChange={event => set('weeklyBudget', Number(event.target.value))} /></Field><Field label="审批负责人用户 ID（留空为本人）"><input className={inputClass} value={form.approvalOwner} onChange={event => set('approvalOwner', event.target.value)} placeholder="必须是本企业有效用户 ID" /></Field><Field label="行动边界（每行一条）" wide><textarea className={`${inputClass} min-h-24 resize-y`} value={form.constraints.join('\n')} onChange={event => set('constraints', event.target.value.split('\n').map(item => item.trim()).filter(Boolean))} /></Field></div>
    <div className="mt-6 flex justify-end"><button type="button" disabled={busy} onClick={() => onSave(form)} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}保存并进入周目标</button></div>
  </section>;
}

type GoalDraft = Omit<WeeklyGoal, 'id' | 'status' | 'version' | 'createdAt' | 'updatedAt'>;

function GoalPanel({ config, busy, suggestion, onSave }: { config: DigitalEmployeeConfig; busy: boolean; suggestion?: string; onSave: (goal: GoalDraft) => void }) {
  const [form, setForm] = useState<GoalDraft>(() => ({ ...EMPTY_GOAL, objective: suggestion || EMPTY_GOAL.objective, scope: config.targetMarkets, budgetLimit: config.weeklyBudget }));
  useEffect(() => { if (suggestion) setForm(current => ({ ...current, title: '下周经营目标（待确认）', objective: suggestion })); }, [suggestion]);
  const set = <K extends keyof GoalDraft>(key: K, value: GoalDraft[K]) => setForm(current => ({ ...current, [key]: value }));
  return <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-start gap-3"><div className="rounded-2xl bg-blue-50 p-3 text-blue-700"><Target size={22} /></div><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">本周目标</p><h2 className="mt-1 text-xl font-bold text-slate-950">确认结果，Agent 负责拆解日常执行</h2><p className="mt-1 text-sm text-slate-500">建议只会预填目标草案，仍须人工审阅、确认执行契约并批准。</p></div></div>
    <div className="mt-6 grid gap-4 md:grid-cols-2"><Field label="目标名称" wide><input className={inputClass} value={form.title} onChange={event => set('title', event.target.value)} /></Field><Field label="本周重点结果" wide><textarea className={`${inputClass} min-h-20 resize-y`} value={form.objective} onChange={event => set('objective', event.target.value)} /></Field><Field label="指标"><input className={inputClass} value={form.metric} onChange={event => set('metric', event.target.value)} /></Field><div className="grid grid-cols-3 gap-2"><Field label="基线"><input className={inputClass} type="number" value={form.baseline} onChange={event => set('baseline', Number(event.target.value))} /></Field><Field label="目标"><input className={inputClass} type="number" value={form.target} onChange={event => set('target', Number(event.target.value))} /></Field><Field label="单位"><input className={inputClass} value={form.unit} onChange={event => set('unit', event.target.value)} /></Field></div><Field label="开始日期"><input className={inputClass} type="date" value={form.startsAt} onChange={event => set('startsAt', event.target.value)} /></Field><Field label="结束日期"><input className={inputClass} type="date" value={form.endsAt} onChange={event => set('endsAt', event.target.value)} /></Field><Field label="业务范围" wide><input className={inputClass} value={form.scope} onChange={event => set('scope', event.target.value)} /></Field><Field label="预算上限"><input className={inputClass} type="number" min={0} value={form.budgetLimit} onChange={event => set('budgetLimit', Number(event.target.value))} /></Field><Field label="本周特殊限制"><input className={inputClass} value={form.constraints.join('；')} onChange={event => set('constraints', event.target.value.split(/[；;\n]/).map(item => item.trim()).filter(Boolean))} /></Field></div>
    <div className="mt-6 flex justify-end"><button type="button" disabled={busy} onClick={() => onSave(form)} className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-800 disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}保存目标草案</button></div>
  </section>;
}

const TERMINAL_RUN_STATUSES = ['succeeded', 'failed', 'cancelled', 'completed_with_skips'];

export default function DigitalEmployeePage() {
  const [data, setData] = useState<DigitalEmployeeOverview | null>(null);
  const [remoteWorkItems, setRemoteWorkItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [editConfig, setEditConfig] = useState(false);
  const [newGoal, setNewGoal] = useState(false);
  const [nextGoalSuggestion, setNextGoalSuggestion] = useState('');
  const [selectedTask, setSelectedTask] = useState<WorkflowTask | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<RunEvent | null>(null);
  const [connection, setConnection] = useState<StreamConnectionStatus>({ phase: 'idle', attempt: 0 });
  const overviewEpoch = useRef(0);
  const workItemsEpoch = useRef(0);
  const activeStreamRun = useRef('');
  const refreshTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  const loadWorkItems = useCallback(async () => {
    const epoch = ++workItemsEpoch.current;
    try {
      const response = await digitalEmployeeApi.workItems();
      if (epoch === workItemsEpoch.current) setRemoteWorkItems(response.items);
    } catch {
      // Overview-derived items remain available if the read-model endpoint is temporarily unavailable.
    }
  }, []);

  const load = useCallback(async (silent = false) => {
    const epoch = ++overviewEpoch.current;
    try {
      const overview = await digitalEmployeeApi.overview();
      if (epoch !== overviewEpoch.current) return;
      setData(current => mergeOverview(current, overview));
      setError('');
      void loadWorkItems();
    } catch (loadError) {
      if (epoch === overviewEpoch.current && !silent) setError(loadError instanceof Error ? loadError.message : '加载失败');
    } finally {
      if (epoch === overviewEpoch.current) setLoading(false);
    }
  }, [loadWorkItems]);

  useEffect(() => { void load(); }, [load]);

  const runId = data?.run?.id || '';
  const runStatus = data?.run?.status || '';
  useEffect(() => {
    if (!runId || TERMINAL_RUN_STATUSES.includes(runStatus)) { setConnection({ phase: 'idle', attempt: 0 }); return; }
    const controller = new AbortController();
    activeStreamRun.current = runId;
    const after = Math.max(0, ...(data?.events || []).map(event => Number(event.sequence) || 0));
    const scheduleRefresh = () => {
      if (refreshTimer.current) globalThis.clearTimeout(refreshTimer.current);
      refreshTimer.current = globalThis.setTimeout(() => { if (activeStreamRun.current === runId) void load(true); }, 250);
    };
    void streamRunEvents(runId, after, event => {
      if (activeStreamRun.current !== runId || event.run_id !== runId) return;
      setData(current => current?.run?.id === runId ? { ...current, events: mergeRunEvents(current.events, [event]) } : current);
      scheduleRefresh();
    }, controller.signal, status => {
      if (activeStreamRun.current === runId) setConnection(status);
    });
    return () => {
      controller.abort();
      if (activeStreamRun.current === runId) activeStreamRun.current = '';
      if (refreshTimer.current) { globalThis.clearTimeout(refreshTimer.current); refreshTimer.current = null; }
    };
  // Events are deliberately excluded: the stream maintains its own cursor and reconnect compensation.
  }, [runId, runStatus, load]);

  const act = useCallback(async (key: string, action: () => Promise<DigitalEmployeeOverview>): Promise<boolean> => {
    setBusy(key); setError('');
    try {
      const overview = await action();
      overviewEpoch.current += 1;
      setData(current => mergeOverview(current, overview));
      await loadWorkItems();
      return true;
    } catch (actionError) {
      await load(true);
      await loadWorkItems();
      setError(actionError instanceof Error ? actionError.message : '操作失败');
      return false;
    } finally {
      setBusy('');
    }
  }, [load, loadWorkItems]);

  const decidePublishingReconciliation = useCallback(async (item: WorkItem, decision: PublishingReconciliationDecision): Promise<void> => {
    if (!item.postId) { setError('对账待办缺少发布记录 ID，已阻止提交。'); return; }
    setBusy(`reconciliation:${item.postId}`);
    setError('');
    try {
      await digitalEmployeeApi.decidePublishingReconciliation(item.postId, decision);
      await load(true);
      await loadWorkItems();
    } catch (actionError) {
      await load(true);
      await loadWorkItems();
      setError(actionError instanceof Error ? actionError.message : '对账提交失败');
    } finally {
      setBusy('');
    }
  }, [load, loadWorkItems]);

  const closeDrawer = useCallback(() => { setSelectedTask(null); setSelectedEvent(null); }, []);
  const selectTask = useCallback((task: WorkflowTask) => { setSelectedTask(task); setSelectedEvent(null); }, []);
  const selectEvent = useCallback((event: RunEvent) => {
    setSelectedEvent(event);
    setSelectedTask(data?.tasks.find(task => task.id === event.task_id) || null);
  }, [data?.tasks]);

  const workItems = useMemo(() => selectWorkItems(data, remoteWorkItems), [data, remoteWorkItems]);
  const actionableCount = useMemo(() => selectActionableWorkItemCount(workItems), [workItems]);
  const terminal = Boolean(data?.run && TERMINAL_RUN_STATUSES.includes(data.run.status));
  const activeHandoff = data?.handoffs.find(item => item.status === 'active');
  const activeHandoffTask = data?.tasks.find(item => item.id === activeHandoff?.task_id);
  const stage = !data?.config ? 1 : !data.goal ? 2 : !data.plan ? 2 : data.review || terminal ? 6 : workItems.some(item => item.status === 'pending' || item.status === 'taken_over') ? 5 : 4;
  const goal = data?.goal;

  if (loading) return <div className="flex h-full items-center justify-center bg-slate-50"><Loader2 size={24} className="animate-spin text-emerald-600" /></div>;

  return <div className="h-full overflow-y-auto bg-[#f5f7fb]">
    <div className="mx-auto max-w-[1500px] px-5 py-6 lg:px-8">
      <DashboardHeader config={data?.config || null} stage={stage} workItemCount={actionableCount} streamPhase={data?.run && !terminal ? connection.phase : undefined} onEditConfig={() => setEditConfig(value => !value)} />
      {error && <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><span className="flex items-center gap-2"><AlertTriangle size={16} />{error}</span><button type="button" aria-label="关闭错误提示" onClick={() => setError('')}><XCircle size={17} /></button></div>}

      <div className="mt-5 space-y-5">
        <div id="digital-stage-1" className="scroll-mt-5" />
        {(!data?.config || editConfig) && <OnboardingPanel initial={data?.config || EMPTY_CONFIG} busy={Boolean(busy)} onSave={config => { void (async () => { if (await act('config', () => digitalEmployeeApi.completeOnboarding(config))) setEditConfig(false); })(); }} />}
        <div id="digital-stage-2" className="scroll-mt-5" />
        {data?.config && (!goal || newGoal) && <GoalPanel config={data.config} busy={Boolean(busy)} suggestion={nextGoalSuggestion} onSave={goalInput => { void (async () => { if (await act('goal', () => digitalEmployeeApi.createGoal(goalInput))) { setNewGoal(false); setNextGoalSuggestion(''); } })(); }} />}
        {data && workItems.length > 0 && <WorkInbox items={workItems} approvals={data.approvals} tasks={data.tasks} goals={data.goals} busy={Boolean(busy)} onSelectTask={selectTask} onDecide={(approval: ApprovalRequest, decision: ApprovalDecision, note: string, changes?: Record<string, unknown>) => { void act(`approval:${approval.id}`, () => digitalEmployeeApi.decideApproval(approval.id, decision, note, { changes, expectedActionVersion: approval.action_version, expectedPayloadHash: approval.payload_hash })); }} onHandoff={task => { void act(`handoff:${task.id}`, () => digitalEmployeeApi.handoffTask(task.id)); }} onTransfer={(item, ownerId, note) => { void act(`transfer:${item.id}`, () => digitalEmployeeApi.transferWorkItem(item.id, ownerId, note)); }} onTaskAction={(task, action, note) => { void act(`${action}:${task.id}`, () => digitalEmployeeApi.actOnTask(task.id, action, note)); }} onReturnHandoff={(task, result) => { void act(`return:${task.id}`, () => digitalEmployeeApi.returnTask(task.id, result)); }} onPublishingReconciliation={(item, decision) => { void decidePublishingReconciliation(item, decision); }} />}

        {goal && !newGoal && <>
          <OverviewCards goal={goal} run={data.run} tasks={data.tasks} review={data.review} />
          {data.contract && <ExecutionContractPanel contract={data.contract} busy={Boolean(busy)} onRecompile={() => { void act('recompile-contract', () => digitalEmployeeApi.recompileContract(goal.id)); }} onConfirm={() => { void act('confirm-contract', () => digitalEmployeeApi.confirmContract(goal.id, data.contract!.payloadHash)); }} />}
          {!data.contract && goal.status === 'draft' && <section className="rounded-3xl border border-blue-200 bg-white p-6 shadow-sm"><h2 className="font-black text-slate-950">生成执行契约</h2><p className="mt-2 text-sm text-slate-600">读取企业中心、产品、账号、历史发布与指标，补全 Agent 自主运行所需上下文。</p><button type="button" disabled={Boolean(busy)} onClick={() => { void act('recompile-contract', () => digitalEmployeeApi.recompileContract(goal.id)); }} className="mt-4 rounded-xl bg-blue-700 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">读取正式数据并生成契约</button></section>}
          {goal.status === 'draft' && data.contract?.status === 'confirmed' && <section className="rounded-3xl border border-blue-200 bg-gradient-to-r from-blue-50 to-white p-6 shadow-sm"><div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between"><div><div className="flex items-center gap-2"><FileCheck2 size={19} className="text-blue-700" /><h2 className="font-bold text-slate-950">目标草案等待批准</h2></div><p className="mt-2 max-w-3xl text-sm text-slate-600">{goal.objective}</p><p className="mt-2 text-xs text-slate-500">{goal.metric}：{goal.baseline} → {goal.target} {goal.unit} · {goal.startsAt} 至 {goal.endsAt}</p></div><button type="button" disabled={Boolean(busy)} onClick={() => { void act('approve-goal', () => digitalEmployeeApi.approveGoal(goal.id)); }} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">{busy === 'approve-goal' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}批准并由 Agent 自动计划</button></div></section>}

          {data.plan && <>
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]"><div className="space-y-5"><PlanSummary plan={data.plan} tasks={data.tasks} onSelectTask={selectTask} /><ProductionFeed events={data.events} connection={connection} onRefresh={() => { void load(); }} onSelectEvent={selectEvent} /></div><aside className="space-y-5"><section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Users size={19} className="text-blue-600" /><h2 className="font-bold text-slate-950">数字员工团队</h2></div><div className="mt-4 space-y-3">{data.agents.map(agent => <div key={agent.role} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm"><Bot size={17} /></div><div className="min-w-0 flex-1"><p className="text-xs font-bold text-slate-800">{agentLabel[agent.role] || agent.role}</p><p className="truncate text-[10px] text-slate-400">{agent.currentTask || `${agent.completed}/${agent.total} 个任务完成`}</p></div><StatusBadge status={agent.status} /></div>)}</div></section>
              {activeHandoff && activeHandoffTask && <section className="rounded-3xl border border-violet-200 bg-violet-50 p-5 shadow-sm"><div className="flex items-center gap-2 text-violet-800"><Hand size={19} /><h2 className="font-bold">人工接管中</h2></div><p className="mt-3 text-sm font-bold text-slate-900">{activeHandoffTask.title}</p><p className="mt-2 text-xs leading-relaxed text-slate-600">Agent 外部写入和费用消耗已冻结。人工结果、正式记录引用和外部动作标记须在统一待办中提交。</p><button type="button" onClick={() => document.getElementById('digital-stage-5')?.scrollIntoView({ behavior: 'smooth' })} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-700 px-3 py-2.5 text-xs font-bold text-white hover:bg-violet-800"><RotateCcw size={14} />前往提交人工结果</button></section>}
              {data.run && !terminal && <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Clock3 size={18} className="text-slate-600" /><h2 className="font-bold text-slate-950">运行控制</h2></div><div className="mt-4 grid grid-cols-2 gap-2">{data.run.status === 'paused' ? <button type="button" disabled={Boolean(busy)} onClick={() => { void act('resume', () => digitalEmployeeApi.resumeRun(data.run!.id)); }} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-700 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-40"><Play size={14} />恢复</button> : <button type="button" disabled={Boolean(busy)} onClick={() => { void act('pause', () => digitalEmployeeApi.pauseRun(data.run!.id)); }} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-700 disabled:opacity-40"><Pause size={14} />暂停</button>}<button type="button" disabled={Boolean(busy)} onClick={() => { if (window.confirm('确认取消本次运行？未完成任务将停止，操作会写入审计日志。')) void act('cancel', () => digitalEmployeeApi.cancelRun(data.run!.id)); }} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-200 px-3 py-2.5 text-xs font-bold text-red-700 disabled:opacity-40"><XCircle size={14} />取消</button></div></section>}
            </aside></div>

            {data.run && (terminal || data.review) ? <WeeklyReviewSummary review={data.review} goal={goal} run={data.run} onCreateNextGoal={suggestion => { setNextGoalSuggestion(suggestion || ''); setNewGoal(true); globalThis.setTimeout(() => document.getElementById('digital-stage-2')?.scrollIntoView({ behavior: 'smooth' }), 0); }} /> : <section id="digital-stage-6" className="scroll-mt-5 rounded-3xl border border-dashed border-slate-200 bg-white/60 p-5 text-sm text-slate-400">运行结束后生成周复盘；经营结果会等待真实指标观察窗口。</section>}
          </>}
        </>}
      </div>
    </div>
    <TaskDetailDrawer task={selectedTask} selectedEvent={selectedEvent} events={data?.events || []} onClose={closeDrawer} />
  </div>;
}
