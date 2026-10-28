import { createHash } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { contentGenerationAuthorization } from '../../shared/contracts/contentGenerationAuthorization.js';
import { videoAnalysisOf } from '../lib/videoAnalysisCodec.js';
import { jsonObject, type PlanRecord, type RunRecord, type GoalRecord } from './records.js';

export const weeklyImageTaskId = (tenantId: string, planId: string, slotId: string) =>
  `weeklyimage-${createHash('sha256').update(JSON.stringify([tenantId, planId, slotId])).digest('hex').slice(0, 32)}`;

export class WeeklyImageAuthorityError extends Error {
  constructor(readonly code: string) { super(code); }
}

/** Recheck the approved, frozen image slot at dispatch and before a paid call. */
export async function assertWeeklyImageAuthority(store: DataStore, tenantId: string, task: SocialImageCreationTask) {
  const binding = task.productionRuntime?.binding;
  if (!binding || !binding.contentTaskId.startsWith('weeklyimage-')) return;
  const rows = await store.list<Record<string, unknown>>('starter_social_content_tasks', {
    where: { tenant_id: tenantId, task_id: binding.contentTaskId }, perPage: 2,
  });
  const row = rows.totalItems === 1 ? rows.items[0] : null;
  const planId = String(row?.weekly_plan_id || '');
  const plan = planId ? await store.getById<PlanRecord>('weekly_plans', planId) : null;
  if (!plan || plan.tenant_id !== tenantId || plan.status !== 'approved') throw new WeeklyImageAuthorityError('weekly_image_approval_missing');
  const body = jsonObject<Record<string, unknown>>(plan.plan, {});
  const pack = body.businessPackage as WeeklyPackage | undefined;
  const slot = pack?.mixedContentSlots?.find(item => item.slotId === binding.deliverableKey
    && item.kind === 'image' && item.productionRole === 'original');
  if (!slot || !contentGenerationAuthorization(body.contentGenerationAuthorization)
    || !String(body.packageApprovedBy || '') || !String(body.packageApprovedAt || '')
    || binding.contentTaskId !== weeklyImageTaskId(tenantId, planId, slot.slotId)
    || slot.productId !== task.contentBrief.productRefs[0]
    || slot.referenceId !== task.referenceSnapshot?.sourceRecordId
    || slot.referenceSourceUrl !== task.referenceSnapshot?.sourceUrl) throw new WeeklyImageAuthorityError('weekly_image_approval_scope_changed');
  const [goal, runs, reference] = await Promise.all([
    store.getById<GoalRecord>('weekly_goals', plan.goal_id),
    store.list<RunRecord>('workflow_runs', { where: { tenant_id: tenantId, plan_id: planId }, perPage: 2 }),
    store.getById<Record<string, unknown>>('trend_videos', slot.referenceId!),
  ]);
  const urls = reference ? videoAnalysisOf(reference).imageUrls : null;
  if (goal?.tenant_id !== tenantId || goal.status !== 'active'
    || runs.totalItems !== 1 || !runs.items[0] || ['paused', 'cancelled', 'failed', 'completed'].includes(runs.items[0].status)
    || String(reference?.tenantId || reference?.tenant_id || '') !== tenantId
    || !Array.isArray(urls) || urls.length !== 1 || urls[0] !== task.referenceSnapshot?.imageUrls[0]) {
    throw new WeeklyImageAuthorityError('weekly_image_approval_scope_changed');
  }
}
