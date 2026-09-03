import assert from 'node:assert/strict';
import { assertProductionConfiguration, requireProductionSecret, validProductionPublicBaseUrl, validateProductionConfiguration } from './productionConfig.js';
import { signRenderToken, verifyRenderToken } from '../lib/renderToken.js';

const secret = (suffix: string) => `prod-${suffix}-abcdefghijklmnopqrstuvwxyz-0123456789`;
const valid: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  PB_ADMIN_EMAIL: 'pb-admin@lingshu.test',
  WORKBENCH_ADMIN_EMAIL: 'ops@lingshu.test',
  PUBLIC_BASE_URL: 'https://app.lingshu.cn',
  TRUST_PROXY_HOPS: '1',
  PB_ADMIN_PASSWORD: secret('pb-password'),
  WORKBENCH_ADMIN_PASSWORD: secret('workbench-password'),
  RENDER_TOKEN_SECRET: secret('render'),
  ASSET_ACCESS_SECRET: secret('asset'),
  TENANT_PLATFORM_APP_KEY: secret('tenant-platform'),
  CREDENTIAL_ENCRYPTION_KEY: secret('credential-envelope'),
  REGISTRATION_CREDENTIAL_KEY: secret('registration'),
  SUPPORT_ACCESS_SECRET: secret('support'),
  CRAWL_WORKER_TOKEN: secret('crawl-worker'),
  METRICS_TOKEN: secret('metrics'),
  DISABLE_LOCAL_AUTH_FALLBACK: 'true',
  ENABLE_LOCAL_STORE_FALLBACK: 'false',
  ALLOW_NON_ATOMIC_DIGITAL_EMPLOYEE_STORE: 'false',
  DISABLE_DIGITAL_EMPLOYEE_WORKER: 'false',
  DISABLE_DESKTOP_OPEN_OUTPUT: 'true',
  SUBSCRIPTION_ENFORCED: 'true',
  OVERSEAS_LLM_BACKEND: 'gemini',
  GEMINI_API_KEY: secret('gemini'),
  DASHSCOPE_API_KEY: secret('dashscope-studio'),
  PUBLISH_SCHEDULER_ENABLED: 'true',
};

assert.deepEqual(validateProductionConfiguration(valid), { ok: true, issues: [] });
assert.equal(validProductionPublicBaseUrl('https://app.lingshu.cn'), true);
for (const invalidOrigin of ['http://app.lingshu.cn', 'https://localhost', 'https://127.0.0.1', 'https://user:pass@app.lingshu.cn', 'https://app.lingshu.cn/path']) {
  assert.equal(validProductionPublicBaseUrl(invalidOrigin), false, invalidOrigin);
}
assert.doesNotThrow(() => assertProductionConfiguration(valid));
assert.deepEqual(validateProductionConfiguration({ NODE_ENV: 'development' }), { ok: true, issues: [] });

const missingRender = validateProductionConfiguration({ ...valid, RENDER_TOKEN_SECRET: '' });
assert.equal(missingRender.ok, false);
assert.ok(missingRender.issues.some(issue => issue.name === 'RENDER_TOKEN_SECRET' && issue.reason === 'missing'));
assert.throws(() => requireProductionSecret('RENDER_TOKEN_SECRET', { NODE_ENV: 'production' }), /invalid for production/);
assert.throws(() => requireProductionSecret('RENDER_TOKEN_SECRET', { NODE_ENV: 'production', RENDER_TOKEN_SECRET: 'change-me' }), /placeholder/);
for (const weakSecret of ['a'.repeat(64), 'abc12345'.repeat(8), 'abcdefghijklmnopqrstuvwxyz0123456789']) {
  assert.equal(validateProductionConfiguration({ ...valid, METRICS_TOKEN: weakSecret }).ok, false, weakSecret);
  assert.ok(validateProductionConfiguration({ ...valid, METRICS_TOKEN: weakSecret }).issues
    .some(issue => issue.name === 'METRICS_TOKEN' && issue.reason === 'invalid'));
}

const reused = validateProductionConfiguration({ ...valid, METRICS_TOKEN: valid.RENDER_TOKEN_SECRET });
assert.ok(reused.issues.some(issue => issue.name === 'METRICS_TOKEN' && issue.reason === 'reused'));
assert.ok(validateProductionConfiguration({ ...valid, CRAWL_WORKER_TOKEN_PREVIOUS: 'short' }).issues
  .some(issue => issue.name === 'CRAWL_WORKER_TOKEN_PREVIOUS' && issue.reason === 'too_short'));
assert.ok(validateProductionConfiguration({ ...valid, CRAWL_WORKER_TOKEN_PREVIOUS: valid.CRAWL_WORKER_TOKEN }).issues
  .some(issue => issue.name === 'CRAWL_WORKER_TOKEN_PREVIOUS' && issue.reason === 'reused'));
const insecure = validateProductionConfiguration({
  ...valid,
  ENABLE_LOCAL_STORE_FALLBACK: 'true',
  DISABLE_LOCAL_AUTH_FALLBACK: 'false',
  DISABLE_DESKTOP_OPEN_OUTPUT: 'false',
});
assert.ok(insecure.issues.some(issue => issue.name === 'ENABLE_LOCAL_STORE_FALLBACK'));
assert.ok(insecure.issues.some(issue => issue.name === 'DISABLE_LOCAL_AUTH_FALLBACK'));
assert.ok(insecure.issues.some(issue => issue.name === 'DISABLE_DESKTOP_OPEN_OUTPUT'));
assert.ok(validateProductionConfiguration({ ...valid, SUBSCRIPTION_ENFORCED: 'false' }).issues
  .some(issue => issue.name === 'SUBSCRIPTION_ENFORCED' && issue.reason === 'insecure_override'));
assert.ok(validateProductionConfiguration({ ...valid, PUBLIC_BASE_URL: '' }).issues.some(issue => issue.name === 'PUBLIC_BASE_URL' && issue.reason === 'missing'));
assert.ok(validateProductionConfiguration({ ...valid, TRUST_PROXY_HOPS: '0' }).issues.some(issue => issue.name === 'TRUST_PROXY_HOPS' && issue.reason === 'invalid'));
assert.ok(validateProductionConfiguration({ ...valid, PUBLISH_SCHEDULER_ENABLED: 'false' }).issues
  .some(issue => issue.name === 'PUBLISH_SCHEDULER_ENABLED' && issue.reason === 'invalid'));
for (const malformedKey of [
  'base64:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'base64:not-valid-@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
  'hex:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
]) {
  assert.ok(validateProductionConfiguration({ ...valid, CREDENTIAL_ENCRYPTION_KEY: malformedKey }).issues
    .some(issue => issue.name === 'CREDENTIAL_ENCRYPTION_KEY' && issue.reason === 'invalid'), malformedKey);
}
assert.ok(validateProductionConfiguration({ ...valid, SUPPORT_ACCESS_SESSION_TTL_MS: '0' }).issues
  .some(issue => issue.name === 'SUPPORT_ACCESS_SESSION_TTL_MS' && issue.reason === 'invalid'));
assert.ok(validateProductionConfiguration({ ...valid, META_GRAPH_VERSION: 'latest' }).issues
  .some(issue => issue.name === 'META_GRAPH_VERSION' && issue.reason === 'invalid'));
assert.ok(validateProductionConfiguration({ ...valid, WHATSAPP_PROVIDER_TIMEOUT_MS: '0' }).issues
  .some(issue => issue.name === 'WHATSAPP_PROVIDER_TIMEOUT_MS' && issue.reason === 'invalid'));
assert.ok(validateProductionConfiguration({ ...valid, PROVIDER_HTTP_TIMEOUT_MS: '999' }).issues
  .some(issue => issue.name === 'PROVIDER_HTTP_TIMEOUT_MS' && issue.reason === 'invalid'));
assert.equal(validateProductionConfiguration({ ...valid, TIKTOK_DIRECT_POST_AUDITED: '' }).ok, true,
  'an omitted audit flag must preserve the safe false default');
assert.equal(validateProductionConfiguration({ ...valid, TIKTOK_DIRECT_POST_AUDITED: 'false' }).ok, true);
assert.equal(validateProductionConfiguration({ ...valid, TIKTOK_DIRECT_POST_AUDITED: 'true' }).ok, true);
for (const invalidFlag of ['1', 'yes', 'TRUE']) {
  assert.ok(validateProductionConfiguration({ ...valid, TIKTOK_DIRECT_POST_AUDITED: invalidFlag }).issues
    .some(issue => issue.name === 'TIKTOK_DIRECT_POST_AUDITED' && issue.reason === 'invalid'), invalidFlag);
}
assert.ok(validateProductionConfiguration({ ...valid, WHATSAPP_INBOUND_RECEIPT_LEASE_MS: '30000' }).issues
  .some(issue => issue.name === 'WHATSAPP_INBOUND_RECEIPT_LEASE_MS' && issue.reason === 'invalid'));
const missingLlm = validateProductionConfiguration({ ...valid, GEMINI_API_KEY: '' });
assert.ok(missingLlm.issues.some(issue => issue.name === 'GEMINI_API_KEY' && issue.reason === 'missing'));
assert.throws(() => assertProductionConfiguration({ ...valid, GEMINI_API_KEY: '' }), /production configuration invalid:.*GEMINI_API_KEY:missing/);
const missingStudioTts = validateProductionConfiguration({ ...valid, DASHSCOPE_API_KEY: '', MINIMAX_API_KEY: '', MINIMAX_API_TOKEN: '' });
assert.ok(missingStudioTts.issues.some(issue => issue.name === 'STUDIO_TTS_CREDENTIAL' && issue.reason === 'missing'));
const qwen = { ...valid, OVERSEAS_LLM_BACKEND: 'qwen', GEMINI_API_KEY: '', DASHSCOPE_API_KEY: secret('dashscope') };
assert.equal(validateProductionConfiguration(qwen).ok, true);
assert.ok(validateProductionConfiguration({ ...qwen, OVERSEAS_LLM_BACKEND: 'claude' }).issues.some(issue => issue.name === 'OVERSEAS_LLM_BACKEND'));
const webhook = validateProductionConfiguration({ ...valid, DIGITAL_EMPLOYEE_EVENT_WEBHOOK_URL: 'http://events.invalid' });
assert.ok(webhook.issues.some(issue => issue.name === 'DIGITAL_EMPLOYEE_EVENT_WEBHOOK_URL'));
assert.ok(webhook.issues.some(issue => issue.name === 'DIGITAL_EMPLOYEE_EVENT_WEBHOOK_SECRET'));
const webhookWithoutAllowlist = validateProductionConfiguration({
  ...valid,
  DIGITAL_EMPLOYEE_EVENT_WEBHOOK_URL: 'https://events.lingshu.test/hook',
  DIGITAL_EMPLOYEE_EVENT_WEBHOOK_SECRET: secret('webhook'),
});
assert.ok(webhookWithoutAllowlist.issues.some(issue => issue.name === 'DIGITAL_EMPLOYEE_EVENT_WEBHOOK_ALLOWED_ORIGINS' && issue.reason === 'missing'));
const validWebhook = validateProductionConfiguration({
  ...valid,
  DIGITAL_EMPLOYEE_EVENT_WEBHOOK_URL: 'https://events.lingshu.test/hook',
  DIGITAL_EMPLOYEE_EVENT_WEBHOOK_ALLOWED_ORIGINS: 'https://events.lingshu.test',
  DIGITAL_EMPLOYEE_EVENT_WEBHOOK_SECRET: secret('webhook'),
});
assert.equal(validWebhook.ok, true);
const privateWebhook = validateProductionConfiguration({
  ...valid,
  DIGITAL_EMPLOYEE_EVENT_WEBHOOK_URL: 'https://127.0.0.1/hook',
  DIGITAL_EMPLOYEE_EVENT_WEBHOOK_ALLOWED_ORIGINS: 'https://127.0.0.1',
  DIGITAL_EMPLOYEE_EVENT_WEBHOOK_SECRET: secret('webhook'),
});
assert.ok(privateWebhook.issues.some(issue => issue.name === 'DIGITAL_EMPLOYEE_EVENT_WEBHOOK_URL'));

const realPublishWithoutVoiceoverGate = validateProductionConfiguration({
  ...valid,
  DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED: 'true',
  DASHSCOPE_API_KEY: '',
  PUBLISH_SCHEDULER_ENABLED: '',
});
assert.ok(realPublishWithoutVoiceoverGate.issues.some(issue => issue.name === 'DIGITAL_EMPLOYEE_VOICEOVER_MODE' && issue.reason === 'missing'));
assert.ok(realPublishWithoutVoiceoverGate.issues.some(issue => issue.name === 'DIGITAL_EMPLOYEE_TTS_CREDENTIAL' && issue.reason === 'missing'));
assert.ok(realPublishWithoutVoiceoverGate.issues.some(issue => issue.name === 'PUBLISH_SCHEDULER_ENABLED' && issue.reason === 'missing'));
const realPublishSilent = validateProductionConfiguration({
  ...valid,
  DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED: 'true',
  PUBLISH_SCHEDULER_ENABLED: 'true',
  DIGITAL_EMPLOYEE_VOICEOVER_MODE: 'silent_test',
  DIGITAL_EMPLOYEE_TTS_PROVIDER: 'auto',
  MINIMAX_API_KEY: secret('minimax'),
});
assert.ok(realPublishSilent.issues.some(issue => issue.name === 'DIGITAL_EMPLOYEE_VOICEOVER_MODE' && issue.reason === 'invalid'));
const realPublishQwenEnv: NodeJS.ProcessEnv = {
  ...valid,
  DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED: 'true',
  PUBLISH_SCHEDULER_ENABLED: 'true',
  DIGITAL_EMPLOYEE_VOICEOVER_MODE: 'required',
  DIGITAL_EMPLOYEE_TTS_PROVIDER: 'qwen',
  DASHSCOPE_API_KEY: secret('dashscope-tts'),
};
const realPublishQwen = validateProductionConfiguration(realPublishQwenEnv);
assert.equal(realPublishQwen.ok, true);
const realPublishInvalidPublishTimeout = validateProductionConfiguration({
  ...realPublishQwenEnv,
  PUBLISH_ACCOUNT_TIMEOUT_MS: 'not-a-duration',
});
assert.ok(realPublishInvalidPublishTimeout.issues.some(issue => issue.name === 'PUBLISH_ACCOUNT_TIMEOUT_MS' && issue.reason === 'invalid'));
const realPublishLeaseTooShort = validateProductionConfiguration({
  ...realPublishQwenEnv,
  PUBLISH_ACCOUNT_TIMEOUT_MS: '600000',
  PUBLISH_SCHEDULER_LEASE_MS: '600000',
});
assert.ok(realPublishLeaseTooShort.issues.some(issue => issue.name === 'PUBLISH_SCHEDULER_LEASE_MS' && issue.reason === 'invalid'));
const realPublishMinimax = validateProductionConfiguration({
  ...valid,
  DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED: 'true',
  PUBLISH_SCHEDULER_ENABLED: 'true',
  DIGITAL_EMPLOYEE_VOICEOVER_MODE: 'required',
  DIGITAL_EMPLOYEE_TTS_PROVIDER: 'minimax',
  MINIMAX_API_KEY: secret('minimax'),
});
assert.equal(realPublishMinimax.ok, true);
const realPublishAutoWithPlaceholder = validateProductionConfiguration({
  ...valid,
  DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED: 'true',
  PUBLISH_SCHEDULER_ENABLED: 'true',
  DIGITAL_EMPLOYEE_VOICEOVER_MODE: 'required',
  DIGITAL_EMPLOYEE_TTS_PROVIDER: 'auto',
  MINIMAX_API_KEY: 'change-me-minimax-key',
});
assert.ok(realPublishAutoWithPlaceholder.issues.some(issue => issue.name === 'MINIMAX_API_KEY' && issue.reason === 'placeholder'));
const realPublishInvalidProvider = validateProductionConfiguration({
  ...valid,
  DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED: 'true',
  PUBLISH_SCHEDULER_ENABLED: 'true',
  DIGITAL_EMPLOYEE_VOICEOVER_MODE: 'required',
  DIGITAL_EMPLOYEE_TTS_PROVIDER: 'local-silent',
  DASHSCOPE_API_KEY: secret('dashscope-tts'),
});
assert.ok(realPublishInvalidProvider.issues.some(issue => issue.name === 'DIGITAL_EMPLOYEE_TTS_PROVIDER' && issue.reason === 'invalid'));
const realPublishWithoutScheduler = validateProductionConfiguration({
  ...valid,
  DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED: 'true',
  PUBLISH_SCHEDULER_ENABLED: 'false',
  DIGITAL_EMPLOYEE_VOICEOVER_MODE: 'required',
  DIGITAL_EMPLOYEE_TTS_PROVIDER: 'qwen',
  DASHSCOPE_API_KEY: secret('dashscope-tts'),
});
assert.ok(realPublishWithoutScheduler.issues.some(issue => issue.name === 'PUBLISH_SCHEDULER_ENABLED' && issue.reason === 'invalid'));

const previousNodeEnv = process.env.NODE_ENV;
const previousRenderSecret = process.env.RENDER_TOKEN_SECRET;
try {
  process.env.NODE_ENV = 'production';
  delete process.env.RENDER_TOKEN_SECRET;
  assert.throws(() => signRenderToken({ jobId: 'render-1' }), /RENDER_TOKEN_SECRET is invalid/);
  process.env.RENDER_TOKEN_SECRET = secret('runtime-render');
  const signed = signRenderToken({ jobId: 'render-1' });
  assert.equal(verifyRenderToken(signed.token)?.jobId, 'render-1');
} finally {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
  if (previousRenderSecret === undefined) delete process.env.RENDER_TOKEN_SECRET; else process.env.RENDER_TOKEN_SECRET = previousRenderSecret;
}

console.log('production fail-fast, LLM/TTS, secret, placeholder, reuse, override, and webhook validation passed');
