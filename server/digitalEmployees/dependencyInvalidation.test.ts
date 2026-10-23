import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { mustInvalidateContentDownstream } from './dependencyInvalidation.js';

test('terminal and active content descendants are invalidated when an upstream proof is downgraded', () => {
  for (const key of ['viral_analysis', 'content_mode_routing', 'content_production', 'content_quality_gate', 'content_release_approval', 'publishing_calendar', 'weekly_review']) {
    for (const status of ['succeeded', 'skipped', 'running', 'waiting_external', 'waiting_approval']) {
      assert.equal(mustInvalidateContentDownstream(key, status, false), true, `${key}:${status}`);
    }
  }
});

test('pending, handed-off, cancelled and dependency-ready tasks are preserved', () => {
  assert.equal(mustInvalidateContentDownstream('content_production', 'pending', false), false);
  assert.equal(mustInvalidateContentDownstream('content_production', 'handed_off', false), false);
  assert.equal(mustInvalidateContentDownstream('content_production', 'cancelled', false), false);
  assert.equal(mustInvalidateContentDownstream('content_production', 'succeeded', true), false);
  assert.equal(mustInvalidateContentDownstream('customer_segmentation', 'succeeded', false), false);
});

test('runtime applies invalidation before terminal-task early return and cancels durable production jobs', () => {
  const source = fs.readFileSync(new URL('../routes/digitalEmployees.ts', import.meta.url), 'utf8')
    + fs.readFileSync(new URL('./taskInterventionApplication.ts', import.meta.url), 'utf8');
  const invalidation = source.indexOf('mustInvalidateContentDownstream(task.task_key');
  const terminalReturn = source.indexOf("['succeeded', 'skipped', 'cancelled', 'handed_off'].includes(task.status)", invalidation);
  assert.ok(invalidation >= 0 && terminalReturn > invalidation);
  const supersession = fs.readFileSync(new URL('./taskCorrectionSupersession.ts', import.meta.url), 'utf8');
  assert.match(supersession, /content_execution_jobs[\s\S]*?action: 'cancel'/);
  assert.match(source, /viral_analysis_exact_coverage_required/);
  assert.match(source, /task\.task_key === 'viral_analysis'[\s\S]*?\['skip', 'manual_complete'\]/);
});
