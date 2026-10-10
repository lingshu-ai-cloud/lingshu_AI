import {fixtureMetrics,fixtureObject} from './weeklyFiveMotherFixtureRecords.js';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareHMultiAccountFixture} from './weeklyFiveMotherMultiAccount.fixture.js';
for(const percent of [40,20] as const)test(`H${percent} two accounts preserve five mother allocations and reject frozen source drift before paid work`,async t=>{
 const setup=await prepareHMultiAccountFixture(t,percent);const {f,adapter,bindings}=setup;
 assert.deepEqual(setup.pkg.socialContentPackage.publicationTasks.map(pub=>pub.accountId).sort(),['account','account','account','account-b','account-b']);
 assert.equal(new Set(bindings.map(binding=>binding.record.task_id)).size,5);
 const own=bindings.find(binding=>binding.slot.referenceSource==='owned')!;
 const snapshot=f.tables.social_channel_metric_snapshots!.find(row=>row.snapshot_id===own.analysis.historicalPerformance!.snapshotRef.id)!;
 const before=()=>({tasks:f.tables.starter_social_content_tasks!.length,runs:f.tables.workflow_runs!.length,jobs:f.tables.content_execution_jobs?.length??0,ledger:f.tables.starter_usage_ledger?.length??0});const original=before();
 for(const field of ['views','likes','shares','comments'] as const){const metrics=fixtureMetrics(fixtureObject(snapshot.snapshot).metrics);const saved=metrics[field];try{metrics[field]++;const output=await adapter.execute(own.task);assert.equal(output.status,'blocked');assert.equal(output.status==='blocked'?output.code:null,'weekly_owned_reference_metrics_changed');assert.deepEqual(before(),original);}finally{metrics[field]=saved;}const recovered=await adapter.execute(own.task);assert.equal(recovered.status==='blocked'?recovered.code:null,'weekly_required_materials_missing');assert.deepEqual(before(),original);}
 const account=f.tables.social_owned_accounts!.find(row=>row.account_id===own.analysis.benchmarkAccountRefs[0]!.id)!;const payload=fixtureObject(account.payload);
 const content=f.tables.social_external_contents!.find(row=>row.id===own.analysis.benchmarkEvidenceRefs.find(ref=>ref.startsWith('owned_content:'))!.slice('owned_content:'.length))!;
 const reference=f.tables.trend_videos!.find(row=>row.id===own.analysis.benchmarkVideoRefs[0]!.id)!;
 const handoff=f.tables.starter_social_inspiration_handoff_versions!.find(row=>fixtureObject(row.payload).inspirationId===reference.id)!;
 const mutations=[
  {name:'account version',apply:()=>{const old=payload.version;payload.version=Number(old)+1;return()=>{payload.version=old;};}},
  {name:'account header',apply:()=>{const old=account.account_id;account.account_id='other-account';return()=>{account.account_id=old;};}},
  {name:'historical account',apply:()=>{const row=fixtureObject(content.content),old=row.accountId;row.accountId='account-b-foreign';return()=>{row.accountId=old;};}},
  {name:'historical URL',apply:()=>{const row=fixtureObject(content.content),old=row.publicUrl;row.publicUrl='https://example.test/foreign-history';return()=>{row.publicUrl=old;};}},
  {name:'source analysis hash',apply:()=>{const old=reference.aiAnalysis,analysis=fixtureObject(JSON.parse(String(old)));analysis.contentSha256='0'.repeat(64);reference.aiAnalysis=JSON.stringify(analysis);return()=>{reference.aiAnalysis=old;};}},
  {name:'frozen handoff hash',apply:()=>{const old=handoff.record_hash;handoff.record_hash='0'.repeat(64);return()=>{handoff.record_hash=old;};}}
 ];
 for(const mutation of mutations){const restore=mutation.apply();try{const output=await adapter.execute(own.task);assert.equal(output.status,'blocked',mutation.name);assert.notEqual(output.status==='blocked'?output.code:null,'weekly_required_materials_missing',`${mutation.name} must fail source proof before material gate`);assert.deepEqual(before(),original);}finally{restore();}const recovered=await adapter.execute(own.task);assert.equal(recovered.status==='blocked'?recovered.code:null,'weekly_required_materials_missing');assert.deepEqual(before(),original);}
 const file=path.resolve('data/media',String(reference.videoFileId)),bytes=await readFile(file);
 try{await writeFile(file,Buffer.concat([bytes,Buffer.from('source-byte-drift')]));const output=await adapter.execute(own.task);assert.equal(output.status,'blocked');assert.notEqual(output.status==='blocked'?output.code:null,'weekly_required_materials_missing');assert.deepEqual(before(),original);}finally{await writeFile(file,bytes);}
 assert.equal((await adapter.execute(own.task)).status,'blocked');assert.deepEqual(before(),original);

});
