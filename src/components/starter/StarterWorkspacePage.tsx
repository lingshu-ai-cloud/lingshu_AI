import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Loader2,
  MessageSquarePlus,
  RefreshCcw,
  RotateCcw,
  Target,
} from 'lucide-react';
import type { Page } from '../../App';
import type {
  StarterAgentRole,
  StarterTodayItem,
  StarterWorkspaceAction,
} from '../../lib/starterWorkspace';
import WorkspaceActionButtons from './WorkspaceActionButtons';
import { useStarterWorkspace } from './useStarterWorkspace';
import { PAGE_REGISTRY } from '../../pageRegistry';

type WorkspaceTab = 'today' | 'decisions' | 'results';

const BUSINESS_AREA_LABEL: Record<StarterAgentRole, string> = {
  orchestrator: '经营统筹',
  content: '内容制作',
  traffic: '发布与渠道',
  sales: '客户跟进',
};

const RESULT_WORKSPACE: Record<StarterAgentRole, { page: Page; label: string }> = {
  orchestrator: { page: 'strategy', label: '经营首页' },
  content: { page: 'smartAssets', label: '内容制作工作区' },
  traffic: { page: 'traffic', label: '发布与渠道工作区' },
  sales: { page: 'conversion', label: '客户会话工作区' },
};

const STATUS_LABEL: Record<string, string> = {
  pending: '等待执行',
  queued: '已排队',
  ready: '准备就绪',
  running: '正在运行',
  waiting_external: '等待外部结果',
  waiting_approval: '等待审批',
  waiting_user: '等待你处理',
  waiting_human: '等待你处理',
  blocked: '暂时无法继续',
  succeeded: '已完成',
  completed: '已完成',
  skipped: '无数据，已跳过',
  failed: '执行失败',
  cancelled: '已取消',
  draft_ready: '报价待审核',
  approved: '已批准',
  returned: '已退回',
  artifact_pending: '报价文件生成中',
  awaiting_user_publish: '等待人工发布',
  evidence_submitted: '发布证据待验真',
  evidence_rejected: '发布证据需修正',
  published: '发布证据已验证',
  send_evidence_pending_verification: '发送记录待验真',
};

const statusLabel = (value: string): string => STATUS_LABEL[value] || '状态待同步';

const DECISION_TYPE_LABEL: Record<string, string> = {
  content_release_approval: '内容确认',
  quotation: '报价确认',
};

const ARTIFACT_KIND_LABEL: Record<string, string> = {
  publication_package: '发布交付包',
  task_output: '任务成果',
};

const RISK_LEVEL_LABEL: Record<string, string> = {
  L0: '常规确认',
  L1: '低风险',
  L2: '中风险',
  L3: '高风险',
};

const decisionTypeLabel = (value: string): string => DECISION_TYPE_LABEL[value] || '业务确认';
const artifactKindLabel = (value: string): string => ARTIFACT_KIND_LABEL[value] || '经营成果';
const riskLevelLabel = (value: string): string => RISK_LEVEL_LABEL[value] || '风险待评估';

function formatTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-white px-4 py-8 text-center">
      <CheckCircle2 size={18} className="mx-auto text-accent" aria-hidden="true" />
      <p className="mt-2 text-xs text-text-muted">{text}</p>
    </div>
  );
}

function TodayCard({
  item,
  pendingCommand,
  onExecute,
  setupPlanLimits,
  setupStartAction,
}: {
  item: StarterTodayItem;
  pendingCommand: string | null;
  onExecute: ReturnType<typeof useStarterWorkspace>['execute'];
  setupPlanLimits: {
    contentArtifactCountPerCycle: number;
    primaryPlatformCount: number;
    budgetCnyPerCycle: number;
    contentBudgetCnyPerCycle: number;
  };
  setupStartAction: StarterWorkspaceAction | null;
}) {
  const isGuidedSetup = item.actions.some(action => action.command === 'confirm_initial_setup');
  return (
    <article className={`rounded-xl border border-border bg-white p-4 ${isGuidedSetup ? 'xl:col-span-2' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-accent">{BUSINESS_AREA_LABEL[item.ownerAgent]}</p>
          <h3 className="mt-1 text-sm font-bold text-text-primary">{item.what}</h3>
        </div>
        <span className="rounded-full bg-surface-2 px-2 py-1 text-[10px] font-semibold text-text-secondary">{statusLabel(item.status)}</span>
      </div>
      {item.why && <p className="mt-2 text-xs leading-relaxed text-text-muted">为什么做：{item.why}</p>}
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        {item.output && <div className="rounded-lg bg-surface-2 p-2.5"><dt className="text-[10px] font-semibold text-text-muted">真实产出</dt><dd className="mt-1 leading-relaxed text-text-primary">{item.output}</dd></div>}
        {item.next && <div className="rounded-lg bg-surface-2 p-2.5"><dt className="text-[10px] font-semibold text-text-muted">下一步</dt><dd className="mt-1 leading-relaxed text-text-primary">{item.next}</dd></div>}
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-text-muted">
        {item.evidence && <span>依据：{item.evidence}</span>}
        {formatTime(item.updatedAt) && <time dateTime={item.updatedAt || undefined}>更新：{formatTime(item.updatedAt)}</time>}
      </div>
      <WorkspaceActionButtons actions={item.actions} targetId={item.id} pendingCommand={pendingCommand} onExecute={onExecute} setupPlanLimits={setupPlanLimits} setupStartAction={setupStartAction} />
    </article>
  );
}

function TodayView({ state }: { state: ReturnType<typeof useStarterWorkspace> }) {
  const workspace = state.workspace!;
  const setupStartAction = workspace.controls.find(action => action.command === 'submit_orchestrator_input') || null;
  const setupPlanLimits = {
    contentArtifactCountPerCycle: workspace.capabilityManifest.resourceLimits.contentArtifactCountPerCycle,
    primaryPlatformCount: workspace.capabilityManifest.resourceLimits.primaryPlatformCount,
    budgetCnyPerCycle: workspace.capabilityManifest.resourceLimits.budgetCnyPerCycle,
    contentBudgetCnyPerCycle: workspace.capabilityManifest.resourceLimits.agentBudgetCny.content,
  };
  const groups = [
    { id: 'completed', title: '今天已完成', icon: <CheckCircle2 size={16} />, items: workspace.today.completed },
    { id: 'progress', title: '正在进行／需要处理', icon: <Clock3 size={16} />, items: workspace.today.inProgress },
    { id: 'next', title: '接下来 24 小时', icon: <ArrowRight size={16} />, items: workspace.today.nextSteps },
  ];
  return (
    <div className="space-y-6">
      <section aria-labelledby="result-change-heading">
        <h2 id="result-change-heading" className="mb-3 flex items-center gap-2 text-sm font-bold text-text-primary"><Target size={16} className="text-accent" />结果变化</h2>
        {workspace.today.resultChanges.length === 0 ? <EmptyState text="尚无已接入的结果变化；系统不会用 0 补齐未回流数据。" /> : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {workspace.today.resultChanges.map(metric => (
              <article key={metric.id} className="rounded-xl border border-border bg-white p-4">
                <p className="text-xs font-semibold text-text-muted">{metric.label}</p>
                {metric.availability === 'available' && metric.value !== null ? (
                  <div className="mt-2 flex items-end gap-2"><strong className="text-2xl font-bold text-text-primary">{metric.value.toLocaleString('zh-CN')}</strong><span className="pb-0.5 text-xs text-text-muted">{metric.unit}</span></div>
                ) : <p className="mt-2 text-sm font-bold text-text-secondary">{metric.availability === 'pending' ? '等待回流' : '尚未接通'}</p>}
                {metric.delta !== null && <p className={`mt-1 text-xs font-semibold ${metric.delta >= 0 ? 'text-accent' : 'text-red-700'}`}>{metric.delta >= 0 ? '+' : ''}{metric.delta.toLocaleString('zh-CN')} {metric.unit}</p>}
                {metric.note && <p className="mt-1 text-[10px] leading-relaxed text-text-muted">{metric.note}</p>}
              </article>
            ))}
          </div>
        )}
      </section>
      {groups.map(group => (
        <section key={group.id} aria-labelledby={`today-${group.id}`}>
          <h2 id={`today-${group.id}`} className="mb-3 flex items-center gap-2 text-sm font-bold text-text-primary"><span className="text-accent">{group.icon}</span>{group.title}</h2>
          {group.items.length === 0 ? <EmptyState text="这一组目前没有需要展示的任务。" /> : (
            <div className="grid gap-3 xl:grid-cols-2">
              {group.items.map(item => <TodayCard key={item.id} item={item} pendingCommand={state.pendingCommand} onExecute={state.execute} setupPlanLimits={setupPlanLimits} setupStartAction={setupStartAction} />)}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function DecisionsView({ state }: { state: ReturnType<typeof useStarterWorkspace> }) {
  const decisions = state.workspace!.decisions;
  if (decisions.length === 0) return <EmptyState text="目前没有需要你处理的事项，其他工作会按已确认规则继续推进。" />;
  return (
    <div className="space-y-3">
      {decisions.map(decision => (
        <article key={decision.id} className="rounded-xl border border-border bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-insight-soft px-2 py-1 text-[10px] font-bold text-insight-action">{riskLevelLabel(decision.riskLevel)}</span>
                <span className="text-[10px] text-text-muted">{decisionTypeLabel(decision.type)}</span>
              </div>
              <h2 className="mt-2 text-base font-bold text-text-primary">{decision.title}</h2>
              {decision.summary && <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{decision.summary}</p>}
            </div>
            {formatTime(decision.dueAt) && <span className="shrink-0 text-[10px] font-semibold text-text-muted">截止 {formatTime(decision.dueAt)}</span>}
          </div>
          <dl className="mt-4 grid gap-3 lg:grid-cols-3">
            <div className="rounded-lg border border-accent/20 bg-[#edf7f1] p-3"><dt className="text-[10px] font-bold text-accent">处理建议</dt><dd className="mt-1 text-xs leading-relaxed text-text-primary">{decision.recommendedOption || '尚无可靠建议'}</dd></div>
            <div className="rounded-lg bg-surface-2 p-3"><dt className="text-[10px] font-bold text-text-muted">与当前版本的差异</dt><dd className="mt-1 text-xs leading-relaxed text-text-primary">{decision.difference || '无差异说明'}</dd></div>
            <div className="rounded-lg bg-surface-2 p-3"><dt className="text-[10px] font-bold text-text-muted">确认后会发生什么</dt><dd className="mt-1 text-xs leading-relaxed text-text-primary">{decision.effect || '等待系统说明'}</dd></div>
          </dl>
          {decision.evidence && <p className="mt-3 text-[11px] leading-relaxed text-text-muted">判断依据：{decision.evidence}</p>}
          <WorkspaceActionButtons actions={decision.actions} targetId={decision.id} pendingCommand={state.pendingCommand} onExecute={state.execute} />
        </article>
      ))}
    </div>
  );
}

function ResultsView({
  state,
  onNavigate,
}: {
  state: ReturnType<typeof useStarterWorkspace>;
  onNavigate: (page: Page) => void;
}) {
  const { results } = state.workspace!;
  return (
    <div className="space-y-6">
      <section aria-labelledby="result-chain-heading">
        <h2 id="result-chain-heading" className="mb-3 text-sm font-bold text-text-primary">从内容到成交的真实证据链</h2>
        {results.stages.length === 0 ? <EmptyState text="成果链尚未形成；未接通的数据不会被记为 0 或成功。" /> : (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {results.stages.map((stage, index) => (
              <div key={stage.id} className="flex shrink-0 items-center gap-2">
                <article className="w-40 rounded-xl border border-border bg-white p-4">
                  <p className="text-[11px] font-semibold text-text-muted">{stage.label}</p>
                  <p className="mt-2 text-lg font-bold text-text-primary">{stage.availability === 'available' && stage.value !== null ? stage.value.toLocaleString('zh-CN') : stage.availability === 'pending' ? '等待回流' : '尚未接通'}</p>
                  {stage.source && <p className="mt-1 text-[10px] text-text-muted">来源：{stage.source}</p>}
                  {stage.note && <p className="mt-1 text-[10px] leading-relaxed text-text-muted">{stage.note}</p>}
                </article>
                {index < results.stages.length - 1 && <ArrowRight size={15} className="shrink-0 text-text-muted" aria-hidden="true" />}
              </div>
            ))}
          </div>
        )}
      </section>
      <section aria-labelledby="artifact-heading">
        <h2 id="artifact-heading" className="mb-3 flex items-center gap-2 text-sm font-bold text-text-primary"><FileCheck2 size={16} className="text-accent" />成果与证据</h2>
        {results.artifacts.length === 0 ? <EmptyState text="暂无可验证成果。" /> : (
          <div className="grid gap-3 xl:grid-cols-2">
            {results.artifacts.map(artifact => {
              const destination = RESULT_WORKSPACE[artifact.agentRole];
              return (
                <article key={artifact.id} className="rounded-xl border border-border bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="text-[10px] font-bold text-accent">{BUSINESS_AREA_LABEL[artifact.agentRole]} · {artifactKindLabel(artifact.kind)}</p><h3 className="mt-1 text-sm font-bold text-text-primary">{artifact.title}</h3></div>
                    <span className="rounded-full bg-surface-2 px-2 py-1 text-[10px] font-semibold text-text-secondary">{statusLabel(artifact.status)}</span>
                  </div>
                  {artifact.evidence && <p className="mt-2 text-xs leading-relaxed text-text-muted">证据：{artifact.evidence}</p>}
                  {formatTime(artifact.createdAt) && <p className="mt-1 text-[10px] text-text-muted">{formatTime(artifact.createdAt)}</p>}
                  <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-text-muted">当前成果记录没有可验证的媒体预览，界面不会生成占位画面。请进入对应工作区查看内容与后续状态。</p>
                  <button type="button" onClick={() => onNavigate(destination.page)} className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-accent hover:text-accent-dim">进入{destination.label}<ArrowRight size={13} aria-hidden="true" /></button>
                  <WorkspaceActionButtons actions={artifact.actions} targetId={artifact.id} pendingCommand={state.pendingCommand} onExecute={state.execute} />
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default function StarterWorkspacePage({
  onNavigate,
}: {
  onNavigate: (page: Page) => void;
  onNavigateWithTask?: (page: Page, taskId: string) => void;
}) {
  const state = useStarterWorkspace();
  const [tab, setTab] = useState<WorkspaceTab>('today');
  const [supplement, setSupplement] = useState('');
  const tabs = useMemo(() => [
    { id: 'today' as const, label: '业务进度', count: null },
    { id: 'decisions' as const, label: '待处理', count: state.workspace?.decisions.length ?? null },
    { id: 'results' as const, label: '结果', count: state.workspace?.results.artifacts.length ?? null },
  ], [state.workspace]);
  const openWorkspaceTab = (nextTab: WorkspaceTab) => {
    setTab(nextTab);
    window.requestAnimationFrame(() => {
      document.getElementById('starter-workspace-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  if (state.loading && !state.workspace) {
    return <div className="flex h-full items-center justify-center"><Loader2 size={22} className="animate-spin text-accent" /><span className="ml-2 text-sm text-text-muted">灵小枢正在汇总今天的工作……</span></div>;
  }
  if (!state.workspace) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-md rounded-xl border border-border bg-white p-6 text-center">
          <AlertCircle size={22} className="mx-auto text-amber-700" />
          <h1 className="mt-3 text-base font-bold text-text-primary">{PAGE_REGISTRY.digitalEmployees.canonicalTitle}</h1>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">{state.error || '业务进度暂时无法读取，请稍后重试。'}</p>
          <button type="button" onClick={() => void state.refresh()} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white"><RefreshCcw size={14} />重新读取</button>
        </div>
      </div>
    );
  }

  const workspace = state.workspace;
  const orchestratorInputAction = workspace.controls.find(action => action.command === 'submit_orchestrator_input') || null;
  const runControls = workspace.controls.filter(action => action.command !== 'submit_orchestrator_input');
  const orchestratorInputDisabled = !orchestratorInputAction || Boolean(orchestratorInputAction.disabledReason);

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain bg-[#f6f8f5]">
      <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-5 border-b border-border pb-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">经营工作台</p>
          <h1 className="mt-1 text-xl font-bold text-text-primary">{PAGE_REGISTRY.digitalEmployees.canonicalTitle}</h1>
          <p className="mt-1 text-xs text-text-muted">集中查看业务进度、结果和需要你处理的事项。</p>
        </header>
        {(state.error || state.notice) && (
          <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${state.error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            {state.error || state.notice}
          </div>
        )}

        <div id="starter-workspace-tabs" className="scroll-mt-4 flex items-center gap-1 rounded-xl border border-border bg-white p-1" role="tablist" aria-label="智能经营主视图">
          {tabs.map(item => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => openWorkspaceTab(item.id)} className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-bold transition ${tab === item.id ? 'bg-[#edf4ef] text-accent' : 'text-text-muted hover:bg-surface-2 hover:text-text-primary'}`}>
              {item.label}{item.count !== null && item.count > 0 ? <span className="ml-1.5 rounded-full bg-white px-1.5 py-0.5 text-[10px]">{item.count}</span> : null}
            </button>
          ))}
        </div>

        <main className="mt-5">
          {tab === 'today' && <TodayView state={state} />}
          {tab === 'decisions' && <DecisionsView state={state} />}
          {tab === 'results' && <ResultsView state={state} onNavigate={onNavigate} />}
        </main>

        {tab === 'decisions' && (
          <section className="mt-7 rounded-xl border border-border bg-white p-4" aria-labelledby="supplement-heading">
            <details>
              <summary id="supplement-heading" className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold text-text-primary">
                <span className="flex items-center gap-2"><MessageSquarePlus size={16} className="text-accent" />补充或纠正业务信息</span>
                <span className="text-xs font-normal text-text-muted">有新信息时再填写</span>
              </summary>
              <div className="mt-4 border-t border-border pt-4">
                <textarea value={supplement} onChange={event => setSupplement(event.target.value)} maxLength={4000} rows={3} placeholder="只写新信息，例如：把主推市场改为德国，或这个产品的 MOQ 是 500 件。" className="w-full resize-y border border-border px-3 py-2 text-sm leading-relaxed" />
                {orchestratorInputDisabled && <p className="mt-2 text-xs text-amber-800">{orchestratorInputAction?.disabledReason === 'starter_198_orchestrator_worker_unavailable' ? '当前暂时无法接收补充信息，请稍后重试。' : '当前工作区未开放补充输入能力。'}</p>}
                <div className="mt-2 flex justify-end"><button type="button" disabled={!supplement.trim() || Boolean(state.pendingCommand) || orchestratorInputDisabled} onClick={() => {
                  if (!orchestratorInputAction?.command || orchestratorInputAction.disabledReason) return;
                  void state.execute({ command: orchestratorInputAction.command, targetId: workspace.run.id || 'workspace', expectedVersion: orchestratorInputAction.expectedVersion || undefined, payload: { input: supplement.trim() } }).then(() => setSupplement('')).catch(() => {});
                }} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><MessageSquarePlus size={14} />提交补充信息</button></div>
              </div>
            </details>
          </section>
        )}

        {tab === 'decisions' && runControls.length > 0 && (
          <section className="mt-4 rounded-xl border border-border bg-white p-4" aria-labelledby="run-control-heading">
            <div className="flex items-start gap-3"><RotateCcw size={16} className="mt-0.5 text-text-muted" /><div className="flex-1"><h2 id="run-control-heading" className="text-sm font-bold text-text-primary">计划控制</h2><p className="mt-1 text-xs text-text-muted">在这里暂停、恢复或取消当前业务计划。</p><WorkspaceActionButtons actions={runControls} targetId={workspace.run.id || 'workspace'} pendingCommand={state.pendingCommand} onExecute={state.execute} /></div></div>
          </section>
        )}

      </div>
    </div>
  );
}
