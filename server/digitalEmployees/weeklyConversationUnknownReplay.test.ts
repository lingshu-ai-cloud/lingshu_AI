import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeDispatchFixture} from './weeklyNativeFollowupDispatch.fixture.js';
import {createWeeklyNativeSendRecoveryService} from '../socialPrograms/weeklyNativeSendRecovery.js';

for (const channel of ['messenger', 'instagram'] as const) {
  test(`${channel} unknown delivery stays blocked across repeated open/recovery/replay operations`, async () => {
    const f = await nativeDispatchFixture(channel, true);
    try {
      await assert.rejects(f.service.dispatch(f.command));
      assert.equal(f.sends(), 1);
      const scope = {tenantId: 'tenant', programId: 'program', packageId: 'week', packageVersion: 1};
      const recovery = createWeeklyNativeSendRecoveryService(f.store);
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidates = await f.service.sources('tenant', 'owner', 'run', f.command.expectedScope);
        assert.equal(candidates[0]?.gap, 'weekly_native_dispatch_unknown_send');
        await assert.rejects(f.service.dispatch(f.command));
        const sources = await recovery.sources(scope, 'owner');
        assert.equal(sources[0]?.status, 'unknown');
        const request = await recovery.create(scope, 'owner', {
          channel, requestId: sources[0]!.requestId, ownerUserId: 'issuer',
          deadlineAt: '2026-10-06T13:00:00Z', reason: '核验原请求结果，禁止重新发送',
        });
        await assert.rejects(recovery.resolve(scope, request.id, 'issuer', {expectedVersion: request.version}));
        assert.equal((await recovery.get(scope, request.id, 'issuer')).status, 'awaiting_receipt');
        assert.equal(f.sends(), 1, 'opening or replaying unknown results must never call the provider again');
      }
      assert.notEqual(f.data.workflow_tasks!.find(task => task.task_key === 'followup_dispatch')!.status, 'succeeded');
    } finally { f.restore(); }
  });
}
