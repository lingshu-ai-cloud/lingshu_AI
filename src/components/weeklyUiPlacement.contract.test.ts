import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('weekly task button opens the existing business swimlanes in a modal', () => {
  const workspace = source('./ConfiguredDigitalEmployeeWorkspace.tsx');
  assert.match(workspace, /onClick=\{\(\) => setWeeklyLaneOpen\(true\)\}[\s\S]*?>查看周任务<\/Button>/);
  assert.match(workspace, /<Modal open=\{weeklyLaneOpen\} title="本周任务"[\s\S]*?<DigitalEmployeeHomeWork data=\{data\}/);
  assert.doesNotMatch(workspace, /setWorkspaceView\(workspaceView === 'matrix'/);
});

test('weekly work shows swimlanes only, while content creation owns the media calendar', () => {
  const work = source('./DigitalEmployeeHomeWork.tsx');
  const content = source('./socialContent/CreationTaskWorkspace.tsx');
  assert.match(work, /weekly && <WeeklyBusinessSwimlane/);
  assert.doesNotMatch(work, /周任务视图|weeklyView|publishingCalendar/);
  assert.match(content, /data\.goal \? <WeeklyPublishingCalendar data=\{data\}[^\n]*additionalEvents=\{standaloneEvents\}/);
  assert.match(source('./SmartBusinessDashboard.tsx'), /<LsCalendar events=\{allEvents\}[^\n]*initialView="dayGridWeek"[^\n]*eventCardMode="media"/);
});

test('overview omits routine production-preflight explanation', () => {
  const workspace = source('./ConfiguredDigitalEmployeeWorkspace.tsx');
  assert.doesNotMatch(workspace, /确认周计划后会逐项核验参考和制作资料/);
});
