import type { DataStore } from '../storage/datastore.js';
import type { readAuthorizedWhatsAppCustomers as CustomerReader } from '../whatsapp/authorizedCustomerRead.js';
import { requiresContentHumanAcceptance } from './contentProductionAcceptancePolicy.js';
import { followupComplete, followupWait, postFullyPublished, publishingWait, waitState } from './executionDiagnostics.js';
import { type WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { type VideoCreationPlan } from '../../shared/contracts/videoCreationPlan.js';
import { contentAccepted } from './contentAcceptance.js';
import { type BusinessSnapshot } from './businessSnapshot.js';
import { managedReplicationFailureState } from './replicationContentProduction.js';
import { type recoverStaleFollowupSending, followupDispatchPreflightBlockedReason, type preflightFollowupBatchDispatch } from './followupDispatchWorker.js';
import { evaluateViralAnalysisCoverage, reusableExplicitReferenceIds } from './viralAnalysisCoverage.js';
import { canonicalScheduledCollectionRecords, evaluateScheduledDiscoveryRuns, type DiscoveryRunRecord } from './scheduledCollectionProof.js';
import { postHasPublishedReceipt } from './taskCorrectionSafety.js';
import { contentProjectTaskScope, recordBelongsToTask, scopedProof, scopedValues, studioProjectCompleted, studioProjectRendered, taskScope } from './taskEvidenceProjection.js';
import { type getFollowupBatchItems, type FollowupBatchRecord } from './customerWorkflow.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, type GoalRecord, type PlanRecord, type RunRecord, type StoredRecord, type TaskRecord } from '../routes/digitalEmployeeRecords.js';

export interface TaskBusinessObservationDependencies {
  store: DataStore;
  tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null>;
  getWhatsAppCustomers: typeof CustomerReader;
  getFollowupBatchItems: typeof getFollowupBatchItems;
  recoverStaleFollowupSending: typeof recoverStaleFollowupSending;
  preflightFollowupBatchDispatch: typeof preflightFollowupBatchDispatch;
}

/** Observe current tenant/run evidence through the existing domain authorities. */
export function createTaskBusinessObservation(deps: TaskBusinessObservationDependencies) {
  const { store, tenantRecord, getWhatsAppCustomers, getFollowupBatchItems,
    recoverStaleFollowupSending, preflightFollowupBatchDispatch } = deps;
  async function observeTaskProof(tenantId: string, run: RunRecord, task: TaskRecord, snapshot: BusinessSnapshot, tasks: TaskRecord[]) {
    const scope = taskScope(task, tasks);
    if (task.task_key === 'scheduled_source_collection') {
      const scheduled = await store.list<StoredRecord>('scheduled_tasks', {
        where: { tenant_id: tenantId }, perPage: 500,
      });
      const matching = canonicalScheduledCollectionRecords(scheduled.items.filter(item => {
        const config = jsonObject<Record<string, unknown>>(item.config, {});
        if (item.task_type !== 'social_discovery_collection') return false;
        let workflowRefs: Array<{ workflowTaskId?: string }> = [];
        try { workflowRefs = JSON.parse(String(config.workflowRefs || '[]')); } catch { /* older task */ }
        return Array.isArray(workflowRefs) && workflowRefs.some(ref => ref.workflowTaskId === task.id);
      }));
      const persistedRefs = [...new Map(jsonObject<Array<Record<string, unknown>>>(task.business_refs, [])
        .filter(ref => ref.type === 'scheduled_task')
        .map(ref => [String(ref.id || ref.recordId || ''), ref])).values()];
      const businessRefs = matching.length
        ? matching.map(item => ({ type: 'scheduled_task', id: String(item.task_id || item.id), recordId: item.id }))
        : persistedRefs.filter(ref => matching.length || !String(ref.id || '').startsWith('task_de_'));
      const scopeIds = matching.map(item => String(jsonObject<Record<string, unknown>>(item.config, {}).discoveryScopeId || '')).filter(Boolean);
      const discoveryRuns = await store.list<StoredRecord & DiscoveryRunRecord>('social_discovery_runs', {
        where: { tenant_id: tenantId }, perPage: 500,
      });
      const health = evaluateScheduledDiscoveryRuns(matching.length ? discoveryRuns.items : [], scopeIds);
      const ready = businessRefs.length > 0 && health.ready;
      return {
        ready,
        collectionState: health.state,
        proof: {
          metricKey: 'scheduledAutomations', value: businessRefs.length,
          usableContent: health.usable,
          discoveryRunId: health.latest?.id || '',
          status: ready ? 'available' : health.latest ? 'blocked' : 'pending',
          source: 'scheduled_tasks.config.workflowRefs + social_discovery_runs', scope: 'workflow_task',
        },
        businessRefs,
        blockedReason: businessRefs.length ? health.blockedReason : '待编导确认并创建平台采集任务。',
        waitState: ready ? undefined : waitState(health.state === 'failed' ? 'service' : 'processing', businessRefs.length ? health.blockedReason : '待编导确认并创建平台采集任务。'),
      };
    }
    if (task.task_key === 'viral_analysis') {
      const videos = await store.list<StoredRecord>('trend_videos', { where: { tenantId }, perPage: 500 });
      const boundPlan = await tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId);
      const packageBody = jsonObject<Record<string, any>>(boundPlan?.plan, {});
      const videoPlans: VideoCreationPlan[] = packageBody.businessPackage?.tasks?.find((item: any) => item.templateId === 'production')?.videoPlans || [];
      const explicitReferences = new Set(reusableExplicitReferenceIds(videoPlans));
      const candidates = videos.items.filter(item => {
        const runIds = scopedValues(item, ['workflowRunId', 'workflow_run_id', 'runId', 'run_id', 'digitalEmployeeRunId']);
        const taskIds = scopedValues(item, ['workflowTaskId', 'workflow_task_id', 'taskId', 'task_id', 'digitalEmployeeTaskId']);
        const currentRunEvidence = runIds.includes(run.id) && taskIds.some(id => scope.taskIds.has(id));
        return currentRunEvidence || scope.refIds.has(item.id) || explicitReferences.has(item.id);
      });
      const coverage = evaluateViralAnalysisCoverage(videoPlans, candidates, { explicitReferenceIds: explicitReferences });
      return {
        ready: coverage.ready,
        proof: {
          metricKey: 'exactAnalyses', value: coverage.completedCount,
          requiredValue: coverage.requiredCount,
          status: coverage.ready ? 'available' : 'pending',
          source: 'trend_videos.aiAnalysis + weekly clone master coverage + workflow scope',
          scope: 'workflow_run_and_task', tenantSnapshotValue: snapshot.content.exactAnalyses.value,
          invalidReferenceIds: coverage.invalidReferenceIds,
        },
        businessRefs: coverage.validRecords.map(item => ({ type: 'trend_video', id: item.id })),
        blockedReason: coverage.blockedReason,
        waitState: coverage.ready ? undefined : waitState('processing', coverage.blockedReason),
      };
    }
    if (task.task_key === 'content_production' || task.task_key === 'content_quality_gate') {
      const projects = await store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 });
      const projectScope = contentProjectTaskScope(task, tasks);
      const scoped = projects.items.filter(item => recordBelongsToTask(item, run, projectScope));
      const persistedGaps = jsonObject<Array<Record<string, unknown>>>(task.business_refs, []).filter(ref => ref.type === 'knowledge_gap');
      if (!scoped.length && persistedGaps.length) {
        return {
          ready: false,
          proof: { metricKey: 'contentKnowledgeGaps', value: persistedGaps.length, status: 'blocked', source: 'workflow_tasks.business_refs', scope: 'workflow_task' },
          businessRefs: persistedGaps,
          blockedReason: `内容生产资料待补齐：${persistedGaps.map(ref => String(ref.label || ref.key || '')).filter(Boolean).join('；')}`,
        };
      }
      const requiresAcceptance = task.task_key === 'content_quality_gate' && (await tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, tenantId))?.metric === 'approved_content_packages';
      const matching = task.task_key === 'content_quality_gate' ? scoped.filter(item => studioProjectCompleted(item) && (!requiresContentHumanAcceptance({ requiresAcceptance, spec: jsonObject(item.spec, {}) }) || contentAccepted(jsonObject(item.spec, {})))) : scoped.filter(studioProjectRendered);
      const result = scopedProof(
        task.task_key === 'content_quality_gate' ? 'completedWorks' : 'contentProjects',
        task.task_key === 'content_quality_gate' ? 'studio_projects.spec.automation.quality + workflow scope' : 'studio_projects.spec.automation.renderOutputPath + workflow scope',
        matching,
        scoped.map(item => ({
          type: 'studio_project', id: item.id, status: String(item.status || ''),
          stage: String(jsonObject<Record<string, unknown>>(jsonObject<Record<string, unknown>>(item.spec, {}).automation, {}).stage || ''),
        })),
        task.task_key === 'content_quality_gate' ? snapshot.content.completedWorks.value : snapshot.content.contentProjects.value,
      );
      const plan = await tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId);
      const pack = plan ? jsonObject<{ businessPackage?: WeeklyPackage }>(plan.plan, {}).businessPackage : undefined;
      const expectedCount = pack?.tasks.find(t => t.templateId === 'production')?.videoPlans?.length || 1;
      result.ready = scoped.length >= expectedCount && matching.length === scoped.length;
      result.proof = { ...result.proof, value: matching.length, status: result.ready ? 'available' : 'pending' };
      const projectAutomationStates = scoped.map(item =>
        jsonObject<Record<string, unknown>>(jsonObject<Record<string, unknown>>(item.spec, {}).automation, {}));
      const retryPolicy = (automation: Record<string, unknown>) => {
        if (automation.retryPolicy === 'input_required') return 'input_required';
        if (automation.route === 'clone' && String(automation.blocker || '').trim()) {
          return managedReplicationFailureState(String(automation.blocker)).retryPolicy;
        }
        return 'service_retry';
      };
      const activeProjects = projectAutomationStates.filter(automation => {
        return !['blocked', 'completed', 'superseded'].includes(String(automation.stage || ''))
          || (automation.stage === 'blocked' && retryPolicy(automation) !== 'input_required');
      });
      // One content item's missing input must not pause siblings that can still
      // advance. Escalate to waiting_human only after no runnable item remains.
      const blocker = activeProjects.length ? '' : projectAutomationStates
        .filter(automation => automation.stage === 'blocked' && retryPolicy(automation) === 'input_required')
        .map(automation => String(automation.blocker || '').trim())
        .find(Boolean) || '';
      const serviceReason = projectAutomationStates
        .filter(automation => automation.stage === 'blocked' && retryPolicy(automation) !== 'input_required')
        .map(automation => String(automation.blocker || '').trim())
        .find(Boolean) || '';
      return {
        ...result,
        ...(serviceReason && !blocker ? { waitState: waitState('processing', `系统正在自动恢复未完成的服务步骤：${serviceReason}`) } : {}),
        blockedReason: blocker || (requiresAcceptance && !result.ready && !activeProjects.length ? '内容成片尚未完成所需质量检查' : ''),
      };
    }
    if (task.task_key === 'publishing_calendar') {
      const posts = await store.list<StoredRecord>('posts', { where: { tenant_id: tenantId }, perPage: 500 });
      const matching = posts.items.filter(item => recordBelongsToTask(item, run, scope) && (() => {
        const status = String(jsonObject<Record<string, unknown>>(item.stats, {}).status || '');
        return ['awaiting_manual_publish', 'scheduled', 'publishing', 'published', 'partial'].includes(status) || postHasPublishedReceipt(item);
      })());
      return scopedProof('scheduledOrPublishedPosts', 'posts.stats.status + workflow scope', matching, matching.map(item => ({ type: 'post', id: item.id })), Number(snapshot.content.scheduledPosts.value || 0) + Number(snapshot.content.publishedPosts.value || 0));
    }
    if (task.task_key === 'platform_publish') {
      const posts = await store.list<StoredRecord>('posts', { where: { tenant_id: tenantId }, perPage: 500 });
      const scoped = posts.items.filter(item => recordBelongsToTask(item, run, scope));
      const matching = scoped.filter(postFullyPublished);
      const result = scopedProof('publishedPosts', 'posts.platform_post_id + publishResults + workflow scope', matching, matching.map(item => ({ type: 'post', id: item.id, receipt: true })), snapshot.content.publishedPosts.value);
      return { ...result, ready: scoped.length > 0 && matching.length === scoped.length,
        waitState: publishingWait(scoped, process.env.PUBLISH_SCHEDULER_ENABLED === 'true') };
    }
    if (task.task_key === 'customer_attribution') {
      const posts = await store.list<StoredRecord>('posts', { where: { tenant_id: tenantId }, perPage: 500 });
      const scopedPosts = posts.items.filter(item => recordBelongsToTask(item, run, scope));
      const postIds = new Set(scopedPosts.map(item => item.id));
      const trackCodes = new Set(scopedPosts.map(item => String(item.track_code || item.trackCode || '')).filter(Boolean));
      const customers = await getWhatsAppCustomers(tenantId) as Array<Record<string, unknown>>;
      const matching = customers.filter(customer => postIds.has(String(customer.sourcePostId || '')) || trackCodes.has(String(customer.sourceTrackCode || '')));
      return scopedProof('attributedCustomers', 'whatsapp_customers.sourcePostId + run-scoped posts', matching.map(customer => ({ id: String(customer.id || '') })), matching.map(customer => ({ type: 'customer', id: String(customer.id || ''), sourcePostId: String(customer.sourcePostId || '') })), snapshot.customer.attributed.value);
    }
    if (task.task_key === 'customer_segmentation') {
      const segments = await store.list<StoredRecord>(COLLECTION.segments, {
        where: { tenant_id: tenantId, run_id: run.id, task_id: task.id }, sort: '-version', perPage: 100,
      });
      const matching = segments.items.filter(item => ['generated', 'active', 'ready'].includes(String(item.status || '')));
      return {
        ready: snapshot.customer.segmentSnapshots.status === 'available' && matching.length > 0,
        proof: { metricKey: 'segmentSnapshots', value: matching.length, status: snapshot.customer.segmentSnapshots.status, source: 'customer_segments' },
        businessRefs: matching.map(item => ({ type: 'customer_segment', id: item.id, version: Number(item.version || 1), memberCount: Number(item.member_count || 0) })),
      };
    }
    if (task.task_key === 'followup_batch_draft') {
      const batches = await store.list<FollowupBatchRecord>(COLLECTION.followupBatches, {
        where: { tenant_id: tenantId, run_id: run.id, task_id: task.id }, sort: '-version', perPage: 100,
      });
      let draftCount = 0;
      const refs: Array<Record<string, unknown>> = [];
      for (const batch of batches.items.filter(item => !['superseded', 'cancelled'].includes(item.status))) {
        const items = await getFollowupBatchItems(tenantId, batch.id);
        draftCount += items.filter(item => ['draft', 'approved', 'blocked', 'retry_wait'].includes(item.status)).length;
        refs.push({ type: 'followup_batch', id: batch.id, version: batch.version, contentHash: batch.content_hash, itemCount: items.length });
      }
      return {
        ready: snapshot.customer.followupDrafts.status === 'available' && draftCount > 0,
        proof: { metricKey: 'followupDrafts', value: draftCount, status: snapshot.customer.followupDrafts.status, source: 'followup_batch_items.status' },
        businessRefs: refs,
      };
    }
    if (task.task_key === 'followup_dispatch') {
      const batches = await store.list<FollowupBatchRecord>(COLLECTION.followupBatches, {
        where: { tenant_id: tenantId, run_id: run.id }, perPage: 500,
      });
      const currentBatch = [...batches.items]
        .filter(batch => !['superseded', 'cancelled'].includes(batch.status))
        .sort((left, right) => Number(right.version || 0) - Number(left.version || 0))[0];
      if (currentBatch) await recoverStaleFollowupSending(currentBatch);
      const currentItems = currentBatch ? await getFollowupBatchItems(tenantId, currentBatch.id) : [];
      let sent = 0;
      const refs: Array<Record<string, unknown>> = [];
      for (const batch of currentBatch ? [currentBatch] : []) {
        const items = currentItems;
        const delivered = items.filter(item => ['sent', 'delivered', 'read', 'partial_sent'].includes(item.status) && Boolean(item.provider_message_id));
        sent += delivered.length;
        refs.push(...delivered.map(item => ({ type: 'followup_receipt', batchId: batch.id, itemId: item.id, providerMessageId: item.provider_message_id })));
      }
      const dispatchPreflight = currentBatch
        ? await preflightFollowupBatchDispatch(tenantId, currentBatch.id, { mode: 'scheduled' })
        : null;
      return {
        ready: followupComplete(currentItems),
        proof: { metricKey: 'outreachSent', value: sent, status: snapshot.customer.outreachSent.status, source: 'followup_batch_items.provider_receipt' },
        businessRefs: refs,
        dispatchPreflight,
        followupWaitState: followupWait(currentItems),
        blockedReason: dispatchPreflight
          ? followupDispatchPreflightBlockedReason(dispatchPreflight)
          : '真实发送预检：尚未生成跟进批次',
      };
    }
    return { ready: false, proof: { metricKey: task.task_key, value: 0, status: 'pending', source: 'unmapped_observe_task' }, businessRefs: [] as Array<Record<string, unknown>> };
  }
  return { observeTaskProof };
}
