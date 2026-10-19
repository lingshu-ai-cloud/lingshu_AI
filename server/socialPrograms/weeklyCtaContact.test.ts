import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyEnterpriseFactFixture} from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import {adoptWeeklyAutomationTemplate} from './weeklyAutomationTemplate.js';
import {readWeeklyCtaContact,saveWeeklyCtaContact,WEEKLY_CTA_CONTACTS} from './weeklyCtaContact.js';
import {auditWeeklyTasks} from './weeklyTaskAudit.js';

test('package contact can be filled with a catalogue of products, but does not confirm any SKU sample promise',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t),s={tenantId:f.task.tenantId,programId:f.task.programId,packageId:f.task.packageId,packageVersion:1};
 const goalRows=await f.store.list<any>('social_business_content_goals');
 assert.equal(goalRows.totalItems,1);
 await f.store.update('social_business_content_goals',goalRows.items[0]!.id,{payload:{...goalRows.items[0]!.payload,products:Array.from({length:21},(_,i)=>`product-${i}`)}});
 await adoptWeeklyAutomationTemplate(f.store,s,'owner');
 const before=await readWeeklyCtaContact(f.store,s);
 assert.equal(before.status,'missing');assert.equal(before.selectedProduct,null);assert.equal(before.productSelectionStatus,'pending');
 const saved=await saveWeeklyCtaContact(f.store,s,'owner',{contactChannel:'whatsapp',contactValue:'+8619653282176',expectedContextHash:before.contextHash,expectedReceiptId:null});
 assert.equal(saved.status,'recorded');assert.equal(saved.contactValue,'+8619653282176');assert.equal(saved.samplePromiseConfirmed,false);
 assert.match(saved.receiptId!,/^[a-f0-9]{15}$/,'PocketBase-compatible deterministic receipt ID');
 assert.equal((await f.store.list(WEEKLY_CTA_CONTACTS)).totalItems,1);
 await assert.rejects(saveWeeklyCtaContact(f.store,s,'owner',{contactChannel:'whatsapp',contactValue:'+8619653282177',expectedContextHash:before.contextHash,expectedReceiptId:null}),{code:'weekly_cta_contact_revision_changed'});
 const revised=await saveWeeklyCtaContact(f.store,s,'owner',{contactChannel:'whatsapp',contactValue:'+8619653282177',expectedContextHash:before.contextHash,expectedReceiptId:saved.receiptId});
 assert.equal(revised.contactValue,'+8619653282177');assert.equal((await f.store.list(WEEKLY_CTA_CONTACTS)).totalItems,2);
 await assert.rejects(saveWeeklyCtaContact(f.store,s,'owner',{contactChannel:'whatsapp',contactValue:'+8619653282178',expectedContextHash:before.contextHash,expectedReceiptId:saved.receiptId}),{code:'weekly_cta_contact_revision_changed'});
 await assert.rejects(saveWeeklyCtaContact(f.store,s,'owner',{contactChannel:'whatsapp',contactValue:'19653282176',expectedContextHash:before.contextHash,expectedReceiptId:revised.receiptId}),{code:'weekly_cta_contact_input_invalid'});
});

test('two concurrent first writes cannot create two revision-one contact receipts',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t),s={tenantId:f.task.tenantId,programId:f.task.programId,packageId:f.task.packageId,packageVersion:1};
 await adoptWeeklyAutomationTemplate(f.store,s,'owner');
 const before=await readWeeklyCtaContact(f.store,s);
 const input={contactChannel:'whatsapp' as const,expectedContextHash:before.contextHash,expectedReceiptId:null};
 const results=await Promise.allSettled([
  saveWeeklyCtaContact(f.store,s,'owner',{...input,contactValue:'+8619653282176'}),
  saveWeeklyCtaContact(f.store,s,'owner',{...input,contactValue:'+8619653282177'}),
 ]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const rows=await f.store.list<any>(WEEKLY_CTA_CONTACTS);
 assert.equal(rows.totalItems,1);
 assert.equal(rows.items[0]?.revision,1);
 assert.equal((await readWeeklyCtaContact(f.store,s)).receiptId,rows.items[0]?.id);
});

test('task card replaces only contact intervention with unresolved sample evidence',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t),s={tenantId:f.task.tenantId,programId:f.task.programId,packageId:f.task.packageId,packageVersion:1};
 await adoptWeeklyAutomationTemplate(f.store,s,'owner');
 const task={...f.task,status:'blocked' as const,ownBlockingReasons:['cta_required','business_proposition_required']};
 const prior=structuredClone(task);
 const before=await auditWeeklyTasks(f.store,[task]);
 assert.equal(before.items[0]?.ctaContactStatus,'missing');
 assert.ok(before.items[0]?.requiredActions.some(a=>a.code==='weekly_cta_contact_required'&&a.action==='cta_contact'));
 const context=await readWeeklyCtaContact(f.store,s);
 await saveWeeklyCtaContact(f.store,s,'owner',{contactChannel:'whatsapp',contactValue:'+8619653282176',expectedContextHash:context.contextHash,expectedReceiptId:null});
 const after=await auditWeeklyTasks(f.store,[task]);
 assert.equal(after.items[0]?.ctaContactStatus,'recorded');
 assert.ok(after.items[0]?.requiredActions.some(a=>a.code==='weekly_cta_sample_evidence_required'&&a.action==='sample_policy'));
 assert.ok(after.items[0]?.requiredActions.some(a=>a.code==='business_proposition_required'));
 assert.ok(!after.items[0]?.requiredActions.some(a=>a.code==='weekly_cta_contact_required'||a.action==='cta_contact'));
 assert.deepEqual(task,prior);
});

test('damaged contact receipt is a technical read failure, not an invitation to re-enter a number',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t),s={tenantId:f.task.tenantId,programId:f.task.programId,packageId:f.task.packageId,packageVersion:1};
 await adoptWeeklyAutomationTemplate(f.store,s,'owner');
 const before=await readWeeklyCtaContact(f.store,s);
 await saveWeeklyCtaContact(f.store,s,'owner',{contactChannel:'whatsapp',contactValue:'+8619653282176',expectedContextHash:before.contextHash,expectedReceiptId:null});
 const row=(await f.store.list<any>(WEEKLY_CTA_CONTACTS)).items[0]!;
 await f.store.update(WEEKLY_CTA_CONTACTS,row.id,{record_hash:'broken'});
 const task={...f.task,status:'blocked' as const,ownBlockingReasons:['cta_required']};
 const audit=await auditWeeklyTasks(f.store,[task]);
 assert.equal(audit.items[0]?.ctaContactStatus,'unavailable');
 assert.ok(audit.items[0]?.requiredActions.some(a=>a.code==='weekly_cta_contact_read_failed'&&a.action==='technical_recovery'&&a.userRequired===false));
 assert.ok(!audit.items[0]?.requiredActions.some(a=>a.action==='cta_contact'||a.action==='sample_policy'));
});

test('revoking the confirming organization user invalidates the contact without erasing its receipt',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t),s={tenantId:f.task.tenantId,programId:f.task.programId,packageId:f.task.packageId,packageVersion:1};
 await adoptWeeklyAutomationTemplate(f.store,s,'owner');
 const before=await readWeeklyCtaContact(f.store,s);
 const saved=await saveWeeklyCtaContact(f.store,s,'owner',{contactChannel:'whatsapp',contactValue:'+8619653282176',expectedContextHash:before.contextHash,expectedReceiptId:null});
 assert.equal(saved.status,'recorded');
 await f.store.update('users','owner',{active:false});
 const after=await readWeeklyCtaContact(f.store,s);
 assert.equal(after.status,'missing');
 assert.equal(after.receiptId,saved.receiptId);
 assert.equal(after.contactValue,undefined);
 assert.equal((await f.store.list(WEEKLY_CTA_CONTACTS)).totalItems,1);
 const historical={...f.task,status:'blocked' as const,ownBlockingReasons:['weekly_cta_sample_evidence_required'],lastError:{code:'weekly_production_cta_evidence_required',message:'old production stop',retryable:false,occurredAt:'2026-10-18T00:00:00Z'}};
 const audit=await auditWeeklyTasks(f.store,[historical]);
 assert.deepEqual(audit.items[0]?.ownReasons.filter(reason=>reason.code.startsWith('weekly_cta_')),[{code:'weekly_cta_contact_required',category:'user_input'}]);
 assert.equal(audit.items[0]?.requiredActions.filter(action=>action.action==='cta_contact').length,1);
 assert.ok(!audit.items[0]?.requiredActions.some(action=>action.action==='sample_policy'));
 assert.equal((await f.store.list(WEEKLY_CTA_CONTACTS)).totalItems,1,'read-only audit must not create another receipt');
});
