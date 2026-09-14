import assert from 'node:assert/strict';
import {
  createRuntimeReadinessProbe,
  readinessCacheTtlMs,
  requiredCapabilityIssues,
  runtimeCapabilities,
  runtimeReadiness,
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
