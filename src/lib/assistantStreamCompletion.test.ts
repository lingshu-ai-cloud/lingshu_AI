import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssistantStreamCompletion, appendAssistantStreamFailure } from './assistantStreamCompletion';

test('requires explicit completion even after receiving text', () => {
  const stream = new AssistantStreamCompletion();
  stream.accept('{"text":"部分回答"}');
  assert.throws(() => stream.assertComplete(), /传输中断/);
  stream.accept('[DONE]');
  assert.doesNotThrow(() => stream.assertComplete());
});
test('error followed by DONE must not become success', () => {
  const stream = new AssistantStreamCompletion();
  stream.accept('{"text":"部分回答"}');
  stream.accept('{"error":"provider error"}');
  stream.accept('[DONE]');
  assert.throws(() => stream.assertComplete(), /生成中断/);
});
test('malformed chunks remain failures even with DONE', () => {
  const stream = new AssistantStreamCompletion();
  stream.accept('{broken');
  stream.accept('[DONE]');
  assert.throws(() => stream.assertComplete(), /传输异常/);
});
test('failure notice escapes unfinished detail or copy blocks', () => {
  assert.equal(appendAssistantStreamFailure('结论\n```details\n分析', '回答中断'), '结论\n```details\n分析\n```\n\n回答中断');
});
