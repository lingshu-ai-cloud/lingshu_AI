import { AdProviderError } from './metaAdapter.js';
import { validatePlatformAdCreativeSource } from './creatives.js';
import type { PlatformAdTask } from './tasks.js';
import type { AdConnection } from './connections.js';

/** Resolve the immutable uploaded video on the server; never trust a client video ID as source provenance. */
export async function resolveAdCreativeExecution(
  tenantId: string, task: PlatformAdTask, connection: AdConnection, input: Record<string, unknown>,
  mode: 'manual' | 'automatic' | 'approved',
  validateSource = validatePlatformAdCreativeSource,
): Promise<{ meta: unknown; evidence: Record<string, string> }> {
  if (input.creativeId === undefined || input.creativeId === '') return { meta: input.meta, evidence: {} };
  if (typeof input.creativeId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.creativeId)) throw new AdProviderError('素材绑定标识无效', 'INVALID_INPUT');
  if (mode !== 'manual' || task.managementMode !== 'manual' || input.action !== 'create' || connection.provider !== 'meta') throw new AdProviderError('绑定成片当前仅用于 Meta 人工创建', 'NOT_SUPPORTED');
  let creative;
  try { creative = await validateSource(tenantId, input.creativeId); }
  catch { throw new AdProviderError('成片来源不可用或版本已变化，请重新核对绑定', 'CREATIVE_CHANGED'); }
  if (creative.taskId !== task.id || creative.connectionId !== connection.id || creative.provider !== 'meta' || creative.taskVersion !== task.version) throw new AdProviderError('素材与当前计划、账户或版本不一致', 'CREATIVE_MISMATCH');
  const receipt = creative.uploadReceipt;
  if (creative.status !== 'ready' || !/^\d+$/.test(creative.platformVideoId) || receipt?.videoId !== creative.platformVideoId || receipt?.sha256 !== creative.sha256 || receipt?.accountId !== connection.accountId || receipt?.status !== 'ready') throw new AdProviderError('平台视频尚未核验就绪，请先核对素材状态', 'CREATIVE_NOT_READY');
  const supplied = input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta) ? input.meta as Record<string, unknown> : {};
  if (supplied.videoId && supplied.videoId !== creative.platformVideoId) throw new AdProviderError('表单视频与绑定成片不一致，请重新选择成片', 'CREATIVE_MISMATCH');
  return {
    meta: { ...supplied, videoId: creative.platformVideoId },
    evidence: { creativeBindingId: creative.id, creativeSha256: creative.sha256, creativeSourceTaskId: creative.sourceTaskId, creativeArtifactId: creative.artifactId, creativeVideoId: creative.platformVideoId },
  };
}
