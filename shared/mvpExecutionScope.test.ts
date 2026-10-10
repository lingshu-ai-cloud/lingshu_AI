import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMvpExecutionScope } from './mvpExecutionScope.js';
const scope = { tenantId: 't', taskId: 'one', version: 1, session: 'B' as const, accountId: 'account', productId: 'product', runId: 'run', action: 'generate_media' as const, authority: 'customer' as const, expiresAt: '2099-01-01T00:00:00Z', revoked: false, provider: 'ark', model: 'seedance', shotIds: ['hook'], authorizedBy: 'owner', authorizationRef: 'approval', budgetPoolId: 'B-pool', budgetLimitCny: 5 };
const pool = { id: 'B-pool', tenantId: 't', taskId: 'one', session: 'B' as const, limitCny: 5, spentCny: 2, reservedCny: 1 };
const input = { scope, pool, accountId: 'account', productId: 'product', runId: 'run', action: 'generate_media', now: '2026-10-11T00:00:00Z', tenantId: 't', taskId: 'one', version: 1, session: 'B' as const, provider: 'ark', model: 'seedance', shotId: 'hook', estimatedCostCny: 2 };
test('explicit scope binds provider, model, task, version, shot and human authorization', () => {
 assert.doesNotThrow(() => assertMvpExecutionScope(input));
 for (const mutation of [{ tenantId: 'foreign' }, { taskId: 'other' }, { version: 2 }, { session: 'A' as const }, { provider: 'other' }, { model: 'other' }, { shotId: 'other' }]) assert.throws(() => assertMvpExecutionScope({ ...input, ...mutation }), /authority_mismatch/);
 assert.throws(() => assertMvpExecutionScope({ ...input, scope: { ...scope, authorizationRef: '' } }), /scope_invalid/);
});
test('B cannot consume A pool and versions cannot reset cumulative budget', () => {
 assert.throws(() => assertMvpExecutionScope({ ...input, pool: { ...pool, session: 'A', id: 'A-pool' }, scope: { ...scope, budgetPoolId: 'A-pool' } }), /pool_scope_mismatch/);
 assert.throws(() => assertMvpExecutionScope({ ...input, version: 2, scope: { ...scope, version: 2 }, estimatedCostCny: 3 }), /budget_exceeded/);
 assert.throws(() => assertMvpExecutionScope({ ...input, scope: { ...scope, budgetLimitCny: 10 } }), /budget_invalid/);
});
test('legacy execution is opt-out; malformed money fails closed', () => {
 assert.doesNotThrow(() => assertMvpExecutionScope({ ...input, scope: undefined, pool: undefined }));
 for (const amount of [NaN, Infinity, -1]) assert.throws(() => assertMvpExecutionScope({ ...input, estimatedCostCny: amount }), /budget_invalid/);
});

test('grant survives repeated in-scope choices but rejects expiry, revocation and other responsibilities', () => {
 assert.doesNotThrow(() => assertMvpExecutionScope(input));
 assert.doesNotThrow(() => assertMvpExecutionScope(input));
 for (const mutation of [{ accountId: 'other' }, { productId: 'other' }, { runId: 'other' }]) assert.throws(() => assertMvpExecutionScope({ ...input, ...mutation }), /authority_mismatch/);
 for (const scopeChange of [{ revoked: true }, { expiresAt: input.now }, { expiresAt: 'invalid' }, { authority: 'director' as any }]) assert.throws(() => assertMvpExecutionScope({ ...input, scope: { ...scope, ...scopeChange } }), /authorization_invalid/);
 for (const action of ['publish', 'deploy']) assert.throws(() => assertMvpExecutionScope({ ...input, action }), /action_not_authorized/);
 assert.doesNotThrow(() => assertMvpExecutionScope({ ...input, scope: { ...scope, authority: 'authorized_business_reviewer' } }));
});
