import type {DataStore} from '../storage/datastore.js';
import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';
import type {WeeklyPreproductionJob} from './weeklyPreproductionProducer.js';
import type {WeeklyPreproductionRetryAttempt} from './weeklyPreproductionRetryAttempts.js';
import {readWeeklyReferenceCandidateAdmissionSnapshot} from './weeklyCandidateAdmissionSnapshot.js';
import {readWeeklyCandidateReferenceAnalysisHandoff} from './weeklyCandidateReferenceAnalysisHandoff.js';
import {readWeeklyPublicationProductSelectionChoices} from '../socialPrograms/weeklyPublicationProductSelection.js';
import {readCandidateContextAssessment} from '../socialDiscovery/candidateContextAssessment.js';
import type {Record_} from '../storage/datastore.js';
import type {WeeklyCandidateExactAnalysisPorts} from './weeklyCandidateExactAnalysisOperation.js';

type Job=WeeklyPreproductionJob|WeeklyPreproductionRetryAttempt;
export interface WeeklyCandidateStoryboardBrief {
 status:'candidate_analysis_only';
 tenantId:string;programId:string;packageId:string;packageVersion:number;jobId:string;runId:string;
 candidateId:string;accountUrl:string;referenceAdmission:'accepted';postAdmission:'pending';
 handoffRef:string;selectedProductId:string;selectedProductName:string;
 rights:{mayAnalyze:true;mayUseOriginalMedia:false;mayAdapt:false;authorizesProduction:false};
 shots:Array<{sequenceIndex:number;referenceStartSeconds:number;referenceEndSeconds:number;referenceObservedFacts:string;referenceVisualObservation:string;targetVisualRequirement:string;targetAssetStatus:'verified_target_asset_required'}>;
}

/** Read-only Content Agent input. These are analytical shot observations and
 * target-asset gaps, never a production DirectorBrief or a media-use grant. */
export async function readWeeklyCandidateStoryboardBriefs(input:{store:DataStore;job:Job;run:SocialInspirationCollectionRun;mediaRoot:string;exactAnalysisPorts?:Pick<WeeklyCandidateExactAnalysisPorts,'readSettledReceipt'>}):Promise<WeeklyCandidateStoryboardBrief[]>{
 const {store,job,run,mediaRoot}=input;
 if(job.kind!=='discovery'||!job.authority||run.discoveryScopeId!==job.authority.scopeId||run.discoveryScopeVersion!==job.authority.scopeVersion)throw Error('weekly_candidate_storyboard_lineage_invalid');
 const selection=await readWeeklyPublicationProductSelectionChoices(store,{tenantId:job.tenantId,programId:job.programId,packageId:job.packageId,packageVersion:job.packageVersion});
 const selectedIds=[...new Set(selection.publications.map(p=>p.selectedProductId))];
 if(selection.selectionState!=='consistent'||selectedIds.length!==1||!selectedIds[0])return [];
 const selected=selection.products.find(p=>p.id===selectedIds[0]);if(!selected)throw Error('weekly_candidate_storyboard_product_changed');
 const admission=await readWeeklyReferenceCandidateAdmissionSnapshot({store,job,run,mediaRoot,exactAnalysisPorts:input.exactAnalysisPorts});
 const output:WeeklyCandidateStoryboardBrief[]=[];
 for(const candidate of admission){
  if(candidate.referenceAdmission!=='accepted')continue;
  // A reference-only projection must not hide a now-production-admitted item
  // behind a weaker status; the formal planning path owns those candidates.
  if(candidate.postAdmission!=='pending')throw Error('weekly_candidate_storyboard_production_boundary_changed');
  const handoff=await readWeeklyCandidateReferenceAnalysisHandoff({store,job,run,candidateId:candidate.candidateId,mediaRoot});
  if(!handoff||candidate.candidateAnalysisHandoffRef!==`${handoff.id}@${handoff.recordHash}`||handoff.status!=='candidate_analysis_only'||handoff.rights.mayUseOriginalMedia!==false||handoff.rights.mayAdapt!==false)throw Error('weekly_candidate_storyboard_handoff_changed');
  const record=await store.getById<Record_>('trend_videos',candidate.candidateId);
  const context=record?await readCandidateContextAssessment(store,job.tenantId,candidate.candidateId,{programId:job.programId,packageId:job.packageId,packageVersion:job.packageVersion},record):null;
  // The authenticated publication selection owns the target SKU. A rival's
  // observed product need not be that SKU, and must not be re-labelled as it.
  if(!context||context.assessmentId!==handoff.contextAssessmentId||context.recordHash!==handoff.contextHash)throw Error('weekly_candidate_storyboard_context_changed');
  output.push({status:'candidate_analysis_only',tenantId:job.tenantId,programId:job.programId,packageId:job.packageId,packageVersion:job.packageVersion,jobId:job.jobId,runId:run.runId,candidateId:candidate.candidateId,accountUrl:handoff.accountUrl,referenceAdmission:'accepted',postAdmission:'pending',handoffRef:candidate.candidateAnalysisHandoffRef,selectedProductId:selected.id,selectedProductName:selected.name,rights:{mayAnalyze:true,mayUseOriginalMedia:false,mayAdapt:false,authorizesProduction:false},shots:handoff.shots.map((shot,index)=>({sequenceIndex:index+1,referenceStartSeconds:shot.startSeconds,referenceEndSeconds:shot.endSeconds,referenceObservedFacts:shot.observedFacts,referenceVisualObservation:shot.visual,targetVisualRequirement:`需要 ${selected.name} 的已核验目标素材；不得复用参考视频原画面、人物、声音或台词`,targetAssetStatus:'verified_target_asset_required'}))});
 }
 return output;
}
