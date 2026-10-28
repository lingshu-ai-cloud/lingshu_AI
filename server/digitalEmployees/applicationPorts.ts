import type { createTaskBusinessObservation } from './taskBusinessObservation.js';
import type { createTaskBusinessPreparation } from './taskBusinessPreparation.js';
import type { createWeeklyReviewApplication } from './weeklyReviewApplication.js';
import type { createTaskInterventionApplication } from './taskInterventionApplication.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import type { Router, Response } from 'express';
import type { readAuthorizedWhatsAppCustomers as defaultGetWhatsAppCustomers } from '../whatsapp/authorizedCustomerRead.js';
import type { EnterpriseProfile } from '../routes/enterprise.js';
import type { buildBusinessSnapshot as defaultBuildBusinessSnapshot, BusinessSnapshot } from './businessSnapshot.js';
import type { ResolvedDigitalEmployeeConfiguration } from './configuration.js';
import type { evaluatePlannedReferenceReuse } from './viralAnalysisCoverage.js';
import type { ActiveWorkflowHandoff } from './workflowHandoffPolicy.js';
import type { createDigitalEmployeeContentPlanning } from '../routes/digitalEmployeeContentPlanning.js';
import type { createDigitalEmployeeOverviewReader } from '../routes/digitalEmployeeOverviewReader.js';
import type { goalInput } from './overviewProjection.js';
import type { DigitalEmployeeConfig } from './domain.js';
import type { ContentGenerationAuthorization } from '../../shared/contracts/contentGenerationAuthorization.js';
import type { ApprovalRecord, ConfigRecord, EventRecord, GoalRecord, HandoffRecord, PlanRecord, RunRecord, StoredRecord, TaskRecord } from './records.js';

export type ApprovalPreflight = {
  ready: boolean;
  reason: string;
  checks: Array<{ key: string; ready: boolean; detail: string }>;
  businessRefs: Array<Record<string, unknown>>;
};

/** Internal composition contracts. Each area receives only the ports it actually calls. */
export interface DigitalEmployeeApplicationPorts {
  first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort?: string): Promise<T | null>;
  digitalEmployeesRouter: Router;
  goalApprovalQueues: Map<string, Promise<void>>;
  tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null>;
  weeklyGoalFactRebuildTargetCommitted(tenantId: string, target: GoalRecord): Promise<boolean>;
  ensureWeeklyGoalFactRebuildAudit(input: {
    tenantId: string;
    userId: string;
    sourceGoalId: string;
    sourceGoalVersion: number;
    sourcePlanId: string;
    sourcePlanDigest: string;
    targetGoalId: string;
    targetPlanId: string;
    fromFactsVersion: string;
    toFactsVersion: string;
    configVersion: number;
    policyVersion: string;
    requestId: string;
  }): Promise<void>;
  buildOverview: ReturnType<typeof createDigitalEmployeeOverviewReader>['buildOverview'];
  resolveCurrentConfiguration(tenantId: string, record?: ConfigRecord | null): Promise<ResolvedDigitalEmployeeConfiguration | null>;
  configForTenant(tenantId: string): Promise<ConfigRecord | null>;
  weeklyGoalFactRebuildRecovery(goal: GoalRecord, plan: PlanRecord, expectedFactsVersion: string, factVersion: string): { recoveryAction: string; sourceGoalId: string; expectedGoalVersion: number; sourcePlanId: string; expectedFactsVersion: string; expectedSourcePlanDigest: string; factVersion: string };
  recommendPackageWithTenantEvidence(tenantId: string, goal: ReturnType<typeof goalInput>, config: DigitalEmployeeConfig, ownerId?: string, ownerName?: string, frozenProfile?: EnterpriseProfile): Promise<WeeklyPackage>;
  getWhatsAppCustomers: typeof defaultGetWhatsAppCustomers;
  frozenEnterpriseProfileForPlan(plan: PlanRecord | null, allowLegacy?: boolean): EnterpriseProfile | null;
  generateWeeklyTaskPreviews: ReturnType<typeof createDigitalEmployeeContentPlanning>['generateWeeklyTaskPreviews'];
  appendAudit(input: {
    tenantId: string;
    userId: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  listAllRecords<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort?: string): Promise<T[]>;
  appendEvent(input: {
    tenantId: string;
    runId: string;
    taskId?: string;
    type: string;
    level?: 'info' | 'warning' | 'error' | 'success';
    summary: string;
    payload?: Record<string, unknown>;
  }): Promise<EventRecord>;
  requiredCreate<T extends StoredRecord>(collection: string, payload: Record<string, unknown>): Promise<T>;
  executionConfigForPlan(plan: PlanRecord | null, fallback: DigitalEmployeeConfig): DigitalEmployeeConfig;
  restoreExecutionOnlyInvalidatedAuthorization(tenantId: string, goal: GoalRecord, run: RunRecord, plan: PlanRecord | null): Promise<boolean>;
  dependenciesReady(task: TaskRecord, tasks: TaskRecord[]): boolean;
  supersedeAffectedBusinessState(tenantId: string, run: RunRecord, affected: TaskRecord[], now: string): Promise<void>;
  bindWeeklyViralLibraryToPackage(input: {
    tenantId: string;
    run: RunRecord;
    goal: GoalRecord;
    plan: PlanRecord | null;
    config: DigitalEmployeeConfig;
    pack: WeeklyPackage;
  }): Promise<{ pack: WeeklyPackage; inventory: ReturnType<typeof evaluatePlannedReferenceReuse>; changed: boolean }>;
  buildBusinessSnapshot: typeof defaultBuildBusinessSnapshot;
  observeTaskProof: ReturnType<typeof createTaskBusinessObservation>['observeTaskProof'];
  approvalPreflight(tenantId: string, run: RunRecord, task: TaskRecord, tasks: TaskRecord[], snapshot: BusinessSnapshot): Promise<ApprovalPreflight>;
  applyPackageGrant(tenantId: string, goal: GoalRecord, run: RunRecord, task: TaskRecord, tasks: TaskRecord[], plan: PlanRecord | null): Promise<boolean>;
  createApproval(tenantId: string, goal: GoalRecord, run: RunRecord, task: TaskRecord, allTasks: TaskRecord[]): Promise<ApprovalRecord>;
  prepareObserveBusinessResource: ReturnType<typeof createTaskBusinessPreparation>['prepareObserveBusinessResource'];
  prepareContentBatchPlan: ReturnType<typeof createDigitalEmployeeContentPlanning>['prepareContentBatchPlan'];
  ensureContentBatchPlan: ReturnType<typeof createDigitalEmployeeContentPlanning>['ensureContentBatchPlan'];
  executeInTaskBrowser<T>(input: { tenantId: string; run: RunRecord; task: TaskRecord }, label: string, action: () => Promise<T>): Promise<T>;
  sourceCollectionFailureReason: ReturnType<typeof createDigitalEmployeeContentPlanning>['sourceCollectionFailureReason'];
  completeReview: ReturnType<typeof createWeeklyReviewApplication>['completeReview'];
  streamClients: Map<string, Set<Response>>;
  sendEvent(response: Response, event: EventRecord): void;
  committedDigitalEmployeeOperatingGoals(tenantId: string, goals: GoalRecord[]): Promise<GoalRecord[]>;
  activeWorkflowHandoffsForRun(tenantId: string, runId: string): Promise<HandoffRecord[]>;
  handoffPolicyIdentity(handoff: HandoffRecord): ActiveWorkflowHandoff;
  approveGoalForReview(tenantId: string, userId: string, goalId: string, packageRevision: number | undefined, members: Array<{id: string}>, authorization?: ContentGenerationAuthorization, overBudgetQuoteKey?: string): Promise<{ status: number; body: unknown }>;
  applyTaskControl: ReturnType<typeof createTaskInterventionApplication>['applyTaskControl'];
  queueDigitalEmployeeRunAdvance(tenantId: string, runId: string): void;
  resumeInitialPreparationPlan(tenantId: string, goalId: string, allowBlocked?: boolean): Promise<void>;
  appendAuthorizationRequiredEvent(input: {
    tenantId: string;
    runId: string;
    taskId?: string;
    reason: 'content_changed' | 'package_adjusted' | 'critical_business_change';
    changedFields?: string[];
  }): Promise<void>;
  advanceRun(tenantId: string, runId: string): Promise<void>;
  ensureFrozenEnterpriseProfileForRun(tenantId: string, plan: PlanRecord | null, fallbackConfig: DigitalEmployeeConfig, boundAt: string): Promise<EnterpriseProfile>;
}
