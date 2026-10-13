import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ensureStrictPresenterFirstFrames} from './socialContentPresenterFirstFrameRuntime.js';

const ff=path.resolve('node_modules/ffmpeg-static/ffmpeg');
void (async()=>{
const dir=await mkdtemp(path.join(os.tmpdir(),'presenter-intro-'));
const sourcePath=path.join(dir,'source.mp4'),approvedPath=path.join(dir,'approved.jpg');
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
try{
  execFileSync(ff,['-v','error','-y','-f','lavfi','-i','color=c=red:s=720x1280:d=0.5:r=30','-c:v','libx264','-pix_fmt','yuv420p',sourcePath]);
  execFileSync(ff,['-v','error','-y','-f','lavfi','-i','color=c=blue:s=720x1280','-frames:v','1',approvedPath]);
  const sourceSha256=sha(await readFile(sourcePath)),approvedSha256=sha(await readFile(approvedPath));
  const result=await ensureStrictPresenterFirstFrames({tenantId:'test',runId:randomUUID(),groupId:'group-1',sourcePath,sourceSha256,approvedPath,approvedSha256});
  assert.equal(result.repaired,true);
  assert.notEqual(result.outputSha256,sourceSha256);
  assert.equal(sha(await readFile(sourcePath)),sourceSha256,'provider original remains immutable');
  assert.ok(result.metrics.every(frame=>frame.pixelSimilarity>=.9&&frame.structuralSimilarity>=.8));
  await rm(result.outputPath,{force:true});await rm(result.outputPath.replace(/\.mp4$/,'.json'),{force:true});
}finally{await rm(dir,{recursive:true,force:true});}

})().catch(error=>{console.error(error);process.exitCode=1});
