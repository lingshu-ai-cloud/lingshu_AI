import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SocialContentTaskBudget, type SocialTaskBudgetScope, type SocialTaskBudgetOperation, type SocialTaskBudgetPorts } from './socialContentTaskBudget.js';
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
