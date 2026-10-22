import BusinessHealthOverview from './smartBusiness/BusinessHealthOverview';
import { labels as sharedTaskLabels } from '../../shared/mobile-domain.mjs';
import WeeklyPlanCalendar from './smartBusiness/WeeklyPlanCalendar';
import {
  allocateWeeklyPublishingTargets,
  MAX_WEEKLY_PUBLISHING_ITEMS,
  weeklyPublishingPlatforms,
} from '../../shared/contracts/weeklyPublishingTargets';
import { getScrollBehavior } from "../lib/usePrefersReducedMotion";
import { PAGE_REGISTRY, type Page } from "../pageRegistry";
import { readAgentCalendarReturnContext, registerAgentCalendarReturnState } from '../lib/agentCalendarReturnContext';
import InitialOperatingPlanDialog from './InitialOperatingPlanDialog';
import { initialOperatingPlanFingerprint, recommendFocusProducts, initialPlanVideoPlans, initialPlanMatrixRows, type InitialOperatingPlan } from '../lib/initialOperatingPlan';
import EnterprisePresenters from "./enterprise/EnterprisePresenters";
import { productionApi } from "../lib/productionApi";
import { presenterProductionGate, type PresenterProductionGate } from "../lib/shotProduction";
import ManagedPublishingGrantEditor from './ManagedPublishingGrantEditor';
import { Alert, Button, Form, Input, Modal, Radio as AntRadio, Select, Tabs, Upload } from 'antd';
import KnowledgeIntakePanel from "./enterprise/KnowledgeIntakePanel";
import { normalizeContinuationPolicy } from '../lib/continuationPolicy';
import { taskNeedsAttention } from '../lib/taskExecutionState';
import { discoveryFailurePresentation } from '../lib/discoveryFailurePresentation';
import OperatingAssessmentEditor from './OperatingAssessmentEditor';
import { maturityLabels, maturityProfiles, assessMaturity, gapLabels } from '../lib/operatingMaturity';
import ProductionProgressPanel from './ProductionProgressPanel';
import { consumeBusinessPageContext, saveBusinessPageContext } from '../lib/businessPageNavigation';
import WeeklyPackagePanel from "./WeeklyPackagePanel";
import { nodeDeepLink } from './WeeklyExecutionNodes';
import { agentRuleFields } from '../lib/agentRuleFields';
import { defaultMatrixPlan } from '../lib/weeklyMatrix';
import { Field, inputClass } from './smartBusiness/DigitalEmployeeFormField';
import { EMPTY_CONFIG, completeConfig, configErrors, platformCountsFromCadence, primaryEnterpriseLanguage, publishingPlatforms } from './smartBusiness/digitalEmployeeConfigRules';
import { GoalPanel, EMPTY_GOAL, isoDay, contentPlatformLabel, type GoalDraft, type BusinessLine, type ContentPlatform } from './smartBusiness/WeeklyGoalPanel';
import { TodayFocusPanel } from './smartBusiness/DigitalEmployeeTodayFocusPanel';
import { BatchFollowupTruthPanel, type OpenBusinessLink } from './smartBusiness/BatchFollowupTruthPanel';
import DeliveryBoard from "./DeliveryBoard";
import ProductionTaskScene from "./ProductionTaskScene";
import AgentDecisionCard, { type AgentDecisionKind } from "./AgentDecisionCard";
import WeeklyProductionStudioEntry from "./smartBusiness/WeeklyProductionStudioEntry";
import SmartOperationsAccountRail, { type SmartOperationsAccount } from "./SmartOperationsAccountRail";
import PlanHistoryDialog from "./PlanHistoryDialog";
import SocialContentStageOnboarding from "./socialContent/SocialContentStageOnboarding";
import { LsBrandAction, LsFlowDialog } from "./ui/LsExperiencePrimitives";
import {
  saveSocialContentStage,
  socialContentStageProfile,
  type SocialContentStageId,
} from "../lib/socialContentStage";
import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { SmartBusinessDashboard, WeeklyCommandCenter, WeeklyPlanDetailsDrawer, BusinessInterpretation, WeeklyReviewPanel, deferredWorkspaceFallback } from './digitalEmployeeDeferredViews';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Clock3,
  ExternalLink,
  FileSpreadsheet,
  Hand,
  History,
  Eye,
  Heart,
  Layers3,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  RefreshCcw,
  Search,
  Share2,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  X,
  XCircle,
} from "lucide-react";
import { authHeader, AUTH_TOKEN_CHANGED_EVENT } from "../lib/auth";
import { showActionFeedback, showActionSuccess } from "../lib/actionFeedback";
import { DigitalEmployeeApiError } from "../lib/digitalEmployeeApi";
import {
  WEEKLY_WORK_UPDATED_EVENT,
  notifyWeeklyWorkUpdated,
  type WeeklyWorkUpdatedDetail,
} from "../lib/weeklyWorkEvents";
import { weeklyWorkStatus } from "../lib/weeklyWorkStatus";
import { socialDiscoveryApi } from "../lib/socialDiscoveryApi";
import type { SocialCrawlStrategy } from '../../shared/contracts/socialContentWorkflow';
import type { ProductionContactKind, ProductionPresenterPolicy } from '../../shared/contracts/productionOnboarding';
import EnterpriseProductMultiSelect, { splitSelectedProducts } from './EnterpriseProductMultiSelect';
// EnterpriseProductMultiSelect owns the searchable listbox contract: aria-multiselectable="true" · 搜索企业知识库产品或型号.
import { heuristicProductMapping, mapRowToProduct, parseWorkbook, prepareSheet } from "../lib/productImport";
import { parseProductDocument, productsFromLabeledText, type DocumentProductDraft } from "../lib/productDocumentImport";
import { uploadProductEvidence } from "../lib/enterpriseProductAssetUpload";
import { readProductDiscoveryFile } from "../lib/productDiscoveryFile";
import {
  buildTaskDeepLink,
  consumeDigitalEmployeeReturnContext,
  digitalEmployeeApi,
  dispatchDigitalEmployeeDeepLink,
  ENTERPRISE_FACTS_CHANGED_ERROR_CODE,
  enterpriseFactsRebuildInput,
  streamRunEvents,
  type BusinessDestination,
  type BusinessSnapshot,
  type BusinessReadinessItem,
  type DigitalEmployeeConfig,
  type DigitalEmployeeDeepLink,
  type DigitalEmployeeOverview,
  type DigitalEmployeeWorkflow,
  type PublishingTarget,
  type WeeklyGoal,
  type WorkflowTask,
} from "../lib/digitalEmployees";
import {
  agentRoleGroups,
  capabilityLabel,
  contentCreationWorkflows,
  synchronizeThemeContentWorkflows,
  technicalValueLabel,
  workflowLabel,
  workflowOptions,
} from '../lib/digitalEmployeePresentationPolicy';

function humanizeValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "是" : "否";
  const raw = String(value ?? "—");
  const known =
    technicalValueLabel[raw] || capabilityLabel[raw] || statusLabel[raw];
  if (known) return known;
  if (/^[a-z][a-z0-9_.]*$/.test(raw) && /[_.]/.test(raw))
    return "业务系统记录";
  return raw;
}


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

const statusTone: Record<string, string> = {
  succeeded: "border-emerald-200 bg-emerald-50 text-emerald-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  running: "border-blue-200 bg-blue-50 text-blue-700",
  active: "border-blue-200 bg-blue-50 text-blue-700",
  planning: "border-blue-200 bg-blue-50 text-blue-700",
  waiting_external: "border-sky-200 bg-sky-50 text-sky-700",
  waiting_approval: "border-amber-200 bg-amber-50 text-amber-700",
  waiting_human: "border-violet-200 bg-violet-50 text-violet-700",
  handed_off: "border-violet-200 bg-violet-50 text-violet-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
  cancelled: "border-slate-200 bg-slate-100 text-slate-600",
  paused: "border-slate-200 bg-slate-100 text-slate-600",
};

type WeeklyStartConflict = {
  goalId: string;
  runId: string;
  goalTitle: string;
  goalStatus: string;
  runStatus: string;
  startsAt: string;
  endsAt: string;
};

function weeklyStartConflictFromError(error: unknown): WeeklyStartConflict | null {
  if (!(error instanceof DigitalEmployeeApiError) || error.code !== "active_goal_exists") return null;
  const stringDetail = (key: string) => typeof error.details[key] === "string" ? String(error.details[key]).trim() : "";
  const goalId = stringDetail("activeGoalId");
  const runId = stringDetail("activeRunId");
  if (!goalId && !runId) return null;
  return {
    goalId,
    runId,
    goalTitle: stringDetail("activeGoalTitle"),
    goalStatus: stringDetail("activeGoalStatus"),
    runStatus: stringDetail("activeRunStatus"),
    startsAt: stringDetail("activeStartsAt"),
    endsAt: stringDetail("activeEndsAt"),
  };
}

function confirmedWeeklyExecution(data: DigitalEmployeeOverview, goalId: string) {
  const run = data.run;
  if (!run || run.goal_id !== goalId || !Number.isFinite(Date.parse(run.started_at))) return null;
  const tasks = data.tasks.filter((task) => task.run_id === run.id);
  return tasks.length > 0 ? { run, tasks } : null;
}

function weeklyStartResultNeedsReconciliation(error: unknown): boolean {
  if (!(error instanceof DigitalEmployeeApiError)) return true;
  return error.status === 408 || error.status >= 500;
}

function WeeklyStartConflictAlert({
  conflict,
  onViewRun,
}: {
  conflict: WeeklyStartConflict;
  onViewRun: () => void;
}) {
  const state = statusLabel[conflict.runStatus] || statusLabel[conflict.goalStatus] || conflict.runStatus || conflict.goalStatus || "执行中";
  const range = conflict.startsAt && conflict.endsAt ? `${conflict.startsAt} 至 ${conflict.endsAt}` : "";
  return (
    <Alert
      type="warning"
      showIcon
      title="周任务未启动：已有另一轮任务正在执行"
      description={(
        <div className="space-y-1 text-xs leading-5">
          <p>
            {conflict.goalTitle || "另一轮周任务"}{range ? `（${range}）` : ""}当前为“{state}”。本轮计划仍未开工，系统不会自动取消或重复启动任何运行。
          </p>
          {(conflict.runId || conflict.goalId) && (
            <p className="font-mono text-text-muted">
              {conflict.runId ? `运行 ${conflict.runId}` : ""}{conflict.runId && conflict.goalId ? " · " : ""}{conflict.goalId ? `目标 ${conflict.goalId}` : ""}
            </p>
          )}
        </div>
      )}
      action={<Button className="min-h-11" onClick={onViewRun}>查看该运行</Button>}
    />
  );
}

const agentLabel: Record<string, string> = {
  orchestrator: "灵小枢 · 统筹 Agent",
  business: "经营 Agent",
  planner: "灵小枢 · 统筹 Agent",
  knowledge: "灵小枢 · 统筹 Agent",
  review: "经营 Agent",
  director: "编导 Agent",
  industry: "编导 Agent",
  channel: "编导 Agent",
  content: "内容 Agent",
  risk: "内容 Agent",
  publishing: "经营 Agent",
  customer: "客服 Agent",
};

const autonomyLabel: Record<string, string> = {
  suggest: "建议",
  collaborate: "协作",
  managed: "托管",
  automatic: "全自动",
};

function Badge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone[status] || "border-slate-200 bg-white text-slate-600"}`}
    >
      {label || statusLabel[status] || "状态待确认"}
    </span>
  );
}



const applicationGuideSteps = [
  { index: 1, label: "企业信息" },
  { index: 2, label: "推广产品" },
  { index: 3, label: "经营阶段" },
  { index: 4, label: "视频制作" },
] as const;

type ProductionContactDraft = {
  kind: ProductionContactKind;
  value: string;
  primaryCta: string;
};

function OnboardingGuideFrame({
  step,
  title,
  headerAction,
  children,
  busy = false,
  dismissible = false,
  onClose,
  onBack,
  onSkip,
  skipLabel = "跳过",
  primaryLabel,
  primaryId,
  primaryDisabled = false,
  onPrimary,
}: {
  step: 1 | 2 | 3 | 4;
  title: string;
  headerAction?: ReactNode;
  children: ReactNode;
  busy?: boolean;
  dismissible?: boolean;
  onClose?: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  primaryLabel: string;
  primaryId?: string;
  primaryDisabled?: boolean;
  onPrimary: () => void;
}) {
  return (
    <LsFlowDialog
      open
      title="新手引导"
      width={840}
      centered
      current={step - 1}
      steps={applicationGuideSteps.map((item) => ({
        title: item.label,
        status: item.index < step ? "finish" : item.index === step ? "process" : "wait",
      }))}
      closable={dismissible && !busy}
      keyboard={dismissible && !busy}
      maskClosable={false}
      onCancel={() => dismissible && !busy && onClose?.()}
      styles={{ body: { maxHeight: "min(68vh, 680px)", overflowY: "auto" } }}
      footer={[
        onBack ? <Button key="back" disabled={busy} onClick={onBack}>返回上一步</Button> : null,
        onSkip ? <Button key="skip" type="text" disabled={busy} onClick={onSkip}>{skipLabel}</Button> : null,
        <LsBrandAction key="primary" id={primaryId} loading={busy} disabled={primaryDisabled} onClick={onPrimary}>{primaryLabel}</LsBrandAction>,
      ].filter(Boolean)}
    >
      <section aria-labelledby={`onboarding-step-${step}-title`}>
        <p className="ls-type-body-small font-semibold text-accent">第 {step} 步，共 4 步</p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <h2 id={`onboarding-step-${step}-title`} className="ls-type-title-large min-w-0 text-text-primary">{title}</h2>
          {headerAction ? <div className="ml-auto shrink-0">{headerAction}</div> : null}
        </div>
        <div className="mt-5">{children}</div>
      </section>
    </LsFlowDialog>
  );
}

function OnboardingPanel({
  initial,
  readiness,
  busy,
  mode = "first",
  activeRun = false,
  restartFromBeginning = false,
  initialStep = "start",
  dismissible = false,
  allowInitialPlan = true,
  onClose,
  onSave,
  onOpenReadiness,
  onNavigate,
}: {
  initial: DigitalEmployeeConfig;
  readiness: BusinessReadinessItem[];
  busy: boolean;
  mode?: "first" | "rules";
  activeRun?: boolean;
  restartFromBeginning?: boolean;
  initialStep?: "start" | "presenter";
  dismissible?: boolean;
  allowInitialPlan?: boolean;
  onClose?: () => void;
  onSave: (config: DigitalEmployeeConfig & { minimalOnboarding?: true; brandName?: string; initialPlan?: InitialOperatingPlan }) => void | boolean | Promise<void | boolean>;
  onOpenReadiness: (item: BusinessReadinessItem) => void;
  onNavigate?: (page: BusinessDestination) => void;
}) {
  const restoredRules = useMemo(() => agentRuleFields(initial), [initial.socialCadence, initial.followupCadence, initial.reviewSchedule]);
  const [form, setForm] = useState(() => completeConfig(initial));
  const [dependencyNotice, setDependencyNotice] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [settingsEditorOpen, setSettingsEditorOpen] = useState(false);
  const [collectionPlatforms, setCollectionPlatforms] = useState(restoredRules.collectionPlatforms);
  const [collectionSources, setCollectionSources] = useState(restoredRules.collectionSources);
  const [collectionKeywords, setCollectionKeywords] = useState(restoredRules.collectionKeywords);
  const [collectionLanguage, setCollectionLanguage] = useState(restoredRules.collectionLanguage || "英语");
  const [collectionLookback, setCollectionLookback] = useState(restoredRules.collectionLookback);
  const [collectionLimit, setCollectionLimit] = useState(restoredRules.collectionLimit);
  const [collectionTime, setCollectionTime] = useState(restoredRules.collectionTime);
  const [approvedDiscoveryScope, setApprovedDiscoveryScope] = useState<SocialCrawlStrategy | null>(null);
  const [discoveryScopeNotice, setDiscoveryScopeNotice] = useState("");
  const [publishCount, setPublishCount] = useState(restoredRules.publishCount);
  const [selectedPublishPlatforms, setSelectedPublishPlatforms] = useState<Array<PublishingTarget["platform"]>>(() => {
    const savedPlatforms = weeklyPublishingPlatforms(initial.publishingTargets, initial.socialCadence);
    return savedPlatforms.length ? savedPlatforms : publishingPlatforms.slice();
  });
  const [platformPublishCounts, setPlatformPublishCounts] = useState(() => platformCountsFromCadence(initial.socialCadence, restoredRules.publishCount, initial.publishingTargets));
  const [connectedPublishingAccounts, setConnectedPublishingAccounts] = useState<PublishingTarget[]>([]);
  const [publishingAccountsLoading, setPublishingAccountsLoading] = useState(true);
  const [publishingAccountsError, setPublishingAccountsError] = useState("");
  const [followupGenerateAt, setFollowupGenerateAt] = useState(restoredRules.followupGenerateAt);
  const [followupApproveBy, setFollowupApproveBy] = useState(restoredRules.followupApproveBy);
  const [followupWindow, setFollowupWindow] = useState(restoredRules.followupWindow);
  const [followupFrequency, setFollowupFrequency] = useState(restoredRules.followupFrequency);
  const [reviewTimezone, setReviewTimezone] = useState(restoredRules.reviewTimezone);
  const [reviewCutoff, setReviewCutoff] = useState(restoredRules.reviewCutoff);
  const [recommendationApplied, setRecommendationApplied] = useState(false);
  const [profileLoading, setProfileLoading] = useState(mode === "first");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileConfirmed, setProfileConfirmed] = useState(mode !== "first" || initialStep === "presenter");
  const [productConfirmed, setProductConfirmed] = useState(mode !== "first" || initialStep === "presenter");
  const [brandName, setBrandName] = useState("");
  const [productionContactKind, setProductionContactKind] = useState<ProductionContactKind>(() => initial.productionOnboarding?.contact.kind || "none");
  const [productionContactValue, setProductionContactValue] = useState(() => initial.productionOnboarding?.contact.value || "");
  const [productionCta, setProductionCta] = useState(() => initial.productionOnboarding?.contact.primaryCta || "");
  const [presenterPolicy, setPresenterPolicy] = useState<ProductionPresenterPolicy>(() => initial.productionOnboarding?.presenterPolicy || "local_video_only");
  const [presenterConfigured, setPresenterConfigured] = useState(false);
  const [knowledgeProducts, setKnowledgeProducts] = useState<Array<Record<string, any>>>([]);
  const [productsLoading, setProductsLoading] = useState(mode === "first");
  const [activeRuleAgent, setActiveRuleAgent] = useState<"business" | "director" | "content" | "customer">("business");
  const [productSaving, setProductSaving] = useState(false);
  const [productError, setProductError] = useState("");
  const [productImporting, setProductImporting] = useState(false);
  const [productImportMessage, setProductImportMessage] = useState("");
  const [contentStage, setContentStage] = useState<SocialContentStageId>();
  const [stageConfirmed, setStageConfirmed] = useState(mode !== "first" || initialStep === "presenter");
  const [stageSaving, setStageSaving] = useState(false);
  const [stageError, setStageError] = useState("");
  const [recommendedPlanOpen, setRecommendedPlanOpen] = useState(false);
  const recommendedPlanTriggerId = "onboarding-generate-recommended-plan";
  const [recommendedProducts, setRecommendedProducts] = useState<string[]>([]);
  const themeContentEnabled = form.enabledWorkflows.some((item) =>
    contentCreationWorkflows.includes(item),
  );
  const visibleEnabledWorkflowCount =
    form.enabledWorkflows.filter(
      (item) => !contentCreationWorkflows.includes(item),
    ).length + (themeContentEnabled ? 1 : 0);
  const displayedReadiness = useMemo(() => {
    const override = (item: BusinessReadinessItem): BusinessReadinessItem => {
      if (item.key === "enterprise" && profileConfirmed) {
        return {
          ...item,
          status: "ready",
          note: "企业档案已保存到企业知识库，可用于任务上下文",
        };
      }
      if (item.key === "products" && knowledgeProducts.length > 0) {
        return {
          ...item,
          status: "ready",
          count: knowledgeProducts.length,
          note: `企业知识库已有 ${knowledgeProducts.length} 个真实产品，可用于产品生成与逐客推荐`,
        };
      }
      return item;
    };
    const next = readiness.map(override);
    if (profileConfirmed && !next.some((item) => item.key === "enterprise")) {
      next.unshift({ key: "enterprise", label: "企业资料", status: "ready", count: null, page: "enterprise", note: "企业档案已保存到企业知识库，可用于任务上下文" });
    }
    if (knowledgeProducts.length > 0 && !next.some((item) => item.key === "products")) {
      next.push({ key: "products", label: "产品资料", status: "ready", count: knowledgeProducts.length, page: "enterprise", note: `企业知识库已有 ${knowledgeProducts.length} 个真实产品，可用于产品生成与逐客推荐` });
    }
    return next;
  }, [knowledgeProducts.length, profileConfirmed, readiness]);
  useEffect(() => setForm(completeConfig(initial)), [initial]);
  useEffect(() => {
    setProductionContactKind(initial.productionOnboarding?.contact.kind || "none");
    setProductionContactValue(initial.productionOnboarding?.contact.value || "");
    setProductionCta(initial.productionOnboarding?.contact.primaryCta || "");
    setPresenterPolicy(initial.productionOnboarding?.presenterPolicy || "local_video_only");
  }, [initial.productionOnboarding]);
  useEffect(() => {
    if (mode === "first" && initialStep === "presenter") {
      setProfileConfirmed(true); setProductConfirmed(true); setStageConfirmed(true);
    }
  }, [initialStep, mode]);
  useEffect(() => {
    let active = true;
    void socialDiscoveryApi.getScope().then(({ scope }) => {
      if (!active) return;
      setApprovedDiscoveryScope(scope.approval?.status === 'approved' ? scope : null);
      setDiscoveryScopeNotice(scope.approval?.status === 'approved' ? '' : '尚无已批准的编导采集范围');
    }).catch(() => { if (active) setDiscoveryScopeNotice('暂时无法读取当前编导采集范围'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    setCollectionPlatforms(restoredRules.collectionPlatforms);
    setCollectionSources(restoredRules.collectionSources);
    setCollectionKeywords(restoredRules.collectionKeywords);
    setCollectionLanguage(restoredRules.collectionLanguage || "英语");
    setCollectionLookback(restoredRules.collectionLookback);
    setCollectionLimit(restoredRules.collectionLimit);
    setCollectionTime(restoredRules.collectionTime);
    setPublishCount(restoredRules.publishCount);
    setPlatformPublishCounts(platformCountsFromCadence(initial.socialCadence, restoredRules.publishCount, initial.publishingTargets));
    setFollowupGenerateAt(restoredRules.followupGenerateAt);
    setFollowupApproveBy(restoredRules.followupApproveBy);
    setFollowupWindow(restoredRules.followupWindow);
    setFollowupFrequency(restoredRules.followupFrequency);
    setReviewTimezone(restoredRules.reviewTimezone);
    setReviewCutoff(restoredRules.reviewCutoff);
  }, [initial.socialCadence, restoredRules]);
  const set = <K extends keyof DigitalEmployeeConfig>(
    key: K,
    value: DigitalEmployeeConfig[K],
  ) => setForm((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    let cancelled = false;
    setPublishingAccountsLoading(true);
    digitalEmployeeApi.publishingAccounts()
      .then(result => {
        if (cancelled) return;
        setConnectedPublishingAccounts(result.items);
        if (!initial.publishingTargets.length && result.items.length) {
          setForm((current) => ({ ...current, publishingTargets: result.items }));
        }
        setPublishingAccountsError("");
      })
      .catch(error => {
        if (!cancelled) setPublishingAccountsError(error instanceof Error ? error.message : "发布账号读取失败");
      })
      .finally(() => { if (!cancelled) setPublishingAccountsLoading(false); });
    return () => { cancelled = true; };
  }, [initial.publishingTargets.length]);
  useEffect(() => {
    let cancelled = false;
    if (mode === "first") setProfileLoading(true);
    fetch("/api/overseas/enterprise/profile", { headers: authHeader() })
      .then(async (response) => {
        if (!response.ok) throw new Error("企业知识库读取失败");
        return response.json() as Promise<Record<string, any>>;
      })
      .then((profile) => {
        if (cancelled) return;
        const loadedProfile = {
          companyName: String(profile.company?.name || ""),
          brandName: String(profile.brand?.name || ""),
        };
        setForm((current) => ({
          ...current,
          companyName: loadedProfile.companyName || current.companyName,
        }));
        setBrandName(loadedProfile.brandName);
        const loadedProducts = Array.isArray(profile.products?.items) ? profile.products.items : [];
        setKnowledgeProducts(loadedProducts);
        const savedFocusProducts = String(profile.strategy?.focusProducts || "").split(/[、，,]/).map((item: string) => item.trim()).filter(Boolean);
        setRecommendedProducts(savedFocusProducts.length ? savedFocusProducts : recommendFocusProducts(loadedProducts));
        const loadedStage = socialContentStageProfile(profile.socialStrategy?.contentStage);
        if (loadedStage && loadedStage.id !== "d2c_brand") {
          setContentStage(loadedStage.id);
          if (!restartFromBeginning) setStageConfirmed(true);
        }
        setCollectionLanguage(primaryEnterpriseLanguage(profile.company?.primaryLanguages));
        // Progress is persisted with the tenant profile so a refresh, HMR remount,
        // or a late overview response cannot throw the user back to step one.
        // Only promote local progress here; never regress a step from a stale GET.
        if (!restartFromBeginning && profile.digitalEmployeeOnboarding?.profileConfirmedAt
          && loadedProfile.companyName && loadedProfile.brandName) setProfileConfirmed(true);
        if (!restartFromBeginning && profile.digitalEmployeeOnboarding?.productSelectionConfirmedAt
          && loadedProducts.length) setProductConfirmed(true);
        if (mode === "first") setProductsLoading(false);
        setProfileError("");
      })
      .catch((error) => {
        if (!cancelled && mode === "first") setProfileError(error instanceof Error ? error.message : "企业知识库读取失败");
      })
      .finally(() => {
        if (!cancelled) { setProfileLoading(false); setProductsLoading(false); }
      });
    return () => { cancelled = true; };
  }, [mode, restartFromBeginning]);
  const selectedPublishingTargets = form.publishingTargets.filter((target) => selectedPublishPlatforms.includes(target.platform));
  const weeklyPublishingTotal = selectedPublishPlatforms.reduce((sum, platform) => sum + Math.max(0, Math.floor(platformPublishCounts[platform] || 0)), 0);
  const invalidWeeklyPublishingQuota = selectedPublishPlatforms.some(platform => !Number.isInteger(platformPublishCounts[platform]) || platformPublishCounts[platform] < 1)
    || weeklyPublishingTotal > MAX_WEEKLY_PUBLISHING_ITEMS;
  const missingSelectedPublishingAccount = selectedPublishPlatforms.some(platform => !selectedPublishingTargets.some(target => target.platform === platform));
  const publishingConfigured = selectedPublishPlatforms.length > 0 && !missingSelectedPublishingAccount && !invalidWeeklyPublishingQuota;
  const validationForm = publishingConfigured ? { ...form, publishingTargets: selectedPublishingTargets } : {
    ...form,
    enabledWorkflows: form.enabledWorkflows.filter((workflow) => workflow !== "content_publish"),
    publishingTargets: [],
    allowRealPublishing: false,
  };
  const errors = {
    ...configErrors(validationForm),
    ...(selectedPublishPlatforms.length && missingSelectedPublishingAccount ? { publishingTargets: "每个已选平台都需要选择一个发布账号" } : {}),
    ...(selectedPublishPlatforms.length && invalidWeeklyPublishingQuota ? { weeklyPublishingQuota: `每个平台至少 1 条，合计不超过 ${MAX_WEEKLY_PUBLISHING_ITEMS} 条` } : {}),
  };
  const errorLabels: Record<string, string> = {
    companyName: "企业名称",
    industry: "所属行业",
    primaryBusiness: "主要业务",
    targetMarkets: "目标市场",
    customerProfile: "核心客户",
    focusProducts: "本期重点产品",
    approvalOwner: "审批负责人",
    enabledWorkflows: "至少一项执行能力",
    socialCadence: "内容采集与发布节奏",
    followupCadence: "客户跟进节奏",
    contentPublish: "内容发布设置",
    batchFollowup: "客户跟进设置",
    publishingTargets: "发布平台与账号",
    weeklyPublishingQuota: "每周平台产量",
  };
  const missingConfigLabels = Object.keys(errors).map((key) => errorLabels[key] || key);
  const goToFirstMissingConfig = () => {
    const firstKey = Object.keys(errors)[0];
    if (!firstKey) return;
    const profileKeys = ["companyName", "industry", "primaryBusiness", "targetMarkets", "customerProfile"];
    if (profileKeys.includes(firstKey)) {
      setProfileConfirmed(false);
      setSubmitted(false);
      window.setTimeout(() => document.getElementById("onboarding-enterprise-profile")?.scrollIntoView({ behavior: getScrollBehavior(), block: "start" }), 50);
      return;
    }
    if (firstKey === "focusProducts") {
      setSubmitted(false);
      window.setTimeout(() => document.getElementById("onboarding-focus-products")?.scrollIntoView({ behavior: getScrollBehavior(), block: "start" }), 50);
      return;
    }
    const targetAgent = ["contentPublish", "publishingTargets", "managedPublishingGrant", "approvalOwner"].includes(firstKey) ? "business" : ["batchFollowup", "followupCadence"].includes(firstKey) ? "customer" : firstKey === "socialCadence" ? "director" : "business";
    setActiveRuleAgent(targetAgent);
    window.setTimeout(() => {
      const selector = firstKey === "approvalOwner" ? 'input[placeholder="姓名或岗位"]' : `[aria-invalid="true"]`;
      const target = document.querySelector<HTMLElement>(selector);
      target?.scrollIntoView({ behavior: getScrollBehavior(), block: "center" });
      target?.focus();
    }, 50);
  };
  const toggleWorkflow = (workflow: DigitalEmployeeWorkflow) => {
    const current = form.enabledWorkflows;
    if (current.includes(workflow)) {
      const dependents =
        workflow === "customer_segmentation" &&
        current.includes("batch_followup")
          ? (["batch_followup"] as DigitalEmployeeWorkflow[])
          : contentCreationWorkflows.includes(workflow) &&
              current.includes("content_publish") &&
              current.filter(
                (item) =>
                  contentCreationWorkflows.includes(item) && item !== workflow,
              ).length === 0
            ? (["content_publish"] as DigitalEmployeeWorkflow[])
            : [];
      set(
        "enabledWorkflows",
        current.filter(
          (item) => item !== workflow && !dependents.includes(item),
        ),
      );
      setDependencyNotice(
        dependents.length
          ? `已同步关闭：${dependents.map((item) => workflowLabel[item]).join("、")}，因为它依赖当前工作流。`
          : "",
      );
      return;
    }
    const additions: DigitalEmployeeWorkflow[] = [workflow];
    if (
      workflow === "batch_followup" &&
      !current.includes("customer_segmentation")
    )
      additions.unshift("customer_segmentation");
    if (workflow === "content_publish")
      additions.unshift(
        ...contentCreationWorkflows.filter((item) => !current.includes(item)),
      );
    set("enabledWorkflows", [...new Set([...current, ...additions])]);
    setDependencyNotice(
      workflow === "content_publish" && additions.length > 1
        ? "已同时启用前置能力：社媒视频制作。"
        : additions.length > 1
        ? `已同时启用前置工作流：${additions
            .slice(0, -1)
            .map((item) => workflowLabel[item])
            .join("、")}。`
        : "",
    );
  };
  const toggleThemeContentCreation = () => {
    const current = form.enabledWorkflows;
    if (themeContentEnabled) {
      const closesPublishing = current.includes("content_publish");
      set(
        "enabledWorkflows",
        current.filter(
          (item) =>
            !contentCreationWorkflows.includes(item) &&
            item !== "content_publish",
        ),
      );
      setDependencyNotice(
        closesPublishing
          ? "已同步关闭内容发布，因为它依赖社媒视频制作。"
          : "",
      );
      return;
    }
    set(
      "enabledWorkflows",
      synchronizeThemeContentWorkflows([
        ...current,
        ...contentCreationWorkflows,
      ]),
    );
    setDependencyNotice("已启用爆款复刻；缺少全片精确分析时会退回编导 Agent 补齐，不会转入自由创作。");
  };
  const missingRecommendationFields = [
    ["企业名称", form.companyName], ["行业", form.industry], ["主要业务", form.primaryBusiness],
    ["目标市场", form.targetMarkets], ["核心客户", form.customerProfile],
    ...(knowledgeProducts.length ? [["本期重点产品", form.focusProducts]] : []),
  ].filter(([, value]) => !String(value || "").trim()).map(([label]) => label);
  const canGenerateRecommendation = missingRecommendationFields.length === 0;
  const applyAiRecommendation = () => {
    if (!canGenerateRecommendation) return;
    const subject = form.focusProducts || form.primaryBusiness || form.industry || "企业重点产品";
    if (!form.targetMarkets.trim()) set("targetMarkets", "美国（优先），并根据真实询盘来源扩展到北美其他市场");
    if (!form.customerProfile.trim()) set("customerProfile", `当地经销商、采购负责人和渠道负责人；关注 ${subject} 的适配性、交付与售后`);
    setCollectionKeywords(`${subject}、买家痛点、应用场景、选型对比、行业趋势`);
    setRecommendationApplied(true);
  };
  const profileMissingFields = [
    ["企业名称", form.companyName],
    ["品牌名称", brandName],
  ] as const;
  const missingProfileFields = profileMissingFields.filter(([, value]) => !value.trim()).map(([label]) => label);
  const invalidProductionContact = productionContactKind !== "none"
    && (!productionContactValue.trim() || !productionCta.trim());
  const saveEnterpriseProfile = async () => {
    if (missingProfileFields.length || invalidProductionContact || profileSaving) return;
    setProfileSaving(true);
    setProfileError("");
    try {
      const response = await fetch("/api/overseas/enterprise/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-enterprise-save-source": "diagnosis", ...authHeader() },
        body: JSON.stringify({
          company: { name: form.companyName },
          brand: { name: brandName },
          digitalEmployeeOnboarding: { profileConfirmedAt: new Date().toISOString() },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "企业档案保存失败");
      setProfileConfirmed(true);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "企业档案保存失败");
    } finally {
      setProfileSaving(false);
    }
  };
  const productName = (product: Record<string, any>) => String(product.name || product.title || product.productName || "").trim();
  const importProductFile = async (file: File | null) => {
    if (!file || productImporting) return;
    if (!/\.(xlsx?|csv|pdf|docx|txt)$/i.test(file.name)) {
      setProductImportMessage("");
      setProductError("请选择 Excel、CSV、PDF、Word 或 TXT 文件");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setProductImportMessage("");
      setProductError("文件不能超过 50MB，请压缩或拆分后重试");
      return;
    }
    setProductImporting(true); setProductImportMessage(""); setProductError("");
    const temporaryUrls: string[] = [];
    try {
      let importedProducts: DocumentProductDraft[];
      let unassignedImages: Array<{ name: string; url: string; file: File }> = [];
      let assignedImages: Array<{ productIndex: number; name: string; url: string; file: File }> = [];
      let sourceLabel = "表格字段识别";
      if (/\.(pdf|docx)$/i.test(file.name)) {
        const documentResult = await parseProductDocument(file);
        importedProducts = documentResult.products;
        sourceLabel = documentResult.sourceLabel;
        unassignedImages = documentResult.unassignedImages;
        assignedImages = documentResult.assignedImages;
        temporaryUrls.push(...unassignedImages.map(image => image.url), ...assignedImages.map(image => image.url));
      } else if (/\.txt$/i.test(file.name)) {
        importedProducts = productsFromLabeledText(await readProductDiscoveryFile(file));
        sourceLabel = "TXT 字段识别";
      } else {
        const sheets = await parseWorkbook(file);
        const selectedSheet = sheets.slice().sort((a, b) => b.rowCount - a.rowCount)[0];
        if (!selectedSheet) throw new Error("文件中没有可读取的表格");
        const prepared = prepareSheet(selectedSheet);
        const mapping = heuristicProductMapping(prepared.headers);
        importedProducts = prepared.dataRows.map((row) => mapRowToProduct(row, mapping));
      }
      const decoded = importedProducts
        .filter((item) => item.name || item.sku)
        .map((item, index) => ({
          id: `import-${Date.now()}-${index}`,
          ...item,
          name: item.name || item.sku || `导入产品 ${index + 1}`,
          priceRange: item.retailPrice || item.tagPrice || "",
          images: item.imageUrl ? [{ name: item.imageUrl.split("/").pop() || "产品图片", type: "image/url", size: 0, updatedAt: new Date().toISOString(), url: item.imageUrl }] : [],
          videos: [], documents: [], source: "product_file_import",
        }));
      if (!decoded.length) throw new Error("未识别到有效产品，请确认表格包含“产品名称”或“SKU/货号”列");
      for (const image of assignedImages) {
        const product = decoded[image.productIndex];
        if (!product) continue;
        const asset = await uploadProductEvidence(image.file);
        if (!asset.url) throw new Error('PDF 产品图片上传后缺少可用地址');
        product.images.push({ ...asset, url: asset.url });
        if (!product.imageUrl) product.imageUrl = asset.url;
      }
      // Match the enterprise product importer: retain extracted document pages
      // in the existing asset library, but never invent a product-image match.
      for (let offset = 0; offset < unassignedImages.length; offset += 4) {
        await Promise.all(unassignedImages.slice(offset, offset + 4).map(image => uploadProductEvidence(image.file)));
      }
      const next = [...knowledgeProducts];
      for (const product of decoded) {
        const sku = String((product as Record<string, unknown>).sku || "").trim();
        const name = productName(product);
        const existingIndex = next.findIndex((item) => sku ? String(item.sku || "").trim() === sku : productName(item) === name);
        if (existingIndex >= 0) {
          const existing = next[existingIndex];
          next[existingIndex] = {
            ...existing,
            ...product,
            id: String(existing.id || existing.productId || product.id),
          };
        }
        else next.push(product);
      }
      const response = await fetch("/api/overseas/enterprise/profile", { method: "PATCH", headers: { "Content-Type": "application/json", "x-enterprise-save-source": "diagnosis", ...authHeader() }, body: JSON.stringify({ products: { items: next } }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "产品资料写入企业知识库失败");
      setKnowledgeProducts(next);
      setRecommendedProducts(recommendFocusProducts(next));
      setProductImportMessage(`已通过${sourceLabel}从“${file.name}”识别并写入 ${decoded.length} 个产品，绑定 ${assignedImages.length} 张产品照片。${unassignedImages.length ? `${unassignedImages.length} 张未能确认产品归属的图片已存入企业素材库，需在产品档案核对绑定后才能用于指定产品镜头。` : "可以直接确认产品表。"}`);
    } catch (error) { setProductError(error instanceof Error ? error.message : "产品文件解析失败"); }
    finally {
      temporaryUrls.forEach(url => URL.revokeObjectURL(url));
      setProductImporting(false);
    }
  };
  const confirmProductTable = async () => {
    if (!knowledgeProducts.length || productSaving) return;
    setProductSaving(true); setProductError("");
    try {
      const response = await fetch("/api/overseas/enterprise/profile", { method: "PATCH", headers: { "Content-Type": "application/json", "x-enterprise-save-source": "diagnosis", ...authHeader() }, body: JSON.stringify({ digitalEmployeeOnboarding: { productSelectionConfirmedAt: new Date().toISOString(), continuedWithoutProducts: false } }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "产品表确认失败");
      setProductConfirmed(true);
    } catch (error) { setProductError(error instanceof Error ? error.message : "产品表确认失败"); }
    finally { setProductSaving(false); }
  };
  const confirmSocialStage = async (stageId: SocialContentStageId) => {
    if (stageSaving) return;
    setStageSaving(true);
    setStageError("");
    try {
      const savedStage = await saveSocialContentStage(stageId);
      if (!savedStage.synced) throw new Error("社媒经营阶段保存失败，请稍后重试");
      setContentStage(savedStage.profile.id);
      setStageConfirmed(true);
    } catch (error) {
      setStageError(error instanceof Error ? error.message : "社媒经营阶段保存失败，请稍后重试");
    } finally {
      setStageSaving(false);
    }
  };
  const completeMinimalOnboarding = async (
    plan?: InitialOperatingPlan,
    presenterPolicyOverride?: ProductionPresenterPolicy,
    contactOverride?: ProductionContactDraft,
  ) => {
    if (stageSaving || !stageConfirmed || !contentStage) return;
    setStageSaving(true);
    setStageError("");
    try {
      let confirmedStage = contentStage;
      if (plan && plan.stage !== contentStage) {
        const savedStage = await saveSocialContentStage(plan.stage);
        if (!savedStage.synced) throw new Error("社媒经营阶段保存失败，请稍后重试");
        confirmedStage = savedStage.profile.id;
        setContentStage(confirmedStage);
      }
      const confirmedPresenterPolicy = presenterPolicyOverride || presenterPolicy;
      const confirmedContact = contactOverride || {
        kind: productionContactKind,
        value: productionContactKind === "none" ? "" : productionContactValue.trim(),
        primaryCta: productionContactKind === "none" ? "" : productionCta.trim(),
      };
      const productionOnboarding = {
        schemaVersion: "fixed-yield.production-onboarding.v1" as const,
        contact: confirmedContact,
        presenterPolicy: confirmedPresenterPolicy,
        output: {
          primaryLanguage: plan?.language || form.videoDefaults?.language || "en",
          aspectRatio: "9:16" as const,
          resolution: "1080p" as const,
        },
        includeOneRevision: true,
        confirmedAt: new Date().toISOString(),
      };
      const completed = await onSave(plan ? {
        ...form,
        companyName: form.companyName.trim(),
        focusProducts: plan.products.join("、"),
        targetMarkets: plan.market,
        videoLanguages: [plan.language],
        // V2 only executes the three existing presenter pipelines plus exact
        // tenant-owned local video matches. Missing B-roll must not reopen the
        // legacy free-generation fallback.
        allowGeneratedVisuals: false,
        productionOnboarding,
        operatingMaturity: confirmedStage === "b2b_launch" ? "starting" : "growing",
        minimalOnboarding: true,
        brandName: brandName.trim(),
        initialPlan: { ...plan, stage: confirmedStage },
      } : {
        ...form,
        companyName: form.companyName.trim(),
        focusProducts: "",
        allowGeneratedVisuals: false,
        productionOnboarding,
        minimalOnboarding: true,
        brandName: brandName.trim(),
      });
      if (completed === false) throw new Error("新手引导暂未完成，请稍后重试");
    } catch (error) {
      setStageError(error instanceof Error ? error.message : "新手引导暂未完成，请稍后重试");
    } finally {
      setStageSaving(false);
    }
  };
  const openRecommendedPlan = async () => {
    if (!allowInitialPlan) {
      await completeMinimalOnboarding();
      return;
    }
    setStageError("");
    setRecommendedPlanOpen(true);
  };
  const closeRecommendedPlan = () => {
    setRecommendedPlanOpen(false);
    window.requestAnimationFrame(() => {
      document.getElementById(recommendedPlanTriggerId)?.focus();
    });
  };
  const submit = () => {
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    const contentWorkflows = synchronizeThemeContentWorkflows(
      form.enabledWorkflows,
    );
    const enabledWorkflows = publishingConfigured
      ? [...new Set([...contentWorkflows, "content_publish" as DigitalEmployeeWorkflow])]
      : contentWorkflows.filter((workflow) => workflow !== "content_publish");
    const publishingTargets = allocateWeeklyPublishingTargets(selectedPublishingTargets, platformPublishCounts);
    const effectivePublishCount = selectedPublishPlatforms.length ? weeklyPublishingTotal : Math.max(0, Math.floor(publishCount || 0));
    const platformCounts = selectedPublishPlatforms.map((platform) => `${platform}=${platformPublishCounts[platform]}`).join(",");
    const completed = {
      ...form,
      publishingTargets,
      enabledWorkflows,
      allowRealPublishing: publishingConfigured && form.allowRealPublishing,
      team: ["planner", "knowledge", "risk", "review", ...(enabledWorkflows.some((item) => contentCreationWorkflows.includes(item)) ? ["content"] : []), ...(enabledWorkflows.some((item) => ["customer_segmentation", "batch_followup"].includes(item)) ? ["customer"] : [])],
      socialCadence: `${collectionPlatforms}；${collectionSources}；关键词：${collectionKeywords || form.focusProducts || form.primaryBusiness}；关键词语言：${collectionLanguage}；近 ${collectionLookback} 天；${collectionTime}；每次最多 ${collectionLimit} 条；按链接与标题去重 30 天；每周生成 ${effectivePublishCount} 条发布草稿；发布平台：${selectedPublishPlatforms.join("、")}；各平台条数：${platformCounts}；账号范围：${publishingTargets.map(target => `${target.platform}/${target.accountLabel}`).join("、") || "未确认"}；发布节奏按视频矩阵执行`,
      followupCadence: [followupGenerateAt, followupApproveBy, followupWindow, followupFrequency].every((value, index) => value === [restoredRules.followupGenerateAt, restoredRules.followupApproveBy, restoredRules.followupWindow, restoredRules.followupFrequency][index]) ? initial.followupCadence : `${followupGenerateAt}生成分层跟进草稿；${followupApproveBy}审批；${followupWindow}发送；${followupFrequency}`,
      reviewSchedule: reviewTimezone === restoredRules.reviewTimezone && reviewCutoff === restoredRules.reviewCutoff ? initial.reviewSchedule : `周五 17:30（${reviewTimezone}）；数据截止 ${reviewCutoff}；通知审批负责人；仅生成复盘和下周任务草稿`,
    };
    setSettingsEditorOpen(false);
    onSave(completed);
  };
  const confirmRecommendedSettings = () => {
    if (Object.keys(errors).length) {
      setSubmitted(true);
      setSettingsEditorOpen(true);
      return;
    }
    submit();
  };
  if (mode === "first" && recommendedPlanOpen && contentStage) return (
    <InitialOperatingPlanDialog
      config={form}
      initial={{
        stage: contentStage,
        products: recommendedProducts.length ? recommendedProducts : recommendFocusProducts(knowledgeProducts),
        market: form.targetMarkets && !form.targetMarkets.includes("待") ? form.targetMarkets : "北美",
        language: collectionLanguage || "英语",
        platforms: connectedPublishingAccounts.length ? [...new Set(connectedPublishingAccounts.map(account => account.platform))] : ["youtube", "tiktok"],
        accountIds: Object.fromEntries(connectedPublishingAccounts.map(account => [account.platform, account.accountId])),
        count: 5,
        budgetCapCny: 500,
        deliveryDate: isoDay(6),
      }}
      busy={stageSaving || busy}
      error={stageError}
      onBack={closeRecommendedPlan}
      onConfirm={plan => void completeMinimalOnboarding(plan)}
    />
  );
  if (mode === "first" && !profileConfirmed) return (
    <OnboardingGuideFrame
      step={1}
      title="先告诉我们你的企业和品牌"
      busy={profileSaving || busy}
      dismissible={dismissible}
      onClose={onClose}
      onSkip={dismissible ? onClose : undefined}
      skipLabel="稍后继续"
      primaryLabel="确认企业信息"
      primaryDisabled={Boolean(missingProfileFields.length) || invalidProductionContact}
      onPrimary={() => void saveEnterpriseProfile()}
    >
      <Form className="space-y-6" layout="vertical" aria-label="企业与品牌资料">
        <section id="onboarding-enterprise-profile" className="scroll-mt-24">
          {profileLoading ? <div role="status" className="flex items-center gap-2 rounded-lg bg-surface-2 p-5 text-sm text-text-muted"><Loader2 size={16} className="animate-spin" />正在读取企业知识库已有档案…</div> : <>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="企业名称" required><input className={inputClass} value={form.companyName} onChange={e=>set("companyName",e.target.value)} placeholder="例如：灵枢科技" /></Field>
              <Field label="品牌名称" required><input className={inputClass} value={brandName} onChange={e=>setBrandName(e.target.value)} placeholder="例如：Aurelia" /></Field>
            </div>
            {profileError && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-xs text-red-700">{profileError}</p>}
            {missingProfileFields.length ? <p role="status" className="mt-5 text-xs text-amber-700">还需填写：{missingProfileFields.join("、")}</p> : null}
          </>}
        </section>
        <section className="space-y-3 border-t border-border pt-6" aria-labelledby="onboarding-contact-title">
          <h3 id="onboarding-contact-title" className="ls-type-title-medium text-text-primary">你想用哪种联系方式让客户找到你？</h3>
          <div className="grid gap-4 md:grid-cols-3">
            <Form.Item className="mb-0" label="联系方式" htmlFor="production-contact-kind">
              <Select
                id="production-contact-kind"
                value={productionContactKind}
                onChange={(value: ProductionContactKind) => setProductionContactKind(value)}
                options={[
                  { value: "none", label: "本轮不展示" },
                  { value: "whatsapp", label: "WhatsApp" },
                  { value: "email", label: "邮箱" },
                  { value: "phone", label: "电话" },
                  { value: "website", label: "网站" },
                  { value: "wechat", label: "微信" },
                ]}
              />
            </Form.Item>
            <Form.Item
              className="mb-0"
              label="公开联系信息"
              htmlFor="production-contact-value"
              required={productionContactKind !== "none"}
              validateStatus={productionContactKind !== "none" && !productionContactValue.trim() ? "error" : undefined}
              help={productionContactKind !== "none" && !productionContactValue.trim() ? "请填写允许公开展示的联系信息" : undefined}
            >
              <Input
                id="production-contact-value"
                disabled={productionContactKind === "none"}
                value={productionContactValue}
                onChange={event => setProductionContactValue(event.target.value)}
                placeholder={productionContactKind === "none" ? "不需要填写" : "例如：sales@example.com"}
                aria-required={productionContactKind !== "none"}
                aria-invalid={productionContactKind !== "none" && !productionContactValue.trim()}
              />
            </Form.Item>
            <Form.Item
              className="mb-0"
              label="视频行动号召"
              htmlFor="production-contact-cta"
              required={productionContactKind !== "none"}
              validateStatus={productionContactKind !== "none" && !productionCta.trim() ? "error" : undefined}
              help={productionContactKind !== "none" && !productionCta.trim() ? "请填写视频中使用的行动号召" : undefined}
            >
              <Input
                id="production-contact-cta"
                disabled={productionContactKind === "none"}
                value={productionCta}
                onChange={event => setProductionCta(event.target.value)}
                placeholder={productionContactKind === "none" ? "不安排联系镜头" : "例如：发送采购需求获取报价"}
                aria-required={productionContactKind !== "none"}
                aria-invalid={productionContactKind !== "none" && !productionCta.trim()}
              />
            </Form.Item>
          </div>
        </section>
      </Form>
    </OnboardingGuideFrame>
  );
  if (mode === "first" && profileConfirmed && !productConfirmed) return (
    <OnboardingGuideFrame
      step={2}
      title="这次想重点推广哪些产品？"
      headerAction={
        <Upload
          accept=".xlsx,.xls,.csv,.pdf,.docx,.txt"
          showUploadList={false}
          disabled={productsLoading || productSaving || productImporting || busy}
          beforeUpload={(file) => {
            void importProductFile(file);
            return Upload.LIST_IGNORE;
          }}
        >
          <Button icon={<FileSpreadsheet size={16} />} loading={productImporting} disabled={productsLoading || productSaving || busy}>上传产品资料</Button>
        </Upload>
      }
      busy={productSaving || productImporting || busy}
      dismissible={dismissible}
      onClose={onClose}
      onBack={() => setProfileConfirmed(false)}
      primaryLabel="确认产品表，下一步"
      primaryDisabled={!knowledgeProducts.length}
      onPrimary={() => void confirmProductTable()}
    >
    <section id="onboarding-focus-products" className="scroll-mt-24">
      {productsLoading ? <div role="status" className="mt-6 flex items-center gap-2 rounded-lg bg-slate-50 p-5 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />正在读取企业知识库产品…</div> : <>
        {productImportMessage&&<p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">{productImportMessage}</p>}
        {!knowledgeProducts.length ? <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-8 text-center"><p className="font-bold text-slate-800">企业知识库尚未录入产品</p><p className="mt-2 text-xs text-slate-500">请上传产品表后继续。</p></div> : <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">{knowledgeProducts.map((product,index)=>{const name=productName(product);const details=[product.category,product.sku || product.attributes?.model].filter(Boolean).join(" · ");return <div key={String(product.id||`${name}-${index}`)} className="rounded-lg border border-slate-200 p-4 text-left"><div className="flex items-start justify-between gap-2"><p className="font-bold text-slate-900">{name}</p><CheckCircle2 size={17} className="shrink-0 text-emerald-600" /></div><p className="mt-1 text-xs text-slate-500">{details||"暂无型号与类别"}</p><p className="mt-3 line-clamp-2 text-xs leading-relaxed text-slate-500">{product.description||product.highlights||"详细资料可稍后在企业中心完善"}</p></div>})}</div>}
        {productError&&<p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-xs text-red-700">{productError}</p>}
        <p role="status" className="mt-5 text-xs text-text-muted">{knowledgeProducts.length?`产品表已有 ${knowledgeProducts.length} 个产品，可以继续。`:"导入至少一个产品后即可继续。"}</p>
      </>}
    </section>
    </OnboardingGuideFrame>
  );
  if (mode === "first" && profileConfirmed && productConfirmed && !stageConfirmed) return (
    <OnboardingGuideFrame
      step={3}
      title="你的社媒经营目前到了哪一步？"
      busy={stageSaving || busy}
      dismissible={dismissible}
      onClose={onClose}
      onBack={() => setProductConfirmed(false)}
      primaryLabel="确认阶段，下一步"
      primaryDisabled={!contentStage}
      onPrimary={() => contentStage && void confirmSocialStage(contentStage)}
    >
      <SocialContentStageOnboarding
        embedded
        hideHeader
        hideActions
        eyebrow="第三步 · 社媒经营阶段"
        initialValue={contentStage}
        busy={stageSaving || busy}
        error={stageError}
        onChange={setContentStage}
        onConfirm={(stageId) => void confirmSocialStage(stageId)}
      />
    </OnboardingGuideFrame>
  );
  if (mode === "first" && profileConfirmed && productConfirmed && stageConfirmed) return (
    <OnboardingGuideFrame
      step={4}
      title="最后，确认这轮视频怎么制作"      busy={stageSaving || busy}
      dismissible={dismissible}
      onClose={onClose}
      onBack={() => setStageConfirmed(false)}
      onSkip={() => {
        void completeMinimalOnboarding(undefined, "local_video_only");
      }}
      skipLabel="本轮仅用本地素材"
      primaryLabel={allowInitialPlan ? "生成推荐计划" : "完成引导并保存"}
      primaryId={allowInitialPlan ? recommendedPlanTriggerId : undefined}
      primaryDisabled={invalidProductionContact || (presenterPolicy === "digital_presenter" && !presenterConfigured)}
      onPrimary={() => void openRecommendedPlan()}
    >
      <Form className="space-y-5" layout="vertical" aria-label="生产开工资料">
        <section className="space-y-3" aria-label="出镜方式">
          <AntRadio.Group
            className="!grid w-full !gap-3 sm:!grid-cols-2"
            value={presenterPolicy}
            onChange={event => setPresenterPolicy(event.target.value as ProductionPresenterPolicy)}
            aria-label="出镜方式"
          >
            <AntRadio value="digital_presenter" className={`m-0 flex rounded-lg border p-4 ${presenterPolicy === "digital_presenter" ? "border-accent bg-accent-glow" : "border-border bg-surface"}`}><span><strong className="block text-sm text-text-primary">使用数字人口播</strong><span className="mt-1 block text-xs leading-5 text-text-muted">需要完成默认人物、声音与用途授权；选择后不会降级为素材匹配或其他制作路线。</span></span></AntRadio>
            <AntRadio value="local_video_only" className={`m-0 flex rounded-lg border p-4 ${presenterPolicy === "local_video_only" ? "border-accent bg-accent-glow" : "border-border bg-surface"}`}><span><strong className="block text-sm text-text-primary">本轮仅用本地实拍</strong><span className="mt-1 block text-xs leading-5 text-text-muted">自动排除含真人口播的参考，不临时改成其他生成方式。</span></span></AntRadio>          </AntRadio.Group>
          {presenterPolicy === "digital_presenter" && <EnterprisePresenters initialConfiguration onInitialSelection={() => setPresenterConfigured(true)} />}
        </section>
        {stageError && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">{stageError}</p>}
      </Form>
    </OnboardingGuideFrame>
  );
  return (
    <>
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-lg bg-emerald-50 p-3 text-emerald-700"><Settings2 size={22} /></div>
            <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Agent 设置</p><h2 className="mt-1 text-xl font-bold text-slate-950">系统已准备一套安全默认方案</h2><p className="mt-1 text-sm text-slate-500">无需逐项填写。确认后即可使用；以后随时可以打开修改。</p></div>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-semibold text-emerald-700">推荐设置已就绪</span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {agentRoleGroups.map(agent => {
            const Icon = agent.id === "business" ? BarChart3 : agent.id === "director" ? Search : agent.id === "content" ? Sparkles : MessageSquare;
            const detail = agent.id === "business" ? "统筹发布、数据与复盘" : agent.id === "director" ? "采集灵感并完成编导方案" : agent.id === "content" ? "按方案制作并检查成片" : "整理客户并生成跟进草稿";
            return <div key={agent.id} className="rounded-lg border border-slate-200 bg-slate-50/70 p-4"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-emerald-700"><Icon size={17} /></span><p className="mt-3 text-sm font-semibold text-slate-900">{agent.label}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{detail}</p></div>;
          })}
        </div>
        {activeRun && <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">当前运行继续沿用已批准计划；本次保存从下一轮生效。</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button htmlType="button" onClick={() => setSettingsEditorOpen(true)} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">查看并修改设置</Button>
          <Button type="primary" htmlType="button" disabled={busy} onClick={confirmRecommendedSettings} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold">{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}确认并保存设置</Button>
        </div>
      </section>
      {settingsEditorOpen && <section aria-label="Agent 设置" className="rounded-lg border border-border bg-white p-5">
      <Button htmlType="button" aria-label="关闭 Agent 设置" disabled={busy} onClick={() => setSettingsEditorOpen(false)} className="!h-auto min-h-9 !whitespace-normal sticky top-0 z-10 float-right rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"><X size={18} /></Button>
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-emerald-50 p-3 text-emerald-700">
          <Settings2 size={22} />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
            运行规则
          </p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">设置数字员工的运行方式</h2>
          <p className="mt-1 text-sm text-slate-500">
            {activeRun
              ? "当前运行继续沿用已批准计划；这里保存的配置从下一轮计划生效。"
              : "这里只保留四个 Agent 各自需要由用户决定的设置。"}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1.5 sm:grid-cols-4">
        {([
          { id: "business" as const, label: "经营 Agent", icon: BarChart3 },
          { id: "director" as const, label: "编导 Agent", icon: Search },
          { id: "content" as const, label: "内容 Agent", icon: Sparkles },
          { id: "customer" as const, label: "客服 Agent", icon: MessageSquare },
        ]).map((agent)=>{const active=activeRuleAgent===agent.id;const Icon=agent.icon;return <Button key={agent.id} htmlType="button" aria-pressed={active} onClick={()=>setActiveRuleAgent(agent.id)} className={`!h-auto min-h-9 !whitespace-normal flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-center transition ${active?"bg-slate-950 text-white":"bg-white text-slate-600 hover:bg-slate-100"}`}><Icon size={15}/><span className="text-xs font-semibold">{agent.label}</span></Button>})}
      </div>
      <div className="mt-4 grid gap-4">
        {activeRuleAgent === "director" && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div><p className="text-sm font-bold text-emerald-950">AI 推荐经营需求</p><p className="mt-1 text-xs text-emerald-700">根据行业、业务、重点产品和目标市场生成给编导的采集建议；实际搜索范围以已批准的灵感范围为准。</p></div>
          <div className="text-right"><Button htmlType="button" disabled={!canGenerateRecommendation} onClick={applyAiRecommendation} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold"><Sparkles size={14} />{recommendationApplied ? "已生成，可继续调整" : "填入基础关键词"}</Button>{!canGenerateRecommendation&&<p role="status" className="mt-1 text-[10px] text-amber-700">请先补齐：{missingRecommendationFields.join("、")}</p>}</div>
        </div>}
        {activeRuleAgent === "director" && <section className="rounded-lg border border-slate-200 p-4">
          <p className="text-sm font-bold text-slate-900">编导采集需求与导演规则</p>
          <p className="mt-1 text-xs text-slate-500">这里记录经营 Agent 对编导的目标和建议。保存后不会直接覆盖正在执行的采集范围；编导采集以灵感大屏已批准的范围为准。</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs font-semibold text-emerald-900">{approvedDiscoveryScope ? `当前生效：编导采集范围 v${approvedDiscoveryScope.approval?.scopeVersion ?? approvedDiscoveryScope.version} · ${approvedDiscoveryScope.discoveryBrief.lookbackDays} 天 · 滚动 7 天目标 ${approvedDiscoveryScope.discoveryBrief.resultLimit} 条` : discoveryScopeNotice || '正在读取当前编导采集范围…'}</p>
            <Button htmlType="button" onClick={() => onNavigate?.('socialInspiration')} disabled={!onNavigate} className="!h-auto min-h-9 !whitespace-normal rounded-lg px-3 py-2 text-xs font-bold">到灵感大屏确认或调整</Button>
          </div>
          <div className="mt-4 space-y-4">
            <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">1 · 建议采集范围</p><div className="space-y-3"><Field label="建议平台"><input className={inputClass} value={collectionPlatforms} onChange={e=>setCollectionPlatforms(e.target.value)} /></Field><Field label="建议来源"><input className={inputClass} value={collectionSources} onChange={e=>setCollectionSources(e.target.value)} /></Field><Field label="建议关键词"><input className={inputClass} value={collectionKeywords} onChange={e=>setCollectionKeywords(e.target.value)} placeholder="仅作为经营需求，实际词在灵感大屏确认" /></Field></div></div>
            <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">2 · 建议执行节奏</p><div className="grid gap-3 md:grid-cols-3"><Field label="建议采集时间"><input className={inputClass} value={collectionTime} onChange={e=>setCollectionTime(e.target.value)} /></Field><Field label="建议回看天数"><input className={inputClass} type="number" min={1} value={collectionLookback} onChange={e=>setCollectionLookback(Number(e.target.value))} /></Field><Field label="建议单次上限"><input className={inputClass} type="number" min={1} value={collectionLimit} onChange={e=>setCollectionLimit(Number(e.target.value))} /></Field></div></div>
          </div>
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">经营建议：近 {collectionLookback} 天 · 单次最多 {collectionLimit} 条。编导确认后才会成为采集参数。</p>
        </section>}
        {activeRuleAgent === "content" && <section className="rounded-lg border border-slate-200 p-4">
          <p className="text-sm font-bold text-slate-900">输出内容语言</p>
          <p className="mt-1 text-xs text-slate-500">内容 Agent 只按这里确认的语言交付内容。</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="主语言"><select className={inputClass} value={form.videoDefaults?.language || 'en'} onChange={event => { const language=event.target.value; set('videoDefaults', { ...form.videoDefaults, language }); set('videoLanguages', [language, ...(form.videoLanguages || []).filter(item=>item!==language)]); }}><option value="en">英语</option><option value="zh">中文</option><option value="es">西班牙语</option><option value="fr">法语</option><option value="de">德语</option></select></Field>
            <div><p className="text-xs font-semibold text-slate-600">需要输出的语言</p><div className="mt-2 flex flex-wrap gap-2">{[{code:'en',label:'英语'},{code:'zh',label:'中文'},{code:'es',label:'西班牙语'},{code:'fr',label:'法语'},{code:'de',label:'德语'}].map(item=>{const selected=(form.videoLanguages || [form.videoDefaults?.language || 'en']).includes(item.code);const primary=(form.videoDefaults?.language || 'en')===item.code;return <label key={item.code} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${selected?'border-blue-300 bg-blue-50':'border-slate-200 bg-white'}`}><input type="checkbox" checked={selected} disabled={primary} onChange={()=>set('videoLanguages',selected?(form.videoLanguages || []).filter(code=>code!==item.code):[...(form.videoLanguages || [form.videoDefaults?.language || 'en']),item.code])}/>{item.label}{primary?' · 主语言':''}</label>})}</div></div>
          </div>
        </section>}
        {activeRuleAgent === "business" && <section className="rounded-lg border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-900">周草稿、发布平台与具体账号</p><p className="mt-1 text-xs text-slate-500">默认向所有已连接账号和平台发布，具体节奏沿用视频矩阵。</p></div><div className="flex flex-wrap items-center gap-3"><Button htmlType="button" onClick={()=>{setSelectedPublishPlatforms([]);set("publishingTargets",[]);set("allowRealPublishing",false);}} className="!h-auto min-h-9 !whitespace-normal text-xs font-bold text-slate-600 hover:text-slate-950">本周暂不发布，仅生成内容</Button><Button htmlType="button" onClick={()=>onOpenReadiness({key:"social_accounts",label:"社媒账号",status:"empty",count:connectedPublishingAccounts.length,page:"accountManagement",note:"管理发布账号"})} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-1 text-xs font-bold text-blue-700">管理账号 <ExternalLink size={12}/></Button></div></div>
          {!selectedPublishPlatforms.length && <div className="mt-4"><Field label="仅生成内容时的每周草稿数"><input className={inputClass} type="number" min={0} max={MAX_WEEKLY_PUBLISHING_ITEMS} value={publishCount} onChange={event=>setPublishCount(Math.min(MAX_WEEKLY_PUBLISHING_ITEMS, Math.max(0, Math.floor(Number(event.target.value) || 0))))} /><p className="mt-1 text-xs text-slate-500">未选择发布平台时，只按这里生成内容草稿。</p></Field></div>}
          <div className="mt-4 space-y-3">{publishingPlatforms.map(platform => { const selected=selectedPublishPlatforms.includes(platform); const accounts=connectedPublishingAccounts.filter(account=>account.platform===platform); return <div key={platform} className={`rounded-lg border p-3 ${selected?'border-violet-200 bg-violet-50/35':'border-slate-200 bg-slate-50'}`}><div className="flex flex-wrap items-center gap-3"><label className="flex min-w-36 items-center gap-2 text-xs font-semibold text-slate-900"><input type="checkbox" checked={selected} onChange={event=>setSelectedPublishPlatforms(current=>event.target.checked?[...new Set([...current,platform])]:current.filter(item=>item!==platform))}/>{contentPlatformLabel[platform]}</label><label className="ml-auto flex items-center gap-2 text-xs font-semibold text-slate-600">每周发布<input type="number" min={1} max={MAX_WEEKLY_PUBLISHING_ITEMS} disabled={!selected} value={platformPublishCounts[platform]} onChange={event=>setPlatformPublishCounts(current=>({...current,[platform]:Math.min(MAX_WEEKLY_PUBLISHING_ITEMS,Math.max(0,Math.floor(Number(event.target.value)||0)))}))} className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-sm" />条</label></div><div className="mt-2 flex flex-wrap gap-2">{publishingAccountsLoading?<span className="text-xs text-slate-500">正在读取账号…</span>:accounts.length?accounts.map(account=>{const checked=form.publishingTargets.some(target=>target.accountId===account.accountId);return <label key={account.accountId} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${checked&&selected?'border-violet-200 bg-white text-violet-800':'border-slate-200 bg-white text-slate-500'}`}><input type="checkbox" disabled={!selected} checked={checked&&selected} onChange={()=>set('publishingTargets',checked?form.publishingTargets.filter(target=>target.accountId!==account.accountId):[...form.publishingTargets,account])}/>{account.accountLabel}</label>}):<span className="text-xs text-amber-700">尚未连接该平台账号</span>}</div></div>; })}</div>
          {publishingAccountsError&&<p className="mt-3 text-[10px] text-red-600">{publishingAccountsError}</p>}
          <label className="mt-4 flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3"><input type="checkbox" className="mt-0.5" checked={form.allowRealPublishing} onChange={event=>set("allowRealPublishing",event.target.checked)}/><span><span className="block text-xs font-semibold text-slate-900">审批通过后允许真实发布</span><span className="mt-0.5 block text-[10px] leading-5 text-slate-500">关闭时只生成发布草稿和排期，不会发送到社媒平台。</span></span></label>
          <p className={`mt-4 rounded-lg p-3 text-xs leading-5 ${invalidWeeklyPublishingQuota?'bg-red-50 text-red-700':'bg-slate-50 text-slate-600'}`}>{selectedPublishPlatforms.length ? `本周总计 ${weeklyPublishingTotal} 条；按各平台条数和所选账号进入同一份视频矩阵排期。` : '本周不安排发布，只生成内容草稿。'}{invalidWeeklyPublishingQuota ? ` 每个平台至少 1 条，合计不超过 ${MAX_WEEKLY_PUBLISHING_ITEMS} 条。` : ''}</p>
        </section>}
        {activeRuleAgent === "customer" && <details className="rounded-lg border border-emerald-100 bg-emerald-50/45 p-4">
          <summary className="cursor-pointer text-sm font-bold text-emerald-950">客服知识与接待信息（按需展开）</summary>
          <p className="mt-2 text-xs text-emerald-800">企业和产品资料全系统共用；这里只补充客服专用的接待规则和通知方式。</p>
          <div className="mt-4"><KnowledgeIntakePanel /></div>
        </details>}
        {activeRuleAgent === "customer" && <div className="md:col-span-2 rounded-lg border border-slate-200 p-4"><p className="text-sm font-bold text-slate-900">客户跟进规则</p><div className="mt-3 grid gap-3 md:grid-cols-2"><Field label="草稿生成时间"><input className={inputClass} value={followupGenerateAt} onChange={e=>setFollowupGenerateAt(e.target.value)} /></Field><Field label="审批截止"><input className={inputClass} value={followupApproveBy} onChange={e=>setFollowupApproveBy(e.target.value)} /></Field><Field label="允许发送时段"><input className={inputClass} value={followupWindow} onChange={e=>setFollowupWindow(e.target.value)} /></Field><Field label="客户触达频控"><input className={inputClass} value={followupFrequency} onChange={e=>setFollowupFrequency(e.target.value)} /></Field></div><label className="mt-3 flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3"><input type="checkbox" className="mt-0.5" checked={form.allowRealCustomerMessages} onChange={e=>set("allowRealCustomerMessages",e.target.checked)}/><span><span className="block text-xs font-semibold text-slate-900">审批通过后允许真实发送客服消息</span><span className="mt-0.5 block text-[10px] text-slate-500">未开启时只生成和审批草稿，不调用真实消息渠道；商业承诺仍需逐条人工审批。</span></span></label><p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">先生成逐客草稿并等待审批，仅在客户当地工作时间发送。</p></div>}
      </div>
      <div className="mt-4 flex flex-col items-end gap-2">
        {submitted && Object.keys(errors).length > 0 && (
          <div role="alert" className="flex flex-wrap items-center justify-end gap-2 text-xs font-semibold text-red-600"><span>还需填写：{missingConfigLabels.join("、")}。</span><Button htmlType="button" onClick={goToFirstMissingConfig} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-bold text-red-700">去补齐</Button></div>
        )}
        <Button type="primary"
          htmlType="button"
          disabled={busy || (submitted && Object.keys(errors).length > 0)}
          onClick={submit}
          className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold transition"
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <ArrowRight size={16} />
          )}{" "}
          {mode === "first"
            ? "保存配置，进入周目标"
            : activeRun
              ? "保存为后续运行规则"
              : "保存运行规则"}
        </Button>
      </div>
    </section>}
    </>
  );
}

function outputSummary(task: WorkflowTask): string {
  if (task.output.dataStatus === "not_required") return String(task.output.summary || "本轮无需执行");
  if (task.output.dataStatus === "no_data") return "暂无符合条件的客户，本轮继续其他任务；未计为已完成或已发送。";
  if (task.task_key === "context_readiness")
    return `已确认企业、行业、目标市场和 ${Array.isArray(task.output.constraints) ? task.output.constraints.length : 0} 条行动边界`;
  if (task.task_key === "goal_decomposition")
    return `已绑定指标 ${humanizeValue(task.output.successMetric || "待确认")}，形成 4 个检查点`;
  if (task.task_key === "content_execution_pack")
    return `已形成 ${Array.isArray(task.output.themes) ? task.output.themes.length : 0} 个内容主题与渠道建议`;
  if (task.task_key === "schedule_activation")
    return "执行清单已登记；未模拟真实渠道发布结果";
  if (task.status === "waiting_approval") return task.blocked_reason;
  return task.status === "succeeded"
    ? "结果已持久化并写入事件流"
    : task.blocked_reason || "";
}

type WorkspaceView = "today" | "matrix" | "overview" | "live" | "review" | "rules";

const businessLineLabel: Record<BusinessLine, string> = {
  full_funnel: "全链路经营",
  content_growth: "内容增长",
  customer_conversion: "客户转化",
};


function taskBusinessLine(task: WorkflowTask): BusinessLine {
  if (task.business_line) return task.business_line;
  const domain = String(task.business_domain || "").toLowerCase();
  if (domain === "customer") return "customer_conversion";
  if (["content", "publishing", "social", "industry"].includes(domain)) return "content_growth";
  return "full_funnel";
}

const workspaceViews: Array<{
  id: WorkspaceView;
  label: string;
  caption: string;
}> = [
  { id: "today", label: "今天要做", caption: "优先事项与本周进度" },
  { id: "live", label: "任务执行", caption: "计划确认、进度与审批" },
  { id: "overview", label: "生产与交付", caption: "作品产出、审核与发布" },
  { id: "review", label: "复盘", caption: "周期结果与改进" },
];

function BusinessLineNav({ value, platform, onChange, onPlatformChange }: { value: BusinessLine; platform: ContentPlatform; onChange: (value: BusinessLine) => void; onPlatformChange: (value: ContentPlatform) => void }) {
  const lines: Array<[BusinessLine, string, string]> = [
    ["full_funnel", "全链路经营", "曝光到成交"],
    ["content_growth", "内容增长", "情报到获客"],
    ["customer_conversion", "客户转化", "询盘到成交"],
  ];
  const platforms: Array<[ContentPlatform, string]> = [["all","全部平台"],["facebook","Facebook"],["instagram","Instagram"],["tiktok","TikTok"],["youtube","YouTube"],["linkedin","LinkedIn"]];
  return <section aria-label="经营视角切换" className="border-b border-slate-200 bg-transparent">
    <div className="flex flex-wrap items-center gap-5">
      <span className="flex items-center gap-1.5 py-3 text-[10px] font-bold text-slate-400"><Layers3 size={13}/>经营视角</span>
      {lines.map(([id,label,caption])=><Button key={id} htmlType="button" title={caption} aria-pressed={value===id} onClick={()=>onChange(id)} className={`!h-auto min-h-9 !whitespace-normal border-b-2 px-1 py-3 text-[11px] font-semibold transition-colors ${value===id?"border-accent text-text-primary":"border-transparent text-slate-500 hover:text-slate-900"}`}>{label}</Button>)}
    </div>
    {value==="content_growth"&&<div className="flex flex-wrap items-center gap-4 border-t border-slate-100 py-2"><span className="text-[10px] font-bold text-slate-400">平台</span>{platforms.map(([id,label])=><Button key={id} htmlType="button" aria-pressed={platform===id} onClick={()=>onPlatformChange(id)} className={`!h-auto min-h-9 !whitespace-normal border-b px-0.5 py-1 text-[10px] font-semibold ${platform===id?"border-accent text-accent":"border-transparent text-slate-500 hover:text-slate-900"}`}>{label}</Button>)}</div>}
  </section>;
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
  const pendingApproval = data?.approvals.find(item => item.status === "pending" && item.task_id === selectedTaskId) || data?.approvals.find(
    (item) => item.status === "pending",
  );
  const approvalTask = data?.tasks.find(
    (item) => item.id === pendingApproval?.task_id,
  );
  const pendingPublishingPackage = pendingApproval?.evidence.find(
    item => item.type === "publishing_approval_package",
  );
  const approvalDecisionKind: AgentDecisionKind = approvalTask?.task_key === "followup_batch_approval"
    ? "customer_outreach"
    : ["content_release_approval", "publishing_calendar", "platform_publish"].includes(approvalTask?.task_key || "")
      ? "publish_confirmation"
      : "content_approval";
  const approvalOutputCount = pendingPublishingPackage && Array.isArray(pendingPublishingPackage.items)
    ? pendingPublishingPackage.items.length
    : (data?.deliveries || []).filter(card => approvalTask && card.taskIds.includes(approvalTask.id)).length;
  const approvalBudget = data?.plan?.businessPackage?.operatingContext?.budget.totalCny;
  const activeHandoff = data?.handoffs.find((item) => item.status === "active");
  const activeHandoffTask = data?.tasks.find(
    (item) => item.id === activeHandoff?.task_id,
  );
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
  const selectedPlanTask = selectedTask
    ? data?.plan?.tasks.find(item => item.key === selectedTask.task_key)
    : undefined;
  const selectedTaskSource = selectedTask
    ? selectedTask.status_source || selectedPlanTask?.statusSource || String(selectedTask.output?.statusSource || "") || (selectedTask.business_refs?.length ? `${selectedTask.business_refs.length} 条业务记录` : "周计划任务包")
    : "等待任务";
  const selectedTaskResult = selectedTask ? outputSummary(selectedTask) || "结果生成后会持久化到对应业务页面" : "等待任务";
  const nextRuntimeTask = selectedTask
    ? [...visibleTasks].sort((left, right) => left.sequence - right.sequence).find(item => item.sequence > selectedTask.sequence)
    : undefined;
  const selectedTaskNext = selectedTask?.status === "waiting_approval"
    ? "完成当前决策后继续执行"
    : ["failed", "waiting_human", "handed_off"].includes(selectedTask?.status || "")
      ? "处理阻塞、重试或交还 Agent"
      : nextRuntimeTask
        ? `下一节点：${nextRuntimeTask.title}`
        : "前往对应业务页面查看最终结果";
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
        {weeklyStartConflict && !viewGoalId && <WeeklyStartConflictAlert conflict={weeklyStartConflict} onViewRun={() => void openConflictingRun()} />}
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
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <h1 className="workspace-title mt-2">
              数字员工正在等待调遣
            </h1>
            {data?.config && (
              <div className="flex flex-wrap items-stretch gap-2 text-xs text-text-secondary">
                <div className="min-w-52 rounded-lg border border-accent/25 bg-accent-glow px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-accent">当前工作模式</p>
                  <p className="mt-1 font-semibold text-text-primary">{autonomyLabel[data.config.autonomyMode]}模式 · {operatingState}</p>
                  <p className="mt-0.5 text-[10px] text-text-muted">{cycleLabel}</p>
                </div>
                <Button
                  htmlType="button"
                  onClick={() => setWorkspaceView("rules")}
                  className={`!h-auto min-h-9 !whitespace-normal inline-flex min-h-12 items-center gap-1.5 rounded-lg border px-4 py-2 font-bold transition ${workspaceView === "rules" ? "border-accent bg-accent text-white" : "border-accent bg-accent text-white hover:brightness-95"}`}
                >
                  <Settings2 size={13} /> Agent 设置
                </Button>
                <Button
                  htmlType="button"
                  onClick={() => {
                    setWorkspaceView("today");
                    setShowHistory((value) => !value);
                  }}
                  className="!h-auto min-h-9 !whitespace-normal inline-flex min-h-12 items-center gap-1.5 rounded-lg border border-accent/35 bg-white px-4 py-2 font-bold text-accent transition hover:border-accent hover:bg-accent-glow"
                >
                  <History size={13} /> 历史记录
                </Button>
              </div>
            )}
          </div>
          {!data?.config && <div className="mt-5 inline-flex items-center gap-2 border-l-2 border-accent bg-surface-2 px-3 py-2 text-xs font-semibold text-accent"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] text-text-primary">1</span>{operatingState}</div>}
        </header>

        {data?.config && <nav
          aria-label="数字员工工作视图"
          className="workspace-tabs mt-2"
        >
          {workspaceViews.map((view) => {
            const pendingCount = data.approvals.filter((item) => item.status === "pending").length;
            const caption = view.id === "live" && pendingCount ? `${pendingCount} 项待处理 · 任务与纠偏` : view.id === "review" && !data.review ? "数据积累中" : view.caption;
            return <Button
              key={view.id}
              htmlType="button"
              onClick={() => setWorkspaceView(view.id)}
              aria-current={workspaceView === view.id ? "page" : undefined}
              className="!h-auto min-h-9 !whitespace-normal workspace-tab min-w-[150px] px-1 py-2"
            >
              <span className="block text-xs font-semibold">{view.label}</span>
              <span
                className="mt-0.5 block text-[10px] text-slate-400"
              >
                {caption}
              </span>
            </Button>;
          })}
        </nav>}
        {data?.config && workspaceView === "overview" && <BusinessLineNav value={businessLine} platform={contentPlatform} onChange={setBusinessLine} onPlatformChange={setContentPlatform}/>}
        {navigationNotice && (
          <div
            role="status"
            className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-800"
          >
            <span className="flex items-center gap-2">
              <ChevronLeft size={15} />
              {navigationNotice}
            </span>
            <Button className="!h-auto min-h-9 !whitespace-normal"
              htmlType="button"
              onClick={() => setNavigationNotice("")}
              aria-label="关闭返回提示"
            >
              <XCircle size={16} />
            </Button>
          </div>
        )}
        {error && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span className="flex items-center gap-2">
              <AlertTriangle size={16} />
              {error}
            </span>
            <Button className="!h-auto min-h-9 !whitespace-normal" onClick={() => setError("")}>
              <XCircle size={17} />
            </Button>
          </div>
        )}

        {!data?.config && (
          <OnboardingPanel
            initial={EMPTY_CONFIG}
            readiness={data?.businessSnapshot?.readiness || []}
            busy={Boolean(busy)}
            onOpenReadiness={openReadiness}
            onNavigate={(page) => openBusiness(page)}
            onSave={saveConfig}
          />
        )}

        {data?.config && workspaceView === "today" && (
          <div className="mt-5 space-y-5">
            {viewGoalId && (
              <section className="rounded-lg border border-violet-200 bg-violet-50 p-5">
                <p className="text-sm font-semibold text-violet-900">
                  正在只读查看历史运行
                </p>
                <p className="mt-1 text-xs text-violet-700">
                  可以查看业务证据和复盘，但不会在历史目标上启动、审批或控制任务。
                </p>
              </section>
            )}
            {(!newGoal || Boolean(goal)) && <TodayFocusPanel
              data={presentedData || data}
              onOpenExecution={goLive}
              onReviewPlan={() => goLive()}
              runStatusLabel={status => statusLabel[status] || status}
            />}
            {showHistory && (
              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <History size={18} className="text-violet-600" />
                    <div>
                      <h2 className="text-sm font-semibold text-slate-950">
                        历史工作
                      </h2>
                      <p className="text-[11px] text-slate-400">
                        历史运行只读，不会自动推进任务状态
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={() => setShowHistory(false)}
                    className="!h-auto min-h-9 !whitespace-normal rounded-lg p-2 text-slate-400 hover:bg-slate-50"
                  >
                    <XCircle size={17} />
                  </Button>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                  {data.goals.map((historyGoal, index) => (
                    <Button
                      key={historyGoal.id}
                      htmlType="button"
                      onClick={() => void openGoal(historyGoal.id)}
                      className={`!h-auto min-h-9 !whitespace-normal rounded-lg border p-4 text-left transition hover:border-violet-300 ${data.goal?.id === historyGoal.id ? "border-violet-300 bg-violet-50/50" : "border-slate-200"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-bold text-slate-400">
                            {index === 0
                              ? "最近一轮"
                              : `历史第 ${index + 1} 轮`}
                          </p>
                          <p className="mt-1 text-sm font-bold text-slate-900">
                            {historyGoal.title}
                          </p>
                        </div>
                        <Badge status={historyGoal.status} />
                      </div>
                      <p className="mt-3 text-[11px] text-slate-500">
                        {historyGoal.startsAt} 至 {historyGoal.endsAt}
                      </p>
                    </Button>
                  ))}
                </div>
              </section>
            )}
            {viewGoalId && (
              <Button
                htmlType="button"
                onClick={() => void returnToLatest()}
                className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-1.5 text-xs font-bold text-slate-600"
              >
                <ChevronLeft size={14} />
                返回最近一轮工作
              </Button>
            )}
            {!viewGoalId && newGoal && !activeRun && (
              <div ref={goalPanelRef} className="scroll-mt-24">
                <GoalPanel
                  config={data.config}
                  busy={Boolean(busy)}
                  businessLine={businessLine}
                  contentPlatform={contentPlatform}
                  onOpenSettings={() => setWorkspaceView("rules")}
                  onSave={(goalInput) => void saveGoal(goalInput)}
                />
              </div>
            )}
            {!viewGoalId && goal && goal.status !== "draft" && (
              <div className="flex flex-col items-end gap-2">
                {canCreateNextGoal ? (
                  <Button
                    onClick={() => {
                      setNewGoal(true);
                      scrollTo(goalPanelRef);
                    }}
                    className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-xs font-bold text-white"
                  >
                    <Target size={14} />
                    制定下一周目标
                  </Button>
                ) : (
                  <p className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-500">
                    本轮目标仍在执行；完成或取消当前运行后才能制定下一周目标。
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {data?.config && workspaceView === "overview" && (
          <div className="mt-5">
            <ProductionProgressPanel
              deliveryBoard={data.plan && data.run && (
                <DeliveryBoard
                  onAccepted={() => { void load(); }}
                  tasks={data.run ? visibleTasks : []}
                  deliveries={data.deliveries}
                  focus={deliveryFocus}
                  notice={data.deliveryNotice}
                  goalTitle={data.goal?.title || "当前经营目标"}
                  events={data.events}
                  onSelectTask={(taskId) => {
                    setSelectedTaskId(taskId);
                    setWorkspaceView("live");
                  }}
                  onOpenTask={dispatchDigitalEmployeeDeepLink}
                  onOpenMonitor={onOpenMonitor}
                />
              )}
              period={productionPeriod}
              data={presentedData || data}
              onOpenPublishing={() => openBusiness("smartAssets", "publish")}
              onViewResults={() => {
                saveBusinessPageContext("home", businessLine === "customer_conversion" ? "crm" : "traffic");
                onViewResults?.();
              }}
              businessLine={businessLine}
              contentPlatform={contentPlatform}
              onManageGoal={() => {
                if (goal) { setWorkspaceView("live"); return; }
                setWorkspaceView("today");
                setNewGoal(true);
                scrollTo(goalPanelRef);
              }}
              rangeBusy={busy === "overview-range"}
              onPeriodChange={changeOverviewPeriod}
            />
          </div>
        )}

        {data?.config && workspaceView === "live" && (
          <div className="mt-5 space-y-5">
            {viewGoalId && <p className="rounded-lg bg-violet-50 p-4 text-xs text-violet-800">正在只读查看历史计划与执行情况。</p>}
            {data.plan?.businessPackage && !data.run && <WeeklyPackagePanel
              data={data} readOnly={Boolean(viewGoalId)} busy={Boolean(busy)} onOpen={openBusiness}
              onOpenNode={link => {
                if (link.page !== "digitalEmployees") { dispatchDigitalEmployeeDeepLink(link); return; }
                if (link.businessRef.taskKey === "weekly_review") { setWorkspaceView("review"); return; }
                if (link.taskId) {
                  setSelectedTaskId(link.taskId);
                  window.setTimeout(() => document.getElementById("task-production-scene")?.scrollIntoView({ behavior: getScrollBehavior(), block: "start" }), 50);
                } else {
                  document.getElementById("weekly-plan-preview")?.scrollIntoView({ behavior: getScrollBehavior(), block: "start" });
                }
              }}
              onLinkProject={async (taskId, projectId) => { if (!await act("link-project", () => digitalEmployeeApi.linkTaskProject(data.run!.id, taskId, projectId), true)) throw new Error("关联失败，请重试。"); }}
              onTask={taskId => { setSelectedTaskId(taskId); window.setTimeout(() => document.getElementById("task-production-scene")?.scrollIntoView({ behavior: getScrollBehavior(), block: "start" }), 50); }}
              onSave={async pack => Boolean(await act("save-package", () => digitalEmployeeApi.savePackage(goal!.id, pack), true))}
              onApprove={async revision => { await act("approve-goal", () => digitalEmployeeApi.approveGoal(goal!.id, revision), true); }}
            />}
            {!data.run && data.plan && <section id="weekly-plan-preview" className="scroll-mt-6 rounded-lg border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-bold">本周目标与执行计划</h2>
              <p className="mt-3 font-semibold">{goal?.title}</p>
              <p className="mt-2 text-sm text-slate-600">{goal?.objective}</p>
              <p className="mt-2 text-sm text-slate-600">{data.plan.strategy}</p>
              <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-slate-600">{(data.plan.successCriteria || []).map(item => <li key={item}>{item}</li>)}</ul>
            </section>}
            {!data.run && !data.plan && (
              <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-blue-200 bg-blue-50/50 px-5 py-4">
                <div><p className="text-sm font-bold text-blue-900">{goal ? "计划正在生成" : "还没有本周计划"}</p><p className="mt-1 text-xs text-blue-700">{goal ? "计划生成后，可在这里查看任务安排并确认启动。" : "先制定本周目标，系统会生成可确认的任务计划。"}</p></div>
                {!goal && !viewGoalId && <Button
                  onClick={() => { setWorkspaceView("today"); setNewGoal(true); scrollTo(goalPanelRef); }}
                  className="!h-auto min-h-9 !whitespace-normal rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white"
                >制定本周目标</Button>}
              </section>
            )}
            {data.plan && data.run && (
              <>
              <section className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="mb-3 flex items-center justify-between gap-3 px-1"><div><h2 className="text-sm font-bold text-slate-950">本轮 Agent</h2><p className="mt-1 text-[11px] text-slate-500">按执行顺序排列，点击查看对应生产进度</p></div><Button onClick={() => void load()} title="刷新生产现场" className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 bg-white p-2 text-slate-500"><RefreshCcw size={15} /></Button></div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {[...visibleTasks].sort((left, right) => left.sequence - right.sequence).map((item, index) => <Button key={item.id} htmlType="button" aria-pressed={selectedTask?.id === item.id} onClick={() => setSelectedTaskId(item.id)} className={`!h-auto min-h-9 !whitespace-normal flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left ${selectedTask?.id === item.id ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}><span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-slate-500">{index + 1}</span><span><span className="block text-xs font-bold text-slate-800">{agentLabel[item.agent_role] || "业务 Agent"}</span><span className="block max-w-44 truncate text-[10px] text-slate-400">{item.title}</span></span><Badge status={item.status} /></Button>)}
                </div>
              </section>
              <div className="grid gap-5">
                <div className="space-y-5">
                  <div id="task-production-scene" className="relative scroll-mt-6">
                    {selectedTask ? <div className="space-y-3">
                      <section className="rounded-lg border border-slate-200 bg-white p-4" aria-label="数字员工任务轨迹"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold tracking-[.14em] text-emerald-700">任务轨迹</p><h3 className="mt-1 text-sm font-semibold text-slate-950">{selectedTask.title}</h3></div><Button htmlType="button" onClick={() => dispatchDigitalEmployeeDeepLink(buildTaskDeepLink(selectedTask, selectedPlanTask, data.run!.id))} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-[10px] font-semibold text-white">下钻业务页面 <ArrowRight size={12}/></Button></div><dl className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{[{label:"当前节点",value:humanizeValue(selectedTask.status)},{label:"来源",value:selectedTaskSource},{label:"结果",value:selectedTaskResult},{label:"下一步",value:selectedTaskNext}].map(item=><div key={item.label} className="rounded-lg bg-slate-50 px-3 py-3"><dt className="text-[9px] font-bold text-slate-400">{item.label}</dt><dd className="mt-1 line-clamp-2 text-[11px] font-bold leading-5 text-slate-800">{item.value}</dd></div>)}</dl></section>
                      <ProductionTaskScene runId={data.run.id} taskId={selectedTask.id} embedded onOpenProduction={() => dispatchDigitalEmployeeDeepLink(buildTaskDeepLink(selectedTask, selectedPlanTask, data.run!.id))} />
                    </div> : <div className="rounded-lg border border-dashed border-slate-200 bg-white p-12 text-center text-sm text-slate-400">请选择上方 Agent 查看生产进度</div>}
                  </div>
                </div>
                <aside className="space-y-5">
                  {!viewGoalId && pendingApproval && approvalTask && (
                    <section id="delivery-approval" className="scroll-mt-6">
                      <AgentDecisionCard
                        kind={approvalDecisionKind}
                        title={approvalTask.title}
                        summary={pendingApproval.action_summary}
                        cost={approvalBudget !== undefined ? `本周预算 ¥${approvalBudget.toFixed(2)}` : "等待预算分配"}
                        outputs={{
                          count: approvalOutputCount,
                          format: approvalDecisionKind === "customer_outreach" ? "逐客消息" : approvalDecisionKind === "publish_confirmation" ? "平台发布" : "内容成品",
                          duration: data.plan?.businessPackage?.operatingContext?.outputs.totalDurationSeconds
                            ? `${data.plan.businessPackage.operatingContext.outputs.totalDurationSeconds} 秒`
                            : undefined,
                        }}
                        facts={[{ label: "计划版本", value: data.plan?.businessPackage ? `v${data.plan.businessPackage.revision}` : "当前任务" }, { label: "授权", value: data.plan?.businessPackage?.operatingContext?.authorization.mode === "bounded" ? "本周范围授权" : "逐次确认" }]}
                        note={approvalNote}
                        onNoteChange={setApprovalNote}
                        primary={{ label: "批准并继续", disabled: Boolean(busy), onClick: () => void act("approve", () => digitalEmployeeApi.decideApproval(pendingApproval.id, "approved", approvalNote)) }}
                        secondary={{ label: "退回修改", disabled: Boolean(busy), onClick: () => void act("reject", () => digitalEmployeeApi.decideApproval(pendingApproval.id, "rejected", approvalNote)) }}
                        tertiary={{ label: "人工完整接管", disabled: Boolean(busy), onClick: () => void act("handoff", () => digitalEmployeeApi.handoffTask(approvalTask.id)) }}
                      >
                      {approvalTask.task_key === "followup_batch_approval" && <div className="mt-3 max-h-80 space-y-2 overflow-auto rounded-lg border border-amber-200 bg-white p-3"><p className="text-xs font-bold text-amber-900">本次审批覆盖整个批次，请核对以下逐客草稿</p>{(data.deliveries || []).filter(card => card.kind === "客服草稿" && card.taskIds.includes(approvalTask.id)).map(card => <details key={card.id} className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-bold text-slate-800">{card.subject} · {card.stage}</summary><p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-600">{card.artifacts.find(artifact => artifact.id === "draft")?.text || "草稿尚未就绪"}</p>{card.reason && <p className="mt-2 text-xs text-amber-700">{card.reason}</p>}</details>)}</div>}
                      {pendingPublishingPackage && Array.isArray(pendingPublishingPackage.items) && <div className="mt-3 max-h-72 space-y-2 overflow-auto rounded-lg border border-amber-200 bg-white p-2">{(pendingPublishingPackage.items as Array<Record<string, unknown>>).map((item,index)=><div key={`${String(item.sourceProjectId)}-${String(item.platform)}-${index}`} className="rounded-lg bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-900">{String(item.title||`发布项 ${index+1}`)}</p><span className="rounded-md bg-blue-50 px-2 py-1 text-[9px] font-bold text-blue-700">{contentPlatformLabel[String(item.platform) as ContentPlatform]||String(item.platform)}</span></div><dl className="mt-2 grid gap-1 text-[10px] text-slate-600"><div><dt className="inline font-bold">账号：</dt><dd className="inline">{Array.isArray(item.accountLabels)?item.accountLabels.map(String).join("、"):"未绑定"}</dd></div><div><dt className="inline font-bold">文案：</dt><dd className="inline line-clamp-2">{String(item.description||"暂无文案")}</dd></div><div><dt className="inline font-bold">成片：</dt><dd className="inline break-all">{String(item.videoPath||"缺失")}</dd></div><div><dt className="inline font-bold">时间：</dt><dd className="inline">{String(item.scheduledAt||"")}</dd></div></dl></div>)}</div>}
                      </AgentDecisionCard>
                    </section>
                  )}
                  {!viewGoalId && activeHandoff && activeHandoffTask && (
                    <section className="rounded-lg border border-violet-200 bg-violet-50 p-5">
                      <div className="flex items-center gap-2 text-violet-800">
                        <Hand size={19} />
                        <h2 className="font-bold">人工接管中</h2>
                      </div>
                      <p className="mt-3 text-sm font-bold">
                        {activeHandoffTask.title}
                      </p>
                      <Button
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void act("return", () =>
                            digitalEmployeeApi.returnTask(
                              activeHandoffTask.id,
                              "人工核对完成，保持原审批边界继续",
                            ),
                          )
                        }
                        className="!h-auto min-h-9 !whitespace-normal mt-4 w-full rounded-lg bg-violet-700 px-3 py-2.5 text-xs font-bold text-white"
                      >
                        交还数字员工
                      </Button>
                    </section>
                  )}
                  {data.run && !terminal && !viewGoalId && (
                    <section className="rounded-lg border border-slate-200 bg-white p-5">
                      <div className="flex items-center gap-2">
                        <Clock3 size={18} />
                        <h2 className="font-bold">运行控制</h2>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        {data.run.status === "paused" ? (
                          <Button
                            onClick={() =>
                              void act("resume", () =>
                                digitalEmployeeApi.resumeRun(data.run!.id),
                              )
                            }
                            className="!h-auto min-h-9 !whitespace-normal rounded-lg bg-blue-700 px-3 py-2.5 text-xs font-bold text-white"
                          >
                            恢复
                          </Button>
                        ) : (
                          <Button
                            onClick={() =>
                              void act("pause", () =>
                                digitalEmployeeApi.pauseRun(data.run!.id),
                              )
                            }
                            className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-bold"
                          >
                            暂停
                          </Button>
                        )}
                        <Button
                          onClick={() =>
                            void act("cancel", () =>
                              digitalEmployeeApi.cancelRun(data.run!.id),
                            )
                          }
                          className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-red-200 px-3 py-2.5 text-xs font-bold text-red-700"
                        >
                          取消
                        </Button>
                      </div>
                    </section>
                  )}
                </aside>
              </div>
              </>
            )}
            {data.run && businessLine === "customer_conversion" && <BatchFollowupTruthPanel
              data={data}
              onOpen={openBusiness}
              statusLabel={statusLabel}
              busy={busy === "dispatch-followup"}
              onDispatch={
                viewGoalId
                  ? undefined
                  : (batchId) =>
                      void act("dispatch-followup", () =>
                        digitalEmployeeApi.dispatchFollowupBatch(batchId),
                      )
              }
            />}
          </div>
        )}

        {data?.config && workspaceView === "review" && (
          <div className="mt-5">
            <Suspense fallback={deferredWorkspaceFallback}><WeeklyReviewPanel
              data={presentedData || data}
              onGoLive={goLive}
              onOpen={openBusiness}
              onHistory={() => { setShowHistory(true); setWorkspaceView("today"); }}
              onGoal={goalId => { setViewGoalId(""); setWorkspaceView("live"); void load(goalId); }}
              period={productionPeriod}
              onPeriodChange={changeOverviewPeriod}
              rangeBusy={busy === "overview-range"}
            /></Suspense>
          </div>
        )}

        {data?.config && workspaceView === "rules" && (
          <div className="mt-5 space-y-5">
            <OnboardingPanel
              initial={data.config}
              readiness={data.businessSnapshot?.readiness || []}
              busy={Boolean(busy)}
              mode="rules"
              activeRun={activeRun}
              onOpenReadiness={openReadiness}
              onNavigate={(page) => openBusiness(page)}
              onSave={(config) => void saveConfig(config)}
            />
            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <ShieldCheck size={19} className="text-amber-600" />
                <h2 className="font-semibold text-slate-950">规则生效说明</h2>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-800">仅本次纠偏</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    只影响当前运行，可选择重跑下游。
                  </p>
                </div>
                <div className="rounded-lg bg-violet-50 p-4">
                  <p className="text-xs font-bold text-violet-800">
                    长期规则候选
                  </p>
                  <p className="mt-1 text-[11px] text-violet-700">
                    先记录候选，审核通过前不会改变自动化规则。
                  </p>
                </div>
                <div className="rounded-lg bg-amber-50 p-4">
                  <p className="text-xs font-bold text-amber-800">
                    外部动作红线
                  </p>
                  <p className="mt-1 text-[11px] text-amber-700">
                    发布、整批跟进和商业承诺按上方审批策略执行。
                  </p>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
