import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const gate = pkg.scripts['test:weekly-golden-journey'];

test('weekly golden journey gate covers the formal scheduler, worker, task detail, delivery and LangGraph media path', () => {
  assert.equal(typeof gate, 'string');
  for (const required of [
    'weeklyExecutionPipeline.test.ts',
    'socialWeeklyExecutionRuntime.test.ts',
    'weeklyTaskWorkspaces.test.ts',
    'weeklyDeliveryNavigation.integration.test.ts',
    'weeklyDeliveryAcceptance.test.ts',
    'socialWeeklyDeliveryAcceptance.test.ts',
    'WeeklyTaskRuntimeDetails.test.tsx',
    'weeklyM1ContinuousProduction.integration.test.ts',
    'test:langgraph:local-production',
  ]) assert.match(gate, new RegExp(required.replaceAll('.', '\\.')));
  assert.match(pkg.scripts.quality, /test:weekly-golden-journey-contract/);
  assert.match(pkg.scripts.quality, /test:weekly-golden-journey/);
});
