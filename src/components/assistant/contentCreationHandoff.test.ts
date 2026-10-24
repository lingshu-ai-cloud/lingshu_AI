import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creationHandoffRequest, readCreationHandoff } from './contentCreationHandoff';
import { contentCreationTurn } from '../../../server/assistantContext/contentCreationDialogue';
import { creationDialogueFixture } from '../../../scripts/fixtures/contentCreationDialogue';

test('handoff carries exact selection, attributed evidence and editable narration, never a production or authorization claim', async () => {
  const f = creationDialogueFixture();
  const run = (action: string, selection: unknown) => contentCreationTurn('fixture', { action, selection, instruction: '测试' }, f.ports);
  const shots = await run('products', { referenceId: 'fixture-video', productIds: ['fixture-product'], shotIds: [] });
  const narration = await run('shots', shots.selection);
  const plan = await run('avatar', { ...narration.selection, narrationId: 'visual', avatar: true });
  const request = creationHandoffRequest(plan, 123);
  assert.equal(request.creationPath, 'material_processing');
  assert.deepEqual(request.identityMappings?.selectedProductIds, plan.selection.productIds);
  assert.deepEqual(request.creationDialoguePlan?.selection, plan.selection);
  assert.equal(request.prefill?.topic, plan.narrations[0]!.text);
  assert.equal(request.creationDialoguePlan?.avatarPlacement, 'pending');
  assert.ok(request.specialRequirements?.includes('授权'));
  assert.equal(request.confirmedSpeech, undefined);
  assert.equal(request.presenterAssetId, undefined);
  assert.equal(request.continueTaskId, undefined);
  assert.throws(() => creationHandoffRequest({ ...plan, stage: 'shots' }), /完成/);
});

test('handoff revalidation surfaces stale evidence and does not turn an error into navigation data', async () => {
  const fetchBefore = globalThis.fetch;
  const storageBefore = globalThis.localStorage;
  Object.assign(globalThis, { localStorage: { getItem: () => null } });
  let action: unknown;
  globalThis.fetch = async (_url, init) => { action = JSON.parse(String(init?.body)).action; return Response.json({ message: '证据已变化' }, { status: 409 }); };
  try {
    await assert.rejects(readCreationHandoff({ referenceId: 'ref', productIds: [], shotIds: [] }), /证据已变化/);
    assert.equal(action, 'avatar');
  } finally { globalThis.fetch = fetchBefore; Object.assign(globalThis, { localStorage: storageBefore }); }
});
