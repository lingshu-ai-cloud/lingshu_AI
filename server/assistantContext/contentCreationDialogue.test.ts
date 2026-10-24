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

test('historical observedFacts arrays retain actual observations and action fallback without admitting unreviewed segments', async () => {
  const f = creationDialogueFixture();
  Object.assign(f.materials[0]!.segments[0]!, { observedFacts: ['灌装机向透明瓶中注入液体', '瓶体沿生产线移动'] });
  Object.assign(f.materials[1]!.segments[0]!, { observedFacts: [], action: '工厂传送带匀速运行' });
  const run = () => contentCreationTurn('fixture', { action: 'products', selection: { ...base(), productIds: ['fixture-product'] }, instruction: '测试' }, f.ports);
  const reply = await run();
  assert.match(reply.shots.find(row => row.sourceId === 'fixture-material-0')!.description, /灌装机.*瓶体/);
  assert.equal(reply.shots.find(row => row.sourceId === 'fixture-material-1')!.description, '工厂传送带匀速运行');
  f.materials[0]!.segments[0]!.needsReview = true;
  assert.equal((await run()).shots.some(row => row.sourceId === 'fixture-material-0'), false);
});

test('semicolon-separated KB selling points yield complete attributed clauses, never invented claims', async () => {
  const f = creationDialogueFixture();
  f.profile.products.items[0]!.highlights = '杯身为白色，表面印有蓝色标识；这一段较长的原始说明不应因为整段长度而导致前一条完整短句也被丢弃';
  const shots = await contentCreationTurn('fixture', { action: 'products', selection: { ...base(), productIds: ['fixture-product'] }, instruction: '测试' }, f.ports);
  const reply = await contentCreationTurn('fixture', { action: 'shots', selection: shots.selection, instruction: '测试' }, f.ports);
  assert.equal(reply.narrations.length, 3);
  for (const narration of reply.narrations) {
    assert.match(narration.text, /企业资料记录：杯身为白色，表面印有蓝色标识。/);
    assert.ok(narration.seconds >= 15 && narration.seconds <= 30);
  }
  assert.ok(reply.gaps.some(gap => gap.includes('不足15秒')));
});

test('production Q&A reuses evidence with no digital human, keeps reference-only and missing product separate, and accepts editorial text only as draft', async () => {
  const f = await prepared();
  const selection = { ...f.narration.selection, narrationId: 'visual' as const, avatar: false };
  const storyboard = await f.run('production_storyboard', selection);
  assert.equal(storyboard.stage, 'production_shots');
  assert.equal(storyboard.production?.shots[0]?.status, 'reference_only');
  const materials = await f.run('production_match', storyboard.selection);
  assert.equal(materials.stage, 'production_materials');
  const edit = await f.run('production_edit', { ...materials.selection, productionDraft: { materialChoice: 'candidate' } });
  assert.equal(edit.stage, 'production_narration');
  const review = await f.run('production_review', { ...edit.selection, productionDraft: { materialChoice: 'skip', narrationDraft: '这是人工编辑的产品口播草稿；更多规格以真实资料为准。' } });
  assert.equal(review.stage, 'production_review');
  assert.match(review.production!.narration, /人工编辑/);
  assert.ok(review.production?.shots.some(shot => shot.status === 'skipped'));
  assert.equal(review.avatarPlacement, 'none');
  assert.ok(review.gaps.some(gap => gap.includes('人工编辑')));
  await assert.rejects(f.run('production_match', { ...selection, avatar: true }), /不加入/);
  await assert.rejects(f.run('production_edit', selection), /是否保留/);
  await assert.rejects(f.run('production_review', { ...review.selection, evidenceVersion: '0'.repeat(64) }), /证据已变化/);
});

test('production draft cannot match a reference or unrelated product as product footage', async () => {
  const f = creationDialogueFixture(); f.materials[2]!.productId = 'unrelated';
  const run = (action: CreationTurn['action'], selection: CreationSelection) => contentCreationTurn('fixture', { action, selection, instruction: '测试' }, f.ports);
  const shots = await run('products', { ...base(), productIds: ['fixture-product'] });
  const narration = await run('shots', shots.selection);
  const reply = await run('production_storyboard', { ...narration.selection, narrationId: 'visual', avatar: false });
  assert.equal(reply.production?.shots[0]?.status, 'reference_only');
  assert.deepEqual(reply.production?.shots.find(shot => shot.id === 'missing:product'), { id: 'missing:product', title: '所选产品实拍 · 待补', description: '没有找到关联当前产品的已核验实拍；不分配参考视频或第三方产品画面。', status: 'missing' });
});

test('voice, subtitles and preview continue the existing read-only Q&A with an explicit unbound project gap', async () => {
  const f = await prepared();
  let reply = await f.run('production_review', { ...f.narration.selection, avatar: false, narrationId: 'visual', productionDraft: { materialChoice: 'candidate', narrationDraft: '已确认产品口播文字；具体规格请以正式产品资料为准。' } });
  reply = await f.run('production_voice', reply.selection);
  assert.equal(reply.stage, 'production_voice'); assert.equal(reply.production?.finishing?.code, 'creation_project_unbound');
  await assert.rejects(f.run('production_subtitles', reply.selection), /配音需求/);
  reply = await f.run('production_subtitles', { ...reply.selection, productionDraft: { ...reply.selection.productionDraft, voiceChoice: 'defer' } });
  assert.equal(reply.stage, 'production_subtitles');
  await assert.rejects(f.run('production_preview', reply.selection), /字幕文字/);
  reply = await f.run('production_preview', { ...reply.selection, productionDraft: { ...reply.selection.productionDraft, subtitleChoice: 'draft', subtitleDraft: '人工字幕文字草稿，没有音频对齐。' } });
  assert.equal(reply.production?.finishing?.subtitleText, '人工字幕文字草稿，没有音频对齐。');
  assert.equal(reply.production?.finishing?.binding, 'unbound');
  assert.equal(reply.stage, 'production_preview'); assert.ok(reply.gaps.some(gap => gap.includes('没有真实音频对齐')));
  assert.doesNotMatch(JSON.stringify(reply.production?.finishing), /previewUrl|audioUrl|"start"|"completed"/);
  reply = await f.run('production_finish', reply.selection);
  assert.equal(reply.stage, 'production_finish');
  const edited = await f.run('production_review', reply.selection);
  assert.equal(edited.selection.productionDraft?.voiceChoice, undefined, 'reconfirming narration invalidates downstream choices');
});
