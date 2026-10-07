import assert from 'node:assert/strict';
import * as legacyContinuationPolicy from '../../src/lib/continuationPolicy.js';
import * as legacyOperatingMaturity from '../../src/lib/operatingMaturity.js';
import * as legacyVideoCreationPlan from '../../src/lib/videoCreationPlan.js';
import * as legacyVideoLanguages from '../../src/lib/videoLanguages.js';
import * as sharedContinuationPolicy from '../../shared/contracts/continuationPolicy.js';
import * as sharedOperatingMaturity from '../../shared/contracts/operatingMaturity.js';
import * as sharedVideoCreationPlan from '../../shared/contracts/videoCreationPlan.js';
import * as sharedVideoLanguages from '../../shared/contracts/videoLanguages.js';

function assertExportsMatch(label: string, legacyEntry: object, sharedEntry: object): void {
  const legacyExports = legacyEntry as Record<string, unknown>;
  const sharedExports = sharedEntry as Record<string, unknown>;
  const legacyKeys = Object.keys(legacyExports).sort();
  const sharedKeys = Object.keys(sharedExports).sort();

  assert.deepEqual(legacyKeys, sharedKeys, `${label} must expose the same runtime exports from both entry points`);
  for (const key of sharedKeys) {
    assert.strictEqual(legacyExports[key], sharedExports[key], `${label}.${key} must re-export the canonical shared binding`);
  }
}

assertExportsMatch('videoLanguages', legacyVideoLanguages, sharedVideoLanguages);
assertExportsMatch('videoCreationPlan', legacyVideoCreationPlan, sharedVideoCreationPlan);
assertExportsMatch('continuationPolicy', legacyContinuationPolicy, sharedContinuationPolicy);
assertExportsMatch('operatingMaturity', legacyOperatingMaturity, sharedOperatingMaturity);

const normalizedPreview = sharedVideoCreationPlan.normalizeVideoPlan({
  route: 'product', productName: '产品 A', theme: '采购顾虑', language: 'en', duration: 30,
  platform: 'youtube', materialIds: ['asset-1'], referenceId: '', presenter: 'material',
  heygenAvatarId: '', avatarConsent: false, voice: 'v1',
  preproduction: {
    version: 1, status: 'ready', generatedAt: '2026-10-05T00:00:00.000Z',
    benchmark: { status: 'not_applicable', referenceId: '', title: '', account: '', views: '', thumbnailUrl: 'javascript:alert(1)', sourceUrl: '/api/reference/1', hook: '真实钩子', shotSummary: ['镜头功能：问题'] },
    materials: { status: 'ready', items: [{ id: 'asset-1', name: '产品正面', type: 'image', previewUrl: '/api/assets/1', status: 'ready' }], blockers: [], pendingShootTaskIds: [] },
    readiness: { canStart: true, blockers: [] },
    confidence: { onTimeRate: null, effectLevel: 'low', reasons: ['尚无历史发布样本'] },
  },
});
assert.equal(normalizedPreview.preproduction?.readiness.canStart, true, 'persisted pre-production readiness must survive the shared client/server boundary');
assert.equal(normalizedPreview.preproduction?.benchmark.thumbnailUrl, '', 'pre-production previews must reject unsafe URLs');
assert.equal(normalizedPreview.preproduction?.confidence.onTimeRate, null, 'missing historical evidence must remain unknown rather than becoming a fake success rate');

console.log('shared contract compatibility tests passed');
