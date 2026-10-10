import assert from 'node:assert/strict';
import test from 'node:test';
import { clusterSourceFirstFrameMaterialId, planPersonShotClusters } from './personShotClustering.js';

const cue = (id:string, patch:Record<string,unknown>={}) => ({ id,start:0,end:1,originalText:id,targetText:id,shotIds:[id],...patch });
test('only person shots form paid first-frame clusters and identical compositions reuse one frame',()=>{
  const plan=planPersonShotClusters([cue('p1',{personShot:true,compositionClusterId:'front-medium'}),cue('p2',{personShot:true,compositionClusterId:'front-medium'}),cue('b1',{personShot:false,nonPersonMaterialId:'factory-video'})] as any);
  assert.equal(plan.state,'ready'); assert.equal(plan.clusters.length,1); assert.deepEqual(plan.clusters[0]!.cueIds,['p1','p2']); assert.deepEqual(plan.nonPersonCueIds,['b1']);
});
test('a video without person shots requests zero first frames',()=>{ const plan=planPersonShotClusters([cue('b1',{personShot:false,nonPersonMaterialId:'m1'})] as any); assert.equal(plan.clusters.length,0); assert.equal(plan.state,'ready'); });
test('more than three compositions stops with explicit merge suggestions',()=>{ const plan=planPersonShotClusters(Array.from({length:4},(_,i)=>cue(`p${i}`,{personShot:true,compositionClusterId:`cluster-${i}`})) as any); assert.equal(plan.state,'needs_decision'); assert.equal(plan.clusters.length,4); assert.equal(plan.mergeSuggestions.length,1); assert.match(plan.blockers.join(''),/超过上限 3/); });
test('unclassified and non-person cues without replacement media fail closed',()=>{ const plan=planPersonShotClusters([cue('unknown'),cue('b',{personShot:false})] as any); assert.equal(plan.state,'needs_decision'); assert.equal(plan.blockers.length,2); });
test('a composition cluster resolves its representative source material instead of using the JSON fingerprint as an id',()=>{const cues=[cue('p1',{personShot:true,compositionClusterId:'front-medium',sourceFirstFrame:{time:0,materialId:'source-frame-real'}}),cue('p2',{personShot:true,compositionClusterId:'front-medium',sourceFirstFrame:{time:1,materialId:'source-frame-other'}})] as any;const plan=planPersonShotClusters(cues);assert.notEqual(plan.clusters[0]!.fingerprint,'source-frame-real');assert.equal(clusterSourceFirstFrameMaterialId(plan.clusters[0]!,cues),'source-frame-real');});
