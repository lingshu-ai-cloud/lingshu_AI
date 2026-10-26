import { kickoffClipSnapshot } from './studioSourceMaterial';
import { reconcileStudioProductionSpec } from '../../../shared/studioProductionContract';
import { resolveStudioSocialShot } from '../../lib/studioSocialShotIdentity';
import { normalizeExplicitPresenterMode } from './studioManagedPresenter.js';
import { stableScriptVersion } from './studioScriptSanitization.js';
import type { StoryboardSourcePlan } from './studioWorkspaceContracts.js';
import type { StudioProjectLifecyclePorts } from './studioProjectLifecyclePorts.js';

export function createStudioProjectSnapshot(ports: Pick<StudioProjectLifecyclePorts,
  | 'mode'
  | 'storyboardSourcePlans'
  | 'storyboardSlots'
  | 'sourcePlanFor'
  | 'freeShotTypeFor'
  | 'storyboardAssemblies'
  | 'activeAssemblyId'
  | 'assemblyName'
  | 'storyboardAssignments'
  | 'selected'
  | 'hookMaterialId'
  | 'cover'
  | 'scriptRecommendedMaterialIds'
  | 'shotProductions'
  | 'videoKickoff'
  | 'materials'
  | 'productionKey'
  | 'productionFor'
  | 'socialDigitalHumanPlans'
  | 'newProductionFor'
  | 'script'
  | 'voiceoverLines'
  | 'voiceDrafts'
  | 'voiceoverAudios'
  | 'alignedCuesByLang'
  | 'shootingSlots'
  | 'localFlowTestRef'
  | 'contentMode'
  | 'posterStyle'
  | 'imageDeliverable'
  | 'platform'
  | 'ratio'
  | 'duration'
  | 'lang'
  | 'provider'
  | 'projectWorkflowContext'
  | 'replicationSpeechDraft'
  | 'replicationSpeechSpeed'
  | 'step'
  | 'activeStoryboardSlotId'
  | 'canvasView'
  | 'scriptStageTab'
  | 'studioCreateRequest'
  | 'socialContentTaskId'
  | 'productInfo'
  | 'productSelectMode'
  | 'selectedProductIds'
  | 'getProductMaterialSelection'
  | 'referenceProductAssignments'
  | 'referenceProductTerms'
  | 'referenceBrandSourceTerm'
  | 'referenceBrandLabel'
  | 'audience'
  | 'primaryCta'
  | 'productContentGoal'
  | 'reachCta'
  | 'cooperationRoute'
  | 'sellingPoints'
  | 'tone'
  | 'videoThemeId'
  | 'themePainPoint'
  | 'themeConversionGoal'
  | 'lastGeneratedSetupSignature'
  | 'presenterMode'
  | 'presentationMode'
  | 'presentationSources'
  | 'scriptType'
  | 'reviewedRenderPath'
  | 'projectQualityRecord'
  | 'rendered'
  | 'modeScripts'
  | 'activeModeScriptId'
  | 'voice'
  | 'voiceCandidates'
  | 'bgm'
  | 'bgmCandidates'
  | 'platformBgms'
  | 'assemblyBgms'
  | 'materialVersionBgms'
  | 'soundCandidatesPerContent'
  | 'bgmVol'
  | 'voiceVol'
  | 'effectPreset'
  | 'effectIntensity'
  | 'effectSoundsOn'
  | 'disabledEffectSceneIds'
  | 'coverTitle'
  | 'coverStyle'
  | 'capturedCoverFrameUrl'
  | 'materialVersionCovers'
  | 'account'
  | 'caption'
  | 'subtitlesOn'
  | 'subMode'
  | 'subtitleStyle'
  | 'clipEdits'
  | 'voiceoverMode'
  | 'uploadedVoiceName'
  | 'customVoiceId'
  | 'customVoiceName'
  | 'customVoiceUrl'
  | 'ttsPreset'
  | 'ttsEmotion'
  | 'ttsEmotionIntensity'
  | 'ttsSpeed'
  | 'ttsPauseStyle'
  | 'ttsPronunciationText'
  | 'ttsLanguageSettings'
  | 'voiceLangs'
  | 'activeVoiceLang'
  | 'voiceDraftStaleLangs'
  | 'voiceoverStaleLangs'
  | 'voiceoverUrl'
  | 'voiceoverDur'
  | 'languageRenderOutputs'
  | 'languageRenderVersions'
  | 'referenceVoiceStrength'
  | 'useReferenceVoiceStyle'
  | 'sourceCaptionTextEdits'
  | 'storyboardVideoVersions'
  | 'productVideoVersions'
  | 'variationStrategy'
  | 'variationPeople'
  | 'variationScenes'
  | 'variationLanguages'
  | 'variationHooks'
  | 'variationMax'
  | 'shotProductionContext'
  | 'socialSourceShotIds'
  | 'socialShotMaterialBindings'
  | 'posterDraft'
  | 'leadContentPackage'
  | 'posterJsonText'
  | 'posterImageUrl'
  | 'posterImageMaterialId'
  | 'posterImageReviewStatus'
  | 'frozenStudioSpecRef'
>) {
  const {
    mode, storyboardSourcePlans, storyboardSlots,
    sourcePlanFor, freeShotTypeFor, storyboardAssemblies,
    activeAssemblyId, assemblyName, storyboardAssignments,
    selected, hookMaterialId, cover,
    scriptRecommendedMaterialIds, shotProductions, videoKickoff,
    materials,
  } = ports;

  const persistedStoryboardSourcePlans: Record<string, StoryboardSourcePlan> = mode === 'clone' ? storyboardSourcePlans : Object.fromEntries(storyboardSlots.map(slot => {
    const existing = storyboardSourcePlans[slot.id] || sourcePlanFor(slot);
    const shotType = freeShotTypeFor(slot);
    const sceneType: NonNullable<StoryboardSourcePlan['sceneType']> = shotType === 'factory' ? 'factory' : shotType === 'product' ? 'product' : shotType === 'consumer_demo' ? 'usage' : 'general';
    return [slot.id, { ...existing, shotType, shotTopic: shotType, sceneType } satisfies StoryboardSourcePlan];
  })) as Record<string, StoryboardSourcePlan>;

  const assembliesForSave = storyboardAssemblies.map(item => item.id === activeAssemblyId
    ? { ...item, name: assemblyName, assignments: storyboardAssignments, sourcePlans: persistedStoryboardSourcePlans, selected }
    : item);

  const materialSnapshotIds = new Set<string>([
    hookMaterialId,
    cover,
    ...selected,
    ...scriptRecommendedMaterialIds,
    ...Object.values(storyboardAssignments),
    ...Object.values(shotProductions).flatMap(production =>
      (production.candidates || []).map(candidate => candidate.materialId)),
    ...assembliesForSave.flatMap(item => [
      ...(item.selected || []),
      ...Object.values(item.assignments || {}),
      ...Object.values(item.sourcePlans || {}).flatMap(plan => [plan.referenceClipId, plan.generatedClipId]),
    ]),
  ].filter((id): id is string => Boolean(id)));

  const kickoffSnapshot = kickoffClipSnapshot(videoKickoff);

  if (kickoffSnapshot) materialSnapshotIds.add(kickoffSnapshot.id);

  const materialSnapshots = [
    ...materials.filter(item => materialSnapshotIds.has(item.id)),
    ...(kickoffSnapshot && !materials.some(item => item.id === kickoffSnapshot.id) ? [kickoffSnapshot] : []),
  ].map(item => ({
    id: item.id,
    name: item.name,
    folder: item.folder,
    type: item.type,
    duration: item.duration,
    width: item.width,
    height: item.height,
    aspectRatio: item.aspectRatio,
    size: item.size,
    url: item.url,
    poster: item.poster,
    scope: item.scope,
    usage: item.usage,
    sourceType: item.sourceType || 'project-snapshot',
    contentSha256: item.contentSha256,
    industry: item.industry,
    shotFunction: item.shotFunction,
    applicability: item.applicability,
    tags: item.tags,
    productId: item.productId,
    productName: item.productName,
    materialV2: item.materialV2,
    capabilityManifest: item.capabilityManifest,
    segmentAnalysisStatus: item.segmentAnalysisStatus,
    segments: item.segments,
    transcript: item.transcript,
    transcriptCues: item.transcriptCues,
    transcriptCuesProvenance: item.transcriptCuesProvenance,
    transcriptSourceHash: item.transcriptSourceHash,
  }));

  const collectSpec = () => {
    const {
      productionKey, productionFor, socialDigitalHumanPlans,
      newProductionFor, script, voiceoverLines,
      voiceDrafts, voiceoverAudios, alignedCuesByLang,
      shootingSlots, localFlowTestRef, contentMode,
      posterStyle, imageDeliverable, platform,
      ratio, duration, lang,
      provider, projectWorkflowContext, replicationSpeechDraft,
      replicationSpeechSpeed, step, activeStoryboardSlotId,
      canvasView, scriptStageTab, studioCreateRequest,
      socialContentTaskId, productInfo, productSelectMode,
      selectedProductIds, referenceProductAssignments, referenceProductTerms,
      referenceBrandSourceTerm, referenceBrandLabel, audience,
      primaryCta, productContentGoal, reachCta,
      cooperationRoute, sellingPoints, tone,
      videoThemeId, themePainPoint, themeConversionGoal,
      lastGeneratedSetupSignature, presenterMode, presentationMode,
      presentationSources, scriptType, reviewedRenderPath,
      projectQualityRecord, rendered, modeScripts,
      activeModeScriptId, voice, voiceCandidates,
      bgm, bgmCandidates, platformBgms,
      assemblyBgms, materialVersionBgms, soundCandidatesPerContent,
      bgmVol, voiceVol, effectPreset,
      effectIntensity, effectSoundsOn, disabledEffectSceneIds,
      coverTitle, coverStyle, capturedCoverFrameUrl,
      materialVersionCovers, account, caption,
      subtitlesOn, subMode, subtitleStyle,
      clipEdits, voiceoverMode, uploadedVoiceName,
      customVoiceId, customVoiceName, customVoiceUrl,
      ttsPreset, ttsEmotion, ttsEmotionIntensity,
      ttsSpeed, ttsPauseStyle, ttsPronunciationText,
      ttsLanguageSettings, voiceLangs, activeVoiceLang,
      voiceDraftStaleLangs, voiceoverStaleLangs, voiceoverUrl,
      voiceoverDur, languageRenderOutputs, languageRenderVersions,
      referenceVoiceStrength, useReferenceVoiceStyle, sourceCaptionTextEdits,
      storyboardVideoVersions, productVideoVersions, variationStrategy,
      variationPeople, variationScenes, variationLanguages,
      variationHooks, variationMax, shotProductionContext,
      socialSourceShotIds, socialShotMaterialBindings, posterDraft,
      leadContentPackage, posterJsonText, posterImageUrl,
      posterImageMaterialId, posterImageReviewStatus, frozenStudioSpecRef,
    } = ports;

    let savedShotProductions = Object.fromEntries(Object.entries(shotProductions)
      .map(([key, shot]) => [key, normalizeExplicitPresenterMode(shot)]));
    for (const slot of storyboardSlots) {
      savedShotProductions[productionKey(slot.id)] = productionFor(slot);
    }
    for (const plan of socialDigitalHumanPlans) {
      const slot = resolveStudioSocialShot(storyboardSlots, plan);
      if (!slot) continue;
      const key = productionKey(slot.id);
      if (!savedShotProductions[key]) savedShotProductions = { ...savedShotProductions, [key]: newProductionFor(slot) };
    }
    const analysisResults = {
      schemaVersion: 'studio-analysis.v1',
      reference: videoKickoff?.referenceAnalysis ?? null,
      hook: {
        visual: storyboardSlots[0]?.detail || videoKickoff?.generatedVideo?.title || '',
        dialogue: storyboardSlots[0] ? savedShotProductions[productionKey(storyboardSlots[0].id)]?.narration || '' : '',
        shotId: storyboardSlots[0]?.id || '',
      },
      storyboard: {
        slots: storyboardSlots,
        script,
        assignments: storyboardAssignments,
        sourcePlans: persistedStoryboardSourcePlans,
        assemblies: assembliesForSave,
      },
      voiceover: {
        text: voiceoverLines,
        drafts: voiceDrafts,
        audios: voiceoverAudios,
        alignedCuesByLang,
      },
      shots: {
        shootingSlots,
        productions: savedShotProductions,
      },
    };
    const productMaterialSelection = ports.getProductMaterialSelection();
    const currentSpec = ({
      ...(productMaterialSelection ? { productMaterialSelection } : {}),
      ...(localFlowTestRef.current ? { localFlowTest: localFlowTestRef.current } : {}),
      mode, contentMode, posterStyle, imageDeliverable, platform, ratio, duration, lang, provider,
      workflowRunId: projectWorkflowContext?.runId || '', workflowTaskId: projectWorkflowContext?.taskId || '', workflowTaskKey: projectWorkflowContext?.taskKey || '',
      replicationSpeechDraft, replicationSpeechSpeed, activeStepId: step, activeStoryboardSlotId, canvasView, scriptStageTab,
      videoKickoff, creationPath: mode === 'clone' && contentMode === 'video' ? 'viral_replication' : 'free_creation',
      studioCreateRequest,
      ...(socialContentTaskId ? { socialContentTaskId } : {}),
      productInfo, productSelectMode, selectedProductIds, referenceProductAssignments, referenceProductTerms, referenceBrandSourceTerm, referenceBrandLabel, audience, primaryCta, productContentGoal, reachCta, cooperationRoute, sellingPoints, tone,
      videoThemeId, themePainPoint, themeConversionGoal, lastGeneratedSetupSignature, presenterMode, presentationMode, presentationSources,
      selected, scriptRecommendedMaterialIds, storyboardAssignments, storyboardSourcePlans: persistedStoryboardSourcePlans, assemblyName, hookMaterialId, materialSnapshots,
      storyboardAssemblies: assembliesForSave, activeAssemblyId, script, scriptType,
      // Acceptance belongs to the exact rendered file. Persist it with the
      // project so "我的创作 / 历史素材" survives refreshes and other devices.
      renderAcceptance: reviewedRenderPath ? {
        accepted: true,
        renderPath: reviewedRenderPath,
        creationMode: mode === 'clone' ? 'viral_replication' : 'free_creation',
      } : null,
      projectQualityRecords: projectQualityRecord ? [projectQualityRecord] : [],
      activeProjectQualityRecordId: projectQualityRecord?.id || '',
      scriptVersion: stableScriptVersion(script), derivedFromScriptVersion: stableScriptVersion(script),
      staleReason: rendered ? '' : '脚本或分镜已变化，需要重新渲染', manualWorkflow: mode !== 'clone',
      voiceoverLines, modeScripts, activeModeScriptId, voice, voiceCandidates,
      bgm, bgmCandidates, platformBgms, assemblyBgms, materialVersionBgms, soundCandidatesPerContent, bgmVol, voiceVol, effectPreset, effectIntensity, effectSoundsOn, disabledEffectSceneIds, cover, coverTitle, coverStyle, capturedCoverFrameUrl, materialVersionCovers, account, caption,
      subtitlesOn, subMode, subtitleStyle, clipEdits, voiceoverMode, uploadedVoiceName, customVoiceId, customVoiceName, customVoiceUrl,
      ttsPreset, ttsEmotion, ttsEmotionIntensity, ttsSpeed, ttsPauseStyle, ttsPronunciationText, ttsLanguageSettings, voiceLangs, activeVoiceLang, voiceDrafts, voiceDraftStaleLangs, voiceoverStaleLangs,
      voiceoverUrl, voiceoverDur, voiceoverAudios, languageRenderOutputs, languageRenderVersions, referenceVoiceStrength, useReferenceVoiceStyle, alignedCuesByLang, sourceCaptionTextEdits,
      storyboardVideoVersions, productVideoVersions,
      variationStrategy, variationPeople, variationScenes, variationLanguages, variationHooks, variationMax,
      shootingSlots, shotProductions: savedShotProductions, shotProductionContext, socialDigitalHumanPlans,
      socialSourceShotIds, socialShotMaterialBindings,
      analysisResults,
      posterDraft, leadContentPackage, posterJsonText, posterImageUrl, posterImageMaterialId, posterImageReviewStatus,
    });
    return reconcileStudioProductionSpec(frozenStudioSpecRef.current
      ? { ...currentSpec, ...structuredClone(frozenStudioSpecRef.current) }
      : currentSpec);
  };

  return { collectSpec };
}
