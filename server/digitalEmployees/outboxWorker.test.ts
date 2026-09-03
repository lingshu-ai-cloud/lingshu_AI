import assert from 'node:assert/strict';
import { outboxRetryDelayMs, outboxWebhookConfig, signOutboxPayload, signatureMatches } from './outboxWorker.js';

assert.equal(outboxRetryDelayMs(1), 1_000);
assert.equal(outboxRetryDelayMs(2), 2_000);
assert.equal(outboxRetryDelayMs(20), 15 * 60_000);

const signature = signOutboxPayload('{"event":1}', 'secret');
assert.match(signature, /^sha256=[a-f0-9]{64}$/);
assert.equal(signatureMatches('{"event":1}', 'secret', signature), true);
assert.equal(signatureMatches('{"event":2}', 'secret', signature), false);

assert.deepEqual(outboxWebhookConfig({}), { mode: 'internal', timeoutMs: 5_000 });
assert.throws(() => outboxWebhookConfig({ NODE_ENV: 'production', DIGITAL_EMPLOYEE_EVENT_WEBHOOK_URL: 'http://example.test', DIGITAL_EMPLOYEE_EVENT_WEBHOOK_SECRET: 'secret' }), /https_required/);
assert.throws(() => outboxWebhookConfig({ DIGITAL_EMPLOYEE_EVENT_WEBHOOK_URL: 'https://example.test' }), /secret_required/);
assert.equal(outboxWebhookConfig({ DIGITAL_EMPLOYEE_EVENT_WEBHOOK_URL: 'https://example.test/hook', DIGITAL_EMPLOYEE_EVENT_WEBHOOK_SECRET: 'secret' }).mode, 'webhook');
assert.throws(() => outboxWebhookConfig({ NODE_ENV: 'production', DIGITAL_EMPLOYEE_EVENT_WEBHOOK_URL: 'https://events.example.test/hook', DIGITAL_EMPLOYEE_EVENT_WEBHOOK_SECRET: 'secret' }), /allowed_origins_required/);
assert.throws(() => outboxWebhookConfig({ NODE_ENV: 'production', DIGITAL_EMPLOYEE_EVENT_WEBHOOK_URL: 'https://events.example.test/hook', DIGITAL_EMPLOYEE_EVENT_WEBHOOK_ALLOWED_ORIGINS: 'https://other.example.test', DIGITAL_EMPLOYEE_EVENT_WEBHOOK_SECRET: 'secret' }), /origin_not_allowed/);
assert.throws(() => outboxWebhookConfig({ NODE_ENV: 'production', DIGITAL_EMPLOYEE_EVENT_WEBHOOK_URL: 'https://127.0.0.1/hook', DIGITAL_EMPLOYEE_EVENT_WEBHOOK_ALLOWED_ORIGINS: 'https://127.0.0.1', DIGITAL_EMPLOYEE_EVENT_WEBHOOK_SECRET: 'secret' }), /private_host_forbidden/);
assert.throws(() => outboxWebhookConfig({ DIGITAL_EMPLOYEE_EVENT_WEBHOOK_URL: 'http://10.0.0.8/hook', DIGITAL_EMPLOYEE_EVENT_WEBHOOK_SECRET: 'secret' }), /private_host_forbidden/);
assert.equal(outboxWebhookConfig({ NODE_ENV: 'production', DIGITAL_EMPLOYEE_EVENT_WEBHOOK_URL: 'https://events.example.test/hook', DIGITAL_EMPLOYEE_EVENT_WEBHOOK_ALLOWED_ORIGINS: 'https://events.example.test', DIGITAL_EMPLOYEE_EVENT_WEBHOOK_SECRET: 'secret' }).mode, 'webhook');

console.log('digital employee outbox worker tests passed');
