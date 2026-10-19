import test from 'node:test';
import {SocialProgramError} from '../socialPrograms/service.js';
import assert from 'node:assert/strict';
import { assertNoFrozenTechnicalFailure,assertWeeklyQualityRunLineage } from './weeklyContentQualityAudit.js';
test('original film G4/G5 quality run must be the same frozen producer run',()=>{
 const original={workflowSchema:'social-content.auto-production.v3',productionWorkspaceSource:{runId:'original-run'}};
 assert.doesNotThrow(()=>assertWeeklyQualityRunLineage(original,'original-run','original-run'));
 for(const [source,quality] of [['original-run','other-run'],['other-run','original-run']])
  assert.throws(()=>assertWeeklyQualityRunLineage(original,source,quality),(error:unknown)=>error instanceof SocialProgramError&&error.code==='weekly_quality_audit_run_lineage_changed');
 assert.throws(()=>assertWeeklyQualityRunLineage({workflowSchema:'social-content.auto-production.v3'},'original-run','original-run'),(error:unknown)=>error instanceof SocialProgramError&&error.code==='weekly_quality_audit_run_lineage_changed');
 const child={...original,sceneRework:{operationId:'bounded-child'},productionWorkspaceSource:{runId:'child-run'}};
 assert.doesNotThrow(()=>assertWeeklyQualityRunLineage(child,'original-run','child-run'),'explicit scene-rework child retains separate verified lineage');
 assert.throws(()=>assertWeeklyQualityRunLineage(child,'original-run','third-run'),(error:unknown)=>error instanceof SocialProgramError&&error.code==='weekly_quality_audit_run_lineage_changed');
});
test('immutable pending summaries do not themselves represent an actual detector failure or passing proof',()=>{assert.doesNotThrow(()=>assertNoFrozenTechnicalFailure({productionResult:{technicalReview:{approved:false,failures:['字幕与敏感信息仍待独立核验']}},render:{completed:true,qualityPassed:false}}));});
test('current graph film cannot use later G4/G5 receipts to replace a missing measured initial report',()=>{
 assert.throws(()=>assertNoFrozenTechnicalFailure({workflowSchema:'social-content.auto-production.v3',productionResult:{technicalReview:{approved:true},creativeReview:{approved:true}}}),(error:unknown)=>error instanceof SocialProgramError&&error.code==='weekly_quality_audit_detector_report_unverified');
 assert.doesNotThrow(()=>assertNoFrozenTechnicalFailure({workflowSchema:'social-content.auto-production.v2'}),'legacy historical reads retain their original contract');
});
test('frozen visual, audio, scene or explicit detector failures require actual repair',()=>{for(const report of [{visual:{passed:false},audio:{ok:true},scenes:{passed:true,issues:[]}},{visual:{passed:true},audio:{ok:false},scenes:{passed:true,issues:[]}},{visual:{passed:true},audio:{ok:true},scenes:{passed:false,issues:[]}},{visual:{passed:true},audio:{ok:true},scenes:{passed:true,issues:[{sceneIndex:0,code:'black_scene'}]}},{visual:{passed:true,failures:['wrong duration']},audio:{ok:true},scenes:{passed:true,issues:[]}}])assert.throws(()=>assertNoFrozenTechnicalFailure({technicalQualityReport:{schemaVersion:'initial-scene-quality.v1',...report}}),(error:unknown)=>error instanceof SocialProgramError&&error.code==='weekly_quality_audit_actual_repair_required');});

test('unrecognized stored detector report cannot hide an actual failure behind an unknown schema',()=>{assert.throws(()=>assertNoFrozenTechnicalFailure({technicalQualityReport:{schemaVersion:'unrecognized',visual:{passed:false}}}),(error:unknown)=>error instanceof SocialProgramError&&error.code==='weekly_quality_audit_detector_report_unverified');});
import {inventoryFixture} from '../socialPrograms/weeklyInventoryReuse.fixture.js';
import {productionFromArtifact,productionFromApprovedWeeklyArtifact} from '../publishing/weeklyPublicationWorker.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
test('pending immutable flags cannot be converted into a publishable inventory source without actual final user approval',async()=>{const f=await inventoryFixture();try{const artifact=f.tables.starter_social_content_artifacts![0]!;const content=artifact.content as Record<string,unknown>;const production=content.productionResult as Record<string,unknown>;content.productionResult={...production,technicalReview:{approved:false,checkedScenes:2,failures:['尚待真实独立审核']},creativeReview:{approved:false,failedCriteria:['尚待G5']}};artifact.content_hash=socialRequestHash({resourceRef:artifact.resource_ref,content});f.tables.social_weekly_execution_tasks=[];const actual={id:artifact.id,tenant_id:String(artifact.tenant_id),task_id:String(artifact.task_id),artifact_id:String(artifact.artifact_id),version:String(artifact.version),status:String(artifact.status),content_hash:String(artifact.content_hash),resource_ref:String(artifact.resource_ref),content};assert.throws(()=>productionFromArtifact(actual,f.lineage,f.source),/production_result_not_publishable/);await assert.rejects(productionFromApprovedWeeklyArtifact(f.store,actual,f.lineage,f.source),/production_result_final_user_approval_required/);}finally{await f.cleanup();}});

const completeDetectorReport={schemaVersion:'initial-scene-quality.v1',visual:{passed:true,failures:[]},audio:{ok:true,error:null},scenes:{passed:true,issues:[],checkedScenes:2}};
test('complete detector reports remain eligible for independent G4 and G5 review',()=>{assert.doesNotThrow(()=>assertNoFrozenTechnicalFailure({technicalQualityReport:completeDetectorReport}));});
test('weekly quality refuses measured final-film defects but does not call missing proof a measured defect',()=>{
 const report={...completeDetectorReport,mediaHardProbe:{version:'scene-media-hard-probe.v1',scenes:[],finalPrivacyCoverage:{schemaVersion:'final-privacy-coverage.v1',status:'unknown',failureCode:'frame_count_mismatch'}}};
 assert.throws(()=>assertNoFrozenTechnicalFailure({technicalQualityReport:report}),(error:unknown)=>(error as {code?:string}).code==='weekly_quality_audit_actual_repair_required');
 assert.doesNotThrow(()=>assertNoFrozenTechnicalFailure({technicalQualityReport:{...report,mediaHardProbe:{...report.mediaHardProbe,finalPrivacyCoverage:{schemaVersion:'final-privacy-coverage.v1',status:'unknown'}}}}));
});
test('frozen caption and measured speech mismatch cannot be overridden by later quality approval',()=>{
 const report={...completeDetectorReport,mediaHardProbe:{version:'scene-media-hard-probe.v1',captionSpeechAlignment:{status:'mismatch',mismatchIndexes:[1]}}};
 assert.throws(()=>assertNoFrozenTechnicalFailure({technicalQualityReport:report}),(error:unknown)=>error instanceof SocialProgramError&&error.code==='weekly_quality_audit_actual_repair_required');
});
test('frozen caption and actual simple ASS event mismatch cannot be overridden by later quality approval',()=>{
 const report={...completeDetectorReport,mediaHardProbe:{version:'scene-media-hard-probe.v1',captionMaskAudit:{status:'unknown',plainCueBinding:{status:'mismatch',reason:'wrong ASS cue'}}}};
 assert.throws(()=>assertNoFrozenTechnicalFailure({technicalQualityReport:report}),(error:unknown)=>error instanceof SocialProgramError&&error.code==='weekly_quality_audit_actual_repair_required');
});
test('weekly quality independently rejects explicit media and privacy failures even if summary fields are green',()=>{
 const probes=[
  {formatPassed:false},
  {sensitiveFrozenSpeechEvidence:{status:'hit'}},
  {scenes:[{durationPassed:false}]},
  {scenes:[{audioWindowDecoded:false}]},
  {scenes:[{audioIdentity:{status:'failed'}}]},
  {fullFrozenAudioIdentity:{status:'failed',failedWindowIndexes:[1]}},
  {mediaSha256:'a'.repeat(64),finalSensitiveFrameAudit:{schemaVersion:'final-sensitive-frame-audit.v1',status:'hit',mediaSha256:'a'.repeat(64)}},
  {scenes:[{sensitiveScreenEvidence:{status:'hit'}}]},
 ];
 for(const probe of probes){
  const report={...completeDetectorReport,mediaHardProbe:{version:'scene-media-hard-probe.v1',...probe}};
  assert.throws(()=>assertNoFrozenTechnicalFailure({technicalQualityReport:report}),(error:unknown)=>error instanceof SocialProgramError&&error.code==='weekly_quality_audit_actual_repair_required');
 }
});
test('truncated or unknown detector results fail closed instead of inheriting human approval',()=>{
 const reports=[{schemaVersion:'initial-scene-quality.v1'}, {...completeDetectorReport,visual:{}}, {...completeDetectorReport,audio:{ok:true,error:'decoder unresolved'}}, {...completeDetectorReport,audio:{ok:true}}, {...completeDetectorReport,scenes:{passed:true,issues:[],checkedScenes:0}}, {...completeDetectorReport,scenes:{passed:true,issues:[],checkedScenes:1.5}}, {...completeDetectorReport,scenes:{passed:true,checkedScenes:2}}, {...completeDetectorReport,visual:{passed:true}}, {...completeDetectorReport,visual:{passed:'true',failures:[]}}];
 for(const report of reports)assert.throws(()=>assertNoFrozenTechnicalFailure({technicalQualityReport:report}),(error:unknown)=>error instanceof SocialProgramError&&error.code==='weekly_quality_audit_detector_report_unverified');
});
