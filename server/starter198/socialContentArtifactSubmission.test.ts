import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeSocialArtifactSubmission } from './socialContentArtifactSubmission.js';
import { socialRequestHash } from './socialContentValidation.js';

test('same film and review evidence freeze the exact artifact mutation payload despite retry observation times',async t=>{
 const snapshotRoot=fs.mkdtempSync(path.join(os.tmpdir(),'artifact-snapshot-store-'));t.after(()=>fs.rmSync(snapshotRoot,{recursive:true,force:true}));
 const rows=new Map<string,any>(),ports={snapshotRoot,read:(key:any)=>rows.get(key.inputHash)||null,write:async(key:any)=>{rows.set(key.inputHash,structuredClone(key.payload));}};
 const input={scope:{tenantId:'tenant',taskId:'task',runId:'run'},outputSha256:'a'.repeat(64),requireHumanReview:true,value:{kind:'short_video' as const,origin:'agent' as const,resourceRef:'socialfile:original',content:{generatedMaterial:{materialId:'actual-output',adoptedAt:'first-time'},productionResult:{createdAt:'first-time',technicalReview:{approved:false,failures:['duplicate']}},technicalQualityReport:{audio:{ok:true}},review:{technicalChecksPassed:false}}}};
 const first=await freezeSocialArtifactSubmission(input,ports);
 const retry=structuredClone(input);retry.value.content.generatedMaterial.adoptedAt='later-time';retry.value.content.productionResult.createdAt='later-time';
 const restored=await freezeSocialArtifactSubmission(retry,ports);
 assert.equal(first.idempotencyKey,restored.idempotencyKey);assert.deepEqual(restored.value,first.value);assert.equal(socialRequestHash(restored.value),socialRequestHash(first.value));
 assert.notEqual(first.idempotencyKey,`social-auto-artifact:run:${input.outputSha256}`,'old failed operation remains a separate immutable record');
 const changed=structuredClone(retry);changed.value.content.productionResult.technicalReview.failures.push('measured_media_hard_failure');
 const revision=await freezeSocialArtifactSubmission(changed,ports);assert.notEqual(revision.idempotencyKey,first.idempotencyKey);assert.equal(rows.size,2);
 const foreign=await freezeSocialArtifactSubmission({...input,scope:{...input.scope,runId:'other-run'}},ports);assert.notEqual(foreign.idempotencyKey,first.idempotencyKey);
 const reference=rows.get(first.revisionHash);const snapshotFile=path.join(snapshotRoot,reference.submissionHash+'.json');
 const tampered=JSON.parse(fs.readFileSync(snapshotFile,'utf8'));tampered.value.content.review.technicalChecksPassed=true;fs.writeFileSync(snapshotFile,JSON.stringify(tampered));
 await assert.rejects(freezeSocialArtifactSubmission(input,ports),/snapshot_changed/);
});

test('artifact submission survives cleanup of old evidence paths by replaying the exact frozen value',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'artifact-submission-identity-'));
 try{
  const oldDir=path.join(root,'old-workspace'),newDir=path.join(root,'new-workspace');fs.mkdirSync(oldDir);fs.mkdirSync(newDir);
  const oldFile=path.join(oldDir,'source.wav'),newFile=path.join(newDir,'new-source.wav');fs.writeFileSync(oldFile,'same-frozen-bytes');fs.writeFileSync(newFile,'same-frozen-bytes');
  const rows=new Map<string,any>(),ports={snapshotRoot:path.join(root,'snapshots'),read:(key:any)=>rows.get(key.inputHash)||null,write:async(key:any)=>{rows.set(key.inputHash,structuredClone(key.payload));}};
  const input={scope:{tenantId:'tenant',taskId:'task',runId:'run'},outputSha256:'a'.repeat(64),requireHumanReview:true,value:{kind:'short_video' as const,origin:'agent' as const,resourceRef:'socialfile:owned-file',content:{initialSceneSourceHashes:{voicePath:oldFile},productionResult:{createdAt:'first'},review:{technicalChecksPassed:false}}}};
  const frozen=await freezeSocialArtifactSubmission(input,ports);fs.rmSync(oldDir,{recursive:true});
  const replay=structuredClone(input);replay.value.content.initialSceneSourceHashes.voicePath=newFile;replay.value.content.productionResult.createdAt='later';
  const recovered=await freezeSocialArtifactSubmission(replay,ports);
  assert.equal(recovered.idempotencyKey,frozen.idempotencyKey);assert.deepEqual(recovered.value,frozen.value);
  assert.equal(recovered.value.resourceRef,'socialfile:owned-file','artifact media uses the owned stored file, never an evidence workspace path');
  fs.appendFileSync(newFile,'different');assert.notEqual((await freezeSocialArtifactSubmission(replay,ports)).revisionHash,frozen.revisionHash);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('large artifact payload is content-addressed once while the durable checkpoint stays compact',async t=>{
 const snapshotRoot=fs.mkdtempSync(path.join(os.tmpdir(),'large-artifact-snapshot-'));t.after(()=>fs.rmSync(snapshotRoot,{recursive:true,force:true}));
 const rows=new Map<string,any>();let checkpointBytes=0;
 const ports={snapshotRoot,read:(key:any)=>rows.get(key.inputHash)||null,write:async(key:any)=>{checkpointBytes=Buffer.byteLength(JSON.stringify(key));assert.ok(checkpointBytes<2048);rows.set(key.inputHash,structuredClone(key.payload));}};
 const value={kind:'short_video' as const,origin:'agent' as const,resourceRef:'socialfile:owned-output',content:{technicalQualityReport:{frameAudit:'fixture-frame-evidence-'.repeat(250000)},productionResult:{createdAt:'first'}}};
 const input={scope:{tenantId:'tenant',taskId:'task',runId:'run'},outputSha256:'a'.repeat(64),requireHumanReview:true,value};
 assert.ok(Buffer.byteLength(JSON.stringify(value))>4*1024*1024);
 const first=await freezeSocialArtifactSubmission(input,ports),restored=await freezeSocialArtifactSubmission(input,ports);
 assert.deepEqual(restored.value,first.value);assert.equal(restored.idempotencyKey,first.idempotencyKey);assert.ok(checkpointBytes<2048);
 const reference=rows.get(first.revisionHash);assert.ok(fs.statSync(path.join(snapshotRoot,reference.submissionHash+'.json')).size>8*1024*1024);
 reference.submissionHash='f'.repeat(64);await assert.rejects(freezeSocialArtifactSubmission(input,ports));
});
