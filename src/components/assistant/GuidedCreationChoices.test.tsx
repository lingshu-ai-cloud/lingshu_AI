import assert from 'node:assert/strict';
import React from 'react';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { guidedCreationFixture } from '../../../scripts/fixtures/guidedCreation';
import { useAssistantStore } from '../../stores/assistantStore';
import { sanitizeAssistantThreadForJournal } from '../../lib/assistantThreadJournal';
import GuidedCreationChoices from './GuidedCreationChoices';

test('free creation renders products/languages together, manual nodes only when selected, and real dependency review', async () => {
  const f = guidedCreationFixture(); f.reference.title = '长标题'.repeat(100);
  let reply = await f.run('start', f.initial);
  assert.equal(reply.selection.referenceLabel?.length, 200);
  const render = () => {
    useAssistantStore.getState().hydrateThread('business', { creationDraft: reply.selection });
    const initial = useAssistantStore.getInitialState().threads, previous = initial.business;
    initial.business = useAssistantStore.getState().threads.business;
    try { return renderToStaticMarkup(<GuidedCreationChoices reply={reply}/>); } finally { initial.business = previous; }
  };
  let html = render();
  assert.match(html, /选择创作产品/); assert.match(html, /选择视频语言/);
  assert.doesNotMatch(html, /重点表达|口播精修|要加字幕吗/);
  reply = await f.run('guided_products', { ...reply.selection, productIds: ['fixture-product', 'fixture-product-2'], guided: { ...reply.selection.guided!, languages: ['en', 'zh'] } });
  reply = await f.run('guided_structure', { ...reply.selection, guided: { ...reply.selection.guided!, structureId: 'recommended:recommended-video' } });
  reply.selection.guided = { ...reply.selection.guided!, productionMode: 'manual', presenterMode: 'none' };
  html = render(); assert.match(html, /重新生成/); assert.match(html, /需要数字人/); assert.match(html, /加入实拍任务/);
  reply.selection.guided.productionMode = 'auto';
  html = render(); assert.doesNotMatch(html, /重新生成/);
  reply = await f.run('guided_production', reply.selection);
  const snapshot = sanitizeAssistantThreadForJournal({ ...useAssistantStore.getState().threads.business, creationDraft: reply.selection, messages: [{ role: 'assistant', content: '当前创作问题', creation: reply }] });
  assert.deepEqual(snapshot.messages[0]?.creation?.guided?.structures, reply.guided?.structures);
  assert.deepEqual(snapshot.messages[0]?.creation?.guided?.nodes, reply.guided?.nodes);
  assert.equal(snapshot.messages[0]?.creation?.stage, 'guided_review');
  assert.deepEqual(snapshot.creationDraft, JSON.parse(JSON.stringify(reply.selection)));
  html = render(); assert.match(html, /以下真实依赖尚需补齐/); assert.match(html, /确认生成/);
  assert.match(html, /参考片不会替代企业实拍/); assert.doesNotMatch(html, /视频已生成|剩余.*秒/);
});
