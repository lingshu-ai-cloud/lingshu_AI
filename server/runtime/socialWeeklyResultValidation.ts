import type { VersionedSocialRef, WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { SocialProgramError } from '../socialPrograms/service.js';
import { assertSocialContentFilePersisted } from '../starter198/socialContentFiles.js';
import { SOCIAL_METRIC_KEYS } from '../socialMetrics/aggregation.js';
import { socialTaskSummary } from '../starter198/socialContentRecords.js';

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const version = (value: unknown): number => Number(String(value).replace(/^v/, ''));
function requireResult(condition: unknown, code = 'weekly_execution_result_unverified'): asserts condition {
  if (!condition) throw new SocialProgramError(code, 409, '执行结果资源、归属、版本或完成凭据尚未验证。');
}
async function unique(store: DataStore, collection: string, where: Record<string, string | number>): Promise<Record_> {
  const rows = await store.list<Record_>(collection, { where, page: 1, perPage: 2 });
  requireResult(rows.totalItems === 1 && rows.items.length === 1);
  const row = rows.items[0]!;
  requireResult(Object.entries(where).every(([key, value]) => row[key] === value));
  return row;
}

/** Verify persisted authority, never accept a client-supplied success label. */
export async function validateWeeklyExecutionResults(store: DataStore, task: WeeklyExecutionTask, refs: VersionedSocialRef[], now = new Date()): Promise<void> {
  requireResult(Array.isArray(refs) && refs.length > 0 && refs.every(ref => text(ref?.type) && text(ref?.id) && Number.isSafeInteger(ref?.version) && ref.version > 0), 'weekly_execution_result_refs_invalid');
  for (const ref of refs) {
    if (ref.type === 'weekly_agent_planning' && ['readiness', 'discovery', 'directing'].includes(task.workflowKind)) {
      const row = await unique(store, 'social_weekly_agent_planning', { tenant_id: task.tenantId, program_id: task.programId, package_id: task.packageId, package_version: task.packageVersion, planning_version: ref.version });
      const plan = object(row.payload);
      requireResult(plan.planningId === ref.id && plan.version === ref.version && plan.status === 'dispatched' && text(plan.userConfirmation?.confirmedBy) && text(plan.userConfirmation?.confirmedAt) && plan.dispatch?.scheduleItems?.length && plan.detailedSchedule?.items?.length);
      const step = task.schedule.stepKind;
      const motherId = String(task.inputSnapshot.motherContentId ?? '');
      const slots = (plan.skeleton?.slots ?? []).filter((slot: any) => !motherId || slot.motherContentId === motherId);
      requireResult(slots.length && (!task.accountId || slots.some((slot: any) => slot.accountIds.includes(task.accountId))));
      if (step === 'business_outline') requireResult(plan.skeleton?.slots?.length);
      else if (step === 'business_schedule') requireResult(slots.every((slot: any) => slot.publicationTaskIds.every((id: string) => plan.detailedSchedule.items.some((item: any) => item.publicationTaskId === id) && plan.dispatch.scheduleItems.some((item: any) => item.publicationTaskId === id))));
      else if (['benchmark_collection', 'benchmark_scoring', 'director_analysis'].includes(step)) {
        const analyses = (plan.directorAnalyses ?? []).filter((analysis: any) => slots.some((slot: any) => slot.slotId === analysis.slotId));
        requireResult(analyses.length && analyses.every((analysis: any) => analysis.packageVersion === task.packageVersion && analysis.benchmarkAccountRefs?.length && analysis.benchmarkVideoRefs?.length && analysis.benchmarkEvidenceRefs?.length && text(analysis.contentDirection)));
      } else requireResult(false);
    } else if (ref.type === 'starter_social_content_task' && task.workflowKind === 'content' && task.schedule.stepKind === 'material_readiness') {
      const row = await unique(store, 'starter_social_content_tasks', { tenant_id: task.tenantId, task_id: ref.id });
      requireResult(version(row.version) === ref.version);
      const summary = socialTaskSummary(row);
      requireResult(summary.readiness.complete && summary.runId && !['cancelled', 'paused', 'attention', 'needs_input'].includes(summary.status));
      const run = await store.getById<Record_>('workflow_runs', summary.runId!);
      requireResult(run?.tenant_id === task.tenantId && !['cancelled', 'failed', 'dead_letter'].includes(String(run.status)));
      const brief = object(row.brief);
      requireResult(brief.programRef?.id === task.programId && row.create_idempotency_key === `weekly-production:${task.packageId}:${task.packageVersion}:${task.publicationTaskId}`);
    } else if (ref.type === 'starter_social_content_artifact' && task.workflowKind === 'content') {
      await validateContentArtifact(store, task, ref);
    } else if (ref.type === 'weekly_publication_attempt' && task.workflowKind === 'publishing' && task.schedule.stepKind === 'publishing') {
      requireResult(ref.version === 1);
      const attempt = await unique(store, 'social_publication_attempts', { tenant_id: task.tenantId, attempt_id: ref.id });
      requireResult(attempt.status === 'published' && text(attempt.provider_receipt_id) && text(attempt.platform_post_id) && Number.isFinite(Date.parse(String(attempt.resolved_at))) && text(attempt.provider) && !attempt.mock && !attempt.simulated && !/mock|simulat|test[_-]?provider/i.test(String(attempt.provider)) && !/^(simr_|mock|simulat)/i.test(String(attempt.provider_receipt_id)) && !/^(simp_|mock|simulat)/i.test(String(attempt.platform_post_id)));
      const assignment = await unique(store, 'social_publication_assignments', { tenant_id: task.tenantId, assignment_id: String(attempt.assignment_id) });
      requireResult(assignment.status !== 'revoked' && !assignment.authorization_revoked_at && assignment.package_id === attempt.package_id && assignment.operating_package_id === task.packageId && assignment.operating_package_version === task.packageVersion && assignment.publication_task_id === task.publicationTaskId && assignment.account_id === task.accountId);
      const weekly = await unique(store, 'social_weekly_operating_packages', { tenant_id: task.tenantId, package_id: task.packageId, version: task.packageVersion });
      const pack = object(object(weekly.payload).socialContentPackage);
      requireResult(pack.authorization?.allowRealPublishing === true && !pack.authorization.revokedAt && pack.authorization.accountIds?.includes(task.accountId));
      await validateWeeklyPublicationAcceptance(store, task, String(assignment.production_result_id));
    } else if (ref.type === 'social_metric_snapshot' && task.workflowKind === 'engagement') {
      const row = await store.getById<Record_>('social_metric_snapshots', ref.id);
      requireResult(ref.version === 1 && row?.tenant_id === task.tenantId && row.account_id === task.accountId && Number.isFinite(Date.parse(String(row.captured_at))));
      const weekly = await unique(store, 'social_weekly_operating_packages', { tenant_id: task.tenantId, package_id: task.packageId, version: task.packageVersion });
      const pkg = object(weekly.payload);
      const captured = Date.parse(String(row.captured_at));
      requireResult(pkg.programId === task.programId && captured >= Date.parse(`${pkg.weekStart}T00:00:00Z`) && captured <= Date.parse(`${pkg.weekEnd}T23:59:59.999Z`) && captured <= now.getTime() && !row.mock && !row.simulated && !/mock|simulat/i.test(String(row.source ?? '')));
      const metrics = object(row.metrics);
      requireResult(SOCIAL_METRIC_KEYS.some(key => typeof metrics[key] === 'number' && Number.isFinite(metrics[key]) && metrics[key] >= 0) && Object.values(metrics).every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0));
    } else if (ref.type === 'weekly_review_snapshot' && task.workflowKind === 'review') {
      requireResult(ref.version === 1);
      const row = await unique(store, 'social_weekly_review_snapshots', { tenant_id: task.tenantId, package_id: task.packageId, package_version: task.packageVersion, snapshot_id: ref.id });
      const snapshot = object(row.snapshot);
      requireResult(snapshot.snapshotId === ref.id && snapshot.tenantId === task.tenantId && snapshot.programId === task.programId && text(row.source_digest) && text(row.frozen_by) && Number.isFinite(Date.parse(String(row.frozen_at))) && snapshot.window?.frozenAt === row.frozen_at && snapshot.sourceDigest === row.source_digest && snapshot.operatingPackageRef?.id === task.packageId && snapshot.operatingPackageRef?.version === task.packageVersion);
    } else requireResult(false, 'weekly_execution_result_type_unsupported');
  }
}

export async function validateContentArtifact(store: DataStore, task: WeeklyExecutionTask, ref: VersionedSocialRef) {
  const row = await unique(store, 'starter_social_content_artifacts', { tenant_id: task.tenantId, artifact_id: ref.id });
  requireResult(version(row.version) === ref.version && ['draft', 'review_required', 'approved'].includes(String(row.status)));
  const content = object(row.content);
  const source = await unique(store, 'starter_social_content_tasks', { tenant_id: task.tenantId, task_id: String(row.task_id) });
  requireResult(source.create_idempotency_key === `weekly-production:${task.packageId}:${task.packageVersion}:${task.publicationTaskId}` && object(source.brief).programRef?.id === task.programId);
  requireResult(text(source.run_id) && !['cancelled', 'paused', 'attention', 'needs_input'].includes(String(source.status)));
  const run = await store.getById<Record_>('workflow_runs', String(source.run_id));
  requireResult(run?.tenant_id === task.tenantId && !['cancelled', 'failed', 'dead_letter'].includes(String(run.status)));
  requireResult(row.artifact_kind === 'short_video' && row.origin === 'agent' && text(row.resource_ref) && content.render?.completed === true);
  const media = object(content.mediaStorage?.video);
  requireResult(text(media.fileId) && /^[a-f0-9]{64}$/i.test(text(media.sha256)) && text(media.url));
  const file = await unique(store, 'starter_social_content_files', { tenant_id: task.tenantId, file_id: media.fileId });
  requireResult(row.resource_ref === `socialfile:${media.fileId}` && file.task_id === row.task_id && file.content_sha256 === media.sha256 && Number(file.byte_size) > 0 && ['object', 'backend_file', 'local'].includes(String(file.storage_kind)));
  await assertSocialContentFilePersisted({ record: file, tenantId: task.tenantId });
  const step = task.schedule.stepKind;
  if (step === 'script') requireResult(content.scriptBaseline?.scenes?.length && content.scriptBaseline.scenes.every((scene: any) => text(scene.script) || text(scene.voiceover)));
  else if (step === 'storyboard') requireResult(content.directorPlan?.sceneCount > 0);
  else if (step === 'asset_generation') requireResult(content.render?.selectedAssetIds?.length > 0);
  else if (step === 'video_generation') requireResult(text(content.mediaStorage?.video?.url) && text(content.mediaStorage?.video?.sha256));
  else if (['quality_check', 'rework'].includes(step)) requireResult(content.productionResult?.technicalReview?.approved === true && content.productionResult?.creativeReview?.approved === true && text(content.mediaStorage?.video?.url));
  else requireResult(false, 'weekly_execution_result_type_unsupported');
}

/** Pre-effect gate: acceptance cannot be inferred from a user approval marker alone. */
export async function validateWeeklyPublicationAcceptance(store: DataStore, task: WeeklyExecutionTask, assignmentProductionId?: string): Promise<void> {
  const approvals = await store.list<Record_>('social_weekly_execution_tasks', { where: { tenant_id: task.tenantId, package_id: task.packageId, package_version: task.packageVersion }, page: 1, perPage: 1000 });
  requireResult(approvals.totalItems <= approvals.items.length);
  const approval = approvals.items.find(row => {
    const item = object(row.payload);
    return row.tenant_id === task.tenantId && item.tenantId === task.tenantId && item.publicationTaskId === task.publicationTaskId && item.schedule?.stepKind === 'user_approval' && item.status === 'succeeded' && item.resultRefs?.some((ref: any) => ref.type === 'user_content_approval');
  });
  requireResult(approval);
  const artifactRef = object(approval.payload).resultRefs.find((ref: any) => ref.type === 'starter_social_content_artifact') as VersionedSocialRef | undefined;
  requireResult(artifactRef && Number.isSafeInteger(artifactRef.version) && artifactRef.version > 0);
  const artifact = await unique(store, 'starter_social_content_artifacts', { tenant_id: task.tenantId, artifact_id: artifactRef.id });
  requireResult(artifact.status === 'approved' && text(object(artifact.content).productionResult?.productionResultId) && (!assignmentProductionId || object(artifact.content).productionResult.productionResultId === assignmentProductionId));
  await validateContentArtifact(store, { ...task, workflowKind: 'content', schedule: { ...task.schedule, stepKind: 'quality_check' } }, artifactRef);
}
