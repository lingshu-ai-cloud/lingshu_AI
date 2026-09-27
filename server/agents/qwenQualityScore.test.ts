import assert from 'node:assert/strict';
import { normalizeQwenQualityScore } from './qwen.js';

assert.equal(normalizeQwenQualityScore(9), 90);
assert.equal(normalizeQwenQualityScore('8.5'), 85);
assert.equal(normalizeQwenQualityScore(86), 86);
assert.equal(normalizeQwenQualityScore(120), 100);
assert.equal(normalizeQwenQualityScore(-2), 0);
assert.equal(normalizeQwenQualityScore('not-a-score'), 0);

console.log('qwen quality score normalization tests passed');
