import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { streamAssistantReply } from './assistantChatStream';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;
before(() => { Object.assign(globalThis, { window: globalThis, localStorage: { getItem: () => null } }); });
after(() => { Object.assign(globalThis, { fetch: originalFetch, window: originalWindow, localStorage: originalLocalStorage }); });

function streamResponse(...chunks: string[]) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  }), { status: 200 });
}

function request(overrides: Partial<Parameters<typeof streamAssistantReply>[0]> = {}) {
  const received = { started: 0, text: '', sources: 0, files: 0, timeout: 0 };
  return {
    received,
    input: {
      endpoint: '/api/overseas/strategy/chat', headers: {}, body: { messages: [] },
      controller: new AbortController(), fileIntent: null, fileTitle: '会话文档',
      isCurrent: () => true,
      onStart: () => { received.started += 1; },
      onText: (text: string) => { received.text += text; },
      onSources: () => { received.sources += 1; },
      onFileReady: () => { received.files += 1; },
      onTimeout: () => { received.timeout += 1; },
      responseErrorMessage: async () => '请求失败',
      ...overrides,
    } satisfies Parameters<typeof streamAssistantReply>[0],
  };
}

test('流式分块与来源在完成标记后正常交付', async () => {
  globalThis.fetch = async () => streamResponse(
    'data: {"text":"你好"}\n',
    'data: {"sources":[{"title":"来源","uri":"https://example.com"}]}\n',
    'data: [DONE]\n',
  );
  const { input, received } = request();
  await streamAssistantReply(input);
  assert.deepEqual(received, { started: 1, text: '你好', sources: 1, files: 0, timeout: 0 });
});

test('缺少完成标记时保留已交付的文字并报告传输中断', async () => {
  globalThis.fetch = async () => streamResponse('data: {"text":"部分内容"}\n');
  const { input, received } = request();
  await assert.rejects(streamAssistantReply(input), /回答传输中断/);
  assert.equal(received.text, '部分内容');
});

test('task navigation metadata arrives with the answer but cannot skip confirmation', async () => {
  const portal = { kind: 'content_task', taskId: 'socialtask_verified', title: '产品视频', action: 'review_plan', phase: 'offered' };
  globalThis.fetch = async () => streamResponse(`data: ${JSON.stringify({ text: '是否前往确认方案？', taskPortal: portal })}\ndata: [DONE]\n`);
  let receivedPortal: unknown;
  const { input, received } = request({ onTaskPortal: value => { receivedPortal = value; } });
  await streamAssistantReply(input);
  assert.deepEqual(receivedPortal, portal); assert.equal(received.text, '是否前往确认方案？');
  receivedPortal = undefined;
  globalThis.fetch = async () => streamResponse(`data: ${JSON.stringify({ taskPortal: { ...portal, phase: 'ready' } })}\ndata: [DONE]\n`);
  await streamAssistantReply(input); assert.equal(receivedPortal, undefined);
});

test('文件请求先等待完整正文，再生成可下载文件标记', async () => {
  const fileId = 'a'.repeat(64);
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    if (calls === 1) return streamResponse('data: {"text":"文件正文"}\ndata: [DONE]\n');
    assert.equal(JSON.parse(String(init?.body)).content, '文件正文');
    return Response.json({ file: { id: fileId } });
  };
  let delivered = '';
  const { input, received } = request({
    fileIntent: { format: 'pdf', diagram: false, needsMapScope: false },
    onFileReady: content => { delivered = content; },
  });
  await streamAssistantReply(input);
  assert.equal(calls, 2);
  assert.equal(received.text, '');
  assert.match(delivered, new RegExp(`<!--assistant-file:${fileId}-->`));
});
