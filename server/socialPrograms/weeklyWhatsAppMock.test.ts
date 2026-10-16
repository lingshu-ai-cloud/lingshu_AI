import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyEnterpriseFactFixture} from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import {runWeeklyWhatsAppMock,WEEKLY_WHATSAPP_MOCK_RUNS} from './weeklyWhatsAppMock.js';
test('mock transport is scoped, idempotent and cannot become real channel authorization or business delivery',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t),task=structuredClone(f.task);
 task.schedule.stepKind='customer_channel_readiness';task.inputSnapshot.customerChannel='whatsapp';task.status='blocked';
 const before=structuredClone(task),result=await runWeeklyWhatsAppMock(f.store,task,'owner');
 assert.equal(result.simulated,true);assert.equal(result.realAuthorization,false);assert.equal(result.businessDelivery,false);assert.equal(result.status,'passed');
 assert.deepEqual(await runWeeklyWhatsAppMock(f.store,task,'owner'),result);
 assert.deepEqual(task,before);assert.equal((await f.store.list(WEEKLY_WHATSAPP_MOCK_RUNS)).totalItems,1);
 for(const collection of ['tenant_platform_apps','social_accounts','whatsapp_interactions','social_weekly_customer_bindings','social_weekly_execution_tasks'])assert.equal((await f.store.list(collection)).totalItems,0);
 await assert.rejects(runWeeklyWhatsAppMock(f.store,{...task,status:'cancelled'},'owner'),/consumer_invalid/);
 await assert.rejects(runWeeklyWhatsAppMock(f.store,{...task,inputSnapshot:{customerChannel:'messenger'}},'owner'),/consumer_invalid/);
});
