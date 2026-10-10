import assert from 'node:assert/strict';
import test from 'node:test';
import type { WeeklyDirectorPlanningAnalysis, WeeklyReferenceSourcePolicy } from '../../shared/contracts/socialProgram.js';
import type { SocialInspirationHandoff } from '../../shared/contracts/socialContentWorkflow.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
import { diagnoseOwnedReference, ownedDiagnosisReady } from './ownedReferenceDiagnosis.js';
const policy: WeeklyReferenceSourcePolicy = { profile: 'b2b_established', ownedPercent: 40, externalPercent: 60, allocationUnit: 'mother_content' };
const handoff: SocialInspirationHandoff = {
 inspirationId:'own-video', analysisId:'analysis', analysisVersion:'1', version:'1', readiness:'production_reference',
 source:{platform:'tiktok',sourceUrl:'https://example.com/video'}, taskContext:{}, whySelected:['实际视频分析'],referenceRole:'primary_structure',
 reusableLogic:{hookTypes:['产品问题'],revealOrder:['问题','实证'],proofPlacement:['中段'],pacing:'先慢后快',emotionalProgression:'疑问到理解',ctaPosition:'结尾'},
 adaptationBoundary:{reusable:['节奏'],mustReplace:['产品证据'],prohibited:[]},productionImplications:{requiredEvidence:['产品实证'],likelyAssetNeeds:[],risks:[]},
 evidenceRefs:[{description:'实际片段观察',confidence:0.9,needsReview:false}], rights:{mayAnalyze:true,mayAdapt:true,mayUseOriginalMedia:false},
};
const ref = {inspirationId:handoff.inspirationId,version:'1',recordHash:socialRequestHash(handoff)};
const performance: NonNullable<WeeklyDirectorPlanningAnalysis['historicalPerformance']> = {snapshotRef:{type:'metric_snapshot',id:'snap',version:1},capturedAt:'2026-10-01T00:00:00Z',source:'official_api',metrics:{views:1000,likes:0,shares:2,comments:3}};
const diagnose = (value = performance) => diagnoseOwnedReference({policy,performance:value,handoff,handoffRef:ref,now:new Date('2026-10-02T00:00:00Z')});
const analysis = () => ({historicalPerformance:structuredClone(performance),ownedReferenceDiagnosis:diagnose(),benchmarkVideoRefs:[{type:'inspiration',id:'own-video',version:1}],frozenHandoffRefs:[ref]} as unknown as WeeklyDirectorPlanningAnalysis);
test('owned diagnosis preserves observed zero and limits conclusion to plays and engagement',()=>{
 const result=diagnose(); assert.equal(result.performanceStatus,'complete');assert.equal(result.observedMetrics.likes,0);assert.equal(result.interactionRate,0.005);assert.equal(result.acquisitionConclusion,'not_measured');assert.equal(result.toneStatus,'verified'); assert.equal(ownedDiagnosisReady(analysis()),true);
});
test('unobserved shares stay missing and never become zero or a ready diagnosis',()=>{
 const result=diagnose({...performance,metrics:{...performance.metrics,shares:null}});assert.equal(result.performanceStatus,'partial');assert.deepEqual(result.missingMetrics,['shares']);assert.equal(result.interactionRate,null); assert.equal(ownedDiagnosisReady({...analysis(),ownedReferenceDiagnosis:result}),false);
});
test('future or untrusted snapshot and mismatched handoff cannot certify readiness',()=>{
 assert.equal(diagnose({...performance,capturedAt:'2099-01-01T00:00:00Z'}).performanceStatus,'unavailable');assert.equal(diagnose({...performance,source:'mock'}).performanceStatus,'unavailable');
 assert.equal(diagnoseOwnedReference({policy,performance,handoff,handoffRef:{...ref,recordHash:'changed'},now:new Date('2026-10-02')}).toneStatus,'pending');
 assert.equal(diagnose({...performance,metrics:{views:0,likes:0,shares:0,comments:0}}).interactionRate,null);
});
test('ready evidence is bound to actual analysis metrics and snapshot identity',()=>{
 for(const mutate of [(a:WeeklyDirectorPlanningAnalysis)=>{a.historicalPerformance!.metrics.views=9000;},(a:WeeklyDirectorPlanningAnalysis)=>{a.historicalPerformance!.snapshotRef.id='another';},(a:WeeklyDirectorPlanningAnalysis)=>{a.frozenHandoffRefs=[];}]) {const a=analysis();mutate(a);assert.equal(ownedDiagnosisReady(a),false);}
 const a=analysis();a.ownedReferenceDiagnosis!.tone!.pacing='伪造';assert.equal(ownedDiagnosisReady(a),false);
});
