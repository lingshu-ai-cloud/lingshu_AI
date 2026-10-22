import assert from 'node:assert/strict';
import { taskWorkspace } from './scheduledTaskWorkspaces.js';

const base = { cronLabel: '每天 09:00', enabled: true, config: {} };
for (const taskType of [
  'video_keyword_crawl', 'trend_report', 'holiday_push', 'exchange_rate',
  'market_intelligence', 'weekly_review', 'crm_wakeup',
]) {
  const workspace = taskWorkspace({ ...base, taskType });
  assert.notEqual(workspace.title, '任务工作台', `${taskType} must retain its dedicated workspace`);
  assert.equal(workspace.cards.length, 3);
  assert.equal(workspace.actions.length, 3);
}

const crawl = taskWorkspace({ ...base, taskType: 'video_keyword_crawl', config: { platforms: 'instagram', keywords: 'coffee', dateWindowDays: '14' } });
assert.deepEqual(crawl.cards.map(card => card.value), ['instagram', 'coffee', '14 天']);

const fallback = taskWorkspace({ ...base, taskType: 'other', enabled: false });
assert.equal(fallback.title, '任务工作台');
assert.equal(fallback.cards[2].value, '已停用');

console.log('scheduled task workspace metadata passed');
