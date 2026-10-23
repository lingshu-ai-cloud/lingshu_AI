import type { StoredPlatformAdCreative } from './creatives.js';
import { PlatformAdCreativeError } from './creatives.js';
import type { AdConnection } from './connections.js';
import { store } from '../storage/index.js';

/** Reuse evidence only. Never upload, create ads, copy execution receipts, or modify the donor. */
export async function findReusableMetaVideo(input: {
  tenantId: string; connection: AdConnection; sourceTaskId: string; artifactId: string;
  file: { fileRef: string; sha256: string; size: number; mimeType: string };
  candidates: StoredPlatformAdCreative[]; readStatus: (videoId: string) => Promise<string>;
  sourceAccountIds?: Record<string, string>;
}): Promise<{ platformVideoId: string; uploadReceipt: Record<string, unknown> } | null> {
  if (input.connection.provider !== 'meta') return null;
  const matches = input.candidates.filter(c => c.tenant_id === input.tenantId && c.provider === 'meta'
    && (c.connectionId === input.connection.id ? input.connection.accountId : input.sourceAccountIds?.[c.connectionId]) === input.connection.accountId
    && c.sourceTaskId === input.sourceTaskId && c.artifactId === input.artifactId && c.fileRef === input.file.fileRef
    && c.sha256 === input.file.sha256);
  const valid = matches.filter(c => c.size === input.file.size && c.mimeType === input.file.mimeType && c.status === 'ready' && /^\d+$/.test(c.platformVideoId) && c.uploadReceipt?.status === 'ready'
    && typeof c.uploadReceipt.requestId === 'string' && !!c.uploadReceipt.requestId
    && c.uploadReceipt.sha256 === input.file.sha256 && c.uploadReceipt.accountId === input.connection.accountId && c.uploadReceipt.videoId === c.platformVideoId)
    .sort((a, b) => Number(!!(a.uploadReceipt?.reusedFromCreativeId || a.uploadReceipt?.mappingExecutionId)) - Number(!!(b.uploadReceipt?.reusedFromCreativeId || b.uploadReceipt?.mappingExecutionId)) || a.id.localeCompare(b.id));
  const source = valid[0];
  if (!source) {
    if (matches.some(c => !!c.platformVideoId || ['uploading', 'processing', 'unknown', 'ready'].includes(c.status) || !!c.uploadReceipt?.requestId && !(c.status === 'failed' && c.uploadReceipt.status === 'failed'))) {
      throw new PlatformAdCreativeError('发现已有视频或上传尝试，但回执尚未核验完整。未改变绑定，请核对原记录；不要重复上传。', 409);
    }
    return null;
  }
  let status: string;
  try { status = await input.readStatus(source.platformVideoId); }
  catch { throw new PlatformAdCreativeError('已有 Meta 视频暂时无法只读核验。未改变绑定，请稍后重试；不会重新上传。', 409); }
  if (status !== 'ready') throw new PlatformAdCreativeError('已有 Meta 视频尚未就绪或不可用。未改变绑定，请核对原视频；不会重新上传。', 409);
  return { platformVideoId: source.platformVideoId, uploadReceipt: {
    requestId: source.uploadReceipt!.requestId, accountId: input.connection.accountId, videoId: source.platformVideoId,
    sha256: input.file.sha256, status: 'ready', reusedFromCreativeId: source.id, reuseVerifiedAt: new Date().toISOString(),
  } };
}
export async function findStoredReusableMetaVideo(input: Omit<Parameters<typeof findReusableMetaVideo>[0], 'candidates' | 'sourceAccountIds'>) {
  const candidates = await store.list<StoredPlatformAdCreative>('platform_ad_creatives', { where: { tenant_id: input.tenantId, sha256: input.file.sha256 }, perPage: 200 });
  if (candidates.totalPages > 1) throw new PlatformAdCreativeError('已有素材记录超过核对上限，未改变绑定；请先核对，避免重复上传。', 409);
  const sourceAccountIds: Record<string, string> = {};
  for (const id of new Set(candidates.items.map(c => c.connectionId))) {
    const owner = await store.getById<AdConnection>('platform_ad_connections', id);
    if (owner?.tenant_id === input.tenantId && owner.provider === 'meta') sourceAccountIds[id] = owner.accountId;
  }
  return findReusableMetaVideo({ ...input, candidates: candidates.items, sourceAccountIds });
}
