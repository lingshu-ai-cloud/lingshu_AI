import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assistantCreationPortal } from './assistantProductionIntake';
import AssistantCreationPortalCard, { calendarPortalNavigation, creationPortalNavigation, AssistantTaskPortalCard, taskPortalNavigation } from './AssistantCreationPortalCard';
import { assistantScenarioIntake } from '../../lib/assistantScenarioIntake';
import { confirmedTaskPortal } from '../../../shared/contracts/assistantTaskPortal';
import { assistantCreationPortalSchema } from '../../../shared/contracts/assistantCreationPortal';
import { parseMessages } from '../../../server/routes/assistantThreadMessageInput';
import { sanitizeAssistantThreadForJournal } from '../../lib/assistantThreadJournal';
import { useAssistantStore } from '../../stores/assistantStore';
import { mergeConsecutiveAssistant } from './globalAssistantRuntime';

test('new content/video intents reuse intake, preserve exact counts and leave vague counts unconfirmed', () => {
  for (const [input, count] of [['创建一条新内容', 1], ['我想创建一条新视频', 1], ['帮我制作三条视频', 3], ['新建单条内容', 1], ['创建3条TikTok视频，每条18秒', 3], ['制作二十条视频', 20], ['帮我创建几条新视频', null], ['创建1000条视频', null]] as const) {
    const portal = assistantCreationPortal(input);
    assert.ok(portal, input); assert.equal(portal.requestedOutputCount, count, input);
    assert.ok(assistantCreationPortalSchema.safeParse(portal).success);
  }
  for (const input of ['不要创建三条视频', '怎么创建三条视频', '如果创建三条视频会怎样', '查询我创建的视频任务状态', '暂停视频任务', '发布三条视频', '新建本周内容计划']) assert.equal(assistantCreationPortal(input), null, input);
});

test('Q&A navigation waits for an explicit yes and opens the original task without executing it', () => {
  const offer = { kind: 'content_task' as const, taskId: 'socialtask_verified', title: '产品视频', action: 'review_plan' as const, phase: 'offered' as const };
  assert.equal(renderToStaticMarkup(createElement(AssistantTaskPortalCard, { portal: offer })), '');
  for (const text of ['不是', '不用', '是什么原因', '是的但不要跳转', '创建新视频']) assert.equal(confirmedTaskPortal(offer, text), null);
  const ready = confirmedTaskPortal(offer, '是')!;
  assert.equal(ready.phase, 'ready'); assert.equal(confirmedTaskPortal(ready, '是'), null);
  assert.match(renderToStaticMarkup(createElement(AssistantTaskPortalCard, { portal: ready })), /确认方案/);
  assert.deepEqual(taskPortalNavigation(ready), { page: 'smartAssets', socialContentTaskId: offer.taskId, socialContentPage: 'smartAssets', directStudio: true });
  assert.throws(() => taskPortalNavigation(offer));
  const message = { role: 'assistant' as const, content: '是否打开？', taskPortal: offer };
  assert.deepEqual(parseMessages([message]), [message]);
  assert.throws(() => parseMessages([{ ...message, taskPortal: { ...offer, href: 'https://evil.example' } }]));
  assert.throws(() => parseMessages([{ ...message, role: 'user' }]));
  const thread = { ...useAssistantStore.getState().threads.business, messages: [message] };
  assert.deepEqual(sanitizeAssistantThreadForJournal(thread).messages[0].taskPortal, offer);
  assert.equal(mergeConsecutiveAssistant([message, { role: 'assistant', content: '新话题' }]).length, 2);
});

test('portal card is a navigation draft with the existing creation handoff, never a forged task receipt', () => {
  const portal = assistantCreationPortal('帮我创建3条TikTok新视频，每条18秒，介绍我们的产品。')!;
  const navigation = creationPortalNavigation(portal, 17);
  assert.equal(navigation.page, 'smartAssets'); assert.equal(navigation.directStudio, false);
  assert.equal(navigation.contentCreationRequest.assistantEntry?.requestedOutputCount, 3);
  assert.deepEqual(navigation.contentCreationRequest.prefill?.platforms, ['tiktok']);
  assert.equal(navigation.contentCreationRequest.continueTaskId, undefined);
  const html = renderToStaticMarkup(createElement(AssistantCreationPortalCard, { portal }));
  assert.match(html, /打开内容创作/); assert.match(html, /3条视频/);
  assert.doesNotMatch(html, /已完成|已创建|已生成|iframe|href=/);
  assert.throws(() => creationPortalNavigation({ ...portal, href: 'https://evil.example' } as typeof portal));
});

test('calendar intent offers a portal to the existing content-creation calendar', () => {
  const portal = assistantScenarioIntake('打开发布日历');
  assert.equal(portal?.scenario, 'weekly_calendar');
  assert.deepEqual(calendarPortalNavigation(), { page: 'socialInspiration', view: 'calendar' });
  const html = renderToStaticMarkup(createElement(AssistantCreationPortalCard, { portal: portal! }));
  assert.match(html, /打开内容创作 - 发布日历/);
  assert.doesNotMatch(html, /本周发布日历查询|完整发布日历|查看完整日历/);
});

test('server message boundary and local journal retain a typed portal, not executable parameters', () => {
  const portal = assistantCreationPortal('创建一条新内容')!;
  const message = { role: 'assistant' as const, content: '进入创作准备，尚未开始生成。', creationPortal: portal };
  assert.deepEqual(parseMessages([message]), [message]);
  assert.throws(() => parseMessages([{ ...message, creationPortal: { ...portal, taskId: 'forged' } }]));
  assert.throws(() => parseMessages([{ ...message, role: 'user' }]));
  const thread = { ...useAssistantStore.getState().threads.business, messages: [message] };
  assert.deepEqual(sanitizeAssistantThreadForJournal(thread).messages[0].creationPortal, portal);
  const merged = mergeConsecutiveAssistant([message, { role: 'assistant', content: '后续事实回复' }]);
  assert.equal(merged.length, 2); assert.deepEqual(merged[0].creationPortal, portal);
});

test('replication product selection preserves all selected identities across message storage', () => {
  const base = assistantCreationPortal('创建一条视频');
  assert.ok(base);
  const products = [{ id: 'p-one', name: '产品一' }, { id: 'p-two', name: '产品二' }];
  const portal = assistantCreationPortalSchema.parse({ ...base, scenario: 'viral_replication', replicationStep: 'schedule', selectedProducts: products });
  const messages = parseMessages([{ role: 'assistant', content: '确认产品', creationPortal: portal }]);
  const stored = messages[0] as { creationPortal: unknown };
  assert.deepEqual(assistantCreationPortalSchema.parse(stored.creationPortal).selectedProducts, products);
});

test('replication replies follow the confirmed intake step without claiming queue acceptance', async () => {
  const { replicationStepReply } = await import('../../lib/assistantReplicationStepReply');
  const portal = assistantCreationPortal('创建一条新内容')!;
  assert.match(replicationStepReply({...portal, replicationStep:'schedule'}), /产品已选好.*发布时间/);
  assert.doesNotMatch(replicationStepReply({...portal, replicationStep:'schedule'}), /先选/);
  assert.doesNotMatch(replicationStepReply({...portal, confirmedTaskId:'task-1'}), /已进入.*队列/);
});

test('historic product API metadata does not hide the publication-time step', () => {
  const portal = { ...assistantCreationPortal('创建一条新内容')!, scenario: 'viral_replication' as const,
    replicationStep: 'schedule' as const, selectedReferenceId: 'reference-1',
    selectedProducts: [{ id: 'product-1', name: '产品一', materialCount: 3 }] };
  const html = renderToStaticMarkup(createElement(AssistantCreationPortalCard, { portal }));
  assert.match(html, /预计发布时间/);
  assert.match(html, /产品一/);
  assert.match(html, /确认预计发布时间/);
});
