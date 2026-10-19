import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {freezeSocialRenderFrameContract,readSocialRenderFrameContract} from './socialRenderFrameContract.js';
import {verifySocialFrameRenderAttestation} from './socialContentProductionStages.js';
import {probeSocialSceneMedia} from './socialSceneMediaHardProbe.js';

const require=createRequire(import.meta.url);
const {composite}=require('../../desktop/render.cjs') as {composite:(manifest:unknown,onProgress:undefined,dir:string)=>Promise<{ok:boolean;outputPath?:string;error?:string;frameRenderEvidence?:{schemaVersion:'renderer-frame-attestation.v1';outputSha256:string;fps:30;durationSeconds:number;expectedFrames:number}}>};

test('new frozen 30-fps contract is bound through actual noninteger-duration render and decoded MP4',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'render-frame-contract-'));
 try{
  const duration=1.02,frameContract=freezeSocialRenderFrameContract(duration);
  assert.equal(frameContract.expectedFrames,31);
  const manifest={jobId:'frame-contract-test',spec:{ratio:'1:1',resolution:'720p',duration},frameContract,timeline:[],bgm:{url:null},voiceover:{url:null},subtitles:{mode:'off',cues:[]}};
  assert.equal((await composite({...manifest,frameContract:{...frameContract,expectedFrames:30}},undefined,dir)).ok,false,'renderer must reject a forged count before rendering');
  const rendered=await composite(manifest,undefined,dir);assert.equal(rendered.ok,true,rendered.error);
  const verified=verifySocialFrameRenderAttestation({raw:rendered,outputSha256:rendered.frameRenderEvidence!.outputSha256,manifest});assert.ok(verified);
  const probe=await probeSocialSceneMedia({filePath:rendered.outputPath!,manifest:{...manifest,timeline:[{sceneId:'one',targetStart:0,targetEnd:duration}]},frameRenderEvidence:verified});
  assert.equal(probe.finalPrivacyCoverage?.status,'observed',JSON.stringify(probe.finalPrivacyCoverage));
  assert.equal(probe.finalPrivacyCoverage?.video.decodedFrames,31);
  assert.equal(verifySocialFrameRenderAttestation({raw:rendered,outputSha256:'a'.repeat(64),manifest}),undefined);
  assert.equal(readSocialRenderFrameContract({...manifest,frameContract:{...frameContract,expectedFrames:30}}),null);
  assert.equal((await probeSocialSceneMedia({filePath:rendered.outputPath!,manifest:{...manifest,timeline:[{sceneId:'one',targetStart:0,targetEnd:duration}]},frameRenderEvidence:{...verified!,expectedFrames:30}})).finalPrivacyCoverage?.status,'unknown','changed renderer frame claim cannot authorize observed coverage');
  assert.equal((await probeSocialSceneMedia({filePath:rendered.outputPath!,manifest:{...manifest,timeline:[{sceneId:'one',targetStart:0,targetEnd:duration}]}})).finalPrivacyCoverage?.status,'unknown','missing renderer receipt cannot self-certify expected frames');
  const shortDuration=1.01,shortContract=freezeSocialRenderFrameContract(shortDuration);
  assert.equal(shortContract.expectedFrames,30,'30.3 frames must follow renderer nearest-frame rounding, not ceil');
  const shortManifest={...manifest,jobId:'frame-contract-round-down',spec:{...manifest.spec,duration:shortDuration},frameContract:shortContract};
  const shortRender=await composite(shortManifest,undefined,dir);assert.equal(shortRender.ok,true,shortRender.error);
  const shortReceipt=verifySocialFrameRenderAttestation({raw:shortRender,outputSha256:shortRender.frameRenderEvidence!.outputSha256,manifest:shortManifest});assert.ok(shortReceipt);
  const shortProbe=await probeSocialSceneMedia({filePath:shortRender.outputPath!,manifest:{...shortManifest,timeline:[{sceneId:'one',targetStart:0,targetEnd:shortDuration}]},frameRenderEvidence:shortReceipt});
  assert.equal(shortProbe.finalPrivacyCoverage?.status,'observed',JSON.stringify(shortProbe.finalPrivacyCoverage));assert.equal(shortProbe.finalPrivacyCoverage?.video.decodedFrames,30);
 }finally{await rm(dir,{recursive:true,force:true});}
});
