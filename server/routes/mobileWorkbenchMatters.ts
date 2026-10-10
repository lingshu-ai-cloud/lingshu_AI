import { Router, type Request, type Response } from 'express';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { enforceSupportSessionReadOnly, type AuthLocals } from '../middleware/auth.js';
import { requestOrganizationRoleStrict, type OrganizationRole } from '../lib/organizationRole.js';
import { jsonObject } from './digitalEmployeeRecords.js';
import { createExternalReplyAdapter } from '../mobileWorkbenchInterventions/externalReply.js';
import { createMaterialConnectionInterventions } from '../mobileWorkbenchInterventions/materialConnection.js';
import { productionRepairDetail } from '../mobileWorkbenchInterventions/repairProduction.js';
import { mobileWorkbenchActionCapabilityAllowed, type MobileWorkbenchActionKind } from './mobileWorkbenchActions.js';

type MatterDetail = Record<string, any> & { actionOptions?: Array<Record<string, any>> };
type MatterKind = 'approval' | 'task' | 'shoot' | 'external' | 'conversation' | 'connection';

const text = (value: unknown, max = 240) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const subjectVersion = (row: Record_) => String(row.subject_version ?? row.task_version ?? row.version ?? row.updated_at ?? row.updated ?? '');

function parseMatterId(value: unknown): { kind: MatterKind; targetId: string } | null {
  const match = /^(approval|task|shoot|external|conversation|connection):([A-Za-z0-9:._-]{1,200})$/.exec(text(value));
  return match ? { kind: match[1] as MatterKind, targetId: match[2] } : null;
}

function applyCapabilities(detail: MatterDetail, role: OrganizationRole | null): MatterDetail {
  return { ...detail, actionOptions: (detail.actionOptions || []).map(option => {
    const kind = text(option.kind) as MobileWorkbenchActionKind;
    if (!option.enabled || mobileWorkbenchActionCapabilityAllowed(role, kind)) return option;
    return { ...option, enabled: false, disabledReason: '当前组织角色无权执行此操作' };
  }) };
}

export interface MobileWorkbenchMatterDependencies {
  productionDetail?: (input: { tenantId: string; targetId: string }) => Promise<MatterDetail>;
  resolveRole?: (request: Request, userId: string) => Promise<OrganizationRole | null>;
}

export function createMobileWorkbenchMattersRouter(store: DataStore, dependencies: MobileWorkbenchMatterDependencies = {}) {
  const router = Router();
  const external = createExternalReplyAdapter({ dataStore: store });
  // Resume callbacks are deliberately absent until the corresponding production
  // checkpoint services exist. Their action options therefore fail closed.
  const materialConnection = createMaterialConnectionInterventions({ store });
  const resolveRole = dependencies.resolveRole ?? ((request: Request, userId: string) => requestOrganizationRoleStrict(request.headers.authorization, userId));
  router.use(enforceSupportSessionReadOnly);
  router.get('/matters/:matterId', async (req, res: Response) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const parsed = parseMatterId(req.params.matterId);
    if (!parsed) { res.status(400).json({ error: 'mobile_matter_id_invalid' }); return; }
    try {
      const role = await resolveRole(req, userId);
      let detail: MatterDetail;
      if (parsed.kind === 'approval') {
        const approval = await store.getById<Record_>('approval_requests', parsed.targetId);
        if (!approval || approval.tenant_id !== tenantId) { res.status(404).json({ error: 'mobile_matter_not_found' }); return; }
        const enabled = approval.status === 'pending';
        detail = { matterId: req.params.matterId, subjectVersion: subjectVersion(approval), title: text(approval.title) || '确认任务决定',
          whyUser: text(approval.action_summary) || '该操作需要有权限的负责人确认', blockingImpact: '确认前关联任务保持等待',
          source: { entityId: approval.id, taskId: approval.task_id || null, type: 'approval_request' }, evidence: approval.evidence || [],
          actionOptions: [
            { id: 'approve', label: '同意并继续', kind: 'approval_decision', enabled, disabledReason: enabled ? '' : '该决定已处理', payload: { decision: 'approved' } },
            { id: 'reject', label: '拒绝', kind: 'approval_decision', enabled, disabledReason: enabled ? '' : '该决定已处理', payload: { decision: 'rejected' }, fields: [{ key: 'note', label: '原因', type: 'text', required: false }] },
          ] };
      } else if (parsed.kind === 'shoot') {
        detail = await materialConnection.materialDetail({ tenantId, userId }, { matterId: req.params.matterId, shootingTaskId: parsed.targetId });
      } else if (parsed.kind === 'external') {
        detail = await external.detail({ tenantId, targetId: parsed.targetId, type: 'external' });
      } else if (parsed.kind === 'conversation') {
        detail = await external.detail({ tenantId, targetId: parsed.targetId, type: 'conversation' });
      } else if (parsed.kind === 'connection') {
        const account = await store.getById<Record_>('social_accounts', parsed.targetId);
        if (!account || text(account.tenantId ?? account.tenant_id) !== tenantId) { res.status(404).json({ error: 'mobile_matter_not_found' }); return; }
        detail = await materialConnection.connectionDetail({ tenantId, userId }, { matterId: req.params.matterId, accountId: parsed.targetId,
          requiredScopes: [], affectedTaskIds: [] });
      } else {
        const task = await store.getById<Record_>('workflow_tasks', parsed.targetId);
        if (!task || task.tenant_id !== tenantId) { res.status(404).json({ error: 'mobile_matter_not_found' }); return; }
        const output = jsonObject<Record<string, any>>(task.output, {});
        const interventionType = text(output.interventionType ?? output.intervention_type);
        const qualityRepair = interventionType === 'quality_recovery' || task.task_key === 'content_quality_gate';
        const accountId = text(output.accountId ?? output.account_id ?? output.socialAccountId);
        const shootingTaskId = text(output.shootingTaskId ?? output.shooting_task_id);
        const packageId = text(output.packageId ?? output.package_id ?? output.publicationPackageId);
        const conversationId = text(output.conversationId ?? output.conversation_id);
        if (qualityRepair) detail = await (dependencies.productionDetail ?? productionRepairDetail)({ tenantId, targetId: parsed.targetId });
        else if (interventionType === 'authorization' && accountId) detail = await materialConnection.connectionDetail({ tenantId, userId }, {
          matterId: req.params.matterId, accountId, requiredScopes: Array.isArray(output.requiredScopes) ? output.requiredScopes.map(String) : [],
          affectedTaskIds: Array.isArray(output.affectedTaskIds) ? output.affectedTaskIds.map(String) : [parsed.targetId], checkpointId: text(output.checkpointId),
        });
        else if (interventionType === 'material' && shootingTaskId) detail = await materialConnection.materialDetail({ tenantId, userId }, {
          matterId: req.params.matterId, shootingTaskId, checkpointId: text(output.checkpointId),
        });
        else if (interventionType === 'external_completion' && packageId) detail = await external.detail({ tenantId, targetId: packageId, type: 'external' });
        else if (interventionType === 'conversation' && conversationId) detail = await external.detail({ tenantId, targetId: conversationId, type: 'conversation' });
        else detail = await external.detail({ tenantId, targetId: parsed.targetId, type: 'resume' });
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ contractVersion: 1, matter: applyCapabilities({ ...detail, matterId: req.params.matterId }, role), serverTime: new Date().toISOString() });
    } catch (error) {
      const code = error instanceof Error ? text((error as any).code || error.message, 160) : 'mobile_matter_unavailable';
      if (/not_found/.test(code)) { res.status(404).json({ error: code }); return; }
      if (/ambiguous|version_conflict|not_actionable/.test(code)) { res.status(409).json({ error: code }); return; }
      res.status(503).json({ error: code || 'mobile_matter_unavailable' });
    }
  });
  return router;
}
