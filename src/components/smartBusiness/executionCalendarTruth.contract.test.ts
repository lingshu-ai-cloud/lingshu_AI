import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('the live Agent calendar does not project an unstarted weekly goal as execution cards', () => {
  const source = fs.readFileSync('src/components/smartBusiness/DigitalEmployeeWorkspace.tsx', 'utf8');
  assert.doesNotMatch(source, /projectWeeklyGoalCalendar/);
  assert.doesNotMatch(source, /goalCalendar/);
  assert.match(source, /<ConnectedAgentCalendar/);
});
