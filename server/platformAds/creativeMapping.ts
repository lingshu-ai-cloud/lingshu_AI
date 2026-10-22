import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { store } from '../storage/index.js';
import { withPlatformAdTaskLock, getPlatformAdTask } from './tasks.js';
import { AD_CREATIVES_COLLECTION, getPlatformAdCreative, validatePlatformAdCreativeSource, publicPlatformAdCreative, PlatformAdCreativeError, type StoredPlatformAdCreative } from './creatives.js';
import { readExecutedCreative } from './creativeLibrary.js';

/** Post-execution attribution metadata only. Never edits a plan, grant or creation receipt. */
export async function attachExistingAdCreative(tenantId: string, userId: string, taskId: string, input: Record<string, unknown>) {
  if (Object.keys(input).some(k => !['expectedVersion', 'executionId', 'sourceCreativeId'].includes(k))) throw new PlatformAdCreativeError('只接受已核验广告回执与已有素材标识');
  return withPlatformAdTaskLock(tenantId, taskId, async guard => {
    const task = await getPlatformAdTask(tenantId, taskId);
    if (!task) throw new PlatformAdCreativeError('未找到投放计划', 404);
    if (task.version !== input.expectedVersion || task.managementMode !== 'manual' || task.status !== 'paused' || task.creationSource === 'platform_import') throw new PlatformAdCreativeError('仅当前版本的人工暂停计划可补齐映射', 409);
    const source = await validatePlatformAdCreativeSource(tenantId, String(input.sourceCreativeId || ''));
    const ctx = await readExecutedCreative(tenantId, String(input.executionId || ''));
    const uploaded = source.uploadReceipt;
    if (ctx.receipt.taskId !== taskId || source.provider !== 'meta' || source.connectionId !== ctx.connection.id || source.status !== 'ready'
      || source.platformVideoId !== ctx.videoId || uploaded?.accountId !== ctx.connection.accountId || uploaded?.videoId !== ctx.videoId || uploaded?.status !== 'ready' || uploaded?.sha256 !== source.sha256
      || [ctx.campaign, ctx.adset, ctx.ad].some(r => r.status !== 'PAUSED')) throw new PlatformAdCreativeError('素材账户、平台视频或暂停状态与广告不一致', 409);
    const id = createHash('sha256').update(JSON.stringify([tenantId, taskId, ctx.connection.id])).digest('hex').slice(0, 15);
    const existing = await getPlatformAdCreative(tenantId, id);
    if (existing) {
      if (existing.taskId !== taskId || existing.taskVersion !== task.version || existing.fileRef !== source.fileRef || existing.sourceTaskId !== source.sourceTaskId || existing.artifactId !== source.artifactId || existing.sha256 !== source.sha256 || existing.platformVideoId !== ctx.videoId || existing.connectionId !== ctx.connection.id || existing.status !== 'ready' || existing.uploadReceipt?.accountId !== ctx.connection.accountId || existing.uploadReceipt?.sha256 !== source.sha256) throw new PlatformAdCreativeError('已有其他素材映射，不能覆盖', 409);
      return { creative: publicPlatformAdCreative(existing), taskVersion: task.version, reused: true };
    }
    const video = await ctx.adapter.request(ctx.videoId, { fields: 'id,status' });
    if (String(video.id) !== ctx.videoId || video.status?.video_status !== 'ready') throw new PlatformAdCreativeError('平台视频尚未核验就绪', 409);
    const now = new Date().toISOString();
    const record: StoredPlatformAdCreative = { ...source, id, tenant_id: tenantId, taskId, taskVersion: task.version, createdAt: now, updatedAt: now,
      uploadReceipt: { ...uploaded, mappingExecutionId: ctx.receipt.id, mappingSourceCreativeId: source.id, mappingKind: 'post_execution', mappedBy: userId, mappedAt: now } };
    await guard.beforeEffect();
    const current = await getPlatformAdTask(tenantId, taskId);
    if (current?.version !== task.version || current.status !== 'paused' || current.managementMode !== 'manual') throw new PlatformAdCreativeError('计划已变化，未写入映射', 409);
    const created = await store.create(AD_CREATIVES_COLLECTION, { ...record });
    const persisted = await getPlatformAdCreative(tenantId, id);
    if (!created || !persisted || !isDeepStrictEqual(persisted.uploadReceipt, record.uploadReceipt) || ['taskId', 'taskVersion', 'fileRef', 'sha256', 'connectionId', 'platformVideoId', 'status'].some(k => (persisted as any)[k] !== (record as any)[k])) throw new PlatformAdCreativeError('素材映射未完整持久化，请刷新核对；不会重复上传', 503);
    return { creative: publicPlatformAdCreative(persisted), taskVersion: task.version, reused: false };
  });
}
