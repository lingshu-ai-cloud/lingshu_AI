import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContentAgentReadiness } from './contentAgentReadiness';

const now = new Date('2026-09-25T08:00:00.000Z');
const noFiles = () => false;

test('readiness fails closed without configuration and performs no network checks', () => {
  const report = buildContentAgentReadiness({ env: {}, now, fileExists: noFiles });
  assert.equal(report.networkChecksPerformed, false);
  assert.equal(report.dependencies.length, 8);
  assert.deepEqual(report.summary.productionReady, []);
  assert.ok(report.dependencies.every(item => item.productionReady === false));
  assert.equal(report.dependencies.find(item => item.id === 'authorized_shared_inventory')?.state, 'unavailable');
});

test('Seedance key is recognized as configuration but never as operational proof', () => {
  const report = buildContentAgentReadiness({
    env: {
      SEEDANCE_API_KEY: 'shared-config-secret',
      SEEDANCE_VIDEO_ENABLED: 'true',
      SEEDANCE_MODEL: 'doubao-seedance-2-0-fast-260128',
    },
    now,
    fileExists: noFiles,
  });
  const seedance = report.dependencies.find(item => item.id === 'seedance')!;
  assert.equal(seedance.credentialConfigured, true);
  assert.equal(seedance.configurationReady, true);
  assert.equal(seedance.state, 'configuration_ready');
  assert.equal(seedance.operationallyVerified, false);
  assert.equal(seedance.productionReady, false);
  assert.match(seedance.notes.join(' '), /不代表.*任务提交.*产物下载.*质量验收/);
});

test('reference Seedance remains blocked until object storage configuration is complete', () => {
  const env = {
    SEEDANCE_API_KEY: 'shared-config-secret',
    SEEDANCE_REFERENCE_ENABLED: 'true',
    SEEDANCE_MODEL: 'seedance-endpoint',
  };
  const blocked = buildContentAgentReadiness({ env, now, fileExists: noFiles });
  assert.equal(blocked.dependencies.find(item => item.id === 'seedance')?.configurationReady, false);
  assert.ok(blocked.dependencies.find(item => item.id === 'seedance')?.missingRequirements.includes('参考/逐句模式所需对象存储'));

  const configured = buildContentAgentReadiness({
    env: {
      ...env,
      OBJECT_STORAGE_ENDPOINT: 'https://objects.example',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'access',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret',
      OBJECT_STORAGE_BUCKET_NAME: 'bucket',
    },
    now,
    fileExists: noFiles,
  });
  assert.equal(configured.dependencies.find(item => item.id === 'seedance')?.configurationReady, true);
  assert.equal(configured.dependencies.find(item => item.id === 'seedance')?.productionReady, false);
});

test('explicit verification evidence promotes a configuration-ready dependency', () => {
  const report = buildContentAgentReadiness({
    env: { HEYGEN_API_KEY: 'secret', HEYGEN_GENERATION_ENABLED: 'true', SOCIAL_CONTENT_HEYGEN_ENABLED: 'true',
      OBJECT_STORAGE_ENDPOINT: 'https://objects.example', OBJECT_STORAGE_ACCESS_KEY_ID: 'access',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret', OBJECT_STORAGE_BUCKET_NAME: 'bucket',
      STUDIO_PAID_BUDGET_CNY: '100', STUDIO_PAID_OPENING_USED_CNY: '1', STUDIO_HEYGEN_RESERVE_CNY: '2' },
    now,
    fileExists: noFiles,
    verifications: {
      heygen: {
        status: 'passed',
        checkedAt: '2026-09-25T07:00:00.000Z',
        evidenceRef: 'contract-run:heygen-42',
        reason: null,
      },
    },
  });
  const heygen = report.dependencies.find(item => item.id === 'heygen')!;
  assert.equal(heygen.configurationReady, true);
  assert.equal(heygen.operationallyVerified, true);
  assert.equal(heygen.productionReady, true);
  assert.equal(heygen.state, 'verified');
});

test('HeyGen social bridge remains blocked without storage and a funded admission budget', () => {
  const report = buildContentAgentReadiness({ env: {
    HEYGEN_API_KEY: 'secret', HEYGEN_GENERATION_ENABLED: 'true', SOCIAL_CONTENT_HEYGEN_ENABLED: 'true',
  }, now, fileExists: noFiles });
  const heygen = report.dependencies.find(item => item.id === 'heygen')!;
  assert.equal(heygen.configurationReady, false);
  assert.ok(heygen.missingRequirements.includes('对象存储'));
  assert.match(heygen.missingRequirements.join(' '), /STUDIO_PAID_BUDGET_CNY/);
});

test('Runway requires both budget limits and rejects malformed output host suffixes', () => {
  const common = {
    RUNWAYML_API_SECRET: 'secret', RUNWAY_ACT_TWO_ENABLED: 'true', RUNWAY_ACT_TWO_CNY_PER_CREDIT: '0.1',
    RUNWAY_ACT_TWO_ESTIMATED_CNY_PER_SECOND: '1', DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT: '30',
    DIGITAL_HUMAN_REFERENCE_MONTHLY_BUDGET_CNY: '300', OBJECT_STORAGE_ENDPOINT: 'https://objects.example',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'access', OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret', OBJECT_STORAGE_BUCKET_NAME: 'bucket',
  };
  const ready = buildContentAgentReadiness({ env: common, now, fileExists: noFiles }).dependencies.find(item => item.id === 'runway')!;
  assert.equal(ready.configurationReady, true);
  assert.match(ready.notes.join(' '), /CloudFront/);
  const invalid = buildContentAgentReadiness({ env: { ...common, RUNWAY_OUTPUT_HOST_SUFFIXES: 'https://unsafe.example/path' }, now, fileExists: noFiles })
    .dependencies.find(item => item.id === 'runway')!;
  assert.equal(invalid.configurationReady, false);
  assert.match(invalid.missingRequirements.join(' '), /无效域名/);
});

test('shared inventory requires tenant-filtered items with authorization references', () => {
  const report = buildContentAgentReadiness({
    env: {}, now, fileExists: noFiles,
    authorizedSharedInventory: [
      { id: 'missing-authorization' },
      { id: 'disabled', authorizationRef: 'license:2', usable: false },
      { id: 'licensed', authorizationRef: 'license:3', usable: true },
    ],
  });
  const inventory = report.dependencies.find(item => item.id === 'authorized_shared_inventory')!;
  assert.equal(inventory.configurationReady, true);
  assert.equal(inventory.productionReady, true);
  assert.equal(inventory.verification.evidenceRef, 'authorized_shared_inventory_snapshot');
  assert.match(inventory.notes[0]!, /3 条.*1 条/);
});

test('a failed check stays degraded even when credentials and switches are present', () => {
  const report = buildContentAgentReadiness({
    env: { APIFY_TOKEN: 'secret', APIFY_TIKTOK_CRAWL_FALLBACK_ENABLED: '1' },
    now,
    fileExists: noFiles,
    verifications: {
      apify: { status: 'failed', checkedAt: now.toISOString(), evidenceRef: 'health:apify', reason: 'permission denied' },
    },
  });
  const apify = report.dependencies.find(item => item.id === 'apify')!;
  assert.equal(apify.configurationReady, true);
  assert.equal(apify.productionReady, false);
  assert.equal(apify.state, 'degraded');
});
