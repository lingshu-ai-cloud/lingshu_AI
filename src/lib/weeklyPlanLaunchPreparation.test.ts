import assert from 'node:assert/strict';
import test from 'node:test';
import type { DigitalEmployeeOverview } from './digitalEmployees';
import { prepareWeeklyPlanForLaunch } from './weeklyPlanLaunchPreparation';

const draft = { goal: { id: 'goal-a' }, plan: { businessPackage: { revision: 1,
  tasks: [{ templateId: 'production', videoPlans: [{ productionRole: 'master' }] }] } } } as unknown as DigitalEmployeeOverview;
const withStatus = (status: string) => ({ ...draft, plan: { businessPackage: { ...draft.plan!.businessPackage!,
  revision: 1, detailGeneration: { status, blockers: ['缺少素材'] } } } }) as unknown as DigitalEmployeeOverview;

test('one confirmation waits for a background preparation and never submits preparation twice', async () => {
  let prepareCalls = 0; let reads = 0; let time = 0;
  const observed: string[] = [];
  const result = await prepareWeeklyPlanForLaunch(draft, {
    api: { generatePackageDetails: async () => { prepareCalls++; return withStatus('generating'); },
      overview: async () => { reads++; return withStatus(reads === 1 ? 'generating' : 'ready'); } },
    wait: async ms => { time += ms; }, now: () => time,
    onObserved: value => observed.push(value.plan!.businessPackage!.detailGeneration!.status),
  });
  assert.equal(result.plan!.businessPackage!.revision, 1);
  assert.deepEqual(observed, ['generating', 'generating']);
  assert.equal(prepareCalls, 1);
  assert.equal(reads, 2);
});

test('a plan changed while preparing must be confirmed again, even if it is ready', async () => {
  const changed = withStatus('ready');
  changed.plan!.businessPackage!.revision = 2;
  await assert.rejects(prepareWeeklyPlanForLaunch(draft, {
    api: { generatePackageDetails: async () => withStatus('generating'), overview: async () => changed },
    wait: async () => {},
  }), /重新确认方案和预算/);
});

test('a background blocker or changed target never becomes a successful launch', async () => {
  let reads = 0;
  await assert.rejects(prepareWeeklyPlanForLaunch(draft, {
    api: { generatePackageDetails: async () => withStatus('generating'),
      overview: async () => { reads++; return withStatus('blocked'); } },
    wait: async () => {},
  }), /缺少素材/);
  assert.equal(reads, 1);
  await assert.rejects(prepareWeeklyPlanForLaunch(draft, {
    api: { generatePackageDetails: async () => ({ ...withStatus('ready'), goal: { id: 'other' } } as unknown as DigitalEmployeeOverview),
      overview: async () => withStatus('ready') },
  }), /当前周目标不一致/);
});

test('a preparation that remains running reaches a bounded wait without resubmitting', async () => {
  let time = 0; let prepares = 0; let reads = 0;
  await assert.rejects(prepareWeeklyPlanForLaunch(draft, {
    api: { generatePackageDetails: async () => { prepares++; return withStatus('generating'); },
      overview: async () => { reads++; return withStatus('generating'); } },
    wait: async ms => { time += ms; }, now: () => time, maxWaitMs: 4_000,
  }), /不会重复提交准备请求/);
  assert.equal(prepares, 1);
  assert.equal(reads, 2);
});

test('an existing-library plan with unbound clone references stops before detail generation', async () => {
  let calls = 0;
  const unbound = { ...draft, plan: { businessPackage: { ...draft.plan!.businessPackage!,
    referenceSourcePolicy: 'existing_library_only', tasks: [{ templateId: 'production', videoPlans: [
      { productionRole: 'master', route: 'clone', referenceId: '' },
      { productionRole: 'master', route: 'clone', referenceId: '' },
    ] }] } } } as DigitalEmployeeOverview;
  await assert.rejects(prepareWeeklyPlanForLaunch(unbound, { api: {
    generatePackageDetails: async () => { calls++; return unbound; },
    overview: async () => { calls++; return unbound; },
  } }), /2 条复刻视频中有 2 条尚未绑定/);
  assert.equal(calls, 0);
});
