import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { hardSceneCutTimes, assertPersonCueShotBoundaries } from '../server/lib/sentenceCueSceneCuts.js';
import { planPersonShotClusters } from '../src/lib/personShotClustering.js';

// Read the running workspace without importing its conflicted source or changing its stores.
const source = path.resolve('../local-preview-1002');
dotenv.config({ path: path.join(source, '.env'), quiet: true });
dotenv.config({ path: path.join(source, '.env.local'), override: true, quiet: true });
const { sentenceReplicationReadiness } = await import('../server/runtime/readiness.js');
const out = path.resolve('data/acceptance/real-shot-replication-20261008');
fs.mkdirSync(out, { recursive: true });
const parse = (v: any) => typeof v === 'string' ? JSON.parse(v) : v;
const projects = JSON.parse(fs.readFileSync(path.join(source, 'data/local-store/studio_projects.json'), 'utf8'));
const project = projects.find((p: any) => p.id === 'studio_projects_18d5f583d94d4630b1b8b55140f40e70');
const spec = parse(project.spec);
const materials = JSON.parse(fs.readFileSync(path.join(source, 'data/materials.json'), 'utf8'));
const reference = path.join(source, 'data/media/tenants', project.tenant_id, 'reference-videos/trend_videos_192e76d4b21244c4a2922e60672c95f2.mp4');
const cuts = await hardSceneCutTimes(String(ffmpeg), reference);
// Use the source's object-store root without changing or writing any source files.
process.env.LOCAL_OBJECT_STORAGE_ROOT = path.resolve(source, process.env.LOCAL_OBJECT_STORAGE_ROOT || 'data/media/object-storage');
const { objectStorageDownload } = await import('../server/storage/objectStorage.js');
const probe = await promisify(execFile)(String(ffmpeg), ['-hide_banner', '-i', reference, '-f', 'null', '-'], { maxBuffer: 4 * 1024 * 1024 });
const durationMatch = probe.stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
const referenceDuration = durationMatch ? Number(durationMatch[1])*3600+Number(durationMatch[2])*60+Number(durationMatch[3]) : null;
const referenceSha256 = createHash('sha256').update(fs.readFileSync(reference)).digest('hex');
const assignments = spec.storyboardAssignments;
const rows = await Promise.all(spec.shootingSlots.map(async (slot: any, index: number) => {
  const key = `${spec.activeAssemblyId}:${slot.id}`;
  const shot = spec.shotProductions[key];
  const assigned = assignments[slot.slotId] ?? assignments[slot.id];
  const materialId = typeof assigned === 'string' ? assigned : assigned?.materialId;
  const material = materials.find((m: any) => m.id === materialId);
  const file = material?.file ? path.resolve(source, 'data/media', material.file) : undefined;
  let mediaBytes: Buffer | undefined;
  let mediaReadFrom: string | null = null;
  let mediaReadError: string | null = null;
  const tenantMatches = material && (material.scope === 'shared' || String(material.tenantId || material.tenant_id || '') === project.tenant_id);
  if (tenantMatches) {
    try {
      const mediaRoot = fs.realpathSync(path.join(source, 'data/media'));
      if (file && fs.existsSync(file)) {
        const real = fs.realpathSync(file);
        const allowedRoot = material.scope === 'shared' ? mediaRoot : fs.realpathSync(path.join(mediaRoot,'tenants',project.tenant_id));
        if (!real.startsWith(allowedRoot + path.sep)) throw new Error('assigned media path escapes allowed root');
        mediaBytes = fs.readFileSync(real); mediaReadFrom = 'local_file';
      }
      if (!mediaBytes && material.objectKey) {
        const key = String(material.objectKey);
        const encodedTenant = Buffer.from(project.tenant_id).toString('base64url');
        if (material.scope !== 'shared' && !key.startsWith(`materials/tenants/${encodedTenant}/`)) throw new Error('object key is not in tenant material namespace');
        const object = await objectStorageDownload(key);
        if (object) { mediaBytes = object.buf; mediaReadFrom = 'object_storage'; }
      }
    } catch (error) { mediaReadError = (error as Error).message; }
  }
  const actualSha256 = mediaBytes ? createHash('sha256').update(mediaBytes).digest('hex') : null;
  const errors: string[] = [];
  if (!material) errors.push('assigned_material_missing');
  if (material && !tenantMatches) errors.push('assigned_material_tenant_mismatch');
  if (material && !mediaBytes) errors.push('assigned_media_unreadable');
  if (material?.contentSha256 && actualSha256 && material.contentSha256 !== actualSha256) errors.push('assigned_media_hash_mismatch');
  if (material && (material.sourceType === 'tiktok_reference' || material.usage === 'reference_only' || material.mayUseInProduction === false || actualSha256 === referenceSha256)) errors.push('reference_material_forbidden_in_production');
  if (material && !material.contentSha256) errors.push('stored_hash_missing');
  if (slot.observedPresenterRole === 'unknown') errors.push('presenter_role_unknown');
  if (slot.salesPresenterConfirmed && shot?.digitalHuman?.workflow !== 'viral_replication') errors.push('person_shot_uses_generic_production');
  if (!slot.salesPresenterConfirmed && shot?.source === 'avatar') errors.push('non_presenter_shot_has_avatar_source');
  const ref = shot?.digitalHuman?.reference;
  const cues = ref?.cues ?? [];
  if (slot.salesPresenterConfirmed && !cues.length) errors.push('person_shot_reference_cues_missing');
  if (slot.salesPresenterConfirmed && !shot?.digitalHuman?.contentConfirmed) errors.push('person_shot_content_not_confirmed');
  if (slot.salesPresenterConfirmed && !shot?.digitalHuman?.targetFramesConfirmed) errors.push('person_shot_target_frames_not_confirmed');
  for (const cue of cues) {
    if (cue.start < 0 || cue.end <= cue.start || (referenceDuration !== null && cue.end > referenceDuration + 0.05)) errors.push('cue_outside_reference_timeline');
    if (cue.personShot === undefined) errors.push('cue_person_classification_missing');
    if (slot.salesPresenterConfirmed && !String(cue.targetText || '').trim()) errors.push('person_cue_target_text_missing');
  }
  const cluster = cues.length ? planPersonShotClusters(cues) : null;
  if (cluster?.blockers.length) errors.push(...cluster.blockers);
  let boundaryError: string | null = null;
  try { assertPersonCueShotBoundaries(cues, cuts); } catch (e) { boundaryError = (e as Error).message; errors.push(boundaryError); }
  return { index: index + 1, shotId: slot.id, slotId: slot.slotId, referenceIntent: slot.detail, observedPresenterRole: slot.observedPresenterRole, salesPresenterConfirmed: slot.salesPresenterConfirmed, duration: slot.duration, workflow: shot?.digitalHuman?.workflow, presenterMode: shot?.digitalHuman?.presenterMode, materialId, materialType: material?.type, materialSourceType: material?.sourceType, providerTaskId: material?.providerTaskId, file, actualSha256, mediaReadFrom, mediaReadError, materialObservedEvidence: material?.segments?.map((segment: any) => ({start: segment.start, end: segment.end, subject: segment.subject, action: segment.action, environment: segment.environment})), sourceReferenceRange: ref ? {start: ref.start, end: ref.end} : null, storedSha256: material?.contentSha256, cues, errors: [...new Set(errors)], semanticMatchVerified: false };
}));
const report = { createdAt: new Date().toISOString(), projectId: project.id, sourceWorkspaceReadOnly: true, sourceReference: reference, referenceDuration, referenceSha256, totalDraftDuration: spec.shootingSlots.reduce((sum: number, slot: any) => sum + Number(slot.duration || 0),0), hardCuts: cuts, readiness: { seedance: sentenceReplicationReadiness(process.env, 'seedance'), heygen: sentenceReplicationReadiness(process.env, 'heygen') }, rows, accepted: false, note: 'Inventory and native preflight only. This report does not claim supplier execution or completed replication.' };
fs.writeFileSync(path.join(out, 'shot-audit.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ report: path.join(out, 'shot-audit.json'), cuts, readiness: report.readiness, shots: rows.map((r: any) => ({ index: r.index, materialId: r.materialId, source: r.materialSourceType, errors: r.errors })) }, null, 2));
