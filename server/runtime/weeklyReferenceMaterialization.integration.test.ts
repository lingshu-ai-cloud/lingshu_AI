import test from 'node:test';import assert from 'node:assert/strict';
import {prepareWeeklyPlanningProductionFixture} from './weeklyPlanningProduction.fixture.js';
import {createExactShotMaterializationService} from '../lib/referenceExactShotMaterialization.js';
import {buildSocialReferenceReviewHandoff} from '../starter198/socialReferenceReviewHandoff.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {readWeeklyReferenceSources} from './socialWeeklyReferenceSource.js';
test('actual material-readiness extracts source-bound media but cannot clear identity or hook review gaps',async t=>{
 const {f,created,detail,dispatched,actual}=await prepareWeeklyPlanningProductionFixture(t,{ownedReferenceBytes:true});
 assert.equal(actual.lastError?.code,'social_content_execution_director_review_required');const record=f.tables.trend_videos!.find(row=>row.id==='decorative-reference')!;const analysis=JSON.parse(String(record.aiAnalysis));assert.ok(analysis.gemini.scriptDetails15s.every((shot:{materialEvidence?:unknown})=>!shot.materialEvidence),'original catalog analysis is unchanged');assert.equal(f.tables.reference_exact_shot_evidence?.length,1,'normal adapter materializes verified source bytes without approving content');
 const sourceScope={tenantId:'t',recordId:record.id,expectedSourceSha256:String(analysis.contentSha256),expectedAnalysisRunId:String(analysis.analysisRunId),expectedAnalysisHash:socialRequestHash(analysis)};const materializer=createExactShotMaterializationService(f.store);await materializer.materialize(sourceScope);const merged=await materializer.readVerifiedAnalysis(sourceScope);assert.ok(merged);const handoff=buildSocialReferenceReviewHandoff({record:{...record,aiAnalysis:JSON.stringify(merged)}});assert.equal(handoff.productionExecutionAllowed,false);assert.ok(!handoff.issues.some(issue=>issue.code==='shot_media_missing'));assert.ok(handoff.issues.some(issue=>issue.code==='hook_script_incomplete'));assert.ok(handoff.issues.some(issue=>issue.code==='hook_action_unverified'));
 assert.ok(detail);assert.equal(detail.runId,null,'readonly planning and extracted clips do not authorize production');
 assert.ok(actual.lastError?.message.includes('没有证据的字段不能猜测'));
 assert.ok(actual.lastError?.message.includes('不可变版本'));
 assert.ok(actual.lastError?.message.includes('口播文本'));
 assert.ok(!actual.lastError?.message.includes('reference_person_'),'original card exposes an actionable Chinese refusal');
 assert.ok(!actual.lastError?.message.includes('敲门手势'),'unrelated fixed reference motion must not be prescribed');
 const authority=(created.brief as { _weeklyAuthority:unknown})._weeklyAuthority;const references=await readWeeklyReferenceSources(f.store,'t',authority,dispatched.directorAnalyses[0]!);assert.equal(references.length,1);assert.equal(references[0]!.sourceRef,'https://www.tiktok.com/@fixture/video/1');assert.ok(!created.run_id);assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.starter_usage_ledger?.length??0,0);
});
