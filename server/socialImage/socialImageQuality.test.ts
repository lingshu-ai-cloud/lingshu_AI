import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeSocialImageVisualChecks } from './socialImageQuality.js';

test('visual QA resolves uncertain checks but cannot overwrite deterministic facts', () => {
  const merged = mergeSocialImageVisualChecks([
    { key:'product_identity', verdict:'pass', severity:'hard', checker:'deterministic', note:'bound' },
    { key:'fact_consistency', verdict:'fail', severity:'hard', checker:'deterministic', note:'missing' },
    { key:'packaging_visibility', verdict:'uncertain', severity:'hard', checker:'deterministic', note:'pending' },
    { key:'safe_zone', verdict:'uncertain', severity:'hard', checker:'deterministic', note:'pending' },
  ], [
    { key:'product_identity', verdict:'fail', severity:'hard', checker:'multimodal', note:'model disagrees' },
    { key:'fact_consistency', verdict:'pass', severity:'hard', checker:'multimodal', note:'model guessed' },
    { key:'packaging_visibility', verdict:'pass', severity:'hard', checker:'multimodal', note:'cap and label visible' },
  ]);
  assert.equal(merged[0]?.verdict, 'pass');
  assert.equal(merged[1]?.verdict, 'fail');
  assert.equal(merged[2]?.verdict, 'pass');
  assert.equal(merged[3]?.verdict, 'uncertain');
});
