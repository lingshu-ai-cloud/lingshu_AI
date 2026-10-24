#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storeDir = path.join(root, 'data', 'local-store');
const tenantId = process.argv[2] || 'local_tenant_preview_beauty_showcase_local_test';
const now = new Date();
const nowIso = now.toISOString();
const id = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
const read = name => JSON.parse(fs.readFileSync(path.join(storeDir, `${name}.json`), 'utf8'));
const write = (name, rows) => {
  const file = path.join(storeDir, `${name}.json`);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
};
const monday = new Date(now);
const day = monday.getUTCDay() || 7;
monday.setUTCDate(monday.getUTCDate() - day + 1);
monday.setUTCHours(0, 0, 0, 0);
const sunday = new Date(monday);
sunday.setUTCDate(monday.getUTCDate() + 6);
const date = value => value.toISOString().slice(0, 10);
const weekStart = date(monday);
const weekEnd = date(sunday);
const marker = `local-calendar-baseline:${tenantId}:${weekStart}`;

const collections = {
  weekly_goals: read('weekly_goals'),
  weekly_plans: read('weekly_plans'),
  workflow_runs: read('workflow_runs'),
  workflow_tasks: read('workflow_tasks'),
};
const existing = collections.weekly_goals.find(row => row.tenant_id === tenantId && row.scope?.localCalendarBaseline === marker);
if (existing) {
  console.log(JSON.stringify({ restored: false, reason: 'already_present', tenantId, weekStart, weekEnd, goalId: existing.id }, null, 2));
  process.exit(0);
}

const sourceGoal = collections.weekly_goals.find(row => row.tenant_id === tenantId);
const sourcePlan = collections.weekly_plans.find(row => row.tenant_id === tenantId && row.goal_id === sourceGoal?.id);
const sourceRun = collections.workflow_runs.find(row => row.tenant_id === tenantId && row.goal_id === sourceGoal?.id);
const sourceTasks = collections.workflow_tasks
  .filter(row => row.tenant_id === tenantId && row.run_id === sourceRun?.id)
  .sort((a, b) => Number(a.sequence) - Number(b.sequence));
if (!sourceGoal || !sourcePlan || !sourceRun || !sourceTasks.length) throw new Error('local_calendar_source_records_missing');

const backupDir = path.join(root, 'data', 'local-calendar-backups', `${nowIso.replaceAll(':', '').replaceAll('.', '-')}-${tenantId}`);
fs.mkdirSync(backupDir, { recursive: true });
for (const name of Object.keys(collections)) {
  fs.copyFileSync(path.join(storeDir, `${name}.json`), path.join(backupDir, `${name}.json`));
}

const goalId = id('weekly_goals');
const planId = id('weekly_plans');
const runId = id('workflow_runs');
const nextGoal = {
  ...sourceGoal,
  id: goalId,
  created: nowIso,
  updated: nowIso,
  created_at: nowIso,
  updated_at: nowIso,
  title: '本周 A阵内容生产排期',
  objective: '恢复智能经营日历的基础任务数据，用于本地布局与交互调试',
  starts_at: weekStart,
  ends_at: weekEnd,
  status: 'active',
  version: 1,
  scope: { ...(sourceGoal.scope || {}), localCalendarBaseline: marker, externalEffectsAllowed: false },
};
const planBody = typeof sourcePlan.plan === 'object' && sourcePlan.plan ? sourcePlan.plan : {};
const nextPlan = {
  ...sourcePlan,
  id: planId,
  goal_id: goalId,
  created: nowIso,
  updated: nowIso,
  created_at: nowIso,
  plan: {
    ...planBody,
    strategy: '本地布局调试基线：沿用已确认的 A阵任务结构，仅展示内部排期，不执行真实发布、客户发送或付费生成。',
    localCalendarBaseline: marker,
  },
};
const nextRun = {
  ...sourceRun,
  id: runId,
  goal_id: goalId,
  plan_id: planId,
  created: nowIso,
  updated: nowIso,
  started_at: nowIso,
  completed_at: '',
  status: 'running',
  current_controller: 'agent',
  pause_reason: '',
  policy_snapshot: { allowPaidGeneration: false, allowRealPublishing: false, allowRealCustomerMessages: false },
};
const nextTasks = sourceTasks.map((task, index) => ({
  ...task,
  id: id('workflow_tasks'),
  goal_id: goalId,
  plan_id: planId,
  run_id: runId,
  created: nowIso,
  updated: nowIso,
  created_at: nowIso,
  updated_at: nowIso,
  status: index === 0 ? 'succeeded' : index === 1 ? 'running' : 'pending',
  output: index === 0 ? { localCalendarBaseline: true, summary: '本周目标与基础排期已恢复' } : {},
  blocked_reason: '',
  automatic_execution_allowed: false,
  external_effect: 'none',
  policy_source: marker,
}));

write('weekly_goals', [nextGoal, ...collections.weekly_goals]);
write('weekly_plans', [nextPlan, ...collections.weekly_plans]);
write('workflow_runs', [nextRun, ...collections.workflow_runs]);
write('workflow_tasks', [...nextTasks, ...collections.workflow_tasks]);
console.log(JSON.stringify({ restored: true, tenantId, weekStart, weekEnd, goalId, runId, taskCount: nextTasks.length, backupDir: path.relative(root, backupDir) }, null, 2));
