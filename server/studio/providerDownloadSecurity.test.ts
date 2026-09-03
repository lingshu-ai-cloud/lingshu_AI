import assert from 'node:assert/strict';
import {
  ProviderDownloadSecurityError,
  downloadProviderAsset,
  localStudioTtsFallbackAllowed,
  validateProviderAssetUrl,
} from './providerDownloadSecurity.js';

const publicDns = async () => ['8.8.8.8'];
await assert.rejects(
  validateProviderAssetUrl({ rawUrl: 'http://cdn.aliyuncs.com/a.wav', allowedHostSuffixes: ['aliyuncs.com'], resolveHostname: publicDns }),
  (error: unknown) => error instanceof ProviderDownloadSecurityError && error.code === 'provider_asset_url_forbidden',
);
await assert.rejects(
  validateProviderAssetUrl({ rawUrl: 'https://169.254.169.254/latest/meta-data', allowedHostSuffixes: ['169.254.169.254'] }),
  (error: unknown) => error instanceof ProviderDownloadSecurityError && error.code === 'provider_asset_private_network_forbidden',
);
await assert.rejects(
  validateProviderAssetUrl({ rawUrl: 'https://cdn.aliyuncs.com/a.wav', allowedHostSuffixes: ['aliyuncs.com'], resolveHostname: async () => ['127.0.0.1'] }),
  /provider_asset_private_network_forbidden/,
);
await assert.rejects(
  validateProviderAssetUrl({ rawUrl: 'https://aliyuncs.com.evil.test/a.wav', allowedHostSuffixes: ['aliyuncs.com'], resolveHostname: publicDns }),
  /provider_asset_url_forbidden/,
);

let redirectMode = '';
const valid = await downloadProviderAsset({
  rawUrl: 'https://cdn.aliyuncs.com/a.wav',
  allowedHostSuffixes: ['aliyuncs.com'],
  maximumBytes: 8,
  allowedContentTypes: ['audio/'],
  resolveHostname: publicDns,
  fetchImpl: (async (_url: unknown, init?: RequestInit) => {
    redirectMode = String(init?.redirect || '');
    return new Response(Uint8Array.from([1, 2, 3]), { headers: { 'content-type': 'audio/wav' } });
  }) as typeof fetch,
});
assert.deepEqual([...valid.bytes], [1, 2, 3]);
assert.equal(redirectMode, 'error');

await assert.rejects(downloadProviderAsset({
  rawUrl: 'https://cdn.aliyuncs.com/large.wav', allowedHostSuffixes: ['aliyuncs.com'], maximumBytes: 2,
  allowedContentTypes: ['audio/'], resolveHostname: publicDns,
  fetchImpl: (async () => new Response(Uint8Array.from([1, 2, 3]), { headers: { 'content-type': 'audio/wav' } })) as typeof fetch,
}), /provider_asset_too_large/);
await assert.rejects(downloadProviderAsset({
  rawUrl: 'https://cdn.aliyuncs.com/not-audio', allowedHostSuffixes: ['aliyuncs.com'], maximumBytes: 100,
  allowedContentTypes: ['audio/'], resolveHostname: publicDns,
  fetchImpl: (async () => new Response('{}', { headers: { 'content-type': 'text/html' } })) as typeof fetch,
}), /provider_asset_content_type_forbidden/);

assert.equal(localStudioTtsFallbackAllowed({ NODE_ENV: 'production', STUDIO_TTS_ALLOW_LOCAL_FALLBACK: 'true' }), false);
assert.equal(localStudioTtsFallbackAllowed({ NODE_ENV: 'development' }), true);
assert.equal(localStudioTtsFallbackAllowed({ NODE_ENV: 'test', STUDIO_TTS_ALLOW_LOCAL_FALLBACK: 'false' }), false);

console.log('provider asset SSRF, redirect, response-size, content-type, and production fallback policy passed');
