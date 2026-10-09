import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { producePresenterContinuity, validatePresenterContinuity } from './referencePresenterContinuity.js';
import type { VideoAiAnalysis } from '../types/index.js';
const analysis:VideoAiAnalysis={theme:'',hooks:[],sellingPoints:[],mood:'',structure:'',recommendedScriptType:'storyboard',
  scriptDetails15s:[{time:'0–1s',criticalShot:{classification:'non_critical'} as any}]};
const frames=[{shotId:'shot-1',seconds:.1,base64:'test',mimeType:'image/jpeg'}, {shotId:'shot-1',seconds:.8,base64:'test',mimeType:'image/jpeg'}];
const row={shotId:'shot-1',visibility:'foreground_presenter',personContinuityId:'person_1',confidence:.95,
  evidence:['相同主讲者可见，面对镜头讲话'],frameSeconds:[.1,.8]};
test('person presence and verified presenter identity are independent of noncriticality',()=>{
  const result=validatePresenterContinuity({analysis,frames,sourceSha256:'hash',videoId:'test'},{shots:[row]},'qwen');
  assert.equal(result[0].criticalShot?.classification,'non_critical');
  assert.equal(result[0].personContinuityId,'person_1');
  assert.equal(result[0].presenterContinuityEvidence.personPresence,'person');
  assert.equal(result[0].salesPresenterConfirmed,true);
});
test('no-face is not no-person, and fabricated identities or frames fail',()=>{
  const input={analysis,frames,sourceSha256:'hash',videoId:'test'};
  for(const mutation of [{visibility:'no_person'},{visibility:'background_people'}, {personContinuityId:''},
    {confidence:.7},{frameSeconds:[.1,.9]},{frameSeconds:[.1,.1]}])
    assert.throws(()=>validatePresenterContinuity(input,{shots:[{...row,...mutation}]},'qwen'),/presenter_continuity_invalid/);
  const result=validatePresenterContinuity(input,{shots:[{...row,visibility:'hands_only',personContinuityId:''}]},'qwen');
  assert.equal(result[0].presenterContinuityEvidence.personPresence,'hands_only');
});
test('real source-frame supplier response caches identity evidence without overwriting later criticality or speech',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'presenter-evidence-')),filePath=path.join(dir,'source.mp4');
  execFileSync(ffmpeg!,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=black:size=96x96:rate=30:duration=1','-c:v','libx264','-y',filePath]);
  let calls=0;
  const recognize:any=async(input:any)=>{calls++;return {finishReason:'stop',providerResponse:{model:'qwen3-vl-flash',usage:{total_tokens:123},
    raw:JSON.stringify({shots:[{...row,visibility:'no_person',personContinuityId:'',evidence:['实际黑色帧无人'],frameSeconds:input.frames.slice(0,2).map((f:any)=>f.seconds)}]})}};};
  const input={filePath,analysis,videoId:'test',sourceSha256:'hash',duration:1,tenantId:'A'};
  try{
    const first=await producePresenterContinuity(input,{cacheRoot:path.join(dir,'cache'),recognize});
    assert.equal(calls,1);assert.ok(first.presenterContinuitySummary.frameCount >= 2);
    assert.ok(first.presenterContinuitySummary.frameEvidence.every((f:{seconds:number})=>Math.abs(f.seconds*30-Math.round(f.seconds*30))<.001));
    const nextAnalysis={...analysis,scriptDetails15s:[{...analysis.scriptDetails15s![0],criticalShot:{classification:'critical'} as any,dialogue:'later measured speech'}]};
    const next=await producePresenterContinuity({...input,analysis:nextAnalysis},{cacheRoot:path.join(dir,'cache'),recognize});
    assert.equal(calls,1);assert.equal(next.scriptDetails15s?.[0].criticalShot?.classification,'critical');
    assert.equal(next.scriptDetails15s?.[0].dialogue,'later measured speech');
    assert.deepEqual(next.presenterContinuitySummary,first.presenterContinuitySummary);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('unknown submission status never creates a second charge',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'presenter-uncertain-')),filePath=path.join(dir,'source.mp4');
  execFileSync(ffmpeg!,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=black:size=96x96:rate=30:duration=1','-c:v','libx264','-y',filePath]);
  let calls=0;const recognize:any=async()=>{calls++;throw new Error('timeout');};
  const input={filePath,analysis,videoId:'test',sourceSha256:'hash',duration:1};
  try{
    await assert.rejects(producePresenterContinuity(input,{cacheRoot:path.join(dir,'cache'),recognize}),/timeout/);
    await assert.rejects(producePresenterContinuity(input,{cacheRoot:path.join(dir,'cache'),recognize}),/不重复付费/);
    assert.equal(calls,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
