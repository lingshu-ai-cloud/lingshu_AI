import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useAssistantStore } from '../../stores/assistantStore';
import { emptyAssistantThread, mergeConsecutiveAssistant } from './globalAssistantRuntime';
import { useAssistantSend } from './useAssistantSend';
import { assistantHomePromptById } from '../../lib/assistantHomeQuickPrompts';

type SendInput = Parameters<typeof useAssistantSend>[0];
test('inline business selectors and scoped replies are never merged away on hydration',()=>{
 const messages=mergeConsecutiveAssistant([{role:'assistant',content:'前一条回答'}, {role:'assistant',content:'你想先关注谁？',businessScenePrompt:{sceneId:'CS-02'}}, {role:'assistant',content:'客户回复',businessScene:{sceneId:'CS-02',from:'2026-10-21',to:'2026-10-27',customerId:'owned'}}]);
 assert.equal(messages.length,3);assert.equal(messages[1].businessScenePrompt?.sceneId,'CS-02');assert.equal(messages[2].businessScene?.customerId,'owned');
});

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
    assert.equal(requestedBody.responseMode, undefined, 'ordinary conversation keeps the full reply mode');
    assert.deepEqual(useAssistantStore.getState().threads.business.messages.map(message => message.content),
      ['请说明本周重点', '本周先核对计划。']);
    assert.equal(persisted, 1);
    assert.equal(abort.current, null);
    store.setDraftInput('business', '保留这份尚未发送的草稿');
    await send('请解读科思股份2026年半年度报告。', 'business', undefined, [], undefined, { companyReport: true, preserveDraft: true });
    assert.equal(requests, 2, 'confirmed report uses the existing chat stream exactly once');
    assert.equal(useAssistantStore.getState().threads.business.draftInput, '保留这份尚未发送的草稿');

    await send('我想借鉴一条爆款视频，为自己的产品策划内容，并安排进周任务包。');
    assert.equal(requests, 2, 'the scene prepares the original task without invoking a model or production');
    assert.equal(useAssistantStore.getState().threads.business.messages.at(-1)?.creationPortal?.scenario, 'viral_replication');
    const taskPortal = { kind: 'content_task' as const, taskId: 'socialtask_verified', title: '待确认的视频方案', action: 'review_plan' as const, phase: 'offered' as const };
    store.hydrateThread('business', { messages: [{ role: 'assistant', content: '是否前往内容创作页确认方案？', taskPortal }] });
    await send('是');
    assert.equal(requests, 2, 'confirmation reveals a portal without any model or task mutation');
    assert.equal(useAssistantStore.getState().threads.business.messages.at(-1)?.taskPortal?.phase, 'ready');
    assert.equal(useAssistantStore.getState().threads.business.messages.at(-1)?.taskPortal?.taskId, 'socialtask_verified');
    store.hydrateThread('business', { messages: [{ role: 'assistant', content: '已核验的资讯回答。', sources: [{ title: '已核验来源', uri: 'https://example.com/original' }] }] });
    await send('查看本次回答的信息来源');
    assert.equal(requests, 2, 'source lookup reuses this answer, without searching again');
    assert.equal(useAssistantStore.getState().threads.business.messages.at(-1)?.sourcePortal, undefined);
    await send('打开第1条来源原文');
    assert.equal(requests, 2, 'source portal needs neither model inference nor an external write');
    assert.equal(useAssistantStore.getState().threads.business.messages.at(-1)?.sourcePortal?.uri, 'https://example.com/original');
    store.hydrateThread('business', emptyAssistantThread());
    await send('帮我复刻一张爆款图文海报');
    assert.equal(requests, 2, 'an image request without an attachment remains a navigation draft');
    assert.equal(useAssistantStore.getState().threads.business.messages.at(-1)?.creationPortal?.outputType, 'image', 'image replication must not be intercepted by the video scene');
    store.hydrateThread('business', emptyAssistantThread());
    await send('帮我复刻这张图文海报', 'business', undefined, [{ kind: 'image', name: '原图.png', materialId: 'uploaded-reference', size: 100 }]);
    assert.equal(requests, 2, 'image replication with an attachment opens intake without model calls or task writes');
    assert.equal(useAssistantStore.getState().threads.business.messages.at(-1)?.creationPortal?.imageReplication?.reference?.materialId, 'uploaded-reference');
    store.hydrateThread('business', emptyAssistantThread());
    const scene = { sceneId: 'CS-02' as const, from: '2026-10-01', to: '2026-10-26', customerId: 'owned-customer' };
    await send('总结当前会话', 'business', undefined, [], undefined, { businessScene: scene, preserveDraft: true });
    assert.deepEqual(requestedBody.businessScene, scene);
    assert.equal(requestedBody.responseMode, 'quick_task', 'home business cards request the compact actionable reply contract');
    assert.deepEqual(useAssistantStore.getState().threads.business.messages.at(-1)?.businessScene, scene);
    await send('继续分析这个客户的异议'); assert.deepEqual(requestedBody.businessScene, scene);
    store.hydrateThread('business', emptyAssistantThread());
    const creationSelection = { referenceId: 'verified-ref', productIds: ['verified-product'], shotIds: ['verified-shot'], evidenceVersion: 'a'.repeat(64) };
    store.hydrateThread('business', { creationDraft: creationSelection, messages: [...useAssistantStore.getState().threads.business.messages,
      { role: 'assistant', content: '选择已保留', creation: { stage: 'shots', selection: creationSelection, referenceTitle: '参考', products: [], shots: [], narrations: [], gaps: [], presenterIds: [] } }] });
    await send('请写一条视频脚本');
    assert.equal(requestedUrl, '/api/overseas/strategy/chat', 'free-creation follow-up must not launch production');
    assert.deepEqual(requestedBody.creationSelection, creationSelection, 'reference/product/shot identities reach the server validation boundary');
    await send('请解读科思股份2026年半年度报告。', 'business', undefined, [], undefined, { companyReport: true, preserveDraft: true });
    assert.equal(requests, 6);
    assert.equal(requestedBody.creationSelection, undefined, 'a confirmed public report must not be routed into an existing creation draft');
    assert.deepEqual(useAssistantStore.getState().threads.business.creationDraft, creationSelection);
    store.hydrateThread('business', emptyAssistantThread());
    await send(assistantHomePromptById('CS-02')!.prompt);
    assert.equal(requests,6,'customer selection is inline, with no model call');
    assert.match(useAssistantStore.getState().threads.business.messages.at(-1)!.content,/你想先关注谁/);
    assert.equal(useAssistantStore.getState().threads.business.messages.at(-1)?.businessScenePrompt?.sceneId,'CS-02');
    store.hydrateThread('business',{messages:[{role:'assistant',content:'已分析',businessScene:scene}]});
    await send(assistantHomePromptById('CS-03')!.prompt);
    assert.equal(useAssistantStore.getState().threads.business.messages.at(-1)?.businessScenePrompt?.preferredId,'owned-customer');
    assert.match(useAssistantStore.getState().threads.business.messages.at(-1)!.content,/还想再看看这位客户/);
    await send(assistantHomePromptById('AD-02')!.prompt);
    assert.equal(requests,6,'creating a draft starts a guided conversation, not a paid model or ad launch');
    assert.equal(useAssistantStore.getState().threads.business.messages.at(-1)?.businessScenePrompt?.sceneId,'AD-02');
    fence.current.active = false;
    const messageCount=useAssistantStore.getState().threads.business.messages.length;
    await send(assistantHomePromptById('CS-02')!.prompt);
    assert.equal(useAssistantStore.getState().threads.business.messages.length,messageCount,'an old scope cannot append a customer selector');
    await send('身份已切换后的旧请求');
    assert.equal(requests, 6, '旧实例失效后不得再向模型发送请求');
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(globalThis, { window: originalWindow, localStorage: originalStorage });
  }
});
