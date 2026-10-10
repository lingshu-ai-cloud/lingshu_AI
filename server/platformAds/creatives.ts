import { createHash } from 'node:crypto';
import type { PlatformAdCreative, PlatformAdCreativeSource } from '../../shared/platformAdCreatives.js';
import { store } from '../storage/index.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from '../starter198/repository.js';
import { findSocialRecord, socialArtifact } from '../starter198/socialContentRecords.js';
import { resolveSocialArtifactMedia, openSocialArtifactMedia, socialArtifactMediaFamily } from '../starter198/socialArtifactMedia.js';
import { getPlatformAdTask, PLATFORM_AD_TASKS_COLLECTION } from './tasks.js';
import { withPlatformAdTaskLock } from './taskLock.js';
import { AD_CONNECTIONS, type AdConnection } from './connections.js';

export const AD_CREATIVES_COLLECTION = 'platform_ad_creatives';
export type StoredPlatformAdCreative = PlatformAdCreative & { tenant_id: string; fileRef: string; attemptId?: string; uploadError?: string; uploadStartedAt?: string; uploadReceipt?: Record<string, unknown> };
export class PlatformAdCreativeError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function publicPlatformAdCreative(c: StoredPlatformAdCreative): PlatformAdCreative {
  const { id, taskId, taskVersion, sourceTaskId, artifactId, sha256, mimeType, size, name, connectionId, provider, platformVideoId, status, createdAt, updatedAt } = c;
  return { id, taskId, taskVersion, sourceTaskId, artifactId, sha256, mimeType, size, name, connectionId, provider, platformVideoId, status, createdAt, updatedAt };
}
const repository = createStarter198Repository();
function identity(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new PlatformAdCreativeError('素材标识无效');
  return value;
}
async function source(tenantId: string, sourceTaskId: string, artifactId: string) {
  const artifact = socialArtifact(await findSocialRecord({ repository, tenantId, collection: STARTER_COLLECTIONS.socialContentArtifacts,
    where: { task_id: sourceTaskId, artifact_id: artifactId }, notFoundCode: 'social_artifact_not_found' }));
  if (socialArtifactMediaFamily(artifact.kind, artifact.content) !== 'video') throw new PlatformAdCreativeError('请选择已保存的视频成片');
  const resolved = await resolveSocialArtifactMedia({ repository, tenantId, taskId: sourceTaskId, value: artifact });
  if (!resolved || !resolved.file.mimeType.startsWith('video/')) throw new PlatformAdCreativeError('视频文件尚未持久化');
  return resolved.file;
}
export async function listPlatformAdCreativeSources(tenantId: string, query: { page?: unknown; perPage?: unknown; sourceTaskId?: unknown } = {}) {
  const page = Math.max(1, Math.min(100000, Math.floor(Number(query.page) || 1)));
  const perPage = Math.max(1, Math.min(50, Math.floor(Number(query.perPage) || 20)));
  const result = await repository.list(STARTER_COLLECTIONS.socialContentArtifacts, tenantId, { page, perPage, sort: '-created_at', ...(query.sourceTaskId ? { where: { task_id: identity(query.sourceTaskId) } } : {}) });
  const items: PlatformAdCreativeSource[] = [];
  for (const record of result.items) {
    if (record.tenant_id !== tenantId) throw new PlatformAdCreativeError('素材存储归属异常', 503);
    const artifact = socialArtifact(record);
    if (socialArtifactMediaFamily(artifact.kind, artifact.content) !== 'video') continue;
    try {
      const file = await source(tenantId, artifact.taskId, artifact.artifactId);
      items.push({ sourceTaskId: artifact.taskId, artifactId: artifact.artifactId, name: file.name, mimeType: file.mimeType, size: file.size, sha256: file.sha256 });
    } catch { /* Unavailable/corrupt sources cannot be selected. */ }
  }
  return { items, page, perPage, totalPages: result.totalPages, totalItems: result.totalItems };
}
export async function getPlatformAdCreative(tenantId: string, id: string): Promise<StoredPlatformAdCreative | null> {
  const record = await store.getById<StoredPlatformAdCreative>(AD_CREATIVES_COLLECTION, id);
  return record?.tenant_id === tenantId ? record : null;
}
export async function listPlatformAdCreatives(tenantId: string, taskId: string) {
  if (!await getPlatformAdTask(tenantId, taskId)) throw new PlatformAdCreativeError('未找到投放计划', 404);
  const result = await store.list<StoredPlatformAdCreative>(AD_CREATIVES_COLLECTION, { where: { tenant_id: tenantId, taskId }, perPage: 200 });
  return result.items.filter(c => c.tenant_id === tenantId).map(publicPlatformAdCreative);
}
export async function validatePlatformAdCreativeSource(tenantId: string, id: string) {
  const creative = await getPlatformAdCreative(tenantId, id);
  if (!creative) throw new PlatformAdCreativeError('未找到投放素材', 404);
  const file = await source(tenantId, creative.sourceTaskId, creative.artifactId);
  if (file.fileRef !== creative.fileRef || file.sha256 !== creative.sha256) throw new PlatformAdCreativeError('素材版本已变化，请重新绑定', 409);
  return creative;
}
export async function openPlatformAdCreativeMedia(tenantId: string, id: string) {
  const creative = await validatePlatformAdCreativeSource(tenantId, id);
  const body = await openSocialArtifactMedia({ repository, tenantId, taskId: creative.sourceTaskId, descriptor: creative });
  return { creative, body };
}
export async function bindPlatformAdCreative(tenantId: string, taskId: string, input: Record<string, unknown>) {
  return withPlatformAdTaskLock(tenantId, taskId, async guard => {
    const task = await getPlatformAdTask(tenantId, taskId);
    if (!task) throw new PlatformAdCreativeError('未找到投放计划', 404);
    if (input.expectedVersion !== task.version) throw new PlatformAdCreativeError('计划已更新，请刷新后重试', 409);
    if (task.status !== 'draft' || task.managementMode !== 'manual' || task.creationSource === 'platform_import') throw new PlatformAdCreativeError('仅人工草稿可绑定素材', 409);
    for (const collection of ['platform_ad_executions', 'platform_ad_launches']) {
      const executions = await store.list<{ status: string }>(collection, { where: { tenant_id: tenantId, taskId }, perPage: 1 });
      if (executions.items.length || executions.totalItems) throw new PlatformAdCreativeError('计划已有平台执行记录，不能换绑素材', 409);
    }
    if (input.fileRef !== undefined || input.url !== undefined || input.path !== undefined) throw new PlatformAdCreativeError('仅接受已保存的社媒素材标识');
    const sourceTaskId = identity(input.sourceTaskId), artifactId = identity(input.artifactId), connectionId = identity(input.connectionId);
    const connection = await store.getById<AdConnection>(AD_CONNECTIONS, connectionId);
    if (!connection || connection.tenant_id !== tenantId) throw new PlatformAdCreativeError('未找到广告账户', 404);
    if (!['meta', 'tiktok'].includes(connection.provider) || connection.status !== 'connected') throw new PlatformAdCreativeError('广告账户当前不可用');
    if (connection.provider === 'meta' ? !task.channels.every(c => ['Facebook', 'Instagram'].includes(c)) : !task.channels.every(c => c === 'TikTok')) throw new PlatformAdCreativeError('账户与计划渠道不匹配');
    if (connection.currency !== task.currency) throw new PlatformAdCreativeError('账户与计划币种不匹配');
    if (input.platformVideoId !== undefined) throw new PlatformAdCreativeError('平台视频标识只能由验证上传流程写入');
    const platformVideoId = '';
    const file = await source(tenantId, sourceTaskId, artifactId);
    const id = createHash('sha256').update(JSON.stringify([tenantId, taskId, connectionId])).digest('hex').slice(0, 15);
    const existing = await getPlatformAdCreative(tenantId, id);
    if (existing && ['uploading', 'unknown', 'processing'].includes(existing.status)) throw new PlatformAdCreativeError('素材上传待核对，不能换绑', 409);
    const now = new Date().toISOString(), taskVersion = task.version + 1;
    const record: StoredPlatformAdCreative = { id, tenant_id: tenantId, taskId, taskVersion, sourceTaskId, artifactId, fileRef: file.fileRef, sha256: file.sha256, mimeType: file.mimeType, size: file.size, name: file.name, connectionId, provider: connection.provider as 'meta' | 'tiktok', platformVideoId, status: 'pending', createdAt: existing?.createdAt || now, updatedAt: now, attemptId: '', uploadError: '', uploadStartedAt: '', uploadReceipt: {} };
    // Invalidate prior approvals before changing a binding; a partial failure is safe and requires a refresh.
    await guard.beforeEffect();
    if (!await store.update(PLATFORM_AD_TASKS_COLLECTION, taskId, { version: taskVersion, authorization: null, proposal: null, updatedAt: now })) throw new PlatformAdCreativeError('计划版本保存失败', 503);
    await guard.beforeEffect();
    if (!(existing ? await store.update(AD_CREATIVES_COLLECTION, id, { ...record }) : await store.create(AD_CREATIVES_COLLECTION, { ...record }))) throw new PlatformAdCreativeError('素材绑定保存失败，请刷新重试', 503);
    const persisted = await getPlatformAdCreative(tenantId, id);
    const persistedTask = await getPlatformAdTask(tenantId, taskId);
    const requiredFields = ['taskId', 'taskVersion', 'sourceTaskId', 'artifactId', 'fileRef', 'sha256', 'mimeType', 'size', 'name', 'connectionId', 'provider', 'platformVideoId', 'status'] as const;
    if (!persisted || requiredFields.some(field => persisted[field] !== record[field]) || persistedTask?.version !== taskVersion
      || persistedTask.authorization !== null || persistedTask.proposal !== null) {
      throw new PlatformAdCreativeError('素材绑定读回校验失败，请检查存储结构后刷新重试', 503);
    }
    return { creative: publicPlatformAdCreative(persisted), taskVersion };
  });
}
