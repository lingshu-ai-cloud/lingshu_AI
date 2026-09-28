import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLocalMaterials, readMaterialLibrary, upsertSocialTaskMaterial } from './materialLibrary.js';
import { readCloudMaterialLibrary } from './cloudMaterials.js';
const ready = { source: 'database' as const, state: 'ready' as const, message: 'ok' };
const down = { source: 'database' as const, state: 'unavailable' as const, message: 'down' };
const local = () => [{ id: 'mine', tenantId: 'a' }, { id: 'theirs', tenantId: 'b' }, { id: 'shared', scope: 'shared' }, { id: 'fake', tenantId: 'a', synthetic: true }];
const good = await readMaterialLibrary('a', {local, cloud: async () => ({ items: [], source: ready })});
assert.equal(good.status, 'ready'); assert.deepEqual(good.items.map(item => item.id), ['mine', 'shared']);
const partial = await readMaterialLibrary('a', {local, cloud: async () => ({ items: [], source: down })});
assert.equal(partial.status, 'partial'); assert.equal(partial.items.length, 2);
const failed = await readMaterialLibrary('a', {local: () => { throw Error('corrupt'); }, cloud: async () => ({ items: [], source: down })});
assert.equal(failed.status, 'unavailable');
const empty = await readMaterialLibrary('a', {local: () => [], cloud: async () => ({ items: [], source: ready })});
assert.equal(empty.status, 'ready'); assert.equal(empty.items.length, 0);
let pages = 0;
const paged = await readCloudMaterialLibrary('a', async (_url, options) => {
  assert.ok(options?.signal); pages++;
  return Response.json({totalPages:2, items: [{id:`mine${pages}`,tenantId:'a'}, {id:'private',tenantId:'b'}]});
});
assert.equal(pages,2); assert.deepEqual(paged.items.map(item => item.id), ['pb-mine1','pb-mine2']);
const denied = await readCloudMaterialLibrary('a', async () => new Response('', {status:403}));
assert.equal(denied.source.state, 'unauthorized');
const broken = await readCloudMaterialLibrary('a', async () => {throw Error('offline');});
assert.equal(broken.source.state,'unavailable');
console.log('material library: tenant isolation, empty/failed distinction, partial access, pagination and authorization passed');
const originalCwd = process.cwd();
const materialRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-material-upsert-'));
try {
  process.chdir(materialRoot);
  const sha = 'a'.repeat(64);
  const baseRecord = { id: 'material-a', name: '产品图.png', type: 'image', tenantId: 'a', scope: 'own', createdAt: new Date(0).toISOString() };
  const first = upsertSocialTaskMaterial({
    id: 'material-a', tenantId: 'a', taskId: 'task-a', taskFileRef: 'socialfile:file-a',
    contentSha256: sha, productId: 'product-a', productName: '产品 A', record: baseRecord,
  });
  const reused = upsertSocialTaskMaterial({
    id: 'ignored-second-id', tenantId: 'a', taskId: 'task-b', taskFileRef: 'socialfile:file-b',
    contentSha256: sha, productId: 'product-b', productName: '产品 B', record: { ...baseRecord, id: 'ignored-second-id' },
  });
  const isolated = upsertSocialTaskMaterial({
    id: 'material-b', tenantId: 'b', taskId: 'task-c', taskFileRef: 'socialfile:file-c',
    contentSha256: sha, productId: 'product-c', productName: '产品 C', record: { ...baseRecord, id: 'material-b', tenantId: 'b' },
  });
  assert.equal(reused.id, first.id, 'same tenant and SHA reuse one material identity');
  assert.deepEqual(reused.sourceTaskIds, ['task-a', 'task-b']);
  assert.deepEqual(reused.productRefs, ['产品 A', '产品 B']);
  assert.equal(reused.productId, 'product-b', '关联产品使用稳定 ID');
  assert.equal(reused.productName, '产品 B', '展示名与稳定 ID 分开保存');
  assert.notEqual(isolated.id, first.id, 'a second tenant never reuses another tenant material identity');
  assert.equal(readLocalMaterials().length, 2);
} finally {
  process.chdir(originalCwd);
  fs.rmSync(materialRoot, { recursive: true, force: true });
}
console.log('social task material upsert: SHA deduplication, task/product associations and tenant isolation passed');
const { normalizeMaterialObservations } = await import('./materialObservation.js');
const continuous = normalizeMaterialObservations('real',32,{segments:[{start:0,end:32,observedFacts:['绿色电路板上有银色焊点'],confidence:.9,needsReview:false}]});
assert.equal(continuous.length,1); assert.equal(continuous[0].end,32);
const labeled = normalizeMaterialObservations('real', 8, { segments: [
  { start: 0, end: 4, observedFacts: ['可见工人操作灌装设备'], visualTopic: '工厂生产', expressionPurpose: '建立信任', confidence: .9, needsReview: false },
  { start: 4, end: 8, observedFacts: ['可见瓶身特写'], visualTopic: '产品展示', expressionPurpose: '展示产品', confidence: .9, needsReview: false },
] });
assert.equal(labeled[0].visualTopic, '工厂生产');
assert.equal(labeled[0].expressionPurpose, '建立信任');
assert.deepEqual(labeled[0].recommendedFunctions, ['建立信任']);
assert.equal(labeled[1].visualTopic, '产品展示');
assert.equal(labeled[1].expressionPurpose, '展示产品');
assert.deepEqual(continuous[0].recommendedFunctions, [], 'older analyses without purpose stay unlabeled');
assert.throws(()=>normalizeMaterialObservations('real',10,{segments:[{start:0,end:20,observedFacts:['test']}]}));
assert.throws(()=>normalizeMaterialObservations('real',10,{segments:[{start:0,end:8,observedFacts:['test']},{start:5,end:9,observedFacts:['test']}]}));
assert.equal(normalizeMaterialObservations('real',10,{segments:[{start:0,end:8,observedFacts:['test']} ]})[0].needsReview,true);
console.log('material observation: continuous take, invalid intervals, overlap and uncertainty passed');
const { pendingLocalMaterialAnalysisIds, localMaterialMediaPath } = await import('./materialLibraryAnalysis.js');
assert.equal(localMaterialMediaPath({ id: 'legacy', url: '/media/tenants/tenant-a/video.mp4' }, '/tmp/media'), '/tmp/media/tenants/tenant-a/video.mp4');
assert.throws(() => localMaterialMediaPath({ id: 'unsafe', file: '../secret.mp4' }, '/tmp/media'));
assert.deepEqual(pendingLocalMaterialAnalysisIds('tenant-a', [
  { id: 'new-video', tenantId: 'tenant-a', type: 'video', usage: 'editable' },
  { id: 'ready-video', tenantId: 'tenant-a', type: 'video', segmentAnalysisStatus: 'completed' },
  { id: 'failed-video', tenantId: 'tenant-a', type: 'video', segmentAnalysisStatus: 'failed' },
  { id: 'reference', tenantId: 'tenant-a', type: 'video', usage: 'reference_only' },
  { id: 'other-tenant', tenantId: 'tenant-b', type: 'video' },
  { id: 'photo', tenantId: 'tenant-a', type: 'image' },
]), ['new-video']);
console.log('legacy local video analysis: owner-only auto-start and completed-result reuse passed');
const { KeyedWorkQueue } = await import('./keyedWorkQueue.js');
const queue = new KeyedWorkQueue(2);
let running=0, maxRunning=0, calls=0;
const gates: Array<()=>void>=[];
const enqueue=(key:string)=>queue.enqueue(key,async()=>{},async()=>{calls++;running++;maxRunning=Math.max(maxRunning,running);await new Promise<void>(r=>gates.push(r));running--;},()=>{});
await Promise.all([enqueue('a'),enqueue('a'),enqueue('b'),enqueue('c')]);
assert.equal(calls,2); assert.equal(maxRunning,2);
const a=queue.get('a')!;gates.shift()!();await a;await Promise.resolve();assert.equal(calls,3);
const remaining=[queue.get('b'),queue.get('c')];gates.splice(0).forEach(release=>release());await Promise.all(remaining);
assert.equal(maxRunning,2);assert.equal(queue.has('a'),false);
let started=false;
await assert.rejects(queue.enqueue('bad',async()=>{throw Error('persist failed');},async()=>{started=true;},()=>{}));
await Promise.resolve();assert.equal(started,false);assert.equal(queue.has('bad'),false);
console.log('analysis queue: deduplication, concurrency limit, failed reservation and cleanup passed');
const grounded = normalizeMaterialObservations('real',10,{segments:[{start:0,end:8,observedFacts:['绿色板面和银色凸点','板上有透明水滴','疑似铜制部件'],confidence:1,needsReview:false}]})[0];
assert.deepEqual(grounded.observedFacts,['绿色板面和银色凸点']);assert.equal(grounded.needsReview,false);assert.equal((grounded.excludedObservations as any[]).length,2);
console.log('unverified composition and uncertain claims excluded from automatic narration evidence');
const {materialShotPlan}=await import('../../src/lib/materialShotPlan.js');
const sources=['a','b'].map(id=>({id,name:id,type:'video',duration:20,segments:[{start:0,end:20,confidence:.9,needsReview:false,observedFacts:['可见板面']}]}));
const plan=materialShotPlan(sources,10);
assert.equal(plan.length,2);assert.equal(new Set(plan.map(s=>s.materialId)).size,2);assert.equal(plan.at(-1)?.targetEnd,10);
for(const a of plan)for(const b of plan)if(a!==b && a.materialId===b.materialId)assert.ok(a.sourceEnd<=b.sourceStart || b.sourceEnd<=a.sourceStart);
assert.throws(()=>materialShotPlan(sources,20),/不循环使用/);
assert.throws(()=>materialShotPlan(sources,80),/补充素材/);
assert.equal(new Set(plan.map(s=>s.materialId)).size,plan.length);
const {hardScriptSafetyIssues}=await import('./studioScriptQualityV2.js');
assert.ok(hardScriptSafetyIssues('台词：肉眼就能判良率。','绿色板面').length);
assert.ok(hardScriptSafetyIssues('台词：这块板子没少做治具校准。','绿色板面').length);
console.log('real excerpt rotation, coverage gaps, overlap and unsupported process claims passed');
const {finalizeMaterialScript}=await import('./materialScriptFinalizer.js');
let reviewCalls=0;
const finalized=await finalizeMaterialScript({script:'[0-4s]\n台词：Look at the circuit board.\n[4-8s]\n台词：Perfect quality.',facts:'可见电路板',language:'en',infos:[{name:'a',targetStart:0,targetEnd:4,observations:['电路板']},{name:'b',targetStart:4,targetEnd:8,observations:['焊点']}]},async()=>{
 reviewCalls++;
 return {backend:'qwen',fallbackReason:'',text:reviewCalls===1?JSON.stringify({issues:[{quote:'Perfect quality.',reason:'no quality evidence'}]}):reviewCalls===2?JSON.stringify({lines:['Unwanted rewrite.','Look at the solder joints.']}):JSON.stringify({issues:[]})};
});
assert.match(finalized,/Look at the circuit board\./);assert.doesNotMatch(finalized,/Unwanted rewrite|Perfect quality/);assert.match(finalized,/Look at the solder joints/);assert.equal(reviewCalls,3);
console.log('narration repair preserves unaffected scenes and rechecks changed text');
