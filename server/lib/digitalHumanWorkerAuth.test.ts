import assert from 'node:assert/strict';
import {
  authenticateDigitalHumanWorker,
  workerPrincipalAllowsTenant,
  workerPrincipalAllowsWorker,
} from './digitalHumanWorkerAuth.js';

const legacy = authenticateDigitalHumanWorker('Bearer dev-key', { DIGITAL_HUMAN_WORKER_KEY: 'dev-key' });
assert.equal(legacy?.legacy, true);
assert.equal(authenticateDigitalHumanWorker('Bearer wrong', { DIGITAL_HUMAN_WORKER_KEY: 'dev-key' }), null);
assert.equal(authenticateDigitalHumanWorker('Bearer dev-key', {
  NODE_ENV: 'production', DIGITAL_HUMAN_WORKER_KEY: 'dev-key',
}), null, 'production must reject the unscoped legacy key by default');
assert.equal(authenticateDigitalHumanWorker('Bearer dev-key', {
  NODE_ENV: 'production', DIGITAL_HUMAN_WORKER_KEY: 'dev-key',
  DIGITAL_HUMAN_ALLOW_LEGACY_WORKER_KEY_BREAK_GLASS: 'true',
})?.legacy, true, 'an explicit production break-glass flag is required for legacy credentials');

const registry = JSON.stringify([
  { id: 'gpu-a-key', workerId: 'gpu-a', key: 'secret-a', tenantScopes: ['tenant-a'] },
  { id: 'gpu-b-key', workerId: 'gpu-b', key: 'secret-b', tenants: ['*'] },
  { id: 'revoked', workerId: 'gpu-old', key: 'old-secret', revoked: true },
]);
const gpuA = authenticateDigitalHumanWorker('Bearer secret-a', {
  DIGITAL_HUMAN_WORKER_KEY: 'dev-key',
  DIGITAL_HUMAN_WORKER_CREDENTIALS_JSON: registry,
});
assert.equal(gpuA?.credentialId, 'gpu-a-key');
assert.equal(workerPrincipalAllowsWorker(gpuA!, 'gpu-a'), true);
assert.equal(workerPrincipalAllowsWorker(gpuA!, 'gpu-b'), false);
assert.equal(workerPrincipalAllowsTenant(gpuA!, 'tenant-a'), true);
assert.equal(workerPrincipalAllowsTenant(gpuA!, 'tenant-b'), false);

const gpuB = authenticateDigitalHumanWorker('Bearer secret-b', { DIGITAL_HUMAN_WORKER_CREDENTIALS_JSON: registry });
assert.equal(workerPrincipalAllowsTenant(gpuB!, 'any-tenant'), true);
assert.equal(authenticateDigitalHumanWorker('Bearer old-secret', { DIGITAL_HUMAN_WORKER_CREDENTIALS_JSON: registry }), null);
assert.equal(authenticateDigitalHumanWorker('Bearer dev-key', {
  DIGITAL_HUMAN_WORKER_KEY: 'dev-key',
  DIGITAL_HUMAN_WORKER_CREDENTIALS_JSON: '{broken',
}), null, 'a configured malformed registry must not fall back to the legacy key');
assert.equal(authenticateDigitalHumanWorker('Basic secret-a', { DIGITAL_HUMAN_WORKER_CREDENTIALS_JSON: registry }), null);
assert.equal(authenticateDigitalHumanWorker('Bearer secret-a', {
  NODE_ENV: 'production',
  DIGITAL_HUMAN_WORKER_CREDENTIALS_JSON: registry,
})?.credentialId, 'gpu-a-key', 'production accepts a unique scoped credential');
assert.equal(authenticateDigitalHumanWorker('Bearer duplicate', {
  DIGITAL_HUMAN_WORKER_CREDENTIALS_JSON: JSON.stringify([
    { id: 'one', key: 'duplicate' },
    { id: 'two', key: 'duplicate' },
  ]),
}), null, 'ambiguous duplicate device secrets must fail closed');

console.log('digital human worker auth tests passed');
