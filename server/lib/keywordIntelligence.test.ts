import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCaptionReplicationContract, hashtagValue, mergePlannedHashtags, researchKeywords } from './keywordIntelligence.js';

test('normalizes multi-word keyword into a usable hashtag', () => {
  assert.equal(hashtagValue('lipstick factory'), 'LipstickFactory');
});

test('extracts benchmark caption structure without copying its facts', () => {
  const contract = buildCaptionReplicationContract('🚗 News hook\nProof paragraph\nRead more\n#BASF #AutomotiveCoatings');
  assert.equal(contract.sourceAvailable, true);
  assert.equal(contract.hasCallToAction, true);
  assert.deepEqual(contract.emojiPattern, ['🚗']);
  assert.equal(contract.hashtagCount, 4);
});

test('keeps enterprise brand and category hashtags mandatory', () => {
  const plan = researchKeywords({ platform: 'facebook', language: 'en', brandName: 'Ling Shu', categoryTerms: ['Lipstick Factory'], referenceCaption: '#BASF #Innovation' });
  const merged = mergePlannedHashtags(['Beauty'], plan);
  assert.ok(merged.includes('LingShu'));
  assert.ok(merged.includes('LipstickFactory'));
  assert.equal(merged.includes('BASF'), false);
});
