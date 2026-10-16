import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssistantStreamCompletion, appendAssistantStreamFailure } from './assistantStreamCompletion';
test('partial text requires completion; errors survive DONE', () => {
  const stream = new AssistantStreamCompletion();
  stream.accept('{"text":"部分回答"}');
  assert.throws(() => stream.assertComplete(), /传输中断/);
  stream.accept('[DONE]');
  assert.doesNotThrow(() => stream.assertComplete());
  stream.accept('{"error":"provider error"}');
  assert.throws(() => stream.assertComplete(), /生成中断/);
});
test('malformed events cannot silently succeed', () => {
  const stream = new AssistantStreamCompletion();
  stream.accept('{broken'); stream.accept('[DONE]');
  assert.throws(() => stream.assertComplete(), /异常/);
});
test('interruption notice stays outside incomplete detail blocks', () => {
  assert.equal(appendAssistantStreamFailure('```details\n分析', '中断'), '```details\n分析\n```\n\n中断');
});
