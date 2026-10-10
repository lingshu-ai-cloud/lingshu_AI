import test from 'node:test';import assert from 'node:assert/strict';
test('actual scheduler refuses unreviewed product identity before creating a run or signing original replication authority',async t=>{
 const keys=['SEEDANCE_VIDEO_ENABLED','SEEDANCE_API_KEY','SEEDREAM_API_KEY'] as const;
 const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));t.after(()=>{for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}});
 process.env.SEEDANCE_VIDEO_ENABLED='true';process.env.SEEDANCE_API_KEY='controlled-transport-no-real-provider';process.env.SEEDREAM_API_KEY='controlled-transport-no-real-provider';
 const {readWeeklyReplicationAuthority}=await import('./socialWeeklyReplicationAuthority.js');
 const {prepareWeeklyNonPresenterProductionFixture}=await import('../runtime/weeklyNonPresenterProduction.fixture.js');
 const {repository,f,created,actual}=await prepareWeeklyNonPresenterProductionFixture(t,{ownedReferenceBytes:true,productInventory:true,primaryStructure:true});
 assert.equal(actual.lastError?.code,'weekly_owned_product_identity_verification_required');
 assert.ok(!created.run_id,'unreviewed owned identity must be resolved before original scheduler persists any run');
 assert.equal(f.tables.workflow_runs?.filter(row=>(row.starter_context as Record<string,unknown>|undefined)?.socialTaskId===created.task_id).length??0,0);
 assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.starter_usage_ledger?.length??0,0);
 const briefBefore=JSON.stringify(created.brief);await assert.rejects(readWeeklyReplicationAuthority(repository,created),{code:'weekly_replication_authority_unverified'});assert.equal(JSON.stringify(created.brief),briefBefore,'read-only pre-run lookup cannot fabricate scheduler authority');
 // A genuinely accepted canonical material -> actual start -> original frozen
 // authority positive is exercised in weeklyOwnedProductIdentityDemand.test.ts.
});
