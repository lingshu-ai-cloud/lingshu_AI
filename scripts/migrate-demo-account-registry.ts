/**
 * Two-phase removal of legacy recoverable credentials from the demo registry.
 *
 * Plan (strictly read-only):
 *   npm run migrate:demo-credentials:plan
 *
 * Apply after every account in the printed plan has been reset/provisioned:
 *   DEMO_CREDENTIAL_MIGRATION_FINGERPRINT=<fingerprint> \
 *   DEMO_CREDENTIAL_RESETS_CONFIRMED=<comma-separated-emails> \
 *   npm run migrate:demo-credentials:apply
 */
import {
  applyDemoAccountCredentialMigration,
  readDemoAccountCredentialMigrationPlan,
} from '../server/lib/demoAccounts.js';

const mode = process.argv[2] || 'plan';
const plan = readDemoAccountCredentialMigrationPlan();

if (mode === 'plan') {
  console.log(JSON.stringify(plan, null, 2));
} else if (mode === 'apply') {
  const expectedSourceFingerprint = String(process.env.DEMO_CREDENTIAL_MIGRATION_FINGERPRINT || '').trim();
  const confirmedResetEmails = String(process.env.DEMO_CREDENTIAL_RESETS_CONFIRMED || '')
    .split(/[\s,;]+/)
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  const applied = applyDemoAccountCredentialMigration({
    expectedSourceFingerprint,
    confirmedResetEmails,
  });
  console.log(JSON.stringify({
    ok: true,
    sourceFingerprint: applied.sourceFingerprint,
    removedLegacyCredentialAccounts: applied.resetRequiredCount,
  }, null, 2));
} else {
  throw new Error(`Unknown mode "${mode}"; expected plan or apply`);
}
