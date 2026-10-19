import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSocialContentAutomaticRevisionCommand,
  executeSocialContentAutomaticRevision,
  routeSocialContentAutomaticRevisionFailure,
  type SocialContentAutomaticRevisionPorts,
} from './socialContentAutomaticRevision.js';

const hash = (character: string) => character.repeat(64);

function fixture(kind: 'asset_supply_fallback' | 'budget_degrade' = 'asset_supply_fallback') {
  const command = createSocialContentAutomaticRevisionCommand({
    commandId: `automatic-${kind}`, tenantId: 'tenant', taskId: 'content', expectedTaskVersion: '7',
    sourceRunId: 'run-old', sourcePlanHash: hash('a'), revisionPlanHash: hash('b'),
    budgetLedgerRef: 'content-budget:content', kind, affectedShotIds: ['S02'], evidenceRefs: ['qa:S02'],
    revisionPayload: kind === 'asset_supply_fallback' ? { replacementAssetId: 'product-image-2' } : { strategy: 'heygen_stable_presenter' },
  });
  const calls: string[] = [];
  const ports: SocialContentAutomaticRevisionPorts = {
    readSnapshot: async () => ({ tenantId: 'tenant', taskId: 'content', taskVersion: '7', runId: 'run-old',
      planHash: hash('a'), budgetLedgerRef: 'content-budget:content', runStatus: 'running' }),
    sealSourceRun: async () => { calls.push('seal'); },
    prepareRevision: async () => { calls.push('prepare'); return { command, preparedTaskVersion: '8', preparedPlanHash: hash('b') }; },
    startPreparedRevision: async () => { calls.push('start'); return { runId: 'run-new', planHash: hash('b'), budgetLedgerRef: 'content-budget:content' }; },
  };
  return { command, calls, ports };
}

for (const kind of ['asset_supply_fallback', 'budget_degrade'] as const) test(`${kind} uses one seal/CAS/start boundary and retains the budget ledger`, async () => {
  const f = fixture(kind);
  const result = await executeSocialContentAutomaticRevision(f.command, f.ports);
  assert.deepEqual(f.calls, ['seal', 'prepare', 'start']);
  assert.deepEqual(result, { action: 'started', runId: 'run-new', planHash: hash('b'), budgetLedgerRef: 'content-budget:content' });
});
test('a terminal source run is archived evidence and is not cancelled again', async () => {
  const f = fixture();
  f.ports.readSnapshot = async () => ({ tenantId: 'tenant', taskId: 'content', taskVersion: '7', runId: 'run-old',
    planHash: hash('a'), budgetLedgerRef: 'content-budget:content', runStatus: 'failed' });
  await executeSocialContentAutomaticRevision(f.command, f.ports);
  assert.deepEqual(f.calls, ['prepare', 'start']);
});

test('source CAS mismatch stops before run sealing or revision writes', async () => {
  const f = fixture();
  f.ports.readSnapshot = async () => ({ tenantId: 'tenant', taskId: 'content', taskVersion: '8', runId: 'run-old',
    planHash: hash('a'), budgetLedgerRef: 'content-budget:content', runStatus: 'running' });
  await assert.rejects(executeSocialContentAutomaticRevision(f.command, f.ports), /automatic_revision_source_changed/);
  assert.deepEqual(f.calls, []);
});

test('a start cannot silently mint budget identity or reuse old run/approval scope', async () => {
  for (const invalid of [
    { runId: 'run-old', planHash: hash('b'), budgetLedgerRef: 'content-budget:content' },
    { runId: 'run-new', planHash: hash('a'), budgetLedgerRef: 'content-budget:content' },
    { runId: 'run-new', planHash: hash('b'), budgetLedgerRef: 'new-budget' },
  ]) {
    const f = fixture();
    f.ports.startPreparedRevision = async () => invalid;
    await assert.rejects(executeSocialContentAutomaticRevision(f.command, f.ports), /automatic_revision_start_invalid/);
  }
});

test('no valid revision is handed to the existing decision-center port with the same command identity', async () => {
  const f = fixture('budget_degrade');
  let received: unknown;
  const result = await routeSocialContentAutomaticRevisionFailure(f.command, 'no_valid_degrade_revision', {
    createDecision: async input => { received = input; },
  });
  assert.deepEqual(result, { action: 'needs_decision', reason: 'no_valid_degrade_revision' });
  assert.deepEqual(received, { command: f.command, reason: 'no_valid_degrade_revision' });
});
