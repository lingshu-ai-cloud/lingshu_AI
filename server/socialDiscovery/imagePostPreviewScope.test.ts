import assert from 'node:assert/strict';
import test from 'node:test';
import { withAssistantPreviewInformation, customerPreviewAiRequestAllowed, auditedCustomerPreviewAiFetch } from '../../scripts/customer-preview-ai-scope.mjs';

test('explicit preview image analysis uses the configured model endpoint and retains its receipt, then closes', async () => {
  const keys = ['NODE_ENV', 'LINGSHU_LOCAL_PREVIEW', 'ASSISTANT_PREVIEW_REAL_QUERIES', 'DASHSCOPE_BASE_URL'] as const;
  const saved = keys.map(key => process.env[key]);
  try {
    Object.assign(process.env, { NODE_ENV: 'development', LINGSHU_LOCAL_PREVIEW: '1',
      ASSISTANT_PREVIEW_REAL_QUERIES: '1', DASHSCOPE_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' });
    const endpoint = `${process.env.DASHSCOPE_BASE_URL}/chat/completions`;
    const request = { method: 'POST', body: JSON.stringify({ model: 'qwen-vl-max', messages: [
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }] },
    ] }) };
    assert.equal(customerPreviewAiRequestAllowed(endpoint, request), false);
    const result = await withAssistantPreviewInformation(async () => {
      assert.equal(customerPreviewAiRequestAllowed(endpoint, request), true);
      assert.equal(customerPreviewAiRequestAllowed('https://graph.facebook.com/messages', request), false);
      return auditedCustomerPreviewAiFetch(async () => Response.json({ id: 'vision-result', model: 'qwen-vl-max',
        usage: { total_tokens: 123 } }, { headers: { 'x-request-id': 'vision-request' } }), endpoint, request);
    });
    assert.equal(result.audit[0].requestId, 'vision-request');
    assert.equal(result.audit[0].completionId, 'vision-result');
    assert.equal(result.audit[0].usage?.total_tokens, 123);
    assert.equal(customerPreviewAiRequestAllowed(endpoint, request), false);
    process.env.ASSISTANT_PREVIEW_REAL_QUERIES = '0';
    await assert.rejects(withAssistantPreviewInformation(async () => undefined), /not_enabled/);
  } finally {
    keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
  }
});
