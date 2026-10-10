import test from 'node:test';import assert from 'node:assert/strict';
test('actual isolated owned image enters reference planning but cannot start production before consumer verification',async t=>{
 const keys=['SEEDANCE_VIDEO_ENABLED','SEEDANCE_API_KEY','SEEDREAM_API_KEY'] as const;const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));t.after(()=>{for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}});
 process.env.SEEDANCE_VIDEO_ENABLED='true';process.env.SEEDANCE_API_KEY='controlled-transport-no-real-provider';process.env.SEEDREAM_API_KEY='controlled-transport-no-real-provider';
 const {prepareWeeklyNonPresenterProductionFixture}=await import('./weeklyNonPresenterProduction.fixture.js');
 const {actual,detail,created,f}=await prepareWeeklyNonPresenterProductionFixture(t,{ownedReferenceBytes:true,productInventory:true,primaryStructure:true});
 assert.ok(detail.assetSupplyPlan?.shots.every(shot=>shot.sourceRefs.includes('actual-owned-product-identity')),JSON.stringify({error:actual.lastError,supply:detail.assetSupplyPlan}));
 assert.equal(actual.status,'blocked');assert.equal(actual.lastError?.code,'weekly_owned_product_identity_verification_required');
 assert.ok(!created.run_id,JSON.stringify({error:actual.lastError,review:detail.agentWorkflow?.executionPlanReview,job:detail.agentWorkflow?.replicationJob,brief:detail.agentWorkflow?.directorBrief}));assert.equal(f.tables.starter_usage_ledger?.length??0,0);
 assert.equal(f.tables.workflow_runs!.filter(row=>(row.starter_context as Record<string,unknown>|undefined)?.socialTaskId===created.task_id).length,0);
 assert.equal((f.tables.content_execution_jobs??[]).filter(row=>row.task_id===created.task_id).length,0);
});
