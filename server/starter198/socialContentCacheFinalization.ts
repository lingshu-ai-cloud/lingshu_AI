import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertCurrentContentExecutionActive, readCurrentContentExecutionCheckpoint, recordCurrentContentExecutionCheckpoint } from '../contentExecution/context.js';
import { initialSceneSourceHashes, persistInitialSocialSceneCache } from './socialContentInitialSceneCache.js';
import { createSocialSceneReworkService } from './socialContentSceneReworkService.js';
import { socialRequestHash } from './socialContentValidation.js';
import type { Starter198Repository } from './repository.js';
import { writeExecutionStage } from './socialContentProductionRuntimeSupport.js';

type CacheInput = Omit<Parameters<typeof persistInitialSocialSceneCache>[0], 'repository' | 'artifactId' | 'sourceFiles'>;
type Scope = Pick<CacheInput, 'tenantId' | 'taskId' | 'runId'>;
const stage = 'social.scene_cache_recovery';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const directory = (scope: Scope) => path.resolve('data/social-content-cache-finalization', socialRequestHash(scope));
interface Snapshot { input: CacheInput; inputHash: string; files: Array<{ source: string; path: string; sha256: string }> }
interface SnapshotRef { path: string; sha256: string }

/** Seal recoverable source bytes before publishing the artifact. Original
 * source identities remain unchanged so QA/manifest lineage is not rewritten. */
export async function prepareSocialCacheFinalization(input: CacheInput): Promise<void> {
  await assertCurrentContentExecutionActive();
  const root = directory({ tenantId: input.tenantId, taskId: input.taskId, runId: input.runId });
  const sources = await initialSceneSourceHashes(input);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const files: Snapshot['files'] = [];
  for (const source of sources) {
    const bytes = source.source.startsWith('data:')
      ? Buffer.from(source.source.slice(source.source.indexOf(',') + 1), 'base64') : await readFile(source.source);
    if (sha(bytes) !== source.sha256) throw Error('scene_cache_recovery_source_changed');
    const file = path.join(root, source.sha256);
    try { await writeFile(file, bytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (sha(await readFile(file)) !== source.sha256) throw Error('scene_cache_recovery_bytes_changed');
    files.push({ source: source.source, path: file, sha256: source.sha256 });
  }
  // Full QA/source manifests (including a BGM data URL) stay on the private
  // media volume. The queue's bounded checkpoint map holds only this proof.
  const snapshot: Snapshot = { input: structuredClone(input), inputHash: socialRequestHash(input), files };
  const bytes = Buffer.from(JSON.stringify(snapshot)), digest = sha(bytes);
  const file = path.join(root, `${digest}.json`);
  try { await writeFile(file, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  if (sha(await readFile(file)) !== digest) throw Error('scene_cache_recovery_snapshot_changed');
  await recordCurrentContentExecutionCheckpoint({ stage, version: '1', inputHash: input.runId,
    payload: { path: file, sha256: digest } satisfies SnapshotRef });
}

/** Recovery only writes local cache/evidence. It has no supplier, render or
 * artifact-creation port, and cannot authorize a new paid operation. */
async function restoreSocialCacheFinalization(scope: Scope & { repository: Starter198Repository; artifactId: string }): Promise<void> {
  await assertCurrentContentExecutionActive();
  const service = createSocialSceneReworkService(scope.repository);
  try {
    await service.readCache({ ...scope, parentArtifactId: scope.artifactId }); // Verifies original artifact, receipts and retained media.
    return;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'scene_rework_cache_missing') throw error;
  }
  const ref = readCurrentContentExecutionCheckpoint<SnapshotRef>({ stage, version: '1', inputHash: scope.runId });
  if (!ref) throw Error('user_input_required:weekly_scene_cache_recovery_snapshot_missing');
  const root = directory({ tenantId: scope.tenantId, taskId: scope.taskId, runId: scope.runId });
  if (!/^[a-f0-9]{64}$/.test(ref.sha256) || ref.path !== path.join(root, `${ref.sha256}.json`)) throw Error('scene_cache_recovery_scope_changed');
  const bytes = await readFile(ref.path);
  if (sha(bytes) !== ref.sha256) throw Error('scene_cache_recovery_snapshot_changed');
  const saved = JSON.parse(bytes.toString('utf8')) as Snapshot;
  const input = saved.input;
  if (input.tenantId !== scope.tenantId || input.taskId !== scope.taskId || input.runId !== scope.runId
    || saved.inputHash !== socialRequestHash(input)) throw Error('scene_cache_recovery_scope_changed');
  const sourceFiles: Record<string, string> = {};
  for (const file of saved.files) {
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || file.path !== path.join(root, file.sha256)
      || sha(await readFile(file.path)) !== file.sha256) throw Error('scene_cache_recovery_bytes_changed');
    sourceFiles[file.source] = file.path;
  }
  await persistInitialSocialSceneCache({ ...input, repository: scope.repository, artifactId: scope.artifactId, sourceFiles });
}

export async function completeSocialCacheFinalization(scope: Scope & { repository: Starter198Repository; artifactId: string }): Promise<void> {
  try { await restoreSocialCacheFinalization(scope); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'content_execution_stopped') throw error;
    if (code === 'ENOENT') throw Error('user_input_required:weekly_scene_cache_recovery_media_missing');
    const reason = error instanceof Error ? error.message : 'unknown';
    if (reason.startsWith('user_input_required:')) throw error;
    // Keep a stable cache-finalization cause even when a storage adapter throws
    // a generic IO error. Existing-artifact protection must not swallow it.
    throw Error(`weekly_scene_cache_finalization_failed:${reason}`);
  }
}

export async function finishSocialCacheFinalization(input: CacheInput | null,
  scope: Scope & { repository: Starter198Repository; artifactId: string }, required: boolean): Promise<void> {
  if (!input) {
    await writeExecutionStage({ ...scope, stage: 'scene_media_cache_pending', message: '缺少真实逐镜供给或完整参考分析，不能创建局部重制缓存。' });
    return;
  }
  try {
    if (required) await completeSocialCacheFinalization(scope);
    else await persistInitialSocialSceneCache({ ...input, repository: scope.repository, artifactId: scope.artifactId });
    await writeExecutionStage({ ...scope, stage: 'scene_media_cache', message: '首次逐镜真实媒体和检测报告已封存；未检测项目仍待核验。' });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'scene_cache_unavailable';
    await writeExecutionStage({ ...scope, stage: 'scene_media_cache_pending', message: '原成片已保留，逐镜缓存等待恢复；不会重新生成供应商素材。', extra: { reason } });
    if (required) throw Error(`weekly_scene_cache_persistence_failed:${reason}`);
  }
}
