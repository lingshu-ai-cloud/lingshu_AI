import { Router, type Request, type Response } from 'express';
import type { DataStore, Record_, Where } from '../storage/datastore.js';
import type { AuthLocals } from '../middleware/auth.js';
import { DIGITAL_EMPLOYEE_COLLECTION as C, jsonObject } from './digitalEmployeeRecords.js';
import { VISIBLE_DIGITAL_EMPLOYEE_AGENT_ROLES, visibleDigitalEmployeeAgentRole } from '../digitalEmployees/agentRoles.js';
import { buildDailyTotals, normalizeMetricValues, type MetricSnapshot } from '../socialMetrics/aggregation.js';

const DAY = 86_400_000;
const TIME_ZONE = 'Asia/Shanghai' as const;
const FINISHED = new Set(['succeeded', 'cancelled', 'skipped']);

export type OverviewAvailability = 'available' | 'unavailable';
type SourceRead = { availability: OverviewAvailability; items: Record_[]; error?: string };
type WeekRange = { startsAt: string; endsAt: string; timeZone: typeof TIME_ZONE };

function dateOnly(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

export function mobileWorkbenchWeekRange(now = new Date(), requestedStart?: unknown): WeekRange {
  const china = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const monday = new Date(Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const requested = dateOnly(requestedStart);
  const startDay = requested || monday.toISOString().slice(0, 10);
  const parsed = Date.parse(`${startDay}T00:00:00+08:00`);
  if (!Number.isFinite(parsed)) throw Error('invalid_week_start');
  const local = new Date(parsed + 8 * 60 * 60 * 1000);
  if (local.getUTCDay() !== 1) throw Error('week_start_must_be_monday');
  return {
    startsAt: new Date(parsed).toISOString(),
    endsAt: new Date(parsed + 7 * DAY - 1).toISOString(),
    timeZone: TIME_ZONE,
  };
}

async function readAll(store: DataStore, collection: string, where: Where): Promise<SourceRead> {
  try {
    const items: Record_[] = [];
    for (let page = 1; ; page += 1) {
      const result = await store.list<Record_>(collection, { where, sort: 'id', page, perPage: 200 });
      // Some adapters/tests do not enforce where. Keep tenant scope at this boundary.
      items.push(...result.items.filter(item => Object.entries(where).every(([key, value]) => item[key] === value)));
      if (page >= Math.max(1, Number(result.totalPages) || 1)) break;
    }
    return { availability: 'available', items };
  } catch (error) {
    return { availability: 'unavailable', items: [], error: error instanceof Error ? error.message : 'read_failed' };
  }
}

function millis(value: unknown): number {
  const result = Date.parse(String(value || ''));
  return Number.isFinite(result) ? result : 0;
}

function within(value: unknown, range: WeekRange): boolean {
  const point = millis(value);
  return point >= millis(range.startsAt) && point <= millis(range.endsAt);
}

function metric(value: number | null, availability: OverviewAvailability, source: string, range: WeekRange, note?: string) {
  return { value, availability, source, range, ...(note ? { note } : {}) };
}

function postStatus(row: Record_): string {
  const stats = jsonObject<Record<string, unknown>>(row.stats, {});
  return String(stats.status || (row.platform_post_id ? 'published' : 'scheduled'));
}

function hasPublishReceipt(row: Record_): boolean {
  if (String(row.platform_post_id || '').trim()) return true;
  const results = jsonObject<Record<string, unknown>>(jsonObject<Record<string, unknown>>(row.stats, {}).publishResults, {});
  return Object.values(results).some(value => {
    const result = jsonObject<Record<string, unknown>>(value, {});
    return Boolean(String(result.postId || result.platformPostId || result.providerMessageId || '').trim());
  });
}

function publicInquiry(row: Record_, qualification: Record_) {
  const sourceContentId = String(row.contentId || '').trim();
  const accountId = String(row.accountId || '').trim();
  return {
    id: row.id,
    occurredAt: String(row.occurredAt || row.created_at || ''),
    kind: String(row.kind || 'unknown'),
    platform: String(row.platform || 'unknown'),
    accountId: accountId || null,
    contentId: sourceContentId || null,
    sourceStatus: sourceContentId ? 'known' : 'unknown',
    qualification: {
      status: 'qualified', authority: String(qualification.authority),
      confirmedAt: String(qualification.confirmed_at || ''),
    },
  };
}

export async function buildMobileWorkbenchOverview(store: DataStore, tenantId: string, range: WeekRange) {
  const [goalsRead, tasksRead, postsRead, interactionsRead, qualificationsRead, metricsRead] = await Promise.all([
    readAll(store, C.goals, { tenant_id: tenantId }),
    readAll(store, C.tasks, { tenant_id: tenantId }),
    readAll(store, 'posts', { tenant_id: tenantId }),
    readAll(store, 'social_interaction_writebacks', { tenant_id: tenantId }),
    readAll(store, 'social_sales_qualifications', { tenant_id: tenantId }),
    readAll(store, 'social_metric_snapshots', { tenant_id: tenantId }),
  ]);
  const start = millis(range.startsAt); const end = millis(range.endsAt);
  const goalIds = new Set(goalsRead.items.filter(goal => millis(goal.starts_at) <= end && millis(goal.ends_at) >= start).map(goal => goal.id));
  // A goal may span several weeks. Its whole task history must not leak into
  // every overlapping week, so persisted task creation time is the weekly
  // ownership boundary. Records without that boundary cannot be counted.
  const weekTasks = tasksRead.items.filter(task => goalIds.has(String(task.goal_id)) && within(task.created_at, range));
  const completedTasks = weekTasks.filter(task => task.status === 'succeeded');
  const taskDrilldown = weekTasks.map(task => ({
    id: task.id,
    title: String(task.title || ''),
    status: String(task.status || 'unknown'),
    agentRole: visibleDigitalEmployeeAgentRole(String(task.agent_role || ''), String(task.task_key || '')),
    runId: String(task.run_id || '') || null,
    updatedAt: String(task.updated_at || '') || null,
    version: Number.isFinite(Number(task.task_version)) ? Number(task.task_version) : null,
  })).sort((left, right) => millis(right.updatedAt) - millis(left.updatedAt));
  const openTasks = tasksRead.items.filter(task => !FINISHED.has(String(task.status)));

  const agents = VISIBLE_DIGITAL_EMPLOYEE_AGENT_ROLES.map(role => {
    const owned = openTasks.filter(task => visibleDigitalEmployeeAgentRole(String(task.agent_role || ''), String(task.task_key || '')) === role);
    const updatedAt = owned.reduce((latest, task) => millis(task.updated_at) > millis(latest) ? String(task.updated_at || '') : latest, '');
    const active = [...owned].sort((a, b) => millis(b.updated_at) - millis(a.updated_at))[0];
    return {
      role,
      availability: tasksRead.availability,
      status: tasksRead.availability === 'unavailable' ? 'unknown' : active ? String(active.status || 'unknown') : 'idle',
      currentTask: active ? { id: active.id, title: String(active.title || ''), status: String(active.status || 'unknown'), runId: String(active.run_id || '') || null } : null,
      openTaskCount: tasksRead.availability === 'available' ? owned.length : null,
      updatedAt: updatedAt || null,
      source: C.tasks,
    };
  });

  const weekPosts = postsRead.items.filter(row => within(row.published_at || row.created_at || row.created, range));
  const schedule = weekPosts.map(row => {
    const stats = jsonObject<Record<string, unknown>>(row.stats, {});
    return ({
    id: row.id, title: String(row.title || '未命名内容'), platform: String(row.platform || 'unknown'),
    scheduledAt: String(row.published_at || row.created_at || row.created || ''), status: postStatus(row),
    publishReceipt: hasPublishReceipt(row) ? 'verified' : 'unknown',
    taskId: String(row.task_id || row.workflow_task_id || '') || null,
    contentId: String(row.content_id || row.contentId || '') || null,
    accountLabel: String(stats.accountLabel || '') || null,
    stage: String(stats.stage || '') || null,
    agentRole: String(stats.agentRole || '') || null,
    publishError: String(stats.publishError || '') || null,
  }); }).sort((a, b) => millis(a.scheduledAt) - millis(b.scheduledAt));
  const published = weekPosts.filter(hasPublishReceipt);

  const latestQualification = new Map<string, Record_>();
  for (const item of qualificationsRead.items.filter(item => millis(item.confirmed_at) <= end)) {
    const interactionId = String(item.interaction_id || '');
    const prior = latestQualification.get(interactionId);
    if (interactionId && (!prior || millis(item.confirmed_at) > millis(prior.confirmed_at))) latestQualification.set(interactionId, item);
  }
  const inquiries = interactionsRead.items.filter(item => item.kind !== 'comment' && within(item.occurredAt || item.created_at, range)).flatMap(item => {
    const qualification = latestQualification.get(item.id);
    return qualification?.status === 'qualified' && ['sales', 'crm'].includes(String(qualification.authority)) ? [publicInquiry(item, qualification)] : [];
  }).sort((a, b) => millis(b.occurredAt) - millis(a.occurredAt));
  const inquiryAvailable = interactionsRead.availability === 'available' && qualificationsRead.availability === 'available';

  const snapshots: MetricSnapshot[] = metricsRead.items.map(item => ({
    id: item.id, platform: String(item.platform || ''), accountId: String(item.account_id || ''),
    contentId: String(item.content_id || '') || undefined, capturedAt: String(item.captured_at || ''),
    valueKind: item.value_kind === 'daily' ? 'daily' as const : 'cumulative' as const, metrics: normalizeMetricValues(item.metrics),
  })).filter(item => item.platform && item.accountId && millis(item.capturedAt));
  const startDay = new Date(start + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const endDay = new Date(end + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const viewPoints = buildDailyTotals(snapshots, 'views').filter(point => point.date >= startDay && point.date <= endDay);
  const views = viewPoints.length ? viewPoints.reduce((sum, point) => sum + point.value, 0) : null;

  const taskAvailable = goalsRead.availability === 'available' && tasksRead.availability === 'available';
  return {
    generatedAt: new Date().toISOString(), scope: 'authenticated_tenant', range,
    definitions: {
      tasks: '周起止有交集的周目标下、且 created_at 落在本周的任务；按 task.id 计数。缺少 created_at 的任务不计入。',
      completed: '上述任务中 status=succeeded 的任务。',
      publishedVideos: '周期内 posts 记录且存在平台 post id 或 provider 发布回执的内容。',
      exposure: 'social_metric_snapshots.views；daily 值按日求和，cumulative 值按同一平台账号/内容相邻快照求差。首个累计快照仅作基线。',
      qualifiedInquiries: '周期内发生的非评论互动，在周期结束前最新销售/可信 CRM 资格结论为 qualified。',
    },
    metrics: {
      tasks: metric(taskAvailable ? weekTasks.length : null, taskAvailable ? 'available' : 'unavailable', `${C.goals}.starts_at/ends_at + ${C.tasks}.goal_id/created_at`, range),
      completed: metric(taskAvailable ? completedTasks.length : null, taskAvailable ? 'available' : 'unavailable', `${C.tasks}.status=succeeded`, range),
      publishedVideos: metric(postsRead.availability === 'available' ? published.length : null, postsRead.availability, 'posts.platform_post_id + posts.stats.publishResults', range),
      exposure: metric(metricsRead.availability === 'available' && views !== null ? views : null, metricsRead.availability === 'available' && views !== null ? 'available' : 'unavailable', 'social_metric_snapshots.metrics.views', range, views === null ? '缺少足够的日值或累计快照，不能把缺失曝光显示为 0' : undefined),
      qualifiedInquiries: metric(inquiryAvailable ? inquiries.length : null, inquiryAvailable ? 'available' : 'unavailable', 'social_interaction_writebacks + latest sales/CRM social_sales_qualifications', range),
    },
    agents: { availability: tasksRead.availability, coverage: 'all_open_tasks_in_authenticated_tenant', items: agents },
    taskDrilldown: { availability: taskAvailable ? 'available' : 'unavailable', source: `${C.goals} + ${C.tasks}`, range, total: taskAvailable ? taskDrilldown.length : null, items: taskAvailable ? taskDrilldown : [] },
    contentSchedule: { availability: postsRead.availability, source: 'posts', range, items: postsRead.availability === 'available' ? schedule : [] },
    inquiryDrilldown: { availability: inquiryAvailable ? 'available' : 'unavailable', source: 'social_interaction_writebacks + latest sales/CRM social_sales_qualifications', range, total: inquiryAvailable ? inquiries.length : null, items: inquiryAvailable ? inquiries : [] },
  };
}

export function createMobileWorkbenchOverviewRouter(store: DataStore) {
  const router = Router();
  router.get('/overview', async (req: Request, res: Response) => {
    const { tenantId } = res.locals as AuthLocals;
    try {
      const range = mobileWorkbenchWeekRange(new Date(), req.query.weekStart);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(await buildMobileWorkbenchOverview(store, tenantId, range));
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (['invalid_week_start', 'week_start_must_be_monday'].includes(code)) { res.status(400).json({ error: code }); return; }
      res.status(503).json({ error: '工作台周概览读取失败，请重试' });
    }
  });
  return router;
}
