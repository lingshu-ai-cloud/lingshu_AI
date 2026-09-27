import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { store } from '../storage/index.js';
import type { PlatformAdWorkerStatus } from '../../shared/platformAdAutomation.js';
export const AD_WORKER_HEALTH = 'platform_ad_worker_health';
export const AD_WORKER_INTERVAL_MS = 5 * 60_000;
const workerId = randomUUID();
type Health = { id: string; tenant_id: string; workerId: string; state: 'checking' | 'completed' | 'failed'; lastStartedAt: string; lastCompletedAt?: string; lastFailedAt?: string; nextCheckAt: string; updatedAt: string };
export async function withAdWorkerEvidence<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
  const now = new Date().toISOString();
  const existing = (await store.list<Health>(AD_WORKER_HEALTH, { where: { tenant_id: tenantId, workerId }, perPage: 1 })).items[0];
  if (existing && (existing.tenant_id !== tenantId || existing.workerId !== workerId)) throw new Error('后台检查证据归属不匹配');
  const start = { tenant_id: tenantId, workerId, state: 'checking', lastStartedAt: now, nextCheckAt: new Date(Date.now() + AD_WORKER_INTERVAL_MS).toISOString(), updatedAt: now };
  const record = existing ? await store.update(AD_WORKER_HEALTH, existing.id, start) : await store.create(AD_WORKER_HEALTH, start);
  if (!record) throw new Error('后台检查证据无法持久化');
  const id = existing ? existing.id : typeof record === 'object' ? record.id : '';
  if (!id) throw new Error('后台检查证据缺少记录标识');
  const persisted = await store.getById<Health>(AD_WORKER_HEALTH, id);
  if (!persisted || Object.entries(start).some(([key, value]) => !isDeepStrictEqual((persisted as unknown as Record<string, unknown>)[key], value))) throw new Error('后台检查证据未完整持久化');
  try {
    const result = await work();
    const completed = { state: 'completed', lastCompletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (!await store.update(AD_WORKER_HEALTH, id, completed)) throw new Error('后台检查完成证据无法持久化');
    const saved = await store.getById<Health>(AD_WORKER_HEALTH, id);
    if (!saved || saved.tenant_id !== tenantId || saved.workerId !== workerId || saved.state !== completed.state || saved.lastCompletedAt !== completed.lastCompletedAt) throw new Error('后台检查完成证据未完整持久化');
    return result;
  } catch (error) {
    await store.update(AD_WORKER_HEALTH, id, { state: 'failed', lastFailedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    throw error;
  }
}
export async function readAdWorkerStatus(tenantId: string, now = Date.now()): Promise<PlatformAdWorkerStatus> {
  const configuredEnabled = process.env.PLATFORM_ADS_AUTOMATION_ENABLED === 'true';
  const health = (await store.list<Health>(AD_WORKER_HEALTH, { where: { tenant_id: tenantId }, sort: '-updatedAt', perPage: 1 })).items[0];
  const base = { configuredEnabled, lastStartedAt: health?.lastStartedAt || null, lastCompletedAt: health?.lastCompletedAt || null, lastFailedAt: health?.lastFailedAt || null, nextCheckAt: health?.nextCheckAt || null };
  if (!health || health.tenant_id !== tenantId) return { configuredEnabled, state: 'unknown', explanation: configuredEnabled ? '未收到本租户后台检查证据；配置开启不代表进程正在运行' : '当前服务未配置自动检查；未收到本租户后台检查证据', lastStartedAt: null, lastCompletedAt: null, lastFailedAt: null, nextCheckAt: null };
  if (!['checking', 'completed', 'failed'].includes(health.state) || !health.workerId || !Number.isFinite(Date.parse(health.lastStartedAt)) || !Number.isFinite(Date.parse(health.nextCheckAt))) return { ...base, state: 'unknown', explanation: '后台检查证据不完整，无法判断运行状态' };
  const stateTime = health.state === 'completed' ? health.lastCompletedAt : health.state === 'failed' ? health.lastFailedAt : health.lastStartedAt;
  if (!stateTime || !Number.isFinite(Date.parse(stateTime)) || Date.parse(stateTime) < Date.parse(health.lastStartedAt) || Date.parse(stateTime) > now) return { ...base, state: 'unknown', explanation: '后台检查状态缺少有效时间证据，无法判断运行状态' };
  const age = now - Date.parse(health.updatedAt);
  if (!Number.isFinite(age) || age < 0 || age > AD_WORKER_INTERVAL_MS * 2) return { ...base, state: 'stale', explanation: '本租户检查证据已过期，当前运行状态未知' };
  return { ...base, state: health.state, explanation: health.state === 'checking' ? '已收到本租户检查开始证据' : health.state === 'failed' ? '最近一次后台检查失败，请核对运行记录' : '最近一次后台检查已完成；下次检查时间为预计时间' };
}
