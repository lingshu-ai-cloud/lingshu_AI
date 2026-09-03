import assert from 'node:assert/strict';
import { parseRenderBatchReceipt } from './consume-render-authorization-batch.js';

const expiresAt = '2030-01-01T00:00:00.000Z';
const authorization = (language: 'zh' | 'en' | 'es', token = `secret-${language}`) => JSON.stringify({
  type: 'authorization',
  language,
  response: {
    token,
    expiresAt,
    manifest: { jobId: `job-${language}`, sourceProjectId: 'project-1', spec: { language } },
  },
});
const receipt = [
  JSON.stringify({ type: 'header', createdAt: '2026-09-03T00:00:00.000Z' }),
  JSON.stringify({ type: 'batch', batchKey: 'batch-key', batchFingerprint: 'a'.repeat(64), sourceProjectId: 'project-1' }),
  authorization('es'), authorization('zh'), authorization('en'),
].join('\n');

const parsed = parseRenderBatchReceipt(receipt, Date.parse('2029-01-01T00:00:00.000Z'));
assert.deepEqual(parsed.authorizations.map(item => item.language), ['zh', 'en', 'es']);
assert.equal(parsed.sourceProjectId, 'project-1');
assert.throws(() => parseRenderBatchReceipt(receipt, Date.parse('2031-01-01T00:00:00.000Z')), /expired/);
assert.throws(() => parseRenderBatchReceipt(receipt.replace('project-1', 'wrong-project'), Date.parse('2029-01-01T00:00:00.000Z')), /binding/);
assert.throws(() => parseRenderBatchReceipt(`${receipt}\n${authorization('zh', 'duplicate')}`, Date.parse('2029-01-01T00:00:00.000Z')), /exactly three/);
assert.ok(!JSON.stringify(parsed).includes('LINGSHU_PASSWORD'));

console.log('render authorization batch consumer tests passed');
