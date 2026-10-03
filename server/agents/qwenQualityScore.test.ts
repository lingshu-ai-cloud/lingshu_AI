import assert from 'node:assert/strict';
import { materialAnalysisTokenBudget, normalizeQwenQualityScore } from './qwen.js';

assert.equal(normalizeQwenQualityScore(9), 90);
assert.equal(normalizeQwenQualityScore('8.5'), 85);
assert.equal(normalizeQwenQualityScore(86), 86);
assert.equal(normalizeQwenQualityScore(120), 100);
assert.equal(normalizeQwenQualityScore(-2), 0);
assert.equal(normalizeQwenQualityScore('not-a-score'), 0);
assert.equal(materialAnalysisTokenBudget(8), 2400);
assert.equal(materialAnalysisTokenBudget(48), 6720, 'long factory reels need enough output room for complete JSON');
assert.equal(materialAnalysisTokenBudget(100), 7200, 'material analysis output remains bounded');

console.log('qwen quality score normalization tests passed');
