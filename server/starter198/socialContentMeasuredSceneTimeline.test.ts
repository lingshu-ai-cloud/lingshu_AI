import test from 'node:test';
import assert from 'node:assert/strict';
import {mapMeasuredSceneTimeline} from './socialContentMeasuredSceneTimeline.js';
import {socialDirectorRenderTimeline} from './socialContentDirectorHandoff.js';
import {socialRequestHash} from './socialContentValidation.js';
const scenes=[{shotId:'a',spokenText:'Hello',startSeconds:0,endSeconds:1},{shotId:'b',spokenText:'world.',startSeconds:1,endSeconds:3},{shotId:'c',spokenText:'Buy now.',startSeconds:3,endSeconds:4}];
const cues=[{start:0,end:6,text:'Hello world.'},{start:6,end:8,text:'Buy now.'}];
test('fixed slots share real phrase anchors and preserve reference rhythm without equal cue counts',()=>{
 const result=mapMeasuredSceneTimeline({scenes,cues,durationSeconds:8});
 assert.deepEqual(result.map(s=>[s.shotId,s.start,s.end]),[['a',0,2],['b',2,6],['c',6,8]]);
 assert.equal(result[0]!.timingSource,'reference_rhythm_between_audio_anchors');
 assert.equal(result[2]!.timingSource,'measured_boundary');
 assert.deepEqual([result[0]!.anchorStart,result[0]!.anchorEnd],[0,6]);
});
test('multiple real cues inside a scene never become extra slots',()=>{
 const result=mapMeasuredSceneTimeline({scenes:[{shotId:'a',spokenText:'Hello world.',startSeconds:0,endSeconds:1},{shotId:'b',spokenText:'Buy now.',startSeconds:1,endSeconds:2}],cues:[{start:0,end:1,text:'Hello'},{start:1,end:4,text:'world.'},{start:4,end:7,text:'Buy now.'}],durationSeconds:7});
 assert.deepEqual(result.map(s=>[s.start,s.end]),[[0,4],[4,7]]);
});
test('invalid audio evidence cannot silently fall back to reference duration',()=>{
 assert.throws(()=>mapMeasuredSceneTimeline({scenes,cues:[{start:0,end:8,text:'different'}],durationSeconds:8}),/not_unique/);
 assert.throws(()=>mapMeasuredSceneTimeline({scenes,cues:[{start:0,end:9,text:'Hello world. Buy now.'}],durationSeconds:8}),/alignment_invalid/);
});
test('production renderer consumes fixed-slot mapping despite cue/scene count mismatch',()=>{
 const payload={scenes:scenes.map((scene,index)=>({sceneId:scene.shotId,voiceover:scene.spokenText,caption:scene.spokenText,referenceStructure:{sourceTiming:{startSeconds:scene.startSeconds,endSeconds:scene.endSeconds}},source:{assetName:'clip '+index,type:'video',renderUrl:'https://owned.test/'+index,sourceStart:0,sourceEnd:10}})),effectPlan:null};
 const handoff={...payload,handoffHash:socialRequestHash(payload)} as never;
 const result=socialDirectorRenderTimeline(handoff,8,cues,false,true);
 assert.deepEqual(result.map(s=>[s.targetStart,s.targetEnd]),[[0,2],[2,6],[6,8]]);
 assert.throws(()=>socialDirectorRenderTimeline(handoff,8,[{start:0,end:8,text:'wrong'}],false,true),/not_unique/);
});
