import { createHash } from 'node:crypto';
import type { AdMaterialSelection } from '../../shared/platformAdCreatives.js';
import { parseAdSourceIdentity, getAdSourceLifecycle } from './creativeHistory.js';
import { resolveAdCreativeSource, PlatformAdCreativeError } from './creatives.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from '../starter198/repository.js';
import { openSocialArtifactMedia } from '../starter198/socialArtifactMedia.js';
import { findSocialRecord, socialArtifact } from '../starter198/socialContentRecords.js';
const repository = createStarter198Repository();

/** Selection is not upload permission. Validate tenant and exact original bytes again at save/bind. */
export async function readSelectableAdMaterial(tenantId: string, query: Record<string, unknown>, previewOnly = false): Promise<{ selection: AdMaterialSelection; bytes: Buffer }> {
  const identity = parseAdSourceIdentity(query);
  if (identity.sourceId) throw new PlatformAdCreativeError('该企业来源当前仅供只读查看，未开放跨企业投放复用；请切换到当前企业素材。', 409);
  const source = identity.origin === 'social' ? { verifiedSource: true, sourceTaskId: identity.sourceTaskId, artifactId: identity.artifactId }
    : (await getAdSourceLifecycle(tenantId, identity)).source;
  if (!source.verifiedSource || !source.sourceTaskId || !source.artifactId) throw new PlatformAdCreativeError('该素材尚无可核验成片，不能选择', 409);
  const artifact = socialArtifact(await findSocialRecord({ repository, tenantId, collection: STARTER_COLLECTIONS.socialContentArtifacts,
    where: { task_id: source.sourceTaskId, artifact_id: source.artifactId }, notFoundCode: 'social_artifact_not_found' }));
  if (!previewOnly && artifact.status !== 'approved') throw new PlatformAdCreativeError('成片尚未审阅通过或已被替代，不能用于投放；请先在内容制作确认版本。', 409);
  const file = await resolveAdCreativeSource(tenantId, source.sourceTaskId, source.artifactId);
  if (file.mimeType !== 'video/mp4' || file.size < 1 || file.size > 64 * 1024 * 1024) throw new PlatformAdCreativeError('当前投放素材选择支持不超过 64 MiB 的 MP4 成片', 409);
  const stream = await openSocialArtifactMedia({ repository, tenantId, taskId: source.sourceTaskId, descriptor: { ...file, artifactId: source.artifactId } });
  const chunks: Buffer[] = []; let size = 0; const hash = createHash('sha256');
  for await (const chunk of stream) {
    size += chunk.length; if (size > file.size || size > 64 * 1024 * 1024) throw new PlatformAdCreativeError('源文件已变化，请重新核对', 409);
    chunks.push(Buffer.from(chunk)); hash.update(chunk);
  }
  if (size !== file.size || hash.digest('hex') !== file.sha256) throw new PlatformAdCreativeError('源文件缺失或版本不一致，不能选择', 409);
  return { selection: { origin: 'social', sourceTaskId: source.sourceTaskId, artifactId: source.artifactId, sha256: file.sha256, name: file.name,
    size: file.size, mimeType: file.mimeType, sourceTenantId: tenantId, sourceTenantName: '当前企业' }, bytes: Buffer.concat(chunks) };
}
export async function validateDraftAdMaterial(tenantId: string, input: unknown): Promise<AdMaterialSelection | null | undefined> {
  if (input === undefined || input === null) return input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PlatformAdCreativeError('素材选择无效');
  const value = input as Record<string, unknown>;
  const { selection } = await readSelectableAdMaterial(tenantId, { origin: value.origin, sourceTaskId: value.sourceTaskId, artifactId: value.artifactId });
  if (selection.sha256 !== value.sha256 || selection.sourceTenantId !== value.sourceTenantId) throw new PlatformAdCreativeError('素材版本或来源企业已变化，请重新选择', 409);
  return selection;
}
