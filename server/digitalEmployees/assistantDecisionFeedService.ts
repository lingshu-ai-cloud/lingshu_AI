import type { Request } from 'express';
import { buildAssistantDecisionFeed, mergeAssistantDecisionFeeds, starterDecisionCards, taskWithAssistantProductionInput } from './assistantDecisionCenter.js';
import { managedReplicationPresenterReadiness } from './replicationContentProduction.js';
import { buildStarter198Workspace } from '../starter198/workspace.js';
import { starter198Repository } from '../starter198/repository.js';
import { starter198OrgRole } from '../starter198/profile.js';
import { requestOrganizationRoleStrict } from '../lib/organizationRole.js';
import { store } from '../storage/index.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, type ApprovalRecord, type GoalRecord, type PlanRecord, type RunRecord, type StoredRecord, type TaskRecord } from '../routes/digitalEmployeeRecords.js';
import type { AuthLocals } from '../middleware/auth.js';
import type { AssistantDecisionFeed, AssistantDecisionPage } from '../../shared/contracts/assistantDecisionCenter.js';

type FeedReadPorts = {
  committedGoals: (tenantId: string, goals: GoalRecord[]) => Promise<GoalRecord[]>;
  first: <T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort?: string) => Promise<T | null>;
  tenantRecord: <T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string) => Promise<T | null>;
};

/** Assemble the authenticated decision feed without owning route-level command writes. */
export function createAssistantDecisionFeedForRequest({ committedGoals, first, tenantRecord }: FeedReadPorts) {
  async function buildDigitalEmployeeAssistantFeed(
    tenantId: string,
    page: AssistantDecisionPage,
    requestedGoalId = '',
    limit = 3,
  ): Promise<AssistantDecisionFeed> {
    const goalResult = await store.list<GoalRecord>(COLLECTION.goals, {
      where: { tenant_id: tenantId }, sort: '-created_at', page: 1, perPage: 500,
    });
    const goals = await committedGoals(tenantId, goalResult.items);
    const goal = requestedGoalId
      ? goals.find(item => item.id === requestedGoalId) ?? null
      : goals.find(item => ['draft', 'pending_approval', 'active', 'paused'].includes(item.status)) ?? goals[0] ?? null;
    if (!goal) {
      return buildAssistantDecisionFeed({ page, goal: null, plan: null, run: null, tasks: [], approvals: [], limit });
    }
    const [plan, run] = await Promise.all([
      first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goal.id }),
      first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: goal.id }, '-started_at'),
    ]);
    const taskResult = run
      ? await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, sort: 'sequence', perPage: 100 })
      : { items: [] as TaskRecord[] };
    const approvalResult = run
      ? await store.list<ApprovalRecord>(COLLECTION.approvals, { where: { tenant_id: tenantId, run_id: run.id, status: 'pending' }, sort: '-created_at', perPage: 100 })
      : { items: [] as ApprovalRecord[] };
    const productionProjectIds = [...new Set(taskResult.items.flatMap(task => {
      const output = jsonObject<Record<string, unknown>>(task.output, {});
      const refs = [
        ...jsonObject<Array<Record<string, unknown>>>(task.business_refs, []),
        ...(Array.isArray(output.businessRefs) ? output.businessRefs as Array<Record<string, unknown>> : []),
      ];
      return refs
        .filter(ref => ref?.type === 'studio_project')
        .map(ref => String(ref.id || ref.entityId || '').trim())
        .filter(Boolean);
    }))];
    const [productionProjects, productionDefaults] = await Promise.all([
      Promise.all(productionProjectIds.map(projectId =>
        tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', projectId, tenantId))),
      store.list<StoredRecord>('studio_production_defaults', {
        where: { tenant_id: tenantId }, page: 1, perPage: 2,
      }),
    ]);
    const presenterReadiness = productionDefaults.items.length === 1
      ? managedReplicationPresenterReadiness(jsonObject<Record<string, unknown>>(productionDefaults.items[0]!.payload, {}))
      : productionDefaults.items.length === 0
        ? managedReplicationPresenterReadiness({})
        : { state: 'production_setup_required' as const, presenterCount: 0, presenterId: '', presenterName: '' };
    const { recoverIndependentContentTask } = await import('../assistant/independentWeeklyContent.js');
    for (const task of taskResult.items.filter(t => jsonObject<Record<string, unknown>>(t.output, {}).assistantIndependent)) {
      const project = productionProjects.find(p => p && jsonObject<Record<string, unknown>>(p.spec, {}).workflowTaskId === task.id);
      if (project) await recoverIndependentContentTask(store, tenantId, task as any, project as any);
    }
    const assistantTasks = taskResult.items.map(task => taskWithAssistantProductionInput(
      task,
      productionProjects.filter((project): project is StoredRecord & { tenant_id: string } => Boolean(project)),
      presenterReadiness,
    ));
    return buildAssistantDecisionFeed({ page, goal, plan, run, tasks: assistantTasks, approvals: approvalResult.items, limit });
  }

  async function buildStarterAssistantCards(req: Request, tenantId: string, userId: string) {
    try {
      const role = starter198OrgRole(await requestOrganizationRoleStrict(req.headers.authorization, userId));
      if (!role) return [];
      const workspace = await buildStarter198Workspace({
        tenantId,
        role,
        repository: starter198Repository,
        decisionAvailable: true,
        quoteDecisionAvailable: true,
      });
      return starterDecisionCards(workspace.decisions);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (['starter_198_workspace_not_entitled', 'starter_198_not_provisioned'].includes(code)) return [];
      throw error;
    }
  }

  return async function assistantDecisionFeedForRequest(
    req: Request,
    identity: AuthLocals,
    page: AssistantDecisionPage,
    requestedGoalId = '',
    limit = 3,
  ): Promise<AssistantDecisionFeed> {
    const [base, starterCards] = await Promise.all([
      buildDigitalEmployeeAssistantFeed(identity.tenantId, page, requestedGoalId, limit),
      buildStarterAssistantCards(req, identity.tenantId, identity.userId),
    ]);
    return mergeAssistantDecisionFeeds(base, starterCards, limit);
  };
}
