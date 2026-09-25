import assert from 'node:assert/strict';
import {
  createRuntimeReadinessProbe,
  digitalHumanProviderReadiness,
  readinessCacheTtlMs,
  requiredCapabilityIssues,
  runtimeCapabilities,
  runtimeReadiness,
  sentenceReplicationReadiness,
} from './readiness.js';

const previous = { ...process.env };
try {
  process.env.NODE_ENV = 'production';
  process.env.OVERSEAS_LLM_BACKEND = 'qwen';
  delete process.env.GEMINI_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
  process.env.REQUIRED_CAPABILITIES = 'text_generation,quote,unknown';
  const unavailable = runtimeCapabilities('web');
  assert.equal(unavailable.text_generation.ready, false);
  assert.equal(unavailable.qwen_generation.ready, false);
  assert.deepEqual(requiredCapabilityIssues(unavailable), [
    'capability_unavailable:text_generation:selected_text_model_key_missing:qwen',
    'capability_unavailable:quote:quote_skill_not_enabled',
    'unknown_required_capability:unknown',
  ]);

  const sentenceBlocked = sentenceReplicationReadiness({
    SEEDANCE_SENTENCE_ENABLED: 'false',
    R2_BUCKET_NAME: 'assets',
  });
  assert.equal(sentenceBlocked.ready, false);
  assert.deepEqual(sentenceBlocked.missing, [
    'SEEDANCE_SENTENCE_ENABLED=true', 'SEEDANCE_API_KEY', 'SEEDANCE_MODEL', 'SEEDREAM_API_KEY 或 SEEDANCE_API_KEY（Seedream 目标人物首帧生成）',
    '对象存储 endpoint/account', '对象存储 access key', '对象存储 secret key',
  ]);
  const sentenceReady = sentenceReplicationReadiness({
    SEEDANCE_SENTENCE_ENABLED: 'true', SEEDANCE_API_KEY: 'configured-for-test', SEEDANCE_MODEL: 'seedance-test',
    OBJECT_STORAGE_ENDPOINT: 'https://object.example.test', OBJECT_STORAGE_ACCESS_KEY_ID: 'configured-for-test', OBJECT_STORAGE_SECRET_ACCESS_KEY: 'configured-for-test', OBJECT_STORAGE_BUCKET_NAME: 'assets',
  });
  assert.deepEqual(sentenceReady, { ready: true, missing: [] });
  const semanticBlocked = sentenceReplicationReadiness({
    SEEDANCE_SENTENCE_ENABLED: 'true', SEEDANCE_API_KEY: 'configured-for-test', SEEDANCE_MODEL: 'seedance-test', DIGITAL_HUMAN_SEMANTIC_QA_ENABLED: 'true',
    OBJECT_STORAGE_ENDPOINT: 'https://object.example.test', OBJECT_STORAGE_ACCESS_KEY_ID: 'configured-for-test', OBJECT_STORAGE_SECRET_ACCESS_KEY: 'configured-for-test', OBJECT_STORAGE_BUCKET_NAME: 'assets',
  });
  assert.deepEqual(semanticBlocked.missing, ['DASHSCOPE_API_KEY 或 DASHSCOPE_API_KEY_FILE（独立语义质检）', 'QWEN_DIGITAL_HUMAN_QA_MODEL']);
  assert.deepEqual(sentenceReplicationReadiness({
    SEEDANCE_SENTENCE_ENABLED: 'true', SEEDANCE_API_KEY: 'configured-for-test', SEEDANCE_MODEL: 'seedance-test', DIGITAL_HUMAN_SEMANTIC_QA_ENABLED: 'true', DASHSCOPE_API_KEY_FILE: '/secret/key', QWEN_DIGITAL_HUMAN_QA_MODEL: 'qwen-test',
    OBJECT_STORAGE_ENDPOINT: 'https://object.example.test', OBJECT_STORAGE_ACCESS_KEY_ID: 'configured-for-test', OBJECT_STORAGE_SECRET_ACCESS_KEY: 'configured-for-test', OBJECT_STORAGE_BUCKET_NAME: 'assets',
  }), { ready: true, missing: [] });
  assert.deepEqual(sentenceReplicationReadiness({
    SEEDANCE_SENTENCE_ENABLED: 'true', SEEDANCE_API_KEY: 'configured-for-test', SEEDANCE_MODEL: 'seedance-test',
    COS_REGION: 'ap-shanghai', COS_BUCKET: 'assets', COS_SECRET_ID: 'configured-for-test', COS_SECRET_KEY: 'configured-for-test',
  }), { ready: true, missing: [] });

  const providerBlocked = digitalHumanProviderReadiness({
    RUNWAY_ACT_TWO_ENABLED: 'true',
    RUNWAYML_API_SECRET: 'configured-for-test',
  });
  assert.equal(providerBlocked.runwayActTwo.ready, false);
  assert.match(providerBlocked.runwayActTwo.reason || '', /object_storage/);
  assert.match(providerBlocked.runwayActTwo.reason || '', /RUNWAY_ACT_TWO_CNY_PER_CREDIT/);
  assert.doesNotMatch(providerBlocked.runwayActTwo.reason || '', /configured-for-test/,
    'provider readiness must never expose secret values');
  const providerReady = digitalHumanProviderReadiness({
    RUNWAY_ACT_TWO_ENABLED: 'true', RUNWAYML_API_SECRET: 'configured-for-test',
    OBJECT_STORAGE_ENDPOINT: 'https://object.example.test', OBJECT_STORAGE_ACCESS_KEY_ID: 'configured-for-test',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'configured-for-test', OBJECT_STORAGE_BUCKET_NAME: 'assets',
    RUNWAY_ACT_TWO_CNY_PER_CREDIT: '0.1', RUNWAY_ACT_TWO_ESTIMATED_CNY_PER_SECOND: '1',
    DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT: '30', DIGITAL_HUMAN_REFERENCE_MONTHLY_BUDGET_CNY: '300',
  });
  assert.deepEqual(providerReady.runwayActTwo, { ready: true });
  assert.equal(providerReady.heygen.ready, false, 'Runway readiness must be independent of HeyGen');

  delete process.env.HEYGEN_GENERATION_ENABLED;
  delete process.env.HEYGEN_API_KEY;
  process.env.RUNWAY_ACT_TWO_ENABLED = 'true';
  process.env.RUNWAYML_API_SECRET = 'configured-for-test';
  process.env.OBJECT_STORAGE_ENDPOINT = 'https://object.example.test';
  process.env.OBJECT_STORAGE_ACCESS_KEY_ID = 'configured-for-test';
  process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = 'configured-for-test';
  process.env.OBJECT_STORAGE_BUCKET_NAME = 'assets';
  process.env.RUNWAY_ACT_TWO_CNY_PER_CREDIT = '0.1';
  process.env.RUNWAY_ACT_TWO_ESTIMATED_CNY_PER_SECOND = '1';
  process.env.DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT = '30';
  process.env.DIGITAL_HUMAN_REFERENCE_MONTHLY_BUDGET_CNY = '300';
  assert.equal(runtimeCapabilities('web').digital_human.ready, true,
    'a fully configured Runway Act-Two adapter must satisfy digital-human readiness');

  process.env.GEMINI_API_KEY = 'configured-for-test';
  assert.equal(runtimeCapabilities('web').text_generation.ready, false, 'an unrelated provider key must not satisfy the selected backend');
  process.env.OVERSEAS_LLM_BACKEND = 'gemini';
  process.env.QUOTE_SKILL_ENABLED = 'true';
  process.env.REQUIRED_CAPABILITIES = 'text_generation,quote';
  const ready = await runtimeReadiness({ role: 'web', checkPocketBase: async () => {} });
  assert.equal(ready.status, 'ready');

  process.env.OVERSEAS_LLM_BACKEND = 'qwen';
  process.env.DASHSCOPE_API_KEY = 'configured-for-test';
  assert.equal(runtimeCapabilities('web').text_generation.ready, true, 'Qwen readiness requires the DashScope key');
  assert.equal(runtimeCapabilities('web').qwen_generation.ready, true, 'core Qwen-only workflows require the DashScope key');
  process.env.OVERSEAS_LLM_BACKEND = 'unsupported-provider';
  assert.deepEqual(runtimeCapabilities('web').text_generation, {
    ready: false,
    reason: 'unsupported_text_model_backend:unsupported-provider',
  });
  process.env.OVERSEAS_LLM_BACKEND = 'gemini';

  const degraded = await runtimeReadiness({
    role: 'web',
    startupIssues: ['schema_bootstrap_failed'],
    checkPocketBase: async () => { throw new Error('offline'); },
  });
  assert.equal(degraded.status, 'degraded');
  assert.deepEqual(degraded.issues, ['schema_bootstrap_failed', 'pocketbase_unavailable_or_unmigrated:offline']);

  process.env.READINESS_CACHE_TTL_MS = '250';
  assert.equal(readinessCacheTtlMs(), 250);
  let now = 1_000;
  let checks = 0;
  const probe = createRuntimeReadinessProbe({
    role: 'web',
    now: () => now,
    checkPocketBase: async () => {
      checks += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
    },
  });
  const reports = await Promise.all(Array.from({ length: 50 }, () => probe()));
  assert.ok(reports.every(report => report.status === 'ready'));
  assert.equal(checks, 1, 'concurrent readiness probes must share one dependency check');
  await probe();
  assert.equal(checks, 1, 'readiness result must be briefly cached');
  now += 251;
  await probe();
  assert.equal(checks, 2, 'readiness must be revalidated after the short cache expires');
  console.log('runtime readiness contract passed');
} finally {
  for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
  Object.assign(process.env, previous);
}
