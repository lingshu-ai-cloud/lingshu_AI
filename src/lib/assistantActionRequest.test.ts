import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { AssistantActionRequest, AssistantActionResponse } from '../../shared/contracts/assistantActions';
import { executeAssistantAction } from './assistantActionRequest';

const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;
before(() => { Object.assign(globalThis, { localStorage: { getItem: () => 'test-token' } }); });
after(() => { Object.assign(globalThis, { fetch: originalFetch, localStorage: originalLocalStorage }); });

const request: AssistantActionRequest = {
  source: 'button', actionId: 'pause_task', requestId: 'request-1',
  target: { objectType: 'run', objectId: 'run-1', expectedVersion: 'v1' },
  parameters: { reason: '人工检查' },
};

test('signed action request forwards the exact target and parameters and accepts an acknowledged result', async () => {
  const acknowledged: AssistantActionResponse = {
    status: 'accepted', actionId: 'pause_task', requestId: 'request-1', notification: null,
    card: { kind: 'operation_result', title: '已暂停', summary: '已受理', details: [] },
  };
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/overseas/assistant-threads/business/actions');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-token');
    assert.deepEqual(JSON.parse(String(init?.body)), request);
    return Response.json(acknowledged);
  };
  assert.deepEqual(await executeAssistantAction('business', request), acknowledged);
});

test('409 conflict and 422 missing input remain visible action cards, never chat fallthrough', async () => {
  globalThis.fetch = async () => Response.json({ error: 'version_conflict', message: '任务版本已更新' }, { status: 409 });
  const stale = await executeAssistantAction('business', request);
  assert.equal(stale.status, 'stale_action');
  assert.equal(stale.card.title, '页面信息已更新');
  assert.equal(stale.requestId, request.requestId);
  globalThis.fetch = async () => Response.json({ error: 'required_goal', message: '请补充目标' }, { status: 422 });
  const missing = await executeAssistantAction('business', request);
  assert.equal(missing.status, 'missing_required_input');
  assert.equal(missing.notification?.reason, 'missing_required_input');
  assert.equal(missing.card.kind, 'decision');
});

test('invalid success and failed transport never masquerade as not_handled', async () => {
  globalThis.fetch = async () => Response.json({});
  const invalid = await executeAssistantAction('business', request);
  assert.equal(invalid.status, 'failed');
  assert.equal(invalid.errorCode, 'assistant_action_invalid_response');
  globalThis.fetch = async () => { throw new Error('network unavailable'); };
  const failed = await executeAssistantAction('business', request);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.card.summary, 'network unavailable');
});

test('timeout is a result-unknown card that warns against duplicate submission', async () => {
  globalThis.fetch = async () => new Promise<Response>(() => {});
  const unknown = await executeAssistantAction('business', request, { timeoutMs: 5 });
  assert.equal(unknown.status, 'failed');
  assert.equal(unknown.errorCode, 'assistant_action_result_unknown');
  assert.equal(unknown.card.title, '操作结果待确认');
  assert.match(unknown.card.summary, /不要重复提交/);
});
