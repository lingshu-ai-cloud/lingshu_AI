import type {WeeklyCandidateStoryboardBrief} from './weeklyCandidateStoryboardBrief.js';
import type {DataStore,Record_} from '../storage/datastore.js';
import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';
import type {WeeklyPreproductionJob} from './weeklyPreproductionProducer.js';
import type {WeeklyPreproductionRetryAttempt} from './weeklyPreproductionRetryAttempts.js';
import {readWeeklyCandidateStoryboardBriefs} from './weeklyCandidateStoryboardBrief.js';
import {readWeeklyCandidateReferenceAnalysisHandoff} from './weeklyCandidateReferenceAnalysisHandoff.js';
import {readCandidateContextAssessment} from '../socialDiscovery/candidateContextAssessment.js';
import {socialJson,socialObject,socialRequestHash} from '../starter198/socialContentValidation.js';

export type WeeklyStoryboardObservedMaterial = 'talking_head' | 'product' | 'factory' | 'consumer_demo';
export interface WeeklyStoryboardShotClassification {
  candidateId:string;
  sequenceIndex:number;
  /** Bind the classifier's answer to the exact analytical handoff and shot
   * window it inspected. This is not a production-rights receipt. */
  handoffRef:string;
  referenceStartSeconds:number;
  referenceEndSeconds:number;
  materialType:WeeklyStoryboardObservedMaterial;
  motionObserved:boolean;
  /** Unknown is conservative: a product still image cannot stand in for an
   * unverified moving reference shot. Legacy caller booleans remain diagnostic
   * only and never confer production permission. */
  motionStatus?:'observed'|'verified_static'|'unknown';
  classificationSourceHash?:string;
}

/** An intervention projection, not a target-media match or production permit.
 * The original reference's images, clips, people and voices remain excluded. */
export function diagnoseFiveCandidateStoryboardGaps(input:{
  briefs:readonly WeeklyCandidateStoryboardBrief[];
  classifications:readonly WeeklyStoryboardShotClassification[];
}){
  const {briefs,classifications}=input;
  if(briefs.length!==5||new Set(briefs.map(item=>item.candidateId)).size!==5)
    throw Error('weekly_storyboard_five_distinct_references_required');
  const first=briefs[0]!;
  if(!first.selectedProductId||!first.selectedProductName||!first.accountUrl||briefs.some(item=>
    item.status!=='candidate_analysis_only'||item.referenceAdmission!=='accepted'||item.postAdmission!=='pending'
    ||item.rights.authorizesProduction!==false||item.rights.mayUseOriginalMedia!==false||item.rights.mayAdapt!==false
    ||item.tenantId!==first.tenantId||item.programId!==first.programId||item.packageId!==first.packageId
    ||item.packageVersion!==first.packageVersion||item.accountUrl!==first.accountUrl||item.selectedProductId!==first.selectedProductId
    ||item.selectedProductName!==first.selectedProductName||!item.handoffRef||!item.shots.length))
    throw Error('weekly_storyboard_candidate_scope_or_rights_invalid');
  const expected=new Map<string,{handoffRef:string;start:number;end:number}>(briefs.flatMap(item=>item.shots.map(shot=>[
    `${item.candidateId}:${shot.sequenceIndex}`,
    {handoffRef:item.handoffRef,start:shot.referenceStartSeconds,end:shot.referenceEndSeconds},
  ] as const)));
  if(expected.size!==briefs.reduce((count,item)=>count+item.shots.length,0)
    ||briefs.some(item=>item.shots.some((shot,index)=>shot.sequenceIndex!==index+1
      ||!Number.isFinite(shot.referenceStartSeconds)||!Number.isFinite(shot.referenceEndSeconds)
      ||shot.referenceStartSeconds<0||shot.referenceEndSeconds<=shot.referenceStartSeconds
      ||index>0&&shot.referenceStartSeconds<item.shots[index-1]!.referenceEndSeconds)))
    throw Error('weekly_storyboard_reference_windows_invalid');
  const classified=new Map<string,WeeklyStoryboardShotClassification>();
  for(const row of classifications){
    const key=`${row.candidateId}:${row.sequenceIndex}`;
    const source=expected.get(key);
    if(!source||classified.has(key)||row.handoffRef!==source.handoffRef
      ||row.referenceStartSeconds!==source.start||row.referenceEndSeconds!==source.end
      ||!['talking_head','product','factory','consumer_demo'].includes(row.materialType)
      ||typeof row.motionObserved!=='boolean'||(row.motionStatus!==undefined&&!['observed','verified_static','unknown'].includes(row.motionStatus)))throw Error('weekly_storyboard_shot_classification_invalid');
    classified.set(key,row);
  }
  if(classified.size!==expected.size)throw Error('weekly_storyboard_shot_classification_incomplete');
  return {
    status:'intervention_required' as const,
    accountUrl:first.accountUrl,
    selectedProductId:first.selectedProductId,
    selectedProductName:first.selectedProductName,
    authorizesProduction:false as const,
    references:briefs.map(brief=>({candidateId:brief.candidateId,runId:brief.runId,handoffRef:brief.handoffRef,
      shots:brief.shots.map(shot=>{
        const classification=classified.get(`${brief.candidateId}:${shot.sequenceIndex}`)!;
        const requirement=classification.materialType==='talking_head'
          ?'presenter_temporal_and_voice_evidence_required'
          :classification.materialType==='factory'
            ?'verified_owned_factory_video_required'
            :(classification.motionStatus?classification.motionStatus!=='verified_static':classification.motionObserved)||classification.materialType==='consumer_demo'
              ?'verified_same_product_video_required'
              :'verified_same_product_image_required';
        return {sequenceIndex:shot.sequenceIndex,referenceStartSeconds:shot.referenceStartSeconds,
          referenceEndSeconds:shot.referenceEndSeconds,referenceObservedFacts:shot.referenceObservedFacts,
          referenceVisualObservation:shot.referenceVisualObservation,selectedProductId:brief.selectedProductId,
          requirement,motionStatus:classification.motionStatus??(classification.motionObserved?'observed':'unverified_legacy'),
          classificationSourceHash:classification.classificationSourceHash??null,
          matchStatus:'unverified' as const,mayUseReferenceMedia:false as const};
      })})),
  };
}

type Source=Parameters<typeof readWeeklyCandidateStoryboardBriefs>[0];
const obj=(value:unknown)=>socialObject(socialJson(value))??{};

/** Read the accepted candidate's *original exact* classification, rather than
 * trusting an API caller's material labels. This remains a candidate-only
 * diagnostic: source rights explicitly prohibit production or adaptation. */
export async function readVerifiedFiveCandidateStoryboardGaps(sources:readonly Source[]){
 if(!sources.length)throw Error('weekly_storyboard_sources_required');
 const briefs:WeeklyCandidateStoryboardBrief[]=[];
 const classifications:WeeklyStoryboardShotClassification[]=[];
 for(const source of sources){
  const sourceBriefs=await readWeeklyCandidateStoryboardBriefs(source);
  for(const brief of sourceBriefs){
   const handoff=await readWeeklyCandidateReferenceAnalysisHandoff({...source,candidateId:brief.candidateId});
   if(!handoff||brief.handoffRef!==`${handoff.id}@${handoff.recordHash}`||brief.jobId!==source.job.jobId||brief.runId!==source.run.runId||brief.accountUrl!==handoff.accountUrl||handoff.shots.length!==brief.shots.length)throw Error('weekly_storyboard_verified_handoff_changed');
   const record=await source.store.getById<Record_>('trend_videos',brief.candidateId);
   const context=record?await readCandidateContextAssessment(source.store,brief.tenantId,brief.candidateId,{programId:brief.programId,packageId:brief.packageId,packageVersion:brief.packageVersion},record):null;
   const analysis=obj(record?.aiAnalysis),gemini=obj(analysis.gemini),details=Array.isArray(gemini.scriptDetails15s)?gemini.scriptDetails15s.map(obj):[];
   if(!context||context.recordHash!==handoff.contextHash||socialRequestHash(analysis)!==handoff.analysisHash||details.length!==brief.shots.length||context.observations.length!==brief.shots.length)throw Error('weekly_storyboard_verified_analysis_changed');
   for(const [index,shot] of brief.shots.entries()){
    const original=handoff.shots[index]!,observation=context.observations[index]!,detail=details[index]!;
    const materialType=String(detail.materialType??''),classificationEvidence=String(detail.classificationEvidence??'').trim();
    if(!['talking_head','product','factory','consumer_demo'].includes(materialType)||!classificationEvidence||detail.needsReview===true
      ||observation.shotIndex!==index+1||observation.materialType!==materialType||observation.visual!==detail.visual||observation.observedFacts!==detail.observedFacts
      ||shot.sequenceIndex!==index+1||shot.referenceStartSeconds!==original.startSeconds||shot.referenceEndSeconds!==original.endSeconds
      ||shot.referenceObservedFacts!==observation.observedFacts||shot.referenceVisualObservation!==observation.visual)
      throw Error('weekly_storyboard_verified_classification_missing');
    // The old exact schema has no certified stillness observation. A prose
    // description or absence of motion words is not proof of a static shot.
    const motionStatus='unknown' as const;
    classifications.push({candidateId:brief.candidateId,sequenceIndex:shot.sequenceIndex,handoffRef:brief.handoffRef,
      referenceStartSeconds:shot.referenceStartSeconds,referenceEndSeconds:shot.referenceEndSeconds,
      materialType:materialType as WeeklyStoryboardObservedMaterial,motionObserved:false,motionStatus,
      classificationSourceHash:socialRequestHash({analysisHash:handoff.analysisHash,contextHash:handoff.contextHash,
        sourceSha256:handoff.sourceSha256,shotIndex:original.shotIndex,startSeconds:original.startSeconds,
        endSeconds:original.endSeconds,materialType,classificationEvidence})});
   }
   briefs.push(brief);
  }
 }
 return diagnoseFiveCandidateStoryboardGaps({briefs,classifications});
}
