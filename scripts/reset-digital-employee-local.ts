import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tenantId = String(process.argv[2] || '').trim();
if (!/^local_tenant_[a-z0-9_]+$/i.test(tenantId)) {
  throw new Error('Usage: npm run digital-employee:reset-local -- local_tenant_<account>');
}

const root = process.cwd();
const localStore = path.join(root, 'data/local-store');
const collections = [
  'digital_employee_configs',
  'digital_employee_config_versions',
  'weekly_goals',
  'weekly_plans',
  'workflow_runs',
  'workflow_tasks',
  'run_events',
  'approval_requests',
  'handoff_sessions',
  'weekly_reviews',
  'workflow_corrections',
  'customer_segments',
  'customer_segment_members',
  'followup_batches',
  'followup_batch_items',
] as const;

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = fs.mkdtempSync(path.join(root, `data/backups/digital-employee-reset-${stamp}-`));
let removed = 0;

function readRows(file: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(file)) return [];
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!Array.isArray(value)) throw new Error(`Expected an array in ${file}`);
  return value as Array<Record<string, unknown>>;
}

function writeRows(file: string, rows: Array<Record<string, unknown>>): void {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

for (const collection of collections) {
  const file = path.join(localStore, `${collection}.json`);
  if (!fs.existsSync(file)) continue;
  fs.copyFileSync(file, path.join(backupDir, path.basename(file)));
  const rows = readRows(file);
  const kept = rows.filter(row => String(row.tenant_id || row.tenantId || '') !== tenantId);
  removed += rows.length - kept.length;
  writeRows(file, kept);
}

for (const relative of ['data/tasks.json', 'data/local-store/scheduled_tasks.json']) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;
  fs.copyFileSync(file, path.join(backupDir, relative.replaceAll('/', '__')));
  const rows = readRows(file);
  const kept = rows.filter(row => {
    if (String(row.tenantId || row.tenant_id || '') !== tenantId) return true;
    const config = row.config && typeof row.config === 'object' ? row.config as Record<string, unknown> : {};
    return !(String(row.id || '').startsWith('task_de_') || config.workflowRunId || config.workflowTaskId);
  });
  removed += rows.length - kept.length;
  writeRows(file, kept);
}

const crawlJobsFile = path.join(root, 'data/local-store/crawl_jobs.json');
if (fs.existsSync(crawlJobsFile)) {
  fs.copyFileSync(crawlJobsFile, path.join(backupDir, 'data__local-store__crawl_jobs.json'));
  const rows = readRows(crawlJobsFile);
  const kept = rows.filter(row => !(
    String(row.tenantId || row.tenant_id || '') === tenantId
    && String(row.requestedBy || '').startsWith('scheduler:task_de_')
  ));
  removed += rows.length - kept.length;
  writeRows(crawlJobsFile, kept);
}

console.log(JSON.stringify({ ok: true, tenantId, removed, backupDir, host: os.hostname() }, null, 2));
