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
test('external information failures show a bounded public explanation and remain failed after DONE', () => {
  const stream = new AssistantStreamCompletion();
  stream.accept(JSON.stringify({ error: 'provider_internal', code: 'search_sources_missing', publicMessage: '本轮未取得可核验来源，暂不下结论。' }));
  stream.accept('[DONE]');
  assert.throws(() => stream.assertComplete(), /可核验来源/);
});
test('business scene and provider errors retain the actionable public explanation',()=>{
 for(const code of ['scene_enterprise_unavailable','assistant_provider_unavailable']){
  const stream=new AssistantStreamCompletion();
  stream.accept(JSON.stringify({error:'internal',code,publicMessage:'资料暂时无法核验，请稍后重试。'}));
  stream.accept('[DONE]');assert.throws(()=>stream.assertComplete(),/资料暂时无法核验/);
 }
});

{
  const stream = new AssistantStreamCompletion();
  const message = '总体结论：原文未核验。\n\n信息来源：' + '官方检索线索'.repeat(100);
  stream.accept(JSON.stringify({ sources: [{ title: '原文未核验的检索线索', uri: 'https://www.customs.gov.cn/report' }] }));
  stream.accept(JSON.stringify({ error: message, code: 'search_source_verification_failed', publicMessage: message }));
  assert.throws(() => stream.assertComplete(), error => error instanceof Error && error.message === message);
  const oversized = new AssistantStreamCompletion();
  oversized.accept(JSON.stringify({ error: 'internal', code: 'search_source_verification_failed', publicMessage: 'x'.repeat(4001) }));
  assert.ok(oversized.error.length < 240);
}
