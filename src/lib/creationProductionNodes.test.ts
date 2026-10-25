import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow';
import { creationProductionNodes } from './creationProductionNodes';
const task={taskId:'task',runId:null,status:'plan_review',createdAt:'2026-10-26T00:00:00Z',updatedAt:'2026-10-26T00:00:00Z',brief:{},readiness:{complete:false,missing:['material']},artifacts:[],deliveryPackages:[],directorPlan:{status:'ready',sceneCount:8}} as unknown as SocialContentTaskDetail;
test('waiting task shows every planned node without presenting a draft plan as executed',()=>{
  const nodes=creationProductionNodes(task);
  assert.equal(nodes.length,12);assert.equal(nodes[0].state,'complete');assert.ok(nodes.slice(1).every(node=>node.state==='pending'));
  for(const id of ['script','storyboard','materials','visuals','voice','captions','edit','quality','export'])assert.ok(nodes.some(node=>node.id===id));
});
test('a real run updates only evidenced nodes; rendering never implies completed voice or captions',()=>{
  const nodes=creationProductionNodes({...task,status:'producing',runId:'run',productionProgress:{step:'剪辑合成',activity:'正在合成',estimatedRemainingSeconds:null,updatedAt:task.updatedAt}});
  assert.equal(nodes.find(node=>node.id==='storyboard')?.state,'complete');
  assert.equal(nodes.find(node=>node.id==='edit')?.state,'active');
  assert.equal(nodes.find(node=>node.id==='voice')?.state,'pending');assert.equal(nodes.find(node=>node.id==='captions')?.state,'pending');
});
test('partial actual shot receipts cannot complete the whole material or visual stage',()=>{
  const running={...task,runId:'run',status:'producing',agentWorkflow:{directorBrief:{scenes:[],totalDurationSeconds:18},executionPlan:{scenes:[{},{},{}]},productionResult:{sceneResults:[{mediaArtifact:{resourceRef:'/actual-shot'}}],technicalReview:{approved:false},creativeReview:{approved:false}}}} as unknown as SocialContentTaskDetail;
  const nodes=creationProductionNodes(running);
  assert.equal(nodes.find(node=>node.id==='materials')?.state,'active');assert.match(nodes.find(node=>node.id==='visuals')!.result,/1\/3/);
  assert.equal(nodes.find(node=>node.id==='export')?.state,'pending');
});


test('managed preparation and blocked admission cannot appear as successful dispatch',()=>{
  const blocked={...task,executionAdmission:{state:'blocked' as const,reason:'product_identity_required'}};
  assert.equal(creationProductionNodes(blocked)[1].state,'blocked');
  assert.match(creationProductionNodes(blocked)[1].result,/启动受阻/);
  assert.equal(creationProductionNodes({...task,executionAdmission:{state:'preparing'}})[1].state,'active');
  assert.equal(creationProductionNodes({...task,executionAdmission:{state:'queued',queueItemId:'queue'}})[1].state,'active');
});
