import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyEnterpriseFactFixture} from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import {adoptWeeklyAutomationTemplate,readWeeklyAutomationTemplate,WEEKLY_TEMPLATE_ADOPTIONS} from './weeklyAutomationTemplate.js';
test('template adoption is scoped, idempotent, auditable and never an outbound approval',async t=>{
 const {store,task}=await prepareWeeklyEnterpriseFactFixture(t),scope={tenantId:task.tenantId,programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion};
 assert.equal(await readWeeklyAutomationTemplate(store,scope),null);
 const a=await adoptWeeklyAutomationTemplate(store,scope,'owner'),b=await adoptWeeklyAutomationTemplate(store,scope,'owner');
 assert.equal(a.adoptedAt,b.adoptedAt);assert.equal(a.template.perFinishedVideoMaxCny,15);assert.equal(a.template.dailyCollectionLimit,10);assert.equal(a.template.outboundAuthorization,false);
 assert.equal((await store.list(WEEKLY_TEMPLATE_ADOPTIONS)).totalItems,1);
 assert.equal(await readWeeklyAutomationTemplate(store,{...scope,packageVersion:2}),null);
 const row=(await store.list<{id:string}>(WEEKLY_TEMPLATE_ADOPTIONS)).items[0]!;
 await store.update(WEEKLY_TEMPLATE_ADOPTIONS,row.id,{payload:{...a,template:{...a.template,outboundAuthorization:true}}});
 await assert.rejects(readWeeklyAutomationTemplate(store,scope),{code:'weekly_template_adoption_invalid'});
});
