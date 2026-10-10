import { applySceneRepair, planSceneRepair } from '../digitalEmployees/sceneRepair.js';
import type { EvidenceAsset, EvidenceRequest } from '../digitalEmployees/sceneEvidence.js';
import { allocateEvidenceClips } from '../digitalEmployees/sceneEvidence.js';
import type { SceneVisualIssue } from '../lib/renderVisualQuality.js';

export class RepairInterventionError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
export interface ScopedRepairPayload {
  sceneIds: string[];
  repairPlanVersion: string;
  problemType: SceneVisualIssue['code'];
  replacements?: Array<{ sceneId: string; materialId: string; trimStart: number }>;
}
export interface RepairSnapshot {
  version: string;
  spec: Record<string, any>;
  scenes: Array<EvidenceRequest & { id: string }>;
  assets: EvidenceAsset[];
  issues: SceneVisualIssue[];
}

/** Uses the production evidence allocator, preserving every unselected source.
 * The caller must load this snapshot under the workflow run lock and persist
 * the returned spec together with task/run resumption and audit records. */
export function prepareScopedRepair(snapshot: RepairSnapshot, payload: ScopedRepairPayload) {
  if (!payload || payload.repairPlanVersion !== snapshot.version)
    throw new RepairInterventionError('version_conflict', '修复证据已更新，请刷新后选择');
  if (!Array.isArray(payload.sceneIds) || !payload.sceneIds.length || payload.sceneIds.some(id => typeof id !== 'string')
    || new Set(payload.sceneIds).size !== payload.sceneIds.length)
    throw new RepairInterventionError('invalid_scene_selection', '请选择不重复的失败分镜');
  if (!['decode', 'blank', 'blur', 'duplicate'].includes(payload.problemType))
    throw new RepairInterventionError('invalid_problem_type', '请选择有效质检问题');
  const selected = payload.sceneIds.map(id => snapshot.scenes.find(scene => scene.id === id));
  if (selected.some(scene => !scene)) throw new RepairInterventionError('invalid_scene_selection', '分镜不属于当前项目');
  const indices = new Set(selected.map(scene => scene!.sceneIndex));
  const issues = snapshot.issues.filter(issue => indices.has(issue.sceneIndex) && issue.code === payload.problemType);
  if (selected.some(scene => !issues.some(issue => issue.sceneIndex === scene!.sceneIndex)))
    throw new RepairInterventionError('scene_not_failed', '只能修复当前存在所选问题的失败分镜');
  const sourcePlan = snapshot.spec.sceneSourcePlan;
  if (!Array.isArray(sourcePlan) || selected.some(scene => !sourcePlan.some(source => source.sceneIndex === scene!.sceneIndex)))
    throw new RepairInterventionError('missing_source_plan', '原分镜证据缺失，无法安全局部重做');
  const manual = payload.replacements;
  if (manual && (!Array.isArray(manual) || manual.length !== selected.length
    || new Set(manual.map(item => item.sceneId)).size !== selected.length
    || manual.some(item => !payload.sceneIds.includes(item.sceneId) || !snapshot.assets.some(asset => asset.id === item.materialId)
      || !Number.isFinite(item.trimStart) || item.trimStart < 0)))
    throw new RepairInterventionError('invalid_replacements', '每个选中分镜需要指定一个当前可用素材和有效起点');
  const repair = manual ? allocateEvidenceClips({ scenes: selected.map(scene => {
    const replacement = manual.find(item => item.sceneId === scene!.id)!;
    return { ...scene!, materialId: replacement.materialId, trimStart: replacement.trimStart };
  }), assets: snapshot.assets }) : planSceneRepair({ scenes: snapshot.scenes, assets: snapshot.assets, issues,
    current: sourcePlan, attempts: Number(snapshot.spec.automation?.sceneRepairAttempts || 0),
    userLocked: snapshot.spec.scenePlanOrigin !== 'director',
    previousFailures: (snapshot.spec.automation?.sceneRepairHistory || []).flatMap((entry: Record<string, unknown>) =>
      Array.isArray(entry.failedSources) ? entry.failedSources as Array<{ identity: string; start: number; end?: number }> : []) });
  if (repair.gaps.length) throw new RepairInterventionError('repair_not_executable', repair.gaps.join('；'));
  const failedSources: Array<{ identity: string; start: number; end?: number }> = 'failedSources' in repair
    ? repair.failedSources as Array<{ identity: string; start: number; end?: number }> : [];
  const spec = applySceneRepair(snapshot.spec, { ...repair, failedSources }, issues);
  spec.automation.mobileRepair = { sceneIds: [...payload.sceneIds], problemType: payload.problemType,
    repairPlanVersion: payload.repairPlanVersion, ...(manual ? { replacements: manual, mode: 'human_material_selection' } : {}) };
  return { spec, stage: spec.automation.stage, repairedSceneIds: [...payload.sceneIds],
    preservedSceneIds: snapshot.scenes.filter(scene => !indices.has(scene.sceneIndex)).map(scene => scene.id) };
}

export interface SingleOperationBudgetPayload {
  operationId: string;
  estimatedIncrementCny: number;
  maxIncrementCny: number;
  expiresAt: string;
}
/** Validates a single-operation grant. This deliberately does not change the
 * enterprise/monthly or env project limit; paid provider admission must consume
 * this grant transactionally before a supplier call. */
export function validateSingleOperationBudget(payload: SingleOperationBudgetPayload, now = Date.now()) {
  if (!payload || !/^[A-Za-z0-9_:.-]{1,180}$/.test(payload.operationId))
    throw new RepairInterventionError('invalid_operation', '单次授权缺少执行标识');
  const estimated = payload.estimatedIncrementCny, cap = payload.maxIncrementCny;
  if (!Number.isFinite(estimated) || estimated <= 0 || !Number.isFinite(cap) || cap < estimated
    || !Number.isSafeInteger(Math.round(cap * 1e6)))
    throw new RepairInterventionError('invalid_budget', '单次上限必须覆盖本次预计增量');
  const expiry = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 24 * 60 * 60 * 1000)
    throw new RepairInterventionError('invalid_expiry', '单次授权有效期必须在未来24小时内');
  return { ...payload, currency: 'CNY' as const, scope: 'single_operation' as const };
}

export function selectInterventionOption<T extends { id: string; enabled: boolean; payload: unknown }>(options: T[], id: string): T {
  const option = options.find(item => item.id === id);
  if (!option?.enabled) throw new RepairInterventionError('option_not_available', '方案已失效或不可执行，请刷新');
  return option;
}

export interface ScopedRepairExecutionDependencies {
  withRunLock<T>(tenantId: string, projectId: string, operation: () => Promise<T>): Promise<T>;
  loadSnapshot(tenantId: string, projectId: string): Promise<RepairSnapshot | null>;
  /** Must persist the new spec, resume the production task/run and append audit
   * under the same lock. Throw on failed persistence; never return synthetic OK. */
  saveAndResume(input: { tenantId: string; userId: string; projectId: string; commandId: string;
    expectedVersion: string; spec: Record<string, any>; repairedSceneIds: string[] }): Promise<unknown>;
}

export async function executeScopedRepair(input: { tenantId: string; userId: string; projectId: string;
  commandId: string; payload: ScopedRepairPayload }, dependencies: ScopedRepairExecutionDependencies) {
  if (!input.tenantId || !input.userId || !input.projectId || !input.commandId)
    throw new RepairInterventionError('missing_execution_scope', '修复缺少企业、操作者或命令标识');
  return dependencies.withRunLock(input.tenantId, input.projectId, async () => {
    const snapshot = await dependencies.loadSnapshot(input.tenantId, input.projectId);
    if (!snapshot) throw new RepairInterventionError('project_not_found', '当前企业中没有该项目');
    if (snapshot.spec.publishedAt || snapshot.spec.publishingReceipt)
      throw new RepairInterventionError('project_already_published', '已发布成片需要复制为新计划');
    const prepared = prepareScopedRepair(snapshot, input.payload);
    const result = await dependencies.saveAndResume({ tenantId: input.tenantId, userId: input.userId,
      projectId: input.projectId, commandId: input.commandId, expectedVersion: snapshot.version,
      spec: prepared.spec, repairedSceneIds: prepared.repairedSceneIds });
    return { status: 'queued' as const, projectId: input.projectId, stage: prepared.stage,
      repairedSceneIds: prepared.repairedSceneIds, preservedSceneIds: prepared.preservedSceneIds, result };
  });
}
