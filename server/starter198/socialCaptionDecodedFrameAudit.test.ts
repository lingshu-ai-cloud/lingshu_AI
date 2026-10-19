import assert from 'node:assert/strict';
import {test} from 'node:test';
import {appendFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import {auditCaptionDecodedFrames} from './socialCaptionDecodedFrameAudit.js';

test('every decoded MP4 presentation frame is enumerated, and a short hidden-caption gap is not a pass',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'caption-frame-audit-test-'));
 try{
  const good=path.join(dir,'good.mp4'),gap=path.join(dir,'gap.mp4');
  for(const [file,hidden] of [[good,false],[gap,true]] as const){
   const filters='drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:text=HELLO:fontcolor=white:fontsize=90:x=(w-text_w)/2:y=(h-text_h)/2'+(hidden?",drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,0.28,0.32)'":'');
   const render=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=640x360:r=25:d=1','-vf',filters,'-c:v','libx264','-pix_fmt','yuv420p',file]);
   assert.equal(render.ok,true,render.stderr);
  }
  const cues=[{start:0,end:1,text:'HELLO'}];
  const seen=await auditCaptionDecodedFrames({filePath:good,cues,maxFrames:30});
  assert.equal(seen.status,'observed_all_decoded_frames',seen.reason);
  assert.equal(seen.checkedFrameCount,25);
  assert.equal(seen.frames.length,25);
  const missed=await auditCaptionDecodedFrames({filePath:gap,cues,maxFrames:30});
  assert.equal(missed.status,'unknown',missed.reason);
  assert.ok(missed.missingFrameIndexes.length>0);
  const overBudget=await auditCaptionDecodedFrames({filePath:good,cues,maxFrames:20});
  assert.equal(overBudget.status,'unknown');
  assert.equal(overBudget.checkedFrameCount,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('45-second 30fps decode streams 1350 frames with bounded memory and no frame loss',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'caption-long-frame-test-'));
 try{
  const file=path.join(dir,'long.mp4');
  const made=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=160x90:r=30:d=45','-c:v','libx264','-pix_fmt','yuv420p',file],false,{timeoutMs:120000});
  assert.equal(made.ok,true,made.stderr);
  // A stub isolates the 1350-frame streaming/PTS contract; the short MP4 test uses actual OCR.
  const streamed=await auditCaptionDecodedFrames({filePath:file,cues:[{start:0,end:45,text:'HELLO'}],recognize:async()=> 'HELLO'});
  assert.equal(streamed.status,'observed_all_decoded_frames',streamed.reason);
  assert.equal(streamed.decodedFrameCount,1350);
  assert.equal(streamed.checkedFrameCount,1350);
  assert.equal(streamed.frames.at(-1)?.index,1349);
  const capped=await auditCaptionDecodedFrames({filePath:file,cues:[{start:0,end:45,text:'HELLO'}],maxFrames:1000,recognize:async()=> 'HELLO'});
  assert.equal(capped.status,'unknown');
  assert.equal(capped.checkedFrameCount,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('whole-frame OCR can mistake a persistent package label for the missing burned subtitle',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'caption-package-false-positive-'));
 try{
  const file=path.join(dir,'package-only.mp4');
  const made=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=640x360:r=25:d=1','-vf','drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:text=HELLO:fontcolor=white:fontsize=90:x=(w-text_w)/2:y=12','-c:v','libx264','-pix_fmt','yuv420p',file]);
  assert.equal(made.ok,true,made.stderr);
  // The rendered file contains no bottom subtitle at all. The only matching
  // pixels are an unrelated label at the top of every frame.
  const observed=await auditCaptionDecodedFrames({filePath:file,cues:[{start:0,end:1,text:'HELLO'}],maxFrames:30});
  assert.equal(observed.status,'observed_all_decoded_frames',observed.reason);
  assert.equal(observed.checkedFrameCount,25);
  assert.match(observed.reason,/不能作为 G4 自动通过/);
  const cropped=await auditCaptionDecodedFrames({filePath:file,cues:[{start:0,end:1,text:'HELLO'}],maxFrames:30,region:{x:0,y:0.55,width:1,height:0.45}});
  assert.equal(cropped.status,'unknown','a bottom caption ROI excludes the unrelated top package label');
  assert.ok(cropped.missingFrameIndexes.length>0);
  const invalid=await auditCaptionDecodedFrames({filePath:file,cues:[{start:0,end:1,text:'HELLO'}],region:{x:0,y:0.9,width:1,height:0.2}});
  assert.equal(invalid.status,'unknown');
  assert.equal(invalid.checkedFrameCount,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('decoded-frame observation cannot be reused after the final MP4 changes during OCR',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'caption-media-drift-test-'));
 try{
  const file=path.join(dir,'changing.mp4');
  const made=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=160x90:r=25:d=1','-c:v','libx264','-pix_fmt','yuv420p',file]);
  assert.equal(made.ok,true,made.stderr);
  let changed=false;
  const observed=await auditCaptionDecodedFrames({filePath:file,cues:[{start:0,end:1,text:'HELLO'}],recognize:async()=>{
   if(!changed){changed=true;await appendFile(file,Buffer.from('changed-after-initial-hash'));}
   return 'HELLO';
  }});
  assert.equal(changed,true);
  assert.equal(observed.status,'unknown');
  assert.match(observed.reason,/字节发生变化/);
  assert.equal(observed.checkedFrameCount,25);
 }finally{await rm(dir,{recursive:true,force:true});}
});
