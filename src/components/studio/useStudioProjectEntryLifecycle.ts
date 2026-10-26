import { parseScopedSceneTarget } from '../../lib/scopedSceneNavigation';
import { studioPreviewRatio } from './StudioPreviewStage';
import { useEffect, useRef } from 'react';
import { studioApi } from '../../lib/studioApi';
import { useStudioSocialTaskHydration, socialTaskProductionPreview, socialTaskReferenceKickoff, socialTaskShotMaterialBindings, socialTaskStudioShotIds } from '../socialContent/useStudioSocialTaskHydration';
import { canonicalProductionReadView } from '../../lib/productionReadModel';
import { ratioNumber } from './studioStoryboardMaterialMatching';
import { buildReferenceSpeechPlan } from './studioReferenceSpeechPlan';
import { loadedStudioContinuationStep } from './studioProjectNavigation.js';
import { STEPS, DEFAULT_VIDEO_CONVERSION_GOAL, VIDEO_THEMES, RATIOS } from './studioWorkspaceCatalog.js';
import { studioSpecHasCompiledStoryboard } from './studioStoryboardParsing.js';
import type { StudioProjectLifecyclePorts } from './studioProjectLifecyclePorts.js';

export function useStudioProjectSocialTaskHydration(ports: Pick<StudioProjectLifecyclePorts,
  | 'restoreProductMaterialSelection'
  | 'setSelectedProductIds'
  | 'socialTaskProjectLookupDone'
  | 'rawSceneTarget'
  | 'socialContentTaskId'
  | 'frozenStudioSpecRef'
  | 'projectId'
  | 'autoGen'
  | 'studioSettingsEditedRef'
  | 'hasTimestampScript'
  | 'setSceneReworkTask'
  | 'setAgentTaskProductionPreview'
  | 'setCanonicalProductionView'
  | 'rememberSocialShotMaterialBindings'
  | 'setSocialSourceShotIds'
  | 'setVideoKickoff'
  | 'setReferenceNeedsDirectorReview'
  | 'setReferenceRecoveryMessage'
  | 'setModeNotice'
  | 'setSocialTaskProductReference'
  | 'localGateBypass'
  | 'setCanvasView'
  | 'setScriptView'
  | 'setStepIdx'
  | 'setDuration'
  | 'setScript'
  | 'setVoiceoverLines'
  | 'extractVoiceoverText'
  | 'setProjectTitle'
  | 'setContentMode'
  | 'setMode'
  | 'setProductSelectMode'
  | 'setPlatform'
  | 'setRatio'
  | 'setLang'
  | 'setVoiceLangs'
  | 'setActiveVoiceLang'
  | 'setAudience'
  | 'setPrimaryCta'
  | 'setVideoThemeId'
  | 'setThemePainPoint'
  | 'setThemeConversionGoal'
  | 'setSelected'
  | 'setSocialDigitalHumanPlans'
>) {
  const {
    socialTaskProjectLookupDone, rawSceneTarget, socialContentTaskId,
  } = ports;
  useStudioSocialTaskHydration({
    taskId: socialTaskProjectLookupDone && !rawSceneTarget ? socialContentTaskId : null,
    // A saved workbench shell can predate the task's reference analysis. Rehydrate
    // that empty shell from the authoritative task instead of trapping the user
    // in a manual draft with no reference or enabled script action.
    canApply: () => {
      const {
        frozenStudioSpecRef, projectId, autoGen,
        studioSettingsEditedRef, hasTimestampScript,
      } = ports;
      return !frozenStudioSpecRef.current && ((!projectId && !autoGen.current && !studioSettingsEditedRef.current)
        || Boolean(projectId && socialContentTaskId && !hasTimestampScript));
    },
    onRefresh: task => {
      const {
        setSceneReworkTask, setAgentTaskProductionPreview, setCanonicalProductionView,
        rememberSocialShotMaterialBindings, setSocialSourceShotIds, setVideoKickoff,
        setReferenceNeedsDirectorReview, setReferenceRecoveryMessage, setModeNotice,
      } = ports;

      setSceneReworkTask(task);
      setAgentTaskProductionPreview(socialTaskProductionPreview(task));
      setCanonicalProductionView(task.production ? canonicalProductionReadView(task.production) : null);
      rememberSocialShotMaterialBindings(socialTaskShotMaterialBindings(task));
      setSocialSourceShotIds(socialTaskStudioShotIds(task));
      const reference = socialTaskReferenceKickoff(task);
      if (reference) setVideoKickoff(reference);
      const failure = task.referencePreparation;
      const needsReview = failure?.status === 'review_required' && failure.reason === 'director_review_pending';
      setReferenceNeedsDirectorReview(needsReview);
      setReferenceRecoveryMessage(needsReview ? '参考视频的全片分析已完成，正在等待编导复核逐镜与逐句证据。请到灵感中心打开原片的编导分析，完成复核后再生成脚本。' : failure?.status === 'blocked' ? (failure.reason === 'reference_provider_quota'
        ? '参考视频下载失败：采集服务额度已耗尽，备用下载也未成功。恢复下载服务后可重试，或返回灵感中心更换参考视频。'
        : '参考视频暂不可分析，请检查原视频与下载服务后重试，或返回灵感中心更换参考视频。') : '');
      if (reference?.referenceAnalysis || failure?.status === 'blocked' || needsReview) {
        setModeNotice(current => /参考视频|参考分析|对标视频/.test(current) ? '' : current);
      }
    },
    onHydrate: seed => {
      const {
        studioSettingsEditedRef, autoGen, setSocialTaskProductReference,
        setAgentTaskProductionPreview, rememberSocialShotMaterialBindings, setSocialSourceShotIds,
        localGateBypass, setVideoKickoff, setCanvasView,
        setScriptView, setStepIdx, setDuration,
        setModeNotice, setScript, setVoiceoverLines,
        extractVoiceoverText, setProjectTitle, setContentMode,
        setMode, setProductSelectMode, setPlatform,
        setRatio, setLang, setVoiceLangs,
        setActiveVoiceLang, setAudience, setPrimaryCta,
        setVideoThemeId, setThemePainPoint, setThemeConversionGoal,
        setSelected, setSocialDigitalHumanPlans,
      } = ports;

      studioSettingsEditedRef.current = true;
      autoGen.current = true;
      ports.restoreProductMaterialSelection(seed.productMaterialSelection);
      ports.setSelectedProductIds(seed.selectedProductIds);
      setSocialTaskProductReference(seed.productReference);
      setAgentTaskProductionPreview(seed.productionPreview);
      rememberSocialShotMaterialBindings(seed.shotMaterialBindings);
      setSocialSourceShotIds(seed.sourceShotIds);
      const localStoryboardScript = localGateBypass && seed.creationMode === 'clone'
        ? buildReferenceSpeechPlan(seed.reference).script
        : '';
      if (seed.reference) {
        setVideoKickoff(seed.reference); setCanvasView('creation');
        setScriptView('timestamp'); setStepIdx(0);
        if (seed.reference.video?.duration) setDuration(seed.reference.video.duration);
        setModeNotice(seed.reference.referenceAnalysis ? '' : '参考视频尚未完成分析；工作台已打开，分析完成后可继续脚本与口播制作。');
      }
      if (localStoryboardScript) {
        setScript(localStoryboardScript);
        setVoiceoverLines(extractVoiceoverText(localStoryboardScript));
      }
      setProjectTitle(seed.projectTitle); setContentMode(seed.contentMode); setMode(seed.creationMode);
      if (seed.creationMode === 'clone' || seed.selectedProductIds.length > 1) setProductSelectMode('multi');
      setPlatform(seed.platform); setRatio(seed.aspectRatio); setLang(seed.languageCodes[0]!);
      setVoiceLangs(seed.languageCodes); setActiveVoiceLang(seed.languageCodes[0]!);
      setAudience(seed.audience); setPrimaryCta(seed.primaryCta);
      if (seed.contentTheme) {
        const hydratedTheme = VIDEO_THEMES.find(item => item.id === seed.contentTheme);
        if (hydratedTheme) {
          setVideoThemeId(hydratedTheme.id);
          setThemePainPoint(seed.themeTopic || hydratedTheme.painPoint);
          setThemeConversionGoal(DEFAULT_VIDEO_CONVERSION_GOAL);
        }
      }
      setSelected(seed.selectedMaterialIds);
      setSocialDigitalHumanPlans(seed.digitalHumanShotPlans);
      const hydrationNotices = [
        seed.factVerificationNotice,
        seed.unsupportedLanguages.length ? `本次任务中的${seed.unsupportedLanguages.join('、')}暂不在创作语言列表中，请先选择可用语言。` : '',
      ].filter(Boolean);
      if (hydrationNotices.length) setModeNotice(hydrationNotices.join(' '));
    },
  });
}

export function useStudioRequestedProjectEntry(ports: Pick<StudioProjectLifecyclePorts,
  | 'restoreProductMaterialSelection'
  | 'setSelected'
  | 'studioCreateRequest'
  | 'socialContentTaskId'
  | 'frozenStudioSpecRef'
  | 'setBoundProductionSnapshot'
  | 'setProjectId'
  | 'setScriptStageTab'
  | 'setVoiceoverMode'
  | 'setScript'
  | 'setVoiceoverLines'
  | 'setVoiceDrafts'
  | 'setVoiceoverAudios'
  | 'setAlignedCuesByLang'
  | 'setVoiceoverUrl'
  | 'setVoiceoverDur'
  | 'setModeNotice'
  | 'setStepIdx'
  | 'setMode'
  | 'setProjectTitle'
  | 'setProductInfo'
  | 'setPlatform'
  | 'setRatio'
  | 'setCanvasView'
>) {
  const {
    socialContentTaskId, studioCreateRequest,
  } = ports;
  const appliedCreateRequestRef = useRef<number | null>(null);
  useEffect(() => {
    const {
      frozenStudioSpecRef, setBoundProductionSnapshot, setProjectId,
      setScriptStageTab, setVoiceoverMode, setScript,
      setVoiceoverLines, setVoiceDrafts, setVoiceoverAudios,
      setAlignedCuesByLang, setVoiceoverUrl, setVoiceoverDur,
      setModeNotice, setStepIdx, setMode,
      setProjectTitle, setProductInfo, setPlatform,
      setRatio, setCanvasView,
    } = ports;

    if (!studioCreateRequest || studioCreateRequest.continueProjectId || socialContentTaskId || appliedCreateRequestRef.current === studioCreateRequest.requestId) return;
    appliedCreateRequestRef.current = studioCreateRequest.requestId;
    ports.restoreProductMaterialSelection(studioCreateRequest.productMaterialSelection);
    if (studioCreateRequest.productMaterialSelection) ports.setSelected(studioCreateRequest.productMaterialSelection.selectedIds);
    const prefill = studioCreateRequest.prefill;
    frozenStudioSpecRef.current = null;
    setBoundProductionSnapshot(null);
    setProjectId(null);
    setScriptStageTab('theme');
    setVoiceoverMode('unselected');
    setScript('');
    setVoiceoverLines('');
    setVoiceDrafts({});
    setVoiceoverAudios({});
    setAlignedCuesByLang({});
    setVoiceoverUrl(null);
    setVoiceoverDur(0);
    setModeNotice('');
    const requestedStep = loadedStudioContinuationStep(null, studioCreateRequest) || 'mode';
    setStepIdx(STEPS.findIndex(item => item.id === requestedStep));
    setMode(studioCreateRequest.creationPath === 'viral_replication' ? 'clone' : 'material');
    if (prefill?.title?.trim()) setProjectTitle(prefill.title.trim());
    if (prefill?.productName?.trim()) setProductInfo(prefill.productName.trim());
    if (prefill?.platforms?.[0]) setPlatform(prefill.platforms[0]);
    if (studioCreateRequest.sourceContext?.aspectRatio) {
      const requestedRatio = studioPreviewRatio(studioCreateRequest.sourceContext.aspectRatio);
      setRatio(RATIOS.reduce((closest, candidate) => Math.abs(ratioNumber(candidate) - requestedRatio) < Math.abs(ratioNumber(closest) - requestedRatio) ? candidate : closest, RATIOS[0]!));
    }
    setCanvasView('creation');
  }, [socialContentTaskId, studioCreateRequest]);

  return { appliedCreateRequestRef };
}

export function useStudioProjectWorkflowEntry(ports: Pick<StudioProjectLifecyclePorts,
  | 'workflowContext'
  | 'projectId'
  | 'setProjectWorkflowContext'
  | 'setWorkflowProjectSelectionPending'
  | 'projectWorkflowContext'
  | 'frozenStudioSpecRef'
  | 'setBoundProductionSnapshot'
  | 'setProjectId'
  | 'setProjects'
  | 'setShowProjects'
>) {
  const {
    workflowContext,
  } = ports;
  useEffect(() => {
    const {
      projectId, setProjectWorkflowContext, setWorkflowProjectSelectionPending,
      projectWorkflowContext, frozenStudioSpecRef, setBoundProductionSnapshot,
      setProjectId, setProjects, setShowProjects,
    } = ports;

    if (!workflowContext) {
      if (!projectId) setProjectWorkflowContext(null);
      setWorkflowProjectSelectionPending(false);
      return;
    }
    const isSameTask = projectWorkflowContext?.runId === workflowContext.runId
      && projectWorkflowContext?.taskId === workflowContext.taskId;
    if (isSameTask) return;
    // A fresh Digital Employee handoff starts a new attributed draft. It must
    // never relabel an unrelated project that happened to be open in Studio.
    frozenStudioSpecRef.current = null;
    setBoundProductionSnapshot(null);
    setProjectId(null);
    setProjectWorkflowContext(workflowContext);
    if (['content_production', 'content_quality_gate'].includes(workflowContext.taskKey || '')) {
      setProjects([]);
      setShowProjects(true);
      setWorkflowProjectSelectionPending(true);
    }
  }, [workflowContext]);
}

export function useStudioTaskProjectLookup(ports: Pick<StudioProjectLifecyclePorts,
  | 'socialContentTaskId'
  | 'setSocialTaskProjectLookupDone'
  | 'setProjects'
  | 'setSceneNavigationError'
  | 'loadProject'
  | 'setCanvasView'
  | 'setModeNotice'
  | 'projectHydrationPendingRef'
  | 'setProjectHydrationRevision'
  | 'sceneTargetKey'
>) {
  const {
    socialContentTaskId, sceneTargetKey,
  } = ports;
  useEffect(() => {
    const {
      setSocialTaskProjectLookupDone, setProjects, setSceneNavigationError,
      loadProject, setCanvasView, setModeNotice,
      projectHydrationPendingRef, setProjectHydrationRevision,
    } = ports;

    const taskId = socialContentTaskId?.trim();
    if (!taskId) {
      setSocialTaskProjectLookupDone(true);
      return;
    }
    let disposed = false;
    setSocialTaskProjectLookupDone(false);
    void studioApi.listProjects().then(list => {
      if (disposed) return;
      setProjects(list);
      const requestedProjectId = new URLSearchParams(location.search).get('project');
      const taskProjects = list.filter(item => item.status !== 'template' && item.spec?.socialContentTaskId === taskId);
      const deepTarget = parseScopedSceneTarget(window.history.state?.productionDetail?.sceneTarget);
      if (window.history.state?.productionDetail?.sceneTarget) {
        const exact = taskProjects.filter(item => item.id === deepTarget?.projectId);
        if (!deepTarget || deepTarget.contentTaskId !== taskId || exact.length !== 1) { setSceneNavigationError('指定视频项目缺失或与任务不一致，请返回原周任务定位真实上游。'); return; }
        loadProject(exact[0]!); setCanvasView('creation'); return;
      }
      const project = taskProjects.find(item => item.id === requestedProjectId)
        || taskProjects.find(item => Object.keys(item.spec?.storyboardAssignments || {}).length > 0)
        || taskProjects[0];
      if (!project) return;
      loadProject(project);
      setCanvasView('creation');
    }).catch(() => {
      if (!disposed) setModeNotice('上次制作进度读取失败，已重新载入任务资料。');
    }).finally(() => {
      if (!disposed) {
        setSocialTaskProjectLookupDone(true);
        window.setTimeout(() => {
          projectHydrationPendingRef.current = false;
          setProjectHydrationRevision(value => value + 1);
        }, 0);
      }
    });
    return () => { disposed = true; };
  }, [socialContentTaskId, sceneTargetKey]);
}

export function useStudioAgentProjectLookup(ports: Pick<StudioProjectLifecyclePorts,
  | 'agentProduction'
  | 'setModeNotice'
  | 'loadProject'
  | 'setStepIdx'
  | 'setScriptStageTab'
>) {
  const {
    agentProduction,
  } = ports;
  useEffect(() => {
    const {
      setModeNotice, loadProject, setStepIdx,
      setScriptStageTab,
    } = ports;

    if (!agentProduction.active) return;
    let disposed = false;
    const refresh = async () => {
      const target = window.__agentProductionTarget;
      if (!target?.projectId) return;
      const list = await studioApi.listProjects();
      if (disposed) return;
      const project = list.find(item => item.id === target.projectId);
      if (!project) { setModeNotice('关联的生产项目暂不可访问'); return; }
      loadProject(project);
      const stage = target.stage;
      const requestedStepId = stage === 'script' ? 'script' : stage === 'material_match' ? 'material' : ['voice_subtitles', 'heygen'].includes(stage || '') ? 'script' : ['render', 'quality', 'completed'].includes(stage || '') ? 'preview' : undefined;
      const stepId = requestedStepId && !studioSpecHasCompiledStoryboard(project.spec)
        ? 'mode'
        : requestedStepId;
      if (stepId) { const index = STEPS.findIndex(item => item.id === stepId); if (index >= 0) setStepIdx(index); }
      if (stage === 'voice_subtitles') setScriptStageTab('audio');
    };
    const update = () => { void refresh().catch(error => setModeNotice(error.message)); };
    update();
    window.addEventListener('lingshu:agent-business-refresh', update);
    return () => { disposed = true; window.removeEventListener('lingshu:agent-business-refresh', update); };
  }, [agentProduction.active]);
}
