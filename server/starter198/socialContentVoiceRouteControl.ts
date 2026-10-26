import { readNativeVoiceFailureRetry } from './socialContentVoiceFailureRecovery.js';
import { fileURLToPath } from 'node:url';
import { currentDataAuthority } from '../storage/dataAuthority.js';
import { localFallbacksEnabled } from '../lib/localFallbackPolicy.js';
import { withPaidOperationLock } from '../lib/paidOperationLock.js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { DataStore } from '../storage/datastore.js';
import { acquireDurableOperationLease, assertDurableOperationLease, releaseDurableOperationLease, type DurableOperationLease } from '../runtime/durableLease.js';
import { CONTENT_EXECUTION_JOB_COLLECTION, assertSocialContentOrderActive } from '../contentExecution/context.js';
import { jobFromRow, type JobRow } from '../contentExecution/durableQueueRecords.js';
import { socialPaidIntentOperation } from '../lib/socialContentTaskBudgetAuthority.js';
import { SocialContentTaskBudget } from '../lib/socialContentTaskBudget.js';
import { readHeyGenPublishedTariff } from '../lib/heygenPublishedPricing.js';
import type { SocialPaidOperationIntent, SocialVerifiedAccountTariff } from '../lib/socialContentTaskBudgetAuthority.js';
import { createStarter198Repository } from './repository.js';
import { requireSocialTask } from './socialContentRecords.js';
import { socialJson, socialObject } from './socialContentValidation.js';
import { productionBudgetMaximumCny } from '../../shared/contracts/productionBudgetPolicy.js';
import { paidProductionHash, type BoundPaidRoute } from './socialContentPaidOperationPlan.js';
import { readBoundPresenterVoice, type BoundPresenterVoice } from './socialContentBoundPresenterVoice.js';
import { productionBillingAccountRef } from './socialContentProductionBudgetRoutes.js';
import { createProductionBudgetRuntimeReaders } from './socialContentProductionBudgetRuntimeReaders.js';
import { parseStoredSocialScriptBaseline } from './socialContentScriptBaseline.js';
import { resolveSocialContentFormulaReference } from './socialContentFormulas.js';
import { readTrustedHeyGenRuntimeBinding } from './socialContentHeyGenRuntimeBinding.js';
import { amendUnsubmittedVoiceRoute, VOICE_ROUTE_AMENDMENT_STAGE, type VoiceRouteAmendment, verifyVoiceRouteAmendment } from './socialContentVoiceRouteAmendment.js';

const fail = (reason: string): never => { throw Error('voice_route_control_' + reason); };
/** Internal domain control only. Identity comes from a trusted controller/CLI;
 * no caller-selected person, voice, model, price, or budget is accepted. */
export async function amendCanonicalUnsubmittedVoiceRoute(input: {
  store: DataStore; tenantId: string; taskId: string; runId: string; jobId: string;
  authorizationRef: string; ledgerRoot?: string; mode?: 'native_video'; retryFailed?:true; expectedFailedOperationId?:string;
  /** Read-only test seams; production defaults read canonical assets and the
   * original official supplier metadata/pricing readers. */
  testPorts?: {
    readPresenterVoice?: typeof readBoundPresenterVoice;
    readRoute?: (voice: BoundPresenterVoice) => Promise<BoundPaidRoute | null>;
    nativeSpeechRoot?:string; nativeSpeechKey?:string; readProviderStatus?:(taskId:string,key:string)=>Promise<Record<string,unknown>>;
    readRuntimeBinding?: typeof readTrustedHeyGenRuntimeBinding;
    readTariff?: (intent: SocialPaidOperationIntent) => Promise<SocialVerifiedAccountTariff | null>;
  };
}) {
  const { store } = input, repository = createStarter198Repository(store);
  if (input.mode!==undefined && input.mode!=='native_video') return fail('mode_invalid');
  if (!input.authorizationRef.trim() || input.authorizationRef.length > 512) return fail('authorization_ref_required');
  if(input.retryFailed){
    if(!input.expectedFailedOperationId)return fail('expected_failed_operation_required');
    const raw=await store.getById<JobRow>(CONTENT_EXECUTION_JOB_COLLECTION,input.jobId);
    if(raw){
      const current=jobFromRow(raw),record=current.checkpoints[VOICE_ROUTE_AMENDMENT_STAGE]?.payload as VoiceRouteAmendment|undefined;
      if(current.tenantId!==input.tenantId||current.taskId!==input.taskId||current.runId!==input.runId)return fail('job_scope_changed');
      if(record?.state==='active'&&record.authorizationRef===input.authorizationRef&&record.retry){
        if(record.retry.failedOperationId!==input.expectedFailedOperationId)return fail('retry_source_changed');
        const frozen=socialObject(current.checkpoints['social.whole_film_budget']?.payload),plan=socialObject(frozen?.plan);
        const requirement=(frozen?.requirements as VoiceRouteAmendment['requirement'][]|undefined)?.find(item=>item.key==='voice:0:tts');
        const oldIntent=(plan?.paidOperations as SocialPaidOperationIntent[]|undefined)?.find(item=>item.operationId===record.oldIntent.operationId);
        if(!frozen||!requirement||!oldIntent)return fail('frozen_budget_missing');
        verifyVoiceRouteAmendment(record,{scope:record.scope,sourceCheckpointHash:paidProductionHash(frozen),voice:record.selectedVoice,originalVoice:frozen.presenterVoiceBinding as BoundPresenterVoice,requirement,oldIntent,oldRoute:socialObject(frozen.routeBindings)?.['voice:0:tts'] as BoundPaidRoute});
        const ledger=new SocialContentTaskBudget(input.ledgerRoot,{assertCurrent:async()=>fail('readonly'),authorization:async()=>fail('readonly'),quote:async()=>fail('readonly'),verifyRejection:async()=>false});
        const entry=ledger.status(record.scope)?.entries.find(item=>item.operationId===record.newIntent.operationId);
        if(!entry||entry.status==='rejected'||entry.fingerprint!==socialPaidIntentOperation(record.scope,record.newIntent).fingerprint)return fail('active_reservation_missing');
        return record;
      }
    }
  }
  const casSupported = store.supportsAtomicCompareAndSwapFor ? await store.supportsAtomicCompareAndSwapFor(CONTENT_EXECUTION_JOB_COLLECTION)
    : await store.supportsAtomicCompareAndSwap?.();
  const databaseLease = await store.supportsAtomicOperationLease?.();
  const localFileControl = !databaseLease && currentDataAuthority()==='local' && localFallbacksEnabled()
    && store===(await import('../storage/pbStore.js')).pbStore;
  if (!casSupported || !store.compareAndSwap || (!databaseLease && !localFileControl)) return fail('atomic_control_unavailable');
  const localControlRoot=path.join(process.env.LOCAL_STORE_DIR?.trim()?path.resolve(process.env.LOCAL_STORE_DIR):fileURLToPath(new URL('../../data/local-store',import.meta.url)),'.content-execution-control-locks');
  const readJob = async () => {
    const row = await store.getById<JobRow>(CONTENT_EXECUTION_JOB_COLLECTION, input.jobId);
    if (!row) return fail('job_missing');
    const job = jobFromRow(row);
    if (job.tenantId !== input.tenantId || job.taskId !== input.taskId || job.runId !== input.runId) return fail('job_scope_changed');
    if (!['blocked', 'paused'].includes(job.status) || job.workerId || job.leaseExpiresAt || !(input.retryFailed?['none','failed','completed']:['none']).includes(job.providerState)
      || job.providerReceipts.some(receipt=>!input.retryFailed||!['failed','completed'].includes(receipt.state)) || job.completedAt || row.worker_id || row.lease_expires_at) return fail('job_not_quiescent');
    const workerLeases = await store.list<any>('durable_operation_leases', { where: { tenant_id: input.tenantId, lease_scope: 'content_execution_job', subject_id: input.jobId }, perPage: 2 });
    if (workerLeases.totalItems || workerLeases.items.length) return fail('worker_lease_present');
    return { row, job };
  };
  const initial = await readJob(), source = initial.job.checkpoints['social.whole_film_budget'];
  const payload = socialObject(source?.payload), plan = socialObject(payload?.plan);
  const scope = plan?.scope as VoiceRouteAmendment['scope'] | undefined;
  const originalVoice = payload?.presenterVoiceBinding as BoundPresenterVoice | undefined;
  const requirements = payload?.requirements as VoiceRouteAmendment['requirement'][] | undefined;
  const intents = plan?.paidOperations as SocialPaidOperationIntent[] | undefined;
  const requirement = Array.isArray(requirements) ? requirements.find(item => item.key === 'voice:0:tts') : undefined;
  const oldIntent = Array.isArray(intents) ? intents.find(item => item.operationId === 'paid-plan:' + paidProductionHash({ scope, key: 'voice:0:tts', attempt: 0 })) : undefined;
  const oldRoute = socialObject(payload?.routeBindings)?.['voice:0:tts'] as BoundPaidRoute | undefined;
  if (!source || !payload || !plan || !scope || !originalVoice || !requirement || !oldIntent || !oldRoute
    || source.inputHash !== scope.planHash || payload.scopeHash !== paidProductionHash(scope)
    || scope.tenantId !== input.tenantId || scope.taskId !== input.taskId || scope.runId !== input.runId || scope.budgetTaskId) return fail('frozen_budget_missing');
  const task = await requireSocialTask({ repository, tenantId: input.tenantId, taskId: input.taskId });
  if (task.run_id !== input.runId) return fail('task_run_changed');
  await assertSocialContentOrderActive(store, input.tenantId, input.taskId);
  const brief = socialObject(socialJson(task.brief));
  if (!brief) return fail('task_authorization_missing');
  const taskAuthorityHash = paidProductionHash({ runId: task.run_id, brief, baseline: task.script_baseline });
  const sourceCheckpointHash = paidProductionHash(payload), root = path.resolve(input.ledgerRoot || process.env.SOCIAL_CONTENT_TASK_BUDGET_DIR || 'data/social-content-task-budget');
  const probe = new SocialContentTaskBudget(root, { assertCurrent: async () => { throw Error('readonly_probe'); }, authorization: async () => { throw Error('readonly_probe'); }, quote: async () => { throw Error('readonly_probe'); }, verifyRejection: async () => false });
  const status = probe.status(scope), canonicalMaximum = productionBudgetMaximumCny(brief);
  if (!status || status.hasCorrectionAuthorization || status.limitCny !== canonicalMaximum || plan.maximumCny !== canonicalMaximum) return fail('canonical_budget_changed');
  const ids = originalVoice.presenters.map(item => item.id);
  let lease: DurableOperationLease | null = null;
  const assertCurrent = async () => {
    if (!lease) return fail('control_lease_required');
    await assertDurableOperationLease({ dataStore: store, lease, minimumRemainingMs: 1000 });
    await assertSocialContentOrderActive(store, input.tenantId, input.taskId);
    const live = await readJob(), currentTask = await requireSocialTask({ repository, tenantId: input.tenantId, taskId: input.taskId });
    if (paidProductionHash(live.job.checkpoints['social.whole_film_budget']?.payload) !== sourceCheckpointHash
      || paidProductionHash({ runId: currentTask.run_id, brief: socialObject(socialJson(currentTask.brief)), baseline: currentTask.script_baseline }) !== taskAuthorityHash) return fail('canonical_source_changed');
    const current = probe.status(scope);
    if (!current || current.limitCny !== canonicalMaximum || current.hasCorrectionAuthorization) return fail('canonical_budget_changed');
  };
  const readSelected = () => (input.testPorts?.readPresenterVoice || readBoundPresenterVoice)(store, input.tenantId, ids);
  const baseline = parseStoredSocialScriptBaseline(task.script_baseline);
  if (!baseline) return fail('baseline_missing');
  const readRoute = async (voice: BoundPresenterVoice) => {
    if (input.testPorts?.readRoute) return input.testPorts.readRoute(voice);
    const formula = baseline.formulaReference ? await resolveSocialContentFormulaReference({ repository, ...baseline.formulaReference }) : null;
    const readers = createProductionBudgetRuntimeReaders({ tenantId: input.tenantId, formula, readPresenterVoice: async () => voice,
      heygenSpeechMode:input.mode, frozenTrackSeconds: Number(oldRoute.maximumUnits.audioSeconds) / 2, requiresMeasuredAlignment: true });
    const current = await readers.readVoicePlan!(baseline);
    if (!current || current.mode !== 'continuous' || current.lines.join(' ').trim() !== requirement.text) return fail('frozen_text_changed');
    return readers.resolveBoundRoute!(requirement);
  };
  return amendUnsubmittedVoiceRoute({ scope, sourceCheckpointHash, originalVoice, requirement, oldIntent, oldRoute, ledgerRoot: root, ports: {
    withControlLease: async operation => {
      const run = async () => {
        lease = await acquireDurableOperationLease({ dataStore: store, tenantId: input.tenantId, scope: 'content_execution_control', subjectId: input.jobId, ownerId: 'voice-route:' + randomUUID(), leaseDurationMs: 300000 });
        if (!lease) return fail('control_busy');
        try { await assertCurrent(); return await operation(); }
        finally { await releaseDurableOperationLease({ dataStore: store, lease }); lease = null; }
      };
      // Local pbStore has collection CAS but no DB unique lease index. Hold a
      // durable cross-process lock over acquisition, work, and lease release.
      // Remote authority never receives this local-only capability fallback.
      return localFileControl ? withPaidOperationLock(localControlRoot,JSON.stringify([input.tenantId,'content_execution_control',input.jobId]),run) : run();
    }, assertCurrent, assertQuiescent: async () => { await readJob(); },
    readAuthorizedChange: async () => {
      const selectedVoice = await readSelected(); if (!selectedVoice) return fail('selected_voice_missing');
      const newRoute = await readRoute(selectedVoice); if (!newRoute) return fail('native_route_missing');
      let nativeVideoBinding:import('./socialContentVoiceRouteAmendment.js').NativeVideoVoiceRouteProof | undefined;
      if(input.mode==='native_video'){
        const person=selectedVoice.presenters[0]; if(!person || selectedVoice.presenters.length!==1) return fail('native_identity_ambiguous');
        const binding=await (input.testPorts?.readRuntimeBinding || readTrustedHeyGenRuntimeBinding)({tenantId:input.tenantId,presenterAssetId:person.id,expectedVersion:person.assetVersion},{store,assertCurrent});
        if(!binding || binding.avatarId!==person.avatarId || binding.voiceId!==selectedVoice.voiceId || binding.accountRef!==newRoute.accountRef) return fail('native_provider_binding_changed');
        nativeVideoBinding={credentialSha256:binding.credentialSha256,accountRef:binding.accountRef,presenterAssetId:binding.presenterAssetId,assetVersion:binding.assetVersion,avatarId:binding.avatarId,voiceId:binding.voiceId,providerEvidenceRef:binding.providerEvidenceRef};
      }
      let retry:import('./socialContentVoiceRouteAmendment.js').NativeVoiceFailureRetry|undefined;
      if(input.retryFailed){
        const saved=(await readJob()).job.checkpoints[VOICE_ROUTE_AMENDMENT_STAGE]?.payload as VoiceRouteAmendment|undefined;
        const previous=saved?.authorizationRef===input.authorizationRef?saved.previousAmendment:saved;
        if(!previous||previous.newIntent.operationId!==input.expectedFailedOperationId)return fail('retry_source_changed');
        retry=await readNativeVoiceFailureRetry(previous,{root:input.testPorts?.nativeSpeechRoot,key:input.testPorts?.nativeSpeechKey,readStatus:input.testPorts?.readProviderStatus});
      }
      return { authorizationRef: input.authorizationRef, maximumCny: canonicalMaximum, selectedVoice, newRoute, executionMode:input.mode==='native_video'?'native_video' as const:'independent_speech' as const, ...(nativeVideoBinding?{nativeVideoBinding}:{}),...(retry?{retry}:{}) };
    },
    readTariff: input.testPorts?.readTariff || (async intent => readHeyGenPublishedTariff(intent, { readBinding: async () => {
      const person = originalVoice.presenters[0]; if (!person) return null;
      const binding = await (input.testPorts?.readRuntimeBinding || readTrustedHeyGenRuntimeBinding)({ tenantId: input.tenantId, presenterAssetId: person.id, expectedVersion: person.assetVersion }, { store, assertCurrent });
      if (!binding || productionBillingAccountRef('heygen', input.mode==='native_video'?'https://api.heygen.com/v3/videos':'https://api.heygen.com/v3/voices/speech', binding.credentialSha256) !== intent.accountRef) return null;
      return { ...binding, accountRef: intent.accountRef };
    } })),
    readAmendment: async () => (await readJob()).job.checkpoints[VOICE_ROUTE_AMENDMENT_STAGE]?.payload as VoiceRouteAmendment || null,
    writeAmendment: async record => {
      await assertCurrent(); const current = await readJob();
      const updatedAt = new Date().toISOString();
      const checkpoints = { ...(current.row.checkpoints as Record<string, unknown>), [VOICE_ROUTE_AMENDMENT_STAGE]: { version: '1', inputHash: record.recordHash, payload: record, updatedAt } };
      if (!await store.compareAndSwap!(CONTENT_EXECUTION_JOB_COLLECTION, input.jobId, { tenant_id: input.tenantId, run_id: input.runId,
        task_id: input.taskId, provider_state: current.row.provider_state, provider_receipts: current.row.provider_receipts,
        status: current.row.status, worker_id: current.row.worker_id, lease_expires_at: current.row.lease_expires_at,
        updated_at: current.row.updated_at, checkpoints: current.row.checkpoints }, { checkpoints, updated_at: updatedAt })) return fail('checkpoint_cas_failed');
      const saved = await readJob(); if (paidProductionHash(saved.job.checkpoints[VOICE_ROUTE_AMENDMENT_STAGE]?.payload) !== paidProductionHash(record)) return fail('checkpoint_readback_failed');
    },
  } });
}
