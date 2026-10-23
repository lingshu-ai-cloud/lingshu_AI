import assert from 'node:assert/strict';
import test from 'node:test';
import { initialOperatingPlanFingerprint, type InitialOperatingPlan } from '../lib/initialOperatingPlan';
import { digitalEmployeeApi, type DigitalEmployeeOverview } from '../lib/digitalEmployees';
import { EMPTY_CONFIG } from './smartBusiness/digitalEmployeeConfigRules';
import { createDigitalEmployeeConfigurationAction } from './digitalEmployeeConfigurationAction';

const plan: InitialOperatingPlan = {
  stage: 'b2b_launch',
  products: ['玻璃瓶'],
  market: '美国',
  language: '英语',
  platforms: ['youtube'],
  count: 2,
  budgetCapCny: 100,
  deliveryDate: '2026-11-01',
};

function setup(goalConstraints: string[], hasPreparation: boolean) {
  const calls: string[] = [];
  const errors: string[] = [];
  const data: DigitalEmployeeOverview[] = [];
  const version = { current: 0 };
  const goal = { id: 'goal-1', version: 1, constraints: goalConstraints };
  const next = { config: EMPTY_CONFIG, goal } as DigitalEmployeeOverview;
  const api = {
    completeOnboarding: async () => { calls.push('complete'); return next; },
    initialPreparation: async () => { calls.push('preparation'); return { preparation: hasPreparation ? {} : null }; },
    overview: async () => { calls.push('overview'); return next; },
    createGoal: async () => { calls.push('create'); throw new Error('must not create another goal'); },
    savePackage: async () => { calls.push('save'); throw new Error('must not save another package'); },
    startInitialPreparation: async () => { calls.push('start'); throw new Error('must not start another preparation'); },
  } as unknown as typeof digitalEmployeeApi;
  const saveConfig = createDigitalEmployeeConfigurationAction({
    data: null,
    activeRun: false,
    overviewRequestVersionRef: version,
    setBusy: () => undefined,
    setError: (value) => errors.push(value),
    setData: (value) => data.push(value),
    setWorkspaceView: () => undefined,
    setNewGoal: () => undefined,
    setWeeklyPlanOpen: () => undefined,
    setOnboardingWelcomeOpen: () => undefined,
    recoverEnterpriseFactsChanged: async () => false,
    api,
  });
  return { saveConfig, calls, errors, data, version };
}

test('a matching first plan resumes its existing preparation without a second paid workflow', async () => {
  const fingerprint = initialOperatingPlanFingerprint(plan);
  const run = setup([`首次计划校验：${fingerprint}`], true);
  assert.equal(await run.saveConfig({ ...EMPTY_CONFIG, initialPlan: plan }), true);
  assert.deepEqual(run.calls, ['complete', 'preparation', 'overview']);
  assert.equal(run.data.length, 1);
  assert.equal(run.version.current, 2);
  assert.deepEqual(run.errors, ['']);
});

test('a changed first plan does not overwrite an already persisted plan', async () => {
  const run = setup(['首次计划校验：another-version'], false);
  assert.equal(await run.saveConfig({ ...EMPTY_CONFIG, initialPlan: plan }), false);
  assert.deepEqual(run.calls, ['complete']);
  assert.equal(run.data.length, 0);
  assert.match(run.errors.at(-1) || '', /已存在另一版首次计划/);
});
