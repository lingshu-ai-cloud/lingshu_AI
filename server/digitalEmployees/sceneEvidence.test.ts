import assert from 'node:assert/strict';
import { allocateEvidenceClips, evidenceClips, type EvidenceAsset } from './sceneEvidence.js';
import { applySceneRepair, planSceneRepair } from './sceneRepair.js';
const image = (id: string, observations: string[], url?: string): EvidenceAsset => ({ id, type: 'image', duration: 0, visualObservations: observations, url });
const video: EvidenceAsset = { id: 'demo', type: 'video', duration: 30, visualObservations: ['正面电路板、背面焊点、接口安装'], segments: [
  { id: 'front', start: 0, end: 10, action: '正面电路板', confidence: .9 },
  { id: 'back', start: 10, end: 20, action: '背面焊点', confidence: .9 },
  { id: 'connect', start: 20, end: 30, action: '接口安装', confidence: .9 },
] };
const scenes = ['正面电路板','背面焊点','接口安装'].map((intent, sceneIndex) => ({ intent, sceneIndex, duration: 9 }));
const planned = allocateEvidenceClips({ scenes, assets: [video] });
assert.deepEqual(planned.gaps, []);
assert.deepEqual(planned.plan.map(clip => [clip.segmentId,clip.start]), [['front',0],['back',10],['connect',20]], 'one file supplies three semantically different actual intervals');
assert.ok(allocateEvidenceClips({ scenes: [{...scenes[1],trimStart:0}], assets:[video] }).gaps.length,'whole-video keywords cannot justify wrong clip');
assert.ok(allocateEvidenceClips({ scenes:[{...scenes[1],duration:11}],assets:[video] }).gaps.length,'full requested duration must fit the observed segment');
assert.equal(evidenceClips({...video,segments:[{...video.segments![0],needsReview:true}]}).length,0);
assert.equal(evidenceClips({...video,segments:[{...video.segments![0],confidence:.4}]}).length,0);
assert.equal(evidenceClips({...video,segments:[{...video.segments![0],confidence:NaN}]}).length,0);
assert.equal(evidenceClips({...video,segments:[]}).length,0,'whole-file observations cannot invent timestamps');
assert.ok(allocateEvidenceClips({scenes:scenes.slice(0,2).map(s=>({...s,intent:'正面电路板'})),assets:[image('a',['正面电路板'],'/same.png'),image('b',['正面电路板'],'/same.png')]}).gaps.length,'aliases cannot count as distinct scenes');
assert.equal(allocateEvidenceClips({scenes:[{sceneIndex:0,intent:'产品展示特写',duration:4}],assets:[image('a',['产品展示'])]}).plan.length,0,'generic product keywords are insufficient');
const scarce = allocateEvidenceClips({scenes:[{sceneIndex:0,intent:'电路板 焊点',duration:4},{sceneIndex:1,intent:'电路板',duration:4}], assets:[image('only',['电路板']),image('flexible',['焊点'])]});
assert.deepEqual(scarce.plan.map(c=>c.assetId),['flexible','only'],'reserve unique matching asset for constrained scene');
const current = scenes.map((scene,i)=>({sceneIndex:i,assetId:'demo',sourceStart:i*10}));
const issue = { sceneIndex:1,start:9,end:18,code:'blur' as const,reason:'blur' };
const alternative = image('replacement',['背面焊点']);
const repaired = planSceneRepair({scenes,assets:[video,alternative],current,issues:[issue],attempts:0,userLocked:false});
assert.deepEqual(repaired.plan.map(c=>c.sceneIndex),[1]);
assert.equal(repaired.plan[0].assetId,'replacement');
assert.ok(planSceneRepair({scenes,assets:[video],current,issues:[issue],attempts:0,userLocked:false}).gaps.length,'do not retry the known bad interval');
assert.ok(planSceneRepair({scenes,assets:[video,alternative],current,issues:[issue],attempts:2,userLocked:false}).gaps.length);
assert.ok(planSceneRepair({scenes,assets:[video,alternative],current,issues:[issue],attempts:0,userLocked:true}).gaps.length);
const original = { sceneSourcePlan: current.map((c,i)=>({...c,start:i*9,end:(i+1)*9})), voiceoverUrl:'/voice.wav',alignedCuesByLang:{en:[{start:0,end:27,text:'unchanged'}]},script:'unchanged',renderOutputPath:'/bad.mp4',automation:{contentVersion:2,narrationHash:'same',narrationReviewPassed:true,renderOutputPath:'/bad.mp4',quality:{passed:false}} };
const fixed = applySceneRepair(original,repaired,[issue]);
assert.equal(fixed.voiceoverUrl,original.voiceoverUrl);assert.deepEqual(fixed.alignedCuesByLang,original.alignedCuesByLang);assert.equal(fixed.script,original.script);
assert.equal(fixed.automation.stage,'render');assert.equal(fixed.automation.contentVersion,3);assert.equal(fixed.automation.sceneRepairAttempts,1);
assert.deepEqual(fixed.sceneSourcePlan.filter((_:unknown,i:number)=>i!==1),original.sceneSourcePlan.filter((_,i)=>i!==1));
assert.equal(fixed.renderOutputPath,'');assert.equal(original.renderOutputPath,'/bad.mp4');assert.equal(fixed.invalidatedRenders[0].path,'/bad.mp4');
console.log('scene evidence and bounded repair regression tests passed');
const secondIssue={...issue};
const afterFirst=current.map(c=>c.sceneIndex===1?{...c,assetId:'replacement',sourceStart:0}:c);
const secondRepair=planSceneRepair({scenes,assets:[video,alternative],current:afterFirst,issues:[secondIssue],attempts:1,userLocked:false,previousFailures:'failedSources' in repaired?repaired.failedSources:[]});
assert.ok(secondRepair.gaps.length,'second repair must not return to the first failed source');
