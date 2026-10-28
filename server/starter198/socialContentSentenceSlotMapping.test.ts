import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSentenceSlots,measureSentenceSlots} from './socialContentSentenceSlotMapping.js';

const line=(lineId:string,text:string,owner:string,slots:string[])=>({lineId,text,sourceStartSeconds:0,sourceEndSeconds:1,narrationOwnerShotId:owner,visualShotIds:slots,isNarrationOwner:true});
const first=line('line-1','Hello world.','s1',['s1','s2']);
const second=line('line-2','Buy now.','s2',['s2']);
const scenes=[{shotId:'s1',spokenText:'Hello world.',lines:[first]}, {shotId:'s2',spokenText:'Buy now.',lines:[{...first,isNarrationOwner:false},second]}];
test('固定槽跨镜保持同一句身份，语音 cue 边界提供实测句界',()=>{
 const lines=validateSentenceSlots(scenes)!;
 assert.deepEqual(measureSentenceSlots(lines,[{start:.1,end:2,text:'Hello world.'},{start:2.2,end:3,text:'Buy now.'}]),[
  {lineId:'line-1',text:'Hello world.',visualShotIds:['s1','s2'],narrationOwnerShotId:'s1',startSeconds:.1,endSeconds:2,timingSource:'measured_cue_boundaries'},
  {lineId:'line-2',text:'Buy now.',visualShotIds:['s2'],narrationOwnerShotId:'s2',startSeconds:2.2,endSeconds:3,timingSource:'measured_cue_boundaries'}]);
});
test('一个粗 cue 覆盖两句时不捏造句间时间',()=>{
 const result=measureSentenceSlots(validateSentenceSlots(scenes)!,[{start:.1,end:3,text:'Hello world. Buy now.'}]);
 assert.equal(result[0]!.endSeconds,null);assert.equal(result[1]!.startSeconds,null);
 assert.equal(result[0]!.timingSource,'partial_cue_boundaries');
});
test('拒绝漏槽、重复、错位、句子不一致；旧任务允许缺省',()=>{
 assert.equal(validateSentenceSlots([{shotId:'s',spokenText:'old'}]),null);
 assert.throws(()=>validateSentenceSlots([scenes[0]!,{...scenes[1]!,lines:[second]}]),/mapping_incomplete/);
 assert.throws(()=>validateSentenceSlots([{...scenes[0]!,lines:[first,first]},scenes[1]!]),/mapping_invalid/);
 assert.throws(()=>validateSentenceSlots([scenes[0]!,{...scenes[1]!,spokenText:'changed'}]),/narration_changed/);
 assert.throws(()=>measureSentenceSlots(validateSentenceSlots(scenes)!,[{start:0,end:1,text:'wrong'}]),/alignment_text_changed/);
});
