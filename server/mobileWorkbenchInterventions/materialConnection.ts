import type { DataStore } from '../storage/datastore.js';
import { readMaterialLibrary, accessibleMaterial, type MaterialRecord } from '../lib/materialLibrary.js';
import { isReferenceOnlyMaterial } from '../lib/materialPolicy.js';
import type { ScriptGapTask } from '../../src/lib/shootingWorkflow.js';

type Scope = { tenantId: string; userId: string };
type ShootingRecord = { id: string; tenant_id: string; payload: ScriptGapTask; updated?: string };
type Account = { id: string; tenantId: string; platform: string; title: string; status: string; scope?: string; tokenExpiresAt?: string; lastSyncAt?: string };
export class InterventionUnavailable extends Error { constructor(public code: string) { super(code); } }
export interface MaterialConnectionDependencies {
  store: DataStore;
  /** Must validate tenant ownership, usage rights and footage requirements against actual media metadata. */
  validateMaterials?(input: Scope & { task: ScriptGapTask; materialIds: string[] }): Promise<{ valid: boolean; issues: string[] }>;
  /** Only provide when a real checkpoint-aware domain operation exists. */
  readMaterials?: typeof readMaterialLibrary;
  resumeMaterials?: (input: Scope & { shootingTaskId: string; materialIds: string[]; checkpointId: string }) => Promise<unknown>;
  verifyConnection?: (input: Scope & { accountId: string; requiredScopes: string[] }) => Promise<{ valid: boolean; missingScopes: string[]; checkedAt: string }>;
  resumeConnection?: (input: Scope & { accountId: string; checkpointId: string }) => Promise<unknown>;
}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export function validateMaterialForTask(item: MaterialRecord, tenantId: string, task: ScriptGapTask): string[] {
  const issues: string[] = [];
  if (!accessibleMaterial(item, tenantId) || isReferenceOnlyMaterial(item)) issues.push('material_not_usable');
  if (item.type !== 'video') issues.push('video_required');
  if (!Number.isFinite(Number(item.duration)) || Number(item.duration) < task.suggestedDurationSec) issues.push('duration_too_short');
  if (task.ratio) {
    const [w, h] = task.ratio.split(':').map(Number);
    const actual = Number(item.width) / Number(item.height);
    if (!Number.isFinite(actual) || Math.abs(actual - w / h) / (w / h) > 0.05) issues.push('aspect_ratio_mismatch');
  }
  if (task.soundMode === 'source' && (!text(item.transcript) || !text(task.expectedNarration) || !text(item.transcript).includes(text(task.expectedNarration)))) issues.push('source_narration_unverified');
  return issues;
}
export function createMaterialConnectionInterventions(deps: MaterialConnectionDependencies) {
  const locks = new Map<string, Promise<unknown>>();
  async function shooting(scope: Scope, id: string) {
    const record = await deps.store.getById<ShootingRecord>('studio_shooting_tasks', id);
    if (!record || record.tenant_id !== scope.tenantId) throw new InterventionUnavailable('material_task_not_found');
    return record;
  }
  async function account(scope: Scope, id: string) {
    const record = await deps.store.getById<Account>('social_accounts', id);
    if (!record || record.tenantId !== scope.tenantId) throw new InterventionUnavailable('connection_account_not_found');
    return record;
  }
  return {
    async materialDetail(scope: Scope, input: { matterId: string; shootingTaskId: string; checkpointId?: string }) {
      const record = await shooting(scope, input.shootingTaskId);
      const library = await (deps.readMaterials || readMaterialLibrary)(scope.tenantId);
      const eligible = library.items.filter(item => validateMaterialForTask(item, scope.tenantId, record.payload).length === 0);
      const enabled = Boolean(deps.resumeMaterials && input.checkpointId && library.status === 'ready');
      return { matterId: input.matterId, subjectVersion: record.updated || record.payload.createdAt,
        title: record.payload.title, whyUser: '任务需要不可替代的实拍素材', blockingImpact: '素材校验通过前暂停关联分镜',
        materials: { shootingTaskId: record.id, requirements: record.payload.requirements || record.payload.shotBrief,
          durationSec: record.payload.suggestedDurationSec, ratio: record.payload.ratio, soundMode: record.payload.soundMode,
          libraryStatus: library.status, items: eligible.slice(0, 100).map(item => ({ id: item.id, title: text(item.title) || text(item.name), validationSummary: '使用权限、时长和比例符合要求' })), hasMore: eligible.length > 100, uploadedMaterialIds: record.payload.uploadedMaterialIds, uploadRoute: '/api/overseas/studio/materials/file' },
        resume: { checkpointId: input.checkpointId || null, available: enabled },
        actionOptions: [{ id: 'material_fulfillment', label: '校验素材并继续', kind: 'material_fulfillment', enabled, fields: [{key:'materialIds',label:'素材',type:'materials',required:true}],
          disabledReason: enabled ? null : '当前任务没有可恢复的素材检查点', payload: { shootingTaskId: record.id, checkpointId: input.checkpointId || null, materialIds: [] } }] };
    },
    async fulfillMaterials(scope: Scope, payload: { shootingTaskId: string; materialIds: string[]; checkpointId: string; expectedVersion: string }) {
      if (!Array.isArray(payload.materialIds) || !payload.materialIds.length || payload.materialIds.length > 20 || payload.materialIds.some(id => !text(id))) throw new InterventionUnavailable('material_ids_invalid');
      if (!deps.resumeMaterials || !text(payload.checkpointId)) throw new InterventionUnavailable('material_resume_unavailable');
      const key = `${scope.tenantId}:${payload.shootingTaskId}`;
      const operation = (locks.get(key) || Promise.resolve()).catch(() => undefined).then(async () => {
        const record = await shooting(scope, payload.shootingTaskId);
        if ((record.updated || record.payload.createdAt) !== payload.expectedVersion) throw new InterventionUnavailable('material_task_version_conflict');
        const ids = [...new Set(payload.materialIds)];
        const validation = deps.validateMaterials ? await deps.validateMaterials({ ...scope, task: record.payload, materialIds: ids }) : await (async () => {
          const library = await (deps.readMaterials || readMaterialLibrary)(scope.tenantId);
          if (library.status !== 'ready') throw new InterventionUnavailable('material_library_unavailable');
          const issues = ids.flatMap(id => { const item = library.items.find(item => item.id === id); return item ? validateMaterialForTask(item, scope.tenantId, record.payload).map(issue => `${id}:${issue}`) : [`${id}:not_found`]; });
          return { valid: issues.length === 0, issues };
        })();
        if (!validation.valid) throw new InterventionUnavailable(`material_validation_failed:${validation.issues.join(',')}`);
        const uploadedMaterialIds = [...new Set([...record.payload.uploadedMaterialIds, ...ids])];
        if (!await deps.store.update('studio_shooting_tasks', record.id, { payload: { ...record.payload, uploadedMaterialIds } })) throw new InterventionUnavailable('material_association_failed');
        const resumed = await deps.resumeMaterials!({ ...scope, shootingTaskId: record.id, materialIds: ids, checkpointId: payload.checkpointId });
        return { shootingTaskId: record.id, materialIds: ids, validation, resumed };
      });
      locks.set(key, operation);
      try { return await operation; } finally { if (locks.get(key) === operation) locks.delete(key); }
    },
    async connectionDetail(scope: Scope, input: { matterId: string; accountId: string; requiredScopes: string[]; affectedTaskIds: string[]; checkpointId?: string }) {
      const record = await account(scope, input.accountId);
      const scopes = (record.scope || '').split(/[ ,]+/).filter(Boolean);
      const missingScopes = input.requiredScopes.filter(item => !scopes.includes(item));
      const supported = ['tiktok', 'instagram', 'facebook'].includes(record.platform);
      const enabled = Boolean(deps.verifyConnection && deps.resumeConnection && input.checkpointId);
      return { matterId: input.matterId, subjectVersion: record.lastSyncAt || record.tokenExpiresAt || record.status,
        title: `恢复 ${record.title} 连接`, whyUser: '平台账号或权限需要重新授权', blockingImpact: '依赖此账号的任务暂停',
        connection: { accountId: record.id, platform: record.platform, title: record.title, status: record.status,
          requiredScopes: input.requiredScopes, missingScopes, affectedTaskIds: input.affectedTaskIds,
          startRoute: supported ? `/api/overseas/social/oauth/${record.platform}/start` : null,
          statusRoute: supported ? `/api/overseas/social/oauth/${record.platform}/status` : null },
        resume: { checkpointId: input.checkpointId || null, available: enabled },
        actionOptions: [{ id: 'connection_repair', label: '复检权限并恢复', kind: 'connection_repair', enabled,
          disabledReason: enabled ? null : '平台实时权限复检或任务恢复能力尚未接通', payload: { accountId: record.id, requiredScopes: input.requiredScopes, checkpointId: input.checkpointId || null } }] };
    },
    async repairConnection(scope: Scope, payload: { accountId: string; requiredScopes: string[]; checkpointId: string }) {
      const record = await account(scope, payload.accountId);
      if (!deps.verifyConnection || !deps.resumeConnection || !text(payload.checkpointId)) throw new InterventionUnavailable('connection_repair_unavailable');
      if (!Array.isArray(payload.requiredScopes) || payload.requiredScopes.some(item => !text(item))) throw new InterventionUnavailable('connection_scopes_invalid');
      const verified = await deps.verifyConnection({ ...scope, accountId: record.id, requiredScopes: payload.requiredScopes });
      if (!verified.valid || verified.missingScopes.length) throw new InterventionUnavailable('connection_permissions_not_restored');
      const resumed = await deps.resumeConnection({ ...scope, accountId: record.id, checkpointId: payload.checkpointId });
      return { accountId: record.id, verified, resumed };
    },
  };
}
