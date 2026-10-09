import test from 'node:test';import assert from 'node:assert/strict';
import {validatePresenterContinuity} from '../lib/referencePresenterContinuity.js';import {buildSocialReferenceReviewHandoff} from './socialReferenceReviewHandoff.js';
import type {VideoAiAnalysis} from '../types/index.js';
const sha='a'.repeat(64);
function fixture(visibility='no_person'){
 const analysis:VideoAiAnalysis={theme:'产品',hooks:[],sellingPoints:[],mood:'清晰',structure:'展示',baseRequirements:'产品展示',recommendedScriptType:'storyboard',scriptDetails15s:[{time:'0-2s',visual:'产品近景',purpose:'展示产品',camera:'固定',observedFacts:'产品在台面上',bgm:'真实配乐候选',voiceover:'真实旁白候选',soundEffects:['真实敲击候选'],dialogue:'原音频话术',beats:[{action:'产品旋转'}],criticalShot:{classification:'critical',model:'controlled-actual-contract',provenance:'actual-source-frame-word',primaryHook:true,uniqueVisualMechanism:true,explicitAudioVisualSync:false,confidence:.95,reason:'受控实际producer结构输入',evidence:['产品旋转'],actionEvents:[],syncPoints:[]}}]};
 const shots=validatePresenterContinuity({analysis,sourceSha256:sha,videoId:'r',frames:[{shotId:'shot-1',seconds:.1,base64:'controlled-frame',mimeType:'image/jpeg'},{shotId:'shot-1',seconds:1,base64:'controlled-frame',mimeType:'image/jpeg'}]}, {shots:[{shotId:'shot-1',visibility,personContinuityId:visibility==='foreground_presenter'?'person_1':'',confidence:.95,evidence:['受控实际producer结构：两帧可见产品，身份判定按输入'],frameSeconds:[.1,1]}]},'controlled-model');
 const detail={...shots[0],materialEvidence:{extractionStatus:'ready',clipRef:'actual-clip',firstFrameRef:'actual-frame'},hookMotionEvidence:{status:'verified'}};
 return {id:'r',aiAnalysis:{analysisRunId:'run',contentSha256:sha,durationSeconds:2,analysisMode:'exact',analysisQuality:'video',gemini:{...analysis,scriptDetails15s:[detail]}},referenceVerifiedSpeech:{schemaVersion:1,analysisRunId:'run',sourceSha256:sha,coverageConfirmed:true,reviewerId:'reviewer',verifiedAt:'2026-10-10T00:00:00Z',lines:[{start:.1,end:1.8,text:'实际原音频话术',visibility:'voiceover'}]}};
}
test('validated structured producer no-person and hands-only handoff needs no presenter; other evidence gaps remain blocking',()=>{
 for(const presence of ['no_person','hands_only']){const record=fixture(presence);const handoff=buildSocialReferenceReviewHandoff({record});assert.ok(!handoff.issues.some(issue=>issue.code==='presenter_asset_unlocked'));assert.equal(handoff.productionExecutionAllowed,true,JSON.stringify(handoff.issues));}
 for(const presence of ['foreground_presenter','unknown'])assert.ok(buildSocialReferenceReviewHandoff({record:fixture(presence)}).issues.some(issue=>issue.code==='presenter_asset_unlocked'));
 const changed=fixture();changed.aiAnalysis.contentSha256='b'.repeat(64);assert.ok(buildSocialReferenceReviewHandoff({record:changed}).issues.some(issue=>issue.code==='presenter_asset_unlocked'));
 const retimed=fixture();retimed.aiAnalysis.gemini.scriptDetails15s[0]!.time='0-1s';assert.ok(buildSocialReferenceReviewHandoff({record:retimed}).issues.some(issue=>issue.code==='presenter_asset_unlocked'));
});

test('reviewed merging, retiming, discarded coverage and duplicate sources never inherit no-person exemption',async()=>{
 const {verifiedNonPresenterReference}=await import('./referencePresenterRequirement.js');const record=fixture();const originals=record.aiAnalysis.gemini.scriptDetails15s.map((detail,index)=>({...detail,shotId:`shot-${index+1}`}));
 const base={sourceSha256:sha,duration:2,originalDetails:originals,reviewComplete:true};const exact={...originals[0],sourceShotIds:['shot-1']};
 assert.equal(verifiedNonPresenterReference({...base,retainedDetails:[exact]}),true);
 assert.equal(verifiedNonPresenterReference({...base,retainedDetails:[{...exact,time:'0-1s'}]}),false);
 assert.equal(verifiedNonPresenterReference({...base,retainedDetails:[{...exact,sourceShotIds:['shot-1','shot-2']}]}),false);
 assert.equal(verifiedNonPresenterReference({...base,retainedDetails:[]}),false);
 assert.equal(verifiedNonPresenterReference({...base,retainedDetails:[exact,exact]}),false);
 assert.equal(verifiedNonPresenterReference({...base,originalDetails:originals.map(detail=>({...detail,presenterContinuityEvidence:undefined})),retainedDetails:[exact]}),false);
});

test('source duration is required and disagreement with actual record duration cannot waive presenter',()=>{const record=fixture();const {durationSeconds:_duration,...withoutDuration}=record.aiAnalysis;assert.ok(buildSocialReferenceReviewHandoff({record:{...record,aiAnalysis:withoutDuration}}).issues.some(issue=>issue.code==='presenter_asset_unlocked'));assert.ok(buildSocialReferenceReviewHandoff({record:{...record,duration:3}}).issues.some(issue=>issue.code==='presenter_asset_unlocked'));});
