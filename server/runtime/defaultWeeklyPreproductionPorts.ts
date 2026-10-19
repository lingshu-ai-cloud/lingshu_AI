import type {DataStore} from '../storage/datastore.js';
import {createDefaultApprovedDiscoveryRunDependencies} from '../socialDiscovery/service.js';
import type {WeeklyTrustedPreproductionPorts} from './socialWeeklyExecutionRuntime.js';
import {createStoredWeeklyRunKvBindingReader} from './weeklyCandidateCanonicalMedia.js';
import type {WeeklyPreproductionJob} from './weeklyPreproductionProducer.js';
import type {Record_} from '../storage/datastore.js';
import {readCurrentWeeklyAccountCollectionBudget} from '../socialDiscovery/weeklyAccountCollectionBudget.js';
import {readWeeklyAccountCollectionMeteredReservation} from '../socialDiscovery/weeklyAccountCollectionMeteredAuthority.js';
import {createWeeklyAccountCollectionMeteredPermit} from '../socialDiscovery/weeklyAccountCollectionMeteredPermit.js';
import {prepareWeeklyAccountCollectionMeteredWallet} from '../socialDiscovery/weeklyAccountCollectionMeteredWallet.js';
import {createApifyPrepaidOriginalPostJournal,createApifyPrepaidOriginalPostReader} from '../socialDiscovery/apifyPrepaidOriginalPost.js';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {APIFY_PREPAID_TOKEN_FINGERPRINT_SCHEME} from '../socialDiscovery/apifyTokenFingerprint.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {store as routeStore} from '../storage/index.js';
import {fileURLToPath} from 'node:url';
import {getQwenProviderBinding} from '../agents/qwen.js';
import {createWeeklyCandidateExactCanonicalRunner,prepareDeployedWeeklyCandidateExactCanonicalPorts} from './weeklyCandidateExactCanonicalRunner.js';
import {createStoredWeeklyCandidateExactAuditReader,createStoredWeeklyCandidateExactReaders} from './weeklyCandidateExactDeploymentReaders.js';
import {prepareWeeklyCandidateExactProductionEscrowPorts} from './weeklyCandidateExactProductionEscrowPorts.js';
import {createQwenMaaSPublishedTariffReader} from '../lib/socialContentPublishedTariffs.js';
import {qwenVisionInputLimit} from '../lib/qwenVisionInputLimit.js';

/**
 * Single production composition root for weekly preproduction.
 *
 * Paid recovery, Dataset/KV reads and exact analysis are intentionally absent
 * until their existing contracts have a verified permit/runtime binding. This
 * is materially different from omitting all preproduction ports: ordinary
 * approved discovery now uses the real service, while account-only work still
 * stops at the service's own current paid blocker with zero provider network.
 */
const defaults=new WeakMap<object,WeeklyTrustedPreproductionPorts>();
export function createDefaultWeeklyPreproductionPorts(dataStore:DataStore):WeeklyTrustedPreproductionPorts{
 const existing=defaults.get(dataStore as object);if(existing)return existing;
 const metered=async(job:WeeklyPreproductionJob)=>{
  const token=process.env.APIFY_TOKEN?.trim(),ledgerRoot=process.env.WEEKLY_ACCOUNT_COLLECTION_PREPAID_LEDGER_ROOT?.trim();
  if(!token||!ledgerRoot||job.kind!=='discovery'||!job.authority)return null;
  const scopeRow=await dataStore.getById<Record_>('social_discovery_scopes',job.authority.scopeId),accountUrl=String((scopeRow?.payload as {weeklyAccountRevision?:{accountUrl?:unknown}}|undefined)?.weeklyAccountRevision?.accountUrl??'');
  if(!accountUrl)return null;
  const scope={tenantId:job.tenantId,programId:job.programId,packageId:job.packageId,packageVersion:job.packageVersion,scopeId:job.authority.scopeId,scopeVersion:job.authority.scopeVersion,scopeHash:job.authority.scopeHash,accountUrl};
  const authorization=await readCurrentWeeklyAccountCollectionBudget(dataStore,scope),authorityRows=await dataStore.list<Record_>('social_weekly_account_collection_cost_ceilings',{where:{tenant_id:job.tenantId,authorization_id:authorization.authorizationId,job_id:job.jobId},perPage:2}),frozen=(authorityRows.totalItems===1&&authorityRows.items.length===1?authorityRows.items[0]?.payload:null) as {jobRecordHash?:unknown}|null,operation={tenantId:scope.tenantId,programId:scope.programId,packageId:scope.packageId,packageVersion:scope.packageVersion,scopeId:scope.scopeId,scopeVersion:scope.scopeVersion,scopeHash:scope.scopeHash,jobId:job.jobId,jobRecordHash:typeof frozen?.jobRecordHash==='string'?frozen.jobRecordHash:job.recordHash,runOperationId:job.originalRunKey};
  const authority=await readWeeklyAccountCollectionMeteredReservation({store:dataStore,authorization,operation});
  const permit=createWeeklyAccountCollectionMeteredPermit({store:dataStore,authorization,operation,authorityId:authority.authorityId,token});
  let acceptedPost=createApifyPrepaidOriginalPostReader();
  const proxy={read:(request:Parameters<typeof acceptedPost.read>[0])=>acceptedPost.read(request)};
  const wallet=await prepareWeeklyAccountCollectionMeteredWallet({store:dataStore,authorization,operation,authority,token,permit,acceptedPost:proxy});
  return {authorization,wallet,acceptedPost,token,permit,authority,operation,operationJobRecordHash:operation.jobRecordHash};
 };
 const value:WeeklyTrustedPreproductionPorts={discoveryDependencies:createDefaultApprovedDiscoveryRunDependencies(dataStore),
  accountOriginalRecovery:job=>metered(job),accountOriginalStart:async job=>{const value=await metered(job);if(!value)return null;const run=await value.wallet.beginRun(value.operation);const journal=createApifyPrepaidOriginalPostJournal({assertSubmittedUnknown:run.assertOriginalPostClaim});return {...value,acceptedPost:journal,journal};},accountOriginalContinuation:job=>metered(job),accountOriginalDataset:async job=>{
   const value=await metered(job);if(!value)return null;
   const run=await value.wallet.beginRun(value.operation),scope=run.originalPostScope(),post=await value.acceptedPost.read({operationIdentity:scope.operationIdentity,requestHash:scope.requestHash,tokenFingerprint:value.wallet.tokenFingerprint}),refs=(post?.body as {data?:{id?:unknown;defaultDatasetId?:unknown}}|undefined)?.data;
   if(typeof refs?.id!=='string'||typeof refs.defaultDatasetId!=='string')return null;
   const datasetOperation={...value.operation,runId:refs.id,datasetId:refs.defaultDatasetId,pageKey:'0'},datasetBinding=await value.wallet.beginDatasetRead(datasetOperation),datasetScope=datasetBinding.operationScope(),datasetOperationIdentity=datasetScope.operationIdentity,datasetRequestHash=datasetScope.requestHash;
   const journalScope={operationIdentity:datasetOperationIdentity,requestHash:datasetRequestHash,tokenFingerprint:value.wallet.tokenFingerprint,jobId:job.jobId,runId:refs.id,datasetId:refs.defaultDatasetId,pageKey:'0' as const};
   const paidRead={permitsPaidCollection:true as const,tokenFingerprintScheme:APIFY_PREPAID_TOKEN_FINGERPRINT_SCHEME,tokenFingerprint:value.wallet.tokenFingerprint,runId:refs.id,datasetId:refs.defaultDatasetId,assertCurrent:async(kind:'actor_get'|'run_get'|'dataset_get')=>value.permit.assertCurrent({kind,operationIdentity:datasetOperationIdentity,requestHash:datasetRequestHash,tokenFingerprint:value.wallet.tokenFingerprint,actorInputSha256:createHash('sha256').update(JSON.stringify(scope.actorInput)).digest('hex'),runId:refs.id as string,datasetId:refs.defaultDatasetId as string})};
   return {authorization:value.authorization,operationJobRecordHash:value.operation.jobRecordHash,acceptedPost:value.acceptedPost,journalScope,paidRead,walletFactory:(originalGet:import('../socialDiscovery/weeklyAccountCollectionBudget.js').PrepaidOriginalGetPort)=>prepareWeeklyAccountCollectionMeteredWallet({store:dataStore,authorization:value.authorization,operation:value.operation,authority:value.authority,token:value.token,permit:value.permit,acceptedPost:value.acceptedPost,originalGet})};
  },candidatePorts:{
  // Read-only bridge to independently signed mappings already in the store.
  // No KV permit/transport is installed by the default composition.
  canonicalMedia:{bindingForCandidate:createStoredWeeklyRunKvBindingReader(dataStore)},
  exactAnalysisPortsForRun:async(job,run)=>{
   if(dataStore!==routeStore)return null;
   const binding=getQwenProviderBinding(),configurationHash=socialRequestHash({schema:'weekly-candidate-exact-runtime-configuration.v1',endpoint:binding.baseUrl,credentialSha256:binding.credentialSha256,model:'qwen3-vl-plus',inputCnyPerMillion:3,outputCnyPerMillion:30});
   const legacyRoot=process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT?.trim();
   if(legacyRoot){const readers=await createStoredWeeklyCandidateExactReaders({store:dataStore,tenantId:job.tenantId,programId:job.programId,packageId:job.packageId,packageVersion:job.packageVersion,jobId:job.jobId,runId:run.runId});if(readers)return prepareDeployedWeeklyCandidateExactCanonicalPorts({store:routeStore,mediaRoot:fileURLToPath(new URL('../../data/media',import.meta.url)),job,run,configurationHash,authorityReader:readers.authorityReader,auditReader:readers.auditReader});}
   const productionRoot=process.env.SOCIAL_CONTENT_TASK_BUDGET_DIR?.trim(),auditApiKeyId=process.env.WEEKLY_CANDIDATE_EXACT_AUDIT_API_KEY_ID?.trim();
   if(!productionRoot||!path.isAbsolute(productionRoot)||!auditApiKeyId)return null;
   const accountRef=`qwen:${createHash('sha256').update(JSON.stringify({baseUrl:binding.baseUrl.replace(/\/+$/,''),credentialSha256:binding.credentialSha256})).digest('hex')}`;
   const intent={operationId:'weekly-candidate-exact-tariff-proof',provider:'qwen',model:'qwen3-vl-plus',accountRef,stage:'candidate_exact_analysis',shotId:null,inputContractHash:configurationHash,maximumUnits:{inputTokens:qwenVisionInputLimit('qwen3-vl-plus'),outputTokens:16384}};
   const tariff=await createQwenMaaSPublishedTariffReader({readProviderBinding:async()=>({provider:'qwen',model:'qwen3-vl-plus',baseUrl:binding.baseUrl,credentialSha256:binding.credentialSha256})}).read(intent);
   if(!tariff||tariff.meters.inputTokens?.priceCny!==3||tariff.meters.outputTokens?.priceCny!==30)return null;
   const mediaRoot=fileURLToPath(new URL('../../data/media',import.meta.url));
   return prepareWeeklyCandidateExactProductionEscrowPorts({store:routeStore,mediaRoot,ledgerRoot:productionRoot,job,run,configurationHash,provider:{endpoint:binding.baseUrl,credentialSha256:binding.credentialSha256,model:'qwen3-vl-plus',tariffEvidenceHash:socialRequestHash(tariff.publicPricingEvidence),auditApiKeyId},auditReader:createStoredWeeklyCandidateExactAuditReader(routeStore,job.tenantId),runAnalysis:createWeeklyCandidateExactCanonicalRunner({store:routeStore,mediaRoot})});
  },
 }};
 defaults.set(dataStore as object,value);return value;
}
