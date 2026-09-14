import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tests = [
  ...readdirSync(path.join(root, 'server/platformAds')).filter(name => name.endsWith('.test.ts')).sort().map(name => `server/platformAds/${name}`),
  'src/lib/adOverview.test.ts',
  'src/components/AdPerformanceOverview.test.tsx',
  'src/components/PlatformAdsPage.contract.test.ts',
];
for (const test of tests) {
  console.log(`Testing ${test}`);
  const result = spawnSync(process.execPath, ['--import', 'tsx', test], {
    cwd: root,
    stdio: 'inherit',
    timeout: 180_000,
    // The suite intentionally exercises the isolated JSON adapter with a dead
    // PocketBase URL. Local fallback is no longer implicit in test/development,
    // so opt in at the suite boundary and keep production behavior fail-closed.
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ENABLE_LOCAL_DEV_FALLBACK: 'true',
      TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK: 'true',
    },
  });
  if (result.error || result.status !== 0) { console.error(`Failed: ${test}${result.error ? ` (${result.error.message})` : ''}`); process.exit(1); }
}
console.log(`Passed ${tests.length} platform ads test files.`);
