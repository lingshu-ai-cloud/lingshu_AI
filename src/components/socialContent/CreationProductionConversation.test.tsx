import assert from 'node:assert/strict';
import React from 'react';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import CreationProductionConversation from './CreationProductionConversation';
import { contentCreationTurn } from '../../../server/assistantContext/contentCreationDialogue';
import { creationDialogueFixture } from '../../../scripts/fixtures/contentCreationDialogue';
import { useAssistantStore } from '../../stores/assistantStore';
import { emptyAssistantThread } from '../assistant/globalAssistantRuntime';
import { sanitizeAssistantThreadForJournal } from '../../lib/assistantThreadJournal';
import type { CreationReply } from '../../../shared/contracts/contentCreationDialogue';

test('production entry renders one question per stage instead of the former workbench and journals edited answers in the existing thread', async () => {
  const f = creationDialogueFixture(); f.materials[2]!.productId = 'unrelated';
  const run = (action: string, selection: unknown) => contentCreationTurn('fixture', { action, selection, instruction: '测试' }, f.ports);
  const shots = await run('products', { referenceId: 'fixture-video', productIds: ['fixture-product'], shotIds: [] });
  const narration = await run('shots', shots.selection);
  const storyboard = await run('production_storyboard', { ...narration.selection, narrationId: 'visual', avatar: false });
  const render = (plan: CreationReply) => {
    useAssistantStore.getState().hydrateThread('business', { ...emptyAssistantThread(), creationDraft: plan.selection, messages: [{ role: 'assistant', content: '当前生产问题', creation: plan }] });
    const initialThreads = useAssistantStore.getInitialState().threads;
    const initialBusiness = initialThreads.business;
    initialThreads.business = useAssistantStore.getState().threads.business;
    try { return renderToStaticMarkup(<CreationProductionConversation plan={plan}/>); }
    finally { initialThreads.business = initialBusiness; }
  };
  let html = render(storyboard);
  assert.match(html, /确认顺序，继续素材问答/);
  assert.match(html, /所选产品实拍 · 待补/);
  assert.match(html, /仅作结构参考/);
  assert.doesNotMatch(html, /更换开场方式|生成设置|确认口播，进入分镜制作/);
  const matching = await run('production_match', storyboard.selection);
  html = render(matching);
  assert.match(html, /保留候选，授权待核验/);
  assert.match(html, /暂不使用工厂片段/);
  const editing = await run('production_edit', { ...matching.selection, productionDraft: { materialChoice: 'candidate' } });
  html = render(editing);
  assert.match(html, /口播问答回复/);
  assert.match(html, /确认口播文字，不合成语音/);
  const review = await run('production_review', { ...editing.selection, productionDraft: { materialChoice: 'candidate', narrationDraft: '根据已有产品资料确认文字，不合成语音。' } });
  render(review);
  const journal = sanitizeAssistantThreadForJournal(useAssistantStore.getState().threads.business);
  assert.deepEqual(journal.creationDraft?.productionDraft, review.selection.productionDraft);
  assert.equal(journal.messages[0]?.creation?.stage, 'production_review');
  assert.equal(journal.messages[0]?.creation?.production?.narration, '根据已有产品资料确认文字，不合成语音。');
});
