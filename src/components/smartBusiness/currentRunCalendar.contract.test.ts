import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const connected = readFileSync(new URL('./ConnectedAgentCalendar.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('./DigitalEmployeeWorkspace.tsx', import.meta.url), 'utf8');

test('digital employee calendar keeps workspace tasks on the run and weekly execution on the selected package version', () => {
  assert.match(workspace, /data\.tasks\.filter\(task => task\.run_id === currentRunId\)/);
  assert.match(workspace, /runTaskIds\.has\(item\.taskId\)/);
  assert.match(workspace, /<ConnectedAgentCalendar[^>]*currentRunId=\{currentRunId\}/);
  assert.match(connected, /item\.programId===pkg\?\.programId&&item\.packageId===pkg\?\.packageId&&item\.packageVersion===pkg\?\.version/);
  assert.doesNotMatch(connected, /taskRunId===currentRunId/, 'legacy run identity must not hide package-version execution tasks');
  assert.match(connected, /\(!currentRunId\|\|task\.runId===currentRunId\)/);
});
