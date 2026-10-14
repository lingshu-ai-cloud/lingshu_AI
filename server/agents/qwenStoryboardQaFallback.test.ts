import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { storyboardQaProviderFallbackEligible } from './qwen.js';

test('storyboard QA only fails over for explicit pre-inference account rejection with a configured fallback', () => {
  const configured = { GEMINI_API_KEY: 'configured-for-test' } as NodeJS.ProcessEnv;
  assert.equal(storyboardQaProviderFallbackEligible(Object.assign(new Error('account is not in good standing; overdue-payment'), { code: 'Arrearage' }), configured), true);
  assert.equal(storyboardQaProviderFallbackEligible(Object.assign(new Error('invalid credential'), { code: 'InvalidApiKey' }), configured), true);
  assert.equal(storyboardQaProviderFallbackEligible(new Error('request timed out after provider admission'), configured), false);
  assert.equal(storyboardQaProviderFallbackEligible(Object.assign(new Error('overdue-payment'), { code: 'Arrearage' }), {}), false);
});

test('Gemini fallback is constrained to the same auditable observation contract', () => {
  const source = readFileSync(new URL('./qwen.ts', import.meta.url), 'utf8');
  assert.match(source, /responseJsonSchema[\s\S]{0,800}required: \['key', 'verdict', 'evidenceFrames', 'note', 'action'\]/);
  assert.match(source, /verdict: \{ type: 'string', enum: \['pass', 'fail', 'uncertain'\] \}/);
  assert.match(source, /maxOutputTokens: 4096/);
});
