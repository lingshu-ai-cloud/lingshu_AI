import type { Request, Response } from 'express';
import type { AuthLocals } from '../middleware/auth.js';
import { requestOrganizationRoleStrict } from '../lib/organizationRole.js';
import { resolveServerProductProfile } from '../starter198/productProfile.js';
import { starter198OrgRole } from '../starter198/profile.js';
import { starter198Repository } from '../starter198/repository.js';
import { buildStarter198Workspace } from '../starter198/workspace.js';
import { readStarterProductionModel } from '../starter198/productionReadModel.js';

type Workspace = Record<string, any>;

export interface MobileWorkbenchProductAdapter {
  kind(req: Request, res: Response): Promise<'starter_198' | 'advanced_customer'>;
  starterWorkspace(req: Request, res: Response): Promise<Workspace>;
}

export function createMobileWorkbenchProductAdapter(): MobileWorkbenchProductAdapter {
  return {
    async kind(_req, res) {
      const { tenantId } = res.locals as AuthLocals;
      return resolveServerProductProfile(tenantId);
    },
    async starterWorkspace(req, res) {
      const { tenantId, userId } = res.locals as AuthLocals;
      const role = starter198OrgRole(await requestOrganizationRoleStrict(req.headers.authorization, userId));
      if (!role) throw new Error('starter_198_role_required');
      // This is a projection over the same authoritative read model used by the
      // desktop starter workspace. Capability flags only expose actions backed
      // by the already-mounted starter command routes.
      return buildStarter198Workspace({
        tenantId,
        role,
        repository: starter198Repository,
        orchestratorAvailable: true,
        decisionAvailable: true,
        quoteDecisionAvailable: true,
        quoteEvidenceAvailable: true,
        quoteSelfServiceAvailable: true,
        setupAvailable: true,
        loadProductionReadModel: readStarterProductionModel,
      });
    },
  };
}

function unknownMetric(range: Record<string, unknown>, source: string, note: string) {
  return { value: null, availability: 'unavailable', range, source, note };
}

export function starterWorkspaceOverview(workspace: Workspace, range: Record<string, unknown>) {
  const today = workspace.today || {};
  const rows = [...(today.completed || []), ...(today.inProgress || []), ...(today.nextSteps || [])];
  const tasks = [...new Map(rows.map((item: any) => [String(item.id), item])).values()].map((item: any) => ({
    id: String(item.id), title: String(item.what || ''), status: String(item.status || 'unknown'),
    agentRole: String(item.ownerAgent || ''), runId: workspace.run?.id ? String(workspace.run.id) : null,
    updatedAt: item.updatedAt ? String(item.updatedAt) : null, version: item.version == null ? null : Number(item.version),
    summary: String(item.why || item.output || ''), next: String(item.next || ''), actions: item.actions || [],
  }));
  const note = `当前工作周期：${workspace.run?.cycleLabel || '尚未开工'}。该读模型未提供自然周聚合。`;
  return {
    generatedAt: workspace.generatedAt || new Date().toISOString(), scope: 'authenticated_tenant', range,
    workspace: { cycleLabel: workspace.run?.cycleLabel || null, note },
    metrics: {
      tasks: unknownMetric(range, 'starter198.workspace', note), completed: unknownMetric(range, 'starter198.workspace', note),
      publishedVideos: unknownMetric(range, 'starter198.workspace', note), exposure: unknownMetric(range, 'starter198.workspace', note),
      qualifiedInquiries: unknownMetric(range, 'starter198.workspace', note),
    },
    agents: { availability: 'available', coverage: 'starter_workspace_agents', items: (workspace.agents || []).map((agent: any) => ({
      role: String(agent.role || ''), status: String(agent.status || 'unknown'), currentTask: agent.stage ? { id: null, title: String(agent.stage), status: String(agent.status || 'unknown'), runId: workspace.run?.id || null } : null,
      openTaskCount: null, updatedAt: workspace.generatedAt || null, source: 'starter198.workspace', displayName: String(agent.displayName || ''),
    })) },
    taskDrilldown: { availability: 'available', source: 'starter198.workspace.today', range, total: tasks.length, items: tasks },
    contentSchedule: { availability: 'unavailable', source: 'starter198.workspace', range, items: [], note },
    inquiryDrilldown: { availability: 'unavailable', source: 'starter198.workspace', range, total: null, items: [], note },
  };
}

export function starterWorkspaceQueue(workspace: Workspace) {
  const today = workspace.today || {};
  const nextSteps = (today.nextSteps || []).filter((item: any) => (item.actions || []).some((action: any) => !action.disabledReason));
  const matters = [
    ...(workspace.decisions || []).map((item: any) => ({ id: `starter:${item.id}`, title: item.title, reason: item.summary, priority: ['L2', 'L3'].includes(item.riskLevel) ? 'high' : 'normal', dueAt: item.dueAt, subject: item, actions: item.actions || [] })),
    ...nextSteps.map((item: any) => ({ id: `starter:${item.id}`, title: item.what, reason: item.why || item.next, priority: 'normal', createdAt: item.updatedAt, subject: item, actions: item.actions || [] })),
  ];
  return { matters: [...new Map(matters.map((item: any) => [item.id, item])).values()], generatedAt: workspace.generatedAt || new Date().toISOString(), scope: 'authenticated_tenant' };
}
