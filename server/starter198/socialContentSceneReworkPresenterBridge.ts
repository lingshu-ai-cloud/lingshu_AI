import type {Starter198Repository} from './repository.js';
import type {ContentExecutionJob} from '../contentExecution/durableQueue.js';
import type {StoredSocialSceneCache} from './socialContentSceneReworkService.js';
import type {SocialSceneReworkIntent} from './socialContentSceneRework.js';
import type {SceneReworkCostPolicy} from './socialContentSceneReworkCostPolicy.js';
import type {reserveSceneReworkFilmBudget} from './socialContentSceneReworkFilmBudget.js';
import {createSocialContentPaidOperationPermit} from '../lib/socialContentPaidOperationPermit.js';
import {createWholeTrackSocialHeyGenBridge} from './socialContentWholeTrackHeyGenBridge.js';
import {assertLiveHeyGenBinding} from './socialContentHeyGenRuntimeBinding.js';
import {readSceneReworkPresenterAudio} from './socialContentSceneReworkPresenter.js';
import {verifyStoredSceneReworkMeasuredVoice} from './socialContentSceneReworkMeasuredVoice.js';

/** Adapter only: paid video uses the existing canonical permit and original
 * film ledger. Original speech is verified and sliced, never synthesized. */
export function createSceneReworkPresenterBridge(input:{repository:Starter198Repository;job:ContentExecutionJob;
 actual:StoredSocialSceneCache & {intent:SocialSceneReworkIntent};policy:SceneReworkCostPolicy;
 budget:Awaited<ReturnType<typeof reserveSceneReworkFilmBudget>>;assertCurrent:()=>Promise<void>;
 /** Existing bridge ports are injectable for isolated byte-level tests. */
 bridgeOptions?:Pick<Parameters<typeof createWholeTrackSocialHeyGenBridge>[0],'dependencies'|'transport'|'root'>}){
 const {policy,budget,actual,repository}=input,store=repository.dataStore;
 if(!store||policy.quote.provider!=='heygen'||policy.quote.presenterPlan.operations.length<1
  ||!actual.cache.measuredVoiceProof)throw Error('scene_rework_presenter_funding_missing');
 const plan=policy.quote.presenterPlan,proof=actual.cache.measuredVoiceProof;
 if(plan.operations.length!==budget.operations.length||plan.operations.some(row=>!budget.operations.some(operation=>operation.operationId===row.intent.operationId)))throw Error('scene_rework_presenter_operation_changed');
 const permit=createSocialContentPaidOperationPermit({scope:budget.scope,operations:budget.operations,intents:plan.operations.map(row=>row.intent),
  ledger:budget.ledger,assertCurrent:input.assertCurrent});
 const bridge=createWholeTrackSocialHeyGenBridge({...input.bridgeOptions,funding:{scope:budget.scope,requirements:plan.operations.map(row=>row.requirement),
  routeBindings:Object.fromEntries(plan.operations.map(row=>[row.requirement.key,row.route])),intents:plan.operations.map(row=>row.intent),permit,
  readReservedCny(operationId){const entries=budget.ledger.status(budget.scope)?.entries.filter(entry=>entry.operationId===operationId);
   if(entries?.length!==1)throw Error('scene_rework_presenter_reservation_missing');return entries[0]!.reservedMicros/1e6;},
  assertCurrent:input.assertCurrent,
  async assertNewSubmit(){await input.assertCurrent();if(plan.operations.some(row=>Date.parse(row.quote.validUntil)<=Date.now()))throw Error('scene_rework_presenter_quote_expired');},
  async assertLivePresenter(route,request,credentialSha256){
   const row=plan.operations.find(row=>row.requirement.shotId===request.shotId);
   if(!row||route.accountRef!==row.route.accountRef||credentialSha256!==row.binding.credentialSha256
    ||request.presenter.presenterAssetId!==row.binding.presenterAssetId||request.presenter.assetVersion!==row.binding.assetVersion
    ||request.presenter.providerPresenterId!==row.binding.avatarId||request.presenter.providerVoiceId!==row.binding.voiceId)
    throw Error('scene_rework_presenter_live_identity_changed');
   await assertLiveHeyGenBinding(row.binding,{store,assertCurrent:input.assertCurrent});
  }},prepared:proof.prepared,sourceVoiceScope:proof.scope,
  assertSourceVoice:async()=>{await verifyStoredSceneReworkMeasuredVoice(repository,actual.cache);},
  taskVersion:String(actual.baseline.version),apiKey:process.env.HEYGEN_API_KEY?.trim()??'',store});
 return {...bridge,async resolveSpeechAudio(request:Parameters<NonNullable<typeof bridge.resolveSpeechAudio>>[0]){
  await readSceneReworkPresenterAudio({repository,actual,shotId:request.shotId,assertCurrent:input.assertCurrent});
  return bridge.resolveSpeechAudio!(request);
 }};
}
