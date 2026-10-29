import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assistantCreationPortalSchema } from '../../../shared/contracts/assistantCreationPortal';
import { assistantImageReplicationPortal } from './assistantImageReplicationIntent';
import AssistantCreationPortalCard, { creationPortalNavigation } from './AssistantCreationPortalCard';
import { parseMessages } from '../../../server/routes/assistantThreadMessageInput';
import { sanitizeAssistantThreadForJournal } from '../../lib/assistantThreadJournal';
import { useAssistantStore } from '../../stores/assistantStore';

test('explicit replication opens image intake with one uploaded reference, without executable parameters', () => {
  const portal = assistantImageReplicationPortal('帮我参考这张图做一张 Instagram 海报，4:5', [
    { kind: 'image', materialId: 'actual-material', name: '参考图.png', size: 100, materialUrl: 'https://untrusted.test/image' },
  ])!;
  assert.ok(assistantCreationPortalSchema.safeParse(portal).success);
  assert.equal(portal.outputType, 'image'); assert.equal(portal.aspectRatio, '4:5'); assert.deepEqual(portal.platforms, ['instagram']);
  assert.deepEqual(portal.imageReplication?.reference, { materialId: 'actual-material', name: '参考图.png' });
  const request = creationPortalNavigation(portal, 23).contentCreationRequest;
  assert.equal(request.creationPath, 'viral_replication'); assert.equal(request.sourceContext?.referenceContentType, 'image');
  assert.equal(request.sourceContext?.referenceMaterialId, 'actual-material'); assert.equal(request.continueTaskId, undefined);
  assert.match(renderToStaticMarkup(createElement(AssistantCreationPortalCard, { portal })), /图文爆款复刻/);
  const message = { role: 'assistant' as const, content: '确认参考图后继续。', creationPortal: portal };
  assert.deepEqual(parseMessages([message]), [message]);
  const thread = { ...useAssistantStore.getState().threads.business, messages: [message] };
  assert.deepEqual(sanitizeAssistantThreadForJournal(thread).messages[0].creationPortal, portal);
});

test('questions, negations and video requests keep their existing routes; multiple images require selection', () => {
  for (const text of ['怎么复刻这张图', '不要复刻这张图', '如果复刻图文会怎样', '分析这个图文爆款', '查看图文复刻任务', '帮我复刻这条视频', '帮我生成产品海报', '不要借鉴这张图创作海报', '如果借鉴图文制作会怎样']) {
    assert.equal(assistantImageReplicationPortal(text), null, text);
  }
  const attachments = ['one', 'two'].map(materialId => ({ kind: 'image' as const, materialId, name: materialId, size: 10 }));
  assert.equal(assistantImageReplicationPortal('帮我复刻这张图', attachments)?.imageReplication?.reference, undefined);
  const portal = assistantImageReplicationPortal('帮我复刻一张领英图文')!;
  assert.deepEqual(portal.platforms, ['linkedin']);
  assert.equal(assistantCreationPortalSchema.safeParse({ ...portal, outputType: 'video' }).success, false);
  assert.equal(assistantCreationPortalSchema.safeParse({ ...portal, imageReplication: { reference: { materialId: 'x', name: 'x', url: 'https://evil.test' } } }).success, false);
});

test('borrowing a named reference with product context opens real image intake instead of a text-only answer', () => {
  const portal = assistantImageReplicationPortal('帮我借鉴灵感集市里已完成拆解的“LUXURY IN EVERY COMPACT”图文，为企业产品“燕窝碎碎洁面凝露”创作一条 Facebook 爆款图文。使用企业知识库里的真实产品信息，只制作 1 张图片。完成后停在验收，不发布。');
  assert.ok(portal);
  assert.equal(portal.outputType, 'image');
  assert.equal(portal.requestedOutputCount, 1);
  assert.deepEqual(portal.platforms, ['facebook']);
  assert.ok(portal.imageReplication);
});
