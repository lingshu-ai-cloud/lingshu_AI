import { restoreStudioProductIds } from './studioProductSelection.js';
import { frozenStudioProject, restoreStudioSpec } from '../../lib/frozenStudioProject';
import { studioWorkflowContextFromSpec, withoutStudioWorkflowContext } from '../../lib/studioProjectContext';
import { type VideoCreationPlan } from '../../lib/videoCreationPlan';
import { type StudioProject, type CoverStyle, type SubCue, type TtsStyleOptions, type FbPosterResult, type LeadContentPackageResult, type VideoGenerationVersion } from '../../lib/studioApi';
import type { SocialContentCreateRequest } from '../socialContent/SocialContentWorkspace';
import { type StudioSocialShotMaterialBinding, type StudioSocialTaskSeed } from '../socialContent/useStudioSocialTaskHydration';
import { type ShootingSlot } from '../../lib/shootingWorkflow';
import { normalizeMaterialAudio, type ShotProduction } from '../../lib/shotProduction';
import { formatVoiceoverWithTimestamps } from './studioVoiceoverRules';
import type { VideoKickoff } from './studioVideoKickoff';
import { normalizeClipSnapshot, kickoffClipSnapshot, type Clip } from './studioSourceMaterial';
import { detectScriptLanguageCode } from './studioLanguageRules';
import { studioAutosaveFingerprint } from '../../lib/studioAutosave';
import { type ImageDeliverable } from '../../../shared/imageCreativePlanning';
import { normalizeExplicitPresenterMode } from './studioManagedPresenter.js';
import { loadedStudioProjectTitle, loadedStudioContinuationStep } from './studioProjectNavigation.js';
import { STEPS, DEFAULT_VIDEO_CONVERSION_GOAL, VIDEO_THEMES, POSTER_STEPS, TTS_PRESETS, IMAGE_DELIVERABLE_OPTIONS, POSTER_STYLES } from './studioWorkspaceCatalog.js';
import { mergeClipLists } from './studioMaterialPresentation.js';
import { parseStoryboardSlots, studioSpecHasCompiledStoryboard } from './studioStoryboardParsing.js';
import type { StepId, VideoThemeId, CoverVersionConfig, ClipEdit, StoryboardSourcePlan, StoryboardAssembly, ProjectQualityRecord, LanguageTtsSettings, ModeScriptOutput } from './studioWorkspaceContracts.js';
import type { StudioProjectLifecyclePorts } from './studioProjectLifecyclePorts.js';

export function createStudioProjectRestoration(ports: Pick<StudioProjectLifecyclePorts,
  | 'localFlowTestRef'
  | 'localFlowRecoveryRef'
  | 'appliedCreateRequestRef'
  | 'setRestoredSocialTaskId'
  | 'setRestoredCreateRequest'
  | 'cloneProductFingerprintRef'
  | 'studioSettingsEditedRef'
  | 'managedProductionProjectRef'
  | 'setProjectWorkflowContext'
  | 'workflowContext'
  | 'studioSpecEpochRef'
  | 'scriptTaskRequestRef'
  | 'productScriptAbortRef'
  | 'voiceDraftAbortRef'
  | 'ttsRequestRef'
  | 'setVoiceDraftPendingLangs'
  | 'setVoiceDraftFailedLangs'
  | 'setTtsActiveLangs'
  | 'setTtsFailuresByLang'
  | 'setModeActionLoading'
  | 'setModeActionStatus'
  | 'setScriptLoading'
  | 'setMaterialSelectLoading'
  | 'setPendingRealCloneGeneration'
  | 'setStoryboardGenerating'
  | 'setStoryboardQualityChecking'
  | 'shootingSlotsRef'
  | 'setShootingIdentityEpoch'
  | 'setShotProductions'
  | 'setSocialDigitalHumanPlans'
  | 'setSocialSourceShotIds'
  | 'rememberSocialShotMaterialBindings'
  | 'setVoiceoverStaleLangs'
  | 'voiceoverAudios'
  | 'setSourceCaptionTextEdits'
  | 'enterpriseVoiceLangs'
  | 'setVoiceLangs'
  | 'setActiveVoiceLang'
  | 'setLang'
  | 'setVoiceDrafts'
  | 'setVoiceoverAudios'
  | 'setAlignedCuesByLang'
  | 'setVoiceoverUrl'
  | 'setVoiceoverDur'
  | 'setVoiceDraftNotice'
  | 'setTtsNotice'
  | 'setVoiceDraftLoading'
  | 'setTtsLoading'
  | 'setTtsLoadingScope'
  | 'setMaterials'
  | 'setMode'
  | 'setVideoKickoff'
  | 'setContentMode'
  | 'setStepIdx'
  | 'setActiveStoryboardSlotId'
  | 'setCanvasView'
  | 'setScriptStageTab'
  | 'setLastGeneratedSetupSignature'
  | 'setPosterStyle'
  | 'posterStyle'
  | 'setImageDeliverable'
  | 'setPlatform'
  | 'setRatio'
  | 'setDuration'
  | 'setProvider'
  | 'setProductInfo'
  | 'setProductSelectMode'
  | 'setSelectedProductIds'
  | 'productOptions'
  | 'setReferenceProductAssignments'
  | 'setReferenceProductTerms'
  | 'setReplicationSpeechSpeed'
  | 'setReplicationSpeechDraft'
  | 'setReferenceBrandSourceTerm'
  | 'setAudience'
  | 'setPrimaryCta'
  | 'frozenStudioSpecRef'
  | 'setEnterprisePrimaryCta'
  | 'setProductContentGoal'
  | 'setReachCta'
  | 'setCooperationRoute'
  | 'setSellingPoints'
  | 'setTone'
  | 'setVideoThemeId'
  | 'setPresenterMode'
  | 'setPresentationMode'
  | 'setPresentationSources'
  | 'setThemePainPoint'
  | 'setThemeConversionGoal'
  | 'setVariationStrategy'
  | 'setHookMaterialId'
  | 'setSelected'
  | 'setScriptRecommendedMaterialIds'
  | 'setStoryboardAssignments'
  | 'setStoryboardSourcePlans'
  | 'setAssemblyName'
  | 'setStoryboardAssemblies'
  | 'setActiveAssemblyId'
  | 'masterScriptSnapshot'
  | 'setScript'
  | 'setVoiceoverLines'
  | 'setScriptType'
  | 'scriptType'
  | 'setModeScripts'
  | 'setActiveModeScriptId'
  | 'setVoice'
  | 'setVoiceCandidates'
  | 'setVoiceoverMode'
  | 'setUploadedVoiceName'
  | 'setCustomVoiceId'
  | 'setCustomVoiceName'
  | 'setCustomVoiceUrl'
  | 'setTtsLanguageSettings'
  | 'setVoiceDraftStaleLangs'
  | 'setLanguageRenderOutputs'
  | 'languageRenderOutputs'
  | 'setReviewedRenderPath'
  | 'setProjectQualityRecord'
  | 'setLanguageRenderVersions'
  | 'languageRenderVersions'
  | 'setStoryboardVideoVersions'
  | 'storyboardVideoVersions'
  | 'setProductVideoVersions'
  | 'setTtsPreset'
  | 'setTtsEmotion'
  | 'setTtsEmotionIntensity'
  | 'setTtsSpeed'
  | 'setTtsPauseStyle'
  | 'setTtsPronunciationText'
  | 'setReferenceVoiceStrength'
  | 'setUseReferenceVoiceStyle'
  | 'setBgm'
  | 'setBgmCandidates'
  | 'setPlatformBgms'
  | 'setAssemblyBgms'
  | 'setMaterialVersionBgms'
  | 'setSoundCandidatesPerContent'
  | 'setBgmVol'
  | 'setVoiceVol'
  | 'setEffectSoundsOn'
  | 'setEffectPreset'
  | 'setEffectIntensity'
  | 'setDisabledEffectSceneIds'
  | 'setCover'
  | 'setCoverTitle'
  | 'setCoverStyle'
  | 'setCapturedCoverFrameUrl'
  | 'setMaterialVersionCovers'
  | 'setAccount'
  | 'setCaption'
  | 'setPosterDraft'
  | 'setLeadContentPackage'
  | 'setPosterJsonText'
  | 'setPosterImageUrl'
  | 'setPosterImageMaterialId'
  | 'setPosterImageReviewStatus'
  | 'setSubtitlesOn'
  | 'setSubMode'
  | 'setSubtitleStyle'
  | 'setClipEdits'
  | 'setVariationPeople'
  | 'setVariationScenes'
  | 'setVariationLanguages'
  | 'setVariationHooks'
  | 'setVariationMax'
  | 'setModeNotice'
  | 'setBoundProductionSnapshot'
  | 'adoptEditorProjectRevision'
  | 'projectSaveConflictRef'
  | 'notification'
  | 'projectHydrationPendingRef'
  | 'incomingCreateRequest'
  | 'lastSavedAutosaveFingerprintRef'
  | 'setProjectId'
  | 'setProjectTitle'
  | 'setWorkflowProjectSelectionPending'
  | 'autoGen'
  | 'setShowProjects'
  | 'setPublished'
>) {

  const applySpec = (savedSpec: Record<string, unknown>) => {
    const {
      localFlowTestRef, localFlowRecoveryRef, appliedCreateRequestRef,
      setRestoredSocialTaskId, setRestoredCreateRequest, cloneProductFingerprintRef,
      studioSettingsEditedRef, managedProductionProjectRef, setProjectWorkflowContext,
      workflowContext, studioSpecEpochRef, scriptTaskRequestRef,
      productScriptAbortRef, voiceDraftAbortRef, ttsRequestRef,
      setVoiceDraftPendingLangs, setVoiceDraftFailedLangs, setTtsActiveLangs,
      setTtsFailuresByLang, setModeActionLoading, setModeActionStatus,
      setScriptLoading, setMaterialSelectLoading, setPendingRealCloneGeneration,
      setStoryboardGenerating, setStoryboardQualityChecking, shootingSlotsRef,
      setShootingIdentityEpoch, setShotProductions, setSocialDigitalHumanPlans,
      setSocialSourceShotIds, rememberSocialShotMaterialBindings, setVoiceoverStaleLangs,
      voiceoverAudios, setSourceCaptionTextEdits, enterpriseVoiceLangs,
      setVoiceLangs, setActiveVoiceLang, setLang,
      setVoiceDrafts, setVoiceoverAudios, setAlignedCuesByLang,
      setVoiceoverUrl, setVoiceoverDur, setVoiceDraftNotice,
      setTtsNotice, setVoiceDraftLoading, setTtsLoading,
      setTtsLoadingScope, setMaterials, setMode,
      setVideoKickoff, setContentMode, setStepIdx,
      setActiveStoryboardSlotId, setCanvasView, setScriptStageTab,
      setLastGeneratedSetupSignature, setPosterStyle, posterStyle,
      setImageDeliverable, setPlatform, setRatio,
      setDuration, setProvider, setProductInfo,
      setProductSelectMode, setSelectedProductIds, setReferenceProductAssignments,
      setReferenceProductTerms, setReplicationSpeechSpeed, setReplicationSpeechDraft,
      setReferenceBrandSourceTerm, setAudience, setPrimaryCta,
      frozenStudioSpecRef, setEnterprisePrimaryCta, setProductContentGoal,
      setReachCta, setCooperationRoute, setSellingPoints,
      setTone, setVideoThemeId, setPresenterMode,
      setPresentationMode, setPresentationSources, setThemePainPoint,
      setThemeConversionGoal, setVariationStrategy, setHookMaterialId,
      setSelected, setScriptRecommendedMaterialIds, setStoryboardAssignments,
      setStoryboardSourcePlans, setAssemblyName, setStoryboardAssemblies,
      setActiveAssemblyId, masterScriptSnapshot, setScript,
      setVoiceoverLines, setScriptType, scriptType,
      setModeScripts, setActiveModeScriptId, setVoice,
      setVoiceCandidates, setVoiceoverMode, setUploadedVoiceName,
      setCustomVoiceId, setCustomVoiceName, setCustomVoiceUrl,
      setTtsLanguageSettings, setVoiceDraftStaleLangs, setLanguageRenderOutputs,
      languageRenderOutputs, setReviewedRenderPath, setProjectQualityRecord,
      setLanguageRenderVersions, languageRenderVersions, setStoryboardVideoVersions,
      storyboardVideoVersions, setProductVideoVersions, setTtsPreset,
      setTtsEmotion, setTtsEmotionIntensity, setTtsSpeed,
      setTtsPauseStyle, setTtsPronunciationText, setReferenceVoiceStrength,
      setUseReferenceVoiceStyle, setBgm, setBgmCandidates,
      setPlatformBgms, setAssemblyBgms, setMaterialVersionBgms,
      setSoundCandidatesPerContent, setBgmVol, setVoiceVol,
      setEffectSoundsOn, setEffectPreset, setEffectIntensity,
      setDisabledEffectSceneIds, setCover, setCoverTitle,
      setCoverStyle, setCapturedCoverFrameUrl, setMaterialVersionCovers,
      setAccount, setCaption, setPosterDraft,
      setLeadContentPackage, setPosterJsonText, setPosterImageUrl,
      setPosterImageMaterialId, setPosterImageReviewStatus, setSubtitlesOn,
      setSubMode, setSubtitleStyle, setClipEdits,
      setVariationPeople, setVariationScenes, setVariationLanguages,
      setVariationHooks, setVariationMax,
    } = ports;

    localFlowTestRef.current = (savedSpec as any).localFlowTest?.enabled === true ? (savedSpec as any).localFlowTest : null;
    if (!localFlowTestRef.current) localFlowRecoveryRef.current = null;
    const s = restoreStudioSpec(savedSpec);
    appliedCreateRequestRef.current = s.studioCreateRequest && typeof s.studioCreateRequest === 'object' ? (s.studioCreateRequest as SocialContentCreateRequest).requestId : null;
    setRestoredSocialTaskId(typeof s.socialContentTaskId === 'string' ? s.socialContentTaskId : null);
    setRestoredCreateRequest(s.studioCreateRequest && typeof s.studioCreateRequest === 'object' ? s.studioCreateRequest as SocialContentCreateRequest : null);
    // Seed the identity before restoring state so loading a draft cannot erase it.
    const restoredProductIds = restoreStudioProductIds(
      Array.isArray(s.selectedProductIds) ? s.selectedProductIds as string[] : [], ports.productOptions,
    );
    cloneProductFingerprintRef.current = restoredProductIds.length
      ? `products:${restoredProductIds.join('|')}`
      : `manual:${String(s.productInfo || '')}`;
    studioSettingsEditedRef.current = true;
    managedProductionProjectRef.current = Boolean(s.workflowRunId && (s.automation as { managedBy?: string } | undefined)?.managedBy === 'digital_employee');
    setProjectWorkflowContext(
      workflowContext?.taskKey === 'content_quality_gate'
        ? workflowContext
        : studioWorkflowContextFromSpec(s),
    );
    studioSpecEpochRef.current += 1;
    scriptTaskRequestRef.current += 1;
    productScriptAbortRef.current?.abort();
    productScriptAbortRef.current = null;
    voiceDraftAbortRef.current?.abort();
    voiceDraftAbortRef.current = null;
    ttsRequestRef.current += 1;
    setVoiceDraftPendingLangs([]);
    setVoiceDraftFailedLangs([]);
    setTtsActiveLangs([]);
    setTtsFailuresByLang({});
    setModeActionLoading(false);
    setModeActionStatus('');
    setScriptLoading(false);
    setMaterialSelectLoading(false);
    setPendingRealCloneGeneration(false);
    setStoryboardGenerating({});
    setStoryboardQualityChecking({});
    shootingSlotsRef.current = Array.isArray(s.shootingSlots) ? s.shootingSlots as ShootingSlot[] : [];
    setShootingIdentityEpoch(current => current + 1);
    setShotProductions(s.shotProductions && typeof s.shotProductions === 'object' ? Object.fromEntries(Object.entries(s.shotProductions as Record<string, ShotProduction>)
      .map(([key, shot]) => [key, normalizeExplicitPresenterMode(normalizeMaterialAudio(shot))])) : {});
    setSocialDigitalHumanPlans(Array.isArray(s.socialDigitalHumanPlans) ? s.socialDigitalHumanPlans as StudioSocialTaskSeed['digitalHumanShotPlans'] : []);
    setSocialSourceShotIds(Array.isArray(s.socialSourceShotIds) ? s.socialSourceShotIds.map(String).filter(Boolean) : []);
    rememberSocialShotMaterialBindings(Array.isArray(s.socialShotMaterialBindings)
      ? s.socialShotMaterialBindings as StudioSocialShotMaterialBinding[] : []);
    setVoiceoverStaleLangs(Array.isArray(s.voiceoverStaleLangs) ? s.voiceoverStaleLangs as string[] : []);
    const restoredVoiceDrafts = s.voiceDrafts && typeof s.voiceDrafts === 'object'
      ? s.voiceDrafts as Record<string, string>
      : {};
    const restoredVoiceoverAudios = s.voiceoverAudios && typeof s.voiceoverAudios === 'object'
      ? s.voiceoverAudios as typeof voiceoverAudios
      : {};
    setSourceCaptionTextEdits(s.sourceCaptionTextEdits && typeof s.sourceCaptionTextEdits === 'object'
      ? Object.fromEntries(Object.entries(s.sourceCaptionTextEdits).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {});
    const restoredAlignedCues = s.alignedCuesByLang && typeof s.alignedCuesByLang === 'object'
      ? s.alignedCuesByLang as Record<string, SubCue[]>
      : {};
    const savedVoiceLangs = Array.isArray(s.voiceLangs)
      ? s.voiceLangs.filter((code): code is string => typeof code === 'string' && Boolean(code.trim()))
      : [];
    // Once a draft has an explicit language selection, that list is the
    // user's source of truth. Do not resurrect a removed language merely
    // because an older translation/audio record is still present.
    const restoredLanguageCandidates = savedVoiceLangs.length
      ? [...new Set(savedVoiceLangs)]
      : [...new Set([
        ...Object.keys(restoredVoiceDrafts),
        ...Object.keys(restoredVoiceoverAudios),
        ...Object.keys(restoredAlignedCues),
      ])];
    const restoredVoiceLangs = restoredLanguageCandidates.length
      ? restoredLanguageCandidates
      : [enterpriseVoiceLangs.includes('en') ? 'en' : enterpriseVoiceLangs[0] || 'zh'];
    const nextVoiceDrafts = restoredVoiceDrafts;
    const nextVoiceoverAudios = restoredVoiceoverAudios;
    const nextAlignedCues = restoredAlignedCues;
    const savedActiveVoiceLang = typeof s.activeVoiceLang === 'string' ? s.activeVoiceLang : '';
    const restoredActiveVoiceLang = restoredVoiceLangs.includes(savedActiveVoiceLang)
      ? savedActiveVoiceLang
      : restoredVoiceLangs.find(code => Boolean(nextVoiceoverAudios[code]?.url)) || restoredVoiceLangs[0] || '';

    setVoiceLangs(restoredVoiceLangs);
    if (restoredActiveVoiceLang) {
      setActiveVoiceLang(restoredActiveVoiceLang);
      setLang(restoredActiveVoiceLang);
    }
    setVoiceDrafts(nextVoiceDrafts);
    setVoiceoverAudios(nextVoiceoverAudios);
    setAlignedCuesByLang(nextAlignedCues);
    const restoredActiveAudio = restoredActiveVoiceLang ? nextVoiceoverAudios[restoredActiveVoiceLang] : undefined;
    const restoredVoiceoverUrl = restoredActiveAudio?.url || (typeof s.voiceoverUrl === 'string' ? s.voiceoverUrl : null);
    const restoredVoiceoverDur = restoredActiveAudio?.duration || (typeof s.voiceoverDur === 'number' ? s.voiceoverDur : 0);
    setVoiceoverUrl(restoredVoiceoverUrl);
    setVoiceoverDur(restoredVoiceoverDur);
    setVoiceDraftNotice('');
    setTtsNotice('');
    setVoiceDraftLoading(false);
    setTtsLoading(false);
    setTtsLoadingScope(null);
    const restoredVideoKickoff = s.videoKickoff && typeof s.videoKickoff === 'object'
      ? s.videoKickoff as VideoKickoff
      : null;
    const restoredMaterialSnapshots = [
      ...(Array.isArray(s.materialSnapshots) ? s.materialSnapshots.map(normalizeClipSnapshot).filter((item): item is Clip => Boolean(item)) : []),
      kickoffClipSnapshot(restoredVideoKickoff),
    ].filter((item): item is Clip => Boolean(item));
    if (restoredMaterialSnapshots.length) {
      setMaterials(current => mergeClipLists(current, restoredMaterialSnapshots));
    }
    const restoredMode = s.mode === 'material' || s.mode === 'clone' || s.mode === 'product'
      ? s.mode
      : restoredVideoKickoff ? 'clone' : 'material';
    setMode(restoredMode);
    if (restoredVideoKickoff) setVideoKickoff(restoredVideoKickoff);
    const restoredContentMode = s.contentMode === 'poster' ? 'poster' : 'video';
    setContentMode(restoredContentMode);
    const restoredSteps = restoredContentMode === 'poster' ? POSTER_STEPS : STEPS;
    const savedStep = s.activeStepId ?? s.workspaceStep;
    const restoredStepId = typeof savedStep === 'string' ? savedStep as StepId : null;
    const restoredLegacyBgmStep = restoredContentMode === 'video' && restoredStepId === 'bgm';
    const restoredStepIndex = restoredLegacyBgmStep ? restoredSteps.findIndex(item => item.id === 'script') : restoredStepId ? restoredSteps.findIndex(item => item.id === restoredStepId) : -1;
    const restoredStepNeedsStoryboard = restoredMode === 'clone' && restoredContentMode === 'video'
      && Boolean(restoredStepId && ['material', 'preview', 'bgm', 'cover'].includes(restoredStepId));
    const restoredStepIsUnsafe = restoredStepNeedsStoryboard && !studioSpecHasCompiledStoryboard(savedSpec);
    setStepIdx((restoredMode === 'clone' && restoredContentMode === 'video' && restoredStepId === 'script') || restoredStepIsUnsafe
      ? 0
      : restoredStepIndex >= 0 ? restoredStepIndex : 0);
    setActiveStoryboardSlotId(typeof s.activeStoryboardSlotId === 'string' ? s.activeStoryboardSlotId : '');
    setCanvasView(s.canvasView === 'reference' ? 'reference' : 'creation');
    const savedScriptStage = s.scriptStageTab ?? s.workspaceScriptStage;
    setScriptStageTab(restoredLegacyBgmStep ? 'bgm' : (['theme', 'script', 'voiceover', 'audio', 'subtitle', 'bgm'] as const).find(stage => stage === savedScriptStage) || 'theme');
    setLastGeneratedSetupSignature(typeof s.lastGeneratedSetupSignature === 'string' ? s.lastGeneratedSetupSignature : '');
    if (typeof s.posterStyle === 'string' && POSTER_STYLES.some(item => item.id === s.posterStyle)) {
      setPosterStyle(s.posterStyle as typeof posterStyle);
    }
    if (typeof s.imageDeliverable === 'string' && IMAGE_DELIVERABLE_OPTIONS.some(item => item.id === s.imageDeliverable)) {
      setImageDeliverable(s.imageDeliverable as ImageDeliverable);
    }
    if (s.platform) setPlatform(s.platform as string);
    if (s.ratio) setRatio(s.ratio as string);
    if (typeof s.duration === 'number') setDuration(s.duration);
    // 语言由企业中心统一提供；旧草稿中的历史语言配置不得覆盖企业设置。
    setProvider('qwen');
    if (typeof s.productInfo === 'string') setProductInfo(s.productInfo);
    if (s.productSelectMode === 'single' || s.productSelectMode === 'multi') setProductSelectMode('multi');
    if (Array.isArray(s.selectedProductIds)) setSelectedProductIds(restoredProductIds);
    if (s.referenceProductAssignments && typeof s.referenceProductAssignments === 'object') setReferenceProductAssignments(s.referenceProductAssignments as Record<string, string>);
    if (s.referenceProductTerms && typeof s.referenceProductTerms === 'object') setReferenceProductTerms(s.referenceProductTerms as Record<string, string>);
    setReplicationSpeechSpeed(Number.isFinite(Number(s.replicationSpeechSpeed)) ? Math.max(.85, Math.min(1.3, Number(s.replicationSpeechSpeed))) : 1.3);
    if (s.replicationSpeechDraft && typeof s.replicationSpeechDraft === 'object') setReplicationSpeechDraft(s.replicationSpeechDraft as { signature: string; edits: Record<string, string>; deletedIds?: string[]; deletedShotIds?: string[] });
    if (typeof s.referenceBrandSourceTerm === 'string') setReferenceBrandSourceTerm(s.referenceBrandSourceTerm);
    if (typeof s.audience === 'string') setAudience(s.audience);
    if (typeof s.primaryCta === 'string') { setPrimaryCta(s.primaryCta); if (frozenStudioSpecRef.current) setEnterprisePrimaryCta(s.primaryCta); }
    setProductContentGoal(s.productContentGoal === 'reach' ? 'reach' : 'leads');
    setReachCta(typeof s.reachCta === 'string' ? s.reachCta : '');
    if (typeof s.cooperationRoute === 'string') setCooperationRoute(s.cooperationRoute);
    if (typeof s.sellingPoints === 'string') setSellingPoints(s.sellingPoints);
    if (typeof s.tone === 'string') setTone(s.tone);
    if (typeof s.videoThemeId === 'string' && VIDEO_THEMES.some(item => item.id === s.videoThemeId)) {
      setVideoThemeId(s.videoThemeId as VideoThemeId);
    } else if (s.videoThemeId === 'talking_head') {
      // 兼容旧草稿：真人口播不再是内容主题，迁移为默认主题与真人出镜。
      setVideoThemeId('buyer_pain');
      setPresenterMode('real');
    }
    const savedPlan = (s.contentOrder as { videoPlan?: VideoCreationPlan } | undefined)?.videoPlan;
    const savedMode = s.presentationMode || savedPlan?.presenter;
    const nextMode = savedMode === 'heygen' || savedMode === 'avatar' || savedMode === 'material' ? savedMode : s.presenterMode === 'digital' ? 'avatar' : 'material';
    setPresentationMode(nextMode);
    setPresenterMode(nextMode === 'material' ? 'real' : 'digital');
    const restoredSources: Record<string, 'avatar' | 'material'> = {};
    if (s.presentationSources && typeof s.presentationSources === 'object') {
      for (const [key, value] of Object.entries(s.presentationSources)) if (value === 'avatar' || value === 'material') restoredSources[key] = value;
    } else if (savedPlan?.scenePlan?.length) {
      parseStoryboardSlots(String(s.script || ''), Number(s.duration) || 30).forEach((slot, index) => {
        const choice = savedPlan.scenePlan?.[index];
        if (choice) restoredSources[slot.id] = choice.source;
      });
    }
    setPresentationSources(restoredSources);
    if (typeof s.themePainPoint === 'string') setThemePainPoint(s.themePainPoint);
    setThemeConversionGoal(typeof s.themeConversionGoal === 'string' && s.themeConversionGoal.trim()
      ? s.themeConversionGoal
      : DEFAULT_VIDEO_CONVERSION_GOAL);
    if (s.variationStrategy === 'remix' || s.variationStrategy === 'recreate' || s.variationStrategy === 'hybrid') setVariationStrategy(s.variationStrategy);
    if (typeof s.hookMaterialId === 'string') setHookMaterialId(s.hookMaterialId);
    if (Array.isArray(s.selected)) setSelected(s.selected as string[]);
    if (Array.isArray(s.scriptRecommendedMaterialIds)) setScriptRecommendedMaterialIds(s.scriptRecommendedMaterialIds as string[]);
    if (s.storyboardAssignments && typeof s.storyboardAssignments === 'object') setStoryboardAssignments(s.storyboardAssignments as Record<string, string>);
    if (s.storyboardSourcePlans && typeof s.storyboardSourcePlans === 'object') setStoryboardSourcePlans(s.storyboardSourcePlans as Record<string, StoryboardSourcePlan>);
    if (typeof s.assemblyName === 'string') setAssemblyName(s.assemblyName);
    if (Array.isArray(s.storyboardAssemblies) && s.storyboardAssemblies.length) {
      const restored = s.storyboardAssemblies as StoryboardAssembly[];
      const restoredActiveId = typeof s.activeAssemblyId === 'string' && restored.some(item => item.id === s.activeAssemblyId)
        ? s.activeAssemblyId
        : restored[0].id;
      const restoredActive = restored.find(item => item.id === restoredActiveId) || restored[0];
      setStoryboardAssemblies(restored);
      setActiveAssemblyId(restoredActiveId);
      setAssemblyName(restoredActive.name);
      setStoryboardAssignments(restoredActive.assignments || {});
      setStoryboardSourcePlans(restoredActive.sourcePlans || {});
      setSelected(restoredActive.selected || []);
    } else {
      const legacyName = typeof s.assemblyName === 'string' ? s.assemblyName : '视频1';
      setStoryboardAssemblies([{
        id: 'video-1', name: legacyName,
        assignments: s.storyboardAssignments as Record<string, string> || {},
        sourcePlans: s.storyboardSourcePlans as Record<string, StoryboardSourcePlan> || {},
        selected: Array.isArray(s.selected) ? s.selected as string[] : [],
      }]);
      setActiveAssemblyId('video-1');
    }
    const restoredScript = typeof s.script === 'string' ? s.script : '';
    // Loading a saved project is not a script edit: its translations belong
    // to this snapshot and must not be invalidated by the change effect.
    masterScriptSnapshot.current = restoredScript;
    setScript(restoredScript);
    const restoredSourceLanguage = detectScriptLanguageCode(formatVoiceoverWithTimestamps(restoredScript));
    setVoiceoverLines(typeof s.voiceoverLines === 'string'
      ? s.voiceoverLines
      : restoredVoiceDrafts[restoredSourceLanguage] || formatVoiceoverWithTimestamps(restoredScript));
    if (s.scriptType) setScriptType(s.scriptType as typeof scriptType);
    if (frozenStudioSpecRef.current) setModeScripts([]);
    else if (Array.isArray(s.modeScripts)) setModeScripts(s.modeScripts as ModeScriptOutput[]);
    if (typeof s.activeModeScriptId === 'string') setActiveModeScriptId(s.activeModeScriptId);
    if (s.voice) setVoice(s.voice as string);
    if (Array.isArray(s.voiceCandidates)) setVoiceCandidates(s.voiceCandidates as string[]);
    if (s.voiceoverMode === 'unselected' || s.voiceoverMode === 'none' || s.voiceoverMode === 'ai' || s.voiceoverMode === 'upload') setVoiceoverMode(s.voiceoverMode);
    if (typeof s.uploadedVoiceName === 'string') setUploadedVoiceName(s.uploadedVoiceName);
    if (typeof s.customVoiceId === 'string') setCustomVoiceId(s.customVoiceId);
    if (typeof s.customVoiceName === 'string') setCustomVoiceName(s.customVoiceName);
    if (typeof s.customVoiceUrl === 'string') setCustomVoiceUrl(s.customVoiceUrl);
    if (s.ttsLanguageSettings && typeof s.ttsLanguageSettings === 'object') setTtsLanguageSettings(s.ttsLanguageSettings as Record<string, LanguageTtsSettings>);
    setVoiceDraftStaleLangs(Array.isArray(s.voiceDraftStaleLangs) ? s.voiceDraftStaleLangs as string[] : []);
    if (s.languageRenderOutputs && typeof s.languageRenderOutputs === 'object') setLanguageRenderOutputs(s.languageRenderOutputs as typeof languageRenderOutputs);
    const savedAcceptance = s.renderAcceptance && typeof s.renderAcceptance === 'object'
      ? s.renderAcceptance as Record<string, unknown>
      : null;
    setReviewedRenderPath(savedAcceptance?.accepted === true && typeof savedAcceptance.renderPath === 'string'
      ? savedAcceptance.renderPath
      : '');
    const qualityRecords = Array.isArray(s.projectQualityRecords) ? s.projectQualityRecords as ProjectQualityRecord[] : [];
    const activeQualityId = typeof s.activeProjectQualityRecordId === 'string' ? s.activeProjectQualityRecordId : '';
    setProjectQualityRecord(qualityRecords.find(item => item.id === activeQualityId) || null);
    if (s.languageRenderVersions && typeof s.languageRenderVersions === 'object') setLanguageRenderVersions(s.languageRenderVersions as typeof languageRenderVersions);
    if (s.storyboardVideoVersions && typeof s.storyboardVideoVersions === 'object') setStoryboardVideoVersions(s.storyboardVideoVersions as typeof storyboardVideoVersions);
    if (Array.isArray(s.productVideoVersions)) setProductVideoVersions(s.productVideoVersions as VideoGenerationVersion[]);
    if (typeof s.ttsPreset === 'string' && TTS_PRESETS.some(item => item.id === s.ttsPreset)) setTtsPreset(s.ttsPreset as TtsStyleOptions['preset']);
    if (typeof s.ttsEmotion === 'string') setTtsEmotion(s.ttsEmotion);
    if (typeof s.ttsEmotionIntensity === 'number') setTtsEmotionIntensity(s.ttsEmotionIntensity);
    if (typeof s.ttsSpeed === 'number') setTtsSpeed(s.ttsSpeed);
    if (s.ttsPauseStyle === 'few' || s.ttsPauseStyle === 'natural' || s.ttsPauseStyle === 'dramatic') setTtsPauseStyle(s.ttsPauseStyle);
    if (typeof s.ttsPronunciationText === 'string') setTtsPronunciationText(s.ttsPronunciationText);
    if (s.referenceVoiceStrength === 'light' || s.referenceVoiceStrength === 'balanced' || s.referenceVoiceStrength === 'strong') setReferenceVoiceStrength(s.referenceVoiceStrength);
    if (typeof s.useReferenceVoiceStyle === 'boolean') setUseReferenceVoiceStyle(s.useReferenceVoiceStyle);
    setBgm(typeof s.bgm === 'string' ? s.bgm : '');
    if (Array.isArray(s.bgmCandidates)) setBgmCandidates(s.bgmCandidates as string[]);
    if (s.platformBgms && typeof s.platformBgms === 'object') setPlatformBgms(s.platformBgms as Record<string, string>);
    if (s.assemblyBgms && typeof s.assemblyBgms === 'object') setAssemblyBgms(s.assemblyBgms as Record<string, string>);
    if (s.materialVersionBgms && typeof s.materialVersionBgms === 'object') setMaterialVersionBgms(s.materialVersionBgms as Record<string, string>);
    if (s.soundCandidatesPerContent === 1 || s.soundCandidatesPerContent === 2) setSoundCandidatesPerContent(s.soundCandidatesPerContent);
    if (typeof s.bgmVol === 'number') setBgmVol(s.bgmVol);
    if (typeof s.voiceVol === 'number') setVoiceVol(s.voiceVol);
    if (typeof s.effectSoundsOn === 'boolean') setEffectSoundsOn(s.effectSoundsOn);
    if (s.effectPreset === 'natural' || s.effectPreset === 'dynamic' || s.effectPreset === 'tech' || s.effectPreset === 'cinematic') setEffectPreset(s.effectPreset);
    if (s.effectIntensity === 0 || s.effectIntensity === 1 || s.effectIntensity === 2 || s.effectIntensity === 3) setEffectIntensity(s.effectIntensity);
    setDisabledEffectSceneIds(Array.isArray(s.disabledEffectSceneIds) ? s.disabledEffectSceneIds.filter((value): value is string => typeof value === 'string') : []);
    if (s.cover && s.cover !== 'gradient') setCover(s.cover as string);
    if (typeof s.coverTitle === 'string') setCoverTitle(s.coverTitle);
    if (s.coverStyle) setCoverStyle(s.coverStyle as CoverStyle);
    setCapturedCoverFrameUrl(typeof s.capturedCoverFrameUrl === 'string' ? s.capturedCoverFrameUrl : '');
    if (s.materialVersionCovers && typeof s.materialVersionCovers === 'object') setMaterialVersionCovers(s.materialVersionCovers as Record<string, CoverVersionConfig>);
    if (s.account !== undefined) setAccount(s.account as string | null);
    if (typeof s.caption === 'string') setCaption(s.caption);
    setPosterDraft(s.posterDraft && typeof s.posterDraft === 'object' ? s.posterDraft as FbPosterResult : null);
    setLeadContentPackage(s.leadContentPackage && typeof s.leadContentPackage === 'object' ? s.leadContentPackage as LeadContentPackageResult : null);
    setPosterJsonText(typeof s.posterJsonText === 'string' ? s.posterJsonText : '');
    setPosterImageUrl(typeof s.posterImageUrl === 'string' ? s.posterImageUrl : '');
    setPosterImageMaterialId(typeof s.posterImageMaterialId === 'string' ? s.posterImageMaterialId : '');
    setPosterImageReviewStatus(s.posterImageReviewStatus === 'accepted'
      ? 'accepted' : typeof s.posterImageUrl === 'string' && s.posterImageUrl ? 'needs_review' : 'none');
    if (typeof s.subtitlesOn === 'boolean') setSubtitlesOn(s.subtitlesOn);
    if (s.subMode === 'target' || s.subMode === 'bilingual') setSubMode(s.subMode);
    if (s.subtitleStyle && typeof s.subtitleStyle === 'object') setSubtitleStyle(current => ({ ...current, ...(s.subtitleStyle as Partial<typeof current>) }));
    setClipEdits(s.clipEdits && typeof s.clipEdits === 'object' && !Array.isArray(s.clipEdits) ? s.clipEdits as Record<string, ClipEdit> : {});
    if (typeof s.variationPeople === 'string') setVariationPeople(s.variationPeople);
    if (typeof s.variationScenes === 'string') setVariationScenes(s.variationScenes);
    if (typeof s.variationLanguages === 'string') setVariationLanguages(s.variationLanguages);
    if (typeof s.variationHooks === 'string') setVariationHooks(s.variationHooks);
    if (typeof s.variationMax === 'number') setVariationMax(s.variationMax);
  };

  const loadProject = (p: StudioProject) => {
    const {
      setModeNotice, frozenStudioSpecRef, setBoundProductionSnapshot,
      localFlowTestRef, localFlowRecoveryRef, adoptEditorProjectRevision,
      projectSaveConflictRef, notification, projectHydrationPendingRef,
      incomingCreateRequest, lastSavedAutosaveFingerprintRef, setProjectId,
      setProjectTitle, setWorkflowProjectSelectionPending, autoGen,
      setShowProjects, setPublished, setCanvasView,
      setStepIdx,
    } = ports;

    let frozen: ReturnType<typeof frozenStudioProject>;
    try { frozen = p.status === 'template' ? null : frozenStudioProject(p.spec); }
    catch (error) { setModeNotice(error instanceof Error ? error.message : '冻结生产计划校验失败'); return; }
    frozenStudioSpecRef.current = frozen?.spec ?? null;
    setBoundProductionSnapshot(frozen ? { projectId: p.id, slots: frozen.slots } : null);
    localFlowTestRef.current = (p.spec as any)?.localFlowTest?.enabled === true ? (p.spec as any).localFlowTest : null;
    localFlowRecoveryRef.current = localFlowTestRef.current ? { spec: p.spec, projectId: p.id } : null;
    if (p.status !== 'template') {
      adoptEditorProjectRevision(p);
      projectSaveConflictRef.current = null;
      notification.destroy('studio-project-save-conflict');
    }
    projectHydrationPendingRef.current = true;
    const restoredSpec = p.status === 'template' ? withoutStudioWorkflowContext(p.spec) : p.spec;
    const restoredProjectId = p.status === 'template' ? null : p.id;
    const restoredTitle = p.status === 'template' ? `${p.title} · 副本` : loadedStudioProjectTitle(p, incomingCreateRequest);
    lastSavedAutosaveFingerprintRef.current = studioAutosaveFingerprint(restoredProjectId, restoredTitle, restoredSpec);
    applySpec(restoredSpec);
    setProjectId(restoredProjectId);
    setProjectTitle(restoredTitle);
    setWorkflowProjectSelectionPending(false);
    autoGen.current = true; // 载入已有脚本，别再自动覆盖
    setShowProjects(false);
    setPublished(false);
    const continuationStep = loadedStudioContinuationStep(
      p.id,
      incomingCreateRequest,
      studioSpecHasCompiledStoryboard(p.spec),
    );
    if (continuationStep) {
      setCanvasView('creation');
      setStepIdx(STEPS.findIndex(item => item.id === continuationStep));
    } else {
      const savedRequest = p.spec.studioCreateRequest as SocialContentCreateRequest | undefined;
      if (savedRequest?.creationPath === 'viral_replication' && savedRequest.confirmedSpeech?.length && studioSpecHasCompiledStoryboard(p.spec)) {
        setStepIdx(STEPS.findIndex(item => item.id === 'material'));
      }
    }
  };

  return { applySpec, loadProject };
}
