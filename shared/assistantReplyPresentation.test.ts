import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSISTANT_REPLY_PRESENTATIONS,
  assistantReplyPresentationPolicy,
  parseAssistantReplyPresentation,
} from './assistantReplyPresentation';

test('reply presentations keep important information visible and use scene-specific detail labels', () => {
  assert.equal(parseAssistantReplyPresentation('news'), 'news');
  assert.equal(parseAssistantReplyPresentation('unknown'), undefined);
  assert.equal(new Set(Object.values(ASSISTANT_REPLY_PRESENTATIONS).map(item => item.detailLabel)).size,
    Object.keys(ASSISTANT_REPLY_PRESENTATIONS).length);
  for (const [kind, meta] of Object.entries(ASSISTANT_REPLY_PRESENTATIONS)) {
    assert.match(meta.prompt, /details/, kind);
    assert.match(assistantReplyPresentationPolicy(kind as keyof typeof ASSISTANT_REPLY_PRESENTATIONS), /本轮信息呈现/);
  }
});
