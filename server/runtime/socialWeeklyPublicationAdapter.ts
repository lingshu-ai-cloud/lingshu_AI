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
import type { SocialWeeklyExecutionAdapter, WeeklyExecutionAdapterResult } from './socialWeeklyExecutionAdapter.js';

type Row = { id: string } & Record<string, any>;
const pending = (code: string, message: string): WeeklyExecutionAdapterResult => ({ status: 'pending', code, message, retryDelayMs: 30_000 });
const blocked = (code: string, message: string): WeeklyExecutionAdapterResult => ({ status: 'blocked', code, message });

/** Reuses publication admission/reconciliation; never treats accepted or unknown as published. */
export function createSocialWeeklyPublicationAdapter(dataStore: DataStore, options: {
  now?: () => Date;
  publishingEnabled?: () => boolean;
  adapterFactory?: (assignment: StoredPublicationAssignment) => Promise<WeeklyPublishingProviderAdapter>;
} = {}): SocialWeeklyExecutionAdapter {
  const now = options.now ?? (() => new Date());
  return { async execute(task) {
    const packages = await dataStore.list<Row>('social_weekly_operating_packages', { where: { tenant_id: task.tenantId, package_id: task.packageId, version: task.packageVersion }, page: 1, perPage: 2 });
    if (packages.totalItems !== 1 || !packages.items[0]) return blocked('weekly_package_missing', '周任务包版本不存在或不唯一。');
    const row = packages.items[0];
    const pkg = row.payload as WeeklyOperatingPackage;
    if (pkg.packageId !== task.packageId || pkg.version !== task.packageVersion || pkg.programId !== task.programId) return blocked('weekly_package_identity_invalid', '周任务包身份不一致。');
    if (pkg.status !== 'active') return blocked('weekly_package_inactive', '周任务包已停用或被修订替代。');
    if (task.schedule.stepKind === 'publishing') {
      try { return await withWeeklyProductionAdmissionGuard({ dataStore, tenantId: task.tenantId, packageId: task.packageId, packageVersion: task.packageVersion, action: assertAdmission => publish(task, pkg, assertAdmission) }); }
      catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'weekly_publication_admission_failed';
        return code === 'weekly_cancellation_busy' ? pending(code, '撤回或其他执行正在处理，等待安全核对。') : blocked(code, '本周发布已停止或撤回，已有回执保留。');
      }
    }
    if (task.schedule.stepKind === 'performance_monitoring') {
      const rows = await dataStore.list<Row>('social_metric_snapshots', { where: { tenant_id: task.tenantId, account_id: task.accountId! }, sort: '-captured_at', page: 1, perPage: 100 });
      const starts = Date.parse(`${pkg.weekStart}T00:00:00Z`);
      const ends = Date.parse(`${pkg.weekEnd}T23:59:59.999Z`);
      const sources = rows.items.filter(item => {
        const captured = Date.parse(item.captured_at || item.capturedAt || '');
        const metrics = typeof item.metrics === 'object' && item.metrics ? item.metrics : {};
        return captured >= starts && captured <= ends && captured <= now().getTime()
          && !item.mock && !item.simulated && !['mock', 'simulated'].includes(item.source)
          && SOCIAL_METRIC_KEYS.some(key => typeof metrics[key] === 'number' && Number.isFinite(metrics[key]) && metrics[key] >= 0);
      });
      if (!sources.length) return pending('weekly_metrics_pending', '尚未取得本周真实平台指标，保留待回流状态。');
      return { status: 'succeeded', resultRefs: sources.map(item => ({ type: 'social_metric_snapshot', id: item.id, version: 1 })) };
    }
    if (task.schedule.stepKind === 'weekly_review') {
      const result = await runWeeklyReviewForPackage({ dataStore, row: row as Parameters<typeof runWeeklyReviewForPackage>[0]['row'], now: now() });
      if (result.status !== 'completed' || !result.snapshot) return pending(result.reason || 'weekly_review_pending', '周复盘尚未到期或证据暂不可用。');
      return { status: 'succeeded', resultRefs: [{ type: 'weekly_review_snapshot', id: result.snapshot.snapshotId, version: 1 }] };
    }
    return blocked('weekly_execution_adapter_missing', '该执行节点没有匹配的发布或复盘适配器。');
  } };

  async function publish(task: WeeklyExecutionTask, pkg: WeeklyOperatingPackage, assertAdmission: () => Promise<void>): Promise<WeeklyExecutionAdapterResult> {
    const publication = pkg.socialContentPackage.publicationTasks.find(item => item.publicationTaskId === task.publicationTaskId && item.accountId === task.accountId);
    if (!publication) return blocked('weekly_publication_identity_invalid', '发布任务不属于当前周包或账号。');
    const all = await dataStore.list<Row>('social_weekly_execution_tasks', { where: { tenant_id: task.tenantId, package_id: task.packageId, package_version: task.packageVersion }, page: 1, perPage: 1000 });
    if (all.totalItems > all.items.length) return blocked('weekly_task_scan_truncated', '无法完整校验发布审批与依赖。');
    const approval = all.items.find(item => item.payload.publicationTaskId === task.publicationTaskId && item.payload.schedule.stepKind === 'user_approval');
    if (!approval || approval.payload.status !== 'succeeded' || !approval.payload.resultRefs.some((ref: any) => ref.type === 'user_content_approval')) return blocked('weekly_content_approval_required', '成片尚未由用户验收。');
    const bindings = await dataStore.list<Row>('starter_social_content_tasks', { where: { tenant_id: task.tenantId, create_idempotency_key: `weekly-production:${task.packageId}:${task.packageVersion}:${task.publicationTaskId}` }, page: 1, perPage: 2 });
    if (bindings.totalItems !== 1 || !bindings.items[0]) return pending('weekly_production_binding_pending', '尚未取得本周成片的生产身份。');
    const packageScan = await runWeeklyPublicationPackageScan({ dataStore, tenantId: task.tenantId, taskId: bindings.items[0].task_id });
    if (packageScan.errors.length) return blocked(packageScan.errors[0]!.code, '成片发布交接校验失败，请检查产物和授权。');
    const assignments = await dataStore.list<StoredPublicationAssignment>(PUBLICATION_ASSIGNMENTS, { where: { tenant_id: task.tenantId, operating_package_id: task.packageId, operating_package_version: task.packageVersion, publication_task_id: publication.publicationTaskId }, page: 1, perPage: 2 });
    if (!assignments.items.length) return pending('weekly_publication_package_pending', '等待已验收成片的发布包。');
    if (assignments.totalItems !== 1) return blocked('weekly_publication_assignment_ambiguous', '发布派单身份不唯一。');
    const assignment = assignments.items[0]!;
    if (assignment.status === 'revoked' || assignment.account_id !== task.accountId) return blocked('authorization_revoked', '发布派单已撤销或账号身份不一致。');
    try { await validateWeeklyPublicationAcceptance(dataStore, task, assignment.production_result_id); }
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
      const window = Date.parse(publication.publishWindow || '');
      if (!Number.isFinite(window)) return blocked('publish_window_invalid', '发布窗口缺失。');
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
