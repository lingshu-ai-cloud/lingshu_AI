import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation';
import type { SocialImageExecutionReceipt } from '../../shared/contracts/socialImageExecution';

type Snapshot = { task: SocialImageCreationTask; execution: SocialImageExecutionReceipt | null };
type Ports = {
  read(contentTaskId: string): Promise<Snapshot>;
  confirm(task: SocialImageCreationTask): Promise<{ task: SocialImageCreationTask }>;
  analyze(sourceRecordId: string, selectedImageUrl?: string): Promise<void>;
  enqueue(task: SocialImageCreationTask): Promise<Snapshot>;
  isCurrent(): boolean;
  onProgress(message: string): void;
};
const reanalyzable = new Set([
  'social_image_reference_product_confirmation_required', 'social_image_reference_analysis_required',
  'social_image_reference_analysis_outdated', 'social_image_reference_analysis_failed',
  'social_image_reference_product_uncertain',
]);
const fail = (code: string): never => { throw Object.assign(new Error(code), { payload: { code } }); };
const errorCode = (error: unknown) => {
  const failure = error as { payload?: { code?: string }; code?: string } | null;
  return failure?.payload?.code || failure?.code;
};

/** Resume the existing task only after its original reference evidence has been saved and verified. */
export async function recoverImageReferenceAnalysis(contentTaskId: string, ports: Ports) {
  const assertCurrent = () => { if (!ports.isCurrent()) fail('image_reference_recovery_scope_changed'); };
  const initial = await ports.read(contentTaskId);
  assertCurrent();
  if (initial.task.productionRuntime?.binding?.contentTaskId !== contentTaskId) fail('image_reference_recovery_scope_changed');
  if (initial.execution || initial.task.creationPath !== 'viral_replication') return { ...initial, analyzed: false };
  let task = initial.task;
  let analyzed = false;
  try {
    task = (await ports.confirm(task)).task;
    assertCurrent();
  } catch (error) {
    assertCurrent();
    if (!reanalyzable.has(errorCode(error) || '')) throw error;
    const sourceId = initial.task.referenceSnapshot?.sourceRecordId;
    if (!sourceId) fail('image_reference_recovery_source_missing');
    ports.onProgress('正在分析参考图片，完成后会回填灵感集市并继续当前复刻任务。');
    await ports.analyze(sourceId, initial.task.referenceSnapshot?.imageUrls[0]);
    assertCurrent();
    analyzed = true;
    const latest = await ports.read(contentTaskId);
    assertCurrent();
    if (latest.task.id !== initial.task.id
      || latest.task.productionRuntime?.binding?.contentTaskId !== contentTaskId
      || latest.task.referenceSnapshot?.sourceRecordId !== sourceId
      || latest.task.referenceSnapshot?.imageUrls[0] !== initial.task.referenceSnapshot?.imageUrls[0]) {
      fail('image_reference_recovery_scope_changed');
    }
    if (latest.execution) return { ...latest, analyzed };
    ports.onProgress('分析结果已保存到灵感集市，正在核验当前参考图并恢复原任务。');
    task = (await ports.confirm(latest.task)).task;
    assertCurrent();
  }
  if (task.referenceProductCheck?.decision !== 'present') fail('social_image_reference_product_shoot_required');
  assertCurrent();
  const queued = await ports.enqueue(task);
  assertCurrent();
  return { ...queued, analyzed };
}
