import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { prepareLocalSeedanceMotionGuide } from './seedanceMotionGuide.js';

test('local motion guide removes audio, color and texture while retaining duration and a low-resolution moving outline', async () => {
  assert.ok(ffmpegStatic); const root=fs.mkdtempSync(path.join(os.tmpdir(),'motion-guide-')); const source=path.join(root,'source.mp4'); let uploaded=''; let uploadedSize=0;
  try {
    execFileSync(String(ffmpegStatic),['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=s=720x1280:r=25:d=4','-f','lavfi','-i','sine=frequency=880:duration=4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest','-y',source]);
    const sourceSha=createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const result=await prepareLocalSeedanceMotionGuide({tenantId:'tenant-test',cueId:'cue-1',sourceVideoPath:source,workDir:root},{ffmpegPath:String(ffmpegStatic),attestationRoot:path.join(root,'attestations'),uploadFile:async value=>{uploaded=value.filePath;uploadedSize=value.contentLength;},head:async()=>({size:uploadedSize,contentType:'video/mp4',etag:'test'}),signedGetUrl:async()=> 'https://signed.example/motion-guide.mp4'});
    assert.equal(result.identityRemoved,true); assert.equal(result.motionOnly,true); assert.equal(result.attestation.sourceSha256,sourceSha); assert.notEqual(result.attestation.outputSha256,sourceSha); assert.equal(result.attestation.parameters.audioRemoved,true);
    const inspected=spawnSync(String(ffmpegStatic),['-hide_banner','-i',uploaded,'-f','null','-'],{encoding:'utf8'}); const report=String(inspected.stderr);
    assert.match(report,/Video:.*480x854/); assert.doesNotMatch(report,/Audio:/); const match=report.match(/Duration:\s+(\d+):(\d+):([\d.]+)/); assert.ok(match); const duration=Number(match[1])*3600+Number(match[2])*60+Number(match[3]); assert.ok(duration>=3.9&&duration<=4.1,`expected 4s, got ${duration}`);
    const attestations=fs.readdirSync(path.join(root,'attestations')); assert.equal(attestations.length,1); const saved=JSON.parse(fs.readFileSync(path.join(root,'attestations',attestations[0]!),'utf8')); assert.equal(saved.outputSha256,result.attestation.outputSha256);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('short physical beats are held to the supplier duration without changing their editing duration', async () => {
  assert.ok(ffmpegStatic); const root=fs.mkdtempSync(path.join(os.tmpdir(),'motion-guide-short-')); const source=path.join(root,'source.mp4'); let uploaded=''; let uploadedSize=0;
  try {
    execFileSync(String(ffmpegStatic),['-hide_banner','-loglevel','error','-f','lavfi','-i','color=red:s=720x1280:r=25:d=0.12','-pix_fmt','yuv420p','-y',source]);
    await prepareLocalSeedanceMotionGuide({tenantId:'tenant-test',cueId:'opening-flash',sourceVideoPath:source,workDir:root,padToSeconds:4},{ffmpegPath:String(ffmpegStatic),attestationRoot:path.join(root,'attestations'),uploadFile:async value=>{uploaded=value.filePath;uploadedSize=value.contentLength;},head:async()=>({size:uploadedSize,contentType:'video/mp4',etag:'test'}),signedGetUrl:async()=> 'https://signed.example/motion-guide.mp4'});
    const inspected=spawnSync(String(ffmpegStatic),['-hide_banner','-i',uploaded,'-f','null','-'],{encoding:'utf8'}); const match=String(inspected.stderr).match(/Duration:\s+(\d+):(\d+):([\d.]+)/); assert.ok(match); const duration=Number(match[1])*3600+Number(match[2])*60+Number(match[3]); assert.ok(duration>=3.9&&duration<=4.1,`expected held 4s guide, got ${duration}`);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
