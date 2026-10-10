import { store } from '../storage/index.js';
import { withPlatformAdTaskLock } from './taskLock.js';
export { withPlatformAdTaskLock } from './taskLock.js';
import { emptyAdPlanConfiguration, type AdManagement, type AdPlanConfiguration, type AdAuthorization, type AdProposal, type AdSourceContext, type AdManagementMode, type AdCurrency } from '../../src/lib/platformAdsDomain.js';

export const PLATFORM_AD_TASKS_COLLECTION = 'platform_ad_tasks';
export const PLATFORM_AD_CHANNELS = ['Facebook', 'Instagram', 'TikTok', 'YouTube'] as const;
export const PLATFORM_AD_GOALS = ['提升有效视频观看', '提升互动与主页增长', '扩大目标人群覆盖', '获取线索或转化', '提升网站访问'] as const;

export type PlatformAdTask = AdManagement & {
  version: number;
  authorization: AdAuthorization | null;
  proposal: AdProposal | null;
  sourceContext: AdSourceContext | null;
  managementHistory: Array<{ at: string; userId: string; from: AdManagementMode; to: AdManagementMode; version: number }>;
  id: string;
  name: string;
  video: string;
  goal: string;
  market: string;
  budget: number;
  currency: AdCurrency;
  channels: string[];
  status: 'draft' | 'paused' | 'active' | 'error' | 'unknown';
  createdAt: string;
  updatedAt: string;
};

type StoredTask = PlatformAdTask & { tenant_id: string; created_by: string };

export class PlatformAdTaskValidationError extends Error {}
export class PlatformAdTaskConflictError extends PlatformAdTaskValidationError {}

const text = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);
export function adCurrency(value: unknown): AdCurrency {
  if (value === undefined || value === '') return 'USD';
  if (value !== 'USD' && value !== 'CNY') throw new PlatformAdTaskValidationError('投放币种仅支持 USD 或 CNY');
  return value;
}

function configuration(input: unknown, budget: number): AdPlanConfiguration {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const startsAt = text(raw.startsAt, 40), endsAt = text(raw.endsAt, 40);
  for (const date of [startsAt, endsAt]) {
    if (date && (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(date) || !Number.isFinite(Date.parse(date)))) throw new PlatformAdTaskValidationError('投放时间须包含有效时区');
  }
  if (endsAt && !startsAt) throw new PlatformAdTaskValidationError('请先设置开始时间');
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) throw new PlatformAdTaskValidationError('结束时间须晚于开始时间');
  const dailyBudget = raw.dailyBudget == null || raw.dailyBudget === '' ? null : Number(raw.dailyBudget);
  if (dailyBudget !== null && (!Number.isFinite(dailyBudget) || dailyBudget < 1 || dailyBudget > budget)) throw new PlatformAdTaskValidationError('日预算须大于等于 1 且不超过总预算');
  return { startsAt, endsAt, dailyBudget, audience: text(raw.audience, 2000), placements: text(raw.placements, 1000) };
}

export function validatePlatformAdTask(input: Record<string, unknown>): Omit<PlatformAdTask, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'version' | 'authorization' | 'proposal' | 'sourceContext' | 'managementHistory'> {
  const name = text(input.name, 80);
  const video = text(input.video, 120);
  const market = text(input.market, 80);
  const goal = text(input.goal, 80);
  const budget = Number(input.budget);
  const currency = adCurrency(input.currency);
  const channels = Array.from(new Set(Array.isArray(input.channels) ? input.channels.map(value => text(value, 30)) : []));
  if (!name || !video || !market) throw new PlatformAdTaskValidationError('请完整填写任务名称、投放视频和目标市场');
  if (!PLATFORM_AD_GOALS.includes(goal as typeof PLATFORM_AD_GOALS[number])) throw new PlatformAdTaskValidationError('推广目标无效');
  if (!Number.isFinite(budget) || budget < 1 || budget > 1_000_000) throw new PlatformAdTaskValidationError(`预算须为 1 至 1,000,000 ${currency}`);
  if (!channels.length || channels.some(channel => !PLATFORM_AD_CHANNELS.includes(channel as typeof PLATFORM_AD_CHANNELS[number]))) {
    throw new PlatformAdTaskValidationError('请至少选择一个有效投放渠道');
  }
  if (currency === 'CNY' && channels.some(channel => channel !== 'Facebook' && channel !== 'Instagram')) throw new PlatformAdTaskValidationError('CNY 当前仅支持 Meta 的 Facebook 和 Instagram 渠道');
  // Provenance and execution authority cannot be granted through draft input.
  if (input.creationSource !== undefined && input.creationSource !== 'manual') throw new PlatformAdTaskValidationError('创建来源由对应创编服务确定');
  if (input.managementMode !== undefined && input.managementMode !== 'manual') throw new PlatformAdTaskValidationError('请通过托管授权流程切换管理方式');
  return { name, video, market, goal, budget: Math.round(budget * 100) / 100, currency, channels,
    creationSource: 'manual', managementMode: 'manual', configuration: configuration(input.configuration, budget) };
}

function publicTask(record: StoredTask): PlatformAdTask {
  return {
    id: record.id,
    version: Number(record.version || 1), authorization: record.authorization || null,
    proposal: record.proposal || null, sourceContext: record.sourceContext || null,
    managementHistory: Array.isArray(record.managementHistory) ? record.managementHistory : [],
    creationSource: record.creationSource || 'manual',
    managementMode: record.managementMode || 'manual',
    configuration: { ...emptyAdPlanConfiguration, ...record.configuration },
    name: String(record.name || ''), video: String(record.video || ''), goal: String(record.goal || ''), market: String(record.market || ''),
    budget: Number(record.budget || 0), currency: adCurrency(record.currency), channels: Array.isArray(record.channels) ? record.channels.map(String) : [], status: ['draft', 'paused', 'active', 'error', 'unknown'].includes(record.status) ? record.status : 'draft',
    createdAt: String(record.createdAt || (record as Record<string, unknown>).created || ''),
    updatedAt: String(record.updatedAt || (record as Record<string, unknown>).updated || ''),
  };
}

export async function listPlatformAdTasks(tenantId: string): Promise<PlatformAdTask[]> {
  const result = await store.list<StoredTask>(PLATFORM_AD_TASKS_COLLECTION, { where: { tenant_id: tenantId }, sort: '-createdAt', perPage: 200 });
  return result.items.map(publicTask);
}

export async function getPlatformAdTask(tenantId: string, id: string): Promise<PlatformAdTask | null> {
  const record = await store.getById<StoredTask>(PLATFORM_AD_TASKS_COLLECTION, id);
  return record?.tenant_id === tenantId ? publicTask(record) : null;
}

export async function createPlatformAdTask(tenantId: string, userId: string, input: Record<string, unknown>, trusted?: { proposal?: AdProposal; creationSource?: 'ai_assisted' | 'ai_managed'; sourceContext?: AdSourceContext }): Promise<PlatformAdTask> {
  const valid = validatePlatformAdTask(input);
  const now = new Date().toISOString();
  const created = await store.create<StoredTask>(PLATFORM_AD_TASKS_COLLECTION, { ...valid, creationSource: trusted?.creationSource || 'manual', proposal: trusted?.proposal || null, sourceContext: trusted?.sourceContext || null, version: 1, authorization: null, managementHistory: [], tenant_id: tenantId, created_by: userId, status: 'draft', createdAt: now, updatedAt: now });
  if (!created) throw new Error('投放草稿保存失败');
  return publicTask(created);
}

export async function updatePlatformAdTask(tenantId: string, id: string, input: Record<string, unknown>): Promise<PlatformAdTask | null> {
  return withPlatformAdTaskLock(tenantId, id, () => updateTaskUnlocked(tenantId, id, input));
}
async function updateTaskUnlocked(tenantId: string, id: string, input: Record<string, unknown>): Promise<PlatformAdTask | null> {
  const existing = await store.getById<StoredTask>(PLATFORM_AD_TASKS_COLLECTION, id);
  if (!existing || existing.tenant_id !== tenantId) return null;
  if (existing.creationSource === 'platform_import') throw new PlatformAdTaskValidationError('导入计划当前仅支持只读查看，请在原广告平台编辑');
  const executions = await store.list<{ status: string }>('platform_ad_executions', { where: { tenant_id: tenantId, taskId: id }, perPage: 200 });
  if (executions.items.some(execution => execution.status !== 'FAILED') || executions.totalPages > 1) throw new PlatformAdTaskValidationError('计划已有平台执行记录，不能仅修改本地草稿；请使用平台执行动作或新建方案');
  if (input.expectedVersion !== undefined && input.expectedVersion !== Number(existing.version || 1)) throw new PlatformAdTaskConflictError('计划已更新，请刷新后重试');
  if (existing.managementMode && existing.managementMode !== 'manual') throw new PlatformAdTaskValidationError('请先接管计划或更新托管边界再编辑');
  const existingCurrency = adCurrency(existing.currency);
  if (input.currency !== undefined && input.currency !== existingCurrency) throw new PlatformAdTaskValidationError('已有计划不能更换币种，请新建对应币种的计划');
  const valid = validatePlatformAdTask({ ...input, currency: existingCurrency });
  valid.creationSource = existing.creationSource || 'manual';
  if (input.configuration === undefined) valid.configuration = configuration(existing.configuration, valid.budget);
  const updatedAt = new Date().toISOString();
  const version = Number(existing.version || 1) + 1;
  // Any draft edit changes the premises of an AI proposal. Drop it rather than
  // leaving old enterprise-fact claims attached to a newly edited plan.
  const proposal = null;
  if (!await store.update(PLATFORM_AD_TASKS_COLLECTION, id, { ...valid, proposal, version, updatedAt })) throw new Error('投放草稿更新失败');
  return publicTask({ ...existing, ...valid, proposal, version, updatedAt });
}

export function validateAdAuthorization(input: unknown, taskBudget: number): AdAuthorization {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const accountIds = Array.from(new Set(Array.isArray(raw.accountIds) ? raw.accountIds.map(id => text(id, 100)).filter(Boolean) : []));
  const allowed = ['create', 'activate', 'pause', 'resume', 'adjust_budget'];
  const actions = Array.from(new Set(Array.isArray(raw.allowedActions) ? raw.allowedActions.map(String) : []));
  const maxDailyBudget = Number(raw.maxDailyBudget), maxTotalBudget = Number(raw.maxTotalBudget), maxAdjustmentPercent = Number(raw.maxAdjustmentPercent);
  const expiresAt = text(raw.expiresAt, 40);
  if (!accountIds.length || accountIds.length > 50 || !actions.length || actions.some(action => !allowed.includes(action))) throw new PlatformAdTaskValidationError('请指定账户和允许的动作');
  if (![maxDailyBudget, maxTotalBudget, maxAdjustmentPercent].every(Number.isFinite) || maxDailyBudget < 1 || maxTotalBudget < 1 || maxTotalBudget > taskBudget || maxDailyBudget > maxTotalBudget || maxAdjustmentPercent < 0 || maxAdjustmentPercent > 100) throw new PlatformAdTaskValidationError('授权额度必须在计划预算内，调整比例须在 0–100 之间');
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(expiresAt) || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) throw new PlatformAdTaskValidationError('授权有效期须为未来的带时区时间');
  return { accountIds, allowedActions: actions as AdAuthorization['allowedActions'], maxDailyBudget, maxTotalBudget, maxAdjustmentPercent, expiresAt };
}

export async function changePlatformAdManagement(tenantId: string, userId: string, id: string, input: Record<string, unknown>): Promise<PlatformAdTask | null> {
  return withPlatformAdTaskLock(tenantId, id, () => changeManagementUnlocked(tenantId, userId, id, input));
}
async function changeManagementUnlocked(tenantId: string, userId: string, id: string, input: Record<string, unknown>): Promise<PlatformAdTask | null> {
  const existing = await store.getById<StoredTask>(PLATFORM_AD_TASKS_COLLECTION, id);
  if (!existing || existing.tenant_id !== tenantId) return null;
  if (input.expectedVersion !== Number(existing.version || 1)) throw new PlatformAdTaskConflictError('计划已更新，请刷新后重试');
  const mode = String(input.managementMode) as AdManagementMode;
  if (!['manual', 'suggest', 'approval', 'managed'].includes(mode)) throw new PlatformAdTaskValidationError('管理方式无效');
  if (existing.creationSource === 'platform_import' && mode !== 'manual') throw new PlatformAdTaskValidationError('导入计划当前仅支持只读查看，尚不能交给 AI 管理');
  const authorization = mode === 'manual' || mode === 'suggest' ? null : validateAdAuthorization(input.authorization, existing.budget);
  if (authorization) {
    for (const connectionId of authorization.accountIds) {
      const account = await store.getById<{ tenant_id: string; currency: string; provider: string; status: string }>('platform_ad_connections', connectionId);
      if (!account || account.tenant_id !== tenantId) throw new PlatformAdTaskValidationError('授权账户不存在或不属于当前企业');
      if (account.currency !== adCurrency(existing.currency)) throw new PlatformAdTaskValidationError('授权账户币种须与计划一致，不能混合币种预算');
      if (account.status !== 'connected') throw new PlatformAdTaskValidationError('授权账户当前不可用');
      if (existing.currency === 'CNY' && account.provider !== 'meta') throw new PlatformAdTaskValidationError('CNY 授权当前仅支持 Meta 账户');
    }
  }
  const updatedAt = new Date().toISOString(), version = Number(existing.version || 1) + 1;
  const managementHistory = [...(existing.managementHistory || []), { at: updatedAt, userId, from: existing.managementMode || 'manual' as AdManagementMode, to: mode, version }];
  const patch = { managementMode: mode, authorization, version, updatedAt, managementHistory };
  if (!await store.update(PLATFORM_AD_TASKS_COLLECTION, id, patch)) throw new Error('管理方式更新失败');
  return publicTask({ ...existing, ...patch });
}
