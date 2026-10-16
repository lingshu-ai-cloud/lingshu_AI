import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SocialContentTaskBudget, sealSocialTaskCorrectionBudgetAuthorization, type SocialTaskBudgetScope, type SocialTaskBudgetOperation, type SocialTaskBudgetPorts } from './socialContentTaskBudget.js';
const scope: SocialTaskBudgetScope = { tenantId: 'tenant', taskId: 'task', runId: 'run-1', planHash: 'a'.repeat(64) };
const op = (id: string, stage = 'video'): SocialTaskBudgetOperation => ({ operationId: id, fingerprint: 'b'.repeat(64), provider: 'provider', model: 'model', accountRef: 'account', stage, shotId: 'S01' });
function fixture(cost = 3, maximum = 10) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'social-task-budget-')); const ports: SocialTaskBudgetPorts = { authorization: async () => ({ maximumCny: maximum, authorizationRef: 'canonical-auth' }), quote: async () => ({ upperBoundCny: cost, quoteRef: 'server-quote', validUntil: '2099-01-01T00:00:00Z' }), assertCurrent: async () => { }, verifyRejection: async () => true }; return { root, ports, budget: new SocialContentTaskBudget(root, ports), clean: () => fs.rmSync(root, { recursive: true, force: true }) }; }
test('all suppliers, scenes and retry runs retain one task ceiling and replay survives restart', async () => { const f = fixture(); try {
    await f.budget.reserveBatch(scope, [op('frame', 'first_frame'), { ...op('qa', 'first_frame_qa'), provider: 'qwen' }, { ...op('speech', 'tts'), shotId: null }]);
    assert.equal(f.budget.status(scope)!.retainedCny, 9);
    await f.budget.markOutcome(scope, 'frame', 'unknown', 'raw-response');
    const restarted = new SocialContentTaskBudget(f.root, f.ports);
    await restarted.reserveBatch(scope, [op('frame', 'first_frame')]);
    assert.equal(restarted.status(scope)!.retainedCny, 9);
    await assert.rejects(restarted.reserveBatch({ ...scope, runId: 'run-2', planHash: 'c'.repeat(64) }, [op('retry')]), /exceeded/);
    assert.equal(restarted.status(scope)!.retainedCny, 9);
    f.ports.verifyRejection=async()=>false;
    await assert.rejects(restarted.releaseRejected(scope, 'frame', 'reject'), /rejection_not_proven/);
}
finally {
    f.clean();
} });
test('batch reservation is all or nothing, including an unquoted QA stage', async () => { const f = fixture(4); try {
    await assert.rejects(f.budget.reserveBatch(scope, [op('a'), op('b'), op('qa', 'quality')]), /exceeded/);
    assert.equal(f.budget.status(scope), null);
    f.ports.quote = async (_s, o) => { if (o.stage === 'quality')
        throw Error('quote unavailable'); return { upperBoundCny: 1, quoteRef: 'quote', validUntil: '2099-01-01' }; };
    await assert.rejects(f.budget.reserveBatch(scope, [op('a'), op('qa', 'quality')]), /quote unavailable/);
    assert.equal(f.budget.status(scope), null);
}
finally {
    f.clean();
} });
test('concurrent workers cannot collectively reserve over ceiling', async () => { const f = fixture(6); try {
    const other = new SocialContentTaskBudget(f.root, f.ports);
    const results = await Promise.allSettled([f.budget.reserveBatch(scope, [op('a')]), other.reserveBatch(scope, [op('b')])]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(f.budget.status(scope)!.retainedCny, 6);
    await assert.rejects(other.reserveBatch(scope, [op('b')]), /exceeded/);
}
finally {
    f.clean();
} });
test('only the exact internally exempt tenant may retain quotes above the nominal task ceiling', async () => {
    const configured = process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
    process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = 'local_tenant_customer_aurelia_beauty';
    const exempt = fixture(6), ordinary = fixture(6);
    const exemptScope = { ...scope, tenantId: 'local_tenant_customer_aurelia_beauty' };
    const ordinaryScope = { ...scope, tenantId: 'another-tenant' };
    try {
        const status = await exempt.budget.reserveBatch(exemptScope, [op('a'), op('b')]);
        assert.equal(status.limitCny, 10);
        assert.equal(status.retainedCny, 12);
        await assert.rejects(ordinary.budget.reserveBatch(ordinaryScope, [op('a'), op('b')]), /exceeded/);
        assert.equal(ordinary.budget.status(ordinaryScope), null);
    } finally {
        exempt.clean(); ordinary.clean();
        if (configured === undefined) delete process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
        else process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = configured;
    }
});
test('lower user ceiling persists and larger authorization never raises it', async () => { const f = fixture(2, 4); try {
    await f.budget.reserveBatch(scope, [op('a')]);
    f.ports.authorization = async () => ({ maximumCny: 100, authorizationRef: 'later-auth' });
    await f.budget.reserveBatch(scope, [op('b')]);
    assert.equal(f.budget.status(scope)!.limitCny, 4);
    await assert.rejects(f.budget.reserveBatch(scope, [op('c')]), /exceeded/);
}
finally {
    f.clean();
} });
test('server correction grant extends only the exact existing run and plan while defaults stay capped at ten', async () => { const f = fixture(3.25, 10); try {
    await f.budget.reserveBatch(scope, [op('original-a'), op('original-b'), op('original-c')]);
    const grant = sealSocialTaskCorrectionBudgetAuthorization({schemaVersion:1,tenantId:scope.tenantId,taskId:scope.taskId,
        runId:scope.runId,planHash:scope.planHash,previousMaximumCny:10,maximumCny:16.5,reason:'provider_correction',
        correctionCause:'approved_first_frame_not_consumed',affectedPresenterGroupIds:['presenter-mother-1','presenter-mother-2','presenter-mother-3'],
        presenterApprovalBindings:['presenter-mother-1','presenter-mother-2','presenter-mother-3'].map((groupId,index)=>({groupId,approvalRecordHash:String(index+1).repeat(64)})) as any,
        authorizedBy:'trusted-server-operator',authorizationRef:'correction:current-task:approved',issuedAt:new Date().toISOString()});
    const extended=await f.budget.authorizeCorrection(scope,grant);
    assert.equal(extended.limitCny,16.5);assert.equal(extended.remainingCny,6.75);
    assert.equal((await f.budget.authorizeCorrection(scope,grant)).limitCny,16.5);
    await f.budget.reserveBatch(scope,[op('corrective-presenter-1'),op('corrective-presenter-2')]);
    assert.equal(f.budget.status(scope)!.retainedCny,16.25);
    await assert.rejects(f.budget.reserveBatch({...scope,runId:'other-run',planHash:'c'.repeat(64)},[op('other-run-op')]),/exceeded/);
    const fresh=fixture(1,100);try{await fresh.budget.reserveBatch(scope,[op('fresh')]);assert.equal(fresh.budget.status(scope)!.limitCny,10);}finally{fresh.clean();}
} finally { f.clean(); } });
test('correction grant rejects forged hash, changed scope, non-ten baseline and excessive ceiling', async () => { const f=fixture(1,10); try {
    await f.budget.reserveBatch(scope,[op('original')]);
    const base={schemaVersion:1 as const,tenantId:scope.tenantId,taskId:scope.taskId,runId:scope.runId,planHash:scope.planHash,
        previousMaximumCny:10,maximumCny:16.5,reason:'provider_correction' as const,correctionCause:'approved_first_frame_not_consumed' as const,
        affectedPresenterGroupIds:['presenter-mother-1','presenter-mother-2','presenter-mother-3'] as [string,string,string],presenterApprovalBindings:['presenter-mother-1','presenter-mother-2','presenter-mother-3'].map((groupId,index)=>({groupId,approvalRecordHash:String(index+1).repeat(64)})) as any,authorizedBy:'server',authorizationRef:'correction:1',issuedAt:new Date().toISOString()};
    await assert.rejects(f.budget.authorizeCorrection(scope,{...sealSocialTaskCorrectionBudgetAuthorization(base),recordHash:'0'.repeat(64)}),/invalid/);
    await assert.rejects(f.budget.authorizeCorrection(scope,sealSocialTaskCorrectionBudgetAuthorization({...base,runId:'wrong'})),/invalid/);
    await assert.rejects(f.budget.authorizeCorrection(scope,sealSocialTaskCorrectionBudgetAuthorization({...base,maximumCny:25.01})),/invalid/);
} finally { f.clean(); } });
test('combined voice correction safely supersedes the existing first-frame grant up to twenty',async()=>{const f=fixture(1,10);try{
 await f.budget.reserveBatch(scope,[op('original')]);const groups=['presenter-mother-1','presenter-mother-2','presenter-mother-3'] as [string,string,string],bindings=groups.map((groupId,index)=>({groupId,approvalRecordHash:String(index+1).repeat(64)})) as any;
 const first=sealSocialTaskCorrectionBudgetAuthorization({schemaVersion:1,...scope,previousMaximumCny:10,maximumCny:16.5,reason:'provider_correction',correctionCause:'approved_first_frame_not_consumed',affectedPresenterGroupIds:groups,presenterApprovalBindings:bindings,authorizedBy:'server',authorizationRef:'first-frame-grant',issuedAt:new Date().toISOString()});await f.budget.authorizeCorrection(scope,first);
 const combined=sealSocialTaskCorrectionBudgetAuthorization({schemaVersion:1,...scope,previousMaximumCny:10,maximumCny:20,reason:'provider_correction',correctionCause:'approved_first_frame_not_consumed_and_bound_voice_mismatch',affectedPresenterGroupIds:groups,presenterApprovalBindings:bindings,selectedVoiceId:'bb17551-bound-voice',selectedVoiceFingerprint:'f'.repeat(64),supersedes:{recordHash:first.recordHash,authorizationRef:first.authorizationRef},authorizedBy:'server',authorizationRef:'combined-grant',issuedAt:new Date().toISOString()});
 const status=await f.budget.authorizeCorrection(scope,combined);assert.equal(status.limitCny,20);assert.equal(status.correctionAuthorization?.recordHash,combined.recordHash);assert.equal((await f.budget.authorizeCorrection(scope,combined)).limitCny,20);
 await assert.rejects(f.budget.authorizeCorrection(scope,sealSocialTaskCorrectionBudgetAuthorization({...combined,authorizationRef:'forged',supersedes:{...combined.supersedes!,recordHash:'0'.repeat(64)}})),/invalid|conflict/);
}finally{f.clean();}});
test('same run and plan safely append retry operations while preserving completed receipts and ceiling', async () => { const f = fixture(2, 10); try {
    await f.budget.reserveBatch(scope, [op('frame', 'first_frame'), op('video-0'), {...op('qa-0','video_qa'),provider:'qwen'}]);
    await f.budget.markOutcome(scope,'frame','completed','frame-receipt');
    await f.budget.markOutcome(scope,'video-0','completed','video-receipt');
    const extended=await f.budget.reserveBatch(scope,[op('frame','first_frame'),op('video-0'),{...op('qa-0','video_qa'),provider:'qwen'},op('video-1'),{...op('qa-1','video_qa'),provider:'qwen'}]);
    assert.equal(extended.retainedCny,10);assert.equal(extended.entries.find(e=>e.operationId==='frame')?.receiptRef,'frame-receipt');assert.equal(extended.entries.find(e=>e.operationId==='video-0')?.receiptRef,'video-receipt');assert.equal(extended.entries.find(e=>e.operationId==='video-1')?.status,'reserved');
    await assert.rejects(f.budget.reserveBatch(scope,[op('overflow')]),/exceeded/);
    const unchanged=f.budget.status(scope)!;assert.equal(unchanged.retainedCny,10);assert.equal(unchanged.entries.length,5);assert.equal(unchanged.entries.find(e=>e.operationId==='frame')?.receiptRef,'frame-receipt');
} finally { f.clean(); } });
test('only canonical pre-acceptance rejection releases, completed retains unknown invoice estimate', async () => { const f = fixture(5); try {
    await f.budget.reserveBatch(scope, [op('a'), op('b')]);
    f.ports.verifyRejection = async () => false;
    await assert.rejects(f.budget.releaseRejected(scope, 'a', 'forged'), /rejection_not_proven/);
    f.ports.verifyRejection = async () => true;
    await f.budget.releaseRejected(scope, 'a', 'actual-rejected');
    await f.budget.markOutcome(scope, 'b', 'accepted', 'task-receipt');
    await f.budget.markOutcome(scope, 'b', 'completed', 'finished-receipt');
    assert.equal(f.budget.status(scope)!.retainedCny, 5);
    await assert.rejects(f.budget.releaseRejected(scope, 'b', 'reject'), /rejection_not_proven/);
    await assert.rejects(f.budget.reserveBatch(scope, [op('a')]), /rejected_requires_new_operation/);
}
finally {
    f.clean();
} });
test('a claimed unknown request releases only against verified definitive rejection, preserving its audit row',async()=>{const f=fixture(5);try{
 await f.budget.reserveBatch(scope,[op('claimed')]);await f.budget.markOutcome(scope,'claimed','unknown','original-claim');
 f.ports.verifyRejection=async()=>false;await assert.rejects(f.budget.releaseRejected(scope,'claimed','provider-400'),/rejection_not_proven/);
 assert.equal(f.budget.status(scope)?.retainedCny,5);
 f.ports.verifyRejection=async(_scope,operation,receipt)=>operation.operationId==='claimed'&&receipt==='provider-400';
 await f.budget.releaseRejected(scope,'claimed','provider-400');assert.equal(f.budget.status(scope)?.retainedCny,0);
 assert.equal(f.budget.status(scope)?.entries.find(item=>item.operationId==='claimed')?.status,'rejected');
 await f.budget.reserveBatch(scope,[op('retry')]);assert.equal(f.budget.status(scope)?.retainedCny,5);
}finally{f.clean()}});
test('scope, changed operations, expired quote and corrupt ledger fail closed', async () => { const f = fixture(); try {
    f.ports.quote = async () => ({ upperBoundCny: 1, quoteRef: 'old', validUntil: '2000-01-01' });
    await assert.rejects(f.budget.reserveBatch(scope, [op('a')]), /expired/);
    f.ports.quote = async () => ({ upperBoundCny: 1, quoteRef: 'quote', validUntil: '2099-01-01' });
    await f.budget.reserveBatch(scope, [op('a')]);
    await assert.rejects(f.budget.reserveBatch(scope, [{ ...op('a'), accountRef: 'other' }]), /operation_changed/);
    await assert.rejects(f.budget.markOutcome({ ...scope, tenantId: 'other' }, 'a', 'completed', 'ref'), /scope_missing/);
    const file = fs.readdirSync(f.root).find(n => n.endsWith('.json'))!;
    fs.writeFileSync(path.join(f.root, file), '{}');
    assert.throws(() => f.budget.status(scope), /ledger_corrupt/);
}
finally {
    f.clean();
} });
test('separate Node processes share the same durable ceiling', async () => { const f = fixture(6); try {
    const source = `import {SocialContentTaskBudget} from ${JSON.stringify(new URL('./socialContentTaskBudget.ts', import.meta.url).href)}; const ports={authorization:async()=>({maximumCny:10,authorizationRef:'auth'}),quote:async()=>({upperBoundCny:6,quoteRef:'quote',validUntil:'2099-01-01'}),assertCurrent:async()=>{},verifyRejection:async()=>false}; await new SocialContentTaskBudget(process.argv[1],ports).reserveBatch(${JSON.stringify(scope)},[{...${JSON.stringify(op('placeholder'))},operationId:process.argv[2]}]);`;
    const run = promisify(execFile);
    const results = await Promise.allSettled(['a', 'b'].map(id => run(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source, f.root, id])));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(f.budget.status(scope)!.retainedCny, 6);
}
finally {
    f.clean();
} });
