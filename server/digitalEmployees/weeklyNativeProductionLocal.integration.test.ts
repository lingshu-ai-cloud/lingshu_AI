import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeDispatchFixture} from './weeklyNativeFollowupDispatch.fixture.js';
import {createCustomerChannelSendRequestService} from './customerChannelSendRequests.js';
import {createWeeklyNativeFollowupDispatchService} from './weeklyNativeFollowupDispatch.js';
import {resolveCustomerMessagingAuthorization} from './customerMessagingPolicy.js';

// All transport is the fixture's controlled adapter. Exercise the two crash
// boundaries that differ from the existing task/batch projection tests.
for (const channel of ['messenger', 'instagram'] as const) {
  test(`${channel}: accepted dispatch retains failed history then explicit repair writes once without sending`, async () => {
    const f = await nativeDispatchFixture(channel);
    try {
      let sends = 0, repaired = 0;
      const ledger = createCustomerChannelSendRequestService(f.store);
      const service = createWeeklyNativeFollowupDispatchService(f.store, {
        now: () => new Date('2026-10-06T12:00:00Z'),
        authorization: async () => resolveCustomerMessagingAuthorization({tenantId:'tenant',channel,configActive:true,customerAgentEnabled:true,allowRealCustomerMessages:true,providerReady:true,backgroundWorkerEnabled:true}),
        humanPermission: async (_a, _hash, execute) => execute(),
        send: async (a, body, requestId) => ledger.execute({tenantId:a.tenantId,actorUserId:a.actorUserId,requestId,channel,customerId:a.customerId,accountId:a.accountId,recipientId:a.recipientId,body,weeklyAuthority:a,
          send: async () => { sends++; return {messageId:'mid.history-controlled',recipientId:a.recipientId,raw:{message_id:'mid.history-controlled'}}; },
          recordHistory: async () => { throw Error('controlled_history_offline'); },
        }),
      });
      const result = await service.dispatch(f.command);
      assert.equal(result.originalTaskCompleted, true);
      const requestId = result.requestId;
      assert.equal((await ledger.get('tenant','owner',channel,requestId))!.historyWritebackPending, true);
      for (let retry = 0; retry < 2; retry++) await ledger.repairHistory({tenantId:'tenant',actorUserId:'owner',channel,requestId,customerId:'buyer',recordHistory: async (receipt, body, account) => {assert.equal(receipt.messageId,'mid.history-controlled');assert.equal(receipt.requestId,requestId);assert.equal(receipt.recipientId,'buyer-native');assert.equal(body,f.item.draft_body);assert.equal(account.id,'account');repaired++;}});
      assert.equal(repaired, 1);
      assert.equal((await ledger.get('tenant','owner',channel,requestId))!.historyWritebackPending, false);
      await service.dispatch(f.command);
      assert.equal(sends, 1);
    } finally { f.restore(); }
  });
  test(`${channel}: disconnected account or provider recipient drift rejects frozen dispatch before transport`, async () => {
    for (const drift of ['disconnected', 'recipient'] as const) {
      const f = await nativeDispatchFixture(channel);
      try {
        if (drift === 'disconnected') f.data.social_accounts![0]!.status = 'disconnected';
        else f.source.recipientId = 'other-provider-recipient';
        await assert.rejects(f.service.dispatch(f.command));
        assert.equal(f.sends(), 0);
        assert.equal((f.data.customer_channel_send_requests ?? []).length, 0);
      } finally { f.restore(); }
    }
  });
  test(`${channel}: provider acceptance followed by ledger loss stays fenced across repeated requests`, async () => {
    const f = await nativeDispatchFixture(channel);
    try {
      const update = f.store.update.bind(f.store);
      let lost = false;
      f.store.update = async (collection, id, patch) => {
        const payload = patch.payload;
        if (collection === 'customer_channel_send_requests' && payload && typeof payload === 'object' && 'status' in payload && payload.status === 'accepted' && !lost) {
          lost = true;
          return false;
        }
        return update(collection, id, patch);
      };
      await assert.rejects(f.service.dispatch(f.command), /provider_response_save_gap/);
      assert.equal(lost, true);
      assert.equal(f.sends(), 1);
      const requests = f.data.customer_channel_send_requests!;
      assert.equal(requests.length, 1);
      const pendingPayload = requests[0]!.payload;
      assert.ok(pendingPayload && typeof pendingPayload === 'object' && 'status' in pendingPayload);
      assert.equal(pendingPayload.status, 'sending');
      for (let retry = 0; retry < 3; retry++) await assert.rejects(f.service.dispatch(f.command));
      assert.equal(f.sends(), 1);
      assert.notEqual(f.item.status, 'sent');
      assert.notEqual(f.data.workflow_tasks!.find(t => t.task_key === 'followup_dispatch')!.status, 'succeeded');
    } finally { f.restore(); }
  });

  test(`${channel}: accepted durable receipt repairs a lost item projection without another transport`, async () => {
    const f = await nativeDispatchFixture(channel);
    try {
      const update = f.store.update.bind(f.store);
      let lost = false;
      f.store.update = async (collection, id, patch) => {
        if (collection === 'followup_batch_items' && id === f.item.id && patch.status === 'sent' && !lost) {
          lost = true;
          return false;
        }
        return update(collection, id, patch);
      };
      await assert.rejects(f.service.dispatch(f.command), /receipt_save_failed/);
      assert.equal(f.sends(), 1);
      assert.equal(f.data.customer_channel_send_requests!.length, 1);
      const acceptedPayload = f.data.customer_channel_send_requests![0]!.payload;
      assert.ok(acceptedPayload && typeof acceptedPayload === 'object' && 'status' in acceptedPayload);
      assert.equal(acceptedPayload.status, 'accepted');
      assert.notEqual(f.item.status, 'sent');
      const recovered = await f.service.dispatch(f.command);
      assert.equal(recovered.messagesSent, 0);
      assert.equal(recovered.originalTaskCompleted, true);
      assert.equal(f.item.status, 'sent');
      assert.equal(f.item.provider_message_id, 'mid.actual-native');
      assert.equal(f.batch.status, 'completed');
      await f.service.dispatch(f.command);
      assert.equal(f.sends(), 1);
    } finally { f.restore(); }
  });
}
