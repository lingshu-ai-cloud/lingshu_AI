import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const scheduledSource = readFileSync(new URL('./ScheduledPage.tsx', import.meta.url), 'utf8');
const digitalEmployeeSource = readFileSync(new URL('./DigitalEmployeePage.tsx', import.meta.url), 'utf8');
const noticeSource = readFileSync(new URL('./DiscoveryTaskFailureNotice.tsx', import.meta.url), 'utf8');

test('scheduled discovery result shows diagnosis and preserves provider evidence', () => {
  assert.match(scheduledSource, /const resultDiagnosis = isDirectorTask \? discoveryFailurePresentation\(result \|\| task\.lastResult\) : null/);
  assert.match(scheduledSource, /resultDiagnosis\.label/);
  assert.match(scheduledSource, /\{result \|\| task\.lastResult\}/);
});

test('blocked discovery task shows diagnosis and preserves blocked reason', () => {
  assert.match(digitalEmployeeSource, /<DiscoveryTaskFailureNotice task=\{selectedTask\}/);
  assert.match(noticeSource, /task\.task_key !== 'scheduled_source_collection'/);
  assert.match(noticeSource, /discoveryFailurePresentation\(reason\)/);
  assert.match(noticeSource, /diagnosis\?\.label/);
  assert.match(noticeSource, /原始原因：\{reason\}/);
});
