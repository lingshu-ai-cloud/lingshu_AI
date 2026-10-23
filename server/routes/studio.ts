import { type StudioVoicePaidContext } from '../lib/studioVoicePaidOperation.js';
import { type Material } from './studioMaterialProjection.js';
import { createStudioBgmRouter } from './studioBgmRoutes.js';
import { registerStudioTranslationRoutes } from './studioTranslationRoutes.js';
import { studioRenderMediaRouter } from '../lib/studioRenderMedia.js';
import { readLocalMaterials } from '../lib/materialLibrary.js';
import { contentLibraryRouter } from './contentLibrary.js';
import { Router } from 'express';
import path from 'path';
import { entitlementGate } from '../middleware/subscription.js';
import { type StudioAigcBudgetContext } from './studioAigcBatchBudget.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { TTS_ROOT } from '../studio/runtimeConfig.js';
import type { DigitalHumanJob } from '../studio/contracts.js';
import { createStudioApplication } from '../studio/application.js';
export { ctaSemanticallySatisfied, dedupeStoryboardFieldLines, fitSpeechToShot, fitStoryboardSpeech, normalizeStoryboardFieldLines, restoreProductStoryboardBoundaries, storyboardSpeechIssues, syncStoryboardSubtitles } from './studioStoryboardSpeechRules.js';
export {
  applySafeStoryboardSpeechFallback,
  buildSafeCloneStoryboard,
  canonicalMaterialPrimaryCta,
  clearStoryboardSpeech,
  ensureMaterialCanonicalCta,
  ensureStoryboardPrimaryCta,
  isBeautyProductInfo,
  isNonBlockingScriptQualityIssue,
  isPackagingOnlyProductInfo,
  lockedVoiceDurations,
  materialGroundingIssues,
  materialTimelineIssues,
  MAX_INTERACTIVE_SCRIPT_REPAIR_ATTEMPTS,
  normalizeMaterialInfos,
  openingMatchesCooperationRoute,
  openingMatchesTargetBuyer,
  productVoicePlanSupportsTheme,
  repairMaterialScript,
  requiresMinimumVoiceoverLines,
  safeProductScenes,
  safeProductVoicePlan,
  serializeLockedStoryboard,
} from './studioProductScriptRules.js';
export { productSceneMaterialBindingChanges, productSceneMaterialProductAssociationChanges, productSceneMaterialProvenanceOf } from './studioProductSceneProvenance.js';
export { terminalPublishedPlatformPostId } from './studioPublishLinkRoutes.js';
export { automationBgmAudio, automationBgmCatalog } from './studioBgmCatalog.js';
export { buildStudioProductScenePreparationSlots, filterMaterialsByProductAssociation, scopeProductSceneProjection } from './studioProductSceneProjection.js';
export { productSceneUploadReuseMetadata } from './studioProductSceneUpload.js';
export { splitStudioNarrationSentences, splitVoiceoverLanguageLines, voiceoverLineNeedsLanguageRepair } from './studioVoiceoverLanguageRules.js';
export { refreshStudioProjectAssetUrls, studioProjectSpecForStorage } from '../lib/studioProjectAssets.js';
export { matchedReferenceIndustryLeaks } from '../lib/referenceIndustryLeak.js';
export { normalizeCompleteTimestampTranslation, normalizeTimestampTranslationValue, timestampedTranslationCues } from '../lib/translationCues.js';
export {
  auditCommercialClaims,
  confirmedEnterpriseContextForProduct,
  hasConfirmedEnterpriseFacts,
  storyboardReferenceLeakIssues,
  stripStoryboardHashtags,
  stripStoryboardReferenceLeaks,
  unconfirmedEnterpriseProductFields,
  unsupportedNumericClaims,
} from '../lib/studioGenerationTruthfulness.js';
export { productionAnalysisSegments } from './studioMaterialAnalysisSegments.js';
export { ensureSelectedProductNamesInScript } from '../lib/studioScriptNormalization.js';

export const studioRouter = Router();
const application = createStudioApplication(studioRouter);
const { studioTenantContext, resolveStudioVoiceExecutionPlan, synthesizeStudioVoiceForAutomation } = application;
export { resolveStudioVoiceExecutionPlan, synthesizeStudioVoiceForAutomation };

studioRouter.use(requireAuth);

studioRouter.use('/local-renders', studioRenderMediaRouter(path.resolve(process.cwd(), 'data/publishing-uploads')));

studioRouter.use((_req, res, next) => {
  studioTenantContext.run((res.locals as AuthLocals).tenantId, next);
});

application.workspaceAdmissionApplication.registerPostMapProductColumns();
application.workspaceAdmissionApplication.registerGetSubscription();
studioRouter.use(contentLibraryRouter);

studioRouter.use(entitlementGate());

application.workspaceAdmissionApplication.registerShootingTasksRouter();
application.workspaceAdmissionApplication.registerProductionInputRequestsRouter();
application.workspaceAdmissionApplication.registerProductAssetRequestsRouter();
application.workspaceAdmissionApplication.registerProductionCostQuotesRouter();
application.workspaceAdmissionApplication.registerStudioAvatarProductionRouter();
application.freeCreationHookApplication.registerPostFreeCreationHookFirstFrame();
application.freeCreationHookApplication.registerPostStoryboardProductMatch();
application.storyboardFirstFrameApplication.registerPostStoryboardFirstFrame();
application.storyboardFrameReviewApplication.registerPostStoryboardFirstFrameIdRecheckQuality();
application.storyboardFrameReviewApplication.registerPostStoryboardFirstFrameIdConfirm();
application.storyboardActionApplication.registerPostStoryboardActionVideo();
application.storyboardVideoApplication.registerPostSeedanceVideo();
application.storyboardQualityApplication.registerPostStoryboardQualityCheck();
application.storyboardQualityApplication.registerPostStoryboardQualityCheckMaterialIdReview();
application.storyboardQualityApplication.registerGetStoryboardAigcMetrics();
application.geminiVideoApplication.registerPostGeminiVideo();
application.scriptApplication.registerPostScript();
application.coverTitlesApplication.registerPostCovers();
application.posterPlanningApplication.registerPostFbPoster();
application.leadPackageApplication.registerPostLeadContentPackage();
application.posterRenderApplication.registerPostFbPosterRender();
application.captionApplication.registerPostCaption();
registerStudioTranslationRoutes(studioRouter, () => TTS_ROOT);
application.editorialApplication.registerPostInsight();
application.editorialApplication.registerPostSelect();
application.renderAdmissionApplication.registerPostRender();
application.localRenderApplication.registerPostRenderLocal();
application.persistentRenderApplication.registerPostRenderJobs();
application.persistentRenderApplication.registerGetRenderJobsProjectProjectIdLatest();
application.persistentRenderApplication.registerPostRenderJobsIdRetry();
application.persistentRenderApplication.registerPostRenderOpenOutput();
application.digitalHumanApplication.registerGetDigitalHumanAvatars();
application.digitalHumanApplication.registerPostDigitalHumanJobsIdApprove();
application.digitalHumanApplication.registerGetDigitalHumanCapabilities();
application.transformationApplication.registerPostTransformationsAssess();
application.transformationApplication.registerPostPersonReplacementPlan();
application.digitalHumanRoutesApplication.registerGetDigitalHumanJobs();
application.digitalHumanRoutesApplication.registerPostDigitalHumanJobs();
application.digitalHumanRoutesApplication.registerGetDigitalHumanJobsId();
application.digitalHumanRoutesApplication.registerPostDigitalHumanJobsIdRetry();
application.digitalHumanRoutesApplication.registerPostDigitalHumanJobsIdCancel();
application.videoVersionsApplication.registerGetVideoVersions();
application.videoVersionsApplication.registerPatchVideoVersionsIdSelect();
application.materialReadApplication.registerGetMaterials();
application.materialReadApplication.registerGetMaterialsIdUsage();
application.materialReadApplication.registerGetMaterialsPbIdKind();
application.materialUploadRoutesApplication.registerPostMaterialsFile();
application.materialMetadataRoutesApplication.registerPostMaterials();
application.materialMetadataRoutesApplication.registerPostMaterialsIdAnalysis();
application.materialAnalysisApplication.registerPostMaterialsIdAnalyzeSegments();
application.materialAnalysisApplication.registerPostMaterialsIdClassify();
application.materialMetadataRoutesApplication.registerPatchMaterialsIdSegmentsSegmentId();
application.materialMetadataRoutesApplication.registerPatchMaterialsIdPin();
application.materialMetadataRoutesApplication.registerGetMaterialProducts();
application.materialMetadataRoutesApplication.registerPatchMaterialsIdGeneratedImageReview();
application.materialMetadataRoutesApplication.registerPatchMaterialsId();
application.materialMetadataRoutesApplication.registerDeleteMaterialsId();
application.coverRenderingApplication.registerPostCover();
application.privateAssetsApplication.registerGetPrivateAssetsNamespaceFile();
application.ttsRoutesApplication.registerGetTtsCapabilities();
application.ttsRoutesApplication.registerPostTtsMinimaxDiagnose();
application.ttsRoutesApplication.registerPostTts();
application.ttsRoutesApplication.registerStudioAsrRouter();
application.ttsRoutesApplication.registerPostTtsAlign();
application.ttsRoutesApplication.registerPostTtsTranscribe();
application.ttsRoutesApplication.registerPostTtsBatch();
application.voiceSamplesApplication.registerGetVoiceSamples();
application.voiceSamplesApplication.registerPostVoiceSamples();
application.ttsRoutesApplication.registerPostVoiceover();
studioRouter.use('/bgm', createStudioBgmRouter());
application.projectRoutesApplication.registerStudioProjectReadRouter();
application.projectRoutesApplication.registerStudioProjectSaveRouter();
application.projectRoutesApplication.registerStudioProjectReviewRouter();
application.projectRoutesApplication.registerStudioVariationBatchRoutes();
application.projectRoutesApplication.registerGetPublishRecords();
application.projectRoutesApplication.registerPostPublishRecommendations();
application.projectRoutesApplication.registerStudioPublishLinkRoutes();

export function heygenOutputPath(tenantId: string, jobId: string): string {
  return application.heygenOutputPath(tenantId, jobId);
}

export async function ensureHeygenAutomationJob(input: { tenantId: string; projectId: string; avatarId: string; consent: boolean; voiceoverUrl: string; script: string; language: string; providerPollOnly?: boolean }): Promise<DigitalHumanJob> {
  return application.ensureHeygenAutomationJob(input);
}

export async function analyzeMaterialVideo(videoPath: string, buffer: Buffer, duration: number) {
  return application.analyzeMaterialVideo(videoPath, buffer, duration);
}

export async function alignStudioVoiceForAutomation(input: { tenantId: string; text: string; url: string; duration: number;paidContext?:StudioVoicePaidContext;
  preparedTrack?:{scope:import('../lib/socialContentTaskBudget.js').SocialTaskBudgetScope;receiptRef:string;filePath:string;audioSha256:string} }) {
  return application.alignStudioVoiceForAutomation(input);
}

export function unpublishableGenerationReasons(spec: Record<string, unknown>): string[] {
  return application.unpublishableGenerationReasons(spec);
}

export async function automationStoryboardAssignmentIssues(tenantId: string, projectId: string, spec: Record<string, unknown>, materials = readLocalMaterials() as Material[]): Promise<string[]> {
  return application.automationStoryboardAssignmentIssues(tenantId, projectId, spec, materials);
}

export async function studioAigcBudgetContext(tenantId: string, project: { id: string; tenant_id: string; spec?: Record<string, any> }): Promise<StudioAigcBudgetContext> {
  return application.studioAigcBudgetContext(tenantId, project);
}
