import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeImageReferenceProductionLabels } from '../../shared/contracts/imageReferenceProductionLabel.js';
import { IMAGE_POST_VISUAL_STYLE_RUBRIC } from './imagePostVisualStyleRubric.js';

const hash = 'a'.repeat(64);
const source = [{ imageIndex: 1, sourceSha256: hash }];

test('both visual analyzers use the same evidence-first style rubric and contrasting cases', () => {
  for (const name of ['qwen.ts', 'gemini.ts']) {
    const analyzer = readFileSync(new URL(name, import.meta.url), 'utf8');
    assert.match(analyzer, /import \{ IMAGE_POST_VISUAL_STYLE_RUBRIC \}/);
    assert.match(analyzer, /\$\{IMAGE_POST_VISUAL_STYLE_RUBRIC\}/);
  }
  for (const cue of ['先完成 observedFacts', '乳霜纹理', '滴管', '蓝色圆台', '展会桌面', '产品瓶与植物', 'unknown']) {
    assert.ok(IMAGE_POST_VISUAL_STYLE_RUBRIC.includes(cue), `缺少边界样例或证据要求：${cue}`);
  }
  assert.match(IMAGE_POST_VISUAL_STYLE_RUBRIC, /不能让它们反推 style/);
});

test('style remains independent of real-shoot requirement and product presence', () => {
  const labels = normalizeImageReferenceProductionLabels([{ imageIndex: 1, kind: 'shoot_required',
    productPresence: 'present', evidence: '展会桌面摆着产品，背景有真实展位', confidence: .93,
    style: { kind: 'imitable', confidence: .91, evidence: '自然展台环境与非对称产品近景', elements: ['asymmetric', 'close_up'] } }], source);
  assert.equal(labels[0]?.kind, 'shoot_required');
  assert.equal(labels[0]?.productPresence, 'present');
  assert.equal(labels[0]?.style?.kind, 'imitable');
  assert.equal(labels[0]?.sourceSha256, hash);
});

test('ambiguous visual style cannot become a production style by confidence alone', () => {
  const [label] = normalizeImageReferenceProductionLabels([{ imageIndex: 1, kind: 'product_only',
    productPresence: 'present', evidence: '产品瓶与植物平铺', confidence: .95,
    style: { kind: 'unknown', confidence: .99, evidence: '广告和原料叙事信号混合', elements: ['centered'] } }], source);
  assert.equal(label?.kind, 'product_only');
  assert.equal(label?.style?.kind, 'unknown');
  assert.equal(label?.style?.confidence, 0);
});
