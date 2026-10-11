import test from 'node:test';import assert from 'node:assert/strict';import {graphRuntimeInventoryVisible} from '../server/starter198/socialContentGraphRuntimeInventory.js';
test('canonical runtime inventory excludes only matching same-tenant new supply and preserves admitted or unrelated materials',()=>{
 const input={tenantId:'tenant',taskId:'task',admittedRefs:new Set(['original']),canonical:[{providerTaskId:'actual-provider',sha256:'actual-bytes-sha'}]},material={id:'new',tenantId:'tenant',sourceExecutionId:'actual-provider',contentSha256:'actual-bytes-sha'};
 assert.equal(graphRuntimeInventoryVisible(material,input),false);
 assert.equal(graphRuntimeInventoryVisible({...material,id:'original'},input),true);
 assert.equal(graphRuntimeInventoryVisible({...material,contentSha256:'changed-bytes'},input),true);
 assert.equal(graphRuntimeInventoryVisible({...material,tenantId:'other-tenant'},input),true);
 assert.equal(graphRuntimeInventoryVisible({...material,sourceExecutionId:'other-provider'},input),true);
 assert.equal(graphRuntimeInventoryVisible({...material,lineage:{sourceTaskId:'other-task'}},input),true);
 assert.equal(graphRuntimeInventoryVisible({...material,sourceExecutionId:'other',lineage:{sourceTaskId:'task'}},input),false);
});
test('ordinary graph supply has no Studio authority until a canonical scope receipt exists',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const root=await mkdtemp(path.join(os.tmpdir(),'graph-inventory-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const {LangGraphTestStore}=await import('./langgraphTestStore.js'),{admitContentExecutionJob}=await import('../server/contentExecution/durableQueue.js'),{createSocialProductionExecutorCheckpoint}=await import('../server/starter198/socialContentProductionGraph.js'),{readCanonicalGraphRuntimeMedia}=await import('../server/starter198/socialContentGraphRuntimeInventory.js');
 const store=new LangGraphTestStore(path.join(root,'store.json'));
 const detail:any={version:'1',brief:{},sources:[],assetSupplyPlan:{shots:[{shotId:'S01',sourceStrategy:'authorized_digital_presenter'}]},agentWorkflow:{executionPlan:{scenes:[{sceneId:'S01',selectedSourceStrategy:'customer_product_image_animation',candidates:[]}]},directorBrief:{scenes:[]},executionPlanReview:{approved:true,sceneResults:[]}}};
 const checkpoint=createSocialProductionExecutorCheckpoint(detail,{SOCIAL_CONTENT_EXECUTOR:'langgraph'}),job=await admitContentExecutionJob({dataStore:store,tenantId:'tenant',userId:'user',taskId:'task',runId:'run',taskType:'social_content_instant',initialCheckpoints:{'social.executor':checkpoint}});
 const input={dataStore:store,tenantId:'tenant',taskId:'task',runId:'run',approvedContext:(checkpoint.payload as any).approvedContext};
 assert.deepEqual(await readCanonicalGraphRuntimeMedia(input),[],'No canonical adoption must leave ordinary frozen routing untouched');
 await store.create('social_studio_asset_adoptions',{id:'unrelated',tenant_id:'tenant',task_id:'other',run_id:'run',job_id:job.id,shot_id:'S01'});
 assert.deepEqual(await readCanonicalGraphRuntimeMedia(input),[],'Other task receipts cannot claim the current supply');
 await store.create('social_studio_asset_adoptions',{id:'current-invalid',tenant_id:'tenant',task_id:'task',run_id:'run',job_id:job.id,shot_id:'S01'});
 await assert.rejects(()=>readCanonicalGraphRuntimeMedia(input),/studio_adoption_frozen_route_changed/,'Present canonical claims retain strict frozen route enforcement');
});
