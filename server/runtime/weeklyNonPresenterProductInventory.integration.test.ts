import test from 'node:test';import assert from 'node:assert/strict';
test('actual isolated owned image enters default reference production planning without writing user inventory',async t=>{
 const keys=['SEEDANCE_VIDEO_ENABLED','SEEDANCE_API_KEY','SEEDREAM_API_KEY'] as const;const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));t.after(()=>{for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}});
 process.env.SEEDANCE_VIDEO_ENABLED='true';process.env.SEEDANCE_API_KEY='controlled-transport-no-real-provider';process.env.SEEDREAM_API_KEY='controlled-transport-no-real-provider';
 const {prepareWeeklyNonPresenterProductionFixture}=await import('./weeklyNonPresenterProduction.fixture.js');
 const {actual,detail,created,f}=await prepareWeeklyNonPresenterProductionFixture(t,{ownedReferenceBytes:true,productInventory:true,primaryStructure:true});
 assert.ok(detail.assetSupplyPlan?.shots.every(shot=>shot.sourceRefs.includes('actual-owned-product-identity')),JSON.stringify({error:actual.lastError,supply:detail.assetSupplyPlan}));
 assert.ok(created.run_id,JSON.stringify({error:actual.lastError,review:detail.agentWorkflow?.executionPlanReview,job:detail.agentWorkflow?.replicationJob,brief:detail.agentWorkflow?.directorBrief}));assert.equal(f.tables.starter_usage_ledger?.length??0,0);
 const runs=f.tables.workflow_runs!.filter(row=>row.id===created.run_id);assert.equal(runs.length,1);
 const jobs=(f.tables.content_execution_jobs??[]).filter(row=>row.task_id===created.task_id&&row.run_id===created.run_id);assert.equal(jobs.length,1,JSON.stringify({actual:actual.lastError,rows:f.tables.content_execution_jobs}));assert.equal(jobs[0]!.status,'queued');
});
