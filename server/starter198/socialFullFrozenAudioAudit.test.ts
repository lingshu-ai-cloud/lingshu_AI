import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import {auditFullFrozenAudio} from './socialFullFrozenAudioAudit.js';

const sha=async(file:string)=>createHash('sha256').update(await readFile(file)).digest('hex');
test('full frozen audio audit rejects a late-window replacement missed by an early scene sample',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'full-audio-audit-'));
 try{
  const frozen=path.join(root,'frozen.wav'),good=path.join(root,'good.mp4'),bad=path.join(root,'late-replaced.mp4');
  const voice=await runVisualFfmpeg(['-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-c:a','pcm_s16le',frozen]);assert.equal(voice.ok,true,voice.stderr);
  const proper=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=red:s=128x128:r=25:d=2','-i',frozen,'-map','0:v','-map','1:a','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',good]);assert.equal(proper.ok,true,proper.stderr);
  const replaced=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=red:s=128x128:r=25:d=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=1','-filter_complex','[1:a][2:a]concat=n=2:v=0:a=1[a]','-map','0:v','-map','[a]','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',bad]);assert.equal(replaced.ok,true,replaced.stderr);
  const expectedFrozenSha256=await sha(frozen);
  const matched=await auditFullFrozenAudio({finalPath:good,frozenPath:frozen,expectedFinalSha256:await sha(good),expectedFrozenSha256,durationSeconds:2});
  assert.equal(matched.status,'matched',matched.reason);assert.equal(matched.checkedWindows,2);
  const changed=await auditFullFrozenAudio({finalPath:bad,frozenPath:frozen,expectedFinalSha256:await sha(bad),expectedFrozenSha256,durationSeconds:2});
  assert.equal(changed.status,'failed',changed.reason);assert.deepEqual(changed.failedWindowIndexes,[1]);
  const drift=await auditFullFrozenAudio({finalPath:good,frozenPath:frozen,expectedFinalSha256:'0'.repeat(64),expectedFrozenSha256,durationSeconds:2});
  assert.equal(drift.status,'unknown');assert.match(drift.reason,/SHA/);
 }finally{await rm(root,{recursive:true,force:true});}
});
