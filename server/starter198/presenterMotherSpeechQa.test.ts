import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import {assertPresenterMotherSpeechQaReady,inspectPresenterMotherSpeechQa} from './presenterMotherSpeechQa.js';

const run=promisify(execFile),sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const accepted={version:1 as const,detector:'official_syncnet' as const,modelSha256:'a'.repeat(64),passed:true,
 confidence:8,avOffsetFrames:0,thresholds:{confidenceMin:7,absoluteOffsetFramesMax:1},failures:[]};
async function media(root:string,tone:number){
 const wav=path.join(root,`tone-${tone}.wav`),mp4=path.join(root,`tone-${tone}.mp4`);
 await run(String(ffmpegStatic||'ffmpeg'),['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i',`sine=frequency=${tone}:duration=1.2:sample_rate=24000`,'-ac','1','-c:a','pcm_s16le','-y',wav]);
 await run(String(ffmpegStatic||'ffmpeg'),['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','color=c=black:s=160x160:r=25:d=1.2','-i',wav,'-shortest','-c:v','libx264','-c:a','aac','-y',mp4]);
 return{wav,mp4};
}

test('decoded rendered audio matches the exact frozen utterance before lip-sync evidence is accepted',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mother-speech-qa-'));
 try{
  const first=await media(root,440),second=await media(root,660);
  const segmentHash='b'.repeat(64),frozenAudioSha256=sha(await readFile(first.wav));
  let syncCalls=0;
  const common={segmentHash,outputPath:first.mp4,outputSha256:sha(await readFile(first.mp4)),
   frozenAudioPath:first.wav,frozenAudioSha256,workDir:path.join(root,'qa'),
   inspectLipSync:async()=>{syncCalls++;return accepted;}};
  const success=await inspectPresenterMotherSpeechQa(common);
  assert.equal(success.audioTrackMatchesFrozen,true);assert.equal(success.lipSyncStatus,'passed');
  assert.match(success.audioTrackReportHash,/^[a-f0-9]{64}$/);assert.equal(syncCalls,1);
  await assert.rejects(inspectPresenterMotherSpeechQa({...common,outputPath:second.mp4,
   outputSha256:sha(await readFile(second.mp4)),workDir:path.join(root,'bad')}),/frozen_audio_track_mismatch/);
  assert.equal(syncCalls,1,'unrelated output must not reach the lip-sync pass');
  await assert.rejects(inspectPresenterMotherSpeechQa({...common,inspectLipSync:async()=>({...accepted,passed:false,
   confidence:6,failures:['below threshold']})}),/lip_sync_failed/);
  await writeFile(first.wav,'changed');
  await assert.rejects(inspectPresenterMotherSpeechQa(common),/bytes_changed/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('missing official model and runner fail before a paid mother video submission',()=>{
 assert.throws(()=>assertPresenterMotherSpeechQaReady({DIGITAL_HUMAN_SYNCNET_QA_ENABLED:'true',
  DIGITAL_HUMAN_SYNCNET_QA_PYTHON:'/nonexistent/python',DIGITAL_HUMAN_SYNCNET_DIR:'/nonexistent/syncnet'}),
 /frozen_audio_and_lip_sync_qa_unavailable/);
});

test('missing official face detector weights fail the paid mother video preflight',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mother-syncnet-preflight-'));
 try{
  const syncnet=path.join(root,'syncnet'),python=path.join(root,'python');
  await mkdir(path.join(syncnet,'data'),{recursive:true});
  await writeFile(python,'fixture');
  await writeFile(path.join(syncnet,'data','syncnet_v2.model'),'fixture');
  await writeFile(path.join(syncnet,'run_pipeline.py'),'fixture');
  await writeFile(path.join(syncnet,'run_syncnet.py'),'fixture');
  const env={DIGITAL_HUMAN_SYNCNET_QA_ENABLED:'true',DIGITAL_HUMAN_SYNCNET_QA_PYTHON:python,DIGITAL_HUMAN_SYNCNET_DIR:syncnet};
  assert.throws(()=>assertPresenterMotherSpeechQaReady(env),/frozen_audio_and_lip_sync_qa_unavailable/);
  await mkdir(path.join(syncnet,'detectors','s3fd','weights'),{recursive:true});
  await writeFile(path.join(syncnet,'detectors','s3fd','weights','sfd_face.pth'),'fixture');
  assert.throws(()=>assertPresenterMotherSpeechQaReady(env),/commercial_lip_sync_model_rights_unverified/,
   'technical files do not prove that both pretrained weights are licensed for commercial production');
  assert.throws(()=>assertPresenterMotherSpeechQaReady({...env,DIGITAL_HUMAN_SYNCNET_COMMERCIAL_RIGHTS_APPROVED:'true'}),
   /commercial_lip_sync_model_rights_unverified/,'an environment self-attestation must not bypass independent review');
  assert.throws(()=>assertPresenterMotherSpeechQaReady({...env,
   DIGITAL_HUMAN_SYNCNET_RIGHTS_DOCUMENT:'/tmp/self-declared-license.pdf',
   DIGITAL_HUMAN_S3FD_RIGHTS_DOCUMENT:'/tmp/self-declared-license.pdf'}),
  /commercial_lip_sync_model_rights_unverified/,'a document path does not bind either model byte hash to independently reviewed commercial rights');
  await writeFile(path.join(syncnet,'data','syncnet_v2.model'),'replacement-weights');
  await writeFile(path.join(syncnet,'detectors','s3fd','weights','sfd_face.pth'),'replacement-face-weights');
  assert.throws(()=>assertPresenterMotherSpeechQaReady(env),/commercial_lip_sync_model_rights_unverified/,
   'swapped weight bytes must not become authorized merely because expected filenames still exist');
 }finally{await rm(root,{recursive:true,force:true});}
});
