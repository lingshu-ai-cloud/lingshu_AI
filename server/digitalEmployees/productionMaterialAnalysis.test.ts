import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyMaterialAnalysis, materialFrameBatches, materialRevision, analyzeProductionMaterial } from './productionMaterialAnalysis.js';
import { resolvePresentationMaterials } from './contentProduction.js';
import type { AssetCandidate } from './contentProduction.js';
import { normalizeVideoPlan } from '../../src/lib/videoCreationPlan.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'material-cache-test-'));
try {
  const batches = materialFrameBatches(Array.from({ length: 48 }, (_, index) => ({
    base64: '', mimeType: 'image/jpeg', timeLabel: `${index}s`,
  })), 48, 20);
  assert.deepEqual(batches.map(item => item.frames.length), [20, 20, 8]);
  assert.deepEqual(batches.map(item => [item.start, item.end]), [[0, 19.5], [19.5, 39.5], [39.5, 48]], 'analysis windows must be contiguous and non-overlapping');
  const file=path.join(root,'asset.png');fs.writeFileSync(file,'before');
  const asset: AssetCandidate = {id:'asset',name:'not evidence',type:'image',duration:0,localPath:file,observations:[],visualObservations:[],segments:[],tags:[],source:'enterprise_product',productId:'product',synthetic:false,authorization:{status:'owned',scope:'tenant',evidence:'upload'}};
  const cache={revision:materialRevision(asset),observations:['正面电路板'],segments:[],duration:0};
  assert.deepEqual(applyMaterialAnalysis(asset,cache).visualObservations,['正面电路板']);
  fs.writeFileSync(file,'changed bytes and size');
  assert.deepEqual(applyMaterialAnalysis(asset,cache).visualObservations,[],'changed file cannot reuse previous vision observations');
  assert.notEqual(materialRevision(asset),cache.revision);
  assert.deepEqual(applyMaterialAnalysis({...asset,id:'other-tenant-asset'},cache).visualObservations,[]);
  await assert.rejects(()=>analyzeProductionMaterial({...asset,localPath:undefined,url:'https://example.invalid/media.mp4'},'tenant'),/production_input_required/,'external URLs must not trigger uncontrolled downloads');
  const observed={...asset,visualObservations:['正面电路板']};
  const script='[0-10s]\n画面：正面电路板\n台词：Confirmed content';
  const brief=normalizeVideoPlan({presenter:'material',materialIds:['asset']});
  assert.equal(resolvePresentationMaterials(brief,script,[{start:0,end:10}],[observed],'product',{productId:'other-product',assetIds:['asset']}).plan.length,0,'semantic match must not cross product ownership');
  assert.equal(resolvePresentationMaterials(brief,script,[{start:0,end:10}],[{...observed,authorization:{...observed.authorization,status:'unknown'}}],'product',{productId:'product',assetIds:['asset']}).plan.length,0,'unlicensed content cannot repair a scene');
  const success=resolvePresentationMaterials(brief,script,[{start:0,end:10}],[observed],'product',{productId:'product',assetIds:['asset']});
  assert.equal(success.plan[0].evidenceSegmentId,'asset:image');
  assert.deepEqual(success.plan[0].observations,['正面电路板']);
  console.log('Material analysis revision, ownership, authorization and matching integration tests passed (no provider calls).');
} finally {fs.rmSync(root,{recursive:true,force:true});}
const { productionQualitySummary } = await import('./productionQualitySummary.js');
const summary=productionQualitySummary({automation:{stage:'blocked',sceneRepairAttempts:1,renderOutputPath:'/private/file.mp4',quality:{passed:false,sceneDiagnostics:{issues:[{sceneIndex:2,start:20,end:30,reason:'镜头重复'}]}},sceneRepairHistory:[{replacements:[{sceneIndex:2}]}]}});
assert.equal(summary.problems[0].shot,3);assert.match(summary.lastRepair!.message,/仍有问题/);assert.ok(!JSON.stringify(summary).includes('/private'));

const { readMaterialBytes } = await import('./productionMaterialAnalysis.js');
let cancelled=false;
await assert.rejects(()=>readMaterialBytes((async function*(){yield Buffer.alloc(8);yield Buffer.alloc(8);})(),{limit:10,cancel:()=>{cancelled=true;}}),/production_input_required/);
assert.equal(cancelled,true);
cancelled=false;
await assert.rejects(()=>readMaterialBytes({[Symbol.asyncIterator]:()=>({next:()=>new Promise(()=>{})})},{timeoutMs:5,cancel:()=>{cancelled=true;}}),/超时/);
assert.equal(cancelled,true);
assert.equal((await readMaterialBytes((async function*(){yield Buffer.from('ok');})())).toString(),'ok');
