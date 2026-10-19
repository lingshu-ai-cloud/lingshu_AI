import assert from 'node:assert/strict';
import test from 'node:test';
import { freezeSocialReferenceBackgroundAsset, assertSocialReferenceBackgroundAssetCurrent } from './socialContentReferenceBackgroundLock.js';

const hash = (value: string) => value.repeat(64);
const reuse = { recordId: 'trend-1', contentSha256: hash('a'), analysisId: 'analysis-1', analysisHash: hash('b') };
const analysis = {
  analysisId: 'analysis-1', version: '1', referenceSourceId: 'source-1', referenceRecordId: 'trend-1', status: 'ready' as const,
  durationSeconds: 3, shots: [{ shotId: 'shot-1', startSeconds: 0, endSeconds: 3,
    materialEvidence: { sourceVideoRef: 'source-1', clipRef: '/api/reference/shot-1/clip', firstFrameRef: '/api/reference/shot-1/first-frame', firstFrameSeconds: .2, extractionStatus: 'ready' as const },
    visualDescription: '人物在工厂背景中展示产品', spokenText: '产品介绍', captionText: null, audioDescription: null,
    rhythmDescription: '快', purpose: 'hook' as const,
    tags: { sceneTypes: ['factory'], subjects: ['presenter'], subjectRelations: [], cameraLanguage: ['medium'], contentFunctions: ['hook' as const], soundTypes: ['speech'], onScreenInformation: [], truthRequirements: [], suggestedProductionMethods: [] },
    fidelityPoints: ['背景构图'], mustDifferPoints: ['企业人物和产品'] }], hookAnalysis: null, rightsNotice: 'reference only', createdAt: '2026-10-17T00:00:00Z',
};

test('freezes and revalidates exact reference background lineage', () => {
  const lock = freezeSocialReferenceBackgroundAsset({ referenceReuse: reuse, referenceAnalysis: analysis, referenceShotId: 'shot-1' });
  assert.equal(lock.referenceRecordId, 'trend-1');
  assert.equal(lock.firstFrameSeconds, .2);
  assert.equal(assertSocialReferenceBackgroundAssetCurrent({ lock, referenceReuse: reuse, referenceAnalysis: analysis, expectedReferenceShotId: 'shot-1' }), lock);
});

test('blocks missing background extraction and source drift', () => {
  assert.throws(() => freezeSocialReferenceBackgroundAsset({ referenceReuse: reuse, referenceAnalysis: { ...analysis, shots: [{ ...analysis.shots[0]!, materialEvidence: { ...analysis.shots[0]!.materialEvidence!, firstFrameRef: null } }] }, referenceShotId: 'shot-1' }), /reference_background_evidence_missing/);
  const lock = freezeSocialReferenceBackgroundAsset({ referenceReuse: reuse, referenceAnalysis: analysis, referenceShotId: 'shot-1' });
  assert.throws(() => assertSocialReferenceBackgroundAssetCurrent({ lock, referenceReuse: { ...reuse, contentSha256: hash('c') }, referenceAnalysis: analysis, expectedReferenceShotId: 'shot-1' }), /reference_background_source_changed/);
});

test('blocks shot, interval, frame and lock drift before generation', () => {
  const lock = freezeSocialReferenceBackgroundAsset({ referenceReuse: reuse, referenceAnalysis: analysis, referenceShotId: 'shot-1' });
  assert.throws(() => assertSocialReferenceBackgroundAssetCurrent({ lock, referenceReuse: reuse, referenceAnalysis: analysis, expectedReferenceShotId: 'other' }), /reference_background_shot_changed/);
  assert.throws(() => assertSocialReferenceBackgroundAssetCurrent({ lock, referenceReuse: reuse, referenceAnalysis: { ...analysis, shots: [{ ...analysis.shots[0]!, endSeconds: 2.9 }] }, expectedReferenceShotId: 'shot-1' }), /reference_background_evidence_changed/);
  assert.throws(() => assertSocialReferenceBackgroundAssetCurrent({ lock: { ...lock, firstFrameRef: '/changed' }, referenceReuse: reuse, referenceAnalysis: analysis, expectedReferenceShotId: 'shot-1' }), /reference_background_lock_changed/);
});
