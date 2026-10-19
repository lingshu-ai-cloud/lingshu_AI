import test from 'node:test';
import assert from 'node:assert/strict';
import { planWeeklyQualifiedCandidateContinuation, weeklyQualifiedSourceKey, type WeeklyQualifiedContinuationInput } from './weeklyQualifiedCandidateContinuation.js';

const first = { mode: 'momentum', platform: 'tiktok', queryRef: 'foam', limit: 2 };
const second = { mode: 'momentum', platform: 'facebook', queryRef: 'foam factory', limit: 3 };
const third = { mode: 'momentum', platform: 'youtube', queryRef: 'foam supplier', limit: 1 };
const accepted = (id: string) => ({ candidateId: id, evidenceRef: `${id}@1`, exactHandoffRef: `${id}:exact@1`, accountId: `account:${id}`, postAdmission: 'accepted' as const });
const seed = (): WeeklyQualifiedContinuationInput => ({
  parentRunId: 'run-1', parentRunHash: 'frozen-hash',
  attempts: [{ runId: 'run-1', status: 'partial', finishedAt: '2026-10-18T00:00:00.000Z', sourceKeys: [weeklyQualifiedSourceKey(first)] }],
  candidates: [accepted('one')], sources: [first, second, third], reservedSourceKeys: [weeklyQualifiedSourceKey(first)],
  remainingAuthorizedCapacity: 4, now: '2026-10-18T00:01:00.000Z', minimumIntervalMs: 60_000,
});

test('five distinct current-week fully admitted references meet target; repeated candidate cannot count twice', () => {
  const input = seed(); input.candidates = ['one', 'two', 'three', 'four', 'five'].map(accepted);
  input.candidates.push(accepted('five'));
  const plan = planWeeklyQualifiedCandidateContinuation(input);
  assert.equal(plan.qualifiedCount, 5);
  assert.equal(plan.code, 'weekly_qualified_target_met');
  assert.equal(plan.ready, false);
});

test('unfinished post-analysis admission stops new paid attempt, and accepted requires exact evidence and account', () => {
  const input = seed(); input.candidates.push({ ...accepted('two'), postAdmission: 'pending' });
  assert.equal(planWeeklyQualifiedCandidateContinuation(input).code, 'weekly_qualified_post_admission_pending');
  input.candidates[1] = { ...accepted('two'), exactHandoffRef: null };
  assert.throws(() => planWeeklyQualifiedCandidateContinuation(input), /evidence_incomplete/);
});

test('zero ledger capacity and ten attempts never grant additional collection quota', () => {
  const input = seed(); input.remainingAuthorizedCapacity = 0;
  const noQuota = planWeeklyQualifiedCandidateContinuation(input);
  assert.equal(noQuota.code, 'weekly_qualified_quota_exhausted');
  assert.equal(noQuota.grantsAdditionalDailyQuota, false);
  input.remainingAuthorizedCapacity = 5;
  input.attempts = Array.from({ length: 10 }, (_, i) => ({ runId: i ? `run-${i + 1}` : 'run-1', status: 'stopped' as const,
    finishedAt: '2026-10-18T00:00:00.000Z', sourceKeys: i ? [] : [weeklyQualifiedSourceKey(first)] }));
  assert.equal(planWeeklyQualifiedCandidateContinuation(input).code, 'weekly_qualified_attempts_exhausted');
});

test('already submitted sources are excluded, including unknown and ledger-only reservations', () => {
  const input = seed(); input.reservedSourceKeys.push(weeklyQualifiedSourceKey(second));
  const plan = planWeeklyQualifiedCandidateContinuation(input);
  assert.equal(plan.code, 'weekly_qualified_continuation_ready');
  assert.deepEqual(plan.source, third);
  assert.equal(plan.authorizesExecution, false);
  input.reservedSourceKeys.push(weeklyQualifiedSourceKey(third));
  assert.equal(planWeeklyQualifiedCandidateContinuation(input).code, 'weekly_qualified_sources_exhausted');
});

test('interval and unsettled parent forbid submission; restart repeats the same pure plan', () => {
  const input = seed(); input.now = '2026-10-18T00:00:59.999Z';
  const pending = planWeeklyQualifiedCandidateContinuation(input);
  assert.equal(pending.code, 'weekly_qualified_interval_pending');
  assert.equal(pending.notBefore, '2026-10-18T00:01:00.000Z');
  input.now = '2026-10-18T00:01:00.000Z';
  const before = planWeeklyQualifiedCandidateContinuation(input);
  const afterRestart = planWeeklyQualifiedCandidateContinuation(structuredClone(input));
  assert.deepEqual(afterRestart, before);
  input.attempts.push({ runId: 'run-2', status: 'unknown', finishedAt: null, sourceKeys: [weeklyQualifiedSourceKey(second)] });
  assert.equal(planWeeklyQualifiedCandidateContinuation(input).code, 'weekly_qualified_prior_attempt_unsettled');
});

test('source limit is clamped by verified shortfall and remaining authorized capacity, not attempt budget', () => {
  const input = seed(); input.remainingAuthorizedCapacity = 1;
  const plan = planWeeklyQualifiedCandidateContinuation(input);
  assert.equal(plan.source?.limit, 1);
  assert.equal(plan.attemptCount, 1);
  assert.equal(plan.remainingAuthorizedCapacity, 1);
});

test('only the frozen TikTok account target may repeat a source under fresh attempts and normal daily quota', () => {
  const account = { mode: 'account', platform: 'tiktok', queryRef: 'https://www.tiktok.com/@factory', limit: 5 };
  const input = seed();
  input.sources = [account];
  input.repeatableSourceKey = weeklyQualifiedSourceKey(account);
  input.attempts[0]!.sourceKeys = [input.repeatableSourceKey];
  input.reservedSourceKeys = [input.repeatableSourceKey];
  input.minimumIntervalMs = 300_000;
  input.now = '2026-10-18T00:05:00.000Z';
  assert.equal(planWeeklyQualifiedCandidateContinuation(input).source?.limit, 4,'five-video target shrinks to verified gap');
  input.remainingAuthorizedCapacity = 2;
  assert.equal(planWeeklyQualifiedCandidateContinuation(input).source?.limit, 2,'daily quota remains the hard ceiling');
  input.remainingAuthorizedCapacity = 0;
  assert.equal(planWeeklyQualifiedCandidateContinuation(input).code,'weekly_qualified_quota_exhausted');
  input.remainingAuthorizedCapacity = 5;
  input.attempts = Array.from({length:10},(_,i)=>({runId:`run-${i+1}`,status:'partial' as const,finishedAt:'2026-10-18T00:00:00.000Z',sourceKeys:[input.repeatableSourceKey!]}));
  assert.equal(planWeeklyQualifiedCandidateContinuation(input).code,'weekly_qualified_attempts_exhausted');
  input.sources=[first];
  assert.throws(()=>planWeeklyQualifiedCandidateContinuation(input),/input_invalid/,'a keyword cannot be designated repeatable');
});
