import assert from 'node:assert/strict';
import { contentExternalConnectivityPreflight, staticContentExternalPreflight } from './contentExternalPreflight.js';

const secret = 'must-never-appear';
const incomplete = staticContentExternalPreflight({ R2_BUCKET_NAME: 'assets', SEEDANCE_API_KEY: secret });
assert.equal(incomplete.ready, false);
assert.equal(incomplete.checks.objectStorage.code, 'local_object_storage_configured');
assert.equal(incomplete.checks.seedanceSentence.code, 'seedance_sentence_config_missing');
assert.equal(JSON.stringify(incomplete).includes(secret), false);

const localConfigured = staticContentExternalPreflight({
  OBJECT_STORAGE_DRIVER: 'local', SEEDANCE_SENTENCE_ENABLED: 'true', SEEDANCE_API_KEY: secret, SEEDANCE_MODEL: 'seedance-model',
});
assert.equal(localConfigured.ready, true);
assert.equal(localConfigured.checks.objectStorage.code, 'local_object_storage_configured');
const localConnectivity = await contentExternalConnectivityPreflight({ env: {
  OBJECT_STORAGE_DRIVER: 'local', SEEDANCE_SENTENCE_ENABLED: 'true', SEEDANCE_API_KEY: secret, SEEDANCE_MODEL: 'seedance-model',
}, headBucket: async () => { throw new Error('local mode must not call cloud storage'); }, listSeedanceModels: async () => ['seedance-model'] });
assert.equal(localConnectivity.ready, true);
assert.equal(localConnectivity.checks.objectStorage.code, 'local_object_storage_available');

const invalidDriver = staticContentExternalPreflight({ OBJECT_STORAGE_DRIVER: 'other' });
assert.equal(invalidDriver.checks.objectStorage.code, 'object_storage_driver_invalid');

const configured = {
  OBJECT_STORAGE_DRIVER: 'cos',
  OBJECT_STORAGE_ENDPOINT: 'https://objects.example.test',
  OBJECT_STORAGE_ACCESS_KEY_ID: 'access',
  OBJECT_STORAGE_SECRET_ACCESS_KEY: secret,
  OBJECT_STORAGE_BUCKET_NAME: 'assets',
  SEEDANCE_VIDEO_ENABLED: 'true',
  SEEDANCE_SENTENCE_ENABLED: 'true',
  SEEDANCE_API_KEY: secret,
  SEEDANCE_MODEL: 'seedance-model',
};
const sentenceDoesNotDependOnGenericVideoSwitch = staticContentExternalPreflight({
  ...configured,
  SEEDANCE_VIDEO_ENABLED: 'false',
});
assert.equal(sentenceDoesNotDependOnGenericVideoSwitch.checks.seedanceSentence.state, 'ready');
const semanticBlocked = staticContentExternalPreflight({ ...configured, DIGITAL_HUMAN_SEMANTIC_QA_ENABLED: 'true' });
assert.equal(semanticBlocked.checks.seedanceSentence.state, 'blocked');
assert.match(semanticBlocked.checks.seedanceSentence.detail, /DASHSCOPE_API_KEY_or_DASHSCOPE_API_KEY_FILE/);
assert.match(semanticBlocked.checks.seedanceSentence.detail, /QWEN_DIGITAL_HUMAN_QA_MODEL/);
const semanticConfigured = staticContentExternalPreflight({ ...configured, DIGITAL_HUMAN_SEMANTIC_QA_ENABLED: 'true', DASHSCOPE_API_KEY: secret, QWEN_DIGITAL_HUMAN_QA_MODEL: 'qwen-test' });
assert.equal(semanticConfigured.checks.seedanceSentence.state, 'ready');

const cosConfigured = staticContentExternalPreflight({
  OBJECT_STORAGE_DRIVER: 'cos',
  COS_REGION: 'ap-shanghai', COS_BUCKET: 'assets', COS_SECRET_ID: 'access', COS_SECRET_KEY: secret,
  SEEDANCE_SENTENCE_ENABLED: 'true', SEEDANCE_API_KEY: secret, SEEDANCE_MODEL: 'seedance-model',
});
assert.equal(cosConfigured.ready, true);
assert.equal(cosConfigured.checks.objectStorage.code, 'object_storage_configured');
assert.equal(JSON.stringify(cosConfigured).includes(secret), false);

const ready = await contentExternalConnectivityPreflight({
  env: configured,
  headBucket: async config => {
    assert.equal(config.bucket, 'assets');
    assert.equal(config.secretAccessKey, secret);
  },
  listSeedanceModels: async config => {
    assert.equal(config.apiKey, secret);
    return ['seedance-model'];
  },
});
assert.equal(ready.ready, true);
assert.equal(JSON.stringify(ready).includes(secret), false);

const rejected = await contentExternalConnectivityPreflight({
  env: configured,
  headBucket: async () => { throw Object.assign(new Error('server included secret: must-never-appear'), { $metadata: { httpStatusCode: 403 } }); },
  listSeedanceModels: async () => [],
});
assert.equal(rejected.ready, false);
assert.deepEqual(rejected.checks.objectStorage, { state: 'blocked', code: 'object_storage_unreachable', detail: 'provider_http_403' });
assert.equal(rejected.checks.seedanceSentence.detail, 'provider_error_ConfiguredModelNotListed');
assert.equal(JSON.stringify(rejected).includes(secret), false);
console.log('content external preflight passed');
