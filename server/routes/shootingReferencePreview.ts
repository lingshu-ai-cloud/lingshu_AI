import {parseAnalysisTimeRange} from '../lib/videoAnalysisCodec.js';
import type {DataStore, Record_} from '../storage/datastore.js';
import {taskReferencePreview, shootingReferencePreview} from '../../shared/shootingReference.js';
import {createExactShotMaterializationService} from '../lib/referenceExactShotMaterialization.js';
import {socialJson, socialObject, socialRequestHash, SocialContentWorkflowError} from '../starter198/socialContentValidation.js';
import {signAssetUrl} from '../lib/assetAccess.js';

/** The task, tenant, analysis and source bytes own the range; the client cannot
 * submit arbitrary trim times, asset paths or external media URLs. */
export function createShootingReferencePreview(store: DataStore, options: {mediaRoot?: string} = {}) {
  const service = createExactShotMaterializationService(store, options);
  const pending = new Map<string, ReturnType<typeof service.materialize>>();
  const fail = (code: string): never => { throw new SocialContentWorkflowError(code, 409); };
  return async (tenantId: string, taskId: string) => {
    const task = await store.getById<Record_>('studio_shooting_tasks', taskId);
    if (!task || task.tenant_id !== tenantId) throw new SocialContentWorkflowError('shooting_task_not_found', 404);
    const payload = socialObject(task.payload);
    if (!payload) return fail('shooting_reference_binding_missing');
    let preview = taskReferencePreview(payload);
    if (!preview && typeof payload.sourceProjectId === 'string') {
      const project = await store.getById<Record_>('studio_projects', payload.sourceProjectId);
      if (project?.tenant_id === tenantId) preview = shootingReferencePreview(payload, {...project, spec: socialJson(project.spec)});
    }
    if (!preview?.referenceRecordId || !preview.referenceShotId) return fail('shooting_reference_binding_missing');
    const record = await store.getById<Record_>('trend_videos', preview.referenceRecordId);
    if (!record || record.tenantId !== tenantId) throw new SocialContentWorkflowError('shooting_reference_not_found', 404);
    const analysis = socialObject(socialJson(record.aiAnalysis));
    const gemini = socialObject(analysis?.gemini);
    const details = Array.isArray(gemini?.scriptDetails15s) ? gemini.scriptDetails15s.map(socialObject) : [];
    const matches = details.map((detail, index) => ({detail, index})).filter(({detail, index}) =>
      String(detail?.shotId || `slot-${index + 1}`).replace(/^replication-/, '') === preview!.referenceShotId);
    if (matches.length !== 1) return fail('shooting_reference_changed');
    const range = parseAnalysisTimeRange(String(matches[0]!.detail?.time || ''));
    if (!range || range.start !== preview.start || range.end !== preview.end) return fail('shooting_reference_changed');
    const scope = {tenantId, recordId: preview.referenceRecordId, expectedSourceSha256: String(analysis?.contentSha256 || ''),
      expectedAnalysisRunId: String(analysis?.analysisRunId || ''), expectedAnalysisHash: socialRequestHash(analysis)};
    const key = socialRequestHash(scope);
    let job = pending.get(key);
    if (!job) { job = service.materialize(scope); pending.set(key, job); }
    let receipt;
    try { receipt = await job; } finally { if (pending.get(key) === job) pending.delete(key); }
    const shot = receipt.shots.find(item => item.shotIndex === matches[0]!.index + 1);
    if (!shot || shot.startSeconds !== preview.start || shot.endSeconds !== preview.end) return fail('shooting_reference_changed');
    // Revalidate ownership/binding after potentially slow local decoding.
    const fresh = await store.getById<Record_>('studio_shooting_tasks', taskId);
    if (!fresh || fresh.tenant_id !== tenantId || socialRequestHash(fresh.payload) !== socialRequestHash(task.payload)) return fail('shooting_reference_changed');
    return {url: signAssetUrl(shot.clipRef, tenantId), poster: signAssetUrl(shot.firstFrameRef, tenantId),
      start: 0, end: shot.endSeconds - shot.startSeconds, physicalClip: true,
      sourceStart: shot.startSeconds, sourceEnd: shot.endSeconds, clipSha256: shot.clipSha256};
  };
}
