import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { createLocalInviteTenant } from '../server/lib/localTenants.js';
import { cleanupLocalE2ETenant } from '../server/digitalEmployees/e2eCleanup.js';

type JsonRecord = Record<string, any>;

const baseUrl = String(process.env.DIGITAL_EMPLOYEE_E2E_BASE_URL || 'http://127.0.0.1:8790/api/overseas').replace(/\/$/, '');

async function request(path: string, options: RequestInit = {}, token = ''): Promise<JsonRecord> {
  const response = await fetch(`${baseUrl}/${path.replace(/^\//, '')}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) throw new Error(`${path}:${response.status}:${JSON.stringify(body)}`);
  return body;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('production_environment_not_allowed');
  const marker = randomUUID().replaceAll('-', '');
  const inviteCode = `E2E-${randomBytes(8).toString('hex')}`;
  const email = `digital-employee-e2e-${marker}@local.test`;
  const password = `E2e-${randomBytes(18).toString('base64url')}`;
  const tenant = createLocalInviteTenant({
    companyName: `数字员工验收-${marker.slice(0, 8)}`,
    contactName: 'Local E2E',
    industry: '本地自动化验收',
    notes: 'ephemeral isolated tenant; must be removed by the same smoke run',
    inviteCode,
  });
  let cleanup: ReturnType<typeof cleanupLocalE2ETenant> | null = null;
  try {
    const registration = await request('auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, inviteCode }),
    });
    const token = String(registration.token || '');
    assert.ok(token, 'registration must return an auth token');
    assert.equal(registration.tenant?.id, tenant.id, 'registration must bind the invited tenant');

    const config = {
      companyName: tenant.companyName,
      industry: tenant.industry,
      primaryBusiness: '验证首次配置与常态经营状态机',
      targetMarkets: '美国',
      customerProfile: '已明确同意测试的 B2B 采购联系人',
      autonomyMode: 'managed',
      approvalOwner: 'Local E2E Owner',
      primaryGoal: 'leads',
      focusProducts: '',
      enabledWorkflows: ['customer_segmentation'],
      socialCadence: '不启用内容采集',
      followupCadence: '每周五 09:00 生成分层草稿；真实发送前人工审批',
      reviewSchedule: '周五 17:30（北京时间）',
      publishingTargets: [],
      allowGeneratedVisuals: false,
      allowRealPublishing: false,
      allowRealCustomerMessages: false,
      constraints: ['禁止真实发布', '禁止真实发送'],
      team: ['planner', 'knowledge', 'customer', 'review'],
    };
    const afterOnboarding = await request('digital-employees/onboarding/complete', { method: 'POST', body: JSON.stringify(config) }, token);
    assert.ok(afterOnboarding.config, 'first-time setup must persist the configuration');
    assert.equal(afterOnboarding.goal, null, 'first-time setup must stop at weekly-goal entry rather than silently creating a run');

    const start = new Date();
    const end = new Date(start.getTime() + 6 * 86_400_000);
    const goalBody = {
      businessLine: 'customer_conversion',
      contentPlatforms: ['youtube'],
      title: '首周客户分层验收',
      objective: '验证无真实客户时安全停在明确知识缺口',
      metric: 'qualified_customers',
      baseline: 0,
      target: 1,
      unit: '人',
      startsAt: start.toISOString().slice(0, 10),
      endsAt: end.toISOString().slice(0, 10),
      scope: '仅当前隔离租户',
      constraints: ['不发送任何真实消息'],
    };
    const afterGoal = await request('digital-employees/goals', { method: 'POST', body: JSON.stringify(goalBody) }, token);
    assert.equal(afterGoal.goal?.status, 'draft');
    assert.equal(afterGoal.run, null, 'draft goal must not start execution before approval');

    const afterApproval = await request(`digital-employees/goals/${afterGoal.goal.id}/approve`, { method: 'POST', body: '{}' }, token);
    const taskKeys = (afterApproval.tasks || []).map((item: JsonRecord) => item.task_key);
    assert.deepEqual(taskKeys, ['context_readiness', 'goal_decomposition', 'customer_segmentation', 'weekly_review']);
    assert.equal(afterApproval.run?.status, 'waiting_external');
    const customerTask = (afterApproval.tasks || []).find((item: JsonRecord) => item.task_key === 'customer_segmentation');
    assert.equal(customerTask?.status, 'waiting_external');
    assert.match(String(customerTask?.blocked_reason || ''), /真实 WhatsApp 客户|客户/);
    assert.equal(afterApproval.businessSnapshot?.customer?.total?.status, 'unavailable');
    assert.equal(afterApproval.businessSnapshot?.customer?.total?.value, 0);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      tenantId: tenant.id,
      assertions: {
        registrationBoundToInvite: true,
        onboardingStopsBeforeGoal: true,
        draftGoalDoesNotStartRun: true,
        approvedGoalBuildsExpectedTaskGraph: true,
        missingCustomersFailClosed: true,
      },
    }, null, 2)}\n`);
  } finally {
    cleanup = cleanupLocalE2ETenant({ root: process.cwd(), tenantId: tenant.id, apply: true });
    if (!cleanup.verifiedClean) throw new Error(`e2e_cleanup_failed:${cleanup.remainingReferences.join(',')}`);
    // This smoke run is self-contained and has no user-owned artifacts. Once
    // active data is verified clean, remove its recovery copy as well so the
    // repository is left exactly as it was before the run.
    if (cleanup.backupDir) fs.rmSync(cleanup.backupDir, { recursive: true, force: true });
    process.stdout.write(`${JSON.stringify({ cleanup: { tenantId: tenant.id, removedRecords: cleanup.removedRecords, movedDirectories: cleanup.movedDirectories, verifiedClean: true } }, null, 2)}\n`);
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
