import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useAssistantStore } from '../../stores/assistantStore';
import { emptyAssistantThread } from './globalAssistantRuntime';
import { useAssistantSend } from './useAssistantSend';

type SendInput = Parameters<typeof useAssistantSend>[0];

test('ordinary chat sends one scoped strategy request and stores its completed reply', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalStorage = globalThis.localStorage;
  const storage = { getItem: (key: string) => key === 'overseas_token' ? 'test-token' : null };
  Object.assign(globalThis, { window: { location: { search: '' }, localStorage: storage,
    setTimeout, clearTimeout }, localStorage: storage });
  let requests = 0;
  let requestedUrl = '';
  let requestedBody: Record<string, unknown> = {};
  let authorization = '';
  globalThis.fetch = async (url, init) => {
    requests += 1;
    requestedUrl = String(url);
    authorization = String(init?.headers && (init.headers as Record<string, string>).Authorization);
    requestedBody = JSON.parse(String(init?.body));
    return new Response('data: {"text":"本周先核对计划。"}\ndata: [DONE]\n', { status: 200 });
  };
  const store = useAssistantStore.getState();
  store.hydrateThread('business', emptyAssistantThread());
  const fence = { current: { scopeKey: 'tenant-a\u0000user-a', active: true } };
  const abort = { current: null as AbortController | null };
  let persisted = 0;
  let send: ReturnType<typeof useAssistantSend>['send'] | undefined;
  const input = {
    page: 'strategy', pageContext: { agent: 'strategy', label: '首页', summary: '本周经营', suggestions: [] },
    currentPageAgent: 'business', enterpriseContext: '', loading: false,
    fileGenerating: false, replyStreaming: false,
    contentIntake: { active: false, answer: () => false, start: () => {} },
    uiMessage: { warning: () => {} }, modal: {},
    persistenceFenceRef: fence, stablePersistenceScope: { tenantId: 'tenant-a', userId: 'user-a' },
    pendingMapFileRef: { current: false }, pipelineModalOpenRef: { current: false }, abortRef: abort,
    openAgent: () => {}, presentActionResponse: () => {},
    setMessages: store.setMessages, setDraftInput: store.setDraftInput,
    setFollowingLatest: store.setFollowingLatest, upsertTaskCard: store.upsertTaskCard,
    setLoading: () => {}, setFileGenerating: () => {}, setReplyStreaming: () => {},
    setAssistantTool: () => {}, setPanelView: () => {}, setWelcomeBubbleVisible: () => {},
    setMode: () => {}, setPipelineRefresh: () => {},
    persistThread: () => { persisted += 1; }, requestId: () => 'request-1',
    activeAgent: 'business', draftInput: '', pendingAttachments: [], attachmentUploading: false,
    weeklyPlanKickoffAvailable: false, uploadedAttachmentCacheRef: { current: new WeakMap() },
    setAttachmentError: () => {}, setAttachmentUploading: () => {}, setPendingAttachments: () => {},
    openWeeklyPlanFromAssistant: () => {},
  } as unknown as SendInput;
  try {
    renderToStaticMarkup(createElement(() => { send = useAssistantSend(input).send; return null; }));
    assert.ok(send);
    await send('请说明本周重点');
    assert.equal(requests, 1, JSON.stringify(useAssistantStore.getState().threads.business.messages));
    assert.equal(requestedUrl, '/api/overseas/strategy/chat');
    assert.match(authorization, /Bearer test-token/);
    assert.equal(requestedBody.userQuestion, '请说明本周重点');
    assert.deepEqual(useAssistantStore.getState().threads.business.messages.map(message => message.content),
      ['请说明本周重点', '本周先核对计划。']);
    assert.equal(persisted, 1);
    assert.equal(abort.current, null);
    fence.current.active = false;
    await send('身份已切换后的旧请求');
    assert.equal(requests, 1, '旧实例失效后不得再向模型发送请求');
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(globalThis, { window: originalWindow, localStorage: originalStorage });
  }
});
