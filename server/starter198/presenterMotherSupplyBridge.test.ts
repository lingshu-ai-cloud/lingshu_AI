import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {freezePresenterMotherSegments,type PresenterMotherSlotInput} from '../../shared/contracts/presenterMotherSegments.js';
import {preparePresenterMotherSupply} from './presenterMotherSupplyBridge.js';

const slots:PresenterMotherSlotInput[]=[
 {slotId:'s1',referenceShotId:'r1',startSeconds:0,endSeconds:.4,spokenText:'a',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
 {slotId:'s2',referenceShotId:'r2',startSeconds:.4,endSeconds:4.83,spokenText:'b',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
 {slotId:'s30',referenceShotId:'r30',startSeconds:26.6,endSeconds:28.7,spokenText:'c',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
 {slotId:'s31',referenceShotId:'r31',startSeconds:28.7,endSeconds:29.2,spokenText:'d',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
 {slotId:'s36',referenceShotId:'r36',startSeconds:34.3,endSeconds:37.23,spokenText:'e',materialType:'talking_head',frontFacing:true,lipSyncRequired:true},
];
const sha=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
const qa=(segmentHash:string,outputVideoSha256:string)=>({
 identitySimilarity:.99,identityThreshold:.9,segmentHash,outputVideoSha256,
 frozenAudioSha256:'a'.repeat(64),outputAudioSha256:'b'.repeat(64),
 audioTrackMatchesFrozen:true,audioTrackReceiptRef:'audio:measured',audioTrackReportHash:'c'.repeat(64),
 lipSyncStatus:'passed' as const,lipSyncModelSha256:'d'.repeat(64),lipSyncReceiptRef:'sync:measured',
 lipSyncScore:.96,lipSyncThreshold:.9,receiptRef:'qa:controlled',reportHash:'e'.repeat(64),
});

test('three controlled mother calls become five independent local scene assets',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mother-bridge-'));
 try{
  const grouping=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'a'.repeat(64),slots});
  const calls:string[]=[],crops:string[]=[];
  const prepared=await preparePresenterMotherSupply({grouping,outputDirectory:path.join(root,'crops'),provider:async request=>{
   calls.push(request.segmentId);
   const output=path.join(root,`${request.segmentId}.mp4`),bytes=Buffer.from(`mother:${request.segmentId}`);
   await writeFile(output,bytes);
   return{providerId:'controlled',providerReceiptRef:`receipt:${request.segmentId}`,outputRef:output,
    outputSha256:sha(bytes),durationSeconds:request.durationSeconds,dynamicQa:qa(request.segmentHash,sha(bytes))};
  },cropper:async request=>{
   crops.push(request.crop.slotId);
   const bytes=Buffer.from(`crop:${request.crop.receiptHash}`);await writeFile(request.targetPath,bytes);
   return{localPath:request.targetPath,sha256:sha(bytes)};
  }});
  assert.equal(calls.length,3);assert.equal(crops.length,5);assert.equal(prepared.assets.length,5);
  assert.equal(new Set(prepared.assets.map(asset=>asset.id)).size,5);
  for(const asset of prepared.assets)assert.equal(sha(await readFile(asset.localPath!)),asset.contentHash);
  for(const slot of slots){
   const result=await prepared.adapter.execute({tenantId:'t',taskId:'task',outputDirectory:root,
    shot:{sourceStrategy:'authorized_digital_presenter'} as any,baselineScene:{sceneId:slot.slotId} as any,availableAssets:[]});
   assert.equal(result?.asset.sourceId,slot.slotId);
  }
  assert.equal(prepared.presenterMotherExecution.providerReceipts.length,3);
  assert.equal(prepared.presenterMotherExecution.slotCropReceipts.length,5);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('provider byte drift blocks before any crop or adapter asset is exposed',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mother-bridge-drift-'));
 try{
  const grouping=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:'a'.repeat(64),slots});let crops=0;
  await assert.rejects(preparePresenterMotherSupply({grouping,outputDirectory:root,provider:async request=>{
   const output=path.join(root,`${request.segmentId}.mp4`);await writeFile(output,'changed');
   return{providerId:'controlled',providerReceiptRef:'receipt',outputRef:output,outputSha256:'b'.repeat(64),
    durationSeconds:request.durationSeconds,dynamicQa:qa(request.segmentHash,'b'.repeat(64))};
  },cropper:async()=>{crops++;throw Error('must not run');}}),/provider_bytes_changed/);
  assert.equal(crops,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
