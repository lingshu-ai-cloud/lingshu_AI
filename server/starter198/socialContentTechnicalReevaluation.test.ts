import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {rm} from 'node:fs/promises';
import path from 'node:path';
import {reevaluateSocialTechnicalArtifact,applySocialTechnicalReevaluation} from './socialContentTechnicalReevaluation.js';
import {socialRequestHash} from './socialContentValidation.js';

test('local technical replay keeps unknown captions unapproved and validates inputs again after probing',async()=>{
 const scope={tenantId:'offline',taskId:randomUUID(),runId:'run'},timeline=[{sceneId:'one',targetStart:0,targetEnd:1}],manifest={spec:{duration:1},timeline};
 const outputSha256='a'.repeat(64),evidence={schemaVersion:'social-technical-replay.v1',scope,outputSha256,manifest,frozenVoiceCues:[],voice:{localPath:'/unused',sha256:'b'.repeat(64)},bgm:null,
  renderReceipt:{captionBaselineSidecar:{path:'/unused',sha256:'c'.repeat(64)},subtitleAssSidecar:{path:'/unused',sha256:'d'.repeat(64)}}};
 let verifications=0,checks=0;
 try{
  const result=await reevaluateSocialTechnicalArtifact({repository:{} as never,scope,parentArtifactId:'parent',parentContent:{},outputSha256,outputVideoPath:'/owned.mp4'}, {
   load:async()=>evidence as never,
   verify:async()=>{verifications++;return {manifest,receipt:evidence.renderReceipt,frame:{}} as never;},
   inspect:async request=>{checks++;assert.equal(request.checkpointEnabled,false);assert.equal(request.verifyDuration,true);
    return {quality:{passed:true,failures:[],metrics:{}},sceneQuality:{passed:true,issues:[],checkedScenes:1},audio:{ok:true}} as never;},
   probe:async()=>({version:'scene-media-hard-probe.v1',mediaSha256:outputSha256,timelineHash:socialRequestHash(timeline),
    scenes:[{durationPassed:true,audioWindowDecoded:true}],formatPassed:true,captionTimeline:{status:'valid'},captionSpeechAlignment:{status:'matched'},
    fullFrozenAudioIdentity:{status:'matched'},finalPrivacyCoverage:{status:'observed'},captionMaskAudit:{status:'unknown'}} as never),
  });
  assert.equal(result.approved,false);assert.ok(result.failures.includes('technical_measurement_unverified'));
  assert.equal(verifications,2);assert.equal(checks,1);
  const child=applySocialTechnicalReevaluation({review:{creativeChecksPassed:true},presenterSpeechReview:{status:'pending_human_review'},productionResult:{}},result);
  assert.equal((child.review as Record<string,unknown>).automatedChecksPassed,false);
  assert.equal((child.presenterSpeechReview as Record<string,unknown>).status,'pending_human_review');
 }finally{await rm(path.resolve('data/social-content-graph-contexts',socialRequestHash(evidence)+'.json'),{force:true});}
});
