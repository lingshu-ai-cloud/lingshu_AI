import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const connected = readFileSync(new URL('./ConnectedAgentCalendar.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('./DigitalEmployeeWorkspace.tsx', import.meta.url), 'utf8');

test('digital employee calendar hard-scopes every task source to the current run', () => {
  assert.match(workspace, /data\.tasks\.filter\(task => task\.run_id === currentRunId\)/);
  assert.match(workspace, /runTaskIds\.has\(item\.taskId\)/);
  assert.match(workspace, /<ConnectedAgentCalendar[^>]*currentRunId=\{currentRunId\}/);
  assert.match(connected, /item\.productionProgress\?\.runId\|\|String\(item\.inputSnapshot\.workflowRunId\|\|item\.inputSnapshot\.runId\|\|''\)/);
  assert.match(connected, /\(!currentRunId\|\|taskRunId===currentRunId\)/);
  assert.match(connected, /\(!currentRunId\|\|task\.runId===currentRunId\)/);
});
