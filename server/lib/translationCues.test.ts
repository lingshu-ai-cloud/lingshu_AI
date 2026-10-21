import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCompleteTimestampTranslation, normalizeTimestampTranslationValue, timestampedTranslationCues, translationValueForLanguage } from './translationCues.js';

const source = '[0-4s] 买家，你怎么判断这个风险？\n[4-8s] 检查可见细节。';

test('timestamp cue normalization preserves source ranges and rejects omitted cues', () => {
  assert.equal(timestampedTranslationCues(source).length, 2);
  assert.equal(normalizeCompleteTimestampTranslation(source, '[0-4s] Buyers, how do you judge this risk?', 'en'), '');
  assert.equal(normalizeTimestampTranslationValue(source, { lines: ['Buyers, how do you judge this risk?', 'Check the visible details.'] }, 'en'), '[0-4s] Buyers, how do you judge this risk?\n[4-8s] Check the visible details.');
});

test('JSON-wrapped line lists are recovered and repeated collapsed translations are rejected', () => {
  assert.equal(normalizeTimestampTranslationValue(source, 'Result: {"lines":["Buyers, how do you judge this risk?","Check the visible details."]}', 'en'), '[0-4s] Buyers, how do you judge this risk?\n[4-8s] Check the visible details.');
  assert.equal(normalizeCompleteTimestampTranslation(source, '[0-4s] Check details.\n[4-8s] Check details.', 'en'), '');
});

test('language extraction accepts code, display label, nested map and row forms', () => {
  assert.equal(translationValueForLanguage({ translations: { en: ['hello'] } }, 'en', 'English') instanceof Array, true);
  assert.deepEqual(translationValueForLanguage({ translations: [{ language: 'English', lines: ['hello'] }] }, 'en', 'English'), ['hello']);
});
