import test from 'node:test';
import assert from 'node:assert/strict';
import { sentenceReplicationPreview } from './sentenceReplicationPreview.js';
import { sentenceVideoInputFingerprint } from '../../shared/contracts/sentenceReplicationImpact.js';
import { newShotProduction, patchShot, shotFingerprint } from '../../src/lib/shotProduction.js';
import type { SentenceReplicationResult } from '../../src/lib/digitalHumanPlan.js';
const presenter={id:'p',name:'Presenter',authorized:true,avatarId:'',voiceId:'v',supportsAlpha:false,assetVersion:1};
const cue={id:'cue',start:0,end:4,originalText:'Hello',targetText:'Hello',shotIds:['s'],personShot:true,compositionClusterId:'front',sourceFirstFrame:{time:0,materialId:'source'},targetFirstFrame:{materialId:'frame',state:'ready' as const}};
const shot={...newShotProduction('Hello','p'),source:'avatar' as const,digitalHuman:{workflow:'viral_replication' as const,method:'reenact' as const,contentConfirmed:true,targetFramesConfirmed:true,action:'talk',scene:'office',preserve:'camera',reference:{videoUrl:'/reference.mp4',start:0,end:4,originalText:'Hello',derivativeAuthorized:false,cues:[cue]}}};
const fingerprint=sentenceVideoInputFingerprint(cue,{presenterId:'p',presenterVersion:1,voiceId:'v',language:'en',narration:shot.narration,requirements:shot.digitalHuman});
const prior:SentenceReplicationResult={cues:[{...cue,generatedClip:{materialId:'clip',state:'ready',duration:4,inputFingerprint:fingerprint}}],materialId:'joined',candidateUrl:'/joined.mp4',state:'completed',cueQuality:[{cueId:'cue',kind:'person_generated',state:'accepted',checks:[]}]};
test('accepted unchanged clips are reused and cost zero, changed narration regenerates only video',()=>{
  const reuse=sentenceReplicationPreview(shot,presenter,'en',[prior]);
  assert.deepEqual(reuse.reuseCueMaterialIds,{cue:'clip'});assert.equal(reuse.estimatedCostCny,0);
  const changed={...shot,digitalHuman:{...shot.digitalHuman,reference:{...shot.digitalHuman.reference,cues:[{...cue,targetText:'New wording'}]}}};
  const plan=sentenceReplicationPreview(changed,presenter,'en',[prior]);
  assert.deepEqual(plan.reuseCueMaterialIds,{});assert.equal(plan.impacts[0].stage,'video');assert.ok(plan.estimatedCostCny!>0);
});
test('pending quality and changed presenter version or language cannot reuse generated footage',()=>{
  for(const result of [sentenceReplicationPreview(shot,presenter,'en',[{...prior,cueQuality:[{...prior.cueQuality![0],state:'manual_review'}]}]),sentenceReplicationPreview(shot,{...presenter,assetVersion:2},'en',[prior]),sentenceReplicationPreview(shot,presenter,'fr',[prior])]) assert.deepEqual(result.reuseCueMaterialIds,{});
});
test('photo preview bypasses only the configured tenant internal per-task ceiling',()=>{
  const previous=process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
  const photoShot={...shot,digitalHuman:{...shot.digitalHuman,presenterMode:'photo_talking' as const}};
  const env={...process.env,STUDIO_HEYGEN_RESERVE_CNY:'1',HEYGEN_PHOTO_ESTIMATED_CNY_PER_SECOND:'1'};
  process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS='tenant-exact';
  try {
    const regular=sentenceReplicationPreview(photoShot,presenter,'en',[],env,'tenant-other');
    assert.match(regular.estimateError,/管理员单任务上限/);
    const exempt=sentenceReplicationPreview(photoShot,presenter,'en',[],env,'tenant-exact');
    assert.equal(exempt.estimateError,'');assert.ok(exempt.estimatedCostCny!>1);
  } finally {
    if(previous===undefined)delete process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;else process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS=previous;
  }
});
test('text edits preserve reviewed frames; presenter and scene edits invalidate them',()=>{
  assert.equal(patchShot(shot,{narration:'New wording'}).digitalHuman?.targetFramesConfirmed,true);
  for(const changed of [patchShot(shot,{presenterId:'other'}),patchShot(shot,{digitalHuman:{...shot.digitalHuman,scene:'factory'}})]) {
    assert.equal(changed.digitalHuman?.targetFramesConfirmed,false);
    assert.equal(changed.digitalHuman?.reference?.cues?.[0].targetFirstFrame,undefined);
  }
});


test('automatically extracted frame metadata does not invalidate the generation input',()=>{
  const input={...shot,digitalHuman:{...shot.digitalHuman,targetFramesConfirmed:false,reference:{...shot.digitalHuman.reference,cues:[{...cue,sourceFirstFrame:undefined,targetFirstFrame:undefined}]}}};
  assert.equal(shotFingerprint(input,''),shotFingerprint(shot,''));
});
