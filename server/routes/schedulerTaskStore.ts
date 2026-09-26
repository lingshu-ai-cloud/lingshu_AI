import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../storage/index.js';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data/tasks.json');

export interface ScheduledTask {
  id: string; name: string; category: 'daily' | 'monitor' | 'report' | 'automation';
  taskType: 'trend_report' | 'weekly_review' | 'crm_wakeup' | 'exchange_rate' | 'market_intelligence' | 'holiday_push' | 'video_keyword_crawl' | 'image_post_crawl' | 'competitor_account_crawl' | 'social_discovery_collection' | 'custom';
  cronExpr: string; cronLabel: string; enabled: boolean; lastRun?: string; lastResult?: string;
  nextRun?: string; channelId?: string; config: Record<string, string>; tenantId?: string; createdAt: string;
}
export type ScheduledExecutionState = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'worker_offline' | 'no_data' | 'collected' | 'partial';
export interface ScheduledRunOutcome { taskId: string; state: ScheduledExecutionState; result: string; lastRun?: string }

export function loadScheduledTasks(): ScheduledTask[] {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { return []; }
}
function taskPayload(task: ScheduledTask): Record<string, unknown> {
  return { task_id: task.id, tenant_id: task.tenantId || '', name: task.name, category: task.category,
    task_type: task.taskType, cron_expr: task.cronExpr, cron_label: task.cronLabel, enabled: task.enabled,
    channel_id: task.channelId || '', config: task.config || {}, last_run: task.lastRun || '',
    last_result: task.lastResult || '', created_at: task.createdAt };
}
function taskFromRecord(record: Record<string, any>): ScheduledTask | null {
  const id = String(record.task_id || '').trim(); const tenantId = String(record.tenant_id || '').trim();
  if (!id || !tenantId) return null;
  return { id, tenantId, name: String(record.name || id), category: (record.category || 'daily') as ScheduledTask['category'],
    taskType: (record.task_type || 'custom') as ScheduledTask['taskType'], cronExpr: String(record.cron_expr || '0 8 * * *'),
    cronLabel: String(record.cron_label || '每天 08:00'), enabled: record.enabled !== false,
    channelId: String(record.channel_id || '') || undefined, config: record.config && typeof record.config === 'object' ? record.config : {},
    lastRun: String(record.last_run || '') || undefined, lastResult: String(record.last_result || '') || undefined,
    createdAt: String(record.created_at || record.created || new Date().toISOString()) };
}
async function allRemoteTasks(): Promise<Array<Record<string, any>>> {
  const items: Array<Record<string, any>> = [];
  for (let page = 1; page <= 50; page += 1) {
    const result = await store.list<Record<string, any>>('scheduled_tasks', { page, perPage: 100, sort: 'created_at' });
    items.push(...result.items); if (page >= result.totalPages || result.items.length < 100) break;
  }
  return items;
}
async function mirrorTasks(tasks: ScheduledTask[]): Promise<void> {
  const remote = await allRemoteTasks(); const remoteByTaskId = new Map(remote.map(record => [String(record.task_id || ''), record]));
  const localIds = new Set(tasks.map(task => task.id));
  for (const task of tasks) {
    if (!task.tenantId) continue; const existing = remoteByTaskId.get(task.id);
    if (existing?.id) await store.update('scheduled_tasks', existing.id, taskPayload(task));
    else await store.create('scheduled_tasks', taskPayload(task));
  }
  for (const record of remote) if (record.id && record.task_id && !localIds.has(String(record.task_id))) await store.delete('scheduled_tasks', String(record.id));
}
export function saveScheduledTasks(tasks: ScheduledTask[]): void {
  fs.mkdirSync(path.dirname(DATA), { recursive: true }); fs.writeFileSync(DATA, JSON.stringify(tasks, null, 2));
  void mirrorTasks(tasks).catch(error => console.error('[scheduler] PocketBase task mirror failed:', error instanceof Error ? error.message : error));
}
export async function hydrateScheduledTasks(): Promise<ScheduledTask[]> {
  try {
    const remote = (await allRemoteTasks()).map(taskFromRecord).filter((task): task is ScheduledTask => Boolean(task));
    if (!remote.length) return loadScheduledTasks();
    fs.mkdirSync(path.dirname(DATA), { recursive: true }); fs.writeFileSync(DATA, JSON.stringify(remote, null, 2)); return remote;
  } catch (error) {
    console.warn('[scheduler] using local task snapshot:', error instanceof Error ? error.message : error); return loadScheduledTasks();
  }
}

export function scheduledExecutionState(result: string | undefined, options: { running?: boolean; workerOnline?: boolean } = {}): ScheduledExecutionState {
  const text = String(result || '').trim();
  if (options.running || /任务正在执行|执行状态：[^\n]*执行中\s*[1-9]/.test(text)) return 'running';
  const queued = /执行状态：已排队|执行状态：处理中|等待\s*(?:Mac\s*)?(?:本地\s*)?Worker|等待\/处理中/.test(text);
  if (queued && options.workerOnline === false) return 'worker_offline'; if (queued) return 'queued';
  if (/执行状态：部分成功/.test(text)) return 'partial'; if (/执行状态：已采集，待分析/.test(text)) return 'collected';
  if (/执行状态：暂无结果/.test(text)) return 'no_data'; if (/执行状态：执行失败/.test(text)) return 'failed';
  if (/公开采集未找到可入库的真实视频：[\s\S]*(?:search failed|SSL|HTTP [45]\d\d|ECONN|timed out)/i.test(text) && !/新增 [1-9]\d* 条/.test(text)) return 'failed';
  if (/执行状态：(?:执行成功|部分成功)|任务执行完成|采集已结束|已完成/.test(text)) return 'succeeded';
  if (/执行状态：执行失败|执行失败[:：]|任务均执行失败|全部失败/.test(text)) return 'failed'; return 'idle';
}
