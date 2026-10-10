import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyQualityAuditFixture} from '../runtime/weeklyContentQualityAudit.fixture.js';
import {readWeeklyReplicationAuthority} from './socialWeeklyReplicationAuthority.js';
test('controlled persisted legacy run cannot acquire replication authority from latest rules',async t=>{
 const f=await prepareWeeklyQualityAuditFixture();t.after(f.cleanup);const created=f.tables.starter_social_content_tasks![0]!;const brief=created.brief as Record<string,unknown>;brief.creationMode='viral_replication';assert.ok(brief._weeklyAuthority);
 // Explicit controlled legacy declaration: no scheduler execution or validated replication proof is claimed.
 const runs=f.tables.workflow_runs!.length;const before=JSON.stringify(f.tables.workflow_runs);
 await assert.rejects(readWeeklyReplicationAuthority(f.repository,created),{code:'weekly_replication_authority_unverified'});
 assert.equal(JSON.stringify(f.tables.workflow_runs),before,'readonly rejection never backfills a proof');
 assert.equal(f.tables.workflow_runs!.length,runs);assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.starter_usage_ledger?.length??0,0);
});
test('real frozen planning and rule bytes can be snapshotted without claiming blocked production started',async t=>{
 const {prepareWeeklyNonPresenterProductionFixture}=await import('../runtime/weeklyNonPresenterProduction.fixture.js');
 const {freezeWeeklyReplicationAuthority}=await import('./socialWeeklyReplicationAuthority.js');
 const {repository,f,created,detail}=await prepareWeeklyNonPresenterProductionFixture(t,{ownedReferenceBytes:true,productInventory:true});
 assert.ok(!created.run_id,'real default director admission remains blocked');
 const proof=await freezeWeeklyReplicationAuthority(repository,created,detail);assert.ok(proof);
 assert.equal(proof.job.target.accountPlaybookRef?.id,proof.playbook.playbookRef.id);
 assert.equal(proof.job.target.accountRef?.version,String(proof.playbook.accountRef.version));
 assert.deepEqual(proof.job,detail.agentWorkflow?.replicationJob,'the original job is frozen without rewriting missing evidence');
 const rule=f.tables.social_playbook_versions!.find(row=>row.playbook_id===proof.playbook.playbookRef.id);assert.ok(rule);
 const before=JSON.stringify(f.tables.workflow_runs);const old=structuredClone(rule.payload);(rule.payload as Record<string,unknown>).visualRules=['changed actual rules'];
 await assert.rejects(freezeWeeklyReplicationAuthority(repository,created,detail),{code:'weekly_target_playbook_changed'});rule.payload=old;
 assert.equal(JSON.stringify(f.tables.workflow_runs),before,'snapshot helper never creates a run or repairs missing proof');
 assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.starter_usage_ledger?.length??0,0);
});
