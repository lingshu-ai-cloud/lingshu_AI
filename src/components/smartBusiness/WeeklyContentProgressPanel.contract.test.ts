import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const panel = readFileSync(new URL('./WeeklyContentProgressPanel.tsx', import.meta.url), 'utf8');
const calendar = readFileSync(new URL('../ui/LsCalendar.tsx', import.meta.url), 'utf8');

test('calendar content progress uses shared accessible drawer and truthful per-content stages', () => {
  assert.match(calendar, /<Drawer title=\{detailsTitle\}[^]*destroyOnHidden/);
  assert.match(panel, /aria-label="内容制作进度"/);
  assert.match(panel, /buildWeeklyContentProgress\(data, contentId/);
  assert.match(panel, /<Steps orientation="vertical"/);
  assert.match(panel, /stage\.statusLabel/);
  assert.doesNotMatch(panel, /Math\.random|percent=|approveGoal|retryTask|controlExecutionJob|saveProject/);
});

test('drawer polls only while mounted and visible, rejects stale auth, and exposes failures', () => {
  assert.match(panel, /document\.visibilityState !== 'visible'/);
  assert.match(panel, /authorization !== authHeader\(\)\.Authorization/);
  assert.match(panel, /next\.filter\(project => projectIds\.has\(project\.id\)\)/);
  assert.match(panel, /window\.clearInterval\(timer\)/);
  assert.match(panel, /disposed = true/);
  assert.match(panel, /暂未取得最新制作回执/);
  assert.match(panel, /正式发布前仍需验收与发布授权/);
});
