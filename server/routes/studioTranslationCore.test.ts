import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractJSON, langName } from './studioTranslationCore.js';

test('studio translation keeps the existing language labels and fallback', () => {
  assert.equal(langName('zh'), 'Chinese (Simplified)');
  assert.equal(langName('es'), 'Spanish');
  assert.equal(langName('unknown'), 'English');
});

test('studio translation extracts structured model text without accepting malformed JSON', () => {
  assert.deepEqual(extractJSON<{ names: string[] }>('result: {"names":["Acme"]}'), { names: ['Acme'] });
  assert.equal(extractJSON('no result'), null);
  assert.equal(extractJSON('{broken}'), null);
});
