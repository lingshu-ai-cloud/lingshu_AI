import BusinessHealthOverview from './smartBusiness/BusinessHealthOverview';
import { labels as sharedTaskLabels } from '../../shared/mobile-domain.mjs';
import { getScrollBehavior } from '../lib/usePrefersReducedMotion';
import { PAGE_REGISTRY, type Page } from '../pageRegistry';
import { Alert, Button, Modal, Tag } from 'antd';
import { OnboardingPanel } from './smartBusiness/DigitalEmployeeOnboardingPanel';
import { GoalPanel, type GoalDraft, type BusinessLine, type ContentPlatform } from './smartBusiness/WeeklyGoalPanel';
import type { OnboardingConfigurationInput } from './digitalEmployeeConfigurationAction';
import WeeklyStartConflictAlert from './WeeklyStartConflictAlert';
import WeeklyProductionStudioEntry from './smartBusiness/WeeklyProductionStudioEntry';
import PlanHistoryDialog from './PlanHistoryDialog';
import { Suspense, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { SmartBusinessDashboard, WeeklyCommandCenter, WeeklyPlanDetailsDrawer, BusinessInterpretation, deferredWorkspaceFallback } from './digitalEmployeeDeferredViews';
import BusinessOverviewLanding from './smartBusiness/BusinessOverviewLanding';
import BusinessOverviewDetailDrawer from './smartBusiness/BusinessOverviewDetailDrawer';
import { BusinessOverviewSampleInterpretation } from './smartBusiness/BusinessOverviewSampleWork';
import { businessOverviewSample, isBusinessOverviewSampleEnabled } from '../dev/businessOverviewSample';
import { CalendarRange, ChevronLeft, History, Pause, Play } from 'lucide-react';
import { digitalEmployeeApi, buildTaskDeepLink, dispatchDigitalEmployeeDeepLink, type BusinessReadinessItem, type DigitalEmployeeOverview } from '../lib/digitalEmployees';
import type { WeeklyStartConflict } from '../lib/weeklyStartValidation';
import { weeklyWorkStatus } from '../lib/weeklyWorkStatus';
import { AGENT_SETTINGS_OPEN_EVENT, openContentGenerationQueue } from '../lib/contentGenerationQueue';

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
  const [accountConfigurationOpen, setAccountConfigurationOpen] = useState(false);
  const [sampleWeeklyPlanOpen, setSampleWeeklyPlanOpen] = useState(false);
  const openAccountConfiguration = () => { setHealthDialogOpen(false); setAccountConfigurationOpen(true); };
  const {
    active, data, busy, error, activeRun, canCreateNextGoal, viewGoalId, workspaceView,
    businessLine, contentPlatform, selectedAccountId, selectedContentItemId,
    weeklyStudioContentId, weeklyStartConflict, weeklyPlanOpen, newGoal,
    planHistoryOpen, weeklyPlanDetailsOpen, applicationGuideOpen,
    applicationGuideEntry, weeklyStartDialogOpen,
    onboardingWelcomeOpen, setError, setViewGoalId,
    setWorkspaceView, setSelectedTaskId, setSelectedContentItemId,
    setWeeklyStudioContentId, setWeeklyPlanOpen, setNewGoal, setPlanHistoryOpen,
    setWeeklyPlanDetailsOpen, setApplicationGuideOpen, setApplicationGuideEntry,
    setWeeklyStartDialogOpen, setOnboardingWelcomeOpen, onNavigate, onOpenMonitor,
    load, act, returnToLatest, openWeeklyStartConfirmation,
    presentConfirmedWeeklyExecution, publishWeeklyWorkUpdate,
    changeOverviewDateRange, openReadiness, saveConfig, createWeeklyOutline,
    generateCurrentPlanDetails, confirmWeeklyPlan,
  } = props;
  useEffect(() => {
    const openSettings = () => {
      setWeeklyPlanOpen(false);setWeeklyPlanDetailsOpen(false);setPlanHistoryOpen(false);setWorkspaceView('rules');
    };
    window.addEventListener(AGENT_SETTINGS_OPEN_EVENT, openSettings);
    return () => window.removeEventListener(AGENT_SETTINGS_OPEN_EVENT, openSettings);
  }, [setPlanHistoryOpen,setWeeklyPlanDetailsOpen,setWeeklyPlanOpen,setWorkspaceView]);
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
      : !goal
        ? "待创建"
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
      const item=items[0];
      openContentGenerationQueue({view:'tasks',taskId:item?.socialContentTaskId||undefined,contentId:item?.contentId||contentItemId||undefined});
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
      {goal && !viewGoalId && <Button data-growth-tour="weekly-task" onClick={() => setWeeklyPlanDetailsOpen(true)} icon={<CalendarRange size={15}/>}>查看当前周计划</Button>}
      <Button onClick={()=>setPlanHistoryOpen(true)} icon={<History size={15}/>}>历史计划</Button>
      <Button type="primary" loading={Boolean(busy)} onClick={()=>void controlWeeklyWork()} icon={!activeRun && (!goal || canCreateNextGoal) ? <CalendarRange size={15}/> : activeRun && !recoverableProductionTask && data.run?.status !== "paused" ? <Pause size={15}/> : <Play size={15}/>}>{weeklyControlLabel}</Button>
    </>;
    const sampleEnabled = workspaceView === 'today' && isBusinessOverviewSampleEnabled();
    const sampleWeekly = sampleEnabled ? businessOverviewSample(data).weekly : null;
    const weeklyCommandCenter = <Suspense fallback={deferredWorkspaceFallback}><WeeklyCommandCenter
      data={data}
      statusLabel={currentPlanStatusLabel}
      actions={weeklyPlanControls}
      feedback={weeklyActionFeedback}
      onMetricClick={goal ? metric => {
        setSelectedContentItemId("");
        if (metric === "waiting_review") { openContentGenerationQueue({view:'tasks',metric:'waiting_review',source:'weekly'}); return; }
        if (metric === "planned_videos" || metric === "planned_duration") { openContentGenerationQueue({view:'tasks',source:'weekly'}); return; }
        if (metric === "settled_cost") { setWorkspaceView("review"); return; }
        setWeeklyPlanDetailsOpen(true);
      } : undefined}
      notice={!activeRun && !viewGoalId && missingReferenceMasters.length > 0
        ? <><p className="mr-auto text-xs leading-5 text-text-secondary"><strong className="text-warning">参考不足：</strong>本周 {missingReferenceMasters.length} 条复刻视频尚未绑定通过逐镜精确分析的爆款参考，当前不能开始生产。先完成参考分析，再重新匹配计划。</p><Button size="small" onClick={() => onNavigate?.('inspirationMarket')}>查看爆款参考</Button></>
        : publishingSetupRequired
        ? <><p className="mr-auto text-xs leading-5 text-text-secondary"><strong className="text-warning">发布准备待完成：</strong>{publishingReadiness?.summary}。内容生产可以继续，系统不会把未连接账号当成已就绪。</p><Button size="small" onClick={openPublishingAccountSetup}>配置发布账号</Button></>
        : !activeRun && !viewGoalId && (missingProductMasters.length > 0 || detailGeneration?.status === "blocked")
        ? <p className="mr-auto text-xs leading-5 text-text-secondary">本周计划尚有制作条件未通过，请先查看计划与任务详情，补齐后再开始生产；系统不会把缺失证据视为已就绪。</p>
        : undefined}
    /></Suspense>;
    const sampleWeeklyPlan = sampleWeekly && <Suspense fallback={deferredWorkspaceFallback}><WeeklyCommandCenter data={data} statusLabel="执行中" actions={<>
      <Button icon={<CalendarRange size={15}/>} onClick={() => setSampleWeeklyPlanOpen(true)}>查看周计划</Button>
      <Button type="primary" disabled={Boolean(busy) || activeRun || Boolean(goal && !canCreateNextGoal) || Boolean(viewGoalId)} onClick={() => { setNewGoal(true); setWeeklyPlanOpen(true); }}>
        {goal ? '制定下一周计划' : '制定周计划'}
      </Button>
      <Tag color="processing">界面预览</Tag>
    </>} previewTotals={sampleWeekly}/></Suspense>;
    const dashboard = <Suspense fallback={deferredWorkspaceFallback}>{workspaceView === "rules"
      ? <OnboardingPanel initial={data.config} readiness={data.businessSnapshot?.readiness || []} busy={Boolean(busy)} mode="rules" initialSettingsOpen activeRun={activeRun} onOpenReadiness={openReadiness} onSave={(config) => void saveConfig(config)} />
      : <SmartBusinessDashboard data={data} view={dashboardView} selectedAccountId={selectedAccountId} selectedContentItemId={selectedContentItemId} overviewRangeBusy={busy === "overview-range"} onOverviewRangeChange={changeOverviewDateRange} onRefresh={() => void load()} onGenerateDetails={() => void generateCurrentPlanDetails()} onOpenContent={openContentProduction} onOpenAgentSettings={() => setWorkspaceView("rules")} onOpenProductionProgress={openProductionProgress} onBackToQueue={()=>{setSelectedContentItemId("");setWorkspaceView("overview");}} onRetryTask={async taskId => Boolean(await act(`retry:${taskId}`, () => digitalEmployeeApi.retryTask(taskId)))} onControlJob={async (jobId, action) => Boolean(await act(`execution:${jobId}:${action}`, () => digitalEmployeeApi.controlExecutionJob(jobId, action)))} onGeneratePlan={() => { void controlWeeklyWork(); }} onNavigate={page => {
          if (page === "socialPlanning") { void controlWeeklyWork(); return; }
          if (page === "socialAccounts") { openAccountConfiguration(); return; }
          onNavigate?.(page);
        }} />}</Suspense>;
    return (
      <>
      {weeklyStudioContentId && <WeeklyProductionStudioEntry data={data} contentId={weeklyStudioContentId} autoOpen onOpened={() => setWeeklyStudioContentId("")} onUnavailable={() => setWeeklyStudioContentId("")} />}
      {!weeklyPlanOpen && <div className="h-full overflow-y-auto bg-surface">
        <div className="mx-auto w-full px-2 py-3 sm:px-3">
          <h1 className="sr-only">{PAGE_REGISTRY.digitalEmployees.canonicalTitle}</h1>
          {workspaceView === "today" ? <BusinessOverviewLanding data={data} onRefresh={() => void load()} onNavigate={onNavigate} onOpenAccountHealth={() => setHealthDialogOpen(true)} weeklyPlan={sampleWeeklyPlan || weeklyCommandCenter} interpretation={sampleEnabled ? <BusinessOverviewSampleInterpretation/> : <Suspense fallback={deferredWorkspaceFallback}><BusinessInterpretation data={data} onViewReview={() => setWorkspaceView("review")}/></Suspense>}/> : <div className="grid grid-cols-1 overflow-hidden rounded-2xl border border-border bg-surface xl:grid-cols-[minmax(0,1.7fr)_minmax(360px,1fr)]"><div aria-label="当前周计划" className="min-w-0">{weeklyCommandCenter}</div>
            <aside aria-label="企业经营分" className="min-w-0 border-t border-border xl:border-l xl:border-t-0 [&_section]:rounded-none [&_section]:border-0"><BusinessHealthOverview summaryOnly data={data} selectedAccountId={selectedAccountId} overviewRangeBusy={busy === "overview-range"} onOverviewRangeChange={changeOverviewDateRange} onOpenAccountHealth={() => setHealthDialogOpen(true)}/></aside><Suspense fallback={deferredWorkspaceFallback}><BusinessInterpretation data={data} onViewReview={() => setWorkspaceView("review")}/></Suspense></div>}
          <div className="grid grid-cols-1 gap-4 pb-6 pt-2">
            <main className="min-w-0">
              {workspaceView !== "today" && workspaceView !== "rules" ? dashboard : null}
            </main>
          </div>
        </div>
      </div>}
      <Modal open={healthDialogOpen} title="账号健康与阶段目标" width={960} footer={null} destroyOnHidden onCancel={() => setHealthDialogOpen(false)}>
        <BusinessHealthOverview accountOnly data={data} selectedAccountId={selectedAccountId} onNavigate={page => {
          setHealthDialogOpen(false);
          if (page === 'socialAccounts') { openAccountConfiguration(); return; }
          onNavigate?.(page);
        }}/>
      </Modal>
      <Modal open={accountConfigurationOpen} title="配置经营账号" width={960} footer={null} destroyOnHidden onCancel={() => setAccountConfigurationOpen(false)}>
        <OnboardingPanel initial={data.config} readiness={data.businessSnapshot?.readiness || []} busy={Boolean(busy)} mode="rules" initialSettingsOpen activeRun={activeRun} onOpenReadiness={openReadiness}
          onSave={async config => { const saved = await saveConfig(config); if (saved) setAccountConfigurationOpen(false); }} />
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
        okText="确认周计划"
        cancelText="取消"
        confirmLoading={busy === "confirm-weekly-plan"}
        onCancel={() => setWeeklyStartDialogOpen(false)}
        onOk={() => {
          setWeeklyStartDialogOpen(false);
          void confirmWeeklyPlan();
        }}
      >
        <div className="space-y-4 py-2">
          <p className="text-sm leading-6 text-text-secondary">启动后，编导与内容 Agent 将按本周计划调用已配置的模型生成内容。纯产品内容不要求数字人形象；只有计划中确实包含人物口播时才检查人物与声音。</p>
          <p className="text-xs leading-5 text-text-muted">确认后系统会记录本次模型、Token 和实际费用；内容发布仍需单独确认。</p>
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
      <BusinessOverviewDetailDrawer detail={sampleWeeklyPlanOpen && sampleWeekly ? {
        title: '本周经营计划',
        summary: '当前页面的计划概览。制定周计划会进入实际编辑流程，预览数字不会写入业务数据。',
        preview: true,
        rows: [
          ['计划周期', `${sampleWeekly.startsAt} 至 ${sampleWeekly.endsAt}`],
          ['计划视频', `${sampleWeekly.plannedVideos} 条`],
          ['平台安排', 'TikTok 12 条 · Instagram 8 条 · Facebook 7 条 · YouTube 5 条'],
          ['视频总时长', `${sampleWeekly.durationSeconds} 秒`],
          ['待验收成片', `${sampleWeekly.waitingReview} 条`],
          ['制作成本范围', `¥${sampleWeekly.budgetMin}–${sampleWeekly.budgetMax}`],
          ['预计制作成本', `¥${sampleWeekly.estimatedCost.toFixed(2)}`],
          ['已结算成本', `¥${sampleWeekly.settledCost.toFixed(2)}`],
        ],
      } : null} onClose={() => setSampleWeeklyPlanOpen(false)}/>
      {onboardingWelcomeOpen && <OnboardingWelcome onClose={()=>setOnboardingWelcomeOpen(false)} />}
      </>
    );
}
