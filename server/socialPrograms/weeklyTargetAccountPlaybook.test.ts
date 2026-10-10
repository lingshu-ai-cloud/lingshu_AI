import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyQualityAuditFixture} from '../runtime/weeklyContentQualityAudit.fixture.js';
import {createSocialProgramService} from './service.js';
import {freezeWeeklyTargetAccountPlaybook,verifyWeeklyTargetAccountPlaybook,verifyWeeklyPlanningPlaybooks} from './weeklyTargetAccountPlaybook.js';
test('real explicit playbook save freezes identity and rejects later account/rule drift',async t=>{
 const f=await prepareWeeklyQualityAuditFixture();t.after(f.cleanup);
 const account=await f.store.create('social_owned_accounts',{tenant_id:'t',program_id:'p',account_id:'playbook-target',version:1,status:'active',payload:{accountId:'playbook-target',programId:'p',version:1,status:'active',platform:'tiktok'}});
 assert.ok(account);
 assert.equal(await freezeWeeklyTargetAccountPlaybook(f.store,'t','p','playbook-target'),null);
 const rules=await createSocialProgramService(f.store).savePlaybook('t','owner','p','playbook-target',{expectedAccountVersion:1,activate:true,audience:['采购'],pillars:['产品'],evidenceRules:['仅已确认事实'],conversionRoute:{entryType:'direct_message',callToAction:'联系销售'}});
 const frozen=await freezeWeeklyTargetAccountPlaybook(f.store,'t','p','playbook-target');assert.ok(frozen);assert.equal(frozen.playbookRef.id,rules.playbookId);assert.equal(frozen.accountRef.version,2);
 assert.deepEqual(await verifyWeeklyTargetAccountPlaybook(f.store,'t','p',frozen),frozen);
 await assert.rejects(verifyWeeklyPlanningPlaybooks(f.store,'t','p',[{targetAccountPlaybooks:[frozen,frozen]}]));
 await assert.rejects(verifyWeeklyTargetAccountPlaybook(f.store,'t','p',{...frozen,playbookHash:'0'.repeat(64)}));
 await assert.rejects(verifyWeeklyTargetAccountPlaybook(f.store,'foreign','p',frozen));
 await f.store.update('social_owned_accounts',account.id,{payload:{accountId:'playbook-target',programId:'p',version:3,playbookRef:frozen.playbookRef}});
 await assert.rejects(verifyWeeklyTargetAccountPlaybook(f.store,'t','p',frozen));
});
