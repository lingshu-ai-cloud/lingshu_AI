import type {DataStore,Record_} from '../storage/datastore.js';
import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';
import type {WeeklyPreproductionJob} from './weeklyPreproductionProducer.js';
import type {WeeklyPreproductionRetryAttempt} from './weeklyPreproductionRetryAttempts.js';
import {verifiedWeeklyCandidateCanonicalMedia,weeklyCandidateExactAnalysisOperationId,type WeeklyCandidateExactAnalysisPorts} from './weeklyCandidateExactAnalysisOperation.js';
import {prepareWeeklyCandidateExactProductionEscrow} from './weeklyCandidateExactProductionEscrow.js';
import {withWeeklyCandidateDynamicExactPaidScope} from './weeklyCandidateExactPaidRequests.js';
import {readWeeklyCandidateExactConservativeSettlement,type WeeklyCandidateExactAuditReader} from './weeklyCandidateExactConservativeSettlement.js';

type Job=WeeklyPreproductionJob|WeeklyPreproductionRetryAttempt;
type AnalysisInput={job:Job;run:SocialInspirationCollectionRun;record:Record_;operationId:string};

/**
 * Uses the accepted weekly production budget as the authorization parent while
 * retaining the existing exact-analysis claim, paid request journal and
 * independent platform-audit settlement. It never treats a user confirmation
 * as supplier evidence and never grants publishing or acceptance.
 */
export async function prepareWeeklyCandidateExactProductionEscrowPorts(input:{
 store:DataStore;mediaRoot:string;ledgerRoot:string;job:Job;run:SocialInspirationCollectionRun;configurationHash:string;
 provider:{endpoint:string;credentialSha256:string;model:'qwen3-vl-plus';tariffEvidenceHash:string;auditApiKeyId:string};
 auditReader:WeeklyCandidateExactAuditReader;runAnalysis:(input:AnalysisInput)=>Promise<void>;
}):Promise<WeeklyCandidateExactAnalysisPorts>{
 const ids=[...new Set(Object.values(input.run.evidenceOutcomes??{}).flatMap(outcome=>[
  ...(outcome?.acceptedCandidateIds??[]),...(outcome?.suggestionCandidateIds??[]),...(outcome?.failedCandidateIds??[]),
 ]))];
 if(ids.length!==5)throw Error('weekly_candidate_exact_production_escrow_five_candidates_required');
 const candidates=[] as Array<{candidateId:string;mediaSha256:string;operationId:string}>;
 for(const candidateId of ids){const record=await input.store.getById<Record_>('trend_videos',candidateId);if(!record||record.tenantId!==input.job.tenantId)throw Error('weekly_candidate_exact_production_escrow_candidate_changed');const canonical=await verifiedWeeklyCandidateCanonicalMedia(record,input.mediaRoot);if(!canonical)throw Error('weekly_candidate_exact_production_escrow_canonical_required');candidates.push({candidateId,mediaSha256:canonical.sha256,operationId:weeklyCandidateExactAnalysisOperationId(input.job,input.run,record,canonical.sha256)});}
 const handle=await prepareWeeklyCandidateExactProductionEscrow({store:input.store,job:input.job,run:input.run,root:input.ledgerRoot,provider:input.provider,candidates});
 const plans=new Map<string,{authorizationId:string;authorizationHash:string;maximumRequests:number;maximumCny:number}>();
 const plan=(candidateId:string,mediaSha256:string,operationId:string)=>({operationId,candidateId,mediaSha256,endpoint:input.provider.endpoint,credentialSha256:input.provider.credentialSha256,model:input.provider.model,maximumRequests:handle.escrow.maximumRequestsPerCandidate,maximumTotalCny:handle.escrow.maximumCnyPerCandidate});
 return{
  authorize:async({job,run,record,mediaSha256,operationId})=>{if(job.jobId!==input.job.jobId||run.runId!==input.run.runId)throw Error('weekly_candidate_exact_production_escrow_scope_changed');const reservation=await handle.reserve(record.id,mediaSha256,operationId);plans.set(operationId,reservation);return{authorizationId:reservation.authorizationId,authorizationHash:reservation.authorizationHash};},
  execute:async({job,run,record,mediaSha256,operationId,authorizationId,authorizationHash})=>{const reservation=plans.get(operationId);if(job.jobId!==input.job.jobId||run.runId!==input.run.runId||!reservation||reservation.authorizationId!==authorizationId||reservation.authorizationHash!==authorizationHash)throw Error('weekly_candidate_exact_production_escrow_fresh_reservation_required');await withWeeklyCandidateDynamicExactPaidScope({root:input.ledgerRoot,authorizationHash,plan:plan(record.id,mediaSha256,operationId),configurationHash:input.configurationHash,assertCurrent:handle.assertCurrent,run:()=>input.runAnalysis({job,run,record,operationId})});},
  readSettledReceipt:async({operationId,authorizationId,authorizationHash,mediaSha256,candidateId})=>{if(authorizationId!==handle.escrow.escrowId||authorizationHash!==handle.escrow.recordHash||!handle.escrow.candidates.some(candidate=>candidate.operationId===operationId&&candidate.candidateId===candidateId&&candidate.mediaSha256===mediaSha256))throw Error('weekly_candidate_exact_production_escrow_authorization_changed');return readWeeklyCandidateExactConservativeSettlement({root:input.ledgerRoot,authorizationId,authorizationHash,plan:plan(candidateId,mediaSha256,operationId),auditApiKeyId:input.provider.auditApiKeyId,assertCurrent:handle.assertCurrent,reader:input.auditReader});},
 };
}
