import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./refresh-beauty-short-benchmarks.ts', import.meta.url), 'utf8');

test('maintenance exact analysis keeps a durable activity heartbeat while the provider runs', () => {
  assert.match(source, /const ANALYSIS_HEARTBEAT_MS\s*=\s*30_000/);
  assert.match(source, /maintenanceHeartbeatAt:\s*analysisStartedAt/);
  assert.match(source, /latestAnalysis\.analysisRunId !== analysisRunId/);
  assert.match(source, /latestAnalysis\.analysisQueueKind !== 'maintenance_exact'/);
  assert.match(source, /latestAnalysis\.analysisQueueState !== 'running'/);
  assert.match(source, /maintenanceHeartbeatAt:\s*heartbeatAt/);
  assert.doesNotMatch(source, /aiAnalysis:\s*JSON\.stringify\(\{ \.\.\.latestAnalysis, analysisHeartbeatAt:/,
    'a heartbeat must not race analysis state by replacing the whole aiAnalysis blob');
  assert.match(source, /clearInterval\(heartbeat\)/);
  assert.match(source, /await heartbeatWrite/);
});
