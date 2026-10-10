import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyQualityAuditFixture} from '../runtime/weeklyContentQualityAudit.fixture.js';
import {readSocialTaskDetail} from './socialContentRecords.js';
import {assertWeeklyProductionMaterialAdmission} from './socialWeeklyProductionMaterialGate.js';
test('historical output without modern dispatch remains readable but cannot pass new weekly paid admission',async t=>{
 const f=await prepareWeeklyQualityAuditFixture();t.after(f.cleanup);
 const row=f.tables.starter_social_content_tasks![0]!;
 const taskId=row.task_id;assert.equal(typeof taskId,'string');if(typeof taskId!=='string')throw new Error('actual task id missing');
 const detail=await readSocialTaskDetail({repository:f.repository,tenantId:'t',taskId});
 assert.ok(detail);assert.ok(detail.artifacts.length>0);
 const jobs=f.tables.content_execution_jobs?.length??0,usage=f.tables.starter_usage_ledger?.length??0;
 await assert.rejects(assertWeeklyProductionMaterialAdmission({repository:f.repository,tenantId:'t',taskId}));
 assert.equal(f.tables.content_execution_jobs?.length??0,jobs);assert.equal(f.tables.starter_usage_ledger?.length??0,usage);
});
