import assert from 'node:assert/strict';
import fs from 'node:fs';

for (const file of ['deploy/make-production-env.sh', '.env.production.example']) {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /^SUBSCRIPTION_ENFORCED=false$/m, `${file} must keep the legacy subscription wall off by default`);
  assert.doesNotMatch(source, /^SUBSCRIPTION_ENFORCED=true$/m, `${file} must not block customers before purchase entitlement issuance exists`);
}

for (const file of [
  'deploy/make-production-env.sh',
  '.env.example',
  '.env.local-deploy.example',
  '.env.production.example',
  '.env.demo.example',
]) {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /^PUBLISH_SCHEDULER_ENABLED=false$/m, `${file} must make legacy external publishing opt-in`);
  assert.doesNotMatch(source, /^PUBLISH_SCHEDULER_ENABLED=true$/m, `${file} must not start external publishing implicitly`);
  assert.match(source, /^PUBLISH_SCHEDULER_LEASE_MS=\d+$/m, `${file} must document the durable publish lease`);
  assert.match(
    source,
    /^LEGACY_EXTERNAL_EFFECT_LEASE_MS=\d+$/m,
    `${file} must document the cross-process product-profile transition lease`,
  );
  assert.match(
    source,
    /^STARTER_RUN_MUTATION_LEASE_MS=\d+$/m,
    `${file} must document the cross-process Starter run mutation lease`,
  );
  for (const flag of [
    'STARTER_PUBLICATION_PACKAGE_WORKER_ENABLED',
    'STARTER_QUOTE_ARTIFACT_WORKER_ENABLED',
  ]) {
    assert.match(source, new RegExp(`^${flag}=false$`, 'm'), `${file} must make ${flag} an explicit deployment decision`);
    assert.doesNotMatch(source, new RegExp(`^${flag}=true$`, 'm'), `${file} must not start ${flag} before dependency verification`);
  }
  for (const setting of [
    'STARTER_PUBLICATION_PACKAGE_WORKER_INTERVAL_MS',
    'STARTER_PUBLICATION_PACKAGE_WORKER_LEASE_MS',
    'STARTER_QUOTE_ARTIFACT_WORKER_INTERVAL_MS',
    'STARTER_QUOTE_ARTIFACT_WORKER_MAX_DRAFTS',
    'STARTER_QUOTE_ARTIFACT_WORKER_MAX_TENANTS',
  ]) {
    assert.match(source, new RegExp(`^${setting}=\\d+$`, 'm'), `${file} must document ${setting}`);
  }
  assert.match(
    source,
    /^PRODUCT_API_KEY_PEPPER=/m,
    `${file} must document the dedicated Product API key HMAC pepper`,
  );
}

const productionGenerator = fs.readFileSync('deploy/make-production-env.sh', 'utf8');
assert.match(
  productionGenerator,
  /product_api_key_pepper="\$\(openssl rand -base64 48/,
  'the production generator must create an independent high-entropy Product API pepper',
);
assert.match(productionGenerator, /^PRODUCT_API_KEY_PEPPER=\$\{product_api_key_pepper\}$/m);

console.log('production environment and starter worker opt-in defaults passed');
