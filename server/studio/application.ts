import type { LocalTtsPorts } from '../routes/studioLocalTtsAdapters.js';
import { createStudioTtsProviderRuntime } from '../routes/studioTtsProviderRuntime.js';
import { createStudioTtsGeneration } from '../routes/studioTtsGeneration.js';
import { createStudioVoiceAutomation } from '../routes/studioVoiceAutomation.js';
import { Router } from 'express';
import ffmpegStatic from 'ffmpeg-static';
import { tenantAssetDir } from '../lib/assetAccess.js';
import { ffmpegBin, TTS_ROOT, VOICE_SAMPLES_ROOT } from './runtimeConfig.js';
import type { StudioApplicationPorts } from './applicationPorts.js';
import { listAllTenantRows, loadDurableMaterialPublishLinks } from './materialUsageReadModel.js';
import { studioTenantContext, scopedStudioAssetDir, scopedStudioAssetUrl, enterpriseCtx } from './tenantContext.js';
import { composite, publishingRenderDir, publishingRenderPreviewUrl, execFileAsync, runFfmpeg, extractPoster } from './localMediaRuntime.js';
import { createGeneratedVideoRuntime } from './generatedVideoRuntime.js';
import { createStudioWorkspaceAdmissionRoutes } from '../routes/studioWorkspaceAdmissionRoutes.js';
import { createStudioFreeCreationHookRoutes } from '../routes/studioFreeCreationHookRoutes.js';
import { createStoryboardReferenceAssets } from './storyboardReferenceAssets.js';
import { createStoryboardOperationRecovery } from './storyboardOperationRecovery.js';
import { createStudioStoryboardFirstFrameRoutes } from '../routes/studioStoryboardFirstFrameRoutes.js';
import { createStudioStoryboardFrameReviewRoutes } from '../routes/studioStoryboardFrameReviewRoutes.js';
import { createStudioStoryboardActionRoutes } from '../routes/studioStoryboardActionRoutes.js';
import { createStudioStoryboardVideoRoutes } from '../routes/studioStoryboardVideoRoutes.js';
import { createStudioStoryboardQualityRoutes } from '../routes/studioStoryboardQualityRoutes.js';
import { createStudioGeminiVideoRoutes } from '../routes/studioGeminiVideoRoutes.js';
import { createStudioScriptRoutes } from '../routes/studioScriptRoutes.js';
import { createStudioCoverTitleRoutes } from '../routes/studioCoverTitleRoutes.js';
import { createStudioPosterPlanningRoutes } from '../routes/studioPosterPlanningRoutes.js';
import { createStudioLeadPackageRoutes } from '../routes/studioLeadPackageRoutes.js';
import { createStudioPosterRenderRoutes } from '../routes/studioPosterRenderRoutes.js';
import { createStudioCaptionRoutes } from '../routes/studioCaptionRoutes.js';
import { createStudioEditorialRoutes } from '../routes/studioEditorialRoutes.js';
import { createRenderManifestApplication } from './renderManifestApplication.js';
import { createStudioRenderAdmissionRoutes } from '../routes/studioRenderAdmissionRoutes.js';
import { createStudioLocalRenderRoutes } from '../routes/studioLocalRenderRoutes.js';
import { createStudioPersistentRenderRoutes } from '../routes/studioPersistentRenderRoutes.js';
import { createStudioVideoVersionRoutes } from '../routes/studioVideoVersionRoutes.js';
import { loadMaterials, persistMaterials } from './materialRepository.js';
import { createDigitalHumanRuntime } from './digitalHumanRuntime.js';
import { createStudioTransformationRoutes } from '../routes/studioTransformationRoutes.js';
import { createStudioDigitalHumanJobRoutes } from '../routes/studioDigitalHumanJobRoutes.js';
import { createStudioMaterialReadRoutes } from '../routes/studioMaterialReadRoutes.js';
import { createMaterialUploadApplication } from './materialUploadApplication.js';
import { createStudioMaterialUploadRoutes } from '../routes/studioMaterialUploadRoutes.js';
import { createStudioMaterialMutationRoutes } from '../routes/studioMaterialMutationRoutes.js';
import { createStudioMaterialAnalysisRoutes } from '../routes/studioMaterialAnalysisRoutes.js';
import { createStudioCoverRenderingRoutes } from '../routes/studioCoverRenderingRoutes.js';
import { createStudioPrivateAssetRoutes } from '../routes/studioPrivateAssetRoutes.js';
import { createStudioTtsRoutes } from '../routes/studioTtsRoutes.js';
import { createAudioAlignmentApplication } from './audioAlignmentApplication.js';
import { createStudioVoiceSampleRoutes } from '../routes/studioVoiceSampleRoutes.js';
import { createProjectEvidenceApplication } from './projectEvidenceApplication.js';
import { createStudioProjectWorkspaceRoutes } from '../routes/studioProjectWorkspaceRoutes.js';
import { createPosterReferenceAssets } from './posterReferenceAssets.js';

export function createStudioApplication(studioRouter: Router) {
  const ports: StudioApplicationPorts = {
    get extractPoster() { return extractPoster; },
    get loadMaterials() { return loadMaterials; },
    get persistMaterials() { return persistMaterials; },
    get studioRouter() { return studioRouter; },
    get storyboardEnterpriseImage() { return storyboardEnterpriseImage; },
    get storyboardUrlImage() { return storyboardUrlImage; },
    get storyboardKbAssignmentIssuesForSpec() { return storyboardKbAssignmentIssuesForSpec; },
    get storyboardCharacterMaterialAuthorizationIssue() { return storyboardCharacterMaterialAuthorizationIssue; },
    get storyboardPersonAssetImage() { return storyboardPersonAssetImage; },
    get storyboardMaterialImage() { return storyboardMaterialImage; },
    get storyboardReplayFrameBytesCurrent() { return storyboardReplayFrameBytesCurrent; },
    get storyboardIdentityNotice() { return storyboardIdentityNotice; },
    get respondToExistingStoryboardOperation() { return respondToExistingStoryboardOperation; },
    get studioAigcBudgetContext() { return studioAigcBudgetContext; },
    get storyboardImageUrlPath() { return storyboardImageUrlPath; },
    get storyboardKbFrameVersionIssues() { return storyboardKbFrameVersionIssues; },
    get storyboardPersonFrameVersionIssues() { return storyboardPersonFrameVersionIssues; },
    get storyboardEnvironmentFrameVersionIssues() { return storyboardEnvironmentFrameVersionIssues; },
    get storyboardKbProductViewReferences() { return storyboardKbProductViewReferences; },
    get seedanceVideoConfig() { return seedanceVideoConfig; },
    get storyboardReplayVideoResponse() { return storyboardReplayVideoResponse; },
    get isSeedanceVideoEnabled() { return isSeedanceVideoEnabled; },
    get seedanceFetchJson() { return seedanceFetchJson; },
    get seedanceTaskId() { return seedanceTaskId; },
    get waitForSeedanceTask() { return waitForSeedanceTask; },
    get findUrlDeep() { return findUrlDeep; },
    get downloadGeneratedVideo() { return downloadGeneratedVideo; },
    get execFileAsync() { return execFileAsync; },
    get createGeneratedVideoMaterial() { return createGeneratedVideoMaterial; },
    get normalizeSeedanceVideoDuration() { return normalizeSeedanceVideoDuration; },
    get appendVideoVersion() { return appendVideoVersion; },
    get summarizeSeedanceError() { return summarizeSeedanceError; },
    get isGeminiVideoEnabled() { return isGeminiVideoEnabled; },
    get normalizeGeminiVideoDuration() { return normalizeGeminiVideoDuration; },
    get geminiVideoConfig() { return geminiVideoConfig; },
    get runGeminiVideoWorker() { return runGeminiVideoWorker; },
    get enterpriseCtx() { return enterpriseCtx; },
    get spokenText() { return spokenText; },
    get resolveReferenceImages() { return resolveReferenceImages; },
    get studioTenantContext() { return studioTenantContext; },
    get buildManifest() { return buildManifest; },
    get publishingRenderDir() { return publishingRenderDir; },
    get composite() { return composite; },
    get publishingRenderPreviewUrl() { return publishingRenderPreviewUrl; },
    get loadDigitalHumanJobs() { return loadDigitalHumanJobs; },
    get publicDigitalHumanJob() { return publicDigitalHumanJob; },
    get digitalHumanCapabilities() { return digitalHumanCapabilities; },
    get validDigitalHumanVoiceoverUrl() { return validDigitalHumanVoiceoverUrl; },
    get ensureHeygenAutomationJob() { return ensureHeygenAutomationJob; },
    get updateDigitalHumanJob() { return updateDigitalHumanJob; },
    get refreshDigitalHumanJob() { return refreshDigitalHumanJob; },
    get persistDigitalHumanJobs() { return persistDigitalHumanJobs; },
    get digitalHumanConfig() { return digitalHumanConfig; },
    get digitalHumanFetch() { return digitalHumanFetch; },
    get digitalHumanProviderHeaders() { return digitalHumanProviderHeaders; },
    get listAllTenantRows() { return listAllTenantRows; },
    get loadDurableMaterialPublishLinks() { return loadDurableMaterialPublishLinks; },
    get materialUploadFileName() { return materialUploadFileName; },
    get saveMaterialUploadToDatabase() { return saveMaterialUploadToDatabase; },
    get scopedStudioAssetDir() { return scopedStudioAssetDir; },
    get persistPrivateStudioAsset() { return persistPrivateStudioAsset; },
    get scopedStudioAssetUrl() { return scopedStudioAssetUrl; },
    get studioAudioCapabilities() { return studioAudioCapabilities; },
    get minimaxFetchJson() { return minimaxFetchJson; },
    get rememberRejectedMinimaxCredential() { return rememberRejectedMinimaxCredential; },
    get synthesizeStudioVoiceForAutomation() { return synthesizeStudioVoiceForAutomation; },
    get localTtsFile() { return localTtsFile; },
    get proportionalCues() { return proportionalCues; },
    get alignTtsAudio() { return alignTtsAudio; },
    get readVoiceSampleIndex() { return readVoiceSampleIndex; },
    get privateStudioAssetUrl() { return privateStudioAssetUrl; },
    get voiceSamplePathFromId() { return voiceSamplePathFromId; },
    get readMinimaxVoiceCache() { return readMinimaxVoiceCache; },
    get writeMinimaxVoiceCache() { return writeMinimaxVoiceCache; },
    get writeVoiceSampleIndex() { return writeVoiceSampleIndex; },
    get appendCompletedPosterMaterialUsage() { return appendCompletedPosterMaterialUsage; },
    get unpublishableGenerationReasons() { return unpublishableGenerationReasons; },
  };

  const generatedVideoApplication = createGeneratedVideoRuntime(ports);
  const { geminiVideoConfig, isGeminiVideoEnabled, seedanceVideoConfig, isSeedanceVideoEnabled, normalizeGeminiVideoDuration, normalizeSeedanceVideoDuration, createGeneratedVideoMaterial, seedanceFetchJson, findUrlDeep, seedanceTaskId, summarizeSeedanceError, waitForSeedanceTask, downloadGeneratedVideo, runGeminiVideoWorker } = generatedVideoApplication;

  const workspaceAdmissionApplication = createStudioWorkspaceAdmissionRoutes(ports);


  const freeCreationHookApplication = createStudioFreeCreationHookRoutes(ports);


  const storyboardAssetsApplication = createStoryboardReferenceAssets(ports);
  const { storyboardImageUrlPath, storyboardEnterpriseImage, storyboardMaterialImage, storyboardPersonAssetImage, storyboardCharacterMaterialAuthorizationIssue, storyboardUrlImage, storyboardIdentityNotice } = storyboardAssetsApplication;

  const storyboardRecoveryApplication = createStoryboardOperationRecovery(ports);
  const { respondToExistingStoryboardOperation, storyboardReplayFrameBytesCurrent, storyboardReplayVideoResponse } = storyboardRecoveryApplication;

  const storyboardFirstFrameApplication = createStudioStoryboardFirstFrameRoutes(ports);


  const storyboardFrameReviewApplication = createStudioStoryboardFrameReviewRoutes(ports);


  const storyboardActionApplication = createStudioStoryboardActionRoutes(ports);


  const storyboardVideoApplication = createStudioStoryboardVideoRoutes(ports);


  const storyboardQualityApplication = createStudioStoryboardQualityRoutes(ports);


  const geminiVideoApplication = createStudioGeminiVideoRoutes(ports);


  const scriptApplication = createStudioScriptRoutes(ports);


  const coverTitlesApplication = createStudioCoverTitleRoutes(ports);


  const posterPlanningApplication = createStudioPosterPlanningRoutes(ports);


  const leadPackageApplication = createStudioLeadPackageRoutes(ports);


  const posterRenderApplication = createStudioPosterRenderRoutes(ports);


  const captionApplication = createStudioCaptionRoutes(ports);


  const editorialApplication = createStudioEditorialRoutes(ports);


  const renderManifestApplication = createRenderManifestApplication(ports);
  const { buildManifest } = renderManifestApplication;

  const renderAdmissionApplication = createStudioRenderAdmissionRoutes(ports);


  const localRenderApplication = createStudioLocalRenderRoutes(ports);


  const persistentRenderApplication = createStudioPersistentRenderRoutes(ports);


  const videoVersionsApplication = createStudioVideoVersionRoutes(ports);
  const { appendVideoVersion } = videoVersionsApplication;

  const digitalHumanApplication = createDigitalHumanRuntime(ports);
  const { loadDigitalHumanJobs, persistDigitalHumanJobs, updateDigitalHumanJob, digitalHumanConfig, digitalHumanProviderHeaders, digitalHumanFetch, publicDigitalHumanJob, refreshDigitalHumanJob, validDigitalHumanVoiceoverUrl, heygenOutputPath, ensureHeygenAutomationJob, digitalHumanCapabilities } = digitalHumanApplication;

  const transformationApplication = createStudioTransformationRoutes(ports);


  const digitalHumanRoutesApplication = createStudioDigitalHumanJobRoutes(ports);


  const materialReadApplication = createStudioMaterialReadRoutes(ports);


  const materialUploadApplication = createMaterialUploadApplication(ports);
  const { materialUploadFileName, saveMaterialUploadToDatabase } = materialUploadApplication;

  const materialUploadRoutesApplication = createStudioMaterialUploadRoutes(ports);


  const materialMetadataRoutesApplication = createStudioMaterialMutationRoutes(ports);


  const materialAnalysisApplication = createStudioMaterialAnalysisRoutes(ports);
  const { analyzeMaterialVideo } = materialAnalysisApplication;

  const coverRenderingApplication = createStudioCoverRenderingRoutes(ports);


  const privateAssetsApplication = createStudioPrivateAssetRoutes(ports);
  const { privateStudioAssetUrl, persistPrivateStudioAsset } = privateAssetsApplication;

  const ttsRoutesApplication = createStudioTtsRoutes(ports);


  const audioAlignmentApplication = createAudioAlignmentApplication(ports);
  const { alignTtsAudio, alignStudioVoiceForAutomation } = audioAlignmentApplication;

  const voiceSamplesApplication = createStudioVoiceSampleRoutes(ports);


  const projectEvidenceApplication = createProjectEvidenceApplication(ports);
  const { unpublishableGenerationReasons, automationStoryboardAssignmentIssues, studioAigcBudgetContext, storyboardKbAssignmentIssuesForSpec, storyboardKbFrameVersionIssues, storyboardKbProductViewReferences, storyboardPersonFrameVersionIssues, storyboardEnvironmentFrameVersionIssues, appendCompletedPosterMaterialUsage } = projectEvidenceApplication;

  const projectRoutesApplication = createStudioProjectWorkspaceRoutes(ports);


  const posterReferencesApplication = createPosterReferenceAssets(ports);
  const { resolveReferenceImages } = posterReferencesApplication;

  const ttsProviders = createStudioTtsProviderRuntime({
    voiceSamplesRoot: VOICE_SAMPLES_ROOT,
    ttsRoot: TTS_ROOT,
    scopedStudioAssetDir,
    scopedStudioAssetUrl,
    runFfmpeg,
  });

  const {
    readVoiceSampleIndex, writeVoiceSampleIndex, voiceSamplePathFromId, spokenText,
    minimaxEndpoint, minimaxFetchJson, minimaxVoiceCacheKey, readMinimaxVoiceCache,
    writeMinimaxVoiceCache, clearMinimaxVoiceCache, updateMinimaxVoiceCache,
    minimaxVoiceNeedsReclone, qwenTtsLanguageType, friendlyTtsProviderError,
    rememberRejectedMinimaxCredential, minimaxCredentialUsable,
    generateMinimaxTts, ensureMinimaxClonedVoice, generateQwenTts,
  } = ttsProviders;

  const localTtsPorts: LocalTtsPorts = {
    ttsDir: () => scopedStudioAssetDir(TTS_ROOT),
    ttsUrl: file => scopedStudioAssetUrl('tts', file),
    voiceSamplePath: voiceSamplePathFromId,
    runFfmpeg,
  };

  const ttsGeneration = createStudioTtsGeneration({
    currentTenantId: () => studioTenantContext.getStore(),
    tenantTtsDir: tenantId => tenantAssetDir(TTS_ROOT, tenantId),
    scopedTtsDir: () => scopedStudioAssetDir(TTS_ROOT),
    ttsUrl: file => scopedStudioAssetUrl('tts', file),
    localTtsPorts,
    providers: ttsProviders,
  });

  const { proportionalCues, localTtsFile, studioAudioCapabilities } = ttsGeneration;

  const {
    resolveStudioVoiceExecutionPlan, synthesizeStudioVoiceForAutomation,
  } = createStudioVoiceAutomation({
    runTenant: (tenantId, run) => studioTenantContext.run(tenantId, run),
    tenantTtsDir: tenantId => tenantAssetDir(TTS_ROOT, tenantId),
    ttsUrl: file => scopedStudioAssetUrl('tts', file),
    persistPrivateTtsAsset: (tenantId, filePath) => persistPrivateStudioAsset('tts', tenantId, filePath),
    execFileAsync,
    ffmpegBin: ffmpegStatic || 'ffmpeg',
    providers: ttsProviders,
    generation: ttsGeneration,
  });

  return { heygenOutputPath, ensureHeygenAutomationJob, analyzeMaterialVideo, alignStudioVoiceForAutomation, unpublishableGenerationReasons, automationStoryboardAssignmentIssues, studioAigcBudgetContext, studioTenantContext, resolveStudioVoiceExecutionPlan, synthesizeStudioVoiceForAutomation, workspaceAdmissionApplication, freeCreationHookApplication, storyboardFirstFrameApplication, storyboardFrameReviewApplication, storyboardActionApplication, storyboardVideoApplication, storyboardQualityApplication, geminiVideoApplication, scriptApplication, coverTitlesApplication, posterPlanningApplication, leadPackageApplication, posterRenderApplication, captionApplication, editorialApplication, renderAdmissionApplication, localRenderApplication, persistentRenderApplication, videoVersionsApplication, digitalHumanApplication, transformationApplication, digitalHumanRoutesApplication, materialReadApplication, materialUploadRoutesApplication, materialMetadataRoutesApplication, materialAnalysisApplication, coverRenderingApplication, privateAssetsApplication, ttsRoutesApplication, voiceSamplesApplication, projectRoutesApplication };
}
