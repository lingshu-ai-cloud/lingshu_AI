import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const entry = readFileSync(new URL('./WeeklyProductionStudioEntry.tsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../SmartBusinessDashboard.tsx', import.meta.url), 'utf8');

test('weekly progress opens verified Studio directly and old links redirect instead of rendering a detail page', () => {
  assert.equal(existsSync(new URL('./WeeklyProductionDetail.tsx', import.meta.url)), false);
  assert.doesNotMatch(dashboard, /WeeklyProductionDetail/);
  assert.match(dashboard, /onOpenWorkbench=\{closeDetails\}/);
  assert.match(dashboard, /if \(item.origin === "weekly_plan"\)[^]*<WeeklyProductionStudioEntry[^>]*autoOpen onOpened=\{onBack\} onUnavailable=\{onBack\}/);
  assert.match(entry, /if \(autoOpen\) void openStudio\(\)/);
  assert.match(entry, /aria-label="进入内容制作"/);
  assert.match(entry, />进入内容制作<\/Button>/);
  assert.doesNotMatch(entry, /查看完整制作进度/);
  assert.doesNotMatch(entry, /item\.progress|item\.steps|estimatedMinutes|TaskPreviewCards|ProductionTaskScene|本条内容的真实制作详情/);
});

test('review and matrix weekly entries preserve their source view and clear navigation before entering Studio', () => {
  const page = readFileSync(new URL('../DigitalEmployeePage.tsx', import.meta.url), 'utf8');
  const review = readFileSync(new URL('./BusinessDataReview.tsx', import.meta.url), 'utf8');
  const matrix = readFileSync(new URL('./MatrixPublicationSchedule.tsx', import.meta.url), 'utf8');
  const start = page.indexOf('const openProductionProgress =');
  const end = page.indexOf('if (taskId) setSelectedTaskId', start);
  const weeklyEntry = page.slice(start, end);
  assert.match(weeklyEntry, /items.length === 1 && items\[0\]!\.origin === "weekly_plan"/);
  assert.match(weeklyEntry, /setWeeklyStudioContentId\(items\[0\]!\.contentId\);\s*return;/);
  assert.doesNotMatch(weeklyEntry, /setWorkspaceView|setSelectedContentItemId/);
  assert.match(page, /contentId=\{weeklyStudioContentId\} autoOpen onOpened=\{\(\) => setWeeklyStudioContentId\(""\)\}/);
  assert.match(review, /row.origin === 'weekly_plan' \? '进入内容制作' : '查看'/);
  assert.match(matrix, /openProduction \? '进入内容制作 →'/);
});

test('workbench entry uses fresh scoped reads, rejects stale auth and lets users choose multiple real versions', () => {
  assert.match(entry, /readWeeklyContentProgressSnapshot/);
  assert.match(entry, /headers\.Authorization !== authHeader\(\)\.Authorization/);
  assert.match(entry, /weeklyProductionStudioLinks\(snapshot.data, contentId, snapshot.projects\)/);
  assert.match(entry, /dispatchDigitalEmployeeDeepLink\(choice.link\)/);
  assert.match(entry, /if \(links.length === 1\) navigate/);
  assert.match(entry, /links.length > 1/);
  assert.match(entry, /choicesAuthorization.current !== authHeader\(\)\.Authorization/);
  assert.match(entry, /暂无|尚无可核验/);
  assert.doesNotMatch(entry, /approveGoal|retryTask|saveProject|reconcile|method: 'POST'|business_refs/);
});

test('content switch cancels the old request and resets navigation state', () => {
  assert.match(entry, /useEffect\(\(\) => \{\s*request.current\?\.abort\(\); request.current = null;\s*setOpening\(false\); setError\(''\); setChoices\(\[\]\);/);
  assert.match(entry, /request.current === controller/);
  assert.match(entry, /\}, \[contentId, data.goal\?\.id, data.plan\?\.id, data.run\?\.id, autoOpen\]\)/);
});
