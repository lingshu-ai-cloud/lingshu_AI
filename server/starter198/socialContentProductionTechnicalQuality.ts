import { persistSocialTechnicalReplay, SOCIAL_TECHNICAL_REVIEW_POLICY } from './socialContentTechnicalReplayEvidence.js';
import { probeSocialSceneMediaCached } from './socialSceneMediaProbeCache.js';
import { hasSocialMeasuredMediaHardFailure } from './socialContentGraphQualityGate.js';
import { recordCurrentContentExecutionCheckpoint } from '../contentExecution/context.js';
import { inspectRenderedScenes, inspectRenderedVisuals, runVisualFfmpeg } from '../lib/renderVisualQuality.js';
import type { runSocialContentAutoProduction } from './socialContentProductionExecution.js';
import type { SocialDirectorContentHandoff } from './socialContentDirectorPlan.js';
import { socialProductionReferenceFidelityFailures } from './socialContentProductionCollaboration.js';
import type { InitialSceneQualityReport } from './socialContentInitialSceneCache.js';
import { executeSocialQualityStage, type executeSocialRenderStage } from './socialContentProductionStages.js';
import { socialRequestHash } from './socialContentValidation.js';
import { writeExecutionStage } from './socialContentProductionRuntimeSupport.js';
import type { readSocialTaskDetail } from './socialContentRecords.js';
import type { probeSocialSceneMedia } from './socialSceneMediaHardProbe.js';

type Execution = Parameters<typeof runSocialContentAutoProduction>[0];
type Detail = NonNullable<Awaited<ReturnType<typeof readSocialTaskDetail>>>;
type RenderResult = Awaited<ReturnType<typeof executeSocialRenderStage>>;

/** The same positive hard-failure predicate used by the graph gate. Unknown
 * probe findings retain their separate admissions and never become a pass. */
export function applyMeasuredSocialTechnicalQuality(input: { preliminaryApproved: boolean; technicalFailures: string[]; mediaHardProbe: unknown }) {
  const hardFailure = hasSocialMeasuredMediaHardFailure(input.mediaHardProbe);
  return { technicalApproved: input.preliminaryApproved && !hardFailure,
    technicalFailures: hardFailure ? [...input.technicalFailures, 'measured_media_hard_failure'] : input.technicalFailures };
}

/** Bind technical approval to the actual rendered bytes and frozen scene/voice evidence. */
export async function inspectSocialContentProductionTechnicalQuality(input: {
  execution: Execution;
  detail: Detail;
  agentWorkflow: NonNullable<Detail['agentWorkflow']>;
  contentHandoff: SocialDirectorContentHandoff;
  renderResult: RenderResult;
  manifest: Record<string, unknown>;
  duration: number;
  timeline: Array<{ sceneId: string; targetStart: number; targetEnd: number }>;
  preserveReferenceTimeline: boolean;
  bgmQualitySource: { source: string; sourceHash: string };
  frozenVoiceCues: Parameters<typeof probeSocialSceneMedia>[0]['frozenVoiceCues'];
}) {
  const { execution, detail, agentWorkflow, contentHandoff, renderResult } = input;
  await writeExecutionStage({ ...execution, stage: 'quality_check',
    message: '内容 Agent 正在检查成片画面、音轨和字幕。' });
  const { quality, sceneQuality, audio, measuredDurationSeconds } = await executeSocialQualityStage({
    outputPath: renderResult.outputPath, duration: input.duration,
    scenes: input.timeline.map(clip => ({ start: clip.targetStart, end: clip.targetEnd })),
    expectedUniqueScenes: contentHandoff.scenes.length,
    inspectVisuals: execution.runtime?.inspectVisuals ?? inspectRenderedVisuals,
    inspectScenes: execution.runtime?.inspectScenes ?? inspectRenderedScenes,
    runFfmpeg: execution.runtime?.runFfmpeg ?? runVisualFfmpeg,
    checkpointEnabled: Boolean(execution.graphPhase),
    verifyDuration: input.preserveReferenceTimeline,
    expectedBgm: { ...input.bgmQualitySource, volume: contentHandoff.bgmSelection.volume },
  });
  const finalFidelityFailures = socialProductionReferenceFidelityFailures(agentWorkflow, contentHandoff, {
    referenceAnalysis: detail.referenceVideoAnalysis,
    renderedDurationSeconds: measuredDurationSeconds ?? input.duration,
    renderedTimeline: input.timeline.map(clip => ({ sceneId: clip.sceneId,
      startSeconds: clip.targetStart, endSeconds: clip.targetEnd })),
  });
  const preliminaryFailures = [...quality.failures, ...sceneQuality.issues.map(issue => issue.reason),
    ...(!audio.ok ? ['成片音轨无法解码'] : []), ...finalFidelityFailures];
  const preliminaryApproved = quality.passed && sceneQuality.passed && audio.ok
    && (!audio.bgm || audio.bgm.passed) && !finalFidelityFailures.length;
  const mediaHardProbe = await probeSocialSceneMediaCached({ filePath: renderResult.outputPath,
    manifest: input.manifest, frozenVoiceCues: input.frozenVoiceCues,
    subtitleRenderEvidence: renderResult.receipt.subtitleRenderEvidence,
    frameRenderEvidence: renderResult.receipt.frameRenderEvidence,
    ...(renderResult.receipt.captionBaselineSidecar && renderResult.receipt.subtitleAssSidecar
      ? { captionMaskSources: {
        baselinePath: renderResult.receipt.captionBaselineSidecar.path,
        baselineSha256: renderResult.receipt.captionBaselineSidecar.sha256,
        assPath: renderResult.receipt.subtitleAssSidecar.path,
        assSha256: renderResult.receipt.subtitleAssSidecar.sha256,
      } } : {}),
  }, { tenantId: execution.tenantId, taskId: execution.taskId, runId: execution.runId });
  const { technicalApproved, technicalFailures } = applyMeasuredSocialTechnicalQuality({ preliminaryApproved, technicalFailures: preliminaryFailures, mediaHardProbe });
  const technicalQualityReport: InitialSceneQualityReport = {
    schemaVersion: 'initial-scene-quality.v1', policyVersion: SOCIAL_TECHNICAL_REVIEW_POLICY, visual: quality, scenes: sceneQuality,
    sourceTextReview: Array.isArray(input.manifest.sourceTextReview) ? input.manifest.sourceTextReview as InitialSceneQualityReport['sourceTextReview'] : [],
    audio: { ok: audio.ok && (!audio.bgm || audio.bgm.passed),
      error: !audio.ok ? '成片音轨无法解码' : audio.bgm?.failure ?? null,
      ...(audio.bgm ? { bgm: audio.bgm } : {}) }, mediaHardProbe,
  };
  const replayEvidenceHash = await persistSocialTechnicalReplay({scope:{tenantId:execution.tenantId,taskId:execution.taskId,runId:execution.runId},manifest:input.manifest,renderReceipt:renderResult.receipt,frozenVoiceCues:input.frozenVoiceCues});
  if(replayEvidenceHash)technicalQualityReport.replayEvidenceHash=replayEvidenceHash;
  const technicalQualityInputHash = socialRequestHash({ outputSha256: renderResult.receipt.sha256,
    manifestHash: socialRequestHash(input.manifest), policyVersion: SOCIAL_TECHNICAL_REVIEW_POLICY });
  await recordCurrentContentExecutionCheckpoint({ stage: 'social.graph_technical_quality',
    version: '1', inputHash: technicalQualityInputHash,
    payload: { outputSha256: renderResult.receipt.sha256, renderCheckpointInputHash: renderResult.receipt.inputHash,
      manifestHash: socialRequestHash(input.manifest), policyVersion: SOCIAL_TECHNICAL_REVIEW_POLICY, approved: technicalApproved,
      failureCount: technicalFailures.length, failures: technicalFailures.slice(0, 100),
      reportHash: socialRequestHash(technicalQualityReport), checkedScenes: sceneQuality.checkedScenes },
  });
  return { quality, sceneQuality, audio, measuredDurationSeconds, technicalFailures,
    technicalApproved, technicalQualityReport };
}
