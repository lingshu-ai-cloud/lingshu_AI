import type { DataStore } from '../storage/datastore.js';
import { createHash } from 'node:crypto';
import { buildReplicationWorkbenchSpec } from './replicationWorkbenchPlan.js';
import { digitalEmployeeProductionGraph } from '../videoProduction/runtimeGraph.js';

export const MANAGED_REPLICATION_BRIDGE_VERSION = 1;
const object = (value: any): Record<string, any> => typeof value === 'string' ? JSON.parse(value) : value || {};
const renderInputs = (spec: Record<string, any>) => createHash('sha256').update(JSON.stringify({
  plan: spec.automatedReplicationPlan, shots: spec.automatedReplicationShots, assignments: spec.storyboardAssignments,
  productions: spec.shotProductions, edits: spec.clipEdits, script: spec.script, ratio: spec.ratio, exportSpec: spec.exportSpec,
})).digest('hex');

export interface ManagedReplicationPorts {
  initialize: typeof buildReplicationWorkbenchSpec;
  execute: (input: { tenantId: string; projectId: string; store: DataStore }) => Promise<{ state: string; changed: boolean; blocker?: string }>;
  finish: (input: { tenantId: string; projectId: string; spec: Record<string, any> }) => Promise<Record<string, any>>;
  materials: (tenantId: string) => Promise<Array<Record<string, any>>>;
}

/** The business worker owns orchestration; existing workbench executors own
 * supplier submissions, budgets, identities and candidate admission. */
export async function advanceManagedReplication(input: {
  tenantId: string; projectId: string; store: DataStore;
  references: Array<Record<string, any>>;
  now?: string; ports?: ManagedReplicationPorts; preflightBlocker?: string;
}): Promise<{ changed: boolean; blocker: string }> {
  const ports: ManagedReplicationPorts = input.ports || {
    initialize: buildReplicationWorkbenchSpec,
    execute: async value => (await import('../lib/automatedReplicationBridge.js')).advanceAutomatedReplication(value),
    finish: async value => (await import('./replicationWorkbenchFinish.js')).finishReplicationWorkbench(value),
    materials: async tenantId => (await (await import('../lib/materialLibrary.js')).readMaterialLibrary(tenantId)).items,
  };
  const record = await input.store.getById<any>('studio_projects', input.projectId);
  if (!record || record.tenant_id !== input.tenantId) throw Error('经营复刻项目不属于当前企业');
  let spec = object(record.spec);
  if (spec.automation?.route !== 'clone') throw Error('经营逐镜桥接仅接受显式爆款复刻订单');
  if (spec.automation?.stage === 'completed' && spec.automation?.replicationBridgeVersion === MANAGED_REPLICATION_BRIDGE_VERSION) return { changed: false, blocker: '' };
  const now = input.now || new Date().toISOString();
  const persist = async (next: Record<string, any>, status = 'draft') => {
    const automation = object(next.automation);
    next = { ...next, automation: { ...automation, ...digitalEmployeeProductionGraph({ automation,
      stage: String(automation.stage || 'material_match'), extra: automation, now }) } };
    if (!await input.store.update('studio_projects', input.projectId, { spec: next, status, updated_at: now })) throw Error('经营逐镜桥接状态保存失败');
    spec = next;
  };
  try {
    if (input.preflightBlocker) throw Error(input.preflightBlocker);
    if (!spec.automatedReplicationPlan) {
      const referenceId = String(spec.automation?.referenceAnalysisId || spec.automation?.routePlan?.referenceAnalysisId || '');
      const reference = input.references.find(item => item.id === referenceId);
      if (!reference) throw Error('经营复刻订单缺少指定的精确参考分析，不能改用普通剪辑');
      const defaultsRecord = (await input.store.list<any>('studio_production_defaults', { where: { tenant_id: input.tenantId }, perPage: 1 })).items[0];
      const defaults = object(defaultsRecord?.payload);
      const presenters = (defaults.presenters || []).filter((item: any) => item.authorized);
      const requested = spec.contentOrder?.videoPlan?.heygenAvatarId;
      const presenter = requested ? presenters.find((item: any) => item.id === requested || item.avatarId === requested)
        : presenters.find((item: any) => item.id === defaults.defaultPresenterId) || (presenters.length === 1 ? presenters[0] : undefined);
      const assets = await ports.materials(input.tenantId);
      const initialized = ports.initialize({ tenantId: input.tenantId, projectId: input.projectId, spec,
        reference, assets, presenterId: presenter?.id,
        productIds: spec.automation?.routePlan?.productId ? [spec.automation.routePlan.productId] : undefined });
      await persist({ ...initialized, automation: { ...spec.automation, stage: 'material_match', status: 'processing',
        replicationBridgeVersion: MANAGED_REPLICATION_BRIDGE_VERSION, blocker: '', retryPolicy: '', retryAfter: '', updatedAt: now } });
      return { changed: true, blocker: '' };
    }
    const result = await ports.execute({ tenantId: input.tenantId, projectId: input.projectId, store: input.store });
    const latest = await input.store.getById<any>('studio_projects', input.projectId);
    if (!latest || latest.tenant_id !== input.tenantId) throw Error('逐镜执行后的经营项目已失效');
    spec = object(latest.spec);
    if (result.state === 'blocked') throw Error(result.blocker || '逐镜复刻缺少可执行素材或供应商条件');
    if (result.state !== 'ready') {
      await persist({ ...spec, automation: { ...spec.automation, stage: 'material_match', status: 'processing',
        replicationBridgeVersion: MANAGED_REPLICATION_BRIDGE_VERSION, blocker: '', retryPolicy: '', retryAfter: '', updatedAt: now } });
      return { changed: result.changed, blocker: '' };
    }
    const expectedInputs = renderInputs(spec);
    const finished = await ports.finish({ tenantId: input.tenantId, projectId: input.projectId, spec });
    if (!finished.renderOutputPath || finished.automation?.quality?.passed !== true) throw Error('逐镜复刻装配未取得真实成片及机器质量证据');
    const current = await input.store.getById<any>('studio_projects', input.projectId);
    if (!current || current.tenant_id !== input.tenantId || renderInputs(object(current.spec)) !== expectedInputs) throw Error('逐镜装配期间制作参数已变化，旧成片不能覆盖当前项目');
    spec = object(current.spec);
    await persist({ ...spec, ...finished, automation: { ...spec.automation, ...finished.automation,
      replicationBridgeVersion: MANAGED_REPLICATION_BRIDGE_VERSION, stage: 'completed', status: 'ready_for_approval',
      blocker: '', retryPolicy: '', retryAfter: '', completedAt: now, updatedAt: now } }, 'ready_for_approval');
    return { changed: true, blocker: '' };
  } catch (error) {
    // Refresh: a supplier task or partial adoption may have been persisted
    // before failure. Never overwrite those receipts with the old snapshot.
    const latest = await input.store.getById<any>('studio_projects', input.projectId);
    if (!latest || latest.tenant_id !== input.tenantId) throw error;
    spec = object(latest.spec);
    const blocker = error instanceof Error ? error.message : String(error);
    const unchanged = spec.automation?.stage === 'blocked' && spec.automation?.blocker === blocker;
    await persist({ ...spec, automation: { ...spec.automation, stage: 'blocked', status: 'blocked',
      replicationBridgeVersion: MANAGED_REPLICATION_BRIDGE_VERSION, resumeStage: 'material_match', blocker,
      retryPolicy: 'service_retry', retryAfter: new Date(Date.parse(now) + 15 * 60_000).toISOString(), updatedAt: now } });
    return { changed: !unchanged, blocker };
  }
}
