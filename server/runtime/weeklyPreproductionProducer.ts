import {weeklyScopeMatches,type WeeklyScanScope} from './weeklyScanScope.js';
import {createHash} from 'node:crypto';
import {deterministicFingerprint} from '../socialOperating/businessGoalBuilder.js';
import { evaluateProductionOutlineReadiness, type ProductionOutlineReadiness } from '../socialOperating/productionReadiness.js';
import { readIndependentAdmission } from '../socialPrograms/weeklyIndependentAdmission.js';
import { readWeeklyAutomaticPreproductionAdmission } from '../socialPrograms/weeklyAutomaticSchedule.js';
import { discoveryRunFailureCode } from '../socialDiscovery/sourceFailure.js';
import {ensureWeeklyPreproductionRetryAttempt,readWeeklyPreproductionRetryAttempt,PREPRODUCTION_RETRY_ATTEMPTS,type WeeklyPreproductionRetryAttempt} from './weeklyPreproductionRetryAttempts.js';
import {reassessWeeklyCandidates,readWeeklyCandidateReassessment,type CandidateReassessmentPorts} from './weeklyCandidateReassessment.js';
import type { DataStore, Record_ } from '../storage/datastore.js';
import type { WeeklyExecutionTask, WeeklyOperatingPackage, VersionedSocialRef } from '../../shared/contracts/socialProgram.js';
import type { SocialDiscoveryMode } from '../../shared/contracts/socialContentWorkflow.js';
import { socialJson, socialObject, socialRequestHash } from '../starter198/socialContentValidation.js';
import { organizationRoleOrNull,localTenantMember } from '../lib/organizationRole.js';
import { supplementConsumerHash } from '../socialPrograms/weeklySupplementRequests.js';
import { withExecutionPackageGate, executionPackageFrozen } from '../socialPrograms/weeklyExecutionGate.js';
import { createWeeklyExecutionTaskService } from '../socialPrograms/executionTasks.js';
import { createWeeklyPlanningAuthority } from '../socialPrograms/planningAuthority.js';
import { createSocialOperatingOrchestrationService } from '../socialOperating/orchestration.js';
import { verifyEnterpriseFactContent, type EnterpriseProfile } from '../routes/enterprise.js';
import { executeApprovedDiscoveryRun, type ApprovedDiscoveryRunDependencies, type DiscoveryScopeRecord } from '../socialDiscovery/service.js';
export const WEEKLY_PREPRODUCTION_JOBS = 'social_weekly_preproduction_jobs';
const parse = <T>(v: unknown) => socialObject(socialJson(v)) as unknown as T;
export type PreproductionStatus = 'bound' | 'blocked' | 'running' | 'succeeded' | 'no_data' | 'unknown';
export interface WeeklyPreproductionJob {
    jobId: string;
    tenantId: string;
    programId: string;
    packageId: string;
    packageVersion: number;
    consumerTaskId: string;
    consumerInputHash: string;
    kind: 'outline' | 'discovery';
    status: PreproductionStatus;
    originalRunKey: string;
    actorUserId: string;
    dueAt: string;
    boundAt: string;
    updatedAt: string;
    sourceHash: string;
    authority?: {
        scopeId: string;
        scopeVersion: number;
        scopeHash: string;
        requestedModes: SocialDiscoveryMode[];
    };
    code: string | null;
    resultRefs: VersionedSocialRef[];
    planningEvidenceHash?: string;
    collectionEvidenceHash?: string;
    /** Scoped outline proof; explicitly grants no production/outbound permission. */
    outlineReadiness?: ProductionOutlineReadiness;
    recordHash: string;
}
const seal = (j: WeeklyPreproductionJob) => ({ ...j, recordHash: socialRequestHash({ ...j, recordHash: '' }) });
async function all(store: DataStore, c: string, where: Record<string, string | number>) { const rows: Record_[] = []; let total: number | undefined; for (let page = 1; page <= 10000; page++) {
    const r = await store.list<Record_>(c, { where, page, perPage: 500, sort: 'id' });
    if (!Number.isSafeInteger(r.totalItems) || r.totalItems < 0 || total !== undefined && total !== r.totalItems || new Set(r.items.map(x => x.id)).size !== r.items.length || r.items.some(x => !x.id || rows.some(y => y.id === x.id) || Object.entries(where).some(([k, v]) => x[k] !== v)))
        throw Error('weekly_preproduction_scan_invalid');
    total = r.totalItems;
    rows.push(...r.items);
    if (rows.length === total)
        return rows;
    if (!r.items.length || rows.length > total)
        throw Error('weekly_preproduction_scan_incomplete');
} throw Error('weekly_preproduction_scan_limit'); }
async function unique(store: DataStore, c: string, where: Record<string, string | number>) { const r = await all(store, c, where); if (r.length !== 1)
    throw Error('weekly_preproduction_source_not_unique'); return r[0]!; }
async function member(store: DataStore, tenant: string, user: string) { const local=localTenantMember(tenant,user);const actor = local===undefined?await store.getById<Record_>('users', user):local as Record_ | null; if (!actor || actor.tenantId !== tenant || !organizationRoleOrNull(actor.role) || actor.disabled === true || actor.active === false || ['disabled', 'suspended'].includes(String(actor.status)))
    throw Error('weekly_preproduction_member_required'); }
async function scope(store: DataStore, a: {
    tenantId: string;
    programId: string;
    packageId: string;
    packageVersion: number;
    consumerTaskId: string;
}) { const tr = await unique(store, 'social_weekly_execution_tasks', { tenant_id: a.tenantId, program_id: a.programId, task_id: a.consumerTaskId }), task = parse<WeeklyExecutionTask>(tr.payload), pr = await unique(store, 'social_weekly_operating_packages', { tenant_id: a.tenantId, program_id: a.programId, package_id: a.packageId, version: a.packageVersion }), pkg = parse<WeeklyOperatingPackage>(pr.payload); if (!task || task.taskId !== a.consumerTaskId || task.tenantId !== a.tenantId || task.programId !== a.programId || task.packageId !== a.packageId || task.packageVersion !== a.packageVersion || !pkg || pkg.programId !== a.programId || pkg.packageId !== a.packageId || pkg.version !== a.packageVersion || !['draft', 'active'].includes(pkg.status))
    throw Error('weekly_preproduction_scope_changed'); return { task, pkg }; }
async function facts(store: DataStore, tenant: string) { const r = await unique(store, 'tenant_profiles', { tenant_id: tenant }), p = parse<EnterpriseProfile>(r.profile), v = p?.factVersion; if (!p || !v || !v.id || !Number.isSafeInteger(v.revision) || v.revision < 1 || !verifyEnterpriseFactContent(p).verified || !Number.isFinite(Date.parse(v.confirmedAt)) || Date.parse(v.confirmedAt) > Date.now())
    throw Error('weekly_preproduction_confirmed_facts_required'); await member(store, tenant, v.confirmedBy); return socialRequestHash({ id: v.id, revision: v.revision, contentHash: v.contentHash, confirmedBy: v.confirmedBy }); }
function checked(row: Record_) { const j = parse<WeeklyPreproductionJob>(row.payload); if (!j || !['outline','discovery'].includes(j.kind)||!['bound','blocked','running','succeeded','no_data','unknown'].includes(j.status)||!Number.isSafeInteger(j.packageVersion)||j.packageVersion<1||!Number.isFinite(Date.parse(j.dueAt))||!j.originalRunKey||!j.actorUserId||j.recordHash !== seal(j).recordHash || row.id !== j.jobId || row.tenant_id !== j.tenantId || row.program_id !== j.programId || row.package_id !== j.packageId || row.package_version !== j.packageVersion || row.task_id !== j.consumerTaskId || row.input_hash !== j.consumerInputHash || row.kind !== j.kind || row.original_run_key !== j.originalRunKey || row.status !== j.status || row.record_hash !== j.recordHash)
    throw Error('weekly_preproduction_job_corrupt'); return j; }
export async function bindWeeklyPreproductionAuthority(input: {
    store: DataStore;
    tenantId: string;
    programId: string;
    packageId: string;
    packageVersion: number;
    taskId: string;
    actorUserId: string;
    kind: 'outline' | 'discovery';
    expectedConsumerInputHash: string;
    discovery?: {
        scopeId: string;
        scopeVersion: number;
        requestedModes: SocialDiscoveryMode[];
    };
    now?: Date;
}) {
    const a = { ...input, consumerTaskId: input.taskId };
    await member(input.store, input.tenantId, input.actorUserId);
    return withExecutionPackageGate(input.store, a, async (assert) => {
        const { task } = await scope(input.store, a);
        if (task.lease || ['succeeded', 'cancelled', 'dead_letter'].includes(task.status) || task.schedule.stepKind !== (input.kind === 'outline' ? 'business_outline' : 'benchmark_collection') || supplementConsumerHash(task) !== input.expectedConsumerInputHash || await executionPackageFrozen(input.store, a))
            throw Error('weekly_preproduction_consumer_changed');
        let authority: WeeklyPreproductionJob['authority'];
        let sourceHash = '';
        let code: string | null = null;
        if (input.kind === 'outline') {
            try {
                sourceHash = await facts(input.store, input.tenantId);
            }
            catch {
                code = 'weekly_preproduction_confirmed_facts_required';
            }
        }
        else {
            const d = input.discovery;
            if (!d || !d.requestedModes.length || new Set(d.requestedModes).size !== d.requestedModes.length)
                throw Error('weekly_preproduction_discovery_authority_required');
            const scopeRow = await input.store.getById<DiscoveryScopeRecord>('social_discovery_scopes', d.scopeId);
            if (!scopeRow || scopeRow.tenant_id !== input.tenantId || scopeRow.status !== 'active' || scopeRow.version !== d.scopeVersion || scopeRow.payload.approval?.status !== 'approved' || scopeRow.payload.approval.scopeVersion !== d.scopeVersion || d.requestedModes.some(m => !scopeRow.payload.discoveryBrief.discoveryModes.includes(m) || !scopeRow.payload.discoveryBrief.modePolicies?.[m]?.enabled))
                throw Error('weekly_preproduction_scope_not_approved');
            const approval=scopeRow.payload.approval;
            // Old UI scopes stored a role enum in approvedBy and the actual
            // authenticated saver in created_by. Neither is an invented user.
            const approvalActor=approval.approvedByUserId ?? (approval.approvedBy==='user'?scopeRow.created_by:approval.approvedBy);
            if(typeof approvalActor!=='string'||!approvalActor||['user','business_agent'].includes(approvalActor))throw Error('weekly_preproduction_scope_not_approved');
            if(approval.approvedBy==='user'&&scopeRow.created_by&&approvalActor!==scopeRow.created_by)throw Error('weekly_preproduction_scope_approver_mismatch');
            await member(input.store,input.tenantId,approvalActor);
            authority = { scopeId: d.scopeId, scopeVersion: d.scopeVersion, scopeHash: socialRequestHash(scopeRow.payload), requestedModes: [...d.requestedModes] };
            sourceHash = authority.scopeHash;
        }
        const jobId = socialRequestHash({ tenantId: input.tenantId, taskId: task.taskId, inputHash: input.expectedConsumerInputHash, kind: input.kind }).slice(0, 15), now = (input.now ?? new Date()).toISOString(), job: WeeklyPreproductionJob = { jobId, tenantId: input.tenantId, programId: input.programId, packageId: input.packageId, packageVersion: input.packageVersion, consumerTaskId: task.taskId, consumerInputHash: input.expectedConsumerInputHash, kind: input.kind, status: code ? 'blocked' : 'bound', originalRunKey: `weekly-preproduction:${jobId}`, actorUserId: input.actorUserId, dueAt: task.schedule.latestStartAt || task.schedule.estimatedStartAt, boundAt: now, updatedAt: now, sourceHash, authority, code, resultRefs: [], recordHash: '' };
        if (!Number.isFinite(Date.parse(job.dueAt)))
            throw Error('weekly_preproduction_deadline_missing');
        const prior = await input.store.getById<Record_>(WEEKLY_PREPRODUCTION_JOBS, jobId);
        if (prior) {
            const existing = checked(prior);
            if (existing.kind === 'outline' && existing.status === 'blocked' && !existing.sourceHash && job.sourceHash && existing.actorUserId === job.actorUserId && existing.dueAt === job.dueAt) {
                await assert();
                const rebound = seal({ ...existing, sourceHash: job.sourceHash, status: 'bound', code: null, updatedAt: now });
                if (!await input.store.update(WEEKLY_PREPRODUCTION_JOBS, jobId, { status: rebound.status, record_hash: rebound.recordHash, payload: rebound }))
                    throw Error('weekly_preproduction_binding_write_failed');
                return rebound;
            }
            if (existing.actorUserId !== job.actorUserId || socialRequestHash(existing.authority ?? null) !== socialRequestHash(job.authority ?? null) || existing.sourceHash !== job.sourceHash || existing.dueAt !== job.dueAt)
                throw Error('weekly_preproduction_binding_conflict');
            return existing;
        }
        await assert();
        if (!await input.store.create(WEEKLY_PREPRODUCTION_JOBS, { id: jobId, tenant_id: job.tenantId, program_id: job.programId, package_id: job.packageId, package_version: job.packageVersion, task_id: job.consumerTaskId, input_hash: job.consumerInputHash, kind: job.kind, status: job.status, original_run_key: job.originalRunKey, record_hash: seal(job).recordHash, payload: seal(job) }))
            throw Error('weekly_preproduction_binding_write_failed');
        return seal(job);
    });
}
export async function listWeeklyPreproductionJobs(input: {
    store: DataStore;
    tenantId: string;
    programId: string;
    packageId: string;
    packageVersion: number;
}) { const parent=await unique(input.store, 'social_weekly_operating_packages', { tenant_id: input.tenantId, program_id: input.programId, package_id: input.packageId, version: input.packageVersion });const pkg=parse<WeeklyOperatingPackage>(parent.payload);if(!pkg||pkg.programId!==input.programId||pkg.packageId!==input.packageId||pkg.version!==input.packageVersion||!['active','draft'].includes(pkg.status))throw Error('weekly_preproduction_scope_changed'); const rows = await all(input.store, WEEKLY_PREPRODUCTION_JOBS, { tenant_id: input.tenantId, program_id: input.programId, package_id: input.packageId, package_version: input.packageVersion }); const result: Array<WeeklyPreproductionJob & {activeForConsumer:boolean}> = []; for (const row of rows) {
    const job = checked(row);
    const { task } = await scope(input.store, job);
    if (job.consumerInputHash !== supplementConsumerHash(task) || job.dueAt !== (task.schedule.latestStartAt || task.schedule.estimatedStartAt))
        throw Error('weekly_preproduction_consumer_changed');
    const retry=job.kind==='discovery'?await readWeeklyPreproductionRetryAttempt(input.store,job):null;
    result.push({...job,activeForConsumer:!retry});
    if(retry)result.push({...retry,activeForConsumer:true});
} return result; }
export async function runWeeklyPreproductionProducerScan(input: {
    store: DataStore;
    now?: Date;
    discoveryDependencies?: ApprovedDiscoveryRunDependencies;
    candidatePorts?:CandidateReassessmentPorts;
    scope?:WeeklyScanScope;
}) {
    if (input.discoveryDependencies && input.discoveryDependencies.dataStore !== input.store)
        throw Error('weekly_preproduction_store_mismatch');
    const report = { succeeded: 0, blocked: 0, noData: 0, unknown: 0, failed: 0, failures: [] as Array<{
            jobId: string;
            code: string;
        }> };
    for (const row of await all(input.store, WEEKLY_PREPRODUCTION_JOBS, {})) {
        let job: WeeklyPreproductionJob;
        try {
            job = checked(row);
            if(!weeklyScopeMatches(input.scope,job))continue;
            if (job.status === 'succeeded') {
                await withExecutionPackageGate(input.store, job, async (assert) => { await recoverConsumer(input.store, job, assert); });
                continue;
            }
            await withExecutionPackageGate(input.store, job, async (assert) => {
                let receiptCollection=WEEKLY_PREPRODUCTION_JOBS;
                if(job.kind==='discovery'){
                    const retry=await ensureWeeklyPreproductionRetryAttempt(input.store,job,(input.now??new Date()).toISOString());
                    if(retry){job=retry;receiptCollection=PREPRODUCTION_RETRY_ATTEMPTS;}
                }
                if(job.status==='succeeded'){await recoverConsumer(input.store,job,assert);return;}
                const { task, pkg } = await scope(input.store, job);
                if (task.lease || ['succeeded', 'cancelled', 'dead_letter'].includes(task.status) || supplementConsumerHash(task) !== job.consumerInputHash || job.dueAt !== (task.schedule.latestStartAt || task.schedule.estimatedStartAt) || await executionPackageFrozen(input.store, job))
                    throw Error('weekly_preproduction_consumer_changed');
                await member(input.store, job.tenantId, job.actorUserId);
                const save = async (status: PreproductionStatus, code: string | null, refs: VersionedSocialRef[] = []) => { await assert(); job = seal({ ...job, status, code, resultRefs: refs, updatedAt: (input.now ?? new Date()).toISOString() }); if (!await input.store.update(receiptCollection, job.jobId, { status, record_hash: job.recordHash, payload: job }))
                    throw Error('weekly_preproduction_receipt_write_failed'); if (status === 'succeeded')
                    await recoverConsumer(input.store, job, assert); };
                if (job.kind === 'outline') {
                    let source: string;
                    try {
                        source = await facts(input.store, job.tenantId);
                    }
                    catch {
                        await save('blocked', 'weekly_preproduction_confirmed_facts_required');
                        report.blocked++;
                        return;
                    }
                    if (!job.sourceHash || source !== job.sourceHash) {
                        await save('blocked', 'weekly_preproduction_facts_changed');
                        report.blocked++;
                        return;
                    }
                    let snapshot;
                    if (pkg.operatingDecisionSnapshotRef) {
                        snapshot = await createSocialOperatingOrchestrationService(input.store).getSnapshot(job.tenantId, job.programId, pkg.operatingDecisionSnapshotRef.id, pkg.operatingDecisionSnapshotRef.version);
                        if (snapshot.programId !== job.programId || snapshot.planningWeekStart !== pkg.weekStart || snapshot.businessContentGoalRef.id !== pkg.businessContentGoalRef?.id || snapshot.businessContentGoalRef.version !== pkg.businessContentGoalRef?.version)
                            throw Error('weekly_preproduction_frozen_snapshot_changed');
                    }
                    else {
                        const recoveryOnly = ['running', 'unknown'].includes(job.status);
                        await save('running', null);
                        snapshot = (await createSocialOperatingOrchestrationService(input.store).resolve(job.tenantId, job.actorUserId, job.programId, { weekStart: pkg.weekStart, desiredOriginalContents: pkg.socialContentPackage.originalContentTarget, desiredAdaptations: pkg.socialContentPackage.adaptationVersionTarget }, { key: job.originalRunKey, recoveryOnly }).catch(async (error) => { await save('unknown', 'weekly_preproduction_original_write_unknown'); throw error; })).snapshot;
                    }
                    try{job = { ...job, outlineReadiness: await assertOutlineProof(input.store,job,snapshot) };}catch(error){await save('blocked',error instanceof Error?error.message:'weekly_preproduction_outline_source_mismatch');report.blocked++;return;}
                    const planning = await createWeeklyPlanningAuthority(input.store).initialize(job.tenantId, pkg);
                    await save('succeeded', null, [{ type: 'operating_authority_snapshot', id: snapshot.snapshotId, version: snapshot.version }, snapshot.businessContentGoalRef, { type: 'weekly_agent_planning', id: planning.planningId, version: planning.version }]);
                    report.succeeded++;
                }
                else {
                    const recoveryOnly = ['running','unknown'].includes(job.status);
                    if (!recoveryOnly) {
                        const parents=await all(input.store,'social_weekly_execution_tasks',{tenant_id:job.tenantId,program_id:job.programId,package_id:job.packageId,package_version:job.packageVersion});
                        if(task.dependsOnTaskIds.some(id=>parents.filter(r=>r.task_id===id&&(parse<WeeklyExecutionTask>(r.payload)).status==='succeeded').length!==1)){
                            await save('blocked','weekly_preproduction_upstream_delivery_required');report.blocked++;return;
                        }
                        const now=(input.now??new Date()).toISOString();
                        const independent=await readIndependentAdmission(input.store,task);
                        const automatic=independent?await readWeeklyAutomaticPreproductionAdmission(input.store,task,now):null;
                        if((independent&&!automatic?.eligible)||!Number.isFinite(Date.parse(task.schedule.estimatedStartAt))||Date.parse(now)<Date.parse(task.schedule.estimatedStartAt)){
                            await save('blocked','weekly_preproduction_execution_window_required');report.blocked++;return;
                        }
                    }
                    const a = job.authority;
                    if (!a)
                        throw Error('weekly_preproduction_discovery_authority_required');
                    const bound = await input.store.getById<DiscoveryScopeRecord>('social_discovery_scopes', a.scopeId);
                    if (!bound || bound.tenant_id !== job.tenantId || bound.version !== a.scopeVersion || bound.status !== 'active' || socialRequestHash(bound.payload) !== a.scopeHash || bound.payload.approval?.status !== 'approved' || bound.payload.approval.scopeVersion !== a.scopeVersion) {
                        await save('blocked', 'weekly_preproduction_scope_changed');
                        report.blocked++;
                        return;
                    }
                    if (!recoveryOnly && !process.env.APIFY_TOKEN?.trim()) {
                        await save('blocked', 'weekly_preproduction_collection_credentials_required');
                        report.blocked++;
                        return;
                    }
                    await save('running', null);
                    const retry=(job as WeeklyPreproductionRetryAttempt).retry;
                    const result = await executeApprovedDiscoveryRun({ tenantId: job.tenantId, triggerType: 'manual', expectedScopeId: a.scopeId, expectedScopeVersion: a.scopeVersion, requestedModes: a.requestedModes, originalRun: { key: job.originalRunKey, scopeHash: a.scopeHash, recoveryOnly },...(retry?{retry:{parentRunId:retry.parentRunId,parentRunHash:retry.parentRunHash,sourceSelection:retry.sourceSelection,grant:retry.grant}}:{}) }, input.discoveryDependencies);
                    const run = result.run;
                    if (!run) {
                        await save(recoveryOnly?'unknown':'blocked', result.reason ?? 'weekly_preproduction_collection_unavailable');
                        if(recoveryOnly)report.unknown++;else report.blocked++;
                        return;
                    }
                    if (run.status === 'running') {
                        await save('unknown', 'weekly_preproduction_original_run_pending');
                        report.unknown++;
                        return;
                    }
                    let reassessment:Awaited<ReturnType<typeof reassessWeeklyCandidates>>['item']=null;
                    if(retry&&Object.values(run.evidenceOutcomes??{}).some(o=>o?.suggestionCandidateIds.length)&&!Object.values(run.modeStats).some(s=>(s?.accepted??0)>0)){
                        const read=await reassessWeeklyCandidates(input.store,job as WeeklyPreproductionRetryAttempt,run,input.candidatePorts);
                        if(!read.ready||!read.item){await save('unknown',read.code??'weekly_candidate_analysis_pending',[{type:'social_discovery_run',id:run.runId,version:1}]);report.unknown++;return;}
                        reassessment=read.item;
                    }
                    const reassessmentRef=reassessment?{type:'social_discovery_candidate_reassessment',id:reassessment.id,version:1}:null;
                    const effectiveOutcomes=reassessment?.evidenceOutcomes??run.evidenceOutcomes;
                    if (reassessment||(['succeeded','partial'].includes(run.status) && Object.values(run.modeStats).some(s => (s?.accepted ?? 0) > 0))) {
                        const planner = createWeeklyPlanningAuthority(input.store);
                        let planning = await planner.initialize(job.tenantId, pkg);
                        if (['confirmed', 'dispatched'].includes(planning.status)) {
                            await save('blocked', 'weekly_preproduction_plan_requires_replan');
                            report.blocked++;
                            return;
                        }
                        try {
                            if (planning.status !== 'awaiting_confirmation') {
                                planning = await planner.runDirectorAnalysis({ tenantId: job.tenantId, programId: job.programId, packageId: job.packageId, packageVersion: job.packageVersion, expectedPlanningVersion: planning.version, actor: 'director_agent', now: input.now });
                                planning = await planner.mergeDetailedSchedule({ tenantId: job.tenantId, programId: job.programId, package: pkg, expectedPlanningVersion: planning.version, actor: 'business_agent', now: input.now });
                            }
                            await assertPlanningCollection(input.store,job,planning,{evidenceOutcomes:effectiveOutcomes});
                        if (!planning.detailedSchedule || planning.status !== 'awaiting_confirmation')
                                throw Error('weekly_preproduction_director_schedule_incomplete');
                            job = { ...job, planningEvidenceHash: socialRequestHash({ directorAnalyses: planning.directorAnalyses, detailedSchedule: planning.detailedSchedule }), collectionEvidenceHash: socialRequestHash({ modeStats: run.modeStats, evidenceOutcomes: run.evidenceOutcomes, scopeSnapshot: run.scopeSnapshot,...(reassessmentRef?{reassessmentRef}:{}) }) };
                            await save('succeeded', null, [{ type: 'social_discovery_run', id: run.runId, version: 1 },...(reassessmentRef?[reassessmentRef]:[]), { type: 'weekly_agent_planning', id: planning.planningId, version: planning.version }]);
                            report.succeeded++;
                        }
                        catch (error) {
                            await save('blocked', error instanceof Error ? error.message : 'weekly_preproduction_director_schedule_incomplete', [{ type: 'social_discovery_run', id: run.runId, version: 1 }]);
                            report.blocked++;
                        }
                    }
                    else {
                        const completeEmpty = run.status === 'stopped' && socialObject(socialObject(run.scopeSnapshot)?.weeklyProducer)?.completeEmptyVerified === true && Object.values(run.modeStats).every(s => s?.fetched === 0 && s.failed === 0 && s.requested > 0);
                        await save(completeEmpty ? 'no_data' : 'blocked', completeEmpty ? 'weekly_preproduction_no_data' : run.stopReason === 'source_failed' ? discoveryRunFailureCode(run) : run.stopReason ?? 'weekly_preproduction_collection_incomplete');
                        if (completeEmpty)
                            report.noData++;
                        else
                            report.blocked++;
                    }
                }
            });
        }
        catch (error) {
            report.failed++;
            report.failures.push({ jobId: row.id, code: error instanceof Error ? error.message : 'weekly_preproduction_failed' });
        }
    }
    return report;
}
/** Read-only exact original-consumer gate; never authorizes planning dispatch. */
export async function readWeeklyPreproductionExecutionGate(store: DataStore, task: WeeklyExecutionTask): Promise<{
    ready: boolean;
    code: string | null;
    resultRefs: VersionedSocialRef[];
    jobId?:string;
    originalRunKey?:string;
    retryParentRunId?:string;
    producerStatus?:PreproductionStatus;
}> {
    const kind = task.schedule.stepKind === 'business_outline' ? 'outline' : task.schedule.stepKind === 'benchmark_collection' ? 'discovery' : null;
    if (!kind)
        return { ready: true, code: null, resultRefs: [] };
    const records = await all(store, WEEKLY_PREPRODUCTION_JOBS, { tenant_id: task.tenantId, program_id: task.programId, package_id: task.packageId, package_version: task.packageVersion, task_id: task.taskId, kind, input_hash: supplementConsumerHash(task) });
    if (records.length !== 1)
        return { ready: false, code: 'weekly_preproduction_authority_required', resultRefs: [] };
    const root=checked(records[0]!);
    const job=root.kind==='discovery'?(await readWeeklyPreproductionRetryAttempt(store,root)??root):root;
    await scope(store, job);
    if (job.dueAt !== (task.schedule.latestStartAt || task.schedule.estimatedStartAt))
        return { ready: false, code: 'weekly_preproduction_consumer_changed', resultRefs: [] };
    const identity={jobId:job.jobId,originalRunKey:job.originalRunKey,producerStatus:job.status,...((job as WeeklyPreproductionRetryAttempt).retry?{retryParentRunId:(job as WeeklyPreproductionRetryAttempt).retry.parentRunId}:{})};
    if (job.status !== 'succeeded')
        return { ready: false, code: job.code ?? 'weekly_preproduction_pending', resultRefs: [],...identity };
    if(kind==='outline'){const ref=job.resultRefs.find(r=>r.type==='operating_authority_snapshot');if(!ref)throw Error('weekly_preproduction_outline_evidence_missing');const snapshot=await createSocialOperatingOrchestrationService(store).getSnapshot(job.tenantId,job.programId,ref.id,ref.version);await assertOutlineProof(store,job,snapshot);}
    if (kind === 'outline' && await facts(store, job.tenantId) !== job.sourceHash)
        return { ready: false, code: 'weekly_preproduction_facts_changed', resultRefs: [] };
    if (kind === 'discovery') {
        const a = job.authority;
        if (!a)
            return { ready: false, code: 'weekly_preproduction_discovery_authority_required', resultRefs: [] };
        const r = await store.getById<DiscoveryScopeRecord>('social_discovery_scopes', a.scopeId);
        if (!r || r.tenant_id !== job.tenantId || r.status !== 'active' || r.version !== a.scopeVersion || socialRequestHash(r.payload) !== a.scopeHash)
            return { ready: false, code: 'weekly_preproduction_scope_changed', resultRefs: [] };
    }
    if (kind === 'discovery') {
        const authority=job.authority;if(!authority)throw Error('weekly_preproduction_discovery_authority_required');
        const ref = job.resultRefs.find(r => r.type === 'social_discovery_run');
        if (!ref)
            throw Error('weekly_preproduction_collection_evidence_missing');
        const run = await unique(store, 'social_discovery_runs', { tenant_id: job.tenantId, runId: ref.id });
        const reassessmentRef=job.resultRefs.find(r=>r.type==='social_discovery_candidate_reassessment');
        const reassessment=reassessmentRef?await readWeeklyCandidateReassessment(store,job as WeeklyPreproductionRetryAttempt,run as unknown as import('../../shared/contracts/socialContentWorkflow.js').SocialInspirationCollectionRun,reassessmentRef):null;
        if ((!reassessment&&!['succeeded','partial'].includes(String(run.status))) || run.discoveryScopeId !== authority.scopeId || run.discoveryScopeVersion !== authority.scopeVersion || job.collectionEvidenceHash !== socialRequestHash({ modeStats: run.modeStats, evidenceOutcomes: run.evidenceOutcomes, scopeSnapshot: run.scopeSnapshot,...(reassessmentRef?{reassessmentRef}:{}) }))
            return { ready: false, code: 'weekly_preproduction_collection_evidence_changed', resultRefs: [] };
        const planning = await createWeeklyPlanningAuthority(store).get(job.tenantId, job.programId, job.packageId, job.packageVersion);
        await assertPlanningCollection(store,job,planning,{evidenceOutcomes:reassessment?.evidenceOutcomes??run.evidenceOutcomes});
        if (!planning.detailedSchedule || job.planningEvidenceHash !== socialRequestHash({ directorAnalyses: planning.directorAnalyses, detailedSchedule: planning.detailedSchedule }))
            return { ready: false, code: 'weekly_preproduction_planning_evidence_changed', resultRefs: [] };
    }
    return { ready: true, code: null, resultRefs: job.resultRefs,...identity };
}
async function recoverConsumer(store: DataStore, job: WeeklyPreproductionJob, assert: () => Promise<void>) {
    const { task } = await scope(store, job);
    if (task.status !== 'blocked' || task.lease)
        return;
    if (supplementConsumerHash(task) !== job.consumerInputHash || job.dueAt !== (task.schedule.latestStartAt || task.schedule.estimatedStartAt))
        throw Error('weekly_preproduction_consumer_changed');
    const gate = await readWeeklyPreproductionExecutionGate(store, task);
    if (!gate.ready)
        return;
    for (const reason of task.ownBlockingReasons.filter(reason => reason.startsWith('weekly_preproduction_'))) {
        await assert();
        await createWeeklyExecutionTaskService(store).unblock(job.tenantId, job.programId, job.packageId, job.consumerTaskId, reason);
    }
}

async function assertPlanningCollection(store:DataStore,job:WeeklyPreproductionJob,planning:import('../../shared/contracts/socialProgram.js').WeeklyAgentPlanningState,run:{evidenceOutcomes?:unknown}){
 const outcomes=socialObject(run.evidenceOutcomes);const ids=new Set<string>(),refs=new Set<string>();for(const value of Object.values(outcomes??{})){const o=socialObject(value);for(const id of Array.isArray(o?.acceptedCandidateIds)?o.acceptedCandidateIds:[])if(typeof id==='string')ids.add(id);for(const ref of Array.isArray(o?.acceptedEvidenceRefs)?o.acceptedEvidenceRefs:[])if(typeof ref==='string')refs.add(ref);}
 for(const analysis of planning.directorAnalyses){const slot=planning.skeleton.slots.find(s=>s.slotId===analysis.slotId);if(!slot)throw Error('weekly_preproduction_analysis_source_mismatch');
 if(slot.referenceSource==='owned'){if(!analysis.targetAccountPlaybooks?.length||analysis.targetAccountPlaybooks.some(a=>!slot.accountIds.includes(a.accountId)))throw Error('weekly_preproduction_analysis_source_mismatch');continue;}
 if(!analysis.benchmarkVideoRefs.length)throw Error('weekly_preproduction_analysis_source_mismatch');for(const video of analysis.benchmarkVideoRefs){if(!ids.has(video.id))throw Error('weekly_preproduction_analysis_source_mismatch');const evidence=await all(store,'social_candidate_evidence',{tenant_id:job.tenantId,candidateId:video.id,version:video.version});if(evidence.length!==1||!refs.has(`${evidence[0]!.evidenceId}@${video.version}`)||!analysis.benchmarkEvidenceRefs.includes(String(evidence[0]!.evidenceId)))throw Error('weekly_preproduction_analysis_source_mismatch');}
 }
}

async function assertOutlineProof(store:DataStore,job:WeeklyPreproductionJob,snapshot:import('../../shared/contracts/socialOperatingDecision.js').OperatingAuthoritySnapshot){
 const{pkg}=await scope(store,job);if(snapshot.programId!==job.programId||snapshot.planningWeekStart!==pkg.weekStart)throw Error('weekly_preproduction_outline_source_mismatch');await member(store,job.tenantId,snapshot.createdBy);
 const pr=await unique(store,'tenant_profiles',{tenant_id:job.tenantId}),p=parse<EnterpriseProfile>(pr.profile);
 const statements=[p.company?.description,p.brand?.usp,p.products?.highlights,p.products?.certifications,...(p.products?.items??[]).flatMap(v=>[v.name,v.highlights,v.certifications])].map(v=>String(v??'').trim().slice(0,1000)).filter(Boolean);
 const stableId=(prefix:string,value:unknown)=>`${prefix}_${createHash('sha256').update(deterministicFingerprint(value)).digest('hex').slice(0,24)}`;
 const enterprise=snapshot.enterprise;if(!enterprise||enterprise.ref.type!=='enterprise_operating_snapshot'||enterprise.ref.id!==stableId('enterprise',{tenantId:job.tenantId,programId:job.programId})||!enterprise.publicFacts.length||enterprise.publicFacts.some(f=>!statements.includes(f.statement)||f.ref.type!=='enterprise_fact'||f.ref.version!==enterprise.ref.version||f.ref.id!==stableId('fact',{enterpriseId:enterprise.ref.id,statement:f.statement})))throw Error('weekly_preproduction_outline_source_mismatch');
 const row=await unique(store,'social_business_content_goals',{tenant_id:job.tenantId,program_id:job.programId,goal_id:snapshot.businessContentGoalRef.id,version:snapshot.businessContentGoalRef.version}),goal=parse<import('../../shared/contracts/socialOperatingDecision.js').BusinessContentGoal>(row.payload);if(goal.programId!==job.programId||goal.goalId!==snapshot.businessContentGoalRef.id||goal.version!==snapshot.businessContentGoalRef.version||goal.publicFactRefs.some(r=>!enterprise.publicFacts.some(f=>socialRequestHash(f.ref)===socialRequestHash(r))))throw Error('weekly_preproduction_outline_goal_not_ready');
 const readiness=evaluateProductionOutlineReadiness(goal);if(!readiness.ready)throw Error('weekly_preproduction_outline_goal_not_ready');
 if(job.status==='succeeded'&&job.outlineReadiness&&socialRequestHash(job.outlineReadiness)!==socialRequestHash(readiness))throw Error('weekly_preproduction_outline_evidence_changed');
 // Legacy successful outlines had to reference a fully-ready commercial goal.
 if(job.status==='succeeded'&&!job.outlineReadiness&&goal.status!=='ready')throw Error('weekly_preproduction_outline_scope_evidence_required');
 return readiness;
}
