import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import type { DigitalPresenterExecutionRequest } from './socialContentDigitalPresenterAdapter.js';
import { createSocialSeedancePresenterBridge, type SeedancePresenterBridgeDependencies } from './socialContentSeedancePresenterBridge.js';
import { validatePresenterRightsEvidence } from '../lib/presenterAssetTrust.js';
import { readConfirmedPresenterFirstFrameApproval } from './socialContentPresenterFirstFrameApproval.js';
import { objectStorageUpload, objectStorageSignedGetUrl } from '../storage/objectStorage.js';
import { inspectStoryboardAigcFramesWithQwen } from '../agents/qwen.js';
import { runVisualFfmpeg, inspectRenderedVisuals } from '../lib/renderVisualQuality.js';
import { trimAndProbeProductScene } from './socialContentProductReplacementExecution.js';
import type { SocialTaskBudgetScope } from '../lib/socialContentTaskBudget.js';

const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
/** Concrete Seedream-approved-first-frame → Seedance I2V runtime. The caller
 * supplies only the existing canonical whole-film funding boundary, not media
 * preparation or QA stubs. Strict speech is deliberately not advertised. */
export function createEnvironmentSocialSeedancePresenterBridge(options: {
  store: DataStore; scope: SocialTaskBudgetScope; maximumCostCny: number;
  qaModel: string;
  authorizeBudget: SeedancePresenterBridgeDependencies['authorizeBudget'];
  assertCurrent: SeedancePresenterBridgeDependencies['assertCurrent'];
  beforePaidSubmit(stage: 'presenter_video' | 'video_qa', input: DigitalPresenterExecutionRequest, body: Record<string, unknown>): Promise<void>;
  recordPaidReceipt(stage: 'presenter_video' | 'video_qa', input: DigitalPresenterExecutionRequest, receipt: unknown): Promise<void>;
}) {
  const apiKey = process.env.SEEDANCE_API_KEY?.trim() ?? '';
  const model = process.env.SEEDANCE_MODEL?.trim() || 'doubao-seedance-2-0-fast-260128';
  if (process.env.SEEDANCE_VIDEO_ENABLED !== 'true' || !apiKey) return { readiness: { ready: false, reasons: ['seedance_presenter_not_enabled'] }, ports: null };
  const ports = createSocialSeedancePresenterBridge({
    store: options.store, apiKey, model, baseUrl: process.env.SEEDANCE_BASE_URL, maximumCostCny: options.maximumCostCny,
    assertCurrent: options.assertCurrent, authorizeBudget: options.authorizeBudget,
    beforeSubmit: (input, body) => options.beforePaidSubmit('presenter_video', input, body),
    async resolvePresenter({ tenantId, presenterAssetId, socialAccountId }) {
      const result = await options.store.list<any>('studio_production_defaults', { where: { tenant_id: tenantId }, perPage: 2 });
      if (result.totalItems !== 1 || result.items.length !== 1) return null;
      const matches = (result.items[0]?.payload?.presenters ?? []).filter((p: any) => p.id === presenterAssetId && (!socialAccountId || p.socialAccountId === socialAccountId));
      if (matches.length !== 1) return null;
      const p = matches[0], rights = validatePresenterRightsEvidence(p.rightsEvidence, { provider: 'volcengine_ark', uses: ['digital_presenter', 'person_replacement'] });
      if (!rights.ok || p.authorized !== true || !Number.isSafeInteger(p.assetVersion) || p.assetVersion < 1) return null;
      return { presenterAssetId, providerId: 'seedance', identityMode:'enterprise_asset_first_frame' as const, providerPresenterId:null,providerVoiceId:null, authorizationRef: rights.evidence.authorizationRef, consentRef: rights.evidence.consentRef, assetVersion: p.assetVersion, authorized: true as const,
        ...(p.socialAccountId ? { socialAccountId: p.socialAccountId } : {}), ...(p.presenterProfileId ? { presenterProfileId: p.presenterProfileId } : {}), ...(p.presenterProfileVersion ? { presenterProfileVersion: p.presenterProfileVersion } : {}), ...(p.consistencyKey ? { consistencyKey: p.consistencyKey } : {}) };
    },
    async prepareInputs(input) {
      if (input.tenantId !== options.scope.tenantId || input.taskId !== options.scope.taskId) throw Error('seedance_presenter_scope_changed');
      const rows = await options.store.list<any>('social_presenter_first_frame_approvals', { where: { tenant_id: input.tenantId, task_id: input.taskId, run_id: options.scope.runId, plan_hash: options.scope.planHash }, perPage: 100 });
      if (rows.totalItems !== rows.items.length) throw Error('seedance_presenter_approval_scan_incomplete');
      const matches = rows.items.filter(row => row.record_hash === input.approvedFirstFrame.approvalRecordHash);
      if (matches.length !== 1) throw Error('seedance_presenter_approval_missing');
      const found = await readConfirmedPresenterFirstFrameApproval(options.store, { scope: options.scope, groupId: matches[0].group_id, presenterGroupContractHash: input.approvedFirstFrame.presenterGroupContractHash, presenterAssetId: input.presenter.presenterAssetId });
      if (!found || found.approval.recordHash !== input.approvedFirstFrame.approvalRecordHash || found.approval.compositeFirstFrameSha256 !== input.approvedFirstFrame.sha256 || found.approval.presenter.assetVersion !== input.presenter.assetVersion) throw Error('seedance_presenter_approved_identity_changed');
      const bytes = await fs.readFile(input.approvedFirstFrame.localPath);
      if (sha(bytes) !== input.approvedFirstFrame.sha256) throw Error('seedance_presenter_first_frame_changed');
      const key = `tenants/${encodeURIComponent(input.tenantId)}/seedance-presenter/${sha(bytes)}.png`;
      await objectStorageUpload({ key, body: bytes, contentType: 'image/png' });
      return { firstFrameUrl: await objectStorageSignedGetUrl(key, 3600), firstFrameSha256: sha(bytes) };
    },
    async verifyOutput(input, output) {
      await options.recordPaidReceipt('presenter_video', input, { providerTaskId: output.providerTaskId, sourceSha256: output.sha256 });
      const deliveredPath = path.join(input.outputDirectory, `${output.sha256}-delivery.mp4`);
      const durationSeconds = await trimAndProbeProductScene(output.localPath, deliveredPath, input.visualControl.timing.durationSeconds);
      const technical = await inspectRenderedVisuals({ outputPath: deliveredPath, expectedDuration: durationSeconds });
      const frames: Array<{base64:string;mimeType:string;timeLabel:string}> = [];
      for (const [index, second] of [0, durationSeconds / 2, Math.max(0, durationSeconds - .1)].entries()) {
        const file = path.join(input.outputDirectory, `${output.sha256}-qa-${index}.jpg`);
        const extracted = await runVisualFfmpeg(['-ss', String(second), '-i', deliveredPath, '-frames:v', '1', '-vf', 'scale=720:-2', '-y', file], false, { timeoutMs: 60000 });
        if (!extracted.ok) throw Error('seedance_presenter_qa_frame_extract_failed');
        frames.push({ base64: (await fs.readFile(file)).toString('base64'), mimeType: 'image/jpeg', timeLabel: `candidate-${index}` });
      }
      let receipt: unknown;
      const observations = await inspectStoryboardAigcFramesWithQwen({ model: options.qaModel, boundedPaidQa: true,
        paidSubmission: body => options.beforePaidSubmit('video_qa', input, body), onReceipt: value => { receipt = value; }, phase: 'video', sceneType: 'general', frames,
        personReferences: [{ base64: (await fs.readFile(input.approvedFirstFrame.localPath)).toString('base64'), mimeType: 'image/png', timeLabel: 'authorized-person-first-frame' }],
        storyboard: JSON.stringify(input.visualControl), productInfo: 'No product interaction. Check the authorized presenter identity and exact measured motion; do not certify speech or lip synchronization.',
        startState: input.visualControl.action.startState, beats: [input.visualControl.action.path, input.visualControl.action.peak], endState: input.visualControl.action.endState });
      if (!receipt) throw Error('seedance_presenter_qa_provider_receipt_missing');
      await options.recordPaidReceipt('video_qa', input, receipt);
      const required = ['person_identity', 'layout_continuity', 'action_order', 'end_state', 'visual_integrity'];
      const passed = technical.passed && required.every(key => { const matches = observations.filter(x => x.key === key); return matches.length === 1 && matches[0]!.verdict === 'pass' && matches[0]!.evidenceFrames.some(label => frames.some(frame => frame.timeLabel === label)); });
      const report = { schemaVersion: 'seedance-presenter-dynamic-qa.v1', providerTaskId: output.providerTaskId, sourceSha256: output.sha256, deliveredSha256: sha(await fs.readFile(deliveredPath)), approvalRecordHash: input.approvedFirstFrame.approvalRecordHash, observations, technical, preciseSpeechVerified: false, passed };
      const evidence = path.join(input.outputDirectory, `${sha(JSON.stringify(report))}-qa.json`); await fs.writeFile(evidence, JSON.stringify(report), { mode: 0o600 });
      return { passed, durationSeconds, deliveredPath, evidenceRefs: [evidence] };
    },
  });
  return { readiness: { ready: true, reasons: [] }, ports };
}
