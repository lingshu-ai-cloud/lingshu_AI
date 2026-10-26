import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SocialReplicationScriptVersion } from '../../shared/contracts/socialContentDiscovery.js';
import type { AssistantScenePlan } from '../../shared/contracts/assistantScenePlan.js';
import type { GuidedReply } from '../../shared/contracts/guidedCreation.js';
import { sceneNarration, verifySceneMaterials } from './assistantSceneEvidence.js';

const lines = [{lineId:'line-001',referenceText:'OldProduct launch',draftText:'NewProduct launch'},
  {lineId:'line-002',referenceText:'Call OldBrand',draftText:'Call NewBrand'}] as NonNullable<SocialReplicationScriptVersion['narrationLines']>;
const scene:AssistantScenePlan={kind:'campaign',groupId:'campaign-1',plannedPublishAt:'2099-01-05T08:00:00+08:00',deliverBy:'2099-01-04T08:00:00+08:00',campaign:{name:'新品活动',offer:'满千减百',sellingPoints:'真实卖点',materialIds:['uploaded-video']},narrationEdits:[],narrationConfirmed:false};
test('edited activity narration is bound to every original line and rejects stale identities',()=>{
  assert.deepEqual(sceneNarration(scene,lines).map(row=>row.text),['NewProduct launch','Call NewBrand']);
  const confirmed={...scene,narrationConfirmed:true,narrationEdits:[{lineId:'line-001',text:'新品活动：NewProduct'}, {lineId:'line-002',text:'满千减百，条件以活动页面为准'}]};
  assert.deepEqual(sceneNarration(confirmed,lines).map(row=>row.sourceText),['OldProduct launch','Call OldBrand']);
  assert.deepEqual(sceneNarration(confirmed,lines).map(row=>row.text),['新品活动：NewProduct','满千减百，条件以活动页面为准']);
  assert.throws(()=>sceneNarration({...confirmed,narrationEdits:confirmed.narrationEdits.slice(0,1)},lines),/已变化/);
  assert.throws(()=>sceneNarration({...confirmed,narrationEdits:[...confirmed.narrationEdits,{lineId:'foreign',text:'injected'}]},lines),/已变化/);
});
test('activity upload must occupy a matched explanatory shot; hook needs exact owned segment',()=>{
  const nodes=[{id:'hook',type:'product',description:'',duration:3,candidates:[],status:'matched',selectedCandidateId:'other'},
    {id:'explain',type:'product',description:'',duration:3,candidates:[],status:'matched',selectedCandidateId:'upload'},
    {id:'cta',type:'product',description:'',duration:3,candidates:[],status:'matched',selectedCandidateId:'other'}] as GuidedReply['nodes'];
  const candidates=[{id:'other',sourceId:'other-video',segmentId:'s1',title:'',description:'',type:'product',start:0,end:3,productionEligible:true},
    {id:'upload',sourceId:'uploaded-video',segmentId:'s2',title:'',description:'',type:'product',start:3,end:6,productionEligible:true}] as GuidedReply['candidates'];
  const blockers:GuidedReply['blockers']=[];
  verifySceneMaterials({...scene,narrationConfirmed:true},nodes,candidates,blockers);assert.equal(blockers.length,0);
  verifySceneMaterials({...scene,narrationConfirmed:true,campaign:{...scene.campaign!,materialIds:['missing']}},nodes,candidates,blockers);
  assert.ok(blockers.some(row=>row.code==='creation_campaign_material_unmatched'));
  blockers.length=0;
  verifySceneMaterials({kind:'hook_first',groupId:'hook-1',plannedPublishAt:scene.plannedPublishAt,deliverBy:scene.deliverBy,hook:{materialId:'uploaded-video',startSeconds:3,endSeconds:6,usage:'editable',direction:'展示产品'},narrationEdits:[],narrationConfirmed:true},nodes,candidates,blockers);
  assert.ok(blockers.some(row=>row.code==='creation_hook_range_unmatched'));
  blockers.length=0;
  verifySceneMaterials({kind:'hook_first',groupId:'hook-ref',plannedPublishAt:scene.plannedPublishAt,deliverBy:scene.deliverBy,hook:{materialId:'reference-video',startSeconds:0,endSeconds:3,usage:'reference_only',direction:'展示产品'},narrationEdits:[],narrationConfirmed:true},nodes,candidates,blockers,true);
  assert.equal(blockers.length,0,'same-source reviewed reference opening is a structure input, not enterprise footage');
});
