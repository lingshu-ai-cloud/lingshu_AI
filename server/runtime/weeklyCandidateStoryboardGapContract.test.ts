import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseFiveCandidateStoryboardGaps} from './weeklyCandidateStoryboardGapContract.js';
import type {WeeklyCandidateStoryboardBrief} from './weeklyCandidateStoryboardBrief.js';

const brief=(index:number):WeeklyCandidateStoryboardBrief=>({status:'candidate_analysis_only',tenantId:'tenant',programId:'program',packageId:'package',packageVersion:7,
  jobId:'job',runId:index===5?'retry-run':'root-run',candidateId:`video-${index}`,accountUrl:'https://www.tiktok.com/@factory',referenceAdmission:'accepted',postAdmission:'pending',
  handoffRef:`handoff-${index}@hash`,selectedProductId:'cleanser',selectedProductName:'云朵泡沫卸妆蜜',
  rights:{mayAnalyze:true,mayUseOriginalMedia:false,mayAdapt:false,authorizesProduction:false},
  shots:[{sequenceIndex:1,referenceStartSeconds:0,referenceEndSeconds:3,referenceObservedFacts:'参考观察',referenceVisualObservation:'画面观察',targetVisualRequirement:'需要已核验目标素材',targetAssetStatus:'verified_target_asset_required'}]});

test('five different reference observations produce intervention gaps, never production assets',()=>{
  const briefs=[1,2,3,4,5].map(brief);
  const classifications=briefs.map((item,index)=>({candidateId:item.candidateId,sequenceIndex:1,
    handoffRef:item.handoffRef,referenceStartSeconds:0,referenceEndSeconds:3,
    materialType:(index===0?'talking_head':index===1?'factory':'product') as 'talking_head'|'factory'|'product',motionObserved:index>1}));
  const result=diagnoseFiveCandidateStoryboardGaps({briefs,classifications});
  assert.equal(result.authorizesProduction,false);
  assert.equal(result.references.length,5);
  assert.equal(result.references[0]?.shots[0]?.requirement,'presenter_temporal_and_voice_evidence_required');
  assert.equal(result.references[1]?.shots[0]?.requirement,'verified_owned_factory_video_required');
  assert.equal(result.references[2]?.shots[0]?.requirement,'verified_same_product_video_required');
  assert.deepEqual([result.references[2]?.shots[0]?.referenceStartSeconds,result.references[2]?.shots[0]?.referenceEndSeconds],[0,3]);
  assert.equal(result.references[4]?.runId,'retry-run');
  assert.equal(result.accountUrl,'https://www.tiktok.com/@factory');
  assert.equal(JSON.stringify(result).includes('clipRef'),false);
});

test('duplicate references, product drift, production claims and partial shot classification fail closed',()=>{
  const briefs=[1,2,3,4,5].map(brief);
  const classifications=briefs.map(item=>({candidateId:item.candidateId,sequenceIndex:1,handoffRef:item.handoffRef,
    referenceStartSeconds:0,referenceEndSeconds:3,materialType:'product' as const,motionObserved:false}));
  assert.throws(()=>diagnoseFiveCandidateStoryboardGaps({briefs:[...briefs.slice(0,4),briefs[0]!],classifications}),/five_distinct/);
  assert.throws(()=>diagnoseFiveCandidateStoryboardGaps({briefs:[...briefs.slice(0,4),{...briefs[4]!,selectedProductId:'perfume'}],classifications}),/scope_or_rights/);
  assert.throws(()=>diagnoseFiveCandidateStoryboardGaps({briefs:[...briefs.slice(0,4),{...briefs[4]!,accountUrl:'https://www.tiktok.com/@another'}],classifications}),/scope_or_rights/);
  assert.throws(()=>diagnoseFiveCandidateStoryboardGaps({briefs:[...briefs.slice(0,4),{...briefs[4]!,rights:{...briefs[4]!.rights,authorizesProduction:true} as unknown as WeeklyCandidateStoryboardBrief['rights']}],classifications}),/scope_or_rights/);
  assert.throws(()=>diagnoseFiveCandidateStoryboardGaps({briefs,classifications:classifications.slice(0,4)}),/classification_incomplete/);
  assert.throws(()=>diagnoseFiveCandidateStoryboardGaps({briefs,classifications:classifications.map((row,index)=>index===0?{...row,handoffRef:'stale-handoff@hash'}:row)}),/classification_invalid/);
  assert.throws(()=>diagnoseFiveCandidateStoryboardGaps({briefs,classifications:classifications.map((row,index)=>index===0?{...row,referenceEndSeconds:2}:row)}),/classification_invalid/);
  assert.throws(()=>diagnoseFiveCandidateStoryboardGaps({briefs:[{...briefs[0]!,shots:[{...briefs[0]!.shots[0]!,referenceEndSeconds:0}]},...briefs.slice(1)],classifications}),/reference_windows_invalid/);
});

test('unproven stillness never downgrades a product reference to a target image',()=>{
 const briefs=[1,2,3,4,5].map(brief);
 const classifications=briefs.map(item=>({candidateId:item.candidateId,sequenceIndex:1,handoffRef:item.handoffRef,
  referenceStartSeconds:0,referenceEndSeconds:3,materialType:'product' as const,motionObserved:false,
  motionStatus:'unknown' as const,classificationSourceHash:'a'.repeat(64)}));
 const result=diagnoseFiveCandidateStoryboardGaps({briefs,classifications});
 assert(result.references.every(ref=>ref.shots[0]?.requirement==='verified_same_product_video_required'));
 assert(result.references.every(ref=>ref.shots[0]?.motionStatus==='unknown'));
 assert.equal(result.authorizesProduction,false);
});
