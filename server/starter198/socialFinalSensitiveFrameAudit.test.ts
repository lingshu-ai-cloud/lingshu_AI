import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import {auditFinalSensitiveFrames,hasKnownFinalSensitiveFrameFailure} from './socialFinalSensitiveFrameAudit.js';
import {probeSocialSceneMedia} from './socialSceneMediaHardProbe.js';
import {freezeSocialRenderFrameContract} from './socialRenderFrameContract.js';

test('actual final-MP4 full-frame stream catches one transient sensitive OCR hit without clearing privacy on no hit',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'final-sensitive-frames-'));
 try{
  const filePath=path.join(root,'final.mp4');
  const made=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=128x128:r=30:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',filePath]);assert.equal(made.ok,true,made.stderr);
  const expectedMediaSha256=createHash('sha256').update(await readFile(filePath)).digest('hex');
  const prefix='11010119900101001',weights=[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2],check='10X98765432'[weights.reduce((total,weight,index)=>total+Number(prefix[index])*weight,0)%11];
  let count=0;
  const hit=await auditFinalSensitiveFrames({filePath,expectedMediaSha256,expectedFrameCount:30,recognize:async()=>count++===13?`身份证 ${prefix}${check}`:'ordinary frame'});
  assert.equal(count,30);assert.equal(hit.status,'hit');assert.deepEqual(hit.findingFrameIndexes,[13]);assert.deepEqual(hit.findingCodes,['resident_identity_number']);assert.ok(!JSON.stringify(hit).includes(prefix),'raw OCR must not be persisted');
  assert.equal(hasKnownFinalSensitiveFrameFailure(hit,expectedMediaSha256),true);
  const clear=await auditFinalSensitiveFrames({filePath,expectedMediaSha256,expectedFrameCount:30,recognize:async()=>'+8619653282176'});
  assert.equal(clear.status,'not_observed');assert.equal(clear.checkedFrameCount,30);assert.equal(hasKnownFinalSensitiveFrameFailure(clear,expectedMediaSha256),false);
  assert.equal(hasKnownFinalSensitiveFrameFailure(clear,'0'.repeat(64)),true,'an old clean audit cannot move to changed output bytes');
  const wrongCount=await auditFinalSensitiveFrames({filePath,expectedMediaSha256,expectedFrameCount:29,recognize:async()=>''});assert.equal(wrongCount.status,'unknown');
  const wrongHash=await auditFinalSensitiveFrames({filePath,expectedMediaSha256:'0'.repeat(64),expectedFrameCount:30,recognize:async()=>''});assert.equal(wrongHash.status,'unknown');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('bundled OCR detects a one-frame private-key marker from real encoded MP4 pixels',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'final-sensitive-real-ocr-'));
 try{
  const filePath=path.join(root,'one-frame.mp4');
  const draw="drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:text='BEGIN PRIVATE KEY':fontcolor=white:fontsize=48:x=20:y=120:enable='eq(n,13)'";
  const made=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=640x360:r=30:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-vf',draw,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',filePath]);assert.equal(made.ok,true,made.stderr);
  const expectedMediaSha256=createHash('sha256').update(await readFile(filePath)).digest('hex');
  const manifest={spec:{duration:1},frameContract:freezeSocialRenderFrameContract(1),timeline:[{sceneId:'one',targetStart:0,targetEnd:1}]};
  const probe=await probeSocialSceneMedia({filePath,manifest,frameRenderEvidence:{schemaVersion:'renderer-frame-attestation.v1',outputSha256:expectedMediaSha256,fps:30,durationSeconds:1,expectedFrames:30}});
  const audit=probe.finalSensitiveFrameAudit;
  assert.equal(probe.finalPrivacyCoverage?.status,'observed');
  assert.equal(audit?.status,'hit',audit?.reason);assert.equal(audit?.checkedFrameCount,30);assert.equal(audit?.frameEvidence.length,30);assert.deepEqual(audit?.frameEvidence.map(frame=>frame.index),Array.from({length:30},(_,index)=>index));assert.deepEqual(audit?.findingFrameIndexes,[13]);assert.deepEqual(audit?.findingCodes,['private_key_marker']);
 }finally{await rm(root,{recursive:true,force:true});}
});
