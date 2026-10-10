import { store } from '../storage/index.js';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { withDigitalEmployeeRunLock } from '../digitalEmployees/runControl.js';
import { collectProductionAssets, productionTiming, sceneIntent } from '../digitalEmployees/contentProduction.js';
import type { AssetCandidate } from '../digitalEmployees/contentProductionContracts.js';
import { readTenantEnterpriseProfile } from '../routes/enterprise.js';
import { contentAcceptanceHash } from '../digitalEmployees/contentAcceptance.js';
import { contentProjectLineageFields } from '../digitalEmployees/contentProjectLineage.js';
import { invalidatePublishingApprovalForProject } from '../digitalEmployees/publishingExecution.js';
import { jsonObject } from '../routes/digitalEmployeeRecords.js';
import { prepareScopedRepair, RepairInterventionError, type ScopedRepairPayload, type RepairSnapshot } from './repair.js';
import { allocateEvidenceClips, evidenceClips } from '../digitalEmployees/sceneEvidence.js';
import fs from 'node:fs';
import path from 'node:path';
import { signAssetUrl } from '../lib/assetAccess.js';

interface RepairProductionDependencies {
  store: DataStore;
  collectAssets(tenantId: string): Promise<AssetCandidate[]>;
  invalidateApproval(tenantId: string, projectId: string): Promise<unknown>;
}
const defaults: RepairProductionDependencies = { store,
  collectAssets: async tenantId => collectProductionAssets(tenantId, await readTenantEnterpriseProfile(tenantId)),
  invalidateApproval: invalidatePublishingApprovalForProject };

async function tenantRecord(db: DataStore, collection: string, id: string, tenantId: string) {
  const record = await db.getById<Record_>(collection, id);
  return record?.tenant_id === tenantId ? record : null;
}
async function allRecords(db: DataStore, collection: string, where: Record<string, string>) {
  const records: Record_[] = [];
  for (let page = 1; ; page++) {
    const result = await db.list<Record_>(collection, { where, perPage: 100, page });
    records.push(...result.items);
    if (page >= result.totalPages) return records;
  }
}

export async function loadProductionRepairSnapshot(tenantId: string, projectId: string,
  dependencies: RepairProductionDependencies = defaults): Promise<RepairSnapshot | null> {
  const project = await tenantRecord(dependencies.store, 'studio_projects', projectId, tenantId);
  if (!project) return null;
  const spec = jsonObject<Record<string, any>>(project.spec, {}), source = spec.sceneSourcePlan;
  if (!Array.isArray(source) || !source.length) throw new RepairInterventionError('missing_source_plan', '缺少原分镜证据');
  const timing = productionTiming(spec, source);
  const routePlan = spec.automation?.routePlan || {}, route = spec.contentOrder?.route || spec.mode;
  const assets = (await dependencies.collectAssets(tenantId)).filter(asset => !asset.synthetic && asset.authorization.status !== 'unknown'
    && (route === 'material' ? (routePlan.assetIds || []).includes(asset.id) : Boolean(routePlan.productId && asset.productId === routePlan.productId)));
  const effectiveSpec = { ...spec, sceneSourcePlan: source.map((item: any) => ({ ...item,
    sourceStart: Number(spec.sceneOverrides?.[item.sceneIndex]?.trimStart ?? item.sourceStart ?? 0) })) };
  return { version: contentAcceptanceHash(spec), spec: effectiveSpec,
    scenes: source.map((item: any, sceneIndex: number) => ({ id: String(item.sceneId || item.id || `scene:${item.sceneIndex ?? sceneIndex}`),
      sceneIndex: item.sceneIndex ?? sceneIndex, intent: item.intent || sceneIntent(String(spec.script || ''), item.start, item.end), duration: timing.sceneDurations[sceneIndex] })),
    assets, issues: spec.automation?.quality?.sceneDiagnostics?.issues || [] };
}

/** Resolves only explicitly linked projects in the tenant; never chooses the
 * first project in a run, which could repair a different language or order. */
export async function resolveProductionRepairProject(tenantId: string, targetId: string,
  db: DataStore = store): Promise<string | null> {
  if (await tenantRecord(db, 'studio_projects', targetId, tenantId)) return targetId;
  const task = await tenantRecord(db, 'workflow_tasks', targetId, tenantId);
  if (!task) return null;
  const output = jsonObject<Record<string, any>>(task.output, {});
  const refs = [...jsonObject<any[]>(task.business_refs, []), ...jsonObject<any[]>(output.projectRefs, [])];
  const explicit = [...new Set([output.projectId, output.sourceProjectId,
    ...refs.filter(ref => ref?.type === 'studio_project').map(ref => ref.id)].filter((id): id is string => typeof id === 'string' && !!id))];
  const owned: string[] = [];
  for (const id of explicit) {
    const project = await tenantRecord(db, 'studio_projects', id, tenantId);
    const spec = jsonObject<Record<string, any>>(project?.spec, {});
    if (project && spec.workflowRunId === task.run_id) owned.push(id);
  }
  return owned.length === 1 ? owned[0] : null;
}

export async function productionRepairDetail(input: { tenantId: string; targetId: string },
  dependencies: RepairProductionDependencies = defaults) {
  const projectId = await resolveProductionRepairProject(input.tenantId, input.targetId, dependencies.store);
  if (!projectId) throw new RepairInterventionError('repair_project_ambiguous', '事项没有唯一关联成片，请选择具体成片');
  const project = await tenantRecord(dependencies.store, 'studio_projects', projectId, input.tenantId);
  const snapshot = await loadProductionRepairSnapshot(input.tenantId, projectId, dependencies);
  if (!project || !snapshot) throw new RepairInterventionError('project_not_found', '生产项目不可用');
  const quality = snapshot.spec.automation?.quality || {};
  let videoUrl = '';
  const output = String(snapshot.spec.automation?.renderOutputPath || snapshot.spec.renderOutputPath || '');
  const root = path.resolve(process.cwd(), 'data', 'publishing-uploads', input.tenantId.replace(/[^\w.-]+/g, '-'));
  if (output && fs.existsSync(root) && fs.existsSync(output) && fs.statSync(output).isFile()
    && path.dirname(path.resolve(output)) === root && path.dirname(fs.realpathSync(output)) === fs.realpathSync(root))
    videoUrl = signAssetUrl(`/api/overseas/publishing/local-videos/${encodeURIComponent(path.basename(output))}`, input.tenantId);
  const failedScenes = snapshot.scenes.filter(scene => snapshot.issues.some(issue => issue.sceneIndex === scene.sceneIndex)).map(scene => {
    const eligibleMaterialOptions = snapshot.assets.flatMap(asset => evidenceClips(asset).flatMap(clip => {
      const match = allocateEvidenceClips({ scenes: [{ ...scene, materialId: asset.id, trimStart: clip.start }], assets: [asset] });
      if (match.gaps.length || !match.plan.length) return [];
      const plan = match.plan[0];
      const current = snapshot.spec.sceneSourcePlan.find((item: any) => item.sceneIndex === scene.sceneIndex);
      if (current?.assetId === asset.id && Number(current.sourceStart || 0) === plan.start) return [];
      return [{ id: asset.id, materialId: asset.id, label: asset.id, title: asset.id, trimStart: plan.start, duration: scene.duration,
        evidenceSegmentId: plan.segmentId, observations: plan.observations }];
    }));
    return { id: scene.id, sceneId: scene.id, sceneIndex: scene.sceneIndex, label: `分镜 ${scene.sceneIndex + 1}`, status: 'failed',
      reason: snapshot.issues.filter(issue => issue.sceneIndex === scene.sceneIndex).map(issue => issue.reason).join('；'),
      intent: scene.intent, duration: scene.duration,
      problems: snapshot.issues.filter(issue => issue.sceneIndex === scene.sceneIndex), eligibleMaterialOptions, materialOptions: eligibleMaterialOptions };
  });
  const actionOptions = [...new Set(snapshot.issues.map(issue => issue.code))].map(problemType => {
    const scenes = failedScenes.filter(scene => scene.problems.some(issue => issue.code === problemType));
    const payload: ScopedRepairPayload = { sceneIds: scenes.map(scene => scene.id), repairPlanVersion: snapshot.version, problemType };
    let autoReason = '';
    try { prepareScopedRepair(snapshot, payload); } catch (error) { autoReason = (error as Error).message; }
    const manualEnabled = scenes.length > 0 && scenes.every(scene => scene.eligibleMaterialOptions.length > 0);
    return { id: `repair:${problemType}`, label: autoReason ? '选择替代素材并局部重做' : '局部重做失败分镜', kind: 'scoped_repair',
      enabled: !autoReason || manualEnabled, disabledReason: !autoReason || manualEnabled ? '' : `${autoReason}；需要先补充匹配素材`,
      payload, requiresConfirmation: true, requiresMaterialSelection: Boolean(autoReason),
      fields: [{ key: 'sceneIds', id: 'sceneIds', label: '失败分镜', type: 'scenes', required: true }],
      impact: '保留其他镜头、已确认口播及字幕，重做后重新渲染与质检' };
  });
  return { matterId: input.targetId, subjectVersion: snapshot.version, title: String(project.name || '处理成片质检异常'), videoUrl,
    observedAt: quality.checkedAt || quality.checked_at || project.updated_at || '',
    whyUser: '成片存在可定位的质检问题，需要决定局部修复方案', blockingImpact: '本成片尚不能进入发布；修复后自动重新渲染和质检',
    source: { entityId: projectId, projectId, runId: snapshot.spec.workflowRunId, taskId: snapshot.spec.workflowTaskId, type: 'studio_project' },
    evidence: [{ id: 'production-quality', label: '成片质检', source: 'production_quality_gate', version: snapshot.version, videoUrl,
      observedAt: quality.checkedAt || quality.checked_at || project.updated_at || '',
      checkedAt: quality.checkedAt || quality.checked_at || project.updated_at || '', passed: quality.passed,
      failures: quality.failures || [], sceneDiagnostics: quality.sceneDiagnostics || {} }],
    failedScenes, actionOptions, requiresUserAction: actionOptions.some(option => option.enabled),
    cost: { known: false, label: '本次使用已有素材重新渲染；未取得收费生成报价，不授权付费生成',
      currentLimitLabel: '未申请额外预算', usedLabel: '此路线不增加供应商生成调用', incrementLabel: '已有素材重新渲染',
      source: 'production_material_evidence', alternative: '付费生成必须另行报价与授权，此动作不批准付费调用' },
    resume: { checkpointLabel: '成片渲染', stage: 'render', retainedArtifacts: ['已通过镜头', '已确认口播', '对齐字幕'].map((label, index) => ({ id: String(index), label })) } };
}

/** Production adapter: writes the studio project used by the existing renderer,
 * invalidates its publishing approval and reopens the existing workflow tasks. */
export async function executeProductionScopedRepair(input: { tenantId: string; userId: string; projectId: string;
  commandId: string; payload: ScopedRepairPayload }, dependencies: RepairProductionDependencies = defaults) {
  if (!input.tenantId || !input.userId || !input.commandId) throw new RepairInterventionError('missing_execution_scope', '缺少执行身份');
  const initial = await tenantRecord(dependencies.store, 'studio_projects', input.projectId, input.tenantId);
  const initialSpec = jsonObject<Record<string, any>>(initial?.spec, {}), runId = String(initialSpec.workflowRunId || '');
  if (!initial || !runId) throw new RepairInterventionError('project_not_found', '没有当前企业的生产项目');
  return withDigitalEmployeeRunLock(input.tenantId, runId, async () => {
    const project = await tenantRecord(dependencies.store, 'studio_projects', input.projectId, input.tenantId);
    const run = await tenantRecord(dependencies.store, 'workflow_runs', runId, input.tenantId);
    const snapshot = await loadProductionRepairSnapshot(input.tenantId, input.projectId, dependencies);
    if (!project || !run || !snapshot || snapshot.spec.workflowRunId !== runId || run.status === 'cancelled')
      throw new RepairInterventionError('run_not_actionable', '任务已取消或所属运行已变化');
    const now = new Date().toISOString(), db = dependencies.store;
    const update = async (collection: string, id: string, values: Record<string, unknown>) => {
      if (!await db.update(collection, id, values)) throw new RepairInterventionError('storage_unavailable', `${collection}保存失败`);
    };
    if (snapshot.spec.automation?.mobileRepair?.commandId === input.commandId) {
      // Replay resumes the same persisted plan, not a second repair allocation.
    } else {
      const posts = await allRecords(db, 'posts', { tenant_id: input.tenantId });
      if (snapshot.spec.publishedAt || snapshot.spec.publishingReceipt || posts.some(post => {
        const stats = jsonObject<Record<string, any>>(post.stats, {});
        return stats.sourceProjectId === input.projectId && ['published', 'partial'].includes(stats.status);
      })) throw new RepairInterventionError('project_already_published', '已有真实发布结果，请复制为新计划');
      const prepared = prepareScopedRepair(snapshot, input.payload);
      prepared.spec.selectedMaterialEvidence = snapshot.assets.filter(asset => prepared.spec.selectedMaterialIds.includes(asset.id)).map(asset => ({
        id: asset.id, type: asset.type, visualObservations: asset.visualObservations,
        ...(asset.segments ? { segments: asset.segments } : {}) }));
      prepared.spec.automation.mobileRepair.commandId = input.commandId;
      await update('studio_projects', input.projectId, { status: 'draft', spec: prepared.spec,
        ...contentProjectLineageFields({ tenantId: input.tenantId, spec: prepared.spec, current: project }), updated_at: now });
    }
    await dependencies.invalidateApproval(input.tenantId, input.projectId);
    const tasks = await allRecords(db, 'workflow_tasks', { tenant_id: input.tenantId, run_id: runId });
    for (const task of tasks.filter(task => ['content_production', 'content_quality_gate', 'weekly_review'].includes(String(task.task_key))))
      await update('workflow_tasks', task.id, { status: 'pending', blocked_reason: '', output: {}, updated_at: now });
    await update('workflow_runs', runId, { status: 'running', current_controller: 'agent', completed_at: '', pause_reason: '' });
    if (run.goal_id) {
      const goal = await tenantRecord(db, 'weekly_goals', String(run.goal_id), input.tenantId);
      if (!goal) throw new RepairInterventionError('goal_not_found', '目标不属于当前企业');
      await update('weekly_goals', goal.id, { status: 'active', updated_at: now });
    }
    if (!await db.create('audit_logs', { tenantId: input.tenantId, actorUserId: input.userId, actorEmail: '',
      action: 'content.mobile_scoped_repair', targetType: 'studio_project', targetId: input.projectId,
      metadata: { commandId: input.commandId, sceneIds: input.payload.sceneIds, problemType: input.payload.problemType,
        repairPlanVersion: input.payload.repairPlanVersion }, createdAt: now })) throw new RepairInterventionError('audit_unavailable', '修复已排队但审计保存失败，请重试查询');
    return { status: 'queued' as const, projectId: input.projectId, runId, stage: 'render', sceneIds: input.payload.sceneIds };
  });
}
