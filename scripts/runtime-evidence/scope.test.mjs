import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScopeEvidence,validateWeeklyEvidence} from './scope.mjs';
function fixture() {
 const scope={tenantId:'tenant-private',programId:'program-private',programVersion:2,accountVersions:{'account-private':3},packageId:'package-private',packageVersion:4,executionGraphVersion:3};
 const collection={source:'tenant_filtered_datastore',readOnly:true,complete:true,requestId:'read-private',tenantId:scope.tenantId,collectedAt:'2026-10-10T01:00:00Z',codeRevision:'a'.repeat(40),authority:{authenticated:true,actorId:'actor-private',tenantId:scope.tenantId}};
 const batch=items=>({items,totalItems:items.length});
 const header={tenant_id:scope.tenantId,program_id:scope.programId};
 const task=(id,deps)=>({id:`row-${id}`,...header,package_id:scope.packageId,package_version:4,task_id:id,workflow_kind:'publishing',status:'queued',idempotency_key:`key-${id}`,payload:{taskId:id,tenantId:scope.tenantId,programId:scope.programId,packageId:scope.packageId,packageVersion:4,workflowKind:'publishing',status:'queued',idempotencyKey:`key-${id}`,accountId:'account-private',publicationTaskId:'publication-private',dependsOnTaskIds:deps}});
 return {mode:'dry-run',dryRun:true,now:'2026-10-10T01:01:00Z',scope,collection,evidence:{programs:batch([{id:'opaque-program-row',...header,version:2,payload:{programId:scope.programId,version:2,status:'active'}}]),accounts:batch([{id:'account-row',...header,account_id:'account-private',version:3,status:'active',payload:{programId:scope.programId,accountId:'account-private',version:3,status:'active'}}]),packages:batch([{id:'package-row',...header,package_id:scope.packageId,version:4,status:'active',payload:{programId:scope.programId,packageId:scope.packageId,version:4,status:'active',executionGraphVersion:3,executionTaskRefs:['a','b'].map(id=>({type:'weekly_execution_task',id,version:1})),socialContentPackage:{operatingPackageId:scope.packageId,version:4,publicationTasks:[{publicationTaskId:'publication-private',accountId:'account-private'}]}}}]),tasks:batch([task('a',[]),task('b',['a'])])}};
}
test('complete formal-shaped dry-run is missing, every contract check passes, summary redacts identifiers',()=>{
 for(const validator of [validateScopeEvidence,validateWeeklyEvidence]) {const result=validator(fixture());assert.equal(result.status,'missing');assert.ok(result.checks.every(c=>c.passed));assert.equal(result.summary.runtimeVerified,false);assert.doesNotMatch(JSON.stringify(result.summary),/private/);}
});
test('self-claimed real mode cannot authenticate JSON',()=>{const f=fixture();f.mode='evidence';f.dryRun=false;for(const v of [validateScopeEvidence,validateWeeklyEvidence])assert.equal(v(f).status,'missing');});
test('tenant, account version, incomplete pagination, scope drift fail',()=>{
 const changes=[f=>f.evidence.accounts.items[0].tenant_id='foreign',f=>f.evidence.accounts.items[0].payload.version=2,f=>f.evidence.accounts.totalItems=2,f=>f.collection.authority.tenantId='foreign',f=>f.evidence.programs.items[0].version=1];
 for(const change of changes){const f=fixture();change(f);assert.equal(validateScopeEvidence(f).status,'failed');}
});
test('package and graph reject cross scope, duplicates, missing dependencies, cycles and unpinned versions',()=>{
 const changes=[f=>f.evidence.tasks.items[0].payload.tenantId='foreign',f=>f.evidence.packages.items[0].version=3,f=>f.evidence.tasks.items[1].task_id='a',f=>f.evidence.tasks.items[1].payload.dependsOnTaskIds=['absent'],f=>f.evidence.tasks.items[0].payload.dependsOnTaskIds=['b'],f=>f.evidence.tasks.items[0].payload.accountId='foreign',f=>f.evidence.tasks.items[0].payload.publicationTaskId='foreign',f=>f.evidence.packages.items[0].payload.executionTaskRefs[0].version=4,f=>delete f.evidence.packages.items[0].payload.executionGraphVersion];
 for(const change of changes){const f=fixture();change(f);assert.equal(validateWeeklyEvidence(f).status,'failed');}
});
test('missing envelopes, secret input, stale collection and malformed rows never verify or throw',()=>{
 for(const v of [validateScopeEvidence,validateWeeklyEvidence]){for(const f of [undefined,null,{},[],{scope:{}}])assert.equal(v(f).status,'missing');const f=fixture();f.collection.authorization='sensitive';assert.equal(v(f).status,'failed');assert.doesNotMatch(JSON.stringify(v(f)),/sensitive/);f.collection.collectedAt='2026-10-09T01:00:00Z';assert.equal(v(f).status,'failed');}
 const f=fixture();f.evidence.tasks.items=[null];f.evidence.tasks.totalItems=1;assert.equal(validateWeeklyEvidence(f).status,'failed');
});
test('succeeded statuses are never completion evidence',()=>{const f=fixture();for(const t of f.evidence.tasks.items)t.status=t.payload.status='succeeded';const r=validateWeeklyEvidence(f);assert.equal(r.status,'missing');assert.equal(r.summary.completionVerified,false);});
