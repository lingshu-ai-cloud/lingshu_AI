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

test('review and matrix generation entries open the same global queue before any explicit Studio action', () => {
  const workspace = readFileSync(new URL('../ConfiguredDigitalEmployeeWorkspace.tsx', import.meta.url), 'utf8');
  const review = readFileSync(new URL('./BusinessDataReview.tsx', import.meta.url), 'utf8');
  const matrix = readFileSync(new URL('./MatrixPublicationSchedule.tsx', import.meta.url), 'utf8');
  const start = workspace.indexOf('const openProductionProgress =');
  const end = workspace.indexOf('// Only explicit action failures', start);
  const queueEntry = workspace.slice(start, end);
  assert.match(queueEntry, /openContentGenerationQueue\(\{view:'tasks',taskId:item\?\.socialContentTaskId\|\|undefined,contentId:item\?\.contentId\|\|contentItemId\|\|undefined\}\)/);
  assert.doesNotMatch(queueEntry, /setWorkspaceView|setSelectedContentItemId|setWeeklyStudioContentId/);
  assert.match(review, /aria-label="查看内容生成任务"[\s\S]{0,160}>查看生成任务<\/Button>/);
  assert.match(matrix, /openProduction \? '查看生成任务 →'/);
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
