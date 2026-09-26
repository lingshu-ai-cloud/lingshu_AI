import assert from 'node:assert/strict';
import fs from 'node:fs';
import { beijingDate, followupScheduleFromCadence, latestDueReviewSlot, reviewScheduleFromCadence, socialKeywordsFromCadence, socialScheduleFromCadence } from './runtimeSchedule.js';

const social = socialScheduleFromCadence('YouTube、TikTok、Instagram、Facebook；近 7 天；每天 09:00；每次最多 20 条；按链接与标题去重 30 天');
assert.equal(social.cronExpr, '0 9 * * *');
assert.deepEqual(social.platforms, ['youtube', 'tiktok', 'instagram', 'facebook']);
assert.equal(social.limit, 20);
assert.equal(social.dateWindowDays, 7);
assert.equal(social.dedupeWindowDays, 30);
assert.equal(socialKeywordsFromCadence('TikTok；公开行业关键词：nail drill、electric nail file；近 7 天', '旧产品'), 'nail drill、electric nail file');
assert.equal(socialKeywordsFromCadence('TikTok；近 7 天', '美甲打磨机'), '美甲打磨机');

const weekdaySocial = socialScheduleFromCadence('工作日 08:15，Instagram，每次最多 12 条，回看 3 天');
assert.equal(weekdaySocial.cronExpr, '15 8 * * *');
assert.deepEqual(weekdaySocial.platforms, ['instagram']);
assert.equal(weekdaySocial.limit, 12);

const review = reviewScheduleFromCadence('周五 17:30（北京时间）；数据截止 17:00');
assert.ok(review);
assert.equal(review?.weekday, 5);
assert.equal(latestDueReviewSlot(review!, new Date('2026-09-04T10:00:00.000Z')).toISOString(), '2026-09-04T09:30:00.000Z');
assert.equal(latestDueReviewSlot(review!, new Date('2026-09-04T09:00:00.000Z')).toISOString(), '2026-08-28T09:30:00.000Z');
assert.equal(beijingDate(new Date('2026-09-04T09:30:00.000Z')), '2026-09-04');
assert.equal(reviewScheduleFromCadence('月底有空时'), null, 'ambiguous schedules must not trigger automatic reviews');

const followup = followupScheduleFromCadence('每周五 09:00 生成分层跟进草稿；17:00 前审批；仅在客户当地工作日 09:00–18:00 发送；同一客户 7 天最多 1 次');
assert.equal(followup.draft.weekday, 5);
assert.equal(followup.draft.hour, 9);
assert.equal(followup.approvalDeadlineHour, 17);
assert.equal(followup.sendWindowStartHour, 9);
assert.equal(followup.sendWindowEndHour, 18);
assert.equal(followup.contactWindowDays, 7);
assert.equal(followup.maxContactsPerWindow, 1);

const runtime = fs.readFileSync('server/digitalEmployees/runtimeOrchestrator.ts', 'utf8');
assert.match(runtime, /DIGITAL_EMPLOYEE_RUNTIME_ENABLED/, 'runtime must expose an emergency switch');
assert.match(runtime, /cycleRunning/, 'overlapping worker ticks must be suppressed');
assert.match(runtime, /tenantRecord/, 'runtime lookups must verify tenant ownership');
assert.match(runtime, /try\s*\{[\s\S]*?for \(const run|for \(const run[\s\S]*?try\s*\{/, 'one broken run must not stop other tenants');

const routes = fs.readFileSync('server/routes/digitalEmployees.ts', 'utf8');
assert.match(routes, /review\.scheduled/, 'scheduled reviews need a persisted idempotency marker');
assert.match(routes, /scheduleSlot/, 'scheduled-review idempotency must be scoped to its due slot');

console.log('digital employee runtime schedule tests passed');
