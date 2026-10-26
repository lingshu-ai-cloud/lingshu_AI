import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { withPaidOperationLock } from '../lib/paidOperationLock.js';
import { SocialContentTaskBudget, type SocialTaskBudgetScope, type SocialTaskBudgetQuote } from '../lib/socialContentTaskBudget.js';
import { quoteSocialPaidOperationTariff, socialPaidIntentOperation, type SocialPaidOperationIntent, type SocialVerifiedAccountTariff } from '../lib/socialContentTaskBudgetAuthority.js';
import { resolveActiveVoiceIntent, type VoiceRouteRevisedIntent, type VoiceRouteRevisionBinding } from '../lib/socialContentVoiceRouteRevision.js';
import { paidProductionHash, type BoundPaidRoute, type PaidStageRequirement } from './socialContentPaidOperationPlan.js';
import { productionBillingAccountRef } from './socialContentProductionBudgetRoutes.js';
import type { BoundPresenterVoice } from './socialContentBoundPresenterVoice.js';

export const VOICE_ROUTE_AMENDMENT_STAGE = 'social.voice_route_amendment';
export interface NativeVideoVoiceRouteProof {
  credentialSha256: string; accountRef: string; presenterAssetId: string; assetVersion: number;
  avatarId: string; voiceId: string; providerEvidenceRef: string;
}
export interface NativeVoiceFailureRetry {
  attempt:number; failedOperationId:string; providerTaskId:string; failureCode:string; receiptSha256:string; providerStatusHash:string;
}
export interface VoiceRouteAmendment {
  schema: 'social-content-voice-route-amendment.v1'; scope: SocialTaskBudgetScope;
  sourceCheckpointHash: string; authorizationRef: string; maximumCny: number;
  retry?:NativeVoiceFailureRetry; previousAmendment?:VoiceRouteAmendment;
  executionMode: 'independent_speech' | 'native_video'; nativeVideoBinding?: NativeVideoVoiceRouteProof;
  originalVoice: BoundPresenterVoice; selectedVoice: BoundPresenterVoice;
  oldIntent: SocialPaidOperationIntent; oldRoute: BoundPaidRoute; newRoute: BoundPaidRoute;
  requirement: PaidStageRequirement; newIntent: VoiceRouteRevisedIntent; quote: SocialTaskBudgetQuote;
  revisionHash: string; recordHash: string; state: 'pending' | 'active';
}
const fail = (reason: string): never => { throw Error('voice_route_amendment_' + reason); };
const voiceIdentity = (voice: BoundPresenterVoice) => paidProductionHash({ provider: voice.provider, voiceId: voice.voiceId,
  presenters: voice.presenters.map(item => ({ id: item.id, assetVersion: item.assetVersion, avatarId: item.avatarId, voiceId: item.voiceId })) });
const recordHash = (record: VoiceRouteAmendment) => { const { state: _state, recordHash: _hash, ...body } = record; return paidProductionHash(body); };
function validNativeVideoBinding(record: VoiceRouteAmendment) {
  const proof=record.nativeVideoBinding, person=record.selectedVoice.presenters[0];
  return Boolean(proof && person && record.selectedVoice.presenters.length===1 && /^[a-f0-9]{64}$/.test(proof.credentialSha256)
    && proof.providerEvidenceRef && proof.presenterAssetId===person.id && proof.assetVersion===person.assetVersion
    && proof.avatarId===person.avatarId && proof.voiceId===record.selectedVoice.voiceId
    && record.newRoute.model==='avatar_iv' && record.newRoute.accountRef===proof.accountRef
    && proof.accountRef===productionBillingAccountRef('heygen','https://api.heygen.com/v3/videos',proof.credentialSha256)
    && record.oldRoute.accountRef===productionBillingAccountRef('heygen','https://api.heygen.com/v3/voices/speech',proof.credentialSha256)
    && Object.keys(record.newRoute.maximumUnits).join()==='providerSeconds'
    && record.newRoute.maximumUnits.providerSeconds===record.oldRoute.maximumUnits.audioSeconds);
}
export function verifyVoiceRouteAmendment(record: VoiceRouteAmendment, input: {
  scope: SocialTaskBudgetScope; sourceCheckpointHash: string; voice: BoundPresenterVoice; originalVoice: BoundPresenterVoice;
  requirement: PaidStageRequirement; oldRoute: BoundPaidRoute; oldIntent: SocialPaidOperationIntent;
}) {
  if (!record || record.schema !== 'social-content-voice-route-amendment.v1' || record.recordHash !== recordHash(record)
    || !['pending', 'active'].includes(record.state) || paidProductionHash(record.scope) !== paidProductionHash(input.scope)
    || record.sourceCheckpointHash !== input.sourceCheckpointHash || voiceIdentity(record.originalVoice) !== voiceIdentity(record.selectedVoice)
    || voiceIdentity(record.originalVoice) !== voiceIdentity(input.originalVoice)
    || voiceIdentity(record.selectedVoice) !== voiceIdentity(input.voice) || !record.authorizationRef || record.authorizationRef.length>512
    || !Number.isFinite(record.maximumCny) || !(record.maximumCny > 0)
    || !Number.isFinite(record.quote?.upperBoundCny) || !(record.quote.upperBoundCny > 0) || !record.quote.quoteRef
    || !Number.isFinite(Date.parse(record.quote.validUntil))
    || paidProductionHash(record.requirement) !== paidProductionHash(input.requirement)
    || paidProductionHash(record.oldIntent) !== paidProductionHash(input.oldIntent) || paidProductionHash(record.oldRoute) !== paidProductionHash(input.oldRoute)
    || record.oldRoute.provider !== 'heygen' || record.oldRoute.model !== 'starfish'
    || record.oldIntent.stage!=='tts' || record.oldIntent.shotId!==null
    || record.oldIntent.provider!==record.oldRoute.provider || record.oldIntent.model!==record.oldRoute.model || record.oldIntent.accountRef!==record.oldRoute.accountRef
    || record.newRoute.provider !== 'heygen'
    || !['independent_speech','native_video'].includes(record.executionMode)
    || (record.executionMode==='independent_speech' && (record.newRoute.model!=='orca' || record.newRoute.accountRef!==record.oldRoute.accountRef || Boolean(record.nativeVideoBinding)))
    || (record.executionMode==='native_video' && !validNativeVideoBinding(record))
    || record.requirement.key !== 'voice:0:tts' || record.requirement.stage !== 'tts'
    || record.newIntent.routeRevision?.supersedesOperationId !== (record.retry?.failedOperationId || record.oldIntent.operationId)
    || record.newIntent.routeRevision?.revisionHash !== record.revisionHash
    || record.revisionHash !== paidProductionHash({scope:record.scope,sourceCheckpointHash:record.sourceCheckpointHash,authorizationRef:record.authorizationRef,maximumCny:record.maximumCny,voice:record.selectedVoice,executionMode:record.executionMode,nativeVideoBinding:record.nativeVideoBinding,requirement:record.requirement,oldIntent:record.oldIntent,oldRoute:record.oldRoute,newRoute:record.newRoute,...(record.retry?{retry:record.retry}:{})})) fail('binding_invalid');
  if(record.retry){
    const previous=record.previousAmendment, retry=record.retry;
    if(!previous || previous.state!=='active' || record.executionMode!=='native_video' || retry.failedOperationId!==previous.newIntent.operationId
      || !Number.isSafeInteger(retry.attempt) || retry.attempt!==(previous.retry?.attempt||0)+1 || retry.attempt>32
      || !retry.providerTaskId || !retry.failureCode || !/^[a-f0-9]{64}$/.test(retry.receiptSha256) || !/^[a-f0-9]{64}$/.test(retry.providerStatusHash)
      || paidProductionHash(record.newRoute)!==paidProductionHash(previous.newRoute))fail('retry_binding_invalid');
    verifyVoiceRouteAmendment(previous!,input);
  }else if(record.previousAmendment)fail('retry_binding_invalid');
  resolveActiveVoiceIntent({ scope: record.scope, requirements: [record.requirement], routeBindings: { [record.requirement.key]: record.newRoute }, intents: [record.newIntent] }, record.requirement.key);
  return record;
}

/** Trusted operator/control seam. No HTTP supplied prices, voices or grants.
 * The caller holds the durable job-control lease and proves worker quiescence.
 * A pending record fences the old route before a replacement hold is appended. */
export async function amendUnsubmittedVoiceRoute(input: {
  scope: SocialTaskBudgetScope; sourceCheckpointHash: string; originalVoice: BoundPresenterVoice;
  requirement: PaidStageRequirement; oldIntent: SocialPaidOperationIntent; oldRoute: BoundPaidRoute; ledgerRoot?: string;
  ports: {
    withControlLease<T>(operation: () => Promise<T>): Promise<T>;
    assertQuiescent(): Promise<void>; assertCurrent(): Promise<void>;
    readAuthorizedChange(): Promise<{ retry?:NativeVoiceFailureRetry; executionMode?: VoiceRouteAmendment['executionMode']; nativeVideoBinding?: NativeVideoVoiceRouteProof; authorizationRef: string; maximumCny: number; selectedVoice: BoundPresenterVoice; newRoute: BoundPaidRoute } | null>;
    readTariff(intent: SocialPaidOperationIntent): Promise<SocialVerifiedAccountTariff | null>;
    readAmendment(): Promise<VoiceRouteAmendment | null>; writeAmendment(record: VoiceRouteAmendment): Promise<void>;
  };
}): Promise<VoiceRouteAmendment> {
  const { scope, ports } = input, root = path.resolve(input.ledgerRoot || process.env.SOCIAL_CONTENT_TASK_BUDGET_DIR || 'data/social-content-task-budget');
  return ports.withControlLease(async () => {
    await ports.assertQuiescent(); await ports.assertCurrent();
    const approved = await ports.readAuthorizedChange(); if (!approved) return fail('authorization_missing');
    const grant = structuredClone(approved);
    const assertCurrent = async () => { await ports.assertCurrent(); if (paidProductionHash(await ports.readAuthorizedChange()) !== paidProductionHash(grant)) fail('authorization_changed'); };
    const saved = await ports.readAmendment();
    const previousAmendment=grant.retry?(saved?.authorizationRef===grant.authorizationRef?saved.previousAmendment:saved):undefined;
    const prior=grant.retry && saved?.authorizationRef!==grant.authorizationRef?null:saved;
    if(grant.retry && (!previousAmendment || previousAmendment.newIntent.operationId!==grant.retry.failedOperationId))return fail('retry_source_changed');
    const revisionHash = paidProductionHash({ scope, sourceCheckpointHash: input.sourceCheckpointHash, authorizationRef: grant.authorizationRef,
      maximumCny: grant.maximumCny, voice: grant.selectedVoice, executionMode:grant.executionMode || 'independent_speech', nativeVideoBinding:grant.nativeVideoBinding, requirement: input.requirement, oldIntent: input.oldIntent, oldRoute: input.oldRoute, newRoute: grant.newRoute, ...(grant.retry?{retry:grant.retry}:{}) });
    const routeRevision: VoiceRouteRevisionBinding = { schema: 'social-content-voice-route-revision.v1', key: input.requirement.key, revisionHash, supersedesOperationId: grant.retry?.failedOperationId || input.oldIntent.operationId };
    const newIntent: VoiceRouteRevisedIntent = { operationId: 'paid-plan:' + paidProductionHash({ scope, key: input.requirement.key, attempt: 0, routeRevision }),
      provider: grant.newRoute.provider, model: grant.newRoute.model, accountRef: grant.newRoute.accountRef, stage: 'tts', shotId: null,
      inputContractHash: paidProductionHash({ requirement: input.requirement, route: grant.newRoute, attempt: 0, routeRevision }), maximumUnits: grant.newRoute.maximumUnits, routeRevision };
    const check = (record: VoiceRouteAmendment) => verifyVoiceRouteAmendment(record, { ...input, voice: grant.selectedVoice });
    if (prior && prior.revisionHash !== revisionHash) return fail('conflicting_revision');
    // Obtain a real price before writing pending or touching any ledger row.
    const tariff = prior ? null : await ports.readTariff(newIntent);
    if (!prior && !tariff) return fail('verified_tariff_missing');
    const quote = prior?.quote || quoteSocialPaidOperationTariff(newIntent, tariff);
    let record: VoiceRouteAmendment = prior || { schema: 'social-content-voice-route-amendment.v1', scope,
      sourceCheckpointHash: input.sourceCheckpointHash, authorizationRef: grant.authorizationRef, maximumCny: grant.maximumCny,
      executionMode:grant.executionMode || 'independent_speech', ...(grant.nativeVideoBinding?{nativeVideoBinding:grant.nativeVideoBinding}:{}),
      ...(grant.retry?{retry:grant.retry,previousAmendment:previousAmendment!}:{}),
      originalVoice: input.originalVoice, selectedVoice: grant.selectedVoice, oldIntent: input.oldIntent, oldRoute: input.oldRoute,
      newRoute: grant.newRoute, requirement: input.requirement, newIntent, quote, revisionHash, recordHash: '', state: 'pending' };
    if (!prior) record.recordHash = recordHash(record); check(record);
    const key = JSON.stringify([scope.tenantId, scope.taskId, scope.runId, scope.planHash, grant.retry?.failedOperationId || input.oldIntent.operationId]);
    return withPaidOperationLock(path.join(root, '.permits', '.locks'), key, async () => {
      await ports.assertQuiescent(); await assertCurrent();
      const ledger = new SocialContentTaskBudget(root, { assertCurrent, authorization: async () => ({ maximumCny: grant.maximumCny, authorizationRef: grant.authorizationRef }),
        quote: async (_scope, operation) => { if (operation.operationId !== newIntent.operationId) return fail('quote_binding_changed'); return quote; }, verifyRejection: async () => false });
      const status = ledger.status(scope), old = status?.entries.find(item => item.operationId === input.oldIntent.operationId);
      if (!status || status.limitCny !== grant.maximumCny || !old || old.runId !== scope.runId || old.planHash !== scope.planHash
        || old.status !== 'reserved' || old.receiptRef !== null || old.fingerprint !== socialPaidIntentOperation(scope, input.oldIntent).fingerprint) return fail('original_not_unsubmitted');
      const claim = path.join(root, '.permits', createHash('sha256').update(JSON.stringify(key)).digest('hex') + '.json');
      if (!grant.retry && fs.existsSync(claim)) return fail('original_claim_exists');
      if(grant.retry){
        const failed=status.entries.find(item=>item.operationId===grant.retry!.failedOperationId);
        if(!failed || !['accepted','unknown'].includes(failed.status) || failed.fingerprint!==socialPaidIntentOperation(scope,previousAmendment!.newIntent).fingerprint || !fs.existsSync(claim))return fail('retry_original_claim_missing');
        const originalClaim=JSON.parse(fs.readFileSync(claim,'utf8'));
        const claimHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
        if(originalClaim.schemaVersion!==1 || originalClaim.submissionHash!==claimHash(originalClaim.submission)
          || claimHash(originalClaim.actualUnits)!==claimHash(originalClaim.submission?.actualUnits)
          || (['operationId','provider','model','accountRef','stage','shotId','inputContractHash'] as const).some(key=>originalClaim.submission?.[key]!==previousAmendment!.newIntent[key])
          || originalClaim.operationId!==failed.operationId || originalClaim.fingerprint!==failed.fingerprint || originalClaim.scopeHash!==createHash('sha256').update(JSON.stringify(scope)).digest('hex')
          || !['accepted','unknown'].includes(originalClaim.status) || originalClaim.submission?.inputContractHash!==previousAmendment!.newIntent.inputContractHash
          || (failed.status==='accepted'&&failed.receiptRef!=='heygen:'+grant.retry.providerTaskId))return fail('retry_original_claim_changed');
      }
      const existing = status.entries.find(item => item.operationId === newIntent.operationId);
      if (record.state === 'active') { if (!existing || existing.fingerprint !== socialPaidIntentOperation(scope, newIntent).fingerprint) return fail('active_reservation_missing'); return record; }
      if (!existing && status.retainedCny + quote.upperBoundCny > status.limitCny) return fail('total_exceeded');
      if (!prior) await ports.writeAmendment(record);
      await ledger.reserveBatch(scope, [socialPaidIntentOperation(scope, newIntent)]);
      await ports.assertQuiescent(); await assertCurrent();
      record = { ...record, state: 'active' }; await ports.writeAmendment(record); return record;
    });
  });
}
