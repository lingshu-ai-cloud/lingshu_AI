import { createHash } from 'node:crypto';
import { store, type Record_ } from '../storage/index.js';
import { createPlatformAdTask, getPlatformAdTask, validatePlatformAdTask, type PlatformAdTask } from './tasks.js';
import { withPlatformAdTaskLock } from './taskLock.js';

export const AD_HANDOFF_COLLECTION = 'platform_ad_handoffs';
export class AdHandoffError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export type AdHandoff = {
  id: string; tenant_id: string; goalId: string; adTaskId: string;
  objective: string; evidence: string; expectedOutcome: string; constraints: string[];
  createdAt: string; createdBy: string;
};

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    try { return strings(JSON.parse(value)); } catch { return value ? [value] : []; }
  }
  return [];
}

export async function goalAdHandoffs(tenantId: string, goalId: string): Promise<Array<AdHandoff & { task: PlatformAdTask | null }>> {
  const goal = await store.getById<Record_>('weekly_goals', goalId);
  if (!goal || goal.tenant_id !== tenantId) throw new AdHandoffError('未找到经营目标', 404);
  const links = await store.list<AdHandoff>(AD_HANDOFF_COLLECTION, { where: { tenant_id: tenantId, goalId }, perPage: 200 });
  return Promise.all(links.items.map(async link => ({ ...link, task: await getPlatformAdTask(tenantId, link.adTaskId) })));
}

/** A retry reuses a persisted intent. No advertising authority is inferred from a business goal. */
export async function handoffGoalToAds(tenantId: string, userId: string, goalId: string, input: Record<string, unknown>): Promise<AdHandoff & { task: PlatformAdTask }> {
  return withPlatformAdTaskLock(tenantId, `handoff:${goalId}:${String(input.requestId || '')}`, () => createHandoff(tenantId, userId, goalId, input));
}

async function createHandoff(tenantId: string, userId: string, goalId: string, input: Record<string, unknown>): Promise<AdHandoff & { task: PlatformAdTask }> {
  const goal = await store.getById<Record_>('weekly_goals', goalId);
  if (!goal || goal.tenant_id !== tenantId) throw new AdHandoffError('未找到经营目标', 404);
  if (['completed', 'cancelled'].includes(String(goal.status))) throw new AdHandoffError('已结束的经营目标不能发起新投放', 409);
  const requestId = String(input.requestId || '');
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw new AdHandoffError('缺少有效的交接请求标识');
  const id = createHash('sha256').update(JSON.stringify([tenantId, goalId, requestId])).digest('hex').slice(0, 15);
  const existing = await store.getById<AdHandoff>(AD_HANDOFF_COLLECTION, id);
  if (existing) {
    const task = await getPlatformAdTask(tenantId, existing.adTaskId);
    if (task) return { ...existing, task };
    throw new AdHandoffError('交接尚未完成，请核验后再试', 409);
  }
  const evidence = String(input.evidence || '').trim().slice(0, 4000);
  if (!evidence) throw new AdHandoffError('请说明本次选择投放的经营依据');
  const draftInput = { name: input.name || `${String(goal.title || '经营目标')} · 投放`, video: input.video,
    goal: input.goal, market: input.market, budget: input.budget, currency: input.currency, channels: input.channels };
  validatePlatformAdTask(draftInput);
  const intent: AdHandoff = {
    id, tenant_id: tenantId, goalId, adTaskId: '', objective: String(goal.objective || goal.title || ''),
    evidence, expectedOutcome: `经营目标：${String(goal.metric || '')} ${String(goal.target ?? '')} ${String(goal.unit || '')}（目标值，非投放预测）`,
    constraints: strings(goal.constraints), createdAt: new Date().toISOString(), createdBy: userId,
  };
  // Reserve before creating a draft. A partial failure stays visible instead of creating a duplicate on retry.
  if (!await store.create(AD_HANDOFF_COLLECTION, intent)) throw new AdHandoffError('交接请求未能保存，请重试', 503);
  const task = await createPlatformAdTask(tenantId, userId, draftInput, { sourceContext: {
    runId: '', taskId: '', goalId, objective: intent.objective, evidence: intent.evidence,
    expectedOutcome: intent.expectedOutcome, constraints: intent.constraints.join('\n'),
  } });
  if (!await store.update(AD_HANDOFF_COLLECTION, id, { adTaskId: task.id })) throw new AdHandoffError(`草稿已保存（${task.id}），交接关联待恢复，请勿重复创建`, 503);
  return { ...intent, adTaskId: task.id, task };
}
