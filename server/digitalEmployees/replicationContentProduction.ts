import type { DataStore } from '../storage/datastore.js';
import { createHash } from 'node:crypto';
import { buildReplicationWorkbenchSpec, MANAGED_REPLICATION_PLAN_VERSION } from './replicationWorkbenchPlan.js';
import { digitalEmployeeProductionGraph } from '../videoProduction/runtimeGraph.js';
import { validatePresenterRightsEvidence } from '../lib/presenterAssetTrust.js';

export const MANAGED_REPLICATION_BRIDGE_VERSION = 1;
const object = (value: any): Record<string, any> => typeof value === 'string' ? JSON.parse(value) : value || {};
const renderInputs = (spec: Record<string, any>) => createHash('sha256').update(JSON.stringify({
  plan: spec.automatedReplicationPlan, shots: spec.automatedReplicationShots, assignments: spec.storyboardAssignments,
  productions: spec.shotProductions, edits: spec.clipEdits, script: spec.script, ratio: spec.ratio, exportSpec: spec.exportSpec,
})).digest('hex');

export function managedReplicationFailureState(error: unknown): { blocker: string; retryPolicy: 'input_required' | 'service_retry' } {
  const raw = error instanceof Error ? error.message : String(error || '逐镜复刻执行失败');
  const code = String(recordError(error).code || '');
  // A failed QA transport/contract is not evidence that the retained image
  // failed visual checks. Retry QA for that same asset, never its generation.
  if (/^(?:FIRST_FRAME|STORYBOARD_VIDEO|VIDEO)_QA_(?:SERVICE_UNAVAILABLE|RESPONSE_INVALID)$/.test(code)
    || /(?:首帧|视频|画面).*质检(?:服务暂不可用|响应不完整)/.test(raw)) {
    return { blocker: raw, retryPolicy: 'service_retry' };
  }
  if (/^(?:FIRST_FRAME_QA_FAILED|STORYBOARD_VIDEO_QA_FAILED|FINAL_VIDEO_QA_FAILED|VIDEO_QA_FAILED)$/.test(code)
    || /(?:首帧|视频|成片|画面).*(?:质检|质量检查).*(?:未通过|不通过|硬失败)|(?:首帧|视频).*未通过.*质检|逐镜成片自动质检失败/.test(raw)) {
    return { blocker: raw, retryPolicy: 'input_required' };
  }
  // These conditions cannot improve with a timer. Keep the original receipt
  // and require an explicit budget/input repair instead of polling suppliers.
  if (/^(?:STORYBOARD_BUDGET_PLAN_(?:UNAVAILABLE|CHANGED)|STORYBOARD_PROJECT_BUDGET_EXCEEDED|seedance_monthly_budget_exceeded|USAGE_ACTION_(?:STATES_REQUIRED|PLAN_NOT_READY)|ACTION_SEGMENT_PLAN_NOT_READY|STORYBOARD_PROJECT_INPUT_CHANGED|FIRST_FRAME_NOT_CONFIRMED|REPLICATION_NARRATION_.*)$/.test(code)
    || /未进入智能生成预算计划|(?:制作|项目|生成|镜头|冻结).*预算.*(?:不足|超出|超过)|预算(?:计划|方案).*(?:不一致|超出|变化)|本月.*(?:成本额度|预算).*不足|使用动作.*(?:补|关键状态|拆成)|动作缺少可验收|当前分镜.*(?:输入|首帧).*(?:变化|未确认)|(?:使用|目标)场景.*动作|动作(?:起点|步骤|终点|状态).*?(?:缺少|不完整|未确认)|口播.*(?:目标语种|含中文|语言不符|完整句|连续配音|冻结脚本|文字覆盖)|冻结口播.*(?:缺失|分割|不一致|跨越)|目标台词|企业数字人|原片首帧.*授权|所选产品.*(?:视角|图片)|产品.*视角.*(?:缺少|补充)/i.test(raw)) {
    return { blocker: raw, retryPolicy: 'input_required' };
  }
  if (/镜头类型或物理镜头边界不完整/.test(raw)) {
    return { blocker: '爆款分析缺少已确认的镜头类型或物理镜头边界，需补全分析后继续生产', retryPolicy: 'input_required' };
  }
  if (/物理镜头边界|镜头边界不完整/.test(raw)) {
    return { blocker: '爆款分析缺少物理镜头边界，需补全分析后继续生产', retryPolicy: 'input_required' };
  }
  if (/已确认的镜头类型|逐镜可见事实|精确参考分析|参考结构|对标分镜|背景分析|景别分析|构图分析|机位或运镜分析|缺少可执行素材|素材.*(?:缺少|不存在|未授权)|冻结内容订单.*额度|产品资料|口播.*(?:依据|事实)|人物.*(?:授权|不可用)/i.test(raw)) {
    return { blocker: raw, retryPolicy: 'input_required' };
  }
  return { blocker: raw, retryPolicy: 'service_retry' };
}

function recordError(error: unknown): Record<string, unknown> {
  return error && typeof error === 'object' ? error as Record<string, unknown> : {};
}

function managedPlanHasPresenterInputBlock(spec: Record<string, any>): boolean {
  return (Array.isArray(spec.automatedReplicationShots) ? spec.automatedReplicationShots : [])
    .some((shot: Record<string, any>) => shot.kind === 'blocked'
      && ['avatar_required', 'presenter_authorization_required'].includes(String(shot.blockerCode || '')));
}

export function selectManagedReplicationPresenter(defaults: Record<string, any>, requested?: string): Record<string, any> | undefined {
  const presenters = (Array.isArray(defaults.presenters) ? defaults.presenters : []).filter((item: any) => item.authorized === true);
  const seedanceReady = (item: any) => {
    const references = item.toolMappings?.seedance?.referenceMaterialIds || item.referenceMaterialIds;
    const certification = item.arkCertification;
    return Boolean(String(item.id || '').trim()) && certification?.status === 'active' && certification.assetType === 'image'
      && /^asset:\/\/asset-[a-z0-9-]+$/i.test(String(certification.assetUri || ''))
      && Boolean(String(certification.projectName || '').trim() && String(certification.groupId || '').trim())
      && ['ark_api', 'manual_console'].includes(String(certification.verificationSource || ''))
      && Array.isArray(references) && references.includes(certification.materialId)
      && validatePresenterRightsEvidence(item.rightsEvidence, { provider: 'volcengine_ark', uses: ['person_replacement'] }).ok;
  };
  // A placeholder avatarId/authorized flag is not a recorded usable person.
  // Never replace an explicitly selected identity with another catalogue face.
  const selectedId = String(requested || defaults.defaultPresenterId || '').trim();
  if (selectedId) return presenters.find((item: any) => (item.id === selectedId || item.avatarId === selectedId) && seedanceReady(item));
  const ready = presenters.filter(seedanceReady);
  return ready.length === 1 ? ready[0] : undefined;
}

export type ManagedReplicationPresenterReadiness = {
  state: 'missing' | 'authorization_required' | 'production_setup_required' | 'ready';
  presenterCount: number;
  presenterId: string;
  presenterName: string;
};

/**
 * Classifies the enterprise-person state using the same gate as the managed
 * replication executor.  "Added" is deliberately separate from "ready": a
 * HeyGen talking avatar may be valid for ordinary talking-head work while the
 * current reference-shot replacement route still needs a bound portrait,
 * person-replacement rights and an Active Ark image asset.
 */
export function managedReplicationPresenterReadiness(
  defaults: Record<string, any>,
  requested?: string,
): ManagedReplicationPresenterReadiness {
  const presenters = (Array.isArray(defaults.presenters) ? defaults.presenters : [])
    .filter((item: any) => Boolean(String(item?.id || '').trim()));
  const selectedId = String(requested || defaults.defaultPresenterId || '').trim();
  const selected = selectedId
    ? presenters.find((item: any) => item.id === selectedId || item.avatarId === selectedId)
    : presenters.length === 1 ? presenters[0] : undefined;
  const presenterName = String(selected?.name || '').trim();
  if (!presenters.length) return { state: 'missing', presenterCount: 0, presenterId: '', presenterName: '' };
  if (!presenters.some((item: any) => item.authorized === true)) {
    return { state: 'authorization_required', presenterCount: presenters.length, presenterId: String(selected?.id || ''), presenterName };
  }
  const ready = selectManagedReplicationPresenter(defaults, requested);
  if (ready) {
    return {
      state: 'ready',
      presenterCount: presenters.length,
      presenterId: String(ready.id || ''),
      presenterName: String(ready.name || '').trim(),
    };
  }
  return { state: 'production_setup_required', presenterCount: presenters.length, presenterId: String(selected?.id || ''), presenterName };
}

export interface ManagedReplicationPorts {
  initialize: typeof buildReplicationWorkbenchSpec;
  execute: (input: { tenantId: string; projectId: string; maxCostCny: number; store: DataStore }) => Promise<{ state: string; changed: boolean; blocker?: string; blockerCode?: string }>;
  finish: (input: { tenantId: string; projectId: string; spec: Record<string, any> }) => Promise<Record<string, any>>;
  materials: (tenantId: string) => Promise<Array<Record<string, any>>>;
}

/** One managed clone may spend at most its already-frozen content estimate.
 * This consumes an existing weekly reservation; it does not create a second
 * reservation or fall back to a provider-wide default. */
export function managedReplicationCostCap(spec: Record<string, any>): number | null {
  const context = object(object(spec.contentOrder).operatingContext);
  const estimated = Number(context.estimatedContentCost);
  const budget = Number(context.productionBudget);
  const spent = Number(context.productionSpent);
  if (!Number.isFinite(estimated) || estimated <= 0 || !Number.isFinite(budget) || budget <= 0
    || !Number.isFinite(spent) || spent < 0) return null;
  const remaining = Math.max(0, budget - spent);
  return remaining > 0 ? Math.round(Math.min(estimated, remaining) * 100) / 100 : null;
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
    const currentPlanVersion = Number(object(spec.automatedReplicationPlan).version || 0);
    let currentDefaults: Record<string, any> | undefined;
    let refreshedPresenter: Record<string, any> | undefined;
    if (currentPlanVersion >= MANAGED_REPLICATION_PLAN_VERSION && managedPlanHasPresenterInputBlock(spec)) {
      const defaultsRecord = (await input.store.list<any>('studio_production_defaults', { where: { tenant_id: input.tenantId }, perPage: 1 })).items[0];
      currentDefaults = object(defaultsRecord?.payload);
      refreshedPresenter = selectManagedReplicationPresenter(currentDefaults, spec.contentOrder?.videoPlan?.heygenAvatarId);
    }
    const refreshPresenterInputs = Boolean(refreshedPresenter);
    if (!spec.automatedReplicationPlan
      || currentPlanVersion < MANAGED_REPLICATION_PLAN_VERSION
      || refreshPresenterInputs) {
      const migratingExistingPlan = Boolean(spec.automatedReplicationPlan);
      const referenceId = String(spec.automation?.referenceAnalysisId || spec.automation?.routePlan?.referenceAnalysisId || '');
      const reference = input.references.find(item => item.id === referenceId);
      if (!reference) throw Error('经营复刻订单缺少指定的精确参考分析，不能改用普通剪辑');
      if (!currentDefaults) {
        const defaultsRecord = (await input.store.list<any>('studio_production_defaults', { where: { tenant_id: input.tenantId }, perPage: 1 })).items[0];
        currentDefaults = object(defaultsRecord?.payload);
      }
      const requested = spec.contentOrder?.videoPlan?.heygenAvatarId;
      const presenter = refreshedPresenter || selectManagedReplicationPresenter(currentDefaults, requested);
      const assets = await ports.materials(input.tenantId);
      // Re-run the existing v1->v2 migration when a previously missing person
      // has become usable. The plan builder preserves receipts/progress while
      // replacing only the soft presenter blockers with executable shots.
      const initializationSpec = refreshPresenterInputs
        ? { ...spec, automatedReplicationPlan: { ...object(spec.automatedReplicationPlan), version: MANAGED_REPLICATION_PLAN_VERSION - 1 } }
        : spec;
      const initialized = ports.initialize({ tenantId: input.tenantId, projectId: input.projectId, spec: initializationSpec,
        reference, assets, presenterId: presenter?.id,
        productIds: spec.automation?.routePlan?.productId ? [spec.automation.routePlan.productId] : undefined });
      await persist({ ...initialized, automation: { ...spec.automation, stage: 'material_match', status: 'processing',
        replicationBridgeVersion: MANAGED_REPLICATION_BRIDGE_VERSION, blocker: '', blockerCode: '', retryPolicy: '', retryAfter: '', updatedAt: now } });
      // A brand-new workbench gets one durable checkpoint before any supplier
      // work. A v1 workbench already has that checkpoint and paid receipts, so
      // migrate it in place and continue from the same execution node.
      if (!migratingExistingPlan) return { changed: true, blocker: '' };
    }
    const maxCostCny = managedReplicationCostCap(spec);
    if (!maxCostCny) throw Error('冻结内容订单缺少可用的单条制作额度，未调用供应商');
    const result = await ports.execute({ tenantId: input.tenantId, projectId: input.projectId, maxCostCny, store: input.store });
    const latest = await input.store.getById<any>('studio_projects', input.projectId);
    if (!latest || latest.tenant_id !== input.tenantId) throw Error('逐镜执行后的经营项目已失效');
    spec = object(latest.spec);
    if (result.state === 'blocked') throw Object.assign(Error(result.blocker || '逐镜复刻缺少可执行素材或供应商条件'), { code: result.blockerCode || '' });
    if (result.state !== 'ready') {
      await persist({ ...spec, automation: { ...spec.automation, stage: 'material_match', status: 'processing',
        replicationBridgeVersion: MANAGED_REPLICATION_BRIDGE_VERSION, blocker: '', blockerCode: '', retryPolicy: '', retryAfter: '', updatedAt: now } });
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
      blocker: '', blockerCode: '', retryPolicy: '', retryAfter: '', completedAt: now, updatedAt: now } }, 'ready_for_approval');
    return { changed: true, blocker: '' };
  } catch (error) {
    // Refresh: a supplier task or partial adoption may have been persisted
    // before failure. Never overwrite those receipts with the old snapshot.
    const latest = await input.store.getById<any>('studio_projects', input.projectId);
    if (!latest || latest.tenant_id !== input.tenantId) throw error;
    spec = object(latest.spec);
    const failure = managedReplicationFailureState(error);
    const blocker = failure.blocker;
    const blockerCode = String(recordError(error).code || '');
    const unchanged = spec.automation?.stage === 'blocked' && spec.automation?.blocker === blocker
      && String(spec.automation?.blockerCode || '') === blockerCode && spec.automation?.retryPolicy === failure.retryPolicy;
    await persist({ ...spec, automation: { ...spec.automation, stage: 'blocked', status: 'blocked',
      replicationBridgeVersion: MANAGED_REPLICATION_BRIDGE_VERSION, resumeStage: 'material_match', blocker, blockerCode,
      retryPolicy: failure.retryPolicy,
      retryAfter: failure.retryPolicy === 'input_required' ? '' : new Date(Date.parse(now) + 15 * 60_000).toISOString(),
      updatedAt: now } });
    return { changed: !unchanged, blocker };
  }
}
