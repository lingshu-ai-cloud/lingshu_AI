// Read current local-authority stores only; never mutate business records or call providers.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tenant = 'local_tenant_customer_1b2913131e2c46deab66172228c4df0a';
const aId = 'studio_projects_b251759707fa43a499a5dc48f070843f';
const bId = 'studio_projects_1f987e702c8e4e4e8b40e6432b80ae32';
const sources = [];
function read(name) {
  const file = `data/local-store/${name}.json`;
  const bytes = fs.readFileSync(path.join(root, file));
  sources.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') });
  const rows = JSON.parse(bytes); if (!Array.isArray(rows)) throw new Error(`Invalid ${name} store`); return rows;
}
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const projects = read('studio_projects');
const profiles = read('tenant_profiles');
const accounts = read('social_accounts');
const tasks = read('workflow_tasks');
const runs = read('workflow_runs');
const plans = read('weekly_plans');
const record = profiles.find(row => row.tenant_id === tenant);
if (!record) throw new Error('Target profile missing');
const profile = parse(record.profile);
const a = projects.find(row => row.id === aId);
if (!a || a.tenant_id !== tenant) throw new Error('Candidate A missing or foreign');
const spec = parse(a.spec);
const accountId = spec.contentOrder?.accountId;
const task = tasks.find(row => row.id === spec.workflowTaskId);
const run = runs.find(row => row.id === spec.workflowRunId);
const plan = plans.find(row => row.id === run?.plan_id);
const zeroFoundation = profile.socialStrategy?.contentStage === 'b2b_launch' && profile.socialStrategy?.weeklyTaskPackagePreset === 'b2b_starting';
const report = {
  schemaVersion: 1, recordedAtUtc: new Date().toISOString(), authority: 'current_persisted_local_authority_not_production_database', sources,
  state: 'blocked_business_identity_unresolved', executable: false, uniqueExecutableCandidate: null,
  soleTraceableCandidate: { projectId: a.id, tenantId: a.tenant_id, projectUpdated: a.updated, projectStatus: a.status, accountId, accountLabel: spec.contentOrder?.accountLabel, productId: spec.contentOrder?.productId, taskId: spec.workflowTaskId, runId: spec.workflowRunId, assemblyId: spec.activeAssemblyId, version: null },
  findings: {
    configuredZeroFoundation: zeroFoundation, realOperatingHistoryVerified: false,
    zeroFoundationPaths: ['tenant_profiles.profile.socialStrategy.contentStage', 'tenant_profiles.profile.socialStrategy.weeklyTaskPackagePreset'],
    weeklyMaturity: parse(plan?.plan)?.businessPackage?.maturity ?? null,
    company: { name: profile.company?.name, description: profile.company?.description },
    buyerRoles: profile.socialStrategy?.routeStrategies?.wholesale_distribution?.targetBuyerRoles ?? null,
    product: (profile.products?.items || []).filter(p => ['GUIANFA-RS-001', 'GUIANFA-RS-014'].includes(p.sku)).map(p => ({ sku: p.sku, name: p.name, sourceFile: p.attributes?.['来源文件'], sourcePage: p.attributes?.['来源页码'] })),
    currentCandidateBExists: projects.some(row => row.id === bId),
    sameTenantRealAccountExists: accounts.some(row => row.tenant_id === tenant && row.id === accountId),
    task: task ? { id: task.id, tenantId: task.tenant_id, runId: task.run_id, status: task.status, taskVersion: task.task_version, correctionVersion: task.correction_version } : null,
    run: run ? { id: run.id, tenantId: run.tenant_id, planId: run.plan_id, status: run.status } : null,
  },
  operationOrigin: { file: 'scripts/import-rongshang-local-preview.ts', effect: 'imports beauty catalog into target tenant and preserves pre-existing socialStrategy', establishesBusinessOwnershipAuthorization: false },
  neededDecision: { owner: 'business_responsible_person_via_main_session', question: 'Is this tenant authorized to conduct this skincare MVP, or must the MVP use the lighting business or an independently authorized skincare tenant?', customerMustCoordinateAgents: false },
  budgetA: { confirmedLimitCny: 5, permitsBSpending: false, paidExecutionAuthorized: false },
};
const output = path.join(root, 'docs/acceptance/mvp-session-a-identity-audit-2026-10-11.json');
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output, state: report.state, configuredZeroFoundation: zeroFoundation, candidateBExists: report.findings.currentCandidateBExists, accountExists: report.findings.sameTenantRealAccountExists }));
