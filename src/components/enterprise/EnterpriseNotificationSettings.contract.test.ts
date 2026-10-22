import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../EnterprisePage.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('./EnterpriseNotificationSettings.tsx', import.meta.url), 'utf8');

test('enterprise page delegates notification edits while retaining profile persistence', () => {
  assert.match(page, /<EnterpriseNotificationSettings[\s\S]*?notifications=\{profile\.notifications \?\? DEFAULT\.notifications!\}/);
  assert.match(page, /onChange=\{update => setProfile\(prev => \(\{[\s\S]*?notifications: update\(prev\.notifications \?\? DEFAULT\.notifications!\)/);
  assert.doesNotMatch(page, /const (?:testReceiver|addReceiver|setNightModeEnabled) =/);
});

test('notification testing and night-mode consent remain in the notification boundary', () => {
  assert.match(settings, /if \(!receiver\.target\.trim\(\)\)/);
  assert.match(settings, /fetch\('\/api\/overseas\/enterprise\/notifications\/test'/);
  assert.match(settings, /\.\.\.authHeader\(\)/);
  assert.match(settings, /onChange\(current => result\.notifications \?\? \{ \.\.\.current, lastTestAt:/);
  assert.match(settings, /if \(enabled && !notifications\.nightMode\?\.enabled\)[\s\S]*?window\.confirm/);
  assert.match(settings, /if \(!ok\) return;[\s\S]*?onChange\(current => \(\{ \.\.\.current, nightMode: \{ enabled, autoCategories: 'approved' \}/);
  assert.match(settings, /notifications\.receivers\.length >= 1 && notifications\.lastTestAt/);
});
