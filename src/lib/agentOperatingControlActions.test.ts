import assert from 'node:assert/strict';
import test from 'node:test';
import type { WeeklyExecutionTask, WeeklyOperatingPackage } from '../../shared/contracts/socialProgram';
import { socialProgramApi } from './socialProgramApi';
import { createAgentOperatingControlActions } from './agentOperatingControlActions';
const pkg = { programId: 'program', packageId: 'package', version: 3, status: 'active', socialContentPackage: { publicationTasks: [{ publicationTaskId: 'pub', status: 'planned' }] } } as WeeklyOperatingPackage;
test('calendar reception revision passes frozen expected version and returns only the exact new draft', async () => {
  let activated = false;
  const actions = createAgentOperatingControlActions(pkg, [], { ...socialProgramApi,
    async reviseOperatingPackage(programId, packageId, body) { assert.equal(programId, 'program'); assert.equal(packageId, 'package'); assert.equal(body.expectedVersion, 3); assert.deepEqual(body.publicationTasks, pkg.socialContentPackage.publicationTasks); return { ...pkg, version: 4, status: 'draft' }; },
    async activateOperatingPackage() { activated = true; throw Error('must not activate'); },
  });
  assert.equal((await actions.saveReception(pkg.socialContentPackage.publicationTasks)).version, 4); assert.equal(activated, false);
  await assert.rejects(actions.saveReception([{ ...pkg.socialContentPackage.publicationTasks[0], publicationTaskId: 'other' }]), /冻结发布任务/);
});
test('recovery ignores unrelated execution rows and rejects out-of-scope inputs before HTTP', async () => {
  const tasks = [{ taskId: 'valid', programId: 'program', packageId: 'package', packageVersion: 3 }, { taskId: 'wrong', programId: 'program', packageId: 'package', packageVersion: 2 }] as WeeklyExecutionTask[];
  let requested = false; const scenario = { changedTaskIds: ['wrong'], constraints: {}, resources: {}, remainingBudgetCny: 100 };
  const actions = createAgentOperatingControlActions(pkg, tasks, { ...socialProgramApi, async assessRecovery(program, packageId, version, body) { requested = true; assert.equal(program, 'program'); assert.equal(packageId, 'package'); assert.equal(version, 3); assert.deepEqual(body.changedTaskIds, ['valid']); return { revisionApplied: false } as Awaited<ReturnType<typeof socialProgramApi.assessRecovery>>; } });
  await assert.rejects(actions.assessRecovery(scenario), /其它项目或版本/); assert.equal(requested, false);
  await actions.assessRecovery({ ...scenario, changedTaskIds: ['valid'] }); assert.equal(requested, true);
});
test('unexpected active or wrong revision identity is never treated as the selected new week', async () => {
  const actions = createAgentOperatingControlActions(pkg, [], { ...socialProgramApi, async reviseOperatingPackage() { return { ...pkg, version: 4, status: 'active' }; } });
  await assert.rejects(actions.saveReception(pkg.socialContentPackage.publicationTasks), /身份或状态异常/);
});
