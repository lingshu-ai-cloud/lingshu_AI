import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { inspectRenderedScenes, inspectRenderedVisuals } from '../lib/renderVisualQuality.js';
import { planSceneRepair, applySceneRepair } from './sceneRepair.js';
import type { EvidenceAsset } from './sceneEvidence.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(),'scene-repair-regression-'));
const run = (args:string[]) => execFileSync(String(ffmpegStatic),['-hide_banner','-loglevel','error',...args],{timeout:30000});
try {
  const assets: EvidenceAsset[] = ['a','b','c'].map((id,i) => {
    const localPath=path.join(root,id+'.mp4');
    run(['-f','lavfi','-i','smptebars=s=320x480:r=10:d=1','-vf',i===0?'null':i===1?'hflip':'negate','-pix_fmt','yuv420p','-y',localPath]);
    return {id,localPath,type:'video',duration:1,visualObservations:['测试接口画面'],segments:[{id:id+'-scene',start:0,end:1,action:'测试接口画面',confidence:.9}]};
  });
  const render = (ids:string[],name:string) => {
    const list=path.join(root,name+'.txt'),file=path.join(root,name+'.mp4');
    fs.writeFileSync(list, ids.map(id=>`file '${assets.find(a=>a.id===id)!.localPath}'`).join('\n'));
    run(['-f','concat','-safe','0','-i',list,'-c','copy','-y',file]);return file;
  };
  const scenes=[0,1,2].map(i=>({start:i,end:i+1}));
  const bad=render(['a','b','a'],'bad');
  const diagnostic=await inspectRenderedScenes({outputPath:bad,scenes,requireDistinct:true});
  assert.equal(diagnostic.passed,false);
  assert.deepEqual(diagnostic.issues.map(issue=>[issue.sceneIndex,issue.code]),[[2,'duplicate']],JSON.stringify(diagnostic));
  const current=['a','b','a'].map((assetId,sceneIndex)=>({assetId,sceneIndex,sourceStart:0,...scenes[sceneIndex]}));
  const repair=planSceneRepair({assets,current,scenes:scenes.map((_,sceneIndex)=>({sceneIndex,intent:'测试接口画面',duration:1})),issues:diagnostic.issues,attempts:0,userLocked:false});
  assert.equal(repair.plan[0].assetId,'c');
  const state=applySceneRepair({sceneSourcePlan:current,automation:{contentVersion:1},renderOutputPath:bad},repair,diagnostic.issues);
  const good=render(state.sceneSourcePlan.map((scene:any)=>scene.assetId),'fixed');
  assert.equal((await inspectRenderedScenes({outputPath:good,scenes,requireDistinct:true})).passed,true);
  const global=await inspectRenderedVisuals({outputPath:good,expectedDuration:3,expectedUniqueScenes:3,minSharpFrameRatio:.5});
  assert.equal(global.passed,true,global.failures.join());
  const blank=path.join(root,'blank.mp4');
  run(['-f','lavfi','-i','color=c=black:s=320x480:r=10:d=1','-y',blank]);
  const blankResult=await inspectRenderedScenes({outputPath:blank,scenes:[{start:0,end:1}]});
  assert.ok(blankResult.issues.some(issue=>issue.code==='blank'));
  assert.equal((await inspectRenderedScenes({outputPath:good,scenes:[{start:2,end:4}]})).passed,false,'truncated render must fail');
  assert.equal((await inspectRenderedScenes({outputPath:bad,scenes,requireDistinct:false})).passed,true,'continuous presenter shots need not be artificially different');
  console.log('Real FFmpeg regression: duplicate scene detected → one scene replaced → re-render passes scene and full-video quality. Blank/truncated media rejected.');
} finally {fs.rmSync(root,{recursive:true,force:true});}
