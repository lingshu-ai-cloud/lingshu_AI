import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const tenantId = 'local_tenant_customer_1b2913131e2c46deab66172228c4df0a';
const read = file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const tenantRows = (file) => read(file).filter(row => (row.tenant_id || row.tenantId) === tenantId);

test('current preview account resolves to the active GUIANFA beauty tenant', () => {
  const tenant = read('data/local-auth-tenants.json').find(row => row.id === tenantId);
  assert.ok(tenant);
  assert.equal(tenant.name, 'GUIANFA美妆供应链');
  assert.equal(tenant.industry, '美妆个护与护肤品');
  assert.equal(tenant.subscriptionStatus, 'active');
  const accounts = read('data/local-auth-accounts.json').filter(row => row.tenantId === tenantId);
  assert.ok(accounts.some(row => row.accountType === 'customer' && row.role === 'super_admin'));
});

test('current tenant contains only the intended GUIANFA product scope', () => {
  const rows = tenantRows('data/local-store/tenant_profiles.json');
  assert.equal(rows.length, 1);
  const profile = rows[0].profile;
  assert.equal(profile.company.name, 'GUIANFA美妆供应链');
  assert.equal(profile.brand.name, 'GUIANFA');
  assert.equal(profile.socialStrategy.weeklyTaskPackagePreset, 'b2b_starting');
  assert.equal(profile.products.items.length, 41);
  assert.ok(profile.products.items.every(product => product.brand === 'GUIANFA'));
  const primary = profile.products.items.find(product => product.sku === 'GUIANFA-RS-001');
  assert.equal(primary?.name, '云朵泡沫卸妆蜜');
  assert.equal(primary?.imageUrl, `/media/tenants/${tenantId}/rongshang-products/rongshang-product-01.png`);
  assert.ok(fs.existsSync(path.resolve('data', primary.imageUrl.slice(1))));
});

test('current inspiration and material inventory is present and production-safe', () => {
  const trends = tenantRows('data/local-store/trend_videos.json');
  assert.equal(trends.length, 23);
  let pinnedReferences = 0;
  for (const trend of trends) {
    const analysis = JSON.parse(trend.aiAnalysis || '{}');
    assert.ok(/^https?:\/\//.test(String(trend.sourceUrl || '')) || (trend.videoFileId && analysis.usage === 'reference_only'),
      `trend lacks source provenance: ${trend.id}`);
    if (analysis.usage === 'reference_only') {
      pinnedReferences++;
      assert.equal(analysis.mayUseInProduction, false);
      assert.match(String(analysis.contentSha256 || ''), /^[a-f0-9]{64}$/);
    }
  }
  assert.ok(pinnedReferences >= 1, 'at least one reference must be content-pinned for the production handoff');
  const materials = tenantRows('data/materials.json');
  assert.equal(materials.length, 16);
  const sourceCounts = Object.fromEntries([...new Set(materials.map(row => row.sourceType))]
    .map(source => [source, materials.filter(row => row.sourceType === source).length]));
  assert.deepEqual(sourceCounts, { third_party_pexels: 8, tiktok_reference: 7, tenant_upload: 1 });
  for (const material of materials) {
    assert.match(String(material.contentSha256 || ''), /^[a-f0-9]{64}$/);
    assert.ok(material.url.startsWith(`/media/tenants/${tenantId}/`));
    assert.ok(fs.existsSync(path.resolve('data', material.url.slice(1))), `missing material file: ${material.id}`);
  }
});

test('current plan and run use this tenant while external effects stay closed', () => {
  assert.equal(tenantRows('data/local-store/weekly_goals.json').length, 1);
  assert.equal(tenantRows('data/local-store/weekly_plans.json').length, 1);
  const runs = tenantRows('data/local-store/workflow_runs.json');
  const tasks = tenantRows('data/local-store/workflow_tasks.json');
  assert.equal(runs.length, 1);
  assert.equal(tasks.length, 4);
  assert.deepEqual(runs[0].policy_snapshot, {
    allowPaidGeneration: false,
    allowRealPublishing: false,
    allowRealCustomerMessages: false,
  });
  assert.ok(tasks.every(task => task.business_refs?.productSku === 'GUIANFA-RS-001'));
  assert.equal(tenantRows('data/local-store/social_accounts.json').length, 0);
  assert.equal(tenantRows('data/local-store/studio_projects.json').length, 0);
});
