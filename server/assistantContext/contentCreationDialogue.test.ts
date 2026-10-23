import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentCreationTurn, CreationDialogueError } from './contentCreationDialogue.js';
import { creationDialogueFixture } from '../../scripts/fixtures/contentCreationDialogue.js';
import type { CreationSelection, CreationTurn } from '../../shared/contracts/contentCreationDialogue.js';
const base = (): CreationSelection => ({ referenceId: 'fixture-video', productIds: [], shotIds: [] });
async function prepared() {
  const fixture = creationDialogueFixture();
  const run = (action: CreationTurn['action'], selection: CreationSelection) => contentCreationTurn('fixture', { action, selection, instruction: '为样品杯创作短视频' }, fixture.ports);
  const start = await run('start', base());
  const shots = await run('products', { ...start.selection, productIds: ['fixture-product'] });
  const narration = await run('shots', { ...shots.selection, shotIds: shots.shots.map(row => row.id) });
  return { ...fixture, run, start, shots, narration };
}
test('whole asynchronous dialogue uses tenant evidence and produces three short editorial drafts', async () => {
  const f = await prepared();
  assert.equal(f.start.stage, 'products'); assert.deepEqual(f.start.products.map(row => row.id), ['fixture-product', 'fixture-product-2']);
  assert.deepEqual(f.shots.shots.map(row => row.kind), ['hook', 'factory', 'factory', 'product']);
  assert.deepEqual(f.shots.selection.shotIds, [f.shots.shots[0]!.id]);
  assert.equal(f.narration.narrations.length, 3);
  for (const row of f.narration.narrations) { assert.ok(row.seconds >= 15 && row.seconds <= 30); assert.match(row.text, /杯身为白色/); assert.doesNotMatch(row.text, /认证|元|万吨|日产/); }
  const avatar = await f.run('narration', { ...f.narration.selection, narrationId: 'visual' });
  assert.equal(avatar.stage, 'avatar');
  const review = await f.run('avatar', { ...avatar.selection, avatar: true });
  assert.equal(review.avatarPlacement, 'pending'); assert.deepEqual(review.presenterIds, []); assert.ok(review.gaps.some(gap => gap.includes('首镜人物')));
});
test('cross-tenant reference, unknown product, forged shot and stale evidence fail closed', async () => {
  const f = await prepared();
  await assert.rejects(contentCreationTurn('other', { action: 'start', selection: base(), instruction: '测试' }, f.ports), (error: unknown) => error instanceof CreationDialogueError && error.status === 404);
  await assert.rejects(f.run('products', { ...f.start.selection, productIds: ['other-product'] }), /产品已变化/);
  await assert.rejects(f.run('shots', { ...f.shots.selection, shotIds: ['mat:forged'] }), /不在当前授权推荐/);
  f.materials[0]!.segments[0]!.action = '已变更画面'; f.materials[0]!.segments[0]!.observedFacts = '已变更画面';
  await assert.rejects(f.run('shots', { ...f.shots.selection, shotIds: [f.shots.shots[0]!.id] }), /证据已变化/);
});
test('unanalysed reference, unrelated product footage and unavailable inventory are never invented', async () => {
  const f = creationDialogueFixture(); f.reference.aiAnalysis = '{}'; f.materials[2]!.productId = 'other';
  const reply = await contentCreationTurn('fixture', { action: 'products', selection: { ...base(), productIds: ['fixture-product'] }, instruction: '测试' }, f.ports);
  assert.equal(reply.shots.some(row => row.kind === 'hook' || row.kind === 'product'), false);
  assert.ok(reply.gaps.some(gap => gap.includes('首镜')));
  f.ports.materials = async () => ({ items: [], status: 'unavailable' });
  await assert.rejects(contentCreationTurn('fixture', { action: 'products', selection: { ...base(), productIds: ['fixture-product'] }, instruction: '测试' }, f.ports), /库存暂不可用/);
});
test('confirmed first-shot review chooses one digital presenter slot; a title never classifies it', async () => {
  for (const [label, expected] of [['数字人口播', 'first'], ['非数字人口播', 'second']] as const) {
    const f = creationDialogueFixture();
    f.reference.referenceShotReview = { sourceAnalysisRunId: 'offline-fixture-run', referenceRecordId: 'fixture-video', shots: [{ shotId: 'shot-1', start: 0, end: 3, reviewStatus: 'confirmed', mixedScene: false, labels: [label] }], sections: [] };
    const run = (action: CreationTurn['action'], selection: CreationSelection) => contentCreationTurn('fixture', { action, selection, instruction: '测试' }, f.ports);
    const shots = await run('products', { ...base(), productIds: ['fixture-product'] });
    const narration = await run('shots', { ...shots.selection, shotIds: shots.shots.map(row => row.id) });
    const review = await run('avatar', { ...narration.selection, narrationId: 'visual', avatar: true });
    assert.equal(review.avatarPlacement, expected);
    assert.equal(review.plannedShots?.filter(shot => shot.kind === 'digital_presenter').length, 1);
    assert.equal(review.plannedShots?.[expected === 'first' ? 0 : 1]?.kind, 'digital_presenter');
    assert.equal(review.plannedShots?.[expected === 'first' ? 0 : 1]?.digitalHuman?.contentConfirmed, false, 'draft never bypasses production confirmation');
    assert.equal(review.plannedShots?.length, narration.selection.shotIds.length + (expected === 'second' ? 1 : 0));
  }
});

test('knowledge AI opt-out is honored before product recommendations', async () => {
  const f = creationDialogueFixture();
  f.ports.profile = async () => ({ ...f.profile, dataGovernance: { aiAccessEnabled: false } });
  await assert.rejects(contentCreationTurn('fixture', { action: 'start', selection: base(), instruction: '测试' }, f.ports), (error: unknown) => error instanceof CreationDialogueError && error.code === 'creation_knowledge_ai_access_disabled' && error.status === 403);
});
