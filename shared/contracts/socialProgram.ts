export type SocialProgramRoute = 'cold_start' | 'account_repair';

export type SocialProgramStage =
  | 'needs_route'
  | 'needs_foundation'
  | 'needs_account_import'
  | 'diagnosing'
  | 'needs_benchmarks'
  | 'needs_acquisition_route'
  | 'needs_account_playbook'
  | 'needs_month_plan'
  | 'ready_for_week'
  | 'executing'
  | 'reviewing';

export type SocialPlatform = 'tiktok' | 'instagram' | 'youtube' | 'facebook' | 'douyin' | 'xiaohongshu' | 'other';

export interface VersionedSocialRef {
  type: string;
  id: string;
  version: number;
}

export interface SocialProgramReadiness {
  foundationConfirmed: boolean;
  accountImportConfirmed: boolean;
  diagnosisComplete: boolean;
  benchmarkRoundComplete: boolean;
  conversionRouteConfirmed: boolean;
  accountPlaybooksConfirmed: boolean;
  monthlyPlanActive: boolean;
  weeklyPlanActive: boolean;
  productionInProgress: boolean;
  reviewDue: boolean;
}

export interface SocialProgram {
  programId: string;
  brandName: string;
  businessLine: string | null;
  market: string;
  targetAudience: string;
  candidatePlatforms: SocialPlatform[];
  route: SocialProgramRoute | null;
  stage: SocialProgramStage;
  readiness: SocialProgramReadiness;
  enterpriseProfileRef: VersionedSocialRef | null;
  productMarketingProfileRefs: VersionedSocialRef[];
  activeMonthlyPlanRef: VersionedSocialRef | null;
  activeWeeklyPlanRef: VersionedSocialRef | null;
  activeWeeklyOperatingPackageRef: VersionedSocialRef | null;
  activeBusinessContentGoalRef?: VersionedSocialRef | null;
  version: number;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export const WEEKLY_OPERATING_WORKFLOW_KINDS = [
  'readiness',
  'discovery',
  'directing',
  'content',
  'publishing',
  'engagement',
  'review',
] as const;
export type WeeklyOperatingWorkflowKind = typeof WEEKLY_OPERATING_WORKFLOW_KINDS[number];

/** Default weekly video target for each account in the project matrix. */
export const DEFAULT_WEEKLY_PUBLICATIONS_PER_ACCOUNT: Record<Extract<SocialPlatform, 'facebook' | 'tiktok' | 'instagram' | 'youtube'>, number> = {
  facebook: 5,
  tiktok: 5,
  instagram: 3,
  youtube: 3,
};

export const WEEKLY_OPERATING_PACKAGE_STATUSES = ['draft', 'active', 'superseded', 'retired'] as const;
export type WeeklyOperatingPackageStatus = typeof WEEKLY_OPERATING_PACKAGE_STATUSES[number];
export type WeeklyOperatingWorkflowStatus = 'planned' | 'blocked' | 'in_progress' | 'completed' | 'cancelled';

export type WeeklyWorkflowTaskStatus = WeeklyOperatingWorkflowStatus;

export const WEEKLY_EXECUTION_TASK_STATUSES = [
  'pending_activation',
  'queued',
  'leased',
  'blocked',
  'succeeded',
  'cancelled',
  'dead_letter',
] as const;
export type WeeklyExecutionTaskStatus = typeof WEEKLY_EXECUTION_TASK_STATUSES[number];
export type WeeklyExecutionTaskScope = 'package' | 'content' | 'adaptation' | 'account' | 'publication';

export interface WeeklyExecutionTaskLease {
  leaseId: string;
  token: string;
  workerId: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface WeeklyExecutionTaskBudget {
  category: 'none' | 'discovery' | 'production';
  limitCny: number | null;
}

/**
 * Durable unit consumed by a worker. The snapshots and versioned references
 * deliberately make the task self-contained: a worker must never silently
 * read a newer package, policy or planning decision while executing it.
 */
export interface WeeklyExecutionTask {
  taskId: string;
  tenantId: string;
  programId: string;
  packageId: string;
  packageVersion: number;
  workflowKind: WeeklyOperatingWorkflowKind;
  scope: WeeklyExecutionTaskScope;
  subjectId: string;
  accountId: string | null;
  publicationTaskId: string | null;
  dependsOnTaskIds: string[];
  upstreamVersionRefs: VersionedSocialRef[];
  inputSnapshot: Record<string, unknown>;
  idempotencyKey: string;
  budget: WeeklyExecutionTaskBudget;
  status: WeeklyExecutionTaskStatus;
  ownBlockingReasons: string[];
  inheritedBlockingTaskIds: string[];
  attempt: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lease: WeeklyExecutionTaskLease | null;
  resultRefs: VersionedSocialRef[];
  lastError: { code: string; message: string; retryable: boolean; occurredAt: string } | null;
  recoveredFromDeadLetterAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WeeklyExecutionStatusSummary {
  total: number;
  byStatus: Record<WeeklyExecutionTaskStatus, number>;
  byWorkflow: Record<WeeklyOperatingWorkflowKind, WeeklyOperatingWorkflowStatus>;
  refreshedAt: string;
}

export interface WeeklyWorkflowTask {
  taskId: string;
  kind: WeeklyOperatingWorkflowKind;
  taskRef: VersionedSocialRef;
  dependsOnTaskIds: string[];
  subjectRefs: VersionedSocialRef[];
  status: WeeklyWorkflowTaskStatus;
  ownBlockingReasons: string[];
  inheritedBlockingTaskIds: string[];
  carriedFromTaskId: string | null;
}

export interface WeeklyWorkflowEvent {
  eventId: string;
  taskId: string;
  type: 'start' | 'complete' | 'block' | 'unblock' | 'cancel';
  reason?: string | null;
  occurredAt: string;
}

export interface WeeklyTaskVersionMapping {
  previousTaskId: string;
  nextTaskId: string | null;
  handling: 'carried' | 'replaced' | 'cancelled';
}

export interface WeeklyOperatingWorkflow {
  kind: WeeklyOperatingWorkflowKind;
  status: WeeklyOperatingWorkflowStatus;
  taskRefs: VersionedSocialRef[];
  blockingReasons: string[];
}

export interface SocialWeeklyPublicationTask {
  publicationTaskId: string;
  motherContentId: string;
  adaptationOfPublicationTaskId: string | null;
  platform: Extract<SocialPlatform, 'tiktok' | 'facebook' | 'instagram' | 'youtube'>;
  accountId: string;
  accountPositioning: string | null;
  businessProposition: string | null;
  cta: string | null;
  factRefs: VersionedSocialRef[];
  metricTargets: string[];
  publishWindow: string | null;
  status: 'planned' | 'blocked' | 'ready' | 'published' | 'cancelled';
}

export interface SocialWeeklyContentPackage {
  contentPackageId: string;
  operatingPackageId: string;
  version: number;
  status: WeeklyOperatingPackageStatus;
  originalContentTarget: number;
  adaptationVersionTarget: number;
  publicationTaskTarget: number;
  publicationTasks: SocialWeeklyPublicationTask[];
  weeklyBudgetCny: number | null;
  perItemBudgetCny: number | null;
  capacityNotes: string[];
  authorization: {
    mode: 'each' | 'bounded';
    accountIds: string[];
    maxPublishItems: number;
    weekStart: string;
    weekEnd: string;
    allowRealPublishing: boolean;
    authorizedBy: string | null;
    authorizedAt: string | null;
    revokedBy: string | null;
    revokedAt: string | null;
  };
}

export interface WeeklyOperatingPackage {
  packageId: string;
  programId: string;
  version: number;
  status: WeeklyOperatingPackageStatus;
  weekStart: string;
  weekEnd: string;
  objective: string;
  enterpriseProfileRef: VersionedSocialRef | null;
  businessContentGoalRef?: VersionedSocialRef | null;
  monthlyPlanRef: VersionedSocialRef | null;
  workflows: WeeklyOperatingWorkflow[];
  workflowTasks: WeeklyWorkflowTask[];
  /** Present on R3-aware reads; optional while older R1 consumers migrate. */
  executionTaskRefs?: VersionedSocialRef[];
  executionSummary?: WeeklyExecutionStatusSummary;
  appliedWorkflowEvents: WeeklyWorkflowEvent[];
  /** Independent append-only workflow stream version; absent only on legacy rows. */
  workflowStateVersion?: number;
  taskVersionMappings: WeeklyTaskVersionMapping[];
  planningBlockers: string[];
  capacityPlanRef: VersionedSocialRef | null;
  automationPolicyRef: VersionedSocialRef | null;
  operatingDecisionSnapshotRef?: VersionedSocialRef | null;
  referenceModeRef?: VersionedSocialRef | null;
  /** R6 output consumed as an explicit, versioned input to this plan. */
  promotionQuotaRef?: VersionedSocialRef | null;
  discoveryBudgetCny: number | null;
  socialContentPackage: SocialWeeklyContentPackage;
  successCriteria: string[];
  changeReason: string | null;
  previousVersion: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversionRoute {
  routeId: string;
  entryType: 'profile_link' | 'comment' | 'direct_message' | 'store' | 'form' | 'whatsapp' | 'other';
  entryRef: string | null;
  callToAction: string;
  qualificationFields: string[];
  handoffTarget: string | null;
  verifiedAt: string | null;
}

export interface OwnedSocialAccount {
  accountId: string;
  programId: string;
  platform: SocialPlatform;
  displayName: string;
  handle: string | null;
  businessRole: string;
  audiencePromise: string;
  contentPromise: string;
  status: 'planned' | 'active' | 'paused' | 'retired';
  connectionId: string | null;
  connectionCapabilities: string[];
  playbookRef: VersionedSocialRef | null;
  conversionRoute: ConversionRoute | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AccountPlaybook {
  playbookId: string;
  programId: string;
  accountId: string;
  version: number;
  audience: string[];
  pillars: string[];
  recurringFormats: string[];
  presenterRules: string[];
  visualRules: string[];
  evidenceRules: string[];
  languageRules: string[];
  fixedFactors: string[];
  experimentFactors: string[];
  conversionRoute: ConversionRoute;
  sourceRefs: VersionedSocialRef[];
  status: 'draft' | 'active' | 'retired';
  createdAt: string;
}

export interface SocialMonthlyPlan {
  planId: string;
  programId: string;
  version: number;
  month: string;
  objective: string;
  accountIds: string[];
  priorityProductRefs: VersionedSocialRef[];
  audiencePriorities: string[];
  contentMix: Array<{ format: string; count: number }>;
  experimentVariables: string[];
  budgetLimitCny: number | null;
  successCriteria: string[];
  sourceRefs: VersionedSocialRef[];
  status: 'draft' | 'active' | 'retired';
  createdAt: string;
}

export interface WeeklyContentItem {
  itemId: string;
  accountId: string;
  title: string;
  contentTask: string;
  cta: string;
  productMarketingProfileRef: VersionedSocialRef;
  referenceRefs: VersionedSocialRef[];
  factRefs: VersionedSocialRef[];
  dueAt: string | null;
  approvalPolicy: 'user_confirm' | 'owner_approve';
}

export interface SocialWeeklyPlan {
  planId: string;
  programId: string;
  monthlyPlanRef: VersionedSocialRef;
  version: number;
  weekStart: string;
  items: WeeklyContentItem[];
  budgetLimitCny: number | null;
  status: 'draft' | 'active' | 'retired';
  createdAt: string;
}

export interface SocialProgramActivationIssue {
  code: string;
  message: string;
}

export const EMPTY_SOCIAL_PROGRAM_READINESS: SocialProgramReadiness = {
  foundationConfirmed: false,
  accountImportConfirmed: false,
  diagnosisComplete: false,
  benchmarkRoundComplete: false,
  conversionRouteConfirmed: false,
  accountPlaybooksConfirmed: false,
  monthlyPlanActive: false,
  weeklyPlanActive: false,
  productionInProgress: false,
  reviewDue: false,
};

export function deriveSocialProgramStage(
  route: SocialProgramRoute | null,
  readiness: SocialProgramReadiness,
): SocialProgramStage {
  if (!route) return 'needs_route';
  if (route === 'cold_start' && !readiness.foundationConfirmed) return 'needs_foundation';
  if (route === 'account_repair' && !readiness.accountImportConfirmed) return 'needs_account_import';
  if (route === 'account_repair' && !readiness.diagnosisComplete) return 'diagnosing';
  if (!readiness.benchmarkRoundComplete) return 'needs_benchmarks';
  if (!readiness.conversionRouteConfirmed) return 'needs_acquisition_route';
  if (!readiness.accountPlaybooksConfirmed) return 'needs_account_playbook';
  if (!readiness.monthlyPlanActive) return 'needs_month_plan';
  if (!readiness.weeklyPlanActive) return 'ready_for_week';
  if (readiness.reviewDue) return 'reviewing';
  return 'executing';
}

export function monthlyPlanActivationIssues(program: SocialProgram): SocialProgramActivationIssue[] {
  const issues: SocialProgramActivationIssue[] = [];
  if (!program.readiness.foundationConfirmed) issues.push({ code: 'foundation_missing', message: '企业、市场、目标受众和产品营销档案尚未确认。' });
  if (program.route === 'account_repair' && !program.readiness.diagnosisComplete) issues.push({ code: 'diagnosis_missing', message: '已有账号诊断尚未完成。' });
  if (!program.readiness.benchmarkRoundComplete) issues.push({ code: 'benchmark_missing', message: '至少需要完成一轮对标账号试采。' });
  if (!program.readiness.conversionRouteConfirmed) issues.push({ code: 'conversion_route_missing', message: '获客路径尚未确认。' });
  if (!program.readiness.accountPlaybooksConfirmed) issues.push({ code: 'account_playbook_missing', message: '自有账号矩阵和账号规则尚未确认。' });
  return issues;
}

export function weeklyPlanActivationIssues(program: SocialProgram, plan: SocialWeeklyPlan): SocialProgramActivationIssue[] {
  const issues: SocialProgramActivationIssue[] = [];
  if (!program.readiness.monthlyPlanActive || program.activeMonthlyPlanRef?.id !== plan.monthlyPlanRef.id) {
    issues.push({ code: 'monthly_plan_missing', message: '周计划必须绑定当前活动月计划。' });
  }
  for (const item of plan.items) {
    if (!item.accountId) issues.push({ code: `item_account_missing:${item.itemId}`, message: `内容 ${item.title || item.itemId} 未绑定账号。` });
    if (!item.cta) issues.push({ code: `item_cta_missing:${item.itemId}`, message: `内容 ${item.title || item.itemId} 未绑定 CTA。` });
    if (!item.factRefs.length) issues.push({ code: `item_fact_missing:${item.itemId}`, message: `内容 ${item.title || item.itemId} 没有事实来源。` });
  }
  return issues;
}
