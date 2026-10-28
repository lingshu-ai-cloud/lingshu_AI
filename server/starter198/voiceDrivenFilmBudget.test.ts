import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assertVoiceDrivenFilmDuration, productionBudgetDuration, productionBudgetMaximumCny} from '../../shared/contracts/productionBudgetPolicy.js';
import {SocialContentTaskBudget, type SocialTaskBudgetOperation} from '../lib/socialContentTaskBudget.js';
import {classifyContentExecutionFailure} from '../contentExecution/retryPolicy.js';
import {applyPresenterFirstBudgetRouting} from './socialContentBudgetRouting.js';

const policy = {materialRoutingPolicyVersion: 'type-aware.v3'};
const scope = {tenantId: 'tenant', taskId: 'film', runId: 'original', planHash: 'a'.repeat(64)};
const op = (id: string): SocialTaskBudgetOperation => ({operationId: id, fingerprint: 'b'.repeat(64),
  provider: 'offline', model: 'fixture', accountRef: 'account', stage: 'video', shotId: id});

test('new films have one 15 yuan cap even below 30 seconds and cannot request a fresh higher cap', () => {
  assert.equal(productionBudgetMaximumCny({...policy, targetDurationSeconds: 12}), 15);
  assert.equal(productionBudgetMaximumCny({...policy, targetDurationSeconds: 30, perItemBudgetCny: 100}), 15);
  assert.equal(productionBudgetMaximumCny({materialRoutingPolicyVersion: 'type-aware.v1', targetDurationSeconds: 12}), 6);
  assert.equal(productionBudgetDuration({...policy, targetDurationSeconds: 30,
    scenes: [{duration: {startSeconds: 0, endSeconds: 31}}]}), 31);
  assert.doesNotThrow(() => assertVoiceDrivenFilmDuration(30));
  assert.throws(() => assertVoiceDrivenFilmDuration(30.01), /production_duration_decision_required/);
});

test('14 yuan retained plus a 1 yuan repair is automatic; next excess preserves results and requests a decision', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-film-budget-'));
  try {
    const ledger = new SocialContentTaskBudget(root, {
      authorization: async () => ({maximumCny: productionBudgetMaximumCny(policy), productionDurationSeconds: 30, authorizationRef: 'film-policy'}),
      quote: async (_scope, operation) => ({upperBoundCny: operation.operationId === 'original' ? 14 : 1, quoteRef: operation.operationId, validUntil: '2099-01-01'}),
      assertCurrent: async () => {}, verifyRejection: async () => false,
    });
    await ledger.reserveBatch(scope, [op('original')]);
    await ledger.markOutcome(scope, 'original', 'unknown', 'original-receipt');
    const repair = {...scope, taskId: 'repair-child', budgetTaskId: scope.taskId, runId: 'repair'};
    await ledger.reserveBatch(repair, [op('repair')]);
    assert.equal(ledger.status(scope)!.retainedCny, 15);
    await ledger.reserveBatch(repair, [op('repair')]);
    assert.equal(ledger.status(scope)!.entries.length, 2, 'retry must reuse the original reservation');
    const before = ledger.status(scope);
    await assert.rejects(ledger.reserveBatch({...repair, runId: 'repair-2'}, [op('extra')]), /production_budget_decision_required/);
    assert.deepEqual(ledger.status(scope), before);
    assert.equal(before!.entries.find(entry => entry.operationId === 'original')!.receiptRef, 'original-receipt');
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('new node failures identify the actual intervention instead of asking for unrelated materials', () => {
  for (const [error, expected] of [
    ['user_input_required:subtitle_style_unknown', '字幕样式检查节点'],
    ['user_input_required:video_timeline_blocked', '音画同步检查节点'],
    ['user_input_required:production_duration_decision_required:31', '30秒'],
  ]) {
    const result = classifyContentExecutionFailure(Error(error), {attempt: 1});
    assert.equal(result.disposition, 'block');
    assert.ok(result.publicReason.includes(expected));
  }
});

test('new allocation quotes theme footage without reintroducing legacy SKU/actions or optional generation', async () => {
  const input = {maximumCny: 15, plan: {materialRoutingPolicyVersion: 'type-aware.v3', shots: [{shotId: 'slot',
    sourceStrategy: 'customer_real_asset', sourceRefs: ['owned'], selectedMaterialSegment: {sourceRef: 'owned', segmentId: 'segment'},
    materialRouting: {materialType: 'product', policy: 'local_only', localMatch: {state: 'matched', sourceRefs: ['owned']}}}]},
    workflow: {directorBrief: {scenes: [{sceneId: 'slot'}]}}} as unknown as Omit<Parameters<typeof applyPresenterFirstBudgetRouting>[0], 'quote'>;
  let quotes = 0;
  const plan = await applyPresenterFirstBudgetRouting({...input, quote: async () => {
    quotes++; return {maximumCny: 15, retainedCny: 14, wholeTaskUpperBoundCny: 15};
  }});
  assert.equal(quotes, 1);
  assert.equal(plan.shots[0].sourceStrategy, 'customer_real_asset');
  await assert.rejects(applyPresenterFirstBudgetRouting({...input, quote: async () =>
    ({maximumCny: 15, retainedCny: 14, wholeTaskUpperBoundCny: 15.01})}), /production_budget_decision_required/);
});
