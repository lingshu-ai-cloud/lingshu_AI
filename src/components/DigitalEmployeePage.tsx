import { getScrollBehavior } from "../lib/usePrefersReducedMotion";
import { type Page } from "../pageRegistry";
import { readAgentCalendarReturnContext, registerAgentCalendarReturnState } from '../lib/agentCalendarReturnContext';
import { productionApi } from "../lib/productionApi";
import { presenterProductionGate, type PresenterProductionGate } from "../lib/shotProduction";
import { Button } from 'antd';
import { consumeBusinessPageContext, saveBusinessPageContext } from '../lib/businessPageNavigation';
import { EMPTY_CONFIG } from './smartBusiness/digitalEmployeeConfigRules';
import { OnboardingPanel } from './smartBusiness/DigitalEmployeeOnboardingPanel';
import { type GoalDraft, type BusinessLine, type ContentPlatform } from './smartBusiness/WeeklyGoalPanel';
import { createDigitalEmployeeConfigurationAction } from './digitalEmployeeConfigurationAction';
import { createDigitalEmployeeFactRecovery } from './digitalEmployeeFactRecovery';
import { createDigitalEmployeeWeeklyLaunch } from './digitalEmployeeWeeklyLaunch';
import { ConfiguredDigitalEmployeeWorkspace, statusLabel, type WorkspaceView } from './ConfiguredDigitalEmployeeWorkspace';
import { type OpenBusinessLink } from './smartBusiness/BatchFollowupTruthPanel';
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  Loader2,
  XCircle,
} from "lucide-react";
import { authHeader, AUTH_TOKEN_CHANGED_EVENT } from "../lib/auth";
import { showActionSuccess } from "../lib/actionFeedback";
import { type WeeklyStartConflict } from '../lib/weeklyStartValidation';
import {
  WEEKLY_WORK_UPDATED_EVENT,
  type WeeklyWorkUpdatedDetail,
} from "../lib/weeklyWorkEvents";
import {
  buildTaskDeepLink,
  consumeDigitalEmployeeReturnContext,
  digitalEmployeeApi,
  dispatchDigitalEmployeeDeepLink,
  streamRunEvents,
  type BusinessDestination,
  type BusinessReadinessItem,
  type DigitalEmployeeDeepLink,
  type DigitalEmployeeOverview,
  type WorkflowTask,
} from "../lib/digitalEmployees";

function taskBusinessLine(task: WorkflowTask): BusinessLine {
  if (task.business_line) return task.business_line;
  const domain = String(task.business_domain || "").toLowerCase();
  if (domain === "customer") return "customer_conversion";
  if (["content", "publishing", "social", "industry"].includes(domain)) return "content_growth";
  return "full_funnel";
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
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedContentItemId, setSelectedContentItemId] = useState("");
  const [weeklyStudioContentId, setWeeklyStudioContentId] = useState("");
  useEffect(() => setWeeklyStudioContentId(""), [data?.goal?.id, data?.plan?.id, data?.run?.id]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [viewGoalId, setViewGoalId] = useState("");
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
  const overviewRequestVersionRef = useRef(0);
  const enterpriseFactsRecoveryRef = useRef(new Map<string, Promise<void>>());
  const productionRangeLoadingRef = useRef(false);
  const productionRangeRef = useRef<{ startsAt: string; endsAt: string } | undefined>(undefined);
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

  const recoverEnterpriseFactsChanged = createDigitalEmployeeFactRecovery({
    pending: enterpriseFactsRecoveryRef.current,
    overviewRequestVersionRef,
    setData, setError, setViewGoalId, setNewGoal, setPlanHistoryOpen,
    setSelectedContentItemId, setWorkspaceView, setWeeklyPlanOpen,
  });

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

  const requestOverviewRange = (nextRange: { startsAt: string; endsAt: string }) => {
    const version = ++overviewRequestVersionRef.current;
    productionRangeLoadingRef.current = true;
    setBusy("overview-range");
    setError("");
    void digitalEmployeeApi.overview(viewGoalId, nextRange)
      .then(next => {
        if (version !== overviewRequestVersionRef.current) return;
        productionRangeRef.current = nextRange;
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

  const changeOverviewDateRange = (range: { startsAt: string; endsAt: string }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(range.startsAt) || !/^\d{4}-\d{2}-\d{2}$/.test(range.endsAt) || range.startsAt > range.endsAt) return;
    requestOverviewRange(range);
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

  const saveConfig = createDigitalEmployeeConfigurationAction({
    data, activeRun, overviewRequestVersionRef, setBusy, setError, setData,
    setWorkspaceView, setNewGoal, setWeeklyPlanOpen, setOnboardingWelcomeOpen,
    recoverEnterpriseFactsChanged,
  });

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

  const { confirmWeeklyPlan, presentConfirmedWeeklyExecution, publishWeeklyWorkUpdate } = createDigitalEmployeeWeeklyLaunch({
    data, busy, overviewRequestVersionRef, setData, setBusy, setError,
    setWeeklyStartConflict, setWeeklyPlanOpen, setNewGoal, setWorkspaceView,
    setSelectedTaskId, recoverEnterpriseFactsChanged,
  });

  const returnToLatest = async () => {
    setViewGoalId("");
    setSelectedTaskId("");
    await load("");
  };

  if (loading)
    return (
      <div className="flex h-full items-center justify-center bg-surface">
        <Loader2 size={24} className="animate-spin text-accent" />
      </div>
    );

  if (data?.config) return <ConfiguredDigitalEmployeeWorkspace {...{
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
  }} />;

  return (
    <div className="workspace-canvas digital-employee-page">
      <div className="workspace-frame">
        <header className="workspace-header">
          <h1 className="workspace-title mt-2">数字员工正在等待调遣</h1>
          <div className="mt-5 inline-flex items-center gap-2 border-l-2 border-accent bg-surface-2 px-3 py-2 text-xs font-semibold text-accent">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface text-[10px] text-text-primary">1</span>
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
