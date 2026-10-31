import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tests = [
  ...readdirSync(path.join(root, 'server/platformAds')).filter(name => name.endsWith('.test.ts')).sort().map(name => `server/platformAds/${name}`),
  'shared/platformAdCapabilities.test.ts',
  'shared/adReceiptState.test.ts',
  'shared/adReportPeriod.test.ts',
  'src/lib/adOverview.test.ts',
  'src/lib/useAdPlanNavigation.test.ts',
  'src/lib/adManagedSummary.test.ts',
  'src/lib/adPlanMetricsRequest.test.ts', 'src/lib/adPlanRow.test.ts',
  'src/components/useAdPlanOperatingData.test.ts',
  'src/components/AdPerformanceOverview.test.tsx',
  'src/components/MetaLeadFields.test.tsx',
  'src/components/MetaMessageChannels.test.tsx',
  'src/components/AdWorkflowRecovery.test.tsx',
  'src/components/AdPlanWorkspace.test.tsx',
  'src/components/AdPlanOperations.test.tsx',
  'src/components/AdMetaConnectionGuide.test.tsx',
  'src/components/AdAuthorizationHealth.test.tsx',
  'src/components/AdAccountConnections.recovery.test.tsx',
  'src/components/AdAccountSpendSummary.test.tsx',
  'src/components/AdAccountStatusBanner.test.tsx',
  'src/components/AdPlanManagement.drawer.test.tsx',
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
