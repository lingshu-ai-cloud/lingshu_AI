import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createRuntimeReadinessProbe,
  digitalHumanProviderReadiness,
  digitalHumanQualityRuntimeReadiness,
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
    'OBJECT_STORAGE_DRIVER=cos 或 LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL（公网 HTTPS）',
  ]);
  const sentenceReady = sentenceReplicationReadiness({
    SEEDANCE_SENTENCE_ENABLED: 'true', SEEDANCE_API_KEY: 'configured-for-test', SEEDANCE_MODEL: 'seedance-test',
    OBJECT_STORAGE_DRIVER: 'cos',
    OBJECT_STORAGE_ENDPOINT: 'https://object.example.test', OBJECT_STORAGE_ACCESS_KEY_ID: 'configured-for-test', OBJECT_STORAGE_SECRET_ACCESS_KEY: 'configured-for-test', OBJECT_STORAGE_BUCKET_NAME: 'assets',
  });
  assert.deepEqual(sentenceReady, { ready: true, missing: [] });
  const localStorageWithCosCredentials = sentenceReplicationReadiness({
    SEEDANCE_SENTENCE_ENABLED: 'true', SEEDANCE_API_KEY: 'configured-for-test', SEEDANCE_MODEL: 'seedance-test',
    OBJECT_STORAGE_DRIVER: 'local', COS_REGION: 'ap-shanghai', COS_BUCKET: 'assets',
    COS_SECRET_ID: 'configured-for-test', COS_SECRET_KEY: 'configured-for-test',
  });
  assert.deepEqual(localStorageWithCosCredentials.missing, [
    'OBJECT_STORAGE_DRIVER=cos 或 LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL（公网 HTTPS）',
  ]);
  const semanticBlocked = sentenceReplicationReadiness({
    SEEDANCE_SENTENCE_ENABLED: 'true', SEEDANCE_API_KEY: 'configured-for-test', SEEDANCE_MODEL: 'seedance-test', DIGITAL_HUMAN_SEMANTIC_QA_ENABLED: 'true',
    OBJECT_STORAGE_DRIVER: 'cos',
    OBJECT_STORAGE_ENDPOINT: 'https://object.example.test', OBJECT_STORAGE_ACCESS_KEY_ID: 'configured-for-test', OBJECT_STORAGE_SECRET_ACCESS_KEY: 'configured-for-test', OBJECT_STORAGE_BUCKET_NAME: 'assets',
  });
  assert.deepEqual(semanticBlocked.missing, ['DASHSCOPE_API_KEY 或 DASHSCOPE_API_KEY_FILE（独立语义质检）', 'QWEN_DIGITAL_HUMAN_QA_MODEL']);
  assert.deepEqual(sentenceReplicationReadiness({
    SEEDANCE_SENTENCE_ENABLED: 'true', SEEDANCE_API_KEY: 'configured-for-test', SEEDANCE_MODEL: 'seedance-test', DIGITAL_HUMAN_SEMANTIC_QA_ENABLED: 'true', DASHSCOPE_API_KEY_FILE: '/secret/key', QWEN_DIGITAL_HUMAN_QA_MODEL: 'qwen-test',
    OBJECT_STORAGE_DRIVER: 'cos',
    OBJECT_STORAGE_ENDPOINT: 'https://object.example.test', OBJECT_STORAGE_ACCESS_KEY_ID: 'configured-for-test', OBJECT_STORAGE_SECRET_ACCESS_KEY: 'configured-for-test', OBJECT_STORAGE_BUCKET_NAME: 'assets',
  }), { ready: true, missing: [] });
  assert.deepEqual(sentenceReplicationReadiness({
    SEEDANCE_SENTENCE_ENABLED: 'true', SEEDANCE_API_KEY: 'configured-for-test', SEEDANCE_MODEL: 'seedance-test',
    OBJECT_STORAGE_DRIVER: 'cos',
    COS_REGION: 'ap-shanghai', COS_BUCKET: 'assets', COS_SECRET_ID: 'configured-for-test', COS_SECRET_KEY: 'configured-for-test',
  }), { ready: true, missing: [] });
  assert.deepEqual(sentenceReplicationReadiness({
    SEEDANCE_SENTENCE_ENABLED: 'true', SEEDANCE_API_KEY: 'configured-for-test', SEEDANCE_MODEL: 'seedance-test',
    OBJECT_STORAGE_DRIVER: 'local', LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL: 'https://assets.example.test',
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

  const qualityRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'digital-human-quality-ready-'));
  const fakePython = path.join(qualityRoot, 'python');
  const syncnet = path.join(qualityRoot, 'syncnet');
  fs.mkdirSync(path.join(syncnet, 'data'), { recursive: true });
  for (const file of ['data/syncnet_v2.model', 'run_pipeline.py', 'run_syncnet.py']) fs.writeFileSync(path.join(syncnet, file), 'fixture');
  fs.writeFileSync(fakePython, '#!/bin/sh\necho \'{"ready":true}\'\n', { mode: 0o755 });
  const qualityReady = await digitalHumanQualityRuntimeReadiness({
    DIGITAL_HUMAN_VISUAL_QA_PYTHON: fakePython,
    DIGITAL_HUMAN_SEMANTIC_QA_ENABLED: 'true', DASHSCOPE_API_KEY: 'configured-for-test', QWEN_DIGITAL_HUMAN_QA_MODEL: 'qwen-test',
    DIGITAL_HUMAN_SYNCNET_QA_ENABLED: 'true', DIGITAL_HUMAN_SYNCNET_QA_PYTHON: fakePython, DIGITAL_HUMAN_SYNCNET_DIR: syncnet,
  });
  assert.equal(qualityReady.localVisual.ready, true);
  assert.equal(qualityReady.lipSync.ready, true);
  assert.equal(qualityReady.autoRelease.ready, true);
  fs.rmSync(qualityRoot, { recursive: true, force: true });

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
    checkDigitalHumanQuality: async () => ({
      localVisual: { ready: false, reason: 'fixture' }, semantic: { ready: false }, lipSync: { ready: false }, autoRelease: { ready: false, reason: 'fixture' },
    }),
  });
  assert.equal(degraded.status, 'degraded');
  assert.deepEqual(degraded.issues, ['schema_bootstrap_failed', 'pocketbase_unavailable_or_unmigrated:offline']);

  const workerMissing = await runtimeReadiness({
    role: 'web',
    checkPocketBase: async () => {},
    checkSocialOperating: async () => ({
      queueBacklog: { count: 3, oldestAt: '2026-09-26T00:00:00.000Z' },
      unknownReceipts: { count: 1 },
      exhaustedBudgets: { count: 1 },
      invalidAuthorizations: { count: 1 },
      worker: { ready: false, source: 'heartbeat', state: 'missing', lastSeenAt: null },
    }),
  });
  assert.equal(workerMissing.status, 'degraded');
  assert.deepEqual(workerMissing.issues, ['social_operating_worker_unready:heartbeat:missing']);
  assert.equal(workerMissing.socialOperating?.queueBacklog.count, 3);

  const { classifyWorkerHeartbeat } = await import('./socialOperatingObservability.js');
  const heartbeatNow = new Date('2026-10-04T10:00:00.000Z');
  assert.deepEqual(classifyWorkerHeartbeat('2026-10-04T09:58:00.000Z', heartbeatNow, 60_000), { ready: false, state: 'stale' });
  assert.deepEqual(classifyWorkerHeartbeat('2026-10-04T09:59:30.000Z', heartbeatNow, 60_000), { ready: true, state: 'ready' });

  const workerReady = await runtimeReadiness({
    role: 'all',
    checkPocketBase: async () => {},
    checkSocialOperating: async () => ({
      queueBacklog: { count: 0, oldestAt: null },
      unknownReceipts: { count: 0 },
      exhaustedBudgets: { count: 0 },
      invalidAuthorizations: { count: 0 },
      worker: { ready: true, source: 'local', state: 'ready', lastSeenAt: '2026-09-26T00:00:00.000Z' },
    }),
  });
  assert.equal(workerReady.status, 'ready');

  process.env.READINESS_CACHE_TTL_MS = '250';
  assert.equal(readinessCacheTtlMs(), 250);
  let now = 1_000;
  let checks = 0;
  let qualityChecks = 0;
  const probe = createRuntimeReadinessProbe({
    role: 'web',
    now: () => now,
    checkDigitalHumanQuality: async () => {
      qualityChecks += 1;
      return { localVisual: { ready: true }, semantic: { ready: false }, lipSync: { ready: false }, autoRelease: { ready: false } };
    },
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
  assert.equal(qualityChecks, 1, 'immutable QA runtime self-check must run only once per process');
  console.log('runtime readiness contract passed');
} finally {
  for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
  Object.assign(process.env, previous);
}
