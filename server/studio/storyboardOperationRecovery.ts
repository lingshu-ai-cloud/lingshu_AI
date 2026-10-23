import { materialResponse, type Material } from '../routes/studioMaterialProjection.js';
import { type Response } from 'express';
import { createHash } from 'node:crypto';
import { isTenantPrivateObjectKey } from '../storage/materialAssets.js';
import sharp from 'sharp';
import { type StoryboardShotSpec } from '../../shared/storyboardShotSpec.js';
import { type StoryboardAigcSpendEntry } from '../lib/storyboardAigcProjectBudget.js';
import { inspectStoryboardExistingOperation } from '../lib/storyboardExistingOperation.js';
import { readTenantMaterialBytes } from '../lib/sentenceReplicationProduction.js';
import { validateReplicationVideo } from '../lib/automatedReplicationBridge.js';
import { storyboardProjectShotInput } from '../lib/storyboardProjectShotInput.js';

import type { StudioApplicationPorts } from './applicationPorts.js';

export function createStoryboardOperationRecovery(deps: Pick<StudioApplicationPorts, 'storyboardUrlImage' | 'loadMaterials' | 'storyboardKbAssignmentIssuesForSpec'>) {
  const storyboardUrlImage: StudioApplicationPorts['storyboardUrlImage'] = (...args) => deps.storyboardUrlImage(...args);
  const loadMaterials: StudioApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);
  const storyboardKbAssignmentIssuesForSpec: StudioApplicationPorts['storyboardKbAssignmentIssuesForSpec'] = (...args) => deps.storyboardKbAssignmentIssuesForSpec(...args);

  async function respondToExistingStoryboardOperation(res: Response, input: {
    entry: StoryboardAigcSpendEntry | undefined;
    operationId: string; shotId: string; stage: 'first_frame' | 'video'; estimatedCostCny: number;
    inputFingerprint?: string; kind: 'frame' | 'video' | 'action';
    recover: (entry: StoryboardAigcSpendEntry) => Promise<Record<string, unknown> | null>;
  }) {
    const result = inspectStoryboardExistingOperation(input);
    if (result.kind === 'none') return false;
    if (result.kind === 'conflict') {
      res.status(409).json({ ok: false, code: result.code, error: result.message, operationId: input.operationId });
      return true;
    }
    let recovered: Record<string, unknown> | null = null;
    if (result.entry.status === 'completed') {
      try { recovered = await input.recover(result.entry); } catch { /* Preserve the receipt; never regenerate on read failure. */ }
    }
    if (recovered) { res.json({ ...recovered, reused: true }); return true; }
    const pending = result.entry.status === 'reserved';
    const code = input.kind === 'action' ? pending ? 'ACTION_REQUEST_IN_PROGRESS' : 'ACTION_REQUEST_NEEDS_RECONCILIATION'
      : input.kind === 'video' ? pending ? 'STORYBOARD_VIDEO_IN_PROGRESS' : 'STORYBOARD_VIDEO_RECONCILIATION_REQUIRED'
        : pending ? 'STORYBOARD_OPERATION_IN_PROGRESS'
          : result.entry.status === 'completed' ? 'STORYBOARD_OPERATION_RECOVERY_REQUIRED' : 'STORYBOARD_OPERATION_RESULT_UNCERTAIN';
    res.status(pending ? 202 : 409).json({ ok: false, code,
      error: pending ? '原制作请求仍在处理，请查询原任务；未重复调用供应商'
        : '原制作请求已提交但产物暂不可核验，请核对原任务记录；未重复调用供应商',
      operationId: input.operationId, providerTaskId: result.entry.output?.providerTaskId,
      providerModel: result.entry.output?.providerModel, providerAcceptedAt: result.entry.output?.providerAcceptedAt,
      segmentTaskIds: result.entry.output?.segmentTaskIds || result.entry.output?.acceptedTaskIds,
      legacyUnboundReceipt: !result.entry.inputFingerprint });
    return true;
  }

  async function storyboardReplayFrameBytesCurrent(frame: Material, tenantId: string, spec: Record<string, any>) {
    const provenance = frame.provenance as Record<string, any> | undefined;
    const current = storyboardProjectShotInput(spec, String(provenance?.shotId || ''));
    const shotSpec = provenance?.shotSpec as StoryboardShotSpec | undefined;
    if (frame.tenantId !== tenantId || frame.scope !== 'own' || frame.type !== 'image' || !current || !shotSpec
      || current.fingerprint !== provenance?.projectShotFingerprint
      || frame.objectKey && !isTenantPrivateObjectKey(frame.objectKey, tenantId)) return false;
    for (const asset of shotSpec.assets.filter(item => item.role === 'composition' && item.source === 'reference_video')) {
      const url = String(current.input.reference?.firstFrameRef || '');
      if (asset.id !== url) return false;
      const source = await storyboardUrlImage(url, tenantId);
      if (!source || createHash('sha256').update(source.base64).digest('hex') !== asset.version) return false;
    }
    const bytes = await readTenantMaterialBytes(frame as any, tenantId);
    const hash = createHash('sha256').update(bytes.bytes).digest('hex');
    const storedHash = String((frame as any).contentSha256 || provenance.firstFrameQualityInput?.sourceSha256 || '');
    if (storedHash && hash !== storedHash) return false;
    const metadata = await sharp(bytes.bytes).metadata();
    return !!metadata.width && !!metadata.height;
  }

  async function storyboardReplayVideoResponse(input: {
    entry: StoryboardAigcSpendEntry; tenantId: string; projectId: string; projectSpec: Record<string, any>;
    firstFrame: Material; shotId: string; firstFrameFingerprint: string; resolution: string;
    duration: number; model: string; actionSegments?: Array<{ providerDurationSeconds: number; targetDurationSeconds: number }>;
  }) {
    const materials = loadMaterials();
    const material = materials.find(item => item.id === String(input.entry.output?.materialId || '') && item.tenantId === input.tenantId);
    const p = material?.provenance as Record<string, any> | undefined;
    if (!material || material.scope !== 'own' || material.type !== 'video' || material.sourceType !== 'ai-seedance'
      || p?.storyboardAigc !== true || p.projectId !== input.projectId || p.shotId !== input.shotId
      || p.firstFrameMaterialId !== input.firstFrame.id || p.firstFrameFingerprint !== input.firstFrameFingerprint
      || p.resolution !== input.resolution || p.providerModel !== input.model
      || Math.abs(Number(p.durationSeconds) - input.duration) > .05 || !Number.isFinite(Number(p.durationSeconds))
      || JSON.stringify(p.shotSpec) !== JSON.stringify(input.firstFrame.provenance?.shotSpec)
      || material.objectKey && !isTenantPrivateObjectKey(material.objectKey, input.tenantId)) return null;
    if (!await storyboardReplayFrameBytesCurrent(input.firstFrame, input.tenantId, input.projectSpec)) return null;
    let quality = p.storyboardQualityReport;
    if (input.actionSegments) {
      const tasks = Array.isArray(p.segmentTasks) ? p.segmentTasks : [];
      if (tasks.length !== input.actionSegments.length || tasks.some((task: any, index: number) =>
        !task.taskId || Number(task.durationSeconds) !== input.actionSegments![index]!.providerDurationSeconds
        || Number(task.targetDurationSeconds) !== input.actionSegments![index]!.targetDurationSeconds
        || task.quality?.phase !== 'video' || task.quality?.passed !== true || task.quality?.status !== 'passed')) return null;
      quality = quality || { status: 'needs_review', requiresHumanReview: true };
      // Receipt recovery returns the original candidate, including an unreviewed
      // draft. Assignment admission still requires video QA and acceptance in the
      // project mutation route; requiring it here strands valid paid outputs before
      // the caller can submit them for review. Current KB identity remains required.
    } else if ((await storyboardKbAssignmentIssuesForSpec(input.tenantId,
      { ...input.projectSpec, storyboardAssignments: { [input.shotId]: material.id }, storyboardAssemblies: [] }, materials)).length) return null;
    const hash = await validateReplicationVideo(material as any, input.tenantId);
    if ((material as any).contentSha256 && hash !== (material as any).contentSha256) return null;
    const visible = await materialResponse(material, input.tenantId);
    return { ok: true, source: 'seedance', id: visible.id, url: visible.url, poster: visible.poster,
      duration: visible.duration, material: visible, quality, ...(input.actionSegments ? { segments: p.segmentTasks } : {}) };
  }

  return { respondToExistingStoryboardOperation, storyboardReplayFrameBytesCurrent, storyboardReplayVideoResponse };
}
