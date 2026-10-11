import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const panel = readFileSync(new URL('./WeeklyContentProgressPanel.tsx', import.meta.url), 'utf8');
const calendar = readFileSync(new URL('../ui/LsCalendar.tsx', import.meta.url), 'utf8');

test('calendar content progress uses shared accessible drawer and truthful per-content stages', () => {
  assert.match(calendar, /<Drawer title=\{detailsTitle\}[^]*destroyOnHidden/);
  assert.match(panel, /aria-label="内容制作进度"/);
  assert.match(panel, /buildWeeklyContentProgress\(currentData, contentId/);
  assert.match(panel, /<WeeklyProductionTimeline stages=\{progress.stages\}/);
  assert.doesNotMatch(panel, /<Steps/);
  assert.doesNotMatch(panel, /Math\.random|percent=|approveGoal|retryTask|controlExecutionJob|saveProject/);
});

test('calendar goes straight to verified Studio and retains its benchmark reference action', () => {
  assert.match(panel, /<WeeklyProductionStudioEntry data=\{currentData\} contentId=\{contentId\} onOpened=\{onOpenWorkbench\}/);
  assert.doesNotMatch(panel, /onOpenProduction|WeeklyProductionDetail/);
  assert.match(panel, /onClick=\{onOpenReference\}>查看爆款参考/);
});

test('drawer polls only while mounted and visible, rejects stale auth, and exposes failures', () => {
  assert.match(panel, /document\.visibilityState !== 'visible'/);
  assert.match(panel, /authorization !== authHeader\(\)\.Authorization/);
  assert.match(panel, /readWeeklyContentProgressSnapshot\(\{ data: requestedParent/);
  assert.match(panel, /requestedParent !== parentData\.current/);
  assert.match(panel, /snapshot\?\.scope === scope/);
  assert.match(panel, /data\.plan\?\.id/);
  assert.doesNotMatch(panel, /if \(!projectIds\.size\)/);
  assert.match(panel, /window\.clearInterval\(timer\)/);
  assert.match(panel, /disposed = true/);
  assert.match(panel, /controller\.abort\(\)/);
  assert.match(panel, /AUTH_TOKEN_CHANGED_EVENT/);
  assert.match(panel, /暂未取得最新制作回执/);
  assert.match(panel, /正式发布前仍需验收与发布授权/);
});

test('shot receipts remain distinct from assembled output and use shared disclosure', () => {
  assert.match(panel, /<Collapse size="small"/);
  assert.match(panel, /aria-label="逐镜制作回执"/);
  for (const field of ['shot.qualityLabel', 'shot.providerTaskId', 'shot.videoMaterialId', 'shot.adoptedMaterialId']) assert.ok(panel.includes(field));
  assert.match(panel, /timeZone: 'Asia\/Shanghai'/);
});
