import assert from 'node:assert/strict';
import test from 'node:test';
import type { Material, MaterialSegment } from '../../lib/studioApi';
import type { ScriptDetail15s } from '../../lib/inspirationTypes';
import { matchMaterialsToFrames, parseFrameTimeRange } from './inspirationFrameMatching';

const productFrame: ScriptDetail15s = {
  time: '0-3', environment: 'studio', shot: '特写', angle: '正面', composition: '居中', camera: '固定',
  visual: '产品包装', subtitle: '产品包装', audio: '', purpose: '产品揭晓', beats: [{ action: '展示产品包装' }],
  viralPotential: { score: 85, whyEffective: '产品身份立即可见', mechanisms: ['产品揭晓'] },
};

function videoWithSegments(segments: MaterialSegment[]): Material {
  return { id: 'material-1', name: '产品素材', folder: '', type: 'video', duration: 10,
    size: '1 MB', file: 'material.mp4', url: '/material.mp4', segments } as Material;
}

function segment(overrides: Partial<MaterialSegment> = {}): MaterialSegment {
  return {
    id: 'segment-1', start: 0, end: 3, duration: 3, subject: ['产品包装'], action: '展示产品包装',
    productVisible: true, productClarity: 'high', shot: '特写', angle: '正面', composition: '居中', camera: '固定',
    environment: 'studio', quality: 100, ocrText: '', hasPerson: false, hasLogo: false, logoText: [],
    recommendedFunctions: ['产品揭晓'], authenticity: '', confidence: 1, needsReview: false,
    ...overrides,
  };
}

test('frame matching distinguishes missing, pending analysis, and verified local segments', () => {
  assert.deepEqual(parseFrameTimeRange('0-3'), { start: 0, end: 3, duration: 3 });
  const missing = matchMaterialsToFrames([productFrame], [])[0]!;
  assert.equal(missing.status, 'missing');
  assert.equal(missing.decision, 'route_required');
  assert.equal(missing.replicability.aiFeasibility, 'low');
  assert.equal(matchMaterialsToFrames([productFrame], [videoWithSegments([])])[0]?.status, 'pending_analysis');
  assert.equal(matchMaterialsToFrames([productFrame], [videoWithSegments([segment({ productVisible: false })])])[0]?.status, 'missing', 'product identity hard gate must not be beaten by a score');
  const matched = matchMaterialsToFrames([productFrame], [videoWithSegments([segment()])])[0]!;
  assert.equal(matched.segment?.id, 'segment-1');
  assert.notEqual(matched.status, 'missing');
  assert.equal(matched.trim?.start, 0);
});

test('legacy segment arrays and authenticity review never become trusted matches by assumption', () => {
  const legacy = segment({ recommendedFunctions: undefined as unknown as string[], subject: undefined as unknown as string[], logoText: undefined as unknown as string[] });
  assert.doesNotThrow(() => matchMaterialsToFrames([productFrame], [videoWithSegments([legacy])]));
  const reviewedFrame = { ...productFrame, authenticity: '真实证明' };
  const pending = matchMaterialsToFrames([reviewedFrame], [videoWithSegments([segment({ needsReview: true, manualConfirmed: false })])])[0]!;
  assert.ok(pending.score <= 59);
  assert.notEqual(pending.status, 'high');
});
