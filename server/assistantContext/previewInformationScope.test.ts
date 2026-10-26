import assert from 'node:assert/strict';
import test from 'node:test';
import { withAssistantPreviewInformation, customerPreviewAiRequestAllowed, auditedCustomerPreviewAiFetch, customerPreviewAiTransportAllowed } from '../../scripts/customer-preview-ai-scope.mjs';

test('preview information scope is opt-in, bounded, read-only and closes after the request', async () => {
  const keys = ['NODE_ENV', 'LINGSHU_LOCAL_PREVIEW', 'ASSISTANT_PREVIEW_REAL_QUERIES', 'DASHSCOPE_BASE_URL', 'QWEN_SEARCH_ENDPOINT'] as const;
  const saved = keys.map(key => process.env[key]);
  const rates = 'https://open.er-api.com/v6/latest/USD';
  try {
    Object.assign(process.env, { NODE_ENV: 'development', LINGSHU_LOCAL_PREVIEW: '1', ASSISTANT_PREVIEW_REAL_QUERIES: '0',
      DASHSCOPE_BASE_URL: 'https://maas.qianwenaiapi.com/compatible-mode/v1',
      QWEN_SEARCH_ENDPOINT: 'https://maas.qianwenaiapi.com/api/v1/services/aigc/text-generation/generation' });
    await assert.rejects(withAssistantPreviewInformation(async () => undefined), /not_enabled/);
    process.env.ASSISTANT_PREVIEW_REAL_QUERIES = '1';
    assert.equal(customerPreviewAiRequestAllowed(rates), false);
    const { audit } = await withAssistantPreviewInformation(async () => {
      assert.equal(customerPreviewAiRequestAllowed(rates), true);
      assert.equal(customerPreviewAiRequestAllowed('https://www.customs.gov.cn/article/report.html'), true);
      assert.equal(customerPreviewAiRequestAllowed('https://www.customs.gov.cn/article/report.html', { method: 'POST' }), false);
      assert.equal(customerPreviewAiRequestAllowed('https://www.customs.gov.cn/article/report.html?token=secret'), false);
      assert.equal(customerPreviewAiRequestAllowed(rates, { method: 'POST' }), false);
      assert.equal(customerPreviewAiRequestAllowed('https://comtradeapi.un.org/public/v1/preview/C/A/HS?maxRecords=500'), true);
      assert.equal(customerPreviewAiRequestAllowed('https://comtradeapi.un.org/public/v1/preview/C/A/HS?maxRecords=10000'), false);
      assert.equal(customerPreviewAiRequestAllowed(process.env.QWEN_SEARCH_ENDPOINT!, { method: 'POST' }), true);
      delete process.env.QWEN_SEARCH_ENDPOINT;
      assert.equal(customerPreviewAiRequestAllowed('https://maas.qianwenaiapi.com/api/v1/services/aigc/text-generation/generation', { method: 'POST' }), true);
      assert.equal(customerPreviewAiRequestAllowed('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', { method: 'POST' }), false);
      for (const url of ['https://graph.facebook.com/messages', 'https://evil.example', 'https://open.er-api.com.evil.example/v6/latest/USD', 'http://open.er-api.com/v6/latest/USD']) assert.equal(customerPreviewAiRequestAllowed(url), false);
      await auditedCustomerPreviewAiFetch(async () => {
        assert.equal(customerPreviewAiTransportAllowed('open.er-api.com', 443), true);
        assert.equal(customerPreviewAiTransportAllowed('graph.facebook.com', 443), false);
        return Response.json({ result: 'success' });
      }, rates);
      assert.equal(customerPreviewAiTransportAllowed('open.er-api.com', 443), false);
      for (let index = 0; index < 15; index++) await auditedCustomerPreviewAiFetch(async () => Response.json({}), rates);
      await assert.rejects(auditedCustomerPreviewAiFetch(async () => Response.json({}), rates), /request_limit/);
    });
    assert.equal(audit.length, 16);
    assert.equal(audit[0].endpoint, rates);
    assert.equal(customerPreviewAiRequestAllowed(rates), false);
  } finally {
    keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
  }
});

test('preview audit redacts query credentials and does not buffer a streaming model answer', async () => {
  const keys = ['NODE_ENV', 'LINGSHU_LOCAL_PREVIEW', 'ASSISTANT_PREVIEW_REAL_QUERIES'] as const;
  const saved = keys.map(key => process.env[key]);
  try {
    Object.assign(process.env, { NODE_ENV: 'development', LINGSHU_LOCAL_PREVIEW: '1', ASSISTANT_PREVIEW_REAL_QUERIES: '1' });
    const result = await withAssistantPreviewInformation(async () => {
      const response = new Response('data: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
      await auditedCustomerPreviewAiFetch(async () => response,
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=fixture-secret&alt=sse', { method: 'POST' });
      assert.equal(response.bodyUsed, false);
    });
    assert.ok(!JSON.stringify(result.audit).includes('fixture-secret'));
  } finally {
    keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
  }
});
