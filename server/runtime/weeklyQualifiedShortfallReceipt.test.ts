import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyEnterpriseFactFixture} from './weeklyEnterpriseFactSupplement.fixture.js';
import {ensureWeeklyQualifiedShortfallReceipt,ensureWeeklyPostAdmissionShortfallReceipt,WEEKLY_QUALIFIED_SHORTFALL_RECEIPTS} from './weeklyQualifiedShortfallReceipt.js';

test('zero-capacity weekly shortfall is immutable and restart-idempotent, never a provider permit',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t);
 const input={tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:'task',jobId:'job',runId:'run',runHash:'run-hash',businessDate:'2026-10-18',observedCandidateIds:['video-b','video-a','video-a'],evidenceAcceptedCandidateIds:['video-a']};
 const first=await ensureWeeklyQualifiedShortfallReceipt(store,input);
 const restarted=await ensureWeeklyQualifiedShortfallReceipt(store,{...input,observedCandidateIds:['video-a','video-b']});
 assert.deepEqual(restarted,first);
 assert.deepEqual(first.observedCandidateIds,['video-a','video-b']);
 assert.deepEqual(first.evidenceAcceptedCandidateIds,['video-a']);
 assert.equal(first.authorizesExecution,false);
 assert.equal(first.grantsAdditionalDailyQuota,false);
 assert.equal((await store.list(WEEKLY_QUALIFIED_SHORTFALL_RECEIPTS)).totalItems,1);
 await store.update(WEEKLY_QUALIFIED_SHORTFALL_RECEIPTS,first.receiptId,{record_hash:'tampered'});
 await assert.rejects(ensureWeeklyQualifiedShortfallReceipt(store,input),/receipt_changed/);
});

test('five metadata observations with fewer than five evidence-accepted IDs remain a shortfall',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t);
 const receipt=await ensureWeeklyQualifiedShortfallReceipt(store,{tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:'task',jobId:'job',runId:'run',runHash:'run-hash',businessDate:'2026-10-18',observedCandidateIds:['a','b','c','d','e'],evidenceAcceptedCandidateIds:['a']});
 assert.equal(receipt.observedCandidateIds.length,5);
 assert.equal(receipt.evidenceAcceptedCandidateIds.length,1);
 assert.equal(receipt.code,'weekly_qualified_quota_exhausted');
 await assert.rejects(ensureWeeklyQualifiedShortfallReceipt(store,{tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:'task',jobId:'job',runId:'run',runHash:'run-hash',businessDate:'2026-10-18',observedCandidateIds:['a','b','c','d','e'],evidenceAcceptedCandidateIds:['a','b','c','d','e']}),/scope_invalid/);
});

test('v2 records five metadata accepts but four real post-admissions without rewriting v1',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t),base={tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:'task',jobId:'job',runId:'run',runHash:'run-hash',businessDate:'2026-10-18',observedCandidateIds:['a','b','c','d','e']};
 const old=await ensureWeeklyQualifiedShortfallReceipt(store,{...base,evidenceAcceptedCandidateIds:['a','b','c','d']});
 const oldRow=await store.getById(WEEKLY_QUALIFIED_SHORTFALL_RECEIPTS,old.receiptId);
 const input={...base,evidenceAcceptedCandidateIds:['a','b','c','d','e'],postAdmissionAcceptedCandidateIds:['a','b','c','d']};
 const newReceipt=await ensureWeeklyPostAdmissionShortfallReceipt(store,input);
 assert.equal(newReceipt.schema,'weekly-qualified-shortfall.v2');assert.equal(newReceipt.evidenceAcceptedCandidateIds.length,5);assert.equal(newReceipt.postAdmissionAcceptedCandidateIds.length,4);
 assert.equal(newReceipt.authorizesExecution,false);assert.equal(newReceipt.grantsAdditionalDailyQuota,false);
 assert.deepEqual(await ensureWeeklyPostAdmissionShortfallReceipt(store,{...input,observedCandidateIds:[...input.observedCandidateIds].reverse()}),newReceipt,'restart must reuse the same immutable receipt');
 assert.deepEqual(await store.getById(WEEKLY_QUALIFIED_SHORTFALL_RECEIPTS,old.receiptId),oldRow,'historical v1 evidence remains unchanged');
 assert.equal((await store.list(WEEKLY_QUALIFIED_SHORTFALL_RECEIPTS)).totalItems,2);
 await assert.rejects(ensureWeeklyPostAdmissionShortfallReceipt(store,{...input,postAdmissionAcceptedCandidateIds:['a','b','c','d','e']}),/v2_scope_invalid/);
});
