import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const scripts = packageJson.scripts;

test('quality runs one production runtime gate with process, queue, and media coverage', () => {
  assert.match(scripts.quality, /pnpm run test:production-runtime-gate/);
  assert.doesNotMatch(scripts.quality, /pnpm run test:process-role/);
  assert.match(scripts['test:production-runtime-gate'], /pnpm run test:process-role/);
  assert.match(scripts['test:production-runtime-gate'], /server\/queues\/bullmq\.test\.ts/);
  assert.match(scripts['test:production-runtime-gate'], /pnpm run test:langgraph:local-production/);
});

test('the heavy local production test has one formal gate owner', () => {
  assert.doesNotMatch(scripts['test:assistant-production'], /langgraphLocalProduction\.test\.ts/);
  assert.doesNotMatch(scripts['test:langgraph'], /langgraphLocalProduction\.test\.ts/);
  assert.match(scripts['test:langgraph:local-production'], /scripts\/langgraphLocalProduction\.test\.ts/);
});
