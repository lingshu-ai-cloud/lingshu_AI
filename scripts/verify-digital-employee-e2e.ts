import 'dotenv/config';
import { buildDigitalEmployeeAcceptanceReport } from '../server/digitalEmployees/e2eAcceptance.js';

function required(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_required`);
  return value;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('production_environment_not_allowed');
  const tenantId = required('DIGITAL_EMPLOYEE_E2E_TENANT_ID');
  if (!/^local_tenant_[a-z0-9_]+$/i.test(tenantId) && process.env.DIGITAL_EMPLOYEE_E2E_ALLOW_REMOTE !== 'true') {
    throw new Error('local_test_tenant_required');
  }
  const exactAnalysisInput = String(process.env.DIGITAL_EMPLOYEE_E2E_REQUIRE_EXACT_ANALYSIS || '').trim();
  const requireExactVideoAnalysis = exactAnalysisInput === 'true'
    ? true
    : exactAnalysisInput === 'false' ? false : undefined;
  const waiveWhatsAppRealSend = process.env.DIGITAL_EMPLOYEE_E2E_WAIVE_WHATSAPP === 'true';
  const whatsAppWaiverReason = String(process.env.DIGITAL_EMPLOYEE_E2E_WHATSAPP_WAIVER_REASON || '').trim();
  if (waiveWhatsAppRealSend && !whatsAppWaiverReason) throw new Error('whatsapp_waiver_reason_required');
  const report = await buildDigitalEmployeeAcceptanceReport({
    tenantId,
    runId: String(process.env.DIGITAL_EMPLOYEE_E2E_RUN_ID || '').trim() || undefined,
    requireExactVideoAnalysis,
    waiveWhatsAppRealSend,
    whatsAppWaiverReason,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.overall !== 'passed') process.exitCode = report.overall === 'failed' ? 2 : 3;
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
