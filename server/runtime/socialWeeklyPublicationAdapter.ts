import {createWeeklyInventoryReuseService} from '../socialPrograms/weeklyInventoryReuse.js';
import {assertWeeklyPublicationStoredScope} from '../publishing/weeklyFormalPublicationBoundary.js';
import {readWeeklyPublicationMetricEvidence} from './weeklyPublicationMetricEvidence.js';
import type { WeeklyExecutionTask, WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';
import { withWeeklyProductionAdmissionGuard } from '../socialPrograms/weeklyCancellation.js';
import type { DataStore } from '../storage/datastore.js';
import { createWeeklyPublishingAdapter } from '../publishing/weeklyPublishingAdapter.js';
import { runWeeklyPublicationPackageScan } from '../publishing/weeklyPublicationWorker.js';
import { readStarterPublicationPackage } from '../publishing/starterPublicationPackage.js';
import { PUBLICATION_ASSIGNMENTS, PUBLICATION_ATTEMPTS, executeWeeklyPublication, reconcileWeeklyPublication, validateWeeklyAssignmentBoundary, type DurablePublicationAttempt, type StoredPublicationAssignment, type WeeklyPublishingProviderAdapter } from '../publishing/weeklyLineage.js';
import { runWeeklyReviewForPackage } from '../socialReview/weeklyReviewWorker.js';
import { validateWeeklyPublicationAcceptance } from './socialWeeklyResultValidation.js';
import { SOCIAL_METRIC_KEYS } from '../socialMetrics/aggregation.js';
import { publicationInstant } from '../socialPrograms/publicationDeadlines.js';
import { checkPublicationReceptionAdmission } from '../socialPrograms/publicationReceptionService.js';
import type { ReceptionCheckPorts } from '../socialPrograms/publicationReceptionReadiness.js';
import type { SocialWeeklyExecutionAdapter, WeeklyExecutionAdapterResult } from './socialWeeklyExecutionAdapter.js';

type Row = { id: string } & Record<string, any>;
const pending = (code: string, message: string): WeeklyExecutionAdapterResult => ({ status: 'pending', code, message, retryDelayMs: 30_000 });
const blocked = (code: string, message: string): WeeklyExecutionAdapterResult => ({ status: 'blocked', code, message });

/** Reuses publication admission/reconciliation; never treats accepted or unknown as published. */
export function createSocialWeeklyPublicationAdapter(dataStore: DataStore, options: {
  now?: () => Date;
  publishingEnabled?: () => boolean;
  receptionPorts?: ReceptionCheckPorts;
  adapterFactory?: (assignment: StoredPublicationAssignment) => Promise<WeeklyPublishingProviderAdapter>;
} = {}): SocialWeeklyExecutionAdapter {
  const now = options.now ?? (() => new Date());
  return { async execute(task) {
    const packages = await dataStore.list<Row>('social_weekly_operating_packages', { where: { tenant_id: task.tenantId, package_id: task.packageId, version: task.packageVersion }, page: 1, perPage: 2 });
    if (packages.totalItems !== 1 || !packages.items[0]) return blocked('weekly_package_missing', '周任务包版本不存在或不唯一。');
    const row = packages.items[0];
    const pkg = row.payload as WeeklyOperatingPackage;
    if (!pkg || row.tenant_id !== task.tenantId || row.package_id !== task.packageId || row.version !== task.packageVersion || pkg.packageId !== task.packageId || pkg.version !== task.packageVersion || pkg.programId !== task.programId) return blocked('weekly_package_identity_invalid', '周任务包身份不一致。');
    if (task.schedule.stepKind === 'publishing') {
      try { const observed = await observeOriginalAttempt(task, pkg); if (observed) return observed; }
      catch (error) { return blocked(error instanceof Error ? error.message : 'publication_receipt_scope_invalid', '原发布回执身份或查询能力无法核验，未重新提交发布。'); }
    }
    if (pkg.status !== 'active') return blocked('weekly_package_inactive', '周任务包已停用或被修订替代。');
    if (task.schedule.stepKind === 'publishing') {
      try { return await withWeeklyProductionAdmissionGuard({ dataStore, tenantId: task.tenantId, packageId: task.packageId, packageVersion: task.packageVersion, action: assertAdmission => publish(task, pkg, assertAdmission) }); }
      catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'weekly_publication_admission_failed';
        return code === 'weekly_cancellation_busy' ? pending(code, '撤回或其他执行正在处理，等待安全核对。') : blocked(code, '本周发布已停止或撤回，已有回执保留。');
      }
    }
    if (task.schedule.stepKind === 'performance_monitoring') {
      try{const read=await readWeeklyPublicationMetricEvidence(dataStore,task,pkg,now());if(read.missingPublicationIds.length)return pending('weekly_metrics_pending',`本周真实发布仍有 ${read.missingPublicationIds.length} 条未取得对应平台指标，保留待回流状态。`);return {status:'succeeded',resultRefs:read.sources.map(row=>({type:'social_metric_snapshot',id:row.id,version:1}))};}catch(error){return blocked(error instanceof Error&&'code' in error?String(error.code):'weekly_metrics_evidence_invalid','本周实际发布或指标来源无法核验，未完成回流任务。');}
    }
    if (task.schedule.stepKind === 'weekly_review') {
      const result = await runWeeklyReviewForPackage({ dataStore, row: row as Parameters<typeof runWeeklyReviewForPackage>[0]['row'], now: now() });
      if (result.status !== 'completed' || !result.snapshot) return pending(result.reason || 'weekly_review_pending', '周复盘尚未到期或证据暂不可用。');
      return { status: 'succeeded', resultRefs: [{ type: 'weekly_review_snapshot', id: result.snapshot.snapshotId, version: 1 }] };
    }
    return blocked('weekly_execution_adapter_missing', '该执行节点没有匹配的发布或复盘适配器。');
  } };

  // Observation of an existing request is independent of permission to submit a new one.
  // Do not scan/create packages, restart production, or re-run current approval here.
  async function observeOriginalAttempt(task: WeeklyExecutionTask, pkg: WeeklyOperatingPackage): Promise<WeeklyExecutionAdapterResult | null> {
    if (!task.publicationTaskId || !task.accountId) throw Error('weekly_publication_identity_invalid');
    const rows = await dataStore.list<StoredPublicationAssignment>(PUBLICATION_ASSIGNMENTS, {where: {tenant_id: task.tenantId, operating_package_id: task.packageId, operating_package_version: task.packageVersion, publication_task_id: task.publicationTaskId}, page: 1, perPage: 2});
    if (!rows.totalItems && !rows.items.length) return null;
    if (rows.totalItems !== 1 || rows.items.length !== 1) throw Error('weekly_publication_assignment_ambiguous');
    const assignment = rows.items[0]!;
    assertWeeklyPublicationStoredScope(assignment, pkg);
    if (assignment.tenant_id !== task.tenantId || assignment.account_id !== task.accountId) throw Error('weekly_publication_assignment_scope_invalid');
    const attempts = await dataStore.list<DurablePublicationAttempt>(PUBLICATION_ATTEMPTS, {where: {tenant_id: task.tenantId, assignment_id: assignment.assignment_id}, page: 1, perPage: 2});
    if (!attempts.totalItems && !attempts.items.length) return null;
    if (attempts.totalItems !== 1 || attempts.items.length !== 1) throw Error('publication_attempt_ambiguous');
    const attempt = attempts.items[0]!;
    if (!attempt.attempt_id || attempt.tenant_id !== task.tenantId || attempt.assignment_id !== assignment.assignment_id || attempt.package_id !== assignment.package_id || !attempt.provider) throw Error('publication_receipt_scope_invalid');
    const publicationPackage = await readStarterPublicationPackage(task.tenantId, assignment.package_id, dataStore);
    if (!publicationPackage || publicationPackage.tenantId !== task.tenantId || publicationPackage.platform !== assignment.platform || publicationPackage.packageId !== assignment.package_id || publicationPackage.operatingLineage?.assignmentId !== assignment.assignment_id || publicationPackage.operatingLineage.assignmentHash !== assignment.assignment_hash) throw Error('publication_package_scope_invalid');
    if (attempt.status === 'published' || attempt.status === 'failed') return publicationResult(attempt);
    if (attempt.status !== 'unknown' && attempt.status !== 'in_flight') throw Error('publication_receipt_status_invalid');
    const provider = options.adapterFactory ? await options.adapterFactory(assignment) : await createWeeklyPublishingAdapter({tenantId: task.tenantId, accountId: assignment.account_id, platform: assignment.platform, dataStore, now: now(), purpose: 'receipt_lookup', providerReceiptId: attempt.provider_receipt_id});
    if (provider.provider !== attempt.provider || provider.platform !== assignment.platform) throw Error('publication_receipt_provider_mismatch');
    return publicationResult(await reconcileWeeklyPublication({assignment: assignment.payload, publicationPackage, adapter: provider, dataStore, now: now()}));
  }

  async function publish(task: WeeklyExecutionTask, pkg: WeeklyOperatingPackage, assertAdmission: () => Promise<void>): Promise<WeeklyExecutionAdapterResult> {
    const publication = pkg.socialContentPackage.publicationTasks.find(item => item.publicationTaskId === task.publicationTaskId && item.accountId === task.accountId);
    if (!publication) return blocked('weekly_publication_identity_invalid', '发布任务不属于当前周包或账号。');
    const all = await dataStore.list<Row>('social_weekly_execution_tasks', { where: { tenant_id: task.tenantId, package_id: task.packageId, package_version: task.packageVersion }, page: 1, perPage: 1000 });
    if (all.totalItems > all.items.length) return blocked('weekly_task_scan_truncated', '无法完整校验发布审批与依赖。');
    const approval = all.items.find(item => item.payload.publicationTaskId === task.publicationTaskId && item.payload.schedule.stepKind === 'user_approval');
    if (!approval || approval.payload.status !== 'succeeded' || !approval.payload.resultRefs.some((ref: any) => ref.type === 'user_content_approval')) return blocked('weekly_content_approval_required', '成片尚未由用户验收。');
    const inventoryRef = (publication as typeof publication & { inventoryReuseRef?: { type: string } }).inventoryReuseRef;
    if (inventoryRef) {
      try { await createWeeklyInventoryReuseService(dataStore).prepareAssignment(task); }
      catch (error) { return blocked('weekly_inventory_reuse_unverified', error instanceof Error ? error.message : '库存复用凭据不完整。'); }
    } else {
    const bindings = await dataStore.list<Row>('starter_social_content_tasks', { where: { tenant_id: task.tenantId, create_idempotency_key: `weekly-production:${task.packageId}:${task.packageVersion}:${task.publicationTaskId}` }, page: 1, perPage: 2 });
    if (bindings.totalItems !== 1 || !bindings.items[0]) return pending('weekly_production_binding_pending', '尚未取得本周成片的生产身份。');
    let productionTaskId = bindings.items[0].task_id;
    try {
      const { resolveWeeklyCreativeRepairApprovalEvidence } = await import('../socialPrograms/weeklyCreativeRepairApprovalEvidence.js');
      const repair = await resolveWeeklyCreativeRepairApprovalEvidence(dataStore, task);
      if (repair) {
        await validateWeeklyPublicationAcceptance(dataStore, task);
        productionTaskId = String(repair.contentTask.task_id);
      }
    } catch (error) { return blocked('weekly_content_acceptance_unverified', error instanceof Error ? error.message : '修订成片验收证据已变化。'); }
    const packageScan = await runWeeklyPublicationPackageScan({ dataStore, tenantId: task.tenantId, taskId: productionTaskId });
    if (packageScan.errors.length) return blocked(packageScan.errors[0]!.code, '成片发布交接校验失败，请检查产物和授权。');
    }
    const assignments = await dataStore.list<StoredPublicationAssignment>(PUBLICATION_ASSIGNMENTS, { where: { tenant_id: task.tenantId, operating_package_id: task.packageId, operating_package_version: task.packageVersion, publication_task_id: publication.publicationTaskId }, page: 1, perPage: 2 });
    if (!assignments.items.length) return pending('weekly_publication_package_pending', '等待已验收成片的发布包。');
    if (assignments.totalItems !== 1) return blocked('weekly_publication_assignment_ambiguous', '发布派单身份不唯一。');
    const assignment = assignments.items[0]!;
    if (assignment.status === 'revoked' || assignment.account_id !== task.accountId) return blocked('authorization_revoked', '发布派单已撤销或账号身份不一致。');
    try { if (inventoryRef) { const verified = await createWeeklyInventoryReuseService(dataStore).readVerifiedBinding(task); if (verified.item.source.productionResultId !== assignment.production_result_id) throw new Error('inventory_assignment_source_changed'); } else await validateWeeklyPublicationAcceptance(dataStore, task, assignment.production_result_id); }
    catch (error) { return blocked('weekly_content_acceptance_unverified', error instanceof Error ? error.message : '用户验收产物尚未验证。'); }
    const attempts = await dataStore.list<DurablePublicationAttempt>(PUBLICATION_ATTEMPTS, { where: { tenant_id: task.tenantId, assignment_id: assignment.assignment_id }, page: 1, perPage: 2 });
    if (attempts.totalItems > 1) return blocked('publication_attempt_ambiguous', '平台执行回执不唯一。');
    let attempt = attempts.items[0];
    if (attempt?.status === 'published') return publicationResult(attempt);
    if (attempt?.status === 'failed') return blocked(attempt.failure_code || 'publication_rejected', '平台已明确拒绝发布，需要人工处理。');
    if (!(options.publishingEnabled?.() ?? process.env.SOCIAL_WEEKLY_REAL_PUBLISHING_ENABLED === 'true')) return blocked('weekly_real_publishing_disabled', '真实发布尚未启用；成片与发布包已保留。');
    const publicationPackage = await readStarterPublicationPackage(task.tenantId, assignment.package_id, dataStore);
    if (!publicationPackage) return blocked('publication_package_missing', '发布包不存在。');
    const provider = options.adapterFactory ? await options.adapterFactory(assignment) : await createWeeklyPublishingAdapter({ tenantId: task.tenantId, accountId: assignment.account_id, platform: assignment.platform, dataStore, now: now() });
    if (provider.capability !== 'available') return blocked(provider.unavailableReason || 'publishing_provider_unavailable', '平台凭据失效或发布能力不可用。');
    if (attempt && ['unknown', 'in_flight'].includes(attempt.status)) {
      // Status lookup only: never submit a second publish for an ambiguous receipt.
      attempt = await reconcileWeeklyPublication({ assignment: assignment.payload, publicationPackage, adapter: provider, dataStore, now: now() });
    } else {
      const window = publicationInstant(publication.publishWindow);
      if (window === null) return blocked('publish_window_invalid', '发布需要包含时区的有效具体时间。');
      if (now().getTime() < window) return pending('publish_window_not_due', '尚未到达本条排期的发布窗口。');
      const assigned = await dataStore.list<StoredPublicationAssignment>(PUBLICATION_ASSIGNMENTS, { where: { tenant_id: task.tenantId, operating_package_id: task.packageId, operating_package_version: task.packageVersion }, page: 1, perPage: 1000 });
      if (assigned.totalItems > assigned.items.length) return blocked('publication_assignment_scan_truncated', '无法完整核验发布额度。');
      let publishedCount = 0;
      for (const item of assigned.items) {
        const published = await dataStore.list<DurablePublicationAttempt>(PUBLICATION_ATTEMPTS, { where: { tenant_id: task.tenantId, assignment_id: item.assignment_id, status: 'published' }, page: 1, perPage: 1 });
        if (published.totalItems) publishedCount += 1;
      }
      const authorizationIssue = validateWeeklyAssignmentBoundary({ assignment: assignment.payload, contentPackage: pkg.socialContentPackage, existingPublishedCount: publishedCount, now: now().toISOString() });
      if (authorizationIssue) return blocked(authorizationIssue, '发布授权未就绪、已失效或额度已用尽。');
      const reception = await checkPublicationReceptionAdmission({
        dataStore, scope: { tenantId: task.tenantId, programId: task.programId, packageId: task.packageId, packageVersion: task.packageVersion, publicationId: publication.publicationTaskId },
        cta: publication.cta ?? '', required: publication.receptionRequirement?.required === true,
        bindingId: publication.receptionRequirement?.bindingId, ports: options.receptionPorts, now: now(),
      });
      if (reception.status === 'blocked') return blocked(reception.reason, '发布承接检查未通过，请补齐入口、资料或接待配置。');
      try { await assertWeeklyPublicationG6Admission(dataStore,task,assignment,publicationPackage,{now,reception:options.receptionPorts}); }
      catch(error) { return blocked(error instanceof Error&&'code' in error?String(error.code):'weekly_g6_current_preflight_required','本条成片尚未通过同源发布预检，请在生产页核验 G6。'); }
      await assertAdmission();
      attempt = await executeWeeklyPublication({ assignment: assignment.payload, publicationPackage, contentPackage: pkg.socialContentPackage, adapter: provider, existingPublishedCount: publishedCount, dataStore, now: now() });
    }
    return publicationResult(attempt);
  }
}

function publicationResult(attempt: DurablePublicationAttempt): WeeklyExecutionAdapterResult {
  if (attempt.status === 'published' && attempt.provider_receipt_id && attempt.platform_post_id && attempt.resolved_at) return { status: 'succeeded', resultRefs: [{ type: 'weekly_publication_attempt', id: attempt.attempt_id, version: 1 }] };
  if (attempt.status === 'failed') return blocked(attempt.failure_code || 'publication_rejected', '平台已明确拒绝发布，需要人工处理。');
  return pending('publication_receipt_reconciliation_pending', '平台受理或结果未知，等待回执对账，不重复提交发布。');
}
import {assertWeeklyPublicationG6Admission} from './weeklyPublicationG6Admission.js';
