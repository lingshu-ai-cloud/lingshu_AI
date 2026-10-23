import BusinessHealthOverview from './smartBusiness/BusinessHealthOverview';
import { labels as sharedTaskLabels } from '../../shared/mobile-domain.mjs';
import { getScrollBehavior } from "../lib/usePrefersReducedMotion";
import { PAGE_REGISTRY, type Page } from "../pageRegistry";
import { readAgentCalendarReturnContext, registerAgentCalendarReturnState } from '../lib/agentCalendarReturnContext';
import { initialOperatingPlanFingerprint, initialPlanVideoPlans, initialPlanMatrixRows, type InitialOperatingPlan } from '../lib/initialOperatingPlan';
import { productionApi } from "../lib/productionApi";
import { presenterProductionGate, type PresenterProductionGate } from "../lib/shotProduction";
import { Alert, Button, Modal, Tabs } from 'antd';
import { taskNeedsAttention } from '../lib/taskExecutionState';
import { consumeBusinessPageContext, saveBusinessPageContext } from '../lib/businessPageNavigation';
import { defaultMatrixPlan } from '../lib/weeklyMatrix';
import { EMPTY_CONFIG } from './smartBusiness/digitalEmployeeConfigRules';
import { OnboardingPanel } from './smartBusiness/DigitalEmployeeOnboardingPanel';
import { GoalPanel, EMPTY_GOAL, contentPlatformLabel, type GoalDraft, type BusinessLine, type ContentPlatform } from './smartBusiness/WeeklyGoalPanel';
import { type OpenBusinessLink } from './smartBusiness/BatchFollowupTruthPanel';
import WeeklyStartConflictAlert from './WeeklyStartConflictAlert';
import WeeklyProductionStudioEntry from "./smartBusiness/WeeklyProductionStudioEntry";
import { type SmartOperationsAccount } from "./SmartOperationsAccountRail";
import PlanHistoryDialog from "./PlanHistoryDialog";
import { Suspense, useEffect, useRef, useState } from "react";
import { SmartBusinessDashboard, WeeklyCommandCenter, WeeklyPlanDetailsDrawer, BusinessInterpretation, WeeklyReviewPanel, deferredWorkspaceFallback } from './digitalEmployeeDeferredViews';
import {
  AlertTriangle,
  CalendarRange,
  ChevronLeft,
  History,
  Loader2,
  Pause,
  Play,
  XCircle,
} from "lucide-react";
import { authHeader, AUTH_TOKEN_CHANGED_EVENT } from "../lib/auth";
import { showActionFeedback, showActionSuccess } from "../lib/actionFeedback";
import { DigitalEmployeeApiError } from "../lib/digitalEmployeeApi";
import { confirmedWeeklyExecution, weeklyStartConflictFromError, weeklyStartResultNeedsReconciliation, type WeeklyStartConflict } from '../lib/weeklyStartValidation';
import {
  WEEKLY_WORK_UPDATED_EVENT,
  notifyWeeklyWorkUpdated,
  type WeeklyWorkUpdatedDetail,
} from "../lib/weeklyWorkEvents";
import { weeklyWorkStatus } from "../lib/weeklyWorkStatus";
import {
  buildTaskDeepLink,
  consumeDigitalEmployeeReturnContext,
  digitalEmployeeApi,
  dispatchDigitalEmployeeDeepLink,
  ENTERPRISE_FACTS_CHANGED_ERROR_CODE,
  enterpriseFactsRebuildInput,
  streamRunEvents,
  type BusinessDestination,
  type BusinessReadinessItem,
  type DigitalEmployeeConfig,
  type DigitalEmployeeDeepLink,
  type DigitalEmployeeOverview,
  type WeeklyGoal,
  type WorkflowTask,
} from "../lib/digitalEmployees";

const statusLabel: Record<string, string> = {
  ...sharedTaskLabels,
  draft: "待确认",
  active: "运行中",
  initializing: "初始化中",
  blocked: "等待处理",
  paused: "已暂停",
  planning: "规划中",
  running: "执行中",
  waiting_external: "等待业务回写",
  waiting_approval: "待审批",
  waiting_human: "人工接管",
  pending: "待执行",
  handed_off: "已接管",
  approved: "已批准",
  rejected: "已驳回",
};

const weeklyRunHeaderLabel: Record<string, string> = {
  failed: "执行失败",
  cancelled: "已取消",
  paused: "已暂停",
  waiting_external: "等待业务结果",
  waiting_approval: "待处理",
  waiting_human: "待处理",
  blocked: "待处理",
  queued: "准备中",
  planning: "准备中",
  initializing: "准备中",
  pending: "准备中",
  succeeded: "已完成",
  running: "执行中",
};

type WorkspaceView = "today" | "matrix" | "overview" | "live" | "review" | "rules";

function taskBusinessLine(task: WorkflowTask): BusinessLine {
  if (task.business_line) return task.business_line;
  const domain = String(task.business_domain || "").toLowerCase();
  if (domain === "customer") return "customer_conversion";
  if (["content", "publishing", "social", "industry"].includes(domain)) return "content_growth";
  return "full_funnel";
}

type OverviewPeriod = "week" | "lastWeek" | "month" | "lastMonth";

function overviewRange(period: OverviewPeriod) {
  const now = new Date();
  const end = new Date(now);
  const start = new Date(now);
  const weekday = (now.getDay() + 6) % 7;
  if (period === "week" || period === "lastWeek") {
    start.setDate(now.getDate() - weekday - (period === "lastWeek" ? 7 : 0));
    end.setDate(start.getDate() + 6);
    if (period === "week") end.setTime(now.getTime());
  } else {
    const offset = period === "lastMonth" ? -1 : 0;
    start.setFullYear(now.getFullYear(), now.getMonth() + offset, 1);
    end.setFullYear(now.getFullYear(), now.getMonth() + offset + 1, 0);
    if (period === "month") end.setTime(now.getTime());
  }
  const date = (value: Date) => value.toLocaleDateString("en-CA");
  return { startsAt: date(start), endsAt: date(end) };
}

const readinessDestination: Record<
  BusinessReadinessItem["key"],
  { page: BusinessDestination; view?: "create" | "publish" }
> = {
  enterprise: { page: "enterprise" },
  products: { page: "enterprise" },
  social_accounts: { page: "accountManagement" },
  viral_library: { page: "socialInspiration" },
  content_projects: { page: "smartAssets", view: "create" },
  customers: { page: "conversion" },
  automation: { page: "scheduled" },
};


function OnboardingWelcome({ onClose }: { onClose: () => void }) {
  return <Modal open title="准备工作已经完成" onCancel={onClose} width={480} footer={<Button type="primary" onClick={onClose}>开始使用灵枢</Button>}>
    <p className="py-4 text-sm leading-7 text-text-secondary">企业资料、产品表和社媒经营阶段都已保存。接下来可制定周计划，查看四位数字员工的执行进度与交付结果。</p>
  </Modal>;
}

export default function DigitalEmployeePage({
  active = true,
  onNavigate,
  onOpenMonitor,
  onViewResults,
  weeklyPlanNavigation,
}: {
  active?: boolean;
  onNavigate?: (page: Page) => void;
  onOpenMonitor?: () => void;
  onViewResults?: () => void;
  weeklyPlanNavigation?: { goalId: string; planId: string; requestId: number } | null;
}) {
  const [data, setData] = useState<DigitalEmployeeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [weeklyStartConflict, setWeeklyStartConflict] = useState<WeeklyStartConflict | null>(null);
  const [weeklyStartDialogOpen, setWeeklyStartDialogOpen] = useState(false);
  const [weeklyPresenterLoading, setWeeklyPresenterLoading] = useState(false);
  const [weeklyPresenterGate, setWeeklyPresenterGate] = useState<PresenterProductionGate>(() => presenterProductionGate(null));
  const [newGoal, setNewGoal] = useState(false);
  const [approvalNote, setApprovalNote] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedContentItemId, setSelectedContentItemId] = useState("");
  const [weeklyStudioContentId, setWeeklyStudioContentId] = useState("");
  useEffect(() => setWeeklyStudioContentId(""), [data?.goal?.id, data?.plan?.id, data?.run?.id]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [deliveryFocus, setDeliveryFocus] = useState<{ id: string; request: number }>();
  const [viewGoalId, setViewGoalId] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("today");
  const [businessLine, setBusinessLine] = useState<BusinessLine>("full_funnel");
  const [contentPlatform, setContentPlatform] = useState<ContentPlatform>("all");
  const calendarWorkspaceState = useRef({ workspaceView, selectedAccountId, businessLine, contentPlatform });
  calendarWorkspaceState.current = { workspaceView, selectedAccountId, businessLine, contentPlatform };
  const restoreCalendarWorkspace = (value: unknown) => {
    const saved = value as { workspaceView?: WorkspaceView; selectedAccountId?: string; businessLine?: BusinessLine; contentPlatform?: ContentPlatform } | null;
    if (saved && ['today', 'matrix', 'overview', 'live', 'review', 'rules'].includes(saved.workspaceView ?? '')) setWorkspaceView(saved.workspaceView!);
    if (typeof saved?.selectedAccountId === 'string') setSelectedAccountId(saved.selectedAccountId);
    if (saved?.businessLine && ['full_funnel', 'content_growth', 'customer_conversion'].includes(saved.businessLine)) setBusinessLine(saved.businessLine);
    if (saved?.contentPlatform && ['all', 'facebook', 'youtube', 'tiktok', 'instagram'].includes(saved.contentPlatform)) setContentPlatform(saved.contentPlatform);
  };
  useEffect(() => registerAgentCalendarReturnState('digitalEmployee.workspace', {
    read: () => calendarWorkspaceState.current,
    restore: restoreCalendarWorkspace,
  }), []);

  const [navigationNotice, setNavigationNotice] = useState("");
  const presenterConsentReturnRequested = Boolean(new URLSearchParams(window.location.search).get('presenterConsentReturn')?.trim());
  const [applicationGuideOpen, setApplicationGuideOpen] = useState(presenterConsentReturnRequested);
  const [applicationGuideEntry, setApplicationGuideEntry] = useState<"start" | "presenter">(presenterConsentReturnRequested ? "presenter" : "start");
  const [onboardingWelcomeOpen, setOnboardingWelcomeOpen] = useState(false);
  const [weeklyPlanOpen, setWeeklyPlanOpen] = useState(false);
  const [planHistoryOpen, setPlanHistoryOpen] = useState(false);
  const [weeklyPlanDetailsOpen, setWeeklyPlanDetailsOpen] = useState(false);
  const goalPanelRef = useRef<HTMLDivElement>(null);
  const overviewRequestVersionRef = useRef(0);
  const enterpriseFactsRecoveryRef = useRef(new Map<string, Promise<void>>());
  const [productionPeriod, setProductionPeriod] = useState<OverviewPeriod>("week");
  const productionRangeLoadingRef = useRef(false);
  const productionRangeRef = useRef<ReturnType<typeof overviewRange> | undefined>(undefined);
  const presentedData = data;
  const initialLoadRef = useRef<Promise<DigitalEmployeeOverview | undefined> | null>(null);
  const handledWeeklyPlanNavigation = useRef<number | null>(null);

  const openWeeklyStartConfirmation = async () => {
    setWeeklyStartDialogOpen(true);
    setWeeklyPresenterLoading(true);
    try {
      const defaults = await productionApi.defaults();
      setWeeklyPresenterGate(presenterProductionGate(defaults));
    } catch (cause) {
      setWeeklyPresenterGate({ ready: false, reason: 'selection_required', message: cause instanceof Error ? cause.message : '数字人形象状态读取失败，请稍后重试。' });
    } finally {
      setWeeklyPresenterLoading(false);
    }
  };

  useEffect(() => {
    let deferredOpen: number | undefined;
    const openGuide = (event?: Event) => {
      const requested = (event as CustomEvent<{ step?: string }> | undefined)?.detail?.step === 'presenter' ? 'presenter' : 'start';
      setApplicationGuideEntry(requested);
      setApplicationGuideOpen(true);
    };
    window.addEventListener('lingshu:open-digital-employee-guide', openGuide);
    if (active) try {
      const requested = sessionStorage.getItem('lingshu:open-digital-employee-guide');
      if (requested === 'true' || requested === 'presenter') {
        sessionStorage.removeItem('lingshu:open-digital-employee-guide');
        // React Activity reconnects passive effects before rc-dialog has a
        // stable focus handle. Open in the next task, after the retained page
        // has fully reconnected, so Ant never focuses its motion controller.
        deferredOpen = window.setTimeout(() => {
          setApplicationGuideEntry(requested === 'presenter' ? 'presenter' : 'start');
          setApplicationGuideOpen(true);
        }, 0);
      }
    } catch { /* storage can be unavailable */ }
    return () => {
      window.removeEventListener('lingshu:open-digital-employee-guide', openGuide);
      if (deferredOpen !== undefined) window.clearTimeout(deferredOpen);
    };
  }, [active]);

  const load = async (goalId = viewGoalId) => {
    const requestVersion = ++overviewRequestVersionRef.current;
    const authorization=authHeader().Authorization;
    try {
      const next = await digitalEmployeeApi.overview(goalId, productionRangeRef.current);
      if (requestVersion !== overviewRequestVersionRef.current || authorization!==authHeader().Authorization) return;
      setData(next);
      setWeeklyStartConflict((current) => next.run && current && (next.run.id === current.runId || next.goal?.id === current.goalId) ? null : current);
      if (next.goal?.businessLine && !readAgentCalendarReturnContext()?.states['digitalEmployee.workspace']) {
        setBusinessLine(next.goal.businessLine);
        setContentPlatform(
          next.goal.businessLine === "content_growth" && next.goal.contentPlatforms.length === 1
            ? next.goal.contentPlatforms[0]
            : "all",
        );
      }
      setError("");
      return next;
    } catch (loadError) {
      if(requestVersion!==overviewRequestVersionRef.current||authorization!==authHeader().Authorization)return;
      setError(loadError instanceof Error ? loadError.message : "加载失败");
    } finally {
      if(requestVersion===overviewRequestVersionRef.current&&authorization===authHeader().Authorization)setLoading(false);
    }
  };

  useEffect(() => {
    const refreshFromAssistant = (event: Event) => {
      const detail = (event as CustomEvent<WeeklyWorkUpdatedDetail>).detail;
      if (!detail || detail.source !== "assistant" || !detail.goalId?.trim()) return;
      const visibleGoalId = viewGoalId || data?.goal?.id || "";
      if (visibleGoalId && detail.goalId !== visibleGoalId) return;
      void load(viewGoalId || detail.goalId);
    };
    window.addEventListener(WEEKLY_WORK_UPDATED_EVENT, refreshFromAssistant);
    return () => window.removeEventListener(WEEKLY_WORK_UPDATED_EVENT, refreshFromAssistant);
  }, [viewGoalId, data?.goal?.id]);

  useEffect(()=>{let authorization=authHeader().Authorization;const clear=()=>{const next=authHeader().Authorization;if(next===authorization)return;authorization=next;overviewRequestVersionRef.current+=1;initialLoadRef.current=null;setData(null);setWeeklyStartConflict(null);setSelectedTaskId('');setSelectedContentItemId('');setSelectedAccountId('');setWeeklyPlanOpen(false);setPlanHistoryOpen(false);setWeeklyPlanDetailsOpen(false);setWorkspaceView('today');setBusinessLine('full_funnel');setContentPlatform('all');setViewGoalId('');productionRangeRef.current=undefined;setLoading(true);initialLoadRef.current=load('');};window.addEventListener(AUTH_TOKEN_CHANGED_EVENT,clear);window.addEventListener('storage',clear);return()=>{window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT,clear);window.removeEventListener('storage',clear);};},[]);

  useEffect(() => {
    const businessScope = consumeBusinessPageContext("production");
    const returnContext = consumeDigitalEmployeeReturnContext();
    const restoring = initialLoadRef.current !== null;
    // Activity reconnects effects on return; reuse the initial request and UI state.
    if (!initialLoadRef.current) initialLoadRef.current = load();
    let active = true;
    void initialLoadRef.current.then(next => {
      if (!active) return;
      const calendarReturnState = readAgentCalendarReturnContext()?.states['digitalEmployee.workspace'];
      if (calendarReturnState) { restoreCalendarWorkspace(calendarReturnState); return; }
      if (businessScope) {
        setWorkspaceView("overview");
        setBusinessLine(businessScope === "traffic" ? "content_growth" : "customer_conversion");
        setContentPlatform("all");
      }
      if (restoring || !returnContext || !next?.tasks.some(task => task.id === returnContext.taskId && task.run_id === returnContext.runId)) return;
      setWorkspaceView(returnContext.deliveryId ? "overview" : "live");
      setSelectedTaskId(returnContext.taskId);
      if (returnContext.deliveryId) setDeliveryFocus({ id: returnContext.deliveryId, request: Date.now() });
      setNavigationNotice(returnContext.deliveryId ? "已回到生产与交付，原交付记录已恢复。" : "已回到原任务的生产现场，运行与任务位置已恢复。");
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!weeklyPlanNavigation || handledWeeklyPlanNavigation.current === weeklyPlanNavigation.requestId) return;
    const target = weeklyPlanNavigation;
    const authorization = authHeader().Authorization;
    const requestVersion = ++overviewRequestVersionRef.current;
    let active = true;
    setWeeklyPlanOpen(false);
    setLoading(true);
    setError("");
    void (async () => {
      try {
        if (!target.goalId || !target.planId) throw new Error("周计划定位信息不完整，请重新加载灵小枢待办。");
        // Only open the signed current plan. A changed goal or plan must not
        // silently fall back to another editable plan or a cached history view.
        const next = await digitalEmployeeApi.overview();
        if (!active || requestVersion !== overviewRequestVersionRef.current || authorization !== authHeader().Authorization) return;
        if (next.goal?.id !== target.goalId || next.plan?.id !== target.planId) {
          throw new Error("目标周计划已更新或不再是当前计划，请重新加载灵小枢待办后再调整。");
        }
        setData(next);
        setViewGoalId("");
        setNewGoal(false);
        setPlanHistoryOpen(false);
        setShowHistory(false);
        setSelectedContentItemId("");
        setWorkspaceView("today");
        setWeeklyPlanOpen(false);
        showActionSuccess("已定位本周计划", "请先核对平台、产量、预算和排期，再确认开始生产。");
        handledWeeklyPlanNavigation.current = target.requestId;
      } catch (reason) {
        if (!active || requestVersion !== overviewRequestVersionRef.current || authorization !== authHeader().Authorization) return;
        setError(reason instanceof Error ? reason.message : "无法定位该周计划，请重新加载待办。");
        handledWeeklyPlanNavigation.current = target.requestId;
      } finally {
        if (active && requestVersion === overviewRequestVersionRef.current && authorization === authHeader().Authorization) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [weeklyPlanNavigation]);
  useEffect(() => {
    const run = data?.run;
    if (
      !data?.config ||
      viewGoalId ||
      !run ||
      ["succeeded", "failed", "cancelled"].includes(run.status)
    )
      return;
    const controller = new AbortController();
    const streamAuthorization=authHeader().Authorization;
    const after = Math.max(
      0,
      ...(data?.events || []).map((event) => Number(event.sequence) || 0),
    );
    void streamRunEvents(
      run.id,
      after,
      (event) => {
        if(controller.signal.aborted||streamAuthorization!==authHeader().Authorization)return;
        setData((current) =>
          current
            ? {
                ...current,
                events: current.events.some((item) => item.id === event.id)
                  ? current.events
                  : [...current.events, event],
              }
            : current,
        );
        if (productionRangeLoadingRef.current) return;
        const requestVersion = ++overviewRequestVersionRef.current;
        void digitalEmployeeApi
          .overview(undefined, productionRangeRef.current)
          .then((next) => {
            if (requestVersion === overviewRequestVersionRef.current&&streamAuthorization===authHeader().Authorization) setData(next);
          })
          .catch(() => {});
      },
      controller.signal,
    ).catch((streamError) => {
      if (!controller.signal.aborted&&streamAuthorization===authHeader().Authorization)
        setError(
          streamError instanceof Error ? streamError.message : "实时连接失败",
        );
    });
    return () => controller.abort();
  }, [Boolean(data?.config), data?.run?.id, data?.run?.status, viewGoalId]);

  useEffect(() => {
    const run = data?.run;
    if (
      !data?.config ||
      !["live", "matrix"].includes(workspaceView) ||
      viewGoalId ||
      !run ||
      ["succeeded", "failed", "cancelled", "paused"].includes(run.status)
    )
      return;
    const reconcile = () => {
      if (document.visibilityState !== "visible") return;
      const requestVersion = ++overviewRequestVersionRef.current;
      void digitalEmployeeApi
        .reconcileRun(run.id)
        .then((next) => {
          if (requestVersion === overviewRequestVersionRef.current) setData(next);
        })
        .catch(() => {
          /* SSE remains the primary live channel */
        });
    };
    const timer = window.setInterval(reconcile, 15_000);
    return () => window.clearInterval(timer);
  }, [data?.run?.id, data?.run?.status, viewGoalId, workspaceView]);

  const recoverEnterpriseFactsChanged = async (
    actionError: unknown,
    staleGoal: Pick<WeeklyGoal, "id" | "version"> | null | undefined,
  ): Promise<boolean> => {
    if (
      !(actionError instanceof DigitalEmployeeApiError)
      || actionError.code !== ENTERPRISE_FACTS_CHANGED_ERROR_CODE
      || !staleGoal
    ) return false;

    let rebuildInput: ReturnType<typeof enterpriseFactsRebuildInput>;
    try {
      rebuildInput = enterpriseFactsRebuildInput(staleGoal, actionError.details);
    } catch {
      return false;
    }
    const authorization = authHeader().Authorization;
    const recoveryKey = [
      authorization || "",
      staleGoal.id,
      rebuildInput.expectedGoalVersion,
      rebuildInput.sourcePlanId,
      rebuildInput.expectedFactsVersion,
      rebuildInput.expectedSourcePlanDigest,
    ].join("\u0000");
    const pending = enterpriseFactsRecoveryRef.current.get(recoveryKey);
    if (pending) {
      await pending;
      return true;
    }
    const recovery = (async () => {
      try {
        let rebuildAttempt = 0;
        let rebuilt: DigitalEmployeeOverview;
        while (true) {
          try {
            rebuilt = await digitalEmployeeApi.rebuildGoalFromLatestFacts(staleGoal.id, rebuildInput);
            break;
          } catch (rebuildError) {
            if (
              rebuildAttempt >= 1
              || !(rebuildError instanceof DigitalEmployeeApiError)
              || rebuildError.code !== ENTERPRISE_FACTS_CHANGED_ERROR_CODE
            ) throw rebuildError;
            // Enterprise facts changed again while the replacement was being
            // assembled. Retry this dedicated, idempotent rebuild once; never
            // replay the original save, approval, or launch action.
            rebuildAttempt += 1;
          }
        }
        if (authorization !== authHeader().Authorization) return;
        overviewRequestVersionRef.current += 1;
        setData(rebuilt);
        setError("");
        setViewGoalId("");
        setNewGoal(false);
        setPlanHistoryOpen(false);
        setShowHistory(false);
        setSelectedContentItemId("");
        setWorkspaceView("today");
        setWeeklyPlanOpen(false);
        showActionSuccess(
          "计划已按最新企业资料重建",
          "新版周计划已回到智能经营。请重新核对计划并确认开始生产；原保存、批准或启动操作没有自动重试。",
        );
      } catch (rebuildError) {
        if (authorization !== authHeader().Authorization) return;
        setError(rebuildError instanceof Error ? `计划自动重建失败：${rebuildError.message}` : "计划自动重建失败，请刷新后重试");
      }
    })();
    enterpriseFactsRecoveryRef.current.set(recoveryKey, recovery);
    try {
      await recovery;
    } finally {
      if (enterpriseFactsRecoveryRef.current.get(recoveryKey) === recovery) {
        enterpriseFactsRecoveryRef.current.delete(recoveryKey);
      }
    }
    return true;
  };

  const act = async (
    key: string,
    action: () => Promise<DigitalEmployeeOverview>,
    throwOnError = false,
  ): Promise<DigitalEmployeeOverview | null> => {
    const actionGoal = data?.goal;
    setBusy(key);
    setError("");
    try {
      const next = await action();
      // A completed mutation is authoritative and invalidates any older overview
      // refresh that may still be in flight.
      overviewRequestVersionRef.current += 1;
      setData(next);
      return next;
    } catch (actionError) {
      if (await recoverEnterpriseFactsChanged(actionError, actionGoal)) return null;
      setError(actionError instanceof Error ? actionError.message : "操作失败");
      if (throwOnError) throw actionError;
      return null;
    } finally {
      setBusy("");
    }
  };

  const goal = data?.goal;
  const visibleTasks = (data?.tasks || []).filter(
    (task) => businessLine === "full_funnel" || taskBusinessLine(task) === businessLine,
  );
  const activeTask = visibleTasks.find((task) =>
    [
      "running",
      "waiting_external",
      "waiting_approval",
      "handed_off",
      "failed",
    ].includes(task.status),
  );
  const selectedTask =
    visibleTasks.find((task) => task.id === selectedTaskId) ||
    activeTask ||
    visibleTasks.find((task) => task.status === "succeeded") ||
    visibleTasks[0];
  const terminal = Boolean(
    data?.run && ["succeeded", "failed", "cancelled"].includes(data.run.status),
  );
  const activeRun = Boolean(data?.run && !terminal);
  const canCreateNextGoal = Boolean(
    goal &&
      (["completed", "cancelled"].includes(goal.status) || terminal) &&
      (!data?.run || terminal),
  );
  const weeklyPlanningStage = !data?.config
    ? 'setup_required'
    : viewGoalId
      ? 'history'
      : activeRun
        ? 'running'
        : goal
          ? 'planned'
          : 'unplanned';
  const operatingState = !data?.config
      ? "首次配置中"
      : data.review?.status === "generated"
        ? "本周期待复盘"
        : "常态经营中";
  const cycleLabel = goal
      ? `${goal.startsAt} 至 ${goal.endsAt}`
      : "尚未制定周期目标";

  useEffect(() => {
    if (!activeRun) return;
    if (newGoal) setNewGoal(false);
    if (weeklyPlanOpen) setWeeklyPlanOpen(false);
  }, [activeRun, newGoal, weeklyPlanOpen]);

  useEffect(() => {
    const openWeeklyPlan = () => {
      setError("");
      if (!goal || canCreateNextGoal) {
        setNewGoal(true);
        setWeeklyPlanOpen(true);
        return;
      }
      setNewGoal(false);
      setWeeklyPlanOpen(false);
      setWorkspaceView("today");
      window.requestAnimationFrame(() => {
        document.querySelector('[aria-label="当前周计划"]')?.scrollIntoView({
          behavior: getScrollBehavior(),
          block: "start",
        });
      });
    };
    window.addEventListener('lingshu:open-weekly-plan', openWeeklyPlan);
    return () => window.removeEventListener('lingshu:open-weekly-plan', openWeeklyPlan);
  }, [canCreateNextGoal, goal?.id]);

  const selectedContentItem = selectedContentItemId
    ? data?.contentQueue?.items.find(item => item.id === selectedContentItemId)
    : undefined;
  useEffect(() => {
    const visibleGoalId = viewGoalId || goal?.id || '';
    const explicitlySelectedTask = selectedTaskId && selectedTask?.id === selectedTaskId ? selectedTask : undefined;
    const viewLabel = workspaceView === 'today'
      ? '经营总览'
      : workspaceView === 'matrix'
        ? '数字员工排期'
        : workspaceView === 'rules'
          ? 'Agent 设置'
          : workspaceView === 'review'
            ? '数据复盘'
            : workspaceView === 'live' && selectedContentItem
              ? '内容制作进度'
              : '任务运行状态';
    const focusSummary = selectedContentItem
      ? `当前打开内容“${selectedContentItem.title}”，制作状态为${selectedContentItem.stage || selectedContentItem.status}。优先回答这条内容的进度、缺项与恢复方式。`
      : explicitlySelectedTask
        ? `当前查看任务“${explicitlySelectedTask.title}”，状态为${statusLabel[explicitlySelectedTask.status] || explicitlySelectedTask.status}。优先回答该任务的下一步。`
        : goal
          ? `当前查看${viewGoalId ? '历史' : '本周'}计划“${goal.title}”的${viewLabel}。`
          : `当前在${viewLabel}，本周还没有计划。应先帮助用户制定并预览周计划，确认后才能开始生产。`;
    window.dispatchEvent(new CustomEvent('lingshu-assistant-context', {
      detail: {
        sourcePage: 'digitalEmployees',
        agent: 'strategy',
        label: viewLabel,
        summary: focusSummary,
        suggestions: selectedContentItem
          ? ['这条内容现在做到哪一步', '还缺什么才能继续', '从当前节点继续制作']
          : explicitlySelectedTask
            ? ['这个任务为什么停住', '告诉我下一步怎么处理', '核对当前真实状态']
            : weeklyPlanningStage === 'unplanned'
              ? ['帮我制定本周计划', '计划里会包含什么', '开始前还缺什么']
              : weeklyPlanningStage === 'running'
                ? ['查看当前进度', '查看数字员工排期', '查看需要我处理的任务']
                : ['查看当前经营重点', '核对本周计划范围', '查看需要我处理的事项'],
        workflowStage: weeklyPlanningStage,
        goalId: visibleGoalId,
        planId: data?.plan?.id || '',
        runId: data?.run?.id || '',
        taskId: explicitlySelectedTask?.id || selectedContentItem?.taskId || '',
        contentId: selectedContentItem?.contentId || selectedContentItem?.id || '',
        viewKey: workspaceView,
      },
    }));
  }, [
    data?.plan?.id,
    data?.run?.id,
    goal?.id,
    goal?.title,
    selectedContentItem?.contentId,
    selectedContentItem?.id,
    selectedContentItem?.stage,
    selectedContentItem?.status,
    selectedContentItem?.taskId,
    selectedContentItem?.title,
    selectedTask?.id,
    selectedTask?.status,
    selectedTask?.title,
    selectedTaskId,
    viewGoalId,
    weeklyPlanningStage,
    workspaceView,
  ]);

  const requestOverviewRange = (nextRange: ReturnType<typeof overviewRange>, period?: OverviewPeriod) => {
    const version = ++overviewRequestVersionRef.current;
    productionRangeLoadingRef.current = true;
    setBusy("overview-range");
    setError("");
    void digitalEmployeeApi.overview(viewGoalId, nextRange)
      .then(next => {
        if (version !== overviewRequestVersionRef.current) return;
        productionRangeRef.current = nextRange;
        if (period) setProductionPeriod(period);
        setData(next);
      })
      .catch(rangeError => {
        if (version === overviewRequestVersionRef.current) setError(rangeError instanceof Error ? rangeError.message : "经营数据加载失败");
      })
      .finally(() => {
        if (version !== overviewRequestVersionRef.current) return;
        productionRangeLoadingRef.current = false;
        setBusy("");
      });
  };

  const changeOverviewPeriod = (period: OverviewPeriod) => requestOverviewRange(overviewRange(period), period);
  const changeOverviewDateRange = (range: { startsAt: string; endsAt: string }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(range.startsAt) || !/^\d{4}-\d{2}-\d{2}$/.test(range.endsAt) || range.startsAt > range.endsAt) return;
    requestOverviewRange(range);
  };

  const scrollTo = (target: React.RefObject<HTMLDivElement | null>) => {
    window.setTimeout(
      () =>
        target.current?.scrollIntoView({ behavior: getScrollBehavior(), block: "start" }),
      50,
    );
  };

  const openBusiness: OpenBusinessLink = (page, view, businessRef = {}) => {
    const planTask = data?.plan?.tasks?.find(
      (item) =>
        item.destination === page && (!view || item.destinationView === view),
    );
    const task = data?.tasks.find((item) => item.task_key === planTask?.key);
    const base = task
      ? buildTaskDeepLink(task, planTask, data?.run?.id || task.run_id)
      : null;
    const link: DigitalEmployeeDeepLink = base
      ? {
          ...base,
          page,
          view,
          businessRef: { ...base.businessRef, ...businessRef },
        }
      : {
          page,
          view,
          runId: data?.run?.id || "",
          taskId: "",
          businessRef: {
            taskKey: planTask?.key || String(businessRef.taskKey || ""),
            businessDomain: planTask?.businessDomain,
            capabilityKey: planTask?.capabilityKey,
            statusSource: planTask?.statusSource,
            ...businessRef,
          },
        };
    if (typeof window !== "undefined") dispatchDigitalEmployeeDeepLink(link);
    else onNavigate?.(page);
  };

  const openReadiness = (item: BusinessReadinessItem) => {
    const target = readinessDestination[item.key];
    openBusiness(target.page, target.view, {
      taskKey: "context_readiness",
      readinessKey: item.key,
      readinessStatus: item.status,
    });
  };

  const saveConfig = async (config: DigitalEmployeeConfig & { minimalOnboarding?: true; brandName?: string; initialPlan?: InitialOperatingPlan }) => {
    const firstLogin = !data?.config;
    const createInitialPlan = Boolean(config.initialPlan && firstLogin && !data?.goal && !activeRun);
    let recoveryGoal = data?.goal;
    setBusy(createInitialPlan ? "initial-plan" : "config");
    setError("");
    overviewRequestVersionRef.current += 1;
    try {
      const next = await digitalEmployeeApi.completeOnboarding(config);
      recoveryGoal = next.goal || recoveryGoal;
      if (createInitialPlan && config.initialPlan) {
        const plan = config.initialPlan;
        const planFingerprint = initialOperatingPlanFingerprint(plan);
        const fingerprintConstraint = `首次计划校验：${planFingerprint}`;
        if (!next.config) throw new Error("新手引导配置尚未保存，无法创建首次计划");
        if (next.goal) {
          if (!next.goal.constraints.includes(fingerprintConstraint)) {
            throw new Error("已存在另一版首次计划，不能用当前修改覆盖。请恢复原计划后重试，或在经营页面新建计划。");
          }
          const existingPreparation = await digitalEmployeeApi.initialPreparation(next.goal.id);
          if (existingPreparation.preparation) {
            const resumed = await digitalEmployeeApi.overview(next.goal.id);
            overviewRequestVersionRef.current += 1;
            setData(resumed);
            setWorkspaceView("today");
            setNewGoal(false);
            setWeeklyPlanOpen(false);
            setOnboardingWelcomeOpen(false);
            return true;
          }
        }
        const videoPlans = initialPlanVideoPlans(plan, next.config);
        const created = next.goal ? next : await digitalEmployeeApi.createGoal({
            ...EMPTY_GOAL,
            businessLine: "content_growth",
            title: "首次推荐经营计划",
            objective: `为 ${plan.products.join("、")} 制作 ${plan.count} 条面向 ${plan.market} 的视频`,
            contentPlatforms: plan.platforms,
            target: plan.count,
            unit: "条",
            scope: plan.market,
            endsAt: plan.deliveryDate,
            constraints: [`制作预算上限：${plan.budgetCapCny} 元`, "真实发布前绑定账号并取得授权", fingerprintConstraint],
            videoPlans,
          });
        recoveryGoal = created.goal || recoveryGoal;
        if (!created.goal) throw new Error("推荐计划创建失败");
        const draftPackage = created.plan?.businessPackage;
        if (!draftPackage?.directorPlan) throw new Error("推荐计划缺少可执行任务包或编导预算");
        const saved = await digitalEmployeeApi.savePackage(created.goal.id, {
          ...draftPackage,
          matrixPlan: initialPlanMatrixRows(plan, next.config),
          tasks: draftPackage.tasks.map(task => task.templateId === "production" ? { ...task, videoPlans } : task),
          directorPlan: {
            ...draftPackage.directorPlan,
            originalTarget: videoPlans.length,
            platformVersionTarget: videoPlans.length,
            publishTarget: videoPlans.length,
            productionBudget: plan.budgetCapCny,
            productionBudgetMax: plan.budgetCapCny,
            productionBudgetMin: Math.min(draftPackage.directorPlan.productionBudgetMin || 0, plan.budgetCapCny),
          },
        });
        const savedRevision = saved.plan?.businessPackage?.revision;
        if (!savedRevision) throw new Error("已确认计划版本未保存");
        const initialRequestId = `initial-${created.goal.id.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 80)}`;
        await digitalEmployeeApi.startInitialPreparation(created.goal.id, savedRevision, plan, initialRequestId);
        const refreshed = await digitalEmployeeApi.overview(created.goal.id);
        overviewRequestVersionRef.current += 1;
        setData(refreshed);
        setWorkspaceView("today");
        setNewGoal(false);
        setWeeklyPlanOpen(false);
        setOnboardingWelcomeOpen(false);
        return true;
      }
      overviewRequestVersionRef.current += 1;
      setData(next);
      if (firstLogin) {
        setWorkspaceView("today");
        setNewGoal(!next.goal);
        setOnboardingWelcomeOpen(true);
        window.setTimeout(() => window.dispatchEvent(new CustomEvent('lingshu-assistant-say', {
          detail: { message: '欢迎加入灵枢！准备工作已经完成，接下来我会陪你和四位数字员工一起开始经营。', durationMs: 10_000 },
        })), 350);
        scrollTo(goalPanelRef);
      } else {
        showActionSuccess("设置已保存", "新的经营设置会从下一轮计划开始生效。");
      }
      return true;
    } catch (configError) {
      if (await recoverEnterpriseFactsChanged(configError, recoveryGoal)) {
        if (config.minimalOnboarding) throw configError;
        return false;
      }
      setError(configError instanceof Error ? configError.message : createInitialPlan ? "推荐计划制作准备失败" : "设置保存失败");
      // The flow owns its inline error; don't replace an actionable server
      // rejection with a boolean and a generic "try later" message.
      if (config.minimalOnboarding) throw configError;
      return false;
    } finally {
      setBusy("");
    }
  };

  const saveGoal = async (goalInput: GoalDraft) => {
    const next = await act("goal", () =>
      digitalEmployeeApi.createGoal(goalInput),
    );
    if (next) {
      setNewGoal(false);
      setWorkspaceView("live");
      showActionSuccess("周任务已生成 👏", "四位数字员工会按确认后的计划开始推进。");
    }
  };

  const createWeeklyOutline = async (goalInput: GoalDraft) => {
    setBusy("create-weekly-plan");
    setError("");
    try {
      const created = await digitalEmployeeApi.createGoal(goalInput);
      if (!created.goal) throw new Error("周计划未能创建，请重试。");
      overviewRequestVersionRef.current += 1;
      setData(created);
      setNewGoal(false);
      setWeeklyPlanOpen(false);
      setWorkspaceView("today");
      showActionSuccess("周计划已生成", "计划已显示在智能经营首页。核对平台、产量、预算和排期后，再确认开始生产。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "周目标生成失败");
      await load();
    } finally {
      setBusy("");
    }
  };

  const generateCurrentPlanDetails = async () => {
    if (!goal || busy) return;
    const next = await act("generate-plan-details", () => digitalEmployeeApi.generatePackageDetails(goal.id));
    if (!next) return;
    const detail = next.plan?.businessPackage?.detailGeneration;
    if (detail?.status === 'ready') showActionSuccess("任务详情已生成", detail.blockedCount
      ? `${detail.readyCount} 条视频可以开始；${detail.blockedCount} 条只在缺少动态产品/工厂视频等对应镜头处等待，不影响其他内容。`
      : "爆款参考、素材组合和编导分镜已经保存，刷新页面也不会丢失。");
    else showActionSuccess("制作准备已完成", `有 ${detail?.blockedCount || 0} 条任务需要先补素材、授权或预算。`);
  };

  const reportWeeklyStartFailure = (message: string) => {
    setError(message);
    showActionFeedback({
      title: "周任务未启动",
      description: message,
      tone: "error",
    });
  };

  const publishWeeklyWorkUpdate = (next: DigitalEmployeeOverview) => {
    const updatedGoal = next.goal;
    if (!updatedGoal) return;
    const run = next.run;
    const tasks = run ? next.tasks.filter((task) => task.run_id === run.id) : [];
    notifyWeeklyWorkUpdated({
      source: "page",
      goalId: updatedGoal.id,
      ...(run && run.goal_id === updatedGoal.id && tasks.length > 0 && Number.isFinite(Date.parse(run.started_at))
        ? {
            execution: {
              goalId: updatedGoal.id,
              runId: run.id,
              status: run.status,
              taskCount: tasks.length,
              startedAt: run.started_at,
            },
          }
        : {}),
    });
  };

  const presentConfirmedWeeklyExecution = (next: DigitalEmployeeOverview, goalId: string) => {
    const execution = confirmedWeeklyExecution(next, goalId);
    if (!execution) return false;
    overviewRequestVersionRef.current += 1;
    setData(next);
    publishWeeklyWorkUpdate(next);
    setWeeklyPlanOpen(false);
    setNewGoal(false);
    const launchedStatus = weeklyWorkStatus(next);
    setWorkspaceView(launchedStatus?.phase === "running" || launchedStatus?.phase === "queued" ? "matrix" : "live");
    setSelectedTaskId(launchedStatus?.currentTaskId || execution.tasks[0]?.id || "");
    const feedbackTone = launchedStatus?.phase === "running" || (launchedStatus?.phase === "finished" && launchedStatus.outcome === "succeeded")
      ? "success"
      : launchedStatus?.phase === "finished" && launchedStatus.outcome === "failed"
        ? "error"
        : launchedStatus?.phase === "queued"
          ? "info"
          : "warning";
    showActionFeedback({
      title: launchedStatus?.title || "本周任务运行状态待确认",
      description: launchedStatus?.description || "真实运行已建立，请查看生产进度。",
      tone: feedbackTone,
    });
    return true;
  };

  const confirmWeeklyPlan = async () => {
    if (busy) return;
    if (!goal) {
      reportWeeklyStartFailure("尚未创建本周目标，请先完成目标设置。");
      return;
    }
    if (!data?.plan?.businessPackage) {
      reportWeeklyStartFailure("本周计划尚未生成完整，请刷新后重试。");
      return;
    }
    setBusy("confirm-weekly-plan");
    setError("");
    setWeeklyStartConflict(null);
    let launchRequestSent = false;
    try {
      // Preparation is runtime work. Only the server decides whether this exact
      // revision can start; missing media or publishing accounts are not UI gates.
      launchRequestSent = true;
      const next = await digitalEmployeeApi.approveGoal(goal.id, data.plan.businessPackage.revision);
      if (!presentConfirmedWeeklyExecution(next, goal.id)) {
        throw new Error("启动结果未返回可确认的真实运行；系统不会自动重复提交同一周计划。");
      }
    } catch (actionError) {
      if (await recoverEnterpriseFactsChanged(actionError, goal)) return;
      const conflict = weeklyStartConflictFromError(actionError);
      if (conflict) {
        setError("");
        setWeeklyStartConflict(conflict);
        showActionFeedback({
          title: "周任务未启动",
          description: `${conflict.goalTitle || "另一轮周任务"}正在执行；请先查看该运行。本轮计划没有被重复启动。`,
          tone: "error",
        });
        return;
      }
      if (launchRequestSent && weeklyStartResultNeedsReconciliation(actionError)) {
        try {
          const reconciled = await digitalEmployeeApi.overview(goal.id);
          if (presentConfirmedWeeklyExecution(reconciled, goal.id)) return;
        } catch {
          // A failed read cannot prove whether the mutating request was accepted.
        }
        const message = "启动请求已经发出，但暂未取得可确认的运行回执。系统已执行一次只读核对，不会自动重复启动；请稍后刷新查看。";
        setError(message);
        showActionFeedback({ title: "启动结果待确认", description: message, tone: "warning" });
        return;
      }
      reportWeeklyStartFailure(actionError instanceof Error ? actionError.message : "周任务启动失败");
    } finally {
      setBusy("");
    }
  };

  const goLive = async (taskId?: string, deliveryId?: string) => {
    let nextData = data;
    let targetTask = taskId ? nextData?.tasks.find((task) => task.id === taskId) : undefined;
    // Opening a blocked Agent task is also an explicit retry from the product UI.
    // Reconcile first so newly available configuration can prepare the canonical
    // business resource before the user reaches its workbench.
    if (targetTask && data?.run?.id && ['waiting_external', 'pending'].includes(targetTask.status)) {
      try {
        nextData = await digitalEmployeeApi.reconcileRun(data.run.id);
        setData(nextData);
        targetTask = nextData.tasks.find((task) => task.id === taskId);
      } catch (reconcileError) {
        setError(reconcileError instanceof Error ? reconcileError.message : 'Agent 任务重试失败');
      }
    }
    if (targetTask && !deliveryId && !['content_production', 'content_quality_gate'].includes(targetTask.task_key)) {
      const planTask = nextData?.plan?.tasks.find((task) => task.key === targetTask!.task_key);
      dispatchDigitalEmployeeDeepLink(buildTaskDeepLink(targetTask, planTask, nextData?.run?.id || targetTask.run_id));
      return;
    }
    setDeliveryFocus(deliveryId ? { id: deliveryId, request: Date.now() } : undefined);
    if (taskId) setSelectedTaskId(taskId);
    else if (
      data?.tasks.find(
        (task) => taskNeedsAttention(task),
      )
    )
      setSelectedTaskId(
        data.tasks.find(
          (task) => taskNeedsAttention(task),
        )!.id,
      );
    setWorkspaceView(deliveryId ? "overview" : "live");
  };

  const openGoal = async (goalId: string) => {
    setViewGoalId(goalId);
    setSelectedTaskId("");
    setShowHistory(false);
    await load(goalId);
  };
  const returnToLatest = async () => {
    setViewGoalId("");
    setSelectedTaskId("");
    await load("");
  };

  if (loading)
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <Loader2 size={24} className="animate-spin text-accent" />
      </div>
    );

  if (data?.config) {
    const dashboardView = workspaceView === "matrix"
      ? "matrix"
      : workspaceView === "overview"
        ? "review"
        : workspaceView === "live"
          ? selectedContentItemId ? "production" : "review"
          : workspaceView === "review" ? "review" : "home";
    const views: Array<{ id: "today" | "matrix" | "review"; label: string; caption: string }> = [
      { id: "today", label: "经营总览", caption: "资产健康度与下一轮建议" },
      { id: "matrix", label: "数字员工", caption: "Agent 职责与工作排期" },
      { id: "review", label: "数据复盘", caption: "账号、询盘与投流明细" },
    ];
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
    const currentMatrix = data.plan?.businessPackage?.matrixPlan || [];
    const plannedAccountTaskCounts = currentVideoPlans.reduce<Record<string, number>>((counts, plan) => {
      const accountId = plan.matrix?.accountId;
      if (accountId) counts[accountId] = (counts[accountId] || 0) + 1;
      return counts;
    }, {});
    const queuedAccountTaskCounts = (data.contentQueue?.items || []).reduce<Record<string, number>>((counts, item) => {
      if (item.accountId) counts[item.accountId] = (counts[item.accountId] || 0) + 1;
      return counts;
    }, {});
    const accountTaskCounts = Object.keys({ ...plannedAccountTaskCounts, ...queuedAccountTaskCounts }).reduce<Record<string, number>>((counts, accountId) => {
      counts[accountId] = Math.max(plannedAccountTaskCounts[accountId] || 0, queuedAccountTaskCounts[accountId] || 0);
      return counts;
    }, {});
    const matrixPlatforms = goal?.contentPlatforms?.length
      ? goal.contentPlatforms
      : data.config.publishingTargets.length
        ? [...new Set(data.config.publishingTargets.map(target => target.platform))]
        : (["youtube", "tiktok", "instagram", "facebook"] as const).slice();
    const accountMatrixForRail = currentMatrix.length
      ? currentMatrix
      : defaultMatrixPlan(data.config, [...matrixPlatforms], goal?.objective || "验证本周内容方向并获得有效询盘");
    const matrixRoleLabels: Record<string, string> = {
      brand_capability: "品牌能力号",
      buyer_advisor: "买家顾问号",
      brand_combined: "品牌综合账号",
    };
    const publishingTargets = data.config.publishingTargets;
    const smartOperationsAccounts: SmartOperationsAccount[] = accountMatrixForRail.map(row => {
      const connected = publishingTargets.find(target => target.accountId === row.accountId && target.platform === row.platform);
      return {
        platform: row.platform,
        accountId: row.accountId,
        accountLabel: connected?.accountLabel || `${contentPlatformLabel[row.platform]} · ${matrixRoleLabels[row.accountRole || "brand_combined"]}`,
        connected: Boolean(connected),
      };
    });
    const openConflictingRun = async () => {
      const conflict = weeklyStartConflict;
      if (!conflict) return;
      if (!conflict.goalId) {
        onOpenMonitor?.();
        return;
      }
      setViewGoalId(conflict.goalId);
      setSelectedTaskId("");
      setShowHistory(false);
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
      {!weeklyPlanOpen && <div className="h-full overflow-y-auto bg-white">
        <div className="mx-auto w-full px-2 py-3 sm:px-3">
          <h1 className="sr-only">{PAGE_REGISTRY.digitalEmployees.canonicalTitle}</h1>
          <div className="grid grid-cols-1 overflow-hidden rounded-2xl border border-border bg-white xl:grid-cols-[minmax(0,1.7fr)_minmax(360px,1fr)]"><div aria-label="当前周计划" className="min-w-0">
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
            /></Suspense> : <><section className="overflow-hidden rounded-lg border border-border bg-white"><div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4"><div className="max-w-2xl"><p className="text-xs font-semibold text-accent">周经营计划</p><p className="mt-1 text-sm font-bold text-slate-800">本周还没有计划</p><p className="mt-1 text-xs leading-5 text-slate-500">先制定并预览周计划。计划会说明本周做什么、在哪些平台生产、产量、预计预算和工作排期；确认前不会开始生产。</p></div><div aria-label="智能经营控制" className="flex max-w-full flex-wrap items-center justify-end gap-2">{weeklyPlanControls}</div></div></section>{weeklyActionFeedback && <div className="border-b border-border px-4 py-2.5">{weeklyActionFeedback}</div>}</>}
          </div>
          <aside aria-label="企业经营分" className="min-w-0 border-t border-border xl:border-l xl:border-t-0 [&_section]:rounded-none [&_section]:border-0"><BusinessHealthOverview summaryOnly data={data} selectedAccountId={selectedAccountId} overviewRangeBusy={busy === "overview-range"} onOverviewRangeChange={changeOverviewDateRange}/></aside><Suspense fallback={deferredWorkspaceFallback}><BusinessInterpretation data={data} onViewReview={() => setWorkspaceView("review")}/></Suspense></div>
          <Tabs className="mt-3" aria-label="智能经营视图" activeKey={workspaceView === "live" || workspaceView === "overview" ? "review" : workspaceView} onChange={key => {setWorkspaceView(key as WorkspaceView); setSelectedContentItemId("");}} items={views.map(view => ({key: view.id, label: view.label}))}/>
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
        </div>
      </div>}
      {active && applicationGuideOpen && (
        <OnboardingPanel
          initial={data.config}
          readiness={data.businessSnapshot?.readiness || []}
          busy={Boolean(busy)}
          allowInitialPlan={false}
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
      {weeklyPlanOpen && (!goal || newGoal) && !activeRun && <div className="h-full overflow-y-auto bg-white">
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

  return (
    <div className="workspace-canvas digital-employee-page">
      <div className="workspace-frame">
        <header className="workspace-header">
          <h1 className="workspace-title mt-2">数字员工正在等待调遣</h1>
          <div className="mt-5 inline-flex items-center gap-2 border-l-2 border-accent bg-surface-2 px-3 py-2 text-xs font-semibold text-accent">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] text-text-primary">1</span>
            {operatingState}
          </div>
        </header>
        {navigationNotice && (
          <div role="status" className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-800">
            <span className="flex items-center gap-2"><ChevronLeft size={15} />{navigationNotice}</span>
            <Button className="!h-auto min-h-9 !whitespace-normal" htmlType="button" onClick={() => setNavigationNotice("")} aria-label="关闭返回提示">
              <XCircle size={16} />
            </Button>
          </div>
        )}
        {error && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span className="flex items-center gap-2"><AlertTriangle size={16} />{error}</span>
            <Button className="!h-auto min-h-9 !whitespace-normal" onClick={() => setError("")}><XCircle size={17} /></Button>
          </div>
        )}
        <OnboardingPanel
          initial={EMPTY_CONFIG}
          readiness={data?.businessSnapshot?.readiness || []}
          busy={Boolean(busy)}
          onOpenReadiness={openReadiness}
          onNavigate={(page) => openBusiness(page)}
          onSave={saveConfig}
        />
      </div>
    </div>
  );
}
