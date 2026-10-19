import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./WeeklyAccountCollectionIntervention.tsx', import.meta.url), 'utf8');
const taskCard = readFileSync(new URL('./WeeklyTaskQuickActions.tsx', import.meta.url), 'utf8');
const pinned = readFileSync(new URL('./WeeklyPinnedReferenceIntervention.tsx', import.meta.url), 'utf8');

test('five-from-account approval lives on the existing weekly task card and stays separate from crawling', () => {
  assert.match(taskCard, /<WeeklyAccountCollectionIntervention packageIdentity=/);
  assert.match(source, /social-discovery\/scope\/weekly-account-revision/);
  assert.match(source, /expectedScopeId: authority\.scopeId/);
  assert.match(source, /expectedScopeVersion: authority\.scopeVersion/);
  assert.match(source, /expectedScopeHash: authority\.scopeHash/);
  assert.match(source, /expectedProductFactBindingHash: authority\.productFactBindingHash/);
  assert.match(source, /targetCount: 5/);
  assert.match(source, /scope\.needsConfirmation/);
  assert.doesNotMatch(source, /\/crawl|executeApprovedDiscoveryRun/);
  assert.match(source, /周包修订与采集须按原任务恢复/);
});

test('pinned video is selected from current-run options on the same task card', () => {
  assert.match(taskCard, /<WeeklyPinnedReferenceIntervention scope=/);
  assert.match(pinned, /pinned-reference-options/);
  assert.match(pinned, /expectedPackageVersion: item\.packageVersion/);
  assert.match(pinned, /expectedPlanningVersion: item\.planningVersion/);
  assert.match(pinned, /discoveryAuthority: selected\.discoveryAuthority/);
  assert.match(pinned, /旧灵感库视频不会自动成为本轮参考/);
  assert.doesNotMatch(pinned, /trend_videos|localStorage/);
});
