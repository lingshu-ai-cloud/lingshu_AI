import assert from 'node:assert/strict';
import { test } from 'node:test';
import { externalText, ExternalInformationError } from './http.js';

test('Qwen access rejection identifies account/model permissions without leaking the provider payload or retrying', async () => {
  let calls = 0;
  await assert.rejects(externalText(new URL('https://maas.qianwenaiapi.com/api/v1/services/aigc/text-generation/generation'), {
    fetcher: async () => {
      calls++;
      return Response.json({ code: 'AccessDenied.Unpurchased', message: 'private-provider-detail' }, { status: 403 });
    },
  }), error => error instanceof ExternalInformationError && error.code === 'qwen_model_access_denied'
    && error.message.includes('余额') && !error.message.includes('private-provider-detail'));
  assert.equal(calls, 1);
});

test('other provider denials and malformed rejection bodies retain the normal error contract', async () => {
  for (const host of ['maas.qianwenaiapi.com', 'www.basf.com']) {
    await assert.rejects(externalText(new URL(`https://${host}/article`), {
      fetcher: async () => new Response('not JSON', { status: 403 }),
    }), error => error instanceof ExternalInformationError && error.code === 'external_http_error');
  }
});
