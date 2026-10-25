import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantFollowUpSuggestion, assistantSourceFollowUp } from './assistantFollowUp';
import type { Message } from '../appSession';
import { parseMessages } from '../../server/routes/assistantThreadMessageInput';
import { sanitizeAssistantThreadForJournal } from './assistantThreadJournal';
import { useAssistantStore } from '../stores/assistantStore';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AssistantSourcePortalCard } from '../components/assistant/AssistantCreationPortalCard';

const answer: Message = { role: 'assistant', content: '查询结果。总体结论：按此继续。', sources: [{ title: '已核验来源', uri: 'https://example.com/original' }] };
test('external answer suggests source lookup, source lookup suggests original, explicit request reveals a portal', () => {
  assert.equal(assistantFollowUpSuggestion([answer]), '查看本次回答的信息来源');
  assert.equal(answer.sourcePortal, undefined);
  const lookup = assistantSourceFollowUp('查看本次回答的信息来源', answer)!;
  assert.equal(lookup.sourcePortal, undefined); assert.deepEqual(lookup.sources, answer.sources);
  assert.equal(assistantFollowUpSuggestion([answer, { role: 'user', content: '查看本次回答的信息来源' }, lookup]), '打开第1条来源原文');
  const opened = assistantSourceFollowUp('打开第1条来源原文', lookup)!;
  assert.deepEqual(opened.sourcePortal, answer.sources![0]);
  assert.equal(assistantFollowUpSuggestion([opened]), '');
  assert.match(renderToStaticMarkup(createElement(AssistantSourcePortalCard, { portal: opened.sourcePortal! })), /href="https:\/\/example.com\/original"/);
  assert.deepEqual(parseMessages([opened]), [opened]);
  assert.deepEqual(sanitizeAssistantThreadForJournal({ ...useAssistantStore.getState().threads.business, messages: [opened] }).messages[0].sourcePortal, opened.sourcePortal);
});
test('no inferred URL, unrelated actions, unsafe URLs or ambiguous original requests', () => {
  assert.equal(assistantSourceFollowUp('打开原文', { role: 'assistant', content: 'https://unverified.example' }), null);
  assert.equal(assistantSourceFollowUp('创建一条视频', answer), null);
  assert.equal(assistantFollowUpSuggestion([{ role: 'user', content: '查看来源' }]), '');
  assert.equal(assistantFollowUpSuggestion([{ ...answer, sources: [{ title: 'bad', uri: 'javascript:alert(1)' }] }]), '');
  assert.throws(() => parseMessages([{ role: 'assistant', content: '', sourcePortal: { title: 'bad', uri: 'javascript:alert(1)' } }]));
  const multiple = { ...answer, sources: [...answer.sources!, { title: '第二条', uri: 'https://example.org/original' }] };
  assert.equal(assistantSourceFollowUp('打开这篇原文', multiple)?.sourcePortal, undefined);
  assert.equal(assistantSourceFollowUp('打开第二条来源原文', multiple)?.sourcePortal?.uri, 'https://example.org/original');
  assert.equal(assistantSourceFollowUp('打开第8条来源原文', multiple)?.sourcePortal, undefined);
});
test('only an immediately available task offer suggests confirmation', () => {
  const offered: Message = { role: 'assistant', content: '是否处理？', taskPortal: { kind: 'content_task', taskId: 'task_verified', title: '原任务', action: 'review_plan', phase: 'offered' } };
  assert.equal(assistantFollowUpSuggestion([offered]), '打开这条任务');
  assert.equal(assistantFollowUpSuggestion([offered, { role: 'assistant', content: '新话题' }]), '');
  assert.equal(assistantFollowUpSuggestion([{ ...offered, taskPortal: { ...offered.taskPortal!, phase: 'ready' } }]), '');
});
