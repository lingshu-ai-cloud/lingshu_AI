import assert from 'node:assert/strict';
import test from 'node:test';
import { canSkipCollectionForExplicitReferences, evaluatePlannedReferenceReuse, evaluateViralAnalysisCoverage, hasParseableExactVideoAnalysis, reusableExplicitReferenceIds, usedViralReferenceIdsFromBatches, viralCoverageBypassAllowed } from './viralAnalysisCoverage.js';
import type { VideoCreationPlan } from '../../shared/contracts/videoCreationPlan.js';

const plan = (id: string, referenceId = '') => ({
  contentId: id, contentFamilyId: id, masterContentId: id, productionRole: 'master',
  route: 'clone', referenceId,
}) as VideoCreationPlan;
const evidence = (id: string, visual = `画面 ${id}`) => ({ id, duration: 3, updatedAt: '2026-10-12T00:00:00.000Z', aiAnalysis: {
  analysisMode: 'exact', analysisQuality: 'video', geminiStatus: 'analyzed', gemini: {
    scriptDetails15s: [{
      time: '0-3s', visual, materialType: 'product', narrativeRole: 'hook',
      classificationEvidence: '画面明确展示产品包装', analysisGranularity: 'shot',
    }],
  },
} });

test('one exact analysis cannot complete five clone masters', () => {
  const result = evaluateViralAnalysisCoverage([1, 2, 3, 4, 5].map(index => plan(`master-${index}`)), [evidence('reference-1')]);
  assert.equal(result.ready, false);
  assert.equal(result.requiredCount, 5);
  assert.equal(result.completedCount, 1);
  assert.match(result.blockedReason, /还缺 4 条/);
});

test('missing clone-master plan cannot be mistaken for completed analysis', () => {
  const result = evaluateViralAnalysisCoverage([], [evidence('reference-1')]);
  assert.equal(result.ready, false);
  assert.equal(result.requiredCount, 0);
  assert.match(result.blockedReason, /周计划尚未形成/);
});

test('platform adaptations do not increase required exact-analysis count', () => {
  const master = plan('master-1');
  const adaptation = { ...master, contentId: 'adaptation-1', productionRole: 'platform_adaptation' } as VideoCreationPlan;
  const result = evaluateViralAnalysisCoverage([master, adaptation], [evidence('reference-1')]);
  assert.equal(result.ready, true);
  assert.equal(result.requiredCount, 1);
});

test('truthy but unparseable gemini envelope is not accepted', () => {
  const malformed = { id: 'bad', aiAnalysis: { analysisMode: 'exact', analysisQuality: 'video', gemini: { summary: '只有摘要' } } };
  assert.equal(hasParseableExactVideoAnalysis(malformed), false);
  const result = evaluateViralAnalysisCoverage([plan('master-1', 'bad')], [malformed]);
  assert.equal(result.ready, false);
  assert.deepEqual(result.invalidReferenceIds, ['bad']);
  assert.match(result.blockedReason, /指定参考尚无可解析精确分析/);
});

test('analysis completion uses the same strict admission rule as production', () => {
  const base = evidence('reference-1');
  const unknownType = structuredClone(base);
  unknownType.aiAnalysis.gemini.scriptDetails15s[0]!.materialType = 'unknown';
  assert.equal(hasParseableExactVideoAnalysis(unknownType), false);

  const reviewWindow = structuredClone(base);
  reviewWindow.aiAnalysis.gemini.scriptDetails15s[0]!.analysisGranularity = 'observation_window';
  assert.equal(hasParseableExactVideoAnalysis(reviewWindow), false);

  const reviewStatus = structuredClone(base);
  reviewStatus.aiAnalysis.analysisQuality = 'video_review_required';
  assert.equal(hasParseableExactVideoAnalysis(reviewStatus), false);

  const incompleteTimeline = { ...structuredClone(base), duration: 8 };
  assert.equal(hasParseableExactVideoAnalysis(incompleteTimeline), false);
});

test('every clone master requires independent parseable evidence', () => {
  const result = evaluateViralAnalysisCoverage(
    [plan('master-1', 'reference-1'), plan('master-2', 'reference-2')],
    [evidence('reference-1'), evidence('reference-2')],
  );
  assert.equal(result.ready, true);
  assert.equal(result.completedCount, 2);
  assert.equal(result.blockedReason, '');
});

test('duplicate family rows and duplicate evidence do not inflate coverage', () => {
  const first = plan('master-1');
  const duplicate = { ...plan('other-row'), contentFamilyId: 'master-1' } as VideoCreationPlan;
  const row = evidence('reference-1');
  const result = evaluateViralAnalysisCoverage([first, duplicate], [row, row]);
  assert.equal(result.requiredCount, 1);
  assert.equal(result.completedCount, 1);
  assert.equal(result.ready, true);
});

test('automatically recommended old reference is not explicit reuse authority', () => {
  const automatic = {
    ...plan('master-1', 'old-reference'),
    planningEvidence: { generatedFrom: 'matrix_benchmark_viral' },
  } as VideoCreationPlan;
  const explicit = plan('master-2', 'user-reference');
  assert.deepEqual(reusableExplicitReferenceIds([automatic, explicit]), ['user-reference']);
  const result = evaluateViralAnalysisCoverage(
    [automatic, explicit],
    [evidence('user-reference')],
    { explicitReferenceIds: reusableExplicitReferenceIds([automatic, explicit]) },
  );
  assert.equal(result.ready, false);
  assert.deepEqual(result.invalidReferenceIds, []);
  assert.match(result.blockedReason, /还缺 1 条/);
});

test('all typed matrix provenance variants remain automatic rather than explicit', () => {
  for (const generatedFrom of ['matrix_benchmark_viral', 'matrix_viral', 'matrix_product'] as const) {
    const automatic = {
      ...plan(`master-${generatedFrom}`, 'old-reference'), planningEvidence: { generatedFrom },
    } as VideoCreationPlan;
    assert.deepEqual(reusableExplicitReferenceIds([automatic]), [], generatedFrom);
  }
});

test('collection skip accepts only fully analyzed user-explicit references', () => {
  const explicit = plan('master-explicit', 'explicit-reference');
  assert.equal(canSkipCollectionForExplicitReferences([explicit], [evidence('explicit-reference')]), true);
  const automatic = { ...explicit, planningEvidence: { generatedFrom: 'matrix_viral' } } as VideoCreationPlan;
  assert.equal(canSkipCollectionForExplicitReferences([automatic], [evidence('explicit-reference')]), false);
  assert.equal(canSkipCollectionForExplicitReferences([explicit], [{ id: 'explicit-reference', aiAnalysis: { analysisMode: 'exact' } }]), false);
});

test('persisted production handoffs consume automatic references but exclude the active run', () => {
  const used = usedViralReferenceIdsFromBatches([
    { run_id: 'older-run', orders: JSON.stringify([{ videoPlan: { referenceId: 'used-master' }, deliveryVariants: [{ referenceId: 'used-variant' }], evidenceRefs: [{ type: 'exact_analysis', id: 'used-legacy-evidence' }] }]) },
    { run_id: 'active-run', orders: [{ videoPlan: { referenceId: 'active-reference' } }] },
  ], 'active-run');
  assert.deepEqual(used.sort(), ['used-legacy-evidence', 'used-master', 'used-variant']);
});

test('weekly inventory accepts unused exact references and preserves deliberate explicit reuse', () => {
  const automatic = {
    ...plan('master-auto', 'automatic-reference'),
    planningEvidence: { generatedFrom: 'matrix_viral' },
  } as VideoCreationPlan;
  const explicit = plan('master-explicit', 'explicit-reference');
  const records = [evidence('automatic-reference'), evidence('explicit-reference')];
  assert.equal(evaluatePlannedReferenceReuse([automatic, explicit], records, []).ready, true);
  const consumedAutomatic = evaluatePlannedReferenceReuse([automatic, explicit], records, ['automatic-reference', 'explicit-reference']);
  assert.equal(consumedAutomatic.ready, false);
  assert.equal(consumedAutomatic.reusableCount, 1, 'the explicit user selection remains intentionally reusable');
  assert.deepEqual(consumedAutomatic.selectedReferenceIds, ['explicit-reference']);
});

test('one library reference cannot satisfy two independent weekly videos', () => {
  const first = { ...plan('master-1', 'same-reference'), planningEvidence: { generatedFrom: 'matrix_viral' } } as VideoCreationPlan;
  const second = { ...plan('master-2', 'same-reference'), planningEvidence: { generatedFrom: 'matrix_viral' } } as VideoCreationPlan;
  const result = evaluatePlannedReferenceReuse([first, second], [evidence('same-reference')], []);
  assert.equal(result.ready, false);
  assert.equal(result.requiredCount, 2);
  assert.equal(result.reusableCount, 1);
  assert.equal(result.missingCount, 1);
});

test('viral analysis cannot be skipped or manually completed before coverage', () => {
  assert.equal(viralCoverageBypassAllowed('viral_analysis', 'skip', false), false);
  assert.equal(viralCoverageBypassAllowed('viral_analysis', 'manual_complete', false), false);
  assert.equal(viralCoverageBypassAllowed('viral_analysis', 'retry', false), true);
  assert.equal(viralCoverageBypassAllowed('viral_analysis', 'manual_complete', true), true);
});
