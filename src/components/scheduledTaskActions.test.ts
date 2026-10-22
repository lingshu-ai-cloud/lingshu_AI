import assert from 'node:assert/strict';
import { suggestedActions } from './scheduledTaskActions.js';

for (const taskType of [
  'holiday_push', 'trend_report', 'video_keyword_crawl', 'exchange_rate',
  'market_intelligence', 'weekly_review', 'crm_wakeup',
]) {
  const actions = suggestedActions({ taskType }, '已核验摘要');
  assert.equal(actions.length, 3, `${taskType} should retain three follow-up choices`);
  assert.ok(actions.every(action => action.prompt.endsWith('\n\n定时任务摘要：\n已核验摘要')));
  assert.ok(actions.every(action => action.label && action.agent && action.agentLabel));
}

const fallback = suggestedActions({ taskType: 'unrecognized_task' }, '');
assert.equal(fallback.length, 1);
assert.equal(fallback[0].agent, 'strategy');
assert.doesNotMatch(fallback[0].prompt, /定时任务摘要/);

console.log('scheduled task follow-up actions passed');
