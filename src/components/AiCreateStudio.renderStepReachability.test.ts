import { readAiStudioApplicationSources } from '../../tests/fixtures/aiStudioApplicationSources.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readAiStudioApplicationSources();

test('legacy step renderer contains only steps reachable from its sole call site', () => {
  const start = source.indexOf('const renderStep = () => {');
  const end = source.indexOf('const socialViralTask =', start);
  assert.ok(start > 0 && end > start);
  const renderer = source.slice(start, end);
  assert.deepEqual([...renderer.matchAll(/^\s*case '([^']+)'/gm)].map(match => match[1]), ['mode', 'poster']);
  assert.equal([...source.matchAll(/renderStep\(\)/g)].length, 1);
  assert.match(source, /step !== 'script' && step !== 'material' && step !== 'bgm' && step !== 'cover' && step !== 'preview' && \([\s\S]{0,250}renderStep\(\)/);
  for (const step of ['script', 'material', 'cover', 'preview']) {
    assert.match(source.slice(end), new RegExp("step === '" + step + "'"), step + ' must still be handled by the live workbench');
  }
});
