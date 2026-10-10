import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateWeeklyProductionEnvironment } from './weeklyProductionEnvironmentReadiness.js';

const configured = {
  DATA_BACKEND: 'postgres', DATABASE_URL: 'postgres://redacted',
  QUEUE_BACKEND: 'bullmq', REDIS_URL: 'rediss://redacted',
  DISABLE_LOCAL_AUTH_FALLBACK: 'true', ENABLE_LOCAL_DEV_FALLBACK: 'false',
  META_SOCIAL_APP_ID: 'configured', META_SOCIAL_APP_SECRET: 'configured',
  INSTAGRAM_CONTENT_PUBLISH_ENABLED: 'true',
  TIKTOK_CLIENT_KEY: 'configured', TIKTOK_CLIENT_SECRET: 'configured',
  TIKTOK_DIRECT_POST_RELEASE_MODE: 'approved',
};

test('production environment readiness requires durable storage, queue and provider release gates', () => {
  const ready = evaluateWeeklyProductionEnvironment(configured, true);
  assert.equal(ready.ready, true);
  assert.equal(ready.checks.every(check => check.ready), true);
  assert.ok(ready.runtimeEvidenceRequired.includes('tenant_authenticated_scope'));

  const blocked = evaluateWeeklyProductionEnvironment({ ...configured, DATABASE_URL: '', ENABLE_LOCAL_DEV_FALLBACK: 'true' }, false);
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.checks.filter(check => !check.ready).map(check => check.reason), [
    'postgres_business_store_not_configured',
    'publication_atomic_store_unavailable',
    'production_auth_fallback_enabled',
  ]);
});

test('provider credentials without explicit platform release remain blocked', () => {
  const report = evaluateWeeklyProductionEnvironment({
    ...configured,
    INSTAGRAM_CONTENT_PUBLISH_ENABLED: 'false',
    TIKTOK_DIRECT_POST_RELEASE_MODE: 'review',
  }, true);
  assert.deepEqual(report.checks.filter(check => !check.ready).map(check => check.reason), [
    'instagram_publication_disabled',
    'tiktok_direct_post_not_approved',
  ]);
});
