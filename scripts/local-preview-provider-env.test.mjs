import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import {
  loadLocalPreviewProviderEnvironment, PREVIEW_PROVIDER_ENV_KEYS,
  PROVIDER_ENV_SELECTOR, providerEnvironmentForService,
} from './local-preview-provider-env.mjs';

function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-preview-providers-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const primary = path.join(temporary, 'primary');
  const runtimeRoot = path.join(temporary, 'worktree');
  fs.mkdirSync(primary);
  const git = args => execFileSync('git', args, {
    cwd: primary, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
  });
  git(['init', '--quiet']);
  git(['-c', 'user.name=Preview test', '-c', 'user.email=preview@local.test', 'commit', '--quiet', '--allow-empty', '-m', 'fixture']);
  git(['worktree', 'add', '--quiet', '--detach', runtimeRoot]);
  const source = path.join(primary, '.env.local');
  fs.writeFileSync(source, 'DASHSCOPE_API_KEY=test-provider-key\nSEEDANCE_VIDEO_ENABLED=true\nSEEDANCE_2_FAST_CNY_PER_MILLION=16.5\n');
  const env = { [PROVIDER_ENV_SELECTOR]: source };
  const load = (overrides = {}) => loadLocalPreviewProviderEnvironment({ runtimeRoot, env, ...overrides });
  return { temporary, primary, runtimeRoot, source, env, load };
}

test('provider configuration is disabled without explicit selector and never mutates the process environment', t => {
  const f = fixture(t);
  const before = { ...process.env };
  assert.deepEqual(f.load({ env: {} }), { providerEnv: {}, loadedKeys: [] });
  assert.ok(JSON.stringify({ ...process.env }) === JSON.stringify(before), 'process environment must not change');
  assert.equal(f.load().providerEnv.DASHSCOPE_API_KEY, 'test-provider-key');
  assert.ok(JSON.stringify({ ...process.env }) === JSON.stringify(before), 'process environment must not change');
});

test('worktree local selector is persistent, while an explicitly empty startup selector disables it', t => {
  const f = fixture(t);
  const previousPbUrl = process.env.PB_URL;
  fs.writeFileSync(path.join(f.runtimeRoot, '.env.local'), `${PROVIDER_ENV_SELECTOR}=${f.source}\nPB_URL=https://unrelated.invalid\n`);
  assert.equal(f.load({ env: {} }).providerEnv.SEEDANCE_VIDEO_ENABLED, 'true');
  assert.deepEqual(f.load({ env: { [PROVIDER_ENV_SELECTOR]: '' } }), { providerEnv: {}, loadedKeys: [] });
  assert.ok(process.env.PB_URL === previousPbUrl, 'local database setting must not be loaded into the supervisor');
});

test('startup and both current env files retain explicit empty/false values and lower budget ceilings', t => {
  const f = fixture(t);
  fs.appendFileSync(f.source, 'SEEDREAM_API_KEY=test-image-key\nHEYGEN_GENERATION_ENABLED=true\nSEEDANCE_TENANT_MONTHLY_BUDGET_CNY=50\nSTUDIO_PAID_BUDGET_CNY=40\n');
  fs.writeFileSync(path.join(f.runtimeRoot, '.env'), 'SEEDREAM_API_KEY=\nSEEDANCE_TENANT_MONTHLY_BUDGET_CNY=2\n');
  fs.writeFileSync(path.join(f.runtimeRoot, '.env.local'), 'HEYGEN_GENERATION_ENABLED=false\nSTUDIO_PAID_BUDGET_CNY=\n');
  const configuration = f.load({ env: { ...f.env, DASHSCOPE_API_KEY: '', SEEDANCE_VIDEO_ENABLED: 'false' } });
  assert.deepEqual(configuration.providerEnv, { SEEDANCE_2_FAST_CNY_PER_MILLION: '16.5' });
});

test('imports exact provider and budget keys, excludes storage, DB, auth, VITE, publishing and workers', t => {
  const f = fixture(t);
  fs.appendFileSync(f.source, [
    'STUDIO_PAID_BUDGET_CNY=12', 'STUDIO_PAID_OPENING_USED_CNY=2',
    'STUDIO_HEYGEN_RESERVE_CNY=3', 'STUDIO_ASR_RESERVE_CNY=1',
    'SEEDANCE_TENANT_MONTHLY_BUDGET_CNY=8', 'DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT=1',
    'DIGITAL_HUMAN_REFERENCE_MONTHLY_BUDGET_CNY=4', 'SEEDREAM_API_KEY=',
    'COS_SECRET_KEY=must-not-import', 'COS_BUCKET=must-not-import', 'OBJECT_STORAGE_DRIVER=cos',
    'PB_URL=https://unrelated.invalid', 'PB_ADMIN_PASSWORD=must-not-import', 'DATA_BACKEND=pocketbase',
    'AUTH_TOKEN=must-not-import', 'LOCAL_DEMO_TOKEN_SECRET=must-not-import',
    'VITE_API_KEY=must-not-import', 'NODE_ENV=production',
    'SOCIAL_PUBLISH_ENABLED=true', 'SOCIAL_WEEKLY_EXECUTION_WORKER_ENABLED=true',
    'DIGITAL_EMPLOYEE_RUNTIME_ENABLED=false', 'DASHSCOPE_API_KEY_FILE=/private/unreadable',
  ].join('\n'));
  const { providerEnv, loadedKeys } = f.load();
  assert.equal(providerEnv.STUDIO_PAID_BUDGET_CNY, '12');
  assert.equal(providerEnv.STUDIO_PAID_OPENING_USED_CNY, '2');
  assert.equal(providerEnv.SEEDANCE_TENANT_MONTHLY_BUDGET_CNY, '8');
  assert.equal(providerEnv.DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT, '1');
  assert.equal(providerEnv.SEEDREAM_API_KEY, undefined);
  assert.deepEqual(loadedKeys, Object.keys(providerEnv));
  assert.ok(loadedKeys.every(key => PREVIEW_PROVIDER_ENV_KEYS.includes(key)));
  assert.ok(loadedKeys.every(key => !/^(COS_|OBJECT_STORAGE_|PB_|DATA_|AUTH_|LOCAL_|VITE_|NODE_|SOCIAL_|DIGITAL_EMPLOYEE_)/.test(key)));
  assert.equal(providerEnv.DASHSCOPE_API_KEY_FILE, undefined);
});

test('no generation switch or budget is invented when absent from the selected source', t => {
  const f = fixture(t);
  fs.writeFileSync(f.source, 'DASHSCOPE_API_KEY=test-provider-key\n');
  assert.deepEqual(f.load().providerEnv, { DASHSCOPE_API_KEY: 'test-provider-key' });
});

test('storyboard imports the exact source cap, retry count and prices without raising or defaulting them', t => {
  const f = fixture(t);
  fs.writeFileSync(f.source, [
    'STORYBOARD_AIGC_BATCH_BUDGET_CNY=3',
    'STORYBOARD_AIGC_MAX_RETRIES=0',
    'STORYBOARD_AIGC_FIRST_FRAME_ESTIMATED_CNY=0.22',
    'STORYBOARD_AIGC_CLONE_GEOMETRY_ESTIMATED_CNY=0.5',
    'STORYBOARD_AIGC_GENERATION_ENABLED=true',
  ].join('\n'));
  assert.deepEqual(f.load().providerEnv, {
    STORYBOARD_AIGC_BATCH_BUDGET_CNY: '3',
    STORYBOARD_AIGC_MAX_RETRIES: '0',
    STORYBOARD_AIGC_FIRST_FRAME_ESTIMATED_CNY: '0.22',
    STORYBOARD_AIGC_CLONE_GEOMETRY_ESTIMATED_CNY: '0.5',
  });
});

test('storyboard current lower cap, false and empty values always take precedence over the source', t => {
  const f = fixture(t);
  fs.writeFileSync(f.source, [
    'STORYBOARD_AIGC_BATCH_BUDGET_CNY=50', 'STORYBOARD_AIGC_MAX_RETRIES=3',
    'STORYBOARD_AIGC_FIRST_FRAME_ESTIMATED_CNY=0.22', 'STORYBOARD_AIGC_CLONE_GEOMETRY_ESTIMATED_CNY=0.5',
  ].join('\n'));
  fs.writeFileSync(path.join(f.runtimeRoot, '.env'), 'STORYBOARD_AIGC_BATCH_BUDGET_CNY=2\n');
  fs.writeFileSync(path.join(f.runtimeRoot, '.env.local'), 'STORYBOARD_AIGC_MAX_RETRIES=false\nSTORYBOARD_AIGC_FIRST_FRAME_ESTIMATED_CNY=\n');
  assert.deepEqual(f.load({ env: { ...f.env, STORYBOARD_AIGC_CLONE_GEOMETRY_ESTIMATED_CNY: '' } }).providerEnv, {});
});

test('provider overrides are supplied only to the backend, not either frontend', t => {
  const f = fixture(t);
  const configuration = f.load();
  assert.deepEqual(providerEnvironmentForService('backend', configuration), configuration.providerEnv);
  assert.notEqual(providerEnvironmentForService('backend', configuration), configuration.providerEnv);
  assert.deepEqual(providerEnvironmentForService('frontend', configuration), {});
  assert.deepEqual(providerEnvironmentForService('account-hub-frontend', configuration), {});
});

test('rejects unrelated source directories, arbitrary filenames and source symlinks leaving the primary checkout', t => {
  const f = fixture(t);
  const external = path.join(f.temporary, 'unrelated');
  fs.mkdirSync(external);
  const unrelated = path.join(external, '.env.local');
  fs.writeFileSync(unrelated, 'DASHSCOPE_API_KEY=must-not-read\n');
  assert.throws(() => f.load({ env: { [PROVIDER_ENV_SELECTOR]: unrelated } }), /source_must_be_primary_environment/);
  assert.throws(() => f.load({ env: { [PROVIDER_ENV_SELECTOR]: path.join(f.primary, 'arbitrary') } }), /source_must_be_primary_environment/);
  fs.unlinkSync(f.source);
  fs.symlinkSync(unrelated, f.source);
  assert.throws(() => f.load(), /environment_file_unavailable_or_unsafe/);
});

test('rejects current env symlinks leaving the checkout and does not expose paths or values in errors', t => {
  const f = fixture(t);
  fs.symlinkSync(f.source, path.join(f.runtimeRoot, '.env.local'));
  assert.throws(() => f.load(), error => {
    assert.match(error.message, /environment_file_unavailable_or_unsafe/);
    assert.ok(!error.message.includes(f.primary));
    assert.ok(!error.message.includes('test-provider-key'));
    return true;
  });
});

test('production processes cannot use this local-only opt-in, even when set in current env files', t => {
  const f = fixture(t);
  assert.throws(() => f.load({ env: { ...f.env, NODE_ENV: 'production' } }), /production_not_allowed/);
  fs.writeFileSync(path.join(f.runtimeRoot, '.env'), 'NODE_ENV=production\n');
  assert.throws(() => f.load(), /production_not_allowed/);
  fs.writeFileSync(path.join(f.runtimeRoot, '.env'), 'NODE_ENV=development\n');
  fs.writeFileSync(path.join(f.runtimeRoot, '.env.local'), 'NODE_ENV=production\n');
  assert.throws(() => f.load(), /production_not_allowed/);
});

test('missing or oversized source fails with a fixed redacted error', t => {
  const f = fixture(t);
  fs.unlinkSync(f.source);
  assert.throws(() => f.load(), /environment_file_unavailable_or_unsafe/);
  fs.writeFileSync(f.source, 'x'.repeat(256 * 1024 + 1));
  assert.throws(() => f.load(), /environment_file_unavailable_or_unsafe/);
});
