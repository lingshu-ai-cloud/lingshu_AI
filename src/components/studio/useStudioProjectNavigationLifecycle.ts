import { useEffect } from 'react';
import { studioApi } from '../../lib/studioApi';
import type { VideoKickoff } from './studioVideoKickoff';
import { hasIncompleteReferenceAnalysis, referenceAnalysisEnd } from './studioReferenceAdmission';
import { projectMatchesKickoff } from './studioSourceMaterial';
import { CANVA_COVER_RETURN_KEY, CANVA_COVER_RETURN_TTL, PUBLISH_RETURN_PREVIEW_KEY, STUDIO_OPEN_PROJECT_KEY, PUBLISH_RETURN_PREVIEW_TTL } from './studioWorkspaceConfig.js';
import { STEPS, COVER_STEP_INDEX, draftTitleForMode } from './studioWorkspaceCatalog.js';
import { referenceVoiceProfile } from './studioReferenceVoiceProfile.js';
import { productOptionFromInfo } from './studioProductSelection.js';
import type { CanvaCoverReturnState, ModeCard } from './studioWorkspaceContracts.js';
import type { StudioProjectLifecyclePorts } from './studioProjectLifecyclePorts.js';

export function useStudioProjectOverlaySignal(ports: Pick<StudioProjectLifecyclePorts,
  | 'showProjects'
  | 'projectsPanelWasOpenRef'
>) {
  const {
    showProjects,
  } = ports;
  useEffect(() => {
    const {
      projectsPanelWasOpenRef,
    } = ports;

    if (showProjects) {
      projectsPanelWasOpenRef.current = true;
      const frame = requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('lingshu:content-view-changed', { detail: { entry: 'works' } })));
      return () => cancelAnimationFrame(frame);
    }
    if (!projectsPanelWasOpenRef.current) return;
    projectsPanelWasOpenRef.current = false;
    window.dispatchEvent(new CustomEvent('lingshu:content-view-changed', { detail: { entry: 'create' } }));
  }, [showProjects]);
}

export function useStudioCanvaCoverReturn(ports: Pick<StudioProjectLifecyclePorts,
  | 'applySpec'
  | 'setProjectId'
  | 'setProjectTitle'
  | 'setCoverUrl'
  | 'setStepIdx'
  | 'autoGen'
>) {
  useEffect(() => {
    const {
      applySpec, setProjectId, setProjectTitle,
      setCoverUrl, setStepIdx, autoGen,
    } = ports;

    let raw = '';
    try {
      raw = localStorage.getItem(CANVA_COVER_RETURN_KEY) || '';
      if (raw) localStorage.removeItem(CANVA_COVER_RETURN_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as CanvaCoverReturnState;
      if (!saved?.at || Date.now() - saved.at > CANVA_COVER_RETURN_TTL) return;
      if (saved.spec && typeof saved.spec === 'object') applySpec(saved.spec);
      setProjectId(saved.projectId ?? null);
      if (saved.projectTitle) setProjectTitle(saved.projectTitle);
      if (saved.coverUrl) setCoverUrl(saved.coverUrl);
      setStepIdx(STEPS.findIndex(s => s.id === saved.stepId) >= 0 ? STEPS.findIndex(s => s.id === saved.stepId) : COVER_STEP_INDEX);
      autoGen.current = true;
    } catch {
      // Ignore malformed return payloads from older local builds.
    }
  }, []);
}

export function useStudioWorkflowProjectOverlay(ports: Pick<StudioProjectLifecyclePorts,
  | 'agentProduction'
  | 'workflowContext'
  | 'openProjects'
  | 'setModeNotice'
>) {
  const {
    workflowContext,
  } = ports;
  useEffect(() => {
    const {
      agentProduction, openProjects, setModeNotice,
    } = ports;

    if (!agentProduction.active && (workflowContext?.runId && workflowContext?.taskId || workflowContext?.entityId)) void openProjects().catch(error => setModeNotice(error.message));
  }, [workflowContext?.runId, workflowContext?.taskId, workflowContext?.entityId]);
}

export function useStudioOpenProjectsSignal(ports: Pick<StudioProjectLifecyclePorts,
  | 'openProjectsSignal'
  | 'handledOpenProjectsSignalRef'
  | 'openProjects'
  | 'workflowContext'
>) {
  const {
    openProjectsSignal, workflowContext,
  } = ports;
  useEffect(() => {
    const {
      handledOpenProjectsSignalRef, openProjects,
    } = ports;

    if (!openProjectsSignal || openProjectsSignal <= handledOpenProjectsSignalRef.current) return;
    handledOpenProjectsSignalRef.current = openProjectsSignal;
    window.dispatchEvent(new CustomEvent('lingshu:content-view-changed', { detail: { entry: 'works' } }));
    void openProjects();
  }, [openProjectsSignal, workflowContext?.entityId, workflowContext?.runId, workflowContext?.taskId]);
}

export function useStudioRememberedProjectEntry(ports: Pick<StudioProjectLifecyclePorts,
  | 'workflowContext'
  | 'socialContentTaskId'
  | 'setProjects'
  | 'setModeNotice'
  | 'projectHydrationPendingRef'
  | 'loadProject'
  | 'setProjectHydrationRevision'
  | 'setLocalFlowRecoveryEpoch'
  | 'localFlowTestRef'
>) {
  const {
    workflowContext,
  } = ports;
  useEffect(() => {
    const {
      socialContentTaskId, setProjects, setModeNotice,
      projectHydrationPendingRef, loadProject, setProjectHydrationRevision,
      setLocalFlowRecoveryEpoch, localFlowTestRef,
    } = ports;

    if (workflowContext || socialContentTaskId) {
      try { localStorage.removeItem(STUDIO_OPEN_PROJECT_KEY); } catch { /* ignore */ }
      return;
    }
    let disposed = false;
    let raw = '';
    try {
      raw = localStorage.getItem(STUDIO_OPEN_PROJECT_KEY) || '';
      if (raw) localStorage.removeItem(STUDIO_OPEN_PROJECT_KEY);
    } catch { return; }
    if (!raw) {
      const id = new URLSearchParams(location.search).get('project');
      if (id) raw = JSON.stringify({ at: Date.now(), projectId: id });
    }
    if (!raw) return;
    try {
      const state = JSON.parse(raw) as { at?: number; projectId?: string };
      if (!state.at || Date.now() - state.at > 10 * 60 * 1000 || !state.projectId) return;
      void studioApi.listProjects().then(list => {
        if (disposed) return;
        setProjects(list);
        const project = list.find(item => item.id === state.projectId && item.status !== 'template');
        if (!project) {
          setModeNotice('未找到该历史创作。');
          projectHydrationPendingRef.current = false;
          return;
        }
        loadProject(project);
        window.setTimeout(() => {
          if (disposed) return;
          projectHydrationPendingRef.current = false;
          setProjectHydrationRevision(value => value + 1);
          setLocalFlowRecoveryEpoch(value => value + 1);
        }, localFlowTestRef.current ? 5_000 : 0);
      }).catch(() => {
        projectHydrationPendingRef.current = false;
        setModeNotice('历史创作读取失败，请稍后重试。');
      });
    } catch {
      // Ignore malformed navigation payloads from older local builds.
    }
    return () => { disposed = true; };
  }, [workflowContext?.runId, workflowContext?.taskId, workflowContext?.entityId]);
}

export function useStudioPublishReturnEntry(ports: Pick<StudioProjectLifecyclePorts,
  | 'setContentMode'
  | 'setShowProjects'
  | 'setPublished'
  | 'setStepIdx'
  | 'setProjects'
  | 'adoptEditorProjectRevision'
  | 'applySpec'
  | 'setProjectId'
  | 'setProjectTitle'
  | 'setModeNotice'
>) {
  useEffect(() => {
    const {
      setContentMode, setShowProjects, setPublished,
      setStepIdx, setProjects, adoptEditorProjectRevision,
      applySpec, setProjectId, setProjectTitle,
      setModeNotice,
    } = ports;

    let raw = '';
    try {
      raw = localStorage.getItem(PUBLISH_RETURN_PREVIEW_KEY) || '';
      if (raw) localStorage.removeItem(PUBLISH_RETURN_PREVIEW_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    const goPreviewStep = () => {
      const previewIndex = STEPS.findIndex(item => item.id === 'preview');
      setContentMode('video');
      setShowProjects(false);
      setPublished(false);
      window.setTimeout(() => setStepIdx(previewIndex >= 0 ? previewIndex : Math.max(0, STEPS.length - 1)), 0);
    };
    try {
      const state = JSON.parse(raw) as { at?: number; projectId?: string };
      if (!state?.at || Date.now() - state.at > PUBLISH_RETURN_PREVIEW_TTL) return;
      const targetProjectId = String(state.projectId || '').trim();
      if (!targetProjectId) {
        goPreviewStep();
        return;
      }
      void studioApi.listProjects().then(list => {
        setProjects(list);
        const project = list.find(item => item.id === targetProjectId);
        if (project) {
          adoptEditorProjectRevision(project);
          applySpec(project.spec);
          setProjectId(project.status === 'template' ? null : project.id);
          setProjectTitle(project.status === 'template' ? `${project.title} · 副本` : project.title);
        }
        goPreviewStep();
        setModeNotice(project ? '已从发布设置返回素材成片预览。' : '未找到来源项目，已返回当前素材成片预览。');
      }).catch(() => {
        goPreviewStep();
        setModeNotice('项目列表读取失败，已返回当前素材成片预览。');
      });
    } catch {
      goPreviewStep();
    }
  }, []);
}

export function useStudioInspirationProjectEntry(ports: Pick<StudioProjectLifecyclePorts,
  | 'socialContentTaskId'
  | 'setSourceDraftCheckPending'
  | 'setVideoKickoff'
  | 'setProjects'
  | 'setExistingSourceDraftPrompt'
  | 'setDuration'
  | 'setContentMode'
  | 'setMode'
  | 'setPlatform'
  | 'setRatio'
  | 'setActiveFolder'
  | 'setProjectTitle'
  | 'setProductOptions'
  | 'setSelectedProductIds'
  | 'setProductInfo'
  | 'setModeNotice'
  | 'setStepIdx'
  | 'autoGen'
  | 'setUseReferenceVoiceStyle'
  | 'setReferenceVoiceStrength'
  | 'setTtsEmotion'
  | 'setTtsEmotionIntensity'
  | 'setTtsSpeed'
  | 'setScript'
  | 'setVoiceoverLines'
  | 'setVoiceDrafts'
  | 'setScriptView'
  | 'setModeScripts'
  | 'setPendingRealCloneGeneration'
  | 'setScriptType'
  | 'setLang'
  | 'setProvider'
  | 'setCanvasView'
>) {
  useEffect(() => {
    const {
      socialContentTaskId, setSourceDraftCheckPending, setVideoKickoff,
      setProjects, setExistingSourceDraftPrompt, setDuration,
      setContentMode, setMode, setPlatform,
      setRatio, setActiveFolder, setProjectTitle,
      setProductOptions, setSelectedProductIds, setProductInfo,
      setModeNotice, setStepIdx, autoGen,
      setUseReferenceVoiceStyle, setReferenceVoiceStrength, setTtsEmotion,
      setTtsEmotionIntensity, setTtsSpeed, setScript,
      setVoiceoverLines, setVoiceDrafts, setScriptView,
      setModeScripts, setPendingRealCloneGeneration, setScriptType,
      setLang, setProvider, setCanvasView,
    } = ports;

    if (socialContentTaskId) { setSourceDraftCheckPending(false); return; }
    let raw = '';
    try {
      raw = localStorage.getItem('ow_video_kickoff') || localStorage.getItem('ow_seedance_kickoff') || '';
      if (raw) {
        localStorage.removeItem('ow_video_kickoff');
        localStorage.removeItem('ow_seedance_kickoff');
      }
    } catch { /* ignore */ }
    if (!raw) {
      setSourceDraftCheckPending(false);
      return;
    }
    try {
      const kickoff = JSON.parse(raw) as VideoKickoff;
      setVideoKickoff(kickoff);
      void studioApi.listProjects().then(items => {
        const matchingDrafts = items
          .filter(item => item.status === 'draft' && projectMatchesKickoff(item, kickoff))
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        setProjects(items);
        if (matchingDrafts[0]) {
          setExistingSourceDraftPrompt({
            project: matchingDrafts[0],
            matchCount: matchingDrafts.length,
            title: kickoff.video?.title || kickoff.generatedVideo?.title || matchingDrafts[0].title,
            poster: kickoff.generatedVideo?.poster
              || kickoff.video?.aiAnalysis?.materialPoster
              || kickoff.video?.thumbnail
              || '',
          });
        } else {
          setSourceDraftCheckPending(false);
        }
      }).catch(() => setSourceDraftCheckPending(false));
      if (kickoff.video?.duration && kickoff.video.duration > 0) setDuration(+kickoff.video.duration.toFixed(1));
      const fromInspiration = kickoff.source === 'inspiration_analysis';
      const fromMaterialImage = kickoff.source === 'material_library' && kickoff.video?.contentFormat === 'image';
      const fromImagePost = kickoff.source === 'inspiration_image_post' || fromMaterialImage || (kickoff.source !== 'material_library' && kickoff.video?.contentFormat === 'image');
      if (fromImagePost) {
        setContentMode('poster');
        setMode(fromMaterialImage ? 'material' : 'clone');
        setPlatform(kickoff.video?.platform === 'instagram' ? 'instagram' : 'facebook');
        setRatio('4:5');
        setActiveFolder(fromMaterialImage ? 'recommend' : 'hot');
        setProjectTitle(fromMaterialImage
          ? (kickoff.video?.title ? `图片制作 · ${kickoff.video.title}` : '新图片内容')
          : (kickoff.video?.title ? `竞品图文获客内容包 · ${kickoff.video.title}` : '竞品图文获客内容包'));
        const kickoffOption = kickoff.productInfo ? productOptionFromInfo(kickoff.productInfo) : null;
        if (kickoffOption) {
          setProductOptions(current => current.some(item => item.id === kickoffOption.id)
            ? current.map(item => item.id === kickoffOption.id ? kickoffOption : item)
            : [kickoffOption, ...current]);
          setSelectedProductIds([kickoffOption.id]);
        }
        if (kickoff.productInfo) setProductInfo(kickoff.productInfo);
        setModeNotice(fromMaterialImage
          ? (kickoff.generatedVideo?.material
            ? '已带入素材库图片。请确认产品和用途，系统会优先使用已绑定的精准产品图，再补充场景或证明素材。'
            : '已从素材库进入图片制作。先选择企业产品，再由系统推荐最多 3 张产品、场景和证明参考图。')
          : kickoff.video?.aiAnalysis?.imageEvidence?.observedFacts?.length
            ? '已带入完整轮播证据。系统将只保留可观察的布局、信息层级和表达方式，用企业中心产品与真实能力生成三组连续获客内容。'
            : '这条图文还没有完整轮播证据，请返回灵感中心点击“重新分析完整轮播”后再生成。');
        setStepIdx(1);
        autoGen.current = true;
        return;
      }
      if (fromInspiration) {
        const profile = referenceVoiceProfile(kickoff);
        if (profile.available) {
          setUseReferenceVoiceStyle(true);
          setReferenceVoiceStrength('balanced');
          setTtsEmotion(`${profile.emotion}；保留节奏结构，重新表达全部台词`);
          setTtsEmotionIntensity(78);
          setTtsSpeed(profile.baseSpeed);
        }
        setScript('');
        setVoiceoverLines('');
        setVoiceDrafts({});
        setScriptView('timestamp');
        setModeScripts([]);
        const kickoffOption = kickoff.productInfo ? productOptionFromInfo(kickoff.productInfo) : null;
        if (kickoffOption) {
          setProductOptions(current => current.some(item => item.id === kickoffOption.id)
            ? current.map(item => item.id === kickoffOption.id ? kickoffOption : item)
            : [kickoffOption, ...current]);
          setSelectedProductIds([kickoffOption.id]);
        }
        if (kickoff.productInfo && !hasIncompleteReferenceAnalysis(kickoff)) {
          setModeNotice('');
          setPendingRealCloneGeneration(false);
        } else if (hasIncompleteReferenceAnalysis(kickoff)) {
          const analyzedUntil = referenceAnalysisEnd(kickoff);
          setModeNotice(`原视频约 ${Number(kickoff.video?.duration || 0).toFixed(1)} 秒，当前逐镜结构覆盖到 ${analyzedUntil.toFixed(1)} 秒，但尚未达到脚本生成的逐镜质量要求。请返回灵感中心复核原片与口播证据。`);
          setPendingRealCloneGeneration(false);
        } else {
          setModeNotice('已带入对标视频分析，请先选择企业中心产品后生成脚本。');
          setPendingRealCloneGeneration(false);
        }
      } else if (kickoff.script) {
        setScript(kickoff.script);
      }
      if (kickoff.scriptType === 'voiceover' || kickoff.scriptType === 'storyboard') setScriptType(kickoff.scriptType);
      if (kickoff.language) setLang(kickoff.language);
      if (kickoff.productInfo) setProductInfo(kickoff.productInfo);
      if (kickoff.video?.platform) setPlatform(kickoff.video.platform);
      setProvider('qwen');
      const kickoffMode: ModeCard['id'] = fromInspiration ? 'clone' : 'material';
      setMode(kickoffMode);
      setActiveFolder(kickoff.generatedVideo ? 'upload' : 'hot');
      setProjectTitle(draftTitleForMode(kickoffMode, kickoff.video?.title || kickoff.generatedVideo?.title || ''));
      setStepIdx(fromInspiration || kickoff.source === 'material_library'
        ? 0
        : STEPS.findIndex(s => s.id === 'material'));
      if (fromInspiration) setCanvasView('reference');
      autoGen.current = true;
    } catch {
      setSourceDraftCheckPending(false);
    }
  }, []);
}
