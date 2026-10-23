import assert from 'node:assert/strict';
import test from 'node:test';
import type { Response } from 'express';
import { studioTenantContext, scopedStudioAssetDir } from './tenantContext.js';
import { createStoryboardOperationRecovery } from './storyboardOperationRecovery.js';
import { createProjectEvidenceApplication } from './projectEvidenceApplication.js';
import type { StoryboardAigcSpendEntry } from '../lib/storyboardAigcProjectBudget.js';

const unexpected = (..._args: unknown[]): never => { throw Error('unexpected external work'); };
const recovery = createStoryboardOperationRecovery({
  storyboardUrlImage: unexpected, loadMaterials: unexpected, storyboardKbAssignmentIssuesForSpec: unexpected,
});
const projectEvidence = createProjectEvidenceApplication({
  loadMaterials: unexpected, storyboardReplayFrameBytesCurrent: unexpected, storyboardUrlImage: unexpected,
  storyboardEnterpriseImage: unexpected, storyboardCharacterMaterialAuthorizationIssue: unexpected,
  storyboardPersonAssetImage: unexpected, storyboardMaterialImage: unexpected,
});
function response() {
  const state = { status: 200, body: {} as Record<string, unknown> };
  const res = {
    status(value: number) { state.status = value; return res; },
    json(value: Record<string, unknown>) { state.body = value; return res; },
  };
  return { state, res: res as unknown as Response };
}
const entry = (status: StoryboardAigcSpendEntry['status']): StoryboardAigcSpendEntry => ({
  operationId: 'original-op', shotId: 'shot-a', stage: 'first_frame', amountMicros: 2_000_000,
  inputFingerprint: 'frozen-input', status, at: '2026-10-23T00:00:00Z',
  output: { providerTaskId: 'accepted-original-task' },
});
const input = { operationId: 'original-op', shotId: 'shot-a', stage: 'first_frame' as const,
  estimatedCostCny: 2, inputFingerprint: 'frozen-input', kind: 'frame' as const };

test('tenant context is required and concurrent async operations keep distinct asset scopes', async () => {
  assert.throws(() => scopedStudioAssetDir('/tmp/studio-boundary-test'), /context unavailable/);
  const scopes = await Promise.all(['tenant-a', 'tenant-b'].map(tenantId => studioTenantContext.run(tenantId, async () => {
    await Promise.resolve();
    assert.equal(studioTenantContext.getStore(), tenantId);
    return scopedStudioAssetDir('/tmp/studio-boundary-test');
  })));
  assert.notEqual(scopes[0], scopes[1]);
  assert.equal(studioTenantContext.getStore(), undefined);
});

test('a failed async operation restores the outer tenant context', async () => {
  await studioTenantContext.run('outer-tenant', async () => {
    await assert.rejects(studioTenantContext.run('inner-tenant', async () => {
      await Promise.resolve();
      throw Error('isolated failure');
    }), /isolated failure/);
    assert.equal(studioTenantContext.getStore(), 'outer-tenant');
  });
  assert.equal(studioTenantContext.getStore(), undefined);
});

test('missing operation returns control without reading output or changing a response', async () => {
  const { res, state } = response();
  assert.equal(await recovery.respondToExistingStoryboardOperation(res, { ...input, entry: undefined, recover: unexpected }), false);
  assert.deepEqual(state, { status: 200, body: {} });
});

for (const status of ['reserved', 'uncertain'] as const) {
  test(`${status} operation reports the original receipt without recovering or authorizing new work`, async () => {
    const original = entry(status), snapshot = structuredClone(original), { res, state } = response();
    assert.equal(await recovery.respondToExistingStoryboardOperation(res, { ...input, entry: original, recover: unexpected }), true);
    assert.equal(state.status, status === 'reserved' ? 202 : 409);
    assert.equal(state.body.providerTaskId, 'accepted-original-task');
    assert.equal(state.body.code, status === 'reserved' ? 'STORYBOARD_OPERATION_IN_PROGRESS' : 'STORYBOARD_OPERATION_RESULT_UNCERTAIN');
    assert.deepEqual(original, snapshot);
  });
}

test('changed input conflicts before any output lookup and retains original reservation', async () => {
  const original = entry('completed'), snapshot = structuredClone(original), { res, state } = response();
  await recovery.respondToExistingStoryboardOperation(res, { ...input, inputFingerprint: 'changed-input', entry: original, recover: unexpected });
  assert.equal(state.status, 409);
  assert.equal(state.body.code, 'STORYBOARD_OPERATION_INPUT_CONFLICT');
  assert.deepEqual(original, snapshot);
});

test('completed receipt whose output cannot be read stays recoverable and never regenerates', async () => {
  const original = entry('completed'), snapshot = structuredClone(original), { res, state } = response();
  let reads = 0;
  await recovery.respondToExistingStoryboardOperation(res, { ...input, entry: original, recover: async () => {
    reads++; throw Error('output storage unavailable');
  } });
  assert.equal(reads, 1);
  assert.equal(state.status, 409);
  assert.equal(state.body.code, 'STORYBOARD_OPERATION_RECOVERY_REQUIRED');
  assert.equal(state.body.providerTaskId, 'accepted-original-task');
  assert.deepEqual(original, snapshot);
});

test('completed verified output is reused without changing its original receipt', async () => {
  const original = entry('completed'), snapshot = structuredClone(original), { res, state } = response();
  await recovery.respondToExistingStoryboardOperation(res, { ...input, entry: original,
    recover: async saved => {
      assert.equal(saved, original);
      return { ok: true, materialId: 'verified-original-output' };
    } });
  assert.deepEqual(state.body, { ok: true, materialId: 'verified-original-output', reused: true });
  assert.deepEqual(original, snapshot);
});

test('remaining-cost evidence rejects a foreign project before reading materials or outputs', async () => {
  await assert.rejects(projectEvidence.studioAigcBudgetContext('tenant-a', { id: 'project-b', tenant_id: 'tenant-b' }), /不属于当前企业/);
});

test('a matching current AI record and confirmed commercial fields are required for delivery', () => {
  const record = { script: 'current script', source: 'ai', qualityStatus: 'passed', publishable: true };
  assert.deepEqual(projectEvidence.unpublishableGenerationReasons({ script: record.script, modeScripts: [record] }), []);
  assert.ok(projectEvidence.unpublishableGenerationReasons({ script: 'edited script', modeScripts: [record] })
    .some(reason => reason.includes('正文一致')));
  assert.ok(projectEvidence.unpublishableGenerationReasons({ script: record.script, modeScripts: [{ ...record, fieldsToConfirm: ['MOQ'] }] })
    .some(reason => reason.includes('MOQ')));
});
