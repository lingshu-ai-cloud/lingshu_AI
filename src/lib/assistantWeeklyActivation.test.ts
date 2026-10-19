import assert from 'node:assert/strict';
import test from 'node:test';
import { socialProgramApi } from './socialProgramApi';
import { activateAssistantWeeklyPackage } from './assistantWeeklyActivation';

test('explicit activation verifies scope and dispatched plan; publication authorization defaults off and requires opt-in', async () => {
  const original = { get: socialProgramApi.get, getOperatingPackage: socialProgramApi.getOperatingPackage, activateOperatingPackage: socialProgramApi.activateOperatingPackage };
  let token = 'session', status = 'draft', planning = 'dispatched', version = 3, calls = 0, publicationAllowed = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => token } });
  const pkg = () => ({ programId: 'program', packageId: 'week', version, status, agentPlanning: { status: planning, dispatch: { dispatchId: 'dispatch' }, userConfirmation: { confirmedBy: 'user' } } });
  socialProgramApi.get = async () => ({ programId: 'program', version: 7 } as never);
  socialProgramApi.getOperatingPackage = async () => pkg() as never;
  socialProgramApi.activateOperatingPackage = async (programId, packageId, input) => {
    calls++; assert.equal(programId, 'program'); assert.equal(packageId, 'week');
    assert.deepEqual(input, { expectedVersion: 3, expectedProgramVersion: 7, authorizePublishing: publicationAllowed });
    return { ...pkg(), status: 'active' } as never;
  };
  const target = { programId: 'program', packageId: 'week', packageVersion: 3 };
  try {
    const result = await activateAssistantWeeklyPackage(target, () => true);
    assert.equal(result.pkg.status, 'active'); assert.equal(calls, 1);
    publicationAllowed = true; await activateAssistantWeeklyPackage(target, () => true, true); assert.equal(calls, 2);
    status = 'active'; assert.equal((await activateAssistantWeeklyPackage(target, () => true)).alreadyActive, true); assert.equal(calls, 2);
    status = 'draft'; planning = 'confirmed'; await assert.rejects(activateAssistantWeeklyPackage(target, () => true), /经营派单/); assert.equal(calls, 2);
    planning = 'dispatched'; version = 4; await assert.rejects(activateAssistantWeeklyPackage(target, () => true), /版本已变化/); assert.equal(calls, 2);
    version = 3; await assert.rejects(activateAssistantWeeklyPackage(target, () => false), /身份或周任务已变化/); assert.equal(calls, 2);
    socialProgramApi.get = async () => { token = 'changed'; return { programId: 'program', version: 7 } as never; };
    await assert.rejects(activateAssistantWeeklyPackage(target, () => true), /身份或周任务已变化/); assert.equal(calls, 2);
  } finally { Object.assign(socialProgramApi, original); }
});
