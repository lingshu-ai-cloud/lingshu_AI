import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanDraft } from './draftReplyLanguage.js';
import { verificationEvidence, type DraftVerification } from './draftReplyVerification.js';

test('extracted draft helpers retain safe output normalization and verification labels', () => {
  assert.equal(cleanDraft('```json\n"Hello"\n```'), 'Hello');
  const result: DraftVerification = { draft: 'Hello', status: 'safe_fallback', issues: [] };
  assert.equal(verificationEvidence(result), '回答校验：资料不足，已降级为安全回复');
});
