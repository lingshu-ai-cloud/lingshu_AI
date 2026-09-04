import 'dotenv/config';
import { cleanupLocalE2ETenant } from '../server/digitalEmployees/e2eCleanup.js';

const CONFIRMATION = 'CLEAN_ISOLATED_LOCAL_TENANT';

function required(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function main(): void {
  if (process.env.NODE_ENV === 'production') throw new Error('production_environment_not_allowed');
  const apply = process.argv.includes('--apply');
  if (apply && required('DIGITAL_EMPLOYEE_E2E_CLEANUP_CONFIRM') !== CONFIRMATION) {
    throw new Error('explicit_cleanup_confirmation_required');
  }
  const report = cleanupLocalE2ETenant({
    root: process.cwd(),
    tenantId: required('DIGITAL_EMPLOYEE_E2E_TENANT_ID'),
    apply,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (apply && !report.verifiedClean) process.exitCode = 2;
}

try { main(); } catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
