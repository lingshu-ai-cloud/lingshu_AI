import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSocialContentTaskBudgetAuthority, type SocialTaskBudgetAuthorityPorts, type SocialVerifiedAccountTariff, type SocialPaidOperationIntent } from './socialContentTaskBudgetAuthority.js';
const scope = { tenantId: 't', taskId: 'task', runId: 'r', planHash: 'a'.repeat(64) };
const intent = (id: string, stage = 'video'): SocialPaidOperationIntent => ({ operationId: id, provider: 'supplier', model: 'model', accountRef: 'actual-account', stage, shotId: 'S01', inputContractHash: 'b'.repeat(64), maximumUnits: { providerSeconds: 3 } });
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-budget-authority-')); let paidCalls = 0; const plan = { scope, authorizationRef: 'owner-authorized-frozen-task', maximumCny: 10, paidOperations: [intent('first-frame', 'first_frame'), intent('qa1', 'first_frame_qa'), intent('video'), intent('qa2', 'video_qa'), intent('voice', 'tts'), intent('retry', 'retry')] }; const ports: SocialTaskBudgetAuthorityPorts = { readApprovedPlan: async () => structuredClone(plan), assertCurrent: async () => { }, verifyRejection: async () => false, readVerifiedTariff: async (i) => ({ ...i, currency: 'CNY', verifiedAccountPrice: true, evidenceRef: 'account-price-original-evidence', checkedAt: '2026-01-01', validUntil: '2099-01-01', meters: { providerSeconds: { priceCny: .2, unitsPerPrice: 1, minimumUnits: 4, increment: 1 } } }) }; return { root, plan, ports, service: createSocialContentTaskBudgetAuthority({ ledgerRoot: root, ports }), get paidCalls() { return paidCalls; }, paid: () => paidCalls++, clean: () => fs.rmSync(root, { recursive: true, force: true }) }; }
test('whole frozen plan reserves all stages and retries before payment using provider 4s minimum', async () => { const f = fixture(); try {
    const result = await f.service.prepareAndReserve(scope);
    assert.equal(result.operations.length, 6);
    assert.equal(result.status.retainedCny, 4.8);
    assert.equal(result.quotes.video!.upperBoundCny, .8);
    assert.equal(f.paidCalls, 0);
    const again = await f.service.prepareAndReserve(scope);
    assert.equal(again.status.retainedCny, 4.8);
    assert.equal(again.operations[0]!.fingerprint, result.operations[0]!.fingerprint);
    assert.match(result.quotes.video!.quoteRef, /tariff:/);
}
finally {
    f.clean();
} });
test('any missing future QA account quote blocks before all ledger writes or paid calls', async () => { const f = fixture(); try {
    const original = f.ports.readVerifiedTariff;
    f.ports.readVerifiedTariff = async (i) => i.stage === 'video_qa' ? null : original(i);
    await assert.rejects(f.service.prepareAndReserve(scope), /account_tariff_missing/);
    assert.equal(fs.readdirSync(f.root).length, 0);
    assert.equal(f.paidCalls, 0);
}
finally {
    f.clean();
} });
test('wrong account, unverified, expired or non-CNY prices never authorize production', async () => { for (const change of [{ accountRef: 'other' }, { verifiedAccountPrice: false }, { validUntil: '2000-01-01' }, { currency: 'USD' }]) {
    const f = fixture();
    try {
        const read = f.ports.readVerifiedTariff;
        f.ports.readVerifiedTariff = async (i) => ({ ...await read(i), ...change }) as SocialVerifiedAccountTariff;
        await assert.rejects(f.service.prepareAndReserve(scope), /account_tariff_missing/);
        assert.equal(fs.readdirSync(f.root).length, 0);
    }
    finally {
        f.clean();
    }
} });
test('token QA quote requires complete input and output usage envelopes', async () => { const f = fixture(); try {
    f.plan.paidOperations = [{ ...intent('qa', 'video_qa'), maximumUnits: { inputTokens: 5000, outputTokens: 500 } }];
    f.ports.readVerifiedTariff = async (i) => ({ ...i, currency: 'CNY', verifiedAccountPrice: true, evidenceRef: 'verified', checkedAt: '2026-01-01', validUntil: '2099-01-01', meters: { inputTokens: { priceCny: 1, unitsPerPrice: 1e6, minimumUnits: 0, increment: 1 }, outputTokens: { priceCny: 2, unitsPerPrice: 1e6, minimumUnits: 0, increment: 1 } } });
    const result = await f.service.prepareAndReserve(scope);
    assert.equal(result.status.retainedCny, .006);
    f.plan.paidOperations[0]!.maximumUnits = { inputTokens: 5000 };
    await assert.rejects(f.service.prepareAndReserve(scope), /existing_operation_changed/);
}
finally {
    f.clean();
} });
test('new runs do not reset task ceiling and absent approval or plan drift cannot reserve', async () => { const f = fixture(); try {
    await f.service.prepareAndReserve(scope);
    const next = { ...scope, runId: 'r2', planHash: 'c'.repeat(64) };
    f.plan.scope = next;
    f.plan.paidOperations = f.plan.paidOperations.map(i => ({ ...i, operationId: i.operationId + '-retry' }));
    await f.service.prepareAndReserve(next);
    assert.equal((await f.service.prepareAndReserve(next)).status.retainedCny, 9.6);
    f.plan.scope = { ...next, runId: 'r3' };
    f.plan.paidOperations = [intent('new')];
    await assert.rejects(f.service.prepareAndReserve(f.plan.scope), /exceeded/);
    f.plan.authorizationRef = '';
    await assert.rejects(f.service.prepareAndReserve(f.plan.scope), /approved_plan_missing/);
}
finally {
    f.clean();
} });
test('authority changes between quote and admission fail before durable reservation', async () => { const f = fixture(); try {
    let reads = 0;
    f.ports.readApprovedPlan = async () => { reads++; return { ...structuredClone(f.plan), authorizationRef: reads === 1 ? 'authorized' : 'changed' }; };
    await assert.rejects(f.service.prepareAndReserve(scope), /plan_changed/);
    assert.equal(fs.readdirSync(f.root).length, 0);
}
finally {
    f.clean();
} });
test('returned authority ledger cannot lend one task authorization to another scope',async()=>{const f=fixture();try{const result=await f.service.prepareAndReserve(scope);await assert.rejects(result.ledger.reserveBatch({...scope,taskId:'foreign'},result.operations),/scope_changed/);await assert.rejects(result.ledger.markOutcome({...scope,runId:'foreign'},result.operations[0]!.operationId,'accepted','provider-receipt'),/scope_changed/);assert.equal(result.ledger.status(scope)!.retainedCny,4.8);}finally{f.clean();}});
test('accepted receipt recovery retains original funding without a fresh tariff or new submission grant', async () => {
    const f = fixture();
    try {
        const reserved = await f.service.prepareAndReserve(scope);
        await reserved.ledger.markOutcome(scope, 'video', 'accepted', 'provider-task:original');
        f.ports.readVerifiedTariff = async () => { throw Error('expired tariff must not be read for recovery'); };
        const recovered = await f.service.recoverAccepted(scope, ['video']);
        assert.equal(recovered.readOnly, true);
        assert.equal(recovered.entries[0]!.receiptRef, 'provider-task:original');
        assert.equal(recovered.status.retainedCny, 4.8);
        assert.equal('ledger' in recovered, false);
        await assert.rejects(f.service.recoverAccepted(scope, ['qa2']), /recovery_receipt_missing_or_changed/);
        const samePlan = await f.service.prepareAndReserve(scope);
        assert.equal(samePlan.status.entries.find(entry=>entry.operationId==='video')?.receiptRef,'provider-task:original');
        assert.equal(f.paidCalls, 0);
    } finally { f.clean(); }
});
test('in-flight same-scope plan extension prices only new retry intents and preserves old receipts',async()=>{const f=fixture();try{
 const first={...f.plan,paidOperations:f.plan.paidOperations.slice(0,4)};f.ports.readApprovedPlan=async()=>structuredClone(first);const reserved=await f.service.prepareAndReserve(scope);await reserved.ledger.markOutcome(scope,'video','completed','wan:existing');
 const extended={...f.plan,paidOperations:[...first.paidOperations,intent('video-attempt-1'),intent('qa-attempt-1','video_qa')]};f.ports.readApprovedPlan=async()=>structuredClone(extended);let reads=0;const tariff=f.ports.readVerifiedTariff;f.ports.readVerifiedTariff=async operation=>{reads++;assert.ok(['video-attempt-1','qa-attempt-1'].includes(operation.operationId));return tariff(operation);};
 const result=await f.service.prepareAndReserve(scope);assert.equal(reads,2);assert.equal(result.status.entries.find(entry=>entry.operationId==='video')?.receiptRef,'wan:existing');assert.equal(result.status.entries.length,6);assert.ok(result.status.retainedCny<=10);
}finally{f.clean();}});
test('recovery rejects plan, account, input or approval drift rather than reusing paid funding', async () => {
    const f = fixture();
    try {
        const reserved = await f.service.prepareAndReserve(scope);
        await reserved.ledger.markOutcome(scope, 'video', 'unknown', 'provider-task:original');
        const original = structuredClone(f.plan.paidOperations);
        for (const change of [{ accountRef: 'different-account' }, { inputContractHash: 'd'.repeat(64) }]) {
            f.plan.paidOperations = original.map(operation => operation.operationId === 'video' ? { ...operation, ...change } : operation);
            await assert.rejects(f.service.recoverAccepted(scope, ['video']), /recovery_receipt_missing_or_changed/);
        }
        f.plan.paidOperations = original;
        f.plan.authorizationRef = '';
        await assert.rejects(f.service.recoverAccepted(scope, ['video']), /recovery_plan_invalid/);
    } finally { f.clean(); }
});
