import { isDeepStrictEqual } from 'node:util';
import { store } from '../storage/index.js';
import { getPlatformAdTask, withPlatformAdTaskLock } from './tasks.js';
import { getConnectionCredential } from './connections.js';
import { AD_CREATIVES_COLLECTION, getPlatformAdCreative, openPlatformAdCreativeMedia, publicPlatformAdCreative } from './creatives.js';
import { assertAdReleaseAction } from './releasePolicy.js';
import { AdProviderError } from './metaAdapter.js';
import { collectVerifiedVideo, MAX_META_VIDEO_BYTES, MetaVideoUploadAdapter } from './metaVideoUpload.js';

export function createCreativeUploadService(deps = {
  store, getPlatformAdTask, withPlatformAdTaskLock, getConnectionCredential,
  getPlatformAdCreative, openPlatformAdCreativeMedia,
  adapter: (token: string, beforeWrite: () => Promise<void>) => new MetaVideoUploadAdapter(token, fetch, beforeWrite),
}) {
  async function run(tenantId: string, taskId: string, creativeId: string, input: Record<string, unknown>, reconcile: boolean) {
    return deps.withPlatformAdTaskLock(tenantId, taskId, async guard => {
      const task = await deps.getPlatformAdTask(tenantId, taskId);
      const creative = await deps.getPlatformAdCreative(tenantId, creativeId);
      if (!task || !creative || creative.taskId !== taskId) throw new AdProviderError('未找到计划素材', 'NOT_FOUND');
      if (creative.provider !== 'meta') throw new AdProviderError('当前只支持 Meta 素材上传', 'NOT_SUPPORTED');
      const { connection, accessToken } = await deps.getConnectionCredential(tenantId, creative.connectionId);
      if (connection.provider !== 'meta' || connection.status !== 'connected') throw new AdProviderError('账户需要重新授权', 'AUTH_REQUIRED');
      const previous = creative.uploadReceipt?.requestId ? creative.uploadReceipt as any : null;
      if (previous && (previous.accountId !== connection.accountId || previous.sha256 !== creative.sha256)) throw new AdProviderError('素材回执与账户不匹配', 'RECEIPT_MISMATCH');
      if (!previous && (creative.platformVideoId || ['uploading', 'unknown', 'processing', 'ready'].includes(creative.status))) throw new AdProviderError('素材存在不完整上传回执，请人工核对', 'RECONCILIATION_REQUIRED');
      const bindingConnectionId = creative.connectionId, bindingSha256 = creative.sha256;
      const adapter = deps.adapter(accessToken, () => guard.beforeEffect());
      async function save(patch: Record<string, unknown>) {
        await guard.beforeEffect();
        const updated = await deps.store.update(AD_CREATIVES_COLLECTION, creativeId, { ...patch, updatedAt: new Date().toISOString() });
        if (!updated) throw new AdProviderError('素材回执保存失败，请核对后恢复', 'STORAGE_ERROR', true);
        // PB can silently drop fields against an old schema. Read durable state,
        // never infer a successful receipt from a non-null update response.
        const persisted = await deps.getPlatformAdCreative(tenantId, creativeId);
        if (!persisted || persisted.taskId !== taskId || persisted.connectionId !== bindingConnectionId || persisted.sha256 !== bindingSha256 || Object.entries(patch).some(([key, value]) => !isDeepStrictEqual((persisted as unknown as Record<string, unknown>)[key], value))) throw new AdProviderError('素材回执未完整持久化，请检查存储结构后人工核对', 'STORAGE_ERROR', true);
        return publicPlatformAdCreative(persisted);
      }
      if (reconcile) {
        if (!creative.platformVideoId || !previous || previous.videoId !== creative.platformVideoId) throw new AdProviderError('缺少已持久化的平台视频回执，需人工核对', 'RECONCILIATION_REQUIRED');
        const status = await adapter.status(creative.platformVideoId);
        return save({ status, uploadReceipt: { ...previous, status, checkedAt: new Date().toISOString() } });
      }
      const requestId = String(input.requestId || '');
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw new AdProviderError('请提供唯一上传请求 ID', 'INVALID_INPUT');
      if (previous) {
        if (previous.requestId === requestId || creative.platformVideoId) return publicPlatformAdCreative(creative);
        throw new AdProviderError('已有上传尝试，请先核对回执；禁止盲目重复上传', 'RECONCILIATION_REQUIRED');
      }
      assertAdReleaseAction('meta', 'create');
      if (task.managementMode !== 'manual') throw new AdProviderError('请先人工接管计划再上传', 'MANAGEMENT_CONFLICT');
      if (Number(input.expectedVersion) !== task.version || creative.taskVersion !== task.version) throw new AdProviderError('计划已变化，请重新绑定素材', 'VERSION_CONFLICT');
      if (task.status !== 'draft' || task.creationSource === 'platform_import') throw new AdProviderError('仅草稿计划可上传新素材', 'INVALID_STATE');
      if (task.currency !== connection.currency || !task.channels.length || task.channels.some(channel => !['Facebook', 'Instagram'].includes(channel))) throw new AdProviderError('计划渠道或币种与账户不匹配', 'ACCOUNT_MISMATCH');
      for (const collection of ['platform_ad_executions', 'platform_ad_launches']) {
        if ((await deps.store.list(collection, { where: { tenant_id: tenantId, taskId }, perPage: 1 })).items.length) throw new AdProviderError('已有执行或启动记录，请建立独立计划', 'INVALID_STATE');
      }
      if (creative.mimeType !== 'video/mp4') throw new AdProviderError('首版 Meta 上传仅支持 MP4 成片', 'INVALID_MEDIA');
      if (!Number.isSafeInteger(creative.size) || creative.size < 1 || creative.size > MAX_META_VIDEO_BYTES) throw new AdProviderError('素材最大 64 MiB', 'INVALID_MEDIA');
      const media = await deps.openPlatformAdCreativeMedia(tenantId, creativeId);
      const bytes = await collectVerifiedVideo(media.body, creative.size, creative.sha256);
      const receipt = { requestId, accountId: connection.accountId, sha256: creative.sha256, status: 'uploading', at: new Date().toISOString() };
      await save({ status: 'uploading', attemptId: requestId, uploadReceipt: receipt });
      let videoId: string;
      try { videoId = await adapter.upload(connection.accountId, bytes); }
      catch (error) {
        const uncertain = !(error instanceof AdProviderError) || error.uncertain;
        await save({ status: uncertain ? 'unknown' : 'failed', uploadError: error instanceof AdProviderError ? error.code : 'UPLOAD_ERROR', uploadReceipt: { ...receipt, status: uncertain ? 'unknown' : 'failed' } });
        throw error;
      }
      // ID receipt must be durable before any readback; failure leaves uploading and blocks retries.
      return save({ status: 'processing', platformVideoId: videoId, uploadReceipt: { ...receipt, videoId, status: 'processing' } });
    });
  }
  return {
    upload: (tenantId: string, taskId: string, creativeId: string, input: Record<string, unknown>) => run(tenantId, taskId, creativeId, input, false),
    reconcile: (tenantId: string, taskId: string, creativeId: string, input: Record<string, unknown> = {}) => run(tenantId, taskId, creativeId, input, true),
  };
}
const service = createCreativeUploadService();
export const uploadPlatformAdCreative = service.upload;
export const reconcilePlatformAdCreative = service.reconcile;
