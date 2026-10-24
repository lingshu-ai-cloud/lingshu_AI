import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentCreationTurn } from './contentCreationDialogue.js';
import { guidedCreationFixture as setup } from '../../scripts/fixtures/guidedCreation.js';
import type { CreationSelection, CreationTurn } from '../../shared/contracts/contentCreationDialogue.js';
import { guidedEnterpriseContext } from './guidedCreationKnowledge.js';
import { buildSocialTaskReferencePackage } from '../starter198/socialContentScriptSources.js';
import { applyGuidedCreationStructure } from '../starter198/guidedCreationStructure.js';
import type { EnterpriseProfile } from '../routes/enterprise.js';

test('guided flow combines products/languages and only recommends a real same-opening tenant reference', async () => {
  const f = setup();
  const start = await f.run('start', f.initial);
  assert.equal(start.stage, 'guided_products');
  await assert.rejects(f.run('guided_products', { ...start.selection, productIds: ['fixture-product'] }), /语言/);
  const next = await f.run('guided_products', { ...start.selection, productIds: ['fixture-product', 'fixture-product-2'], guided: { ...start.selection.guided!, languages: ['en', 'zh'] } });
  assert.equal(next.stage, 'guided_structure');
  assert.deepEqual(next.guided!.structures.map(row => row.source), ['reference', 'recommended', 'custom']);
  assert.equal(next.guided!.structures[1]!.referenceId, 'recommended-video');
  assert.equal(next.guided!.structures[1]!.views, 12345);
  assert.equal(next.guided!.structures[1]!.nodes[0]!.type, next.guided!.structures[0]!.nodes[0]!.type);
  assert.deepEqual(next.selection.productIds, ['fixture-product', 'fixture-product-2']);
});
test('recommended structure and speech always share source; missing rights and footage remain honest', async () => {
  const f = setup();
  let reply = await f.run('guided_products', { ...f.initial, productIds: ['fixture-product'], guided: { ...f.initial.guided!, languages: ['en'] } });
  reply = await f.run('guided_structure', { ...reply.selection, guided: { ...reply.selection.guided!, structureId: 'recommended:recommended-video' } });
  reply = await f.run('guided_production', { ...reply.selection, guided: { ...reply.selection.guided!, productionMode: 'auto', presenterMode: 'digital' } });
  assert.equal(reply.stage, 'guided_review');
  assert.equal(reply.guided!.narration.sourceReferenceId, 'recommended-video');
  assert.equal(reply.guided!.narration.status, 'ready');
  assert.match(reply.guided!.narration.text, /样品杯/);
  assert.doesNotMatch(reply.guided!.narration.text, /OldProduct/);
  assert.ok(reply.guided!.blockers.some(row => row.code === 'creation_presenter_required'));
  assert.ok(reply.guided!.blockers.some(row => row.code === 'creation_material_required'));
  assert.equal(reply.guided!.nodes.some(row => row.status === 'matched'), false);
  const resumed = await f.run('guided_review', { ...reply.selection, guided: { ...reply.selection.guided!, taskId: 'persisted-task' } });
  assert.equal(resumed.guided!.fingerprint, reply.guided!.fingerprint, 'a task receipt must not change semantic plan identity');
  await assert.rejects(f.run('guided_review', { ...reply.selection, guided: { ...reply.selection.guided!, assignments: [{ nodeId: 'node:1', intent: 'match', candidateId: 'forged' }] } }), /候选/);
  f.materials[0]!.segments[0]!.observedFacts = 'changed';
  await assert.rejects(f.run('guided_review', reply.selection), /证据已变化/);
});
test('custom repeated/reordered visuals preserve canonical source narration and full time coverage', async () => {
  const f = setup();
  let reply = await f.run('guided_products', { ...f.initial, productIds: ['fixture-product', 'fixture-product-2'], guided: { ...f.initial.guided!, languages: ['en'] } });
  const nodes = [{ id: 'custom:a', type: 'product' as const }, { id: 'custom:b', type: 'product' as const }, { id: 'custom:c', type: 'factory' as const }];
  reply = await f.run('guided_structure', { ...reply.selection, guided: { ...reply.selection.guided!, structureId: 'custom', customNodes: nodes } });
  reply = await f.run('guided_production', { ...reply.selection, guided: { ...reply.selection.guided!, productionMode: 'manual', presenterMode: 'none', assignments: nodes.map(node => ({ nodeId: node.id, intent: 'generate' as const })) } });
  assert.deepEqual(reply.guided!.nodes.map(node => node.id), nodes.map(node => node.id));
  assert.ok(reply.guided!.blockers.some(row => row.code === 'creation_factory_evidence_required'));
  const context = guidedEnterpriseContext(f.profile as unknown as EnterpriseProfile, reply.selection.productIds);
  assert.match(context.productName!, /样品杯、样品盖/);
  assert.ok(context.facts.some(fact => fact.key.startsWith('fixture-product-2.')));
  const source = buildSocialTaskReferencePackage({ record: f.reference, source: { sourceId: 'fixture-video', sourceRef: 'trendvideo:fixture-video', sourceVersion: null, createdAt: '2026-10-24T00:00:00Z' }, themeId: 'supplier_capability', verifiedContext: context })!;
  // The pure visual adapter is tested with an admitted plan; actual submission still rejects the above genuine blockers.
  const admitted = { ...reply, guided: { ...reply.guided!, blockers: [] } };
  assert.equal(reply.guided!.nodes.reduce((sum, node) => sum + node.duration, 0), f.reference.duration);
  const adapted = applyGuidedCreationStructure(source, admitted);
  assert.equal(adapted.replicationScript.shots.length, 3);
  assert.equal(adapted.replicationScript.shots[0]!.startSeconds, 0);
  assert.equal(adapted.replicationScript.shots.at(-1)!.endSeconds, source.referenceVideoAnalysis.durationSeconds);
  assert.deepEqual(adapted.replicationScript.narrationLines!.map(row => [row.referenceText, row.draftText, row.sourceStartSeconds, row.sourceEndSeconds]), source.replicationScript.narrationLines!.map(row => [row.referenceText, row.draftText, row.sourceStartSeconds, row.sourceEndSeconds]));
  assert.deepEqual(adapted.referenceVideoAnalysis, source.referenceVideoAnalysis);
});

test('authorized historical benchmark footage never becomes enterprise product or factory footage', async () => {
  const f = setup();
  for (const material of f.materials) Object.assign(material, { sourceType: 'tiktok_reference', usage: 'editable', commercialUseApproved: true, derivativesApproved: true, rawLibraryUseApproved: true, mayUseInProduction: true });
  let reply = await f.run('guided_products', { ...f.initial, productIds: ['fixture-product'], guided: { ...f.initial.guided!, languages: ['en'] } });
  reply = await f.run('guided_structure', { ...reply.selection, guided: { ...reply.selection.guided!, structureId: 'recommended:recommended-video' } });
  reply = await f.run('guided_production', { ...reply.selection, guided: { ...reply.selection.guided!, productionMode: 'auto', presenterMode: 'none' } });
  assert.deepEqual(reply.guided!.candidates, []);
  assert.ok(reply.guided!.blockers.some(row => row.code === 'creation_material_required'));
});
