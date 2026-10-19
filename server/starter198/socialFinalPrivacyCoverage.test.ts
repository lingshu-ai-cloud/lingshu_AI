import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import {hasKnownFinalMediaCoverageFailure,probeFinalPrivacyCoverage} from './socialFinalPrivacyCoverage.js';

test('final MP4 coverage counts all frames and full audio without claiming privacy clearance',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'final-privacy-coverage-'));
 try{
  const file=path.join(root,'full.mp4');
  const made=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=128x128:r=25:d=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',file]);assert.equal(made.ok,true,made.stderr);
  const result=await probeFinalPrivacyCoverage({filePath:file,expectedDurationSeconds:2,expectedFrames:50});
  assert.equal(result.status,'observed',JSON.stringify(result));assert.equal(result.video.streamCount,1);assert.equal(result.video.decodedFrames,50);assert.ok(result.audio.decodedSamples>=30000);assert.match(result.reason,/不证明隐私安全/);
  const noFrozenCount=await probeFinalPrivacyCoverage({filePath:file,expectedDurationSeconds:2});
  assert.equal(noFrozenCount.status,'unknown','decoded count cannot certify itself without an independently frozen frame count');
  assert.equal(hasKnownFinalMediaCoverageFailure(noFrozenCount),false,'missing authority is not a measured media defect');
  const wrongCount=await probeFinalPrivacyCoverage({filePath:file,expectedDurationSeconds:2,expectedFrames:51});
  assert.equal(wrongCount.status,'unknown');assert.equal(wrongCount.failureCode,'frame_count_mismatch');assert.equal(hasKnownFinalMediaCoverageFailure(wrongCount),true);
  const cut=path.join(root,'cut.mp4');
  const madeCut=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=128x128:r=25:d=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1.5','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',cut]);assert.equal(madeCut.ok,true,madeCut.stderr);
  const shortAudio=await probeFinalPrivacyCoverage({filePath:cut,expectedDurationSeconds:2,expectedFrames:50});assert.equal(shortAudio.status,'unknown',JSON.stringify(shortAudio));assert.equal(shortAudio.failureCode,'media_duration_mismatch');
  const alternate=path.join(root,'alternate-video.mp4');
  const madeAlternate=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=128x128:r=25:d=2','-f','lavfi','-i','color=c=red:s=128x128:r=25:d=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-map','0:v:0','-map','1:v:0','-map','2:a:0','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',alternate]);assert.equal(madeAlternate.ok,true,madeAlternate.stderr);
  const alternateResult=await probeFinalPrivacyCoverage({filePath:alternate,expectedDurationSeconds:2,expectedFrames:50});
  assert.equal(alternateResult.status,'unknown',JSON.stringify(alternateResult));assert.equal(alternateResult.video.streamCount,2);
  assert.equal(alternateResult.failureCode,'media_streams_invalid');assert.equal(hasKnownFinalMediaCoverageFailure(alternateResult),true);
  assert.equal(alternateResult.video.decodedFrames,0,'first-track decode is not full-screen coverage when another video track exists');
  const silent=path.join(root,'silent.mp4');
  const madeSilent=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=128x128:r=25:d=2','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',silent]);assert.equal(madeSilent.ok,true,madeSilent.stderr);
  const silentWithSpeech=await probeFinalPrivacyCoverage({filePath:silent,expectedDurationSeconds:2,expectedFrames:50,frozenSpeechExpected:true});
  assert.equal(silentWithSpeech.status,'unknown',JSON.stringify(silentWithSpeech));assert.equal(silentWithSpeech.failureCode,'frozen_speech_audio_silent');assert.equal(hasKnownFinalMediaCoverageFailure(silentWithSpeech),true);
  const silentWithoutSpeech=await probeFinalPrivacyCoverage({filePath:silent,expectedDurationSeconds:2,expectedFrames:50});
  assert.equal(silentWithoutSpeech.status,'observed',JSON.stringify(silentWithoutSpeech));
 }finally{await rm(root,{recursive:true,force:true});}
});
