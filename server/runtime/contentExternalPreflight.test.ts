import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contentExternalConnectivityPreflight, staticContentExternalPreflight } from './contentExternalPreflight.js';

const secret = 'must-never-appear';
const incomplete = staticContentExternalPreflight({ R2_BUCKET_NAME: 'assets', SEEDANCE_API_KEY: secret });
assert.equal(incomplete.ready, false);
assert.equal(incomplete.checks.objectStorage.code, 'local_object_storage_configured');
assert.equal(incomplete.checks.seedanceSentence.code, 'seedance_sentence_config_missing');
assert.equal(incomplete.checks.avatarSourceCaptions.code, 'avatar_source_captions_config_missing');
assert.equal(JSON.stringify(incomplete).includes(secret), false);

const localConfigured = staticContentExternalPreflight({
  OBJECT_STORAGE_DRIVER: 'local', SEEDANCE_SENTENCE_ENABLED: 'true', SEEDANCE_API_KEY: secret, SEEDANCE_MODEL: 'seedance-model',
});
assert.equal(localConfigured.ready, false);
assert.equal(localConfigured.checks.objectStorage.code, 'local_object_storage_configured');
assert.match(localConfigured.checks.seedanceSentence.detail, /LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL/);
assert.match(localConfigured.checks.avatarSourceCaptions.detail, /DASHSCOPE_API_KEY/);
assert.match(localConfigured.checks.avatarSourceCaptions.detail, /LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL/);
const localConnectivity = await contentExternalConnectivityPreflight({ env: {
  OBJECT_STORAGE_DRIVER: 'local', SEEDANCE_SENTENCE_ENABLED: 'true', SEEDANCE_API_KEY: secret, SEEDANCE_MODEL: 'seedance-model',
}, headBucket: async () => { throw new Error('local mode must not call cloud storage'); }, listSeedanceModels: async () => ['seedance-model'] });
assert.equal(localConnectivity.ready, false);
assert.equal(localConnectivity.checks.objectStorage.code, 'local_object_storage_available');
const localPublic = staticContentExternalPreflight({
  OBJECT_STORAGE_DRIVER: 'local', LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL: 'https://assets.example.test',
  SEEDANCE_SENTENCE_ENABLED: 'true', SEEDANCE_API_KEY: secret, SEEDANCE_MODEL: 'seedance-model', DASHSCOPE_API_KEY: secret,
});
assert.equal(localPublic.ready, true);
const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-caption-preflight-'));
try {
  const keyFile = path.join(keyDir, 'dashscope.key');
  fs.writeFileSync(keyFile, 'test-key\n', { mode: 0o600 });
  const fileConfigured = staticContentExternalPreflight({
    OBJECT_STORAGE_DRIVER: 'local', LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL: 'https://assets.example.test',
    SEEDANCE_SENTENCE_ENABLED: 'true', SEEDANCE_API_KEY: secret, SEEDANCE_MODEL: 'seedance-model',
    DASHSCOPE_API_KEY_FILE: keyFile,
  });
  assert.equal(fileConfigured.checks.avatarSourceCaptions.state, 'ready');
} finally { fs.rmSync(keyDir, { recursive: true, force: true }); }

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
  DASHSCOPE_API_KEY: secret,
};
const sentenceDoesNotDependOnGenericVideoSwitch = staticContentExternalPreflight({
  ...configured,
  SEEDANCE_VIDEO_ENABLED: 'false',
});
assert.equal(sentenceDoesNotDependOnGenericVideoSwitch.checks.seedanceSentence.state, 'ready');
const semanticBlocked = staticContentExternalPreflight({ ...configured, DIGITAL_HUMAN_SEMANTIC_QA_ENABLED: 'true' });
assert.equal(semanticBlocked.checks.seedanceSentence.state, 'blocked');
assert.match(semanticBlocked.checks.seedanceSentence.detail, /QWEN_DIGITAL_HUMAN_QA_MODEL/);
const semanticConfigured = staticContentExternalPreflight({ ...configured, DIGITAL_HUMAN_SEMANTIC_QA_ENABLED: 'true', DASHSCOPE_API_KEY: secret, QWEN_DIGITAL_HUMAN_QA_MODEL: 'qwen-test' });
assert.equal(semanticConfigured.checks.seedanceSentence.state, 'ready');

const cosConfigured = staticContentExternalPreflight({
  OBJECT_STORAGE_DRIVER: 'cos',
  COS_REGION: 'ap-shanghai', COS_BUCKET: 'assets', COS_SECRET_ID: 'access', COS_SECRET_KEY: secret,
  SEEDANCE_SENTENCE_ENABLED: 'true', SEEDANCE_API_KEY: secret, SEEDANCE_MODEL: 'seedance-model', DASHSCOPE_API_KEY: secret,
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
