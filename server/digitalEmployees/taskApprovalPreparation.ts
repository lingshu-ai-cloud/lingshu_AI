import { managedPublishingGrantCovers } from './managedPublishingGrant.js';
import { normalizeContinuationPolicy } from '../../shared/contracts/continuationPolicy.js';
import { publishingPlatformsCovered } from './executionDiagnostics.js';
import { grantCovers } from './weeklyPackage.js';
import { type WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { weeklyAuthorizationRecoveryDecision } from './weeklyAuthorizationRecovery.js';
import { missingPublishingOAuthConfiguration, publishingAccountConnectionMessage, publishingOAuthConfigurationMessage, type PublishingOAuthPlatform } from './publishingOAuthReadiness.js';
import { packageGrantWasInvalidatedAfterApproval } from './publishingPlanAccountMigration.js';
import { getTenantAwareGoogleOAuthClient, getTenantAwareInstagramOAuthClient, getTenantAwareLinkedInOAuthClient, getTenantAwareMetaOAuthClient, getTenantAwareTikTokOAuthClient } from '../lib/oauthConfig.js';
import { contentAcceptanceHash } from './contentAcceptance.js';
import { store } from '../storage/index.js';
import { type BusinessSnapshot } from './businessSnapshot.js';

import { listConnectedPublishingAccounts } from './publishingTargets.js';
import { buildPublishingApprovalPackage, createPublishingCalendarEntries, type PublishingApprovalPackage } from './publishingExecution.js';
import { beijingDate } from './runtimeSchedule.js';
import { goalInput, publicConfig } from './overviewProjection.js';
import { contentProjectTaskScope, recordBelongsToTask, studioProjectCompleted, taskScope } from './taskEvidenceProjection.js';
import { applyFollowupBatchDecision, getFollowupBatchItems, type FollowupBatchRecord } from './customerWorkflow.js';

import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, type ApprovalRecord, type EventRecord, type GoalRecord, type PlanRecord, type RunRecord, type StoredRecord, type TaskRecord } from './records.js';
import type { DigitalEmployeeApplicationPorts, ApprovalPreflight } from './applicationPorts.js';

export function createTaskApprovalPreparation(deps: Pick<DigitalEmployeeApplicationPorts, 'listAllRecords' | 'appendAudit' | 'appendEvent' | 'tenantRecord' | 'first' | 'requiredCreate' | 'configForTenant' | 'executionConfigForPlan' | 'resolveCurrentConfiguration'>) {
  function listAllRecords<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort?: string): Promise<T[]> {
    return deps.listAllRecords<T>(collection, where, sort);
  }

  const appendAudit: DigitalEmployeeApplicationPorts['appendAudit'] = (...args) => deps.appendAudit(...args);

  const appendEvent: DigitalEmployeeApplicationPorts['appendEvent'] = (...args) => deps.appendEvent(...args);

  function tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
    return deps.tenantRecord<T>(collection, id, tenantId);
  }

  function first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort = '-created_at'): Promise<T | null> {
    return deps.first<T>(collection, where, sort);
  }

  function requiredCreate<T extends StoredRecord>(collection: string, payload: Record<string, unknown>): Promise<T> {
    return deps.requiredCreate<T>(collection, payload);
  }

  const configForTenant: DigitalEmployeeApplicationPorts['configForTenant'] = (...args) => deps.configForTenant(...args);

  const executionConfigForPlan: DigitalEmployeeApplicationPorts['executionConfigForPlan'] = (...args) => deps.executionConfigForPlan(...args);

  const resolveCurrentConfiguration: DigitalEmployeeApplicationPorts['resolveCurrentConfiguration'] = (...args) => deps.resolveCurrentConfiguration(...args);

  async function restoreExecutionOnlyInvalidatedAuthorization(
    tenantId: string,
    goal: GoalRecord,
    run: RunRecord,
    plan: PlanRecord | null,
  ): Promise<boolean> {
    if (!plan) return false;
    const planBody = jsonObject<Record<string, unknown>>(plan.plan, {});
    if (String(planBody.packageApprovedBy || '').trim()
      || !String(planBody.packageApprovedAt || '').trim()
      || !String(planBody.packageGrantInvalidatedAt || '').trim()) return false;
    const [audits, events] = await Promise.all([
      listAllRecords<StoredRecord>('audit_logs', { tenantId }, 'createdAt'),
      listAllRecords<EventRecord>(COLLECTION.events, { tenant_id: tenantId, run_id: run.id, type: 'authorization_required' }, 'occurred_at'),
    ]);
    const decision = weeklyAuthorizationRecoveryDecision({
      goalId: goal.id,
      planId: plan.id,
      runId: run.id,
      approvedAt: planBody.packageApprovedAt,
      approvedBy: planBody.packageApprovedBy,
      invalidatedAt: planBody.packageGrantInvalidatedAt,
      audits: audits.map(audit => ({
        action: audit.action,
        actorUserId: audit.actorUserId,
        targetType: audit.targetType,
        targetId: audit.targetId,
        metadata: audit.metadata,
        createdAt: audit.createdAt,
      })),
      events: events.map(event => ({ type: event.type, payload: event.payload, occurred_at: event.occurred_at })),
    });
    if (!decision.restore) return false;
    const restoredAt = new Date().toISOString();
    const restoredPlan = {
      ...planBody,
      packageApprovedBy: decision.actorUserId,
      packageAuthorizationRecoveredAt: restoredAt,
      packageAuthorizationRecoveredFrom: decision.invalidatedAt,
      packageGrantInvalidatedAt: '',
    };
    const restored = await store.compareAndSwap?.(COLLECTION.plans, plan.id, {
      tenant_id: tenantId,
      goal_id: goal.id,
      plan: plan.plan,
    }, { plan: restoredPlan });
    if (!restored) return false;
    plan.plan = restoredPlan;
    await appendAudit({
      tenantId,
      userId: decision.actorUserId,
      action: 'weekly_package.authorization_recovered',
      targetType: 'weekly_plan',
      targetId: plan.id,
      metadata: { runId: run.id, approvedAt: decision.approvedAt, invalidatedAt: decision.invalidatedAt, reason: 'execution_only_retry_invalidation' },
    });
    await appendEvent({
      tenantId,
      runId: run.id,
      type: 'authorization_restored',
      level: 'success',
      summary: '已核对原审核凭证：此前仅因内部任务重试误撤销，现已恢复原预算与发布范围授权。',
      payload: { reason: 'execution_only_retry_invalidation', approvedAt: decision.approvedAt, invalidatedAt: decision.invalidatedAt },
    });
    return true;
  }

  function dependenciesReady(task: TaskRecord, tasks: TaskRecord[]): boolean {
    tasks = tasks.filter(item => !jsonObject<Record<string, unknown>>(item.output, {}).assistantIndependent || item.id === task.id);
    const byKey = new Map(tasks.map(item => [item.task_key, item]));
    return jsonObject<string[]>(task.depends_on, []).every(key => {
      const upstream = byKey.get(key);
      return Boolean(upstream && ['succeeded', 'skipped'].includes(upstream.status));
    });
  }

  async function approvalPreflight(
    tenantId: string,
    run: RunRecord,
    task: TaskRecord,
    tasks: TaskRecord[],
    snapshot: BusinessSnapshot,
  ): Promise<ApprovalPreflight> {
    const checks: ApprovalPreflight['checks'] = [{
      key: 'dependencies',
      ready: dependenciesReady(task, tasks),
      detail: dependenciesReady(task, tasks) ? '上游任务已完成' : '上游任务尚未完成',
    }];
    const businessRefs: Array<Record<string, unknown>> = [];
    if (task.task_key === 'content_release_approval') {
      const scope = contentProjectTaskScope(task, tasks);
      const projects = await store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 });
      const completed = projects.items.filter(item => recordBelongsToTask(item, run, scope) && studioProjectCompleted(item));
      const social = snapshot.readiness.find(item => item.key === 'social_accounts');
      checks.push(
        { key: 'approved_content_scope', ready: completed.length > 0, detail: completed.length ? `已关联 ${completed.length} 个当前运行的完成作品` : '当前运行尚未关联已完成作品' },
        { key: 'social_accounts', ready: social?.status === 'ready', detail: social?.note || '尚未连接发布账号' },
      );
      const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, tenantId);
      if (goal) {
        const connectedAccounts = await listConnectedPublishingAccounts(tenantId);
        const connectedIds = new Set(connectedAccounts.map(account => account.accountId));
        const targetPlatforms = goalInput(goal).contentPlatforms;
        const connectedPlatforms = connectedAccounts.map(account => account.platform);
        const [metaClient, instagramClient, tiktokClient, googleClient, linkedinClient] = await Promise.all([
          getTenantAwareMetaOAuthClient(tenantId),
          getTenantAwareInstagramOAuthClient(tenantId),
          getTenantAwareTikTokOAuthClient(tenantId),
          getTenantAwareGoogleOAuthClient(tenantId),
          getTenantAwareLinkedInOAuthClient(tenantId),
        ]);
        const oauthConfigurationGaps = missingPublishingOAuthConfiguration({
          targetPlatforms,
          connectedPlatforms,
          clients: { meta: Boolean(metaClient), instagram: Boolean(instagramClient), tiktok: Boolean(tiktokClient), google: Boolean(googleClient), linkedin: Boolean(linkedinClient) },
        });
        const connectedPlatformSet = new Set(connectedPlatforms);
        const missingAccountPlatforms = targetPlatforms
          .filter((platform): platform is PublishingOAuthPlatform => ['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin'].includes(platform))
          .filter(platform => !connectedPlatformSet.has(platform));
        checks.push({
          key: 'publishing_oauth_configuration',
          ready: oauthConfigurationGaps.length === 0,
          detail: publishingOAuthConfigurationMessage(oauthConfigurationGaps),
        });
        checks.push({
          key: 'publishing_account_connections',
          ready: missingAccountPlatforms.length === 0,
          detail: publishingAccountConnectionMessage(missingAccountPlatforms),
        });
        try {
          const publishingPackage = await publishingApprovalPackage(tenantId, goal, run, task, tasks);
          const packageAccountIds = [...new Set(publishingPackage.items.flatMap(item => item.accountIds))];
          const packageAccountsValid = packageAccountIds.length > 0 && packageAccountIds.every(accountId => connectedIds.has(accountId));
          const platformCoverage = publishingPlatformsCovered(targetPlatforms, publishingPackage.items)
            && missingAccountPlatforms.length === 0
            && packageAccountsValid;
          checks.push({ key: 'publishing_platform_coverage', ready: platformCoverage,
            detail: platformCoverage ? '本周目标平台均有已连接的发布账号' : '部分目标平台缺少有效发布账号，请重新连接并更新周计划' });
          checks.push({
            key: 'publishable_outputs',
            ready: publishingPackage.items.length > 0,
            detail: publishingPackage.items.length ? `待审批发布项 ${publishingPackage.items.length} 条` : '完成作品尚缺可发布成片文件',
          });
          checks.push({
            key: 'selected_publishing_accounts',
            ready: packageAccountsValid,
            detail: packageAccountsValid ? `已核验 ${packageAccountIds.length} 个本期发布账号` : '本期选择的发布账号已断开或不再属于当前企业',
          });
        } catch (error) {
          const detail = error instanceof Error && error.message.includes('IANA')
            ? '发布账号尚未配置有效时区，请在账号设置中补充后再审批发布'
            : error instanceof Error && error.message === 'bounded_authorization_actor_missing'
              ? '本周发布授权已因计划或成片变更失效，请重新确认周计划后再审批发布'
              : error instanceof Error && error.message.includes('无法安排')
                ? error.message
                : '发布审批包尚未满足生成条件，请检查账号、排期和成片设置';
          checks.push({ key: 'publishing_package', ready: false, detail });
        }
      }
      businessRefs.push(...completed.map(item => ({ type: 'studio_project', id: item.id, status: String(item.status || '') })));
    }
    if (task.task_key === 'followup_batch_approval') {
      const batch = await first<FollowupBatchRecord>(COLLECTION.followupBatches, { tenant_id: tenantId, run_id: run.id }, '-version');
      const items = batch ? await getFollowupBatchItems(tenantId, batch.id) : [];
      const safeDrafts = items.filter(item => item.status === 'draft' && !item.exclusion_reason && Boolean(item.content_hash));
      checks.push(
        { key: 'batch_version', ready: Boolean(batch && ['draft', 'pending_approval'].includes(batch.status) && batch.content_hash), detail: batch ? `批次 v${batch.version}，内容指纹 ${batch.content_hash ? '已生成' : '缺失'}` : '尚未生成当前运行的跟进批次' },
        { key: 'safe_recipients', ready: safeDrafts.length > 0, detail: `可审批草稿 ${safeDrafts.length} 条，安全阻断 ${items.length - safeDrafts.length} 条` },
      );
      if (batch) businessRefs.push({ type: 'followup_batch', id: batch.id, version: batch.version, contentHash: batch.content_hash, safeDraftCount: safeDrafts.length });
    }
    const failed = checks.filter(check => !check.ready);
    const reasonChecks = task.task_key === 'content_release_approval'
      && failed.some(check => check.key === 'publishing_account_connections')
      ? failed.filter(check => !['social_accounts', 'publishing_platform_coverage', 'selected_publishing_accounts'].includes(check.key))
      : failed;
    return {
      ready: failed.length === 0,
      reason: failed.length ? `审批前资源预检未通过：${reasonChecks.map(check => check.detail).join('；')}` : '',
      checks,
      businessRefs,
    };
  }

  async function createApproval(tenantId: string, goal: GoalRecord, run: RunRecord, task: TaskRecord, allTasks: TaskRecord[]): Promise<ApprovalRecord> {
    const existing = await first<ApprovalRecord>(COLLECTION.approvals, { tenant_id: tenantId, task_id: task.id, status: 'pending' }, '-created_at');
    const approvalCreatedAt = existing?.status === 'pending' && existing.created_at ? existing.created_at : new Date().toISOString();
    const scope = taskScope(task, allTasks);
    const evidence: Array<Record<string, unknown>> = allTasks
      .filter(item => item.id !== task.id && scope.taskIds.has(item.id) && ['succeeded', 'skipped'].includes(item.status))
      .map(item => ({ taskId: item.id, title: item.title, status: item.status, output: jsonObject(item.output, {}), businessRefs: jsonObject(item.business_refs, []) }));
    let actionSummary = '批准内容执行包进入发布日历；本次审批仅批准当前版本，不会伪造平台发布结果。';
    let subjectVersion = Number(task.task_version || 1);
    let contentHash = '';
    let approvalBatch: FollowupBatchRecord | null = null;
    if (task.task_key === 'content_release_approval') {
      const publishingPackage = await publishingApprovalPackage(tenantId, goal, run, task, allTasks, approvalCreatedAt);
      evidence.push({ type: 'publishing_approval_package', ...publishingPackage });
      contentHash = publishingPackage.contentHash;
      actionSummary = publishingPackage.allowRealPublishing
        ? `整批审批 ${publishingPackage.items.length} 个发布项；每项均已冻结平台、账号、文案、成片和时间。批准后自动写入发布日历并由发布 Worker 到期真实发布。`
        : `整批审批 ${publishingPackage.items.length} 个发布项；每项均已冻结平台、账号、文案、成片和时间。当前未授权真实发布，批准后只写入人工待发布日历。`;
    }
    if (task.task_key === 'followup_batch_approval') {
      const batch = await first<FollowupBatchRecord>(COLLECTION.followupBatches, { tenant_id: tenantId, run_id: run.id }, '-version');
      if (batch) {
        approvalBatch = batch;
        evidence.push({
          batchId: batch.id,
          segmentId: batch.segment_id,
          version: batch.version,
          contentHash: batch.content_hash,
          counts: jsonObject(batch.counts, {}),
          safetySummary: jsonObject(batch.safety_summary, {}),
          deliveryPolicy: jsonObject(batch.delivery_policy, {}),
        });
        actionSummary = '批准当前版本的逐客跟进草稿；批准后 Worker 仅在逐客计划时间到达且发送前安全复核通过时执行，Meta 回执将逐条回写。';
        subjectVersion = Number(batch.version || 1);
        contentHash = String(batch.content_hash || '');
      }
    }
    const payload = {
      tenant_id: tenantId,
      goal_id: goal.id,
      run_id: run.id,
      task_id: task.id,
      status: 'pending',
      action_summary: actionSummary,
      risk_level: 'high',
      evidence,
      requested_by_agent: task.agent_role,
      decided_by: '',
      decision_note: '',
      created_at: approvalCreatedAt,
      decided_at: '',
      subject_version: subjectVersion,
      content_hash: contentHash,
    };
    let approval: ApprovalRecord;
    if (!existing || Number(existing.subject_version) !== subjectVersion || String(existing.content_hash || '') !== contentHash) {
      if (existing) await store.update(COLLECTION.approvals, existing.id, { status: 'superseded', decided_at: new Date().toISOString() });
      approval = await requiredCreate<ApprovalRecord>(COLLECTION.approvals, payload);
    } else {
      const updated = await store.update(COLLECTION.approvals, existing.id, payload);
      if (!updated) throw new Error('approval_request_storage_unavailable');
      approval = { ...existing, ...payload };
    }
    if (approvalBatch) {
      await store.update(COLLECTION.followupBatches, approvalBatch.id, {
        status: 'pending_approval', approval_id: approval.id, updated_at: new Date().toISOString(),
      });
    }
    return approval;
  }

  async function publishingApprovalPackage(
    tenantId: string,
    goal: GoalRecord,
    run: RunRecord,
    task: TaskRecord,
    tasks: TaskRecord[],
    scheduleAnchor?: string,
  ): Promise<PublishingApprovalPackage> {
    const [plan, configRecord, projects] = await Promise.all([
      tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId),
      configForTenant(tenantId),
      store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 }),
    ]);
    const currentConfig = publicConfig(configRecord);
    if (!currentConfig) throw new Error('publishing_config_missing');
    const config = executionConfigForPlan(plan, currentConfig);
    const planBody = jsonObject<Record<string, unknown>>(plan?.plan, {});
    const weeklyPackage = planBody.businessPackage as WeeklyPackage | undefined;
    const scope = contentProjectTaskScope(task, tasks);
    const completed = projects.items.filter(item => recordBelongsToTask(item, run, scope) && studioProjectCompleted(item));
    const assistantPublicationTargets = jsonObject<Array<Record<string, unknown>>>(task.business_refs, []).filter(ref => ref.type === 'assistant_publication_intent');
    if (assistantPublicationTargets.length > 1) throw new Error('assistant_publication_target_ambiguous');
    const assistantPublicationTarget = assistantPublicationTargets[0];
    if (assistantPublicationTarget) {
      const selected = completed.filter(project => project.id === assistantPublicationTarget.id);
      if (selected.length !== 1 || contentAcceptanceHash(jsonObject<Record<string, any>>(selected[0]!.spec, {})) !== assistantPublicationTarget.contentHash) throw new Error('assistant_publication_target_changed');
    }
    return buildPublishingApprovalPackage({
      tenantId,
      matrixPlan: jsonObject<{ businessPackage?: WeeklyPackage }>(plan?.plan, {}).businessPackage?.matrixPlan,
      projects: completed,
      ...(assistantPublicationTarget ? { selectedProjectId: String(assistantPublicationTarget.id) } : {}),
      targets: config.publishingTargets,
      goalPlatforms: goalInput(goal).contentPlatforms,
      allowRealPublishing: config.allowRealPublishing,
      now: new Date(scheduleAnchor || (normalizeContinuationPolicy(config.continuationPolicy).publishingTimezone === 'legacy' ? run.started_at : new Date().toISOString())),
      ...(normalizeContinuationPolicy(config.continuationPolicy).publishingTimezone !== 'legacy' ? { scheduling: { startsAt: goal.starts_at, endsAt: goal.ends_at, timezone: normalizeContinuationPolicy(config.continuationPolicy).publishingTimezone as 'account' | 'Asia/Shanghai' } } : {}),
      ...(weeklyPackage?.authorization.mode === 'bounded' ? { boundedAuthorization: {
          packageRevision: weeklyPackage.revision,
          authorizedBy: String(planBody.packageApprovedBy || ''),
          authorizedAt: String(planBody.packageApprovedAt || ''),
          startsAt: goal.starts_at,
          endsAt: goal.ends_at,
          accountBindings: config.publishingTargets
            .filter(target => weeklyPackage.authorization.accountIds.includes(target.accountId))
            .map(target => ({ accountId: target.accountId, platform: target.platform })),
          maxPublishItems: weeklyPackage.authorization.maxPublishItems,
          businessBoundary: {
            products: config.focusProducts,
            markets: config.targetMarkets,
            audience: config.customerProfile,
            languages: [...config.videoLanguages],
            platforms: [...goalInput(goal).contentPlatforms],
            productionBudget: Number(weeklyPackage.directorPlan?.productionBudget || 0),
            paidMediaBudget: Number(weeklyPackage.directorPlan?.paidMediaBudget || 0),
          },
        } } : {}),
    });
  }

  async function applyPackageGrant(tenantId: string, goal: GoalRecord, run: RunRecord, task: TaskRecord, tasks: TaskRecord[], plan: PlanRecord | null): Promise<boolean> {
    const body = plan ? jsonObject<Record<string, unknown>>(plan.plan, {}) : {};
    const pack = body.businessPackage as WeeklyPackage | undefined;
    const actor = String(body.packageApprovedBy || '');
    if (!pack || !actor || packageGrantWasInvalidatedAfterApproval(body) || pack.authorization.mode !== 'bounded' || beijingDate(new Date()) < goal.starts_at) return false;
    const recurringGrantId = String(body.managedPublishingGrantId || '');
    if (recurringGrantId) {
      const latest = await resolveCurrentConfiguration(tenantId, await configForTenant(tenantId));
      if (task.task_key !== 'content_release_approval' || !latest || !managedPublishingGrantCovers(pack, latest.config, recurringGrantId, goal.ends_at)) return false;
    }
    // Edited/re-approved subjects always return to a human; grants are not renewed implicitly.
    const previous = await store.list<ApprovalRecord>(COLLECTION.approvals, { where: { tenant_id: tenantId, task_id: task.id }, perPage: 100 });
    if (previous.items.some(a => a.status !== 'pending')) return false;
    const now = new Date().toISOString();
    let publishing: PublishingApprovalPackage | undefined;
    let batch: FollowupBatchRecord | null = null;
    if (task.task_key === 'content_release_approval') {
      publishing = await publishingApprovalPackage(tenantId, goal, run, task, tasks, now);
      const publishAccountIds = publishing.items.flatMap(i => i.accountIds);
      if (!publishing.allowRealPublishing || !grantCovers(pack, 'publish', publishAccountIds, publishAccountIds.length, beijingDate(new Date(now)), goal.ends_at)) return false;
      if (publishing.items.some(i => beijingDate(new Date(i.scheduledAt)) > goal.ends_at)) return false;
      const connected = await listConnectedPublishingAccounts(tenantId);
      if (publishing.items.some(i => i.accountIds.some(id => !connected.some(a => a.accountId === id && a.platform === i.platform)))) return false;
    } else if (task.task_key === 'followup_batch_approval') {
      batch = await first<FollowupBatchRecord>(COLLECTION.followupBatches, { tenant_id: tenantId, run_id: run.id }, '-version');
      if (!batch) return false;
      const items = await getFollowupBatchItems(tenantId, batch.id);
      if (!grantCovers(pack, 'send', items.map(i => i.customer_id), items.length, beijingDate(new Date(now)), goal.ends_at)) return false;
      if (items.some(i => i.risk_level !== 'low' || Boolean(i.exclusion_reason) || /价格|报价|付款|交期|MOQ|price|payment|delivery date/i.test(String(i.draft_body || '')))) return false;
    } else return false;
    const approval = await createApproval(tenantId, goal, run, task, tasks);
    let entries: Array<{ id: string; status: string }> = [];
    if (publishing) {
      // Use createApproval's exact schedule anchor/hash for immutable receipts.
      publishing = await publishingApprovalPackage(tenantId, goal, run, task, tasks, approval.created_at);
      if (publishing.contentHash !== approval.content_hash || publishing.items.some(i => beijingDate(new Date(i.scheduledAt)) > goal.ends_at)) return false;
      entries = await createPublishingCalendarEntries({ tenantId, runId: run.id, approvalTaskId: task.id, approvalId: approval.id, approvedContentHash: publishing.contentHash, package: publishing, managedPublishingGrantId: recurringGrantId || undefined });
    }
    if (batch) await applyFollowupBatchDecision({ tenantId, batchId: batch.id, decision: 'approved', userId: actor, approvalId: approval.id });
    const note = `依据本周经营包第 ${pack.revision} 版的范围授权`;
    await store.update(COLLECTION.approvals, approval.id, { status: 'approved', decided_by: actor, decision_note: note, decided_at: now });
    await store.update(COLLECTION.tasks, task.id, { status: 'succeeded', blocked_reason: '', output: { decision: 'approved', note, publishingEntries: entries }, updated_at: now });
    await appendAudit({ tenantId, userId: actor, action: 'weekly_package.grant_applied', targetType: 'approval_request', targetId: approval.id, metadata: { runId: run.id, revision: pack.revision, contentHash: approval.content_hash } });
    await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'approval.decided', level: 'success', summary: note });
    return true;
  }

  return { restoreExecutionOnlyInvalidatedAuthorization, dependenciesReady, approvalPreflight, createApproval, publishingApprovalPackage, applyPackageGrant };
}
