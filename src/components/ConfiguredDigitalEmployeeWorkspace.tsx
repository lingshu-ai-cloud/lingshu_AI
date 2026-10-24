import BusinessHealthOverview from './smartBusiness/BusinessHealthOverview';
import BusinessOverviewTabs from './smartBusiness/BusinessOverviewTabs';
import { labels as sharedTaskLabels } from '../../shared/mobile-domain.mjs';
import { getScrollBehavior } from '../lib/usePrefersReducedMotion';
import { PAGE_REGISTRY, type Page } from '../pageRegistry';
import type { PresenterProductionGate } from '../lib/shotProduction';
import { Alert, Button, Modal } from 'antd';
import { OnboardingPanel } from './smartBusiness/DigitalEmployeeOnboardingPanel';
import { GoalPanel, type GoalDraft, type BusinessLine, type ContentPlatform } from './smartBusiness/WeeklyGoalPanel';
import type { OnboardingConfigurationInput } from './digitalEmployeeConfigurationAction';
import WeeklyStartConflictAlert from './WeeklyStartConflictAlert';
import WeeklyProductionStudioEntry from './smartBusiness/WeeklyProductionStudioEntry';
import PlanHistoryDialog from './PlanHistoryDialog';
import { Suspense, useState, type Dispatch, type SetStateAction } from 'react';
import { SmartBusinessDashboard, WeeklyCommandCenter, WeeklyPlanDetailsDrawer, BusinessInterpretation, deferredWorkspaceFallback } from './digitalEmployeeDeferredViews';
import { CalendarRange, ChevronLeft, History, Pause, Play } from 'lucide-react';
import { digitalEmployeeApi, buildTaskDeepLink, dispatchDigitalEmployeeDeepLink, type BusinessReadinessItem, type DigitalEmployeeOverview } from '../lib/digitalEmployees';
import type { WeeklyStartConflict } from '../lib/weeklyStartValidation';
import { weeklyWorkStatus } from '../lib/weeklyWorkStatus';

export type WorkspaceView = 'today' | 'matrix' | 'overview' | 'live' | 'review' | 'rules';
type Setter<T> = Dispatch<SetStateAction<T>>;

export const statusLabel: Record<string, string> = {
  ...sharedTaskLabels,
  draft: '待确认', active: '运行中', initializing: '初始化中', blocked: '等待处理',
  paused: '已暂停', planning: '规划中', running: '执行中',
  waiting_external: '等待业务回写', waiting_approval: '待审批',
  waiting_human: '人工接管', pending: '待执行', handed_off: '已接管',
  approved: '已批准', rejected: '已驳回',
};
const weeklyRunHeaderLabel: Record<string, string> = {
  failed: '执行失败', cancelled: '已取消', paused: '已暂停',
  waiting_external: '等待业务结果', waiting_approval: '待处理',
  waiting_human: '待处理', blocked: '待处理', queued: '准备中',
  planning: '准备中', initializing: '准备中', pending: '准备中',
  succeeded: '已完成', running: '执行中',
};
function OnboardingWelcome({ onClose }: { onClose: () => void }) {
  return <Modal open title="准备工作已经完成" onCancel={onClose} width={480} footer={<Button type="primary" onClick={onClose}>开始使用灵枢</Button>}>
    <p className="py-4 text-sm leading-7 text-text-secondary">企业资料、产品表和社媒经营阶段都已保存。接下来可制定周计划，查看四位数字员工的执行进度与交付结果。</p>
  </Modal>;
}

export interface ConfiguredDigitalEmployeeWorkspaceProps {
  active: boolean;
  data: DigitalEmployeeOverview;
  busy: string;
  error: string;
  activeRun: boolean;
  canCreateNextGoal: boolean;
  viewGoalId: string;
  workspaceView: WorkspaceView;
  businessLine: BusinessLine;
  contentPlatform: ContentPlatform;
  selectedAccountId: string;
  selectedContentItemId: string;
  weeklyStudioContentId: string;
  weeklyStartConflict: WeeklyStartConflict | null;
  weeklyPlanOpen: boolean;
  newGoal: boolean;
  planHistoryOpen: boolean;
  weeklyPlanDetailsOpen: boolean;
  applicationGuideOpen: boolean;
  applicationGuideEntry: 'start' | 'presenter';
  weeklyStartDialogOpen: boolean;
  weeklyPresenterLoading: boolean;
  weeklyPresenterGate: PresenterProductionGate;
  onboardingWelcomeOpen: boolean;
  setError: Setter<string>;
  setViewGoalId: Setter<string>;
  setWorkspaceView: Setter<WorkspaceView>;
  setSelectedTaskId: Setter<string>;
  setSelectedContentItemId: Setter<string>;
  setWeeklyStudioContentId: Setter<string>;
  setWeeklyPlanOpen: Setter<boolean>;
  setNewGoal: Setter<boolean>;
  setPlanHistoryOpen: Setter<boolean>;
  setWeeklyPlanDetailsOpen: Setter<boolean>;
  setApplicationGuideOpen: Setter<boolean>;
  setApplicationGuideEntry: Setter<'start' | 'presenter'>;
  setWeeklyStartDialogOpen: Setter<boolean>;
  setOnboardingWelcomeOpen: Setter<boolean>;
  onNavigate?: (page: Page) => void;
  onOpenMonitor?: () => void;
  load: (goalId?: string) => Promise<DigitalEmployeeOverview | undefined>;
  act: (key: string, action: () => Promise<DigitalEmployeeOverview>, throwOnError?: boolean) => Promise<DigitalEmployeeOverview | null>;
  returnToLatest: () => Promise<void>;
  openWeeklyStartConfirmation: () => Promise<void>;
  presentConfirmedWeeklyExecution: (next: DigitalEmployeeOverview, goalId: string) => boolean;
  publishWeeklyWorkUpdate: (next: DigitalEmployeeOverview) => void;
  changeOverviewDateRange: (range: { startsAt: string; endsAt: string }) => void;
  openReadiness: (item: BusinessReadinessItem) => void;
  saveConfig: (config: OnboardingConfigurationInput) => Promise<boolean>;
  createWeeklyOutline: (goalInput: GoalDraft) => Promise<void>;
  generateCurrentPlanDetails: () => Promise<void>;
  confirmWeeklyPlan: () => Promise<void>;
}

export function ConfiguredDigitalEmployeeWorkspace(props: ConfiguredDigitalEmployeeWorkspaceProps) {
  const [healthDialogOpen, setHealthDialogOpen] = useState(false);
  const {
    active, data, busy, error, activeRun, canCreateNextGoal, viewGoalId, workspaceView,
    businessLine, contentPlatform, selectedAccountId, selectedContentItemId,
    weeklyStudioContentId, weeklyStartConflict, weeklyPlanOpen, newGoal,
    planHistoryOpen, weeklyPlanDetailsOpen, applicationGuideOpen,
    applicationGuideEntry, weeklyStartDialogOpen, weeklyPresenterLoading,
    weeklyPresenterGate, onboardingWelcomeOpen, setError, setViewGoalId,
    setWorkspaceView, setSelectedTaskId, setSelectedContentItemId,
    setWeeklyStudioContentId, setWeeklyPlanOpen, setNewGoal, setPlanHistoryOpen,
    setWeeklyPlanDetailsOpen, setApplicationGuideOpen, setApplicationGuideEntry,
    setWeeklyStartDialogOpen, setOnboardingWelcomeOpen, onNavigate, onOpenMonitor,
    load, act, returnToLatest, openWeeklyStartConfirmation,
    presentConfirmedWeeklyExecution, publishWeeklyWorkUpdate,
    changeOverviewDateRange, openReadiness, saveConfig, createWeeklyOutline,
    generateCurrentPlanDetails, confirmWeeklyPlan,
  } = props;
  if (!data.config) return null;
  const goal = data.goal;
    const dashboardView = workspaceView === "matrix"
      ? "matrix"
      : workspaceView === "overview"
        ? "review"
        : workspaceView === "live"
          ? selectedContentItemId ? "production" : "review"
          : workspaceView === "review" ? "review" : "home";
    const currentVideoPlans = data.plan?.businessPackage?.tasks.find(task => task.templateId === "production")?.videoPlans || goal?.videoPlans || [];
    const currentMasterPlans = currentVideoPlans.filter(plan => plan.productionRole !== "platform_adaptation");
    const missingReferenceMasters = currentMasterPlans.filter(plan => !plan.referenceId);
    const missingProductMasters = currentMasterPlans.filter(plan => !plan.productName);
    const detailGeneration = data.plan?.businessPackage?.detailGeneration;
    const publishingReadiness = data.publishingReadiness;
    const publishingSetupRequired = !activeRun && !viewGoalId && Boolean(publishingReadiness?.required && !publishingReadiness.ready);
    const openPublishingAccountSetup = () => window.dispatchEvent(new CustomEvent("lingshu:navigate", {
      detail: { page: "accountManagement", businessRef: { taskKey: "publishing_account_setup" } },
    }));
    const openConflictingRun = async () => {
      const conflict = weeklyStartConflict;
      if (!conflict) return;
      if (!conflict.goalId) {
        onOpenMonitor?.();
        return;
      }
      setViewGoalId(conflict.goalId);
      setSelectedTaskId("");
      const next = await load(conflict.goalId);
      if (!next) return;
      setSelectedTaskId(next.tasks.find((task) => ["running", "waiting_external", "waiting_approval", "waiting_human", "failed"].includes(task.status))?.id || next.tasks[0]?.id || "");
      setWorkspaceView("live");
    };
    const projectedWeeklyStatus = weeklyWorkStatus(data);
    const currentPlanStatusLabel = viewGoalId
      ? "历史计划"
      : data.run
        ? projectedWeeklyStatus?.title.includes("自动恢复")
          ? "自动恢复中"
          : weeklyRunHeaderLabel[data.run.status] || "状态待确认"
        : goal?.status === "draft"
          ? "待确认"
          : goal?.status === "completed"
            ? "已完成"
            : goal?.status === "cancelled"
              ? "已取消"
              : "已确认";
    // Recover only the failed production node of this run, never create another
    // weekly run or implicitly approve publishing/human acceptance tasks.
    const recoverableProductionTask = data.run?.goal_id === goal?.id && ["waiting_human", "failed"].includes(data.run?.status || "")
      ? data.tasks.find(task => task.run_id === data.run!.id && task.task_key === "content_production" && ["failed", "waiting_human"].includes(task.status))
      : undefined;
    const controlWeeklyWork = async () => {
      if (busy) return;
      if (viewGoalId) {
        await returnToLatest();
        return;
      }
      if (recoverableProductionTask) {
        const next = await act(`retry:${recoverableProductionTask.id}`, () => digitalEmployeeApi.retryTask(recoverableProductionTask.id));
        if (next && goal) presentConfirmedWeeklyExecution(next, goal.id);
        return;
      }
      if (activeRun && data.run) {
        const next = data.run.status === "paused"
          ? await act("resume", () => digitalEmployeeApi.resumeRun(data.run!.id))
          : await act("pause", () => digitalEmployeeApi.pauseRun(data.run!.id));
        if (next) publishWeeklyWorkUpdate(next);
        return;
      }
      if (!goal || canCreateNextGoal) {
        setError("");
        setNewGoal(true);
        setWeeklyPlanOpen(true);
        return;
      }
      setNewGoal(false);
      setWeeklyPlanOpen(false);
      await openWeeklyStartConfirmation();
    };
    const weeklyControlLabel = busy === "confirm-weekly-plan"
      ? "正在启动生产…"
      : viewGoalId
      ? "返回当前周计划"
      : recoverableProductionTask
        ? busy ? "正在恢复生产…" : "继续生产"
      : activeRun
        ? data.run?.status === "paused" ? "继续周任务" : "暂停周任务"
        : !goal
          ? "制定周计划"
          : canCreateNextGoal
            ? "制定下一周计划"
            : "确认并开始生产";
    const openContentProduction = (taskId?: string, socialContentTaskId?: string, projectId?: string) => {
      if (projectId) {
        const contentProductionTask = data.tasks.find(item => item.run_id === data.run?.id && item.task_key === "content_production")
          || data.tasks.find(item => item.task_key === "content_production");
        window.dispatchEvent(new CustomEvent("lingshu:navigate", { detail: {
          page: "smartAssets", view: "create", studioPanel: "projects", directStudio: true,
          workflowRunId: contentProductionTask?.run_id || data.run?.id || "",
          workflowTaskId: contentProductionTask?.id || taskId || "",
          businessRef: { taskKey: "content_production", entityId: projectId },
        } }));
        return;
      }
      if (socialContentTaskId) {
        window.dispatchEvent(new CustomEvent("lingshu:navigate", { detail: {
          page: "smartAssets", view: "create", directStudio: true, agentTaskDemo: true,
          socialContentTaskId, socialContentPage: "smartAssets",
        } }));
        return;
      }
      const task = data.tasks.find(item => item.id === taskId)
        || data.tasks.find(item => item.task_key === "content_production")
        || data.tasks.find(item => item.task_key === "content_quality_gate");
      if (!task) {
        onNavigate?.("smartAssets");
        return;
      }
      const planTask = data.plan?.tasks.find(item => item.key === task.task_key);
      dispatchDigitalEmployeeDeepLink(buildTaskDeepLink(task, planTask, data.run?.id || task.run_id));
    };
    const openProductionProgress = (taskId: string, contentItemId: string, _projectId?: string) => {
      const items = (data.contentQueue?.items || []).filter(item => item.id === contentItemId && (!taskId || item.taskId === taskId));
      if (items.length === 1 && items[0]!.origin === "weekly_plan") {
        // Preserve the source tab. Returning from Studio must not reopen a redirect.
        setWeeklyStudioContentId(items[0]!.contentId);
        return;
      }
      if (taskId) setSelectedTaskId(taskId);
      setSelectedContentItemId(contentItemId);
      setWorkspaceView("live");
      window.setTimeout(() => document.querySelector('[data-testid="production-task-scene"]')?.scrollIntoView({ behavior: getScrollBehavior(), block: "start" }), 50);
    };
    // Only explicit action failures/conflicts belong here. Persisted run state
    // remains in the compact header and per-content progress, never a home banner.
    const weeklyActionFeedback = (weeklyStartConflict && !viewGoalId) || error ? (
      <div className="space-y-2">
        {weeklyStartConflict && !viewGoalId && <WeeklyStartConflictAlert conflict={weeklyStartConflict} statusLabels={statusLabel} onViewRun={() => void openConflictingRun()} />}
        {error && <Alert type="error" showIcon title={error} closable onClose={() => setError("")} />}
      </div>
    ) : undefined;
    const weeklyPlanControls = <>
      {activeRun && !viewGoalId
        ? <Button onClick={() => setWeeklyPlanDetailsOpen(true)} icon={<CalendarRange size={15}/>}>查看周任务</Button>
        : <Button onClick={()=>setPlanHistoryOpen(true)} icon={<History size={15}/>}>历史计划</Button>}
      <Button type="primary" loading={Boolean(busy)} onClick={()=>void controlWeeklyWork()} icon={!activeRun && (!goal || canCreateNextGoal) ? <CalendarRange size={15}/> : activeRun && !recoverableProductionTask && data.run?.status !== "paused" ? <Pause size={15}/> : <Play size={15}/>}>{weeklyControlLabel}</Button>
    </>;
    return (
      <>
      {weeklyStudioContentId && <WeeklyProductionStudioEntry data={data} contentId={weeklyStudioContentId} autoOpen onOpened={() => setWeeklyStudioContentId("")} onUnavailable={() => setWeeklyStudioContentId("")} />}
      {!weeklyPlanOpen && <div className="h-full overflow-y-auto bg-surface">
        <div className="mx-auto w-full px-2 py-3 sm:px-3">
          <h1 className="sr-only">{PAGE_REGISTRY.digitalEmployees.canonicalTitle}</h1>
          <div className="grid grid-cols-1 overflow-hidden rounded-2xl border border-border bg-surface xl:grid-cols-[minmax(0,1.7fr)_minmax(360px,1fr)]"><div aria-label="当前周计划" className="min-w-0">
            {goal ? <Suspense fallback={deferredWorkspaceFallback}><WeeklyCommandCenter
              data={data}
              statusLabel={currentPlanStatusLabel}
              actions={weeklyPlanControls}
              feedback={weeklyActionFeedback}
              onMetricClick={metric => {
                setSelectedContentItemId("");
                if (metric === "waiting_review") {
                  setWorkspaceView("matrix");
                  return;
                }
                if (metric === "settled_cost") {
                  setWorkspaceView("review");
                  return;
                }
                setWeeklyPlanDetailsOpen(true);
              }}
              notice={publishingSetupRequired
                ? <><p className="mr-auto text-xs leading-5 text-text-secondary"><strong className="text-warning">发布准备待完成：</strong>{publishingReadiness?.summary}。内容生产可以继续，系统不会把未连接账号当成已就绪。</p><Button size="small" onClick={openPublishingAccountSetup}>配置发布账号</Button></>
                : !activeRun && !viewGoalId && (missingReferenceMasters.length > 0 || missingProductMasters.length > 0 || detailGeneration?.status === "blocked")
                ? <p className="mr-auto text-xs text-text-secondary">可直接开始任务；{detailGeneration?.blockedCount || missingReferenceMasters.length || missingProductMasters.length} 条内容的待补资料将在对应制作步骤提示，不阻止其他内容推进。账号连接与发布授权在正式发布前核验。</p>
                : undefined}
            /></Suspense> : <><section className="overflow-hidden rounded-lg border border-border bg-surface"><div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4"><div className="max-w-2xl"><p className="text-xs font-semibold text-accent">周经营计划</p><p className="mt-1 text-sm font-bold text-text-primary">本周还没有计划</p><p className="mt-1 text-xs leading-5 text-text-secondary">先制定并预览周计划。计划会说明本周做什么、在哪些平台生产、产量、预计预算和工作排期；确认前不会开始生产。</p></div><div aria-label="智能经营控制" className="flex max-w-full flex-wrap items-center justify-end gap-2">{weeklyPlanControls}</div></div></section>{weeklyActionFeedback && <div className="border-b border-border px-4 py-2.5">{weeklyActionFeedback}</div>}</>}
          </div>
          <aside aria-label="企业经营分" className="min-w-0 border-t border-border xl:border-l xl:border-t-0 [&_section]:rounded-none [&_section]:border-0"><BusinessHealthOverview summaryOnly data={data} selectedAccountId={selectedAccountId} overviewRangeBusy={busy === "overview-range"} onOverviewRangeChange={changeOverviewDateRange} onOpenAccountHealth={() => setHealthDialogOpen(true)}/></aside><Suspense fallback={deferredWorkspaceFallback}><BusinessInterpretation data={data} onViewReview={() => setWorkspaceView("review")}/></Suspense></div>
          {workspaceView === "today" ? <Button className="mt-3" onClick={() => setWorkspaceView("matrix")}>查看员工排期</Button> : <Button className="mt-3" onClick={() => { setSelectedContentItemId(""); setWorkspaceView("today"); }}>返回经营总览</Button>}
          <div className="grid grid-cols-1 gap-4 pb-6 pt-2">
            <main className="min-w-0">
            <Suspense fallback={deferredWorkspaceFallback}>{workspaceView === "rules"
              ? <OnboardingPanel initial={data.config} readiness={data.businessSnapshot?.readiness || []} busy={Boolean(busy)} mode="rules" activeRun={activeRun} onOpenReadiness={openReadiness} onSave={(config) => void saveConfig(config)} />
              : <SmartBusinessDashboard data={data} view={dashboardView} selectedAccountId={selectedAccountId} selectedContentItemId={selectedContentItemId} overviewRangeBusy={busy === "overview-range"} onOverviewRangeChange={changeOverviewDateRange} onRefresh={() => void load()} onGenerateDetails={() => void generateCurrentPlanDetails()} onOpenContent={openContentProduction} onOpenAgentSettings={() => setWorkspaceView("rules")} onOpenProductionProgress={openProductionProgress} onBackToQueue={()=>{setSelectedContentItemId("");setWorkspaceView("overview");}} onRetryTask={async taskId => Boolean(await act(`retry:${taskId}`, () => digitalEmployeeApi.retryTask(taskId)))} onControlJob={async (jobId, action) => Boolean(await act(`execution:${jobId}:${action}`, () => digitalEmployeeApi.controlExecutionJob(jobId, action)))} onGeneratePlan={() => { void controlWeeklyWork(); }} onNavigate={page => {
                  if (page === "socialPlanning") {
                    void controlWeeklyWork();
                    return;
                  }
                  if (page === "socialAccounts") {
                    setWorkspaceView("matrix");
                    return;
                  }
                  onNavigate?.(page);
                }} />}</Suspense>
            </main>
          </div>
          {workspaceView === "today" && <BusinessOverviewTabs data={data} onNavigate={onNavigate}/>}
        </div>
      </div>}
      <Modal open={healthDialogOpen} title="账号健康与阶段目标" width={960} footer={null} destroyOnHidden onCancel={() => setHealthDialogOpen(false)}>
        <BusinessHealthOverview accountOnly data={data} selectedAccountId={selectedAccountId} onNavigate={onNavigate}/>
      </Modal>
      {active && applicationGuideOpen && (
        <OnboardingPanel
          initial={data.config}
          readiness={data.businessSnapshot?.readiness || []}
          busy={Boolean(busy)}
          restartFromBeginning={applicationGuideEntry === "start"}
          initialStep={applicationGuideEntry}
          dismissible
          onClose={() => { setApplicationGuideOpen(false); setApplicationGuideEntry("start"); }}
          onOpenReadiness={openReadiness}
          onSave={async config => {
            const saved = await saveConfig(config);
            if (saved) { setApplicationGuideOpen(false); setApplicationGuideEntry("start"); }
            return saved;
          }}
        />
      )}
      <Modal
        open={weeklyStartDialogOpen}
        title="确认开始本周生产"
        okText="确认并开始生产"
        cancelText="取消"
        confirmLoading={busy === "confirm-weekly-plan"}
        okButtonProps={{ disabled: weeklyPresenterLoading || !weeklyPresenterGate.ready }}
        onCancel={() => setWeeklyStartDialogOpen(false)}
        onOk={() => {
          if (!weeklyPresenterGate.ready) return;
          setWeeklyStartDialogOpen(false);
          void confirmWeeklyPlan();
        }}
      >
        <div className="space-y-4 py-2">
          <p className="text-sm leading-6 text-text-secondary">启动后，编导与内容 Agent 将按本周计划进入真实生产。数字人形象是不可跳过的生产输入。</p>
          {weeklyPresenterLoading ? <p role="status" className="rounded-lg bg-surface-2 px-4 py-3 text-sm text-text-muted">正在核验数字人形象…</p> : weeklyPresenterGate.ready ? (
            <Alert type="success" showIcon title={`已选择：${weeklyPresenterGate.presenter?.name || '数字人形象'}`} description="生产会锁定该人物形象；不会切换为素材匹配或其他人物路线。" />
          ) : (
            <Alert type="warning" showIcon title="没有形象，无法进入生产" description={weeklyPresenterGate.message} />
          )}
          {!weeklyPresenterLoading && !weeklyPresenterGate.ready && <Button type="primary" onClick={() => {
            setWeeklyStartDialogOpen(false);
            setApplicationGuideEntry("presenter");
            setApplicationGuideOpen(true);
          }}>选择或录入数字人形象</Button>}
        </div>
      </Modal>
      {weeklyPlanOpen && (!goal || newGoal) && !activeRun && <div className="h-full overflow-y-auto bg-surface">
        <section aria-label="周计划生成" className="mx-auto w-full max-w-[1440px] p-4 sm:p-6">
          <header className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
            <h1 className="text-[28px] font-semibold">制定本周目标</h1>
            <Button disabled={Boolean(busy)} onClick={() => setWeeklyPlanOpen(false)} icon={<ChevronLeft size={15}/>}>返回经营首页</Button>
          </header>
          {error && (
            <Alert className="mb-4" type="error" showIcon title={error}/>
          )}
          <div className="py-5">
            <GoalPanel config={data.config} busy={Boolean(busy)} businessLine={businessLine} contentPlatform={contentPlatform} onOpenSettings={()=>{setWeeklyPlanOpen(false);setWorkspaceView("rules");}} onSave={goalInput => void createWeeklyOutline(goalInput)}/>
          </div>
        </section>
      </div>}
      {planHistoryOpen&&<PlanHistoryDialog goals={data.goals} onClose={()=>setPlanHistoryOpen(false)}/>}
      {weeklyPlanDetailsOpen&&<Suspense fallback={deferredWorkspaceFallback}><WeeklyPlanDetailsDrawer data={data} open onClose={()=>setWeeklyPlanDetailsOpen(false)}/></Suspense>}
      {onboardingWelcomeOpen && <OnboardingWelcome onClose={()=>setOnboardingWelcomeOpen(false)} />}
      </>
    );
}
