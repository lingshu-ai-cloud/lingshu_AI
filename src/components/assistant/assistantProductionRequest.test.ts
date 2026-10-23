import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useAssistantStore, type AssistantTaskCardInput } from '../../stores/assistantStore';
import { assistantProductionIntent } from './assistantProductionIntake';
import { runAssistantProductionRequest } from './assistantProductionRequest';
import type { ContentProductionTaskCard } from '../../../shared/contracts/assistantContentTaskCard';
import { AssistantContentTaskApiError } from '../../lib/assistantContentTaskApi';
import { emptyAssistantThread } from './globalAssistantRuntime';

const parsedIntent = assistantProductionIntent('请制作一条 20 秒 TikTok 竖版短视频，推广「青柠精华」');
if (!parsedIntent) throw new Error('测试生产指令未被识别');
const intent = parsedIntent;

function fixture() {
  useAssistantStore.getState().hydrateThread('business', { ...emptyAssistantThread(), version: 3, updatedAt: 'fixture' });
  const loading: boolean[] = [];
  const messages: string[] = [];
  const events: string[] = [];
  const cards: AssistantTaskCardInput[] = [];
  const calls: string[] = [];
  const card: ContentProductionTaskCard = {
    schemaVersion: 'content-production-task-card.v1', id: 'content-task-card:task-1', contentTaskId: 'task-1',
    cardVersion: '1', recoveryCursor: { kind: 'task_version', value: 'task-1@1', runId: null },
    title: '短视频任务', outputType: 'video', overallState: 'processing',
    currentNode: { id: 'production', label: '内容生产中', userFacingSummary: '正在按已确认输入推进，进度以服务端回执为准。' },
    knownItems: [{ key: 'product', label: '产品', value: '青柠精华' }], defaultedItems: [], blockingItems: [],
    progress: { mode: 'units', completed: 0, total: 1 }, cost: null, completedSummary: [], nextAction: 'view',
    lastConfirmedAt: '2026-10-24T00:00:00.000Z',
  };
  const input: Parameters<typeof runAssistantProductionRequest>[0] = {
    productionIntent: intent,
    threadAgent: 'business', expectedThreadVersion: 3, currentScope: () => true,
    setLoading: value => { loading.push(value); },
    upsertTaskCard: (_agent, card) => { cards.push(card); },
    focusTaskCard: (_agent, taskId) => { calls.push(`focus:${taskId}`); },
    hydrateThread: (_agent, patch) => { calls.push(`hydrate:${patch.version}`); },
    setMessages: (_agent, entries) => { messages.push(entries.at(-1)?.content ?? ''); },
    persistThread: () => { calls.push('persist'); },
    onSessionRefresh: () => { calls.push('refresh'); },
    refreshPipeline: () => { calls.push('pipeline'); },
    resolveProduct: async () => ({ id: 'product-1', label: '青柠精华', info: '' }),
    createTask: async request => {
      calls.push(`${request.task.productId}:${request.task.mode}:${String(request.task.dueAt)}:${request.expectedThreadVersion}:${request.idempotencyKey}`);
      return { thread: { version: 4, updatedAt: '2026-10-24T00:00:00Z', messages: [], draftInput: '', scrollPosition: 0, unreadCount: 0, isFollowingLatest: true, paused: false, taskCards: {}, focusedTaskId: null }, task: { taskId: 'task-1', version: '1', brief: { title: '短视频任务' } }, receipt: {
        taskId: 'task-1', status: 'producing', href: '/task-1', started: true, card,
      } } as never;
    },
  };
  return { input, loading, messages, events, cards, calls };
}

test('single request creates an instant task and keeps its authoritative card in the conversation', async () => {
  const originalWindow = globalThis.window;
  const { input, loading, messages, events, cards, calls } = fixture();
  Object.assign(globalThis, { window: { dispatchEvent: (event: Event) => { events.push(event.type); } } });
  try {
    await runAssistantProductionRequest(input);
    assert.match(calls[0], /^product-1:instant:null:3:assistant-content:3:/);
    assert.equal(cards[0].taskId, 'social-content:task-1');
    assert.equal(cards[0].status, 'running');
    assert.deepEqual(messages, []);
    assert.deepEqual(calls.slice(1), ['hydrate:4', 'focus:social-content:task-1', 'refresh', 'pipeline']);
    assert.deepEqual(events, ['lingshu:social-content-task-refresh']);
    assert.deepEqual(loading, [false, false]);
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

test('an atomic task waits for the unresolved thread PUT and uses its committed CAS version', async () => {
  const { input } = fixture();
  let releaseSave!: () => void;
  const saveSettled = new Promise<void>(resolve => { releaseSave = resolve; });
  let createVersion: number | null = null;
  const success = input.createTask!;
  useAssistantStore.getState().setPersistenceMetadata('business', 3, 'before-save');
  input.waitForInFlightThreadSave = async () => saveSettled;
  input.createTask = async request => { createVersion = request.expectedThreadVersion; return success(request); };
  const running = runAssistantProductionRequest(input);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  assert.equal(createVersion, null, 'POST must not begin while the prior full-thread PUT is unresolved');
  useAssistantStore.getState().setPersistenceMetadata('business', 4, 'after-save');
  releaseSave();
  await running;
  assert.equal(createVersion, 4);
});

test('a real thread version race hydrates once and retries the same intention against the new version', async () => {
  const { input, calls } = fixture();
  const success = input.createTask!;
  const versions: number[] = [];
  input.createTask = async request => {
    versions.push(request.expectedThreadVersion);
    if (versions.length === 1) throw new AssistantContentTaskApiError('会话已更新', 409, 'assistant_thread_version_conflict', { version: 9 });
    return success(request);
  };
  await runAssistantProductionRequest(input);
  assert.deepEqual(versions, [3, 9]);
  assert.equal(calls.includes('hydrate:9'), true);
  assert.equal(calls.some(call => call.includes(':9:assistant-content:3:')), true,
    'the business task idempotency identity must survive the thread-version retry');
});

test('a bind-pending response and later CAS conflict keep one task idempotency identity', async () => {
  const { input } = fixture();
  const success = input.createTask!;
  const requests: Array<{ version: number; key: string }> = [];
  input.createTask = async request => {
    requests.push({ version: request.expectedThreadVersion, key: request.idempotencyKey });
    if (requests.length === 1) throw new AssistantContentTaskApiError('绑定待确认', 503, 'assistant_content_task_binding_pending');
    if (requests.length === 2) throw new AssistantContentTaskApiError('会话已更新', 409, 'assistant_thread_version_conflict', { version: 8 });
    return success(request);
  };
  await runAssistantProductionRequest(input);
  assert.deepEqual(requests.map(item => item.version), [3, 3, 8]);
  assert.equal(new Set(requests.map(item => item.key)).size, 1);
});
