import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SocialAssistantReceipt } from '../../lib/socialContentApi';
import { WEEKLY_WORK_UPDATED_EVENT } from '../../lib/weeklyWorkEvents';
import type { AssistantTaskCardInput } from '../../stores/assistantStore';
import { assistantProductionIntent } from './assistantProductionIntake';
import { runAssistantProductionRequest } from './assistantProductionRequest';

const parsedIntent = assistantProductionIntent('请制作一条 20 秒 TikTok 竖版短视频，推广「青柠精华」');
if (!parsedIntent) throw new Error('测试生产指令未被识别');
const intent = parsedIntent;

function fixture() {
  const loading: boolean[] = [];
  const messages: string[] = [];
  const events: string[] = [];
  const cards: AssistantTaskCardInput[] = [];
  const calls: string[] = [];
  const input: Parameters<typeof runAssistantProductionRequest>[0] = {
    productionIntent: intent,
    threadAgent: 'business', currentScope: () => true,
    pipelineModalOpenRef: { current: false },
    modal: null as never, uiMessage: null as never,
    setLoading: value => { loading.push(value); },
    upsertTaskCard: (_agent, card) => { cards.push(card); },
    setMessages: (_agent, entries) => { messages.push(entries.at(-1)?.content ?? ''); },
    persistThread: () => { calls.push('persist'); },
    onSessionRefresh: () => { calls.push('refresh'); },
    refreshPipeline: () => { calls.push('pipeline'); },
    closeForNavigation: () => { calls.push('close'); },
    requestId: () => 'request-1',
    confirmDueAt: async () => '2026-11-01T00:00:00.000Z',
    resolveProduct: async () => ({ id: 'product-1', label: '青柠精华', info: '' }),
    createTask: async (taskInput, operationKey) => {
      calls.push(`${taskInput.productId}:${taskInput.dueAt}:${operationKey}`);
      return { task: { taskId: 'task-1', brief: { title: '短视频任务' } }, receipt: {
        taskId: 'task-1', status: 'producing', href: '/task-1', started: true,
      } } as SocialAssistantReceipt;
    },
  };
  return { input, loading, messages, events, cards, calls };
}

test('confirmed request binds real product, due date, receipt card and task navigation', async () => {
  const originalWindow = globalThis.window;
  const { input, loading, messages, events, cards, calls } = fixture();
  Object.assign(globalThis, { window: { dispatchEvent: (event: Event) => { events.push(event.type); } } });
  try {
    await runAssistantProductionRequest(input);
    assert.match(calls[0], /^product-1:2026-11-01T00:00:00.000Z:assistant-production-request-1$/);
    assert.equal(cards[0].taskId, 'social-content:task-1');
    assert.equal(cards[0].status, 'running');
    assert.match(messages[0], /已创建周任务/);
    assert.deepEqual(calls.slice(1), ['persist', 'refresh', 'pipeline', 'close']);
    assert.deepEqual(events, [WEEKLY_WORK_UPDATED_EVENT, 'lingshu:navigate']);
    assert.deepEqual(loading, [false, true, false, false]);
  } finally { Object.assign(globalThis, { window: originalWindow }); }
});

test('missing enterprise product never reaches task creation', async () => {
  const { input, messages, calls } = fixture();
  input.resolveProduct = async () => { throw new Error('未找到已确认产品'); };
  await runAssistantProductionRequest(input);
  assert.equal(calls.includes('persist'), true);
  assert.equal(calls.some(call => call.startsWith('product-1:')), false);
  assert.match(messages[0], /未找到已确认产品/);
});

test('scope change after product read prevents confirmation and creation', async () => {
  const { input, calls } = fixture();
  input.currentScope = () => false;
  await runAssistantProductionRequest(input);
  assert.deepEqual(calls, []);
});
