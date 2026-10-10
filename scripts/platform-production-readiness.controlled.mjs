import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(path.join(tmpdir(), 'platform-readiness-'));
const tests = [
  'server/lib/oauthNonceStore.test.ts',
  'server/lib/tenantPlatformApps.oauthCredentials.test.ts',
  'server/integrations/messengerAdmission.test.ts',
  'server/messenger/authorizedCustomerRead.test.ts',
  'server/publishing/tiktokCreatorConsent.test.ts',
  'src/lib/tikTokPostSettings.test.ts',
  'src/components/publishing/TikTokPostSettings.test.tsx',
  'src/lib/externalVideoApproval.test.ts',
  'scripts/platform-production-readiness.controlled.test.ts',
  'scripts/platform-tiktok-readiness.controlled.test.ts',
  'scripts/platform-messaging-readiness.controlled.test.ts',
  'server/lib/socialOAuthScopes.test.ts',
  'server/publishing/instagramPublishingContract.test.ts',
  'server/publishing/instagramNativePublishing.test.ts',
  'server/whatsapp/productionBoundary.integration.test.ts',
  'server/whatsapp/authorizedCustomerRead.test.ts',
  'server/publishing/tiktokDirectPostDurability.integration.test.ts',
  'server/publishing/tiktokScheduledReceiptRecovery.test.ts',
  'server/publishing/tiktokPublicationOptions.test.ts',
  'server/publishing/tiktokWeeklyPublishingAdapter.test.ts',
  'server/publishing/weeklyPublicationExecutionWorker.test.ts',
];
// Deliberate allowlist: never inherit application/provider credentials, dotenv,
// NODE_OPTIONS, database credentials or a production data backend.
const env = {
  PATH: process.env.PATH || '', TMPDIR: scratch, NODE_ENV: 'test',
  DATA_BACKEND: 'pocketbase', PB_URL: 'http://provider.invalid',
  OAUTH_CONFIG_FILE: path.join(scratch, 'oauth-config.json'),
  CHANNELS_DATA_FILE: path.join(scratch, 'channels.json'),
  TENANT_PLATFORM_APP_KEY: 'controlled-readiness-only-key',
  PLATFORM_TOKEN_ENCRYPTION_KEY: 'controlled-readiness-only-key',
  OAUTH_STATE_SECRET: 'controlled-readiness-only-key',
};
try {
  const result = spawnSync(process.execPath, [
    '--import', './scripts/platform-production-readiness.network-guard.mjs',
    '--import', 'tsx', '--test', ...tests,
  ], { cwd: root, env, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally { rmSync(scratch, { recursive: true, force: true }); }
