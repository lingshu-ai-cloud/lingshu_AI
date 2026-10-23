import { resolveStudioWorkflowProjectEntry, withoutStudioWorkflowContext } from '../../lib/studioProjectContext';
import { studioApi, type StudioProject, type VariationBatch } from '../../lib/studioApi';
import { CANVA_COVER_RETURN_KEY } from './studioWorkspaceConfig.js';
import type { CanvaCoverReturnState, VariationStrategy } from './studioWorkspaceContracts.js';
import type { StudioProjectLifecyclePorts } from './studioProjectLifecyclePorts.js';

export function createStudioProjectWorkspaceActions(ports: Pick<StudioProjectLifecyclePorts,
  | 'coverUrl'
  | 'projectId'
  | 'projectTitle'
  | 'collectSpec'
  | 'setShowProjects'
  | 'workflowContext'
  | 'setProjects'
  | 'setVariationBatches'
  | 'loadProject'
  | 'setModeNotice'
  | 'setWorkflowProjectSelectionPending'
  | 'platform'
  | 'ratio'
  | 'duration'
  | 'productOptions'
  | 'saveStudioProjectVersioned'
  | 'applySpec'
  | 'setScript'
  | 'setVoiceoverLines'
  | 'setVoiceDrafts'
  | 'setModeScripts'
  | 'setActiveModeScriptId'
  | 'setSelected'
  | 'setScriptRecommendedMaterialIds'
  | 'setStoryboardAssignments'
  | 'setStoryboardSourcePlans'
  | 'setVoiceoverUrl'
  | 'setVoiceoverAudios'
  | 'setAlignedCuesByLang'
  | 'setLanguageRenderOutputs'
  | 'setBgm'
  | 'setCover'
  | 'setCoverUrl'
  | 'setCapturedCoverFrameUrl'
  | 'setCoverTimelineCaptureMode'
  | 'setCaption'
  | 'setClipEdits'
  | 'setRendered'
  | 'setPosterDraft'
  | 'setLeadContentPackage'
  | 'setPosterJsonText'
  | 'setPosterImageUrl'
  | 'setPosterImageMaterialId'
  | 'setPosterImageReviewStatus'
  | 'setProjectId'
  | 'setProjectTitle'
  | 'setStepIdx'
  | 'setSavedTick'
  | 'voiceDraftLoading'
  | 'ttsLoading'
  | 'savingProj'
  | 'setSavingProj'
  | 'autoGen'
  | 'setPublished'
  | 'projectDeleteInFlightRef'
  | 'autosaveInFlightRef'
  | 'message'
  | 'frozenStudioSpecRef'
  | 'currentProjectRef'
  | 'projectRevisionRef'
  | 'projectRevisionProjectIdRef'
  | 'projectSaveConflictRef'
  | 'setBoundProductionSnapshot'
  | 'setProjectWorkflowContext'
  | 'openCreationHome'
>) {

  const rememberCanvaCoverReturn = (nextCoverUrl: string | null = ports.coverUrl) => {
    const {
      projectId, projectTitle, collectSpec,
    } = ports;

    try {
      const payload: CanvaCoverReturnState = {
        at: Date.now(),
        stepId: 'cover',
        projectId,
        projectTitle,
        coverUrl: nextCoverUrl,
        spec: collectSpec(),
      };
      localStorage.setItem(CANVA_COVER_RETURN_KEY, JSON.stringify(payload));
    } catch {
      // Some embedded browsers can block storage; the new window still keeps the current page alive.
    }
  };

  const openProjects = async () => {
    const {
      setShowProjects, workflowContext, setProjects,
      setVariationBatches, loadProject, setModeNotice,
      setWorkflowProjectSelectionPending,
    } = ports;

    setShowProjects(true);
    if (workflowContext?.entityId) {
      try {
        const project = await studioApi.getProject(workflowContext.entityId, {
          runId: workflowContext.runId,
          taskId: workflowContext.taskId,
        });
        setProjects([project]);
        setVariationBatches([]);
        loadProject(project);
        setShowProjects(false);
      } catch (error) {
        setProjects([]);
        setVariationBatches([]);
        const reason = error instanceof Error ? error.message : '项目读取失败';
        setModeNotice(`无法打开当前任务的内容项目：${reason}`);
      }
      return;
    }
    const [nextProjects, nextBatches] = await Promise.all([studioApi.listProjects(), studioApi.listVariationBatches()]);
    if (workflowContext?.runId && workflowContext?.taskId) {
      const entry = resolveStudioWorkflowProjectEntry(nextProjects, workflowContext);
      setProjects(entry.projects);
      setVariationBatches([]);
      if (entry.project) {
        setWorkflowProjectSelectionPending(false);
        loadProject(entry.project);
        setShowProjects(false);
      } else {
        setWorkflowProjectSelectionPending(true);
        setModeNotice(entry.projects.length
          ? `当前任务共有 ${entry.projects.length} 个内容项目，请选择要查看的项目。`
          : '当前任务尚未创建可用的内容项目。');
      }
      return;
    }
    setProjects(nextProjects); setVariationBatches(nextBatches);
  };

  const reviewVariationItem = async (batchId: string, itemId: string, status: 'approved' | 'rejected') => {
    const {
      setVariationBatches,
    } = ports;

    await studioApi.updateVariationItem(batchId, itemId, { status });
    setVariationBatches(await studioApi.listVariationBatches());
  };

  const reuseVariationBatch = async (batch: VariationBatch) => {
    const {
      platform, ratio, duration,
      productOptions, saveStudioProjectVersioned, applySpec,
      setScript, setVoiceoverLines, setVoiceDrafts,
      setModeScripts, setActiveModeScriptId, setSelected,
      setScriptRecommendedMaterialIds, setStoryboardAssignments, setStoryboardSourcePlans,
      setVoiceoverUrl, setVoiceoverAudios, setAlignedCuesByLang,
      setLanguageRenderOutputs, setBgm, setCover,
      setCoverUrl, setCapturedCoverFrameUrl, setCoverTimelineCaptureMode,
      setCaption, setClipEdits, setRendered,
      setPosterDraft, setLeadContentPackage, setPosterJsonText,
      setPosterImageUrl, setPosterImageMaterialId, setPosterImageReviewStatus,
      setProjectId, setProjectTitle, setProjects,
      setStepIdx, setShowProjects, setSavedTick,
    } = ports;

    const inferredDimensions = ['product', 'person', 'scene', 'language', 'hook'].reduce<Record<string, string[]>>((result, key) => {
      result[key] = [...new Set(batch.items.map(item => item.variables[key]).filter(Boolean))];
      return result;
    }, {});
    const dimensions = batch.plan?.dimensions || inferredDimensions;
    const nextStrategy = ['remix', 'recreate', 'hybrid'].includes(String(batch.plan?.strategy)) ? batch.plan!.strategy as VariationStrategy : 'hybrid';
    const nextPlatform = String(batch.plan?.platform || platform);
    const nextRatio = String(batch.plan?.ratio || ratio);
    const nextDuration = Math.max(1, Number(batch.plan?.duration) || Math.round(batch.estimatedCostCny / Math.max(1, batch.items.length) / 1.5) || duration);
    const nextMax = Math.max(1, Number(batch.plan?.maxItems) || batch.items.length || 20);
    const nextProductIds = (dimensions.product || []).filter(id => productOptions.some(option => option.id === id));
    const nextTitle = `${batch.title.replace(/\s*·\s*复用\s*\d*$/, '')} · 复用`;
    const cleanSpec: Record<string, unknown> = {
      mode: 'clone', contentMode: 'video', platform: nextPlatform, ratio: nextRatio, duration: nextDuration,
      productInfo: batch.plan?.productInfo || '', productSelectMode: batch.plan?.productSelectMode || 'single',
      audience: batch.plan?.audience || '', sellingPoints: batch.plan?.sellingPoints || '', tone: batch.plan?.tone || '高转化 · 口语化',
      lang: batch.plan?.language || 'zh', provider: 'qwen',
      variationStrategy: nextStrategy,
      variationPeople: (dimensions.person || ['原人物']).join('，'),
      variationScenes: (dimensions.scene || ['原场景']).join('，'),
      variationLanguages: (dimensions.language || ['中文']).join('，'),
      variationHooks: (dimensions.hook || ['原钩子']).join('，'),
      variationMax: nextMax, selectedProductIds: nextProductIds,
      script: '', selected: [], scriptRecommendedMaterialIds: [], storyboardAssignments: {}, storyboardSourcePlans: {},
      voiceDrafts: {}, voiceoverAudios: {}, alignedCuesByLang: {}, languageRenderOutputs: {}, clipEdits: {},
      bgm: '', cover: '', coverTitle: '', caption: '', posterJsonText: '', posterImageUrl: '',
    };
    const saved = await saveStudioProjectVersioned({ title: nextTitle, status: 'draft', spec: cleanSpec });
    if (!saved.ok || !saved.project) return;
    applySpec(saved.project.spec);
    setScript(''); setVoiceoverLines(''); setVoiceDrafts({}); setModeScripts([]); setActiveModeScriptId('');
    setSelected([]); setScriptRecommendedMaterialIds([]); setStoryboardAssignments({}); setStoryboardSourcePlans({});
    setVoiceoverUrl(null); setVoiceoverAudios({}); setAlignedCuesByLang({}); setLanguageRenderOutputs({});
    setBgm(''); setCover(''); setCoverUrl(null); setCapturedCoverFrameUrl(''); setCoverTimelineCaptureMode(false); setCaption(''); setClipEdits({}); setRendered(false);
    setPosterDraft(null); setLeadContentPackage(null); setPosterJsonText(''); setPosterImageUrl(''); setPosterImageMaterialId(''); setPosterImageReviewStatus('none');
    setProjectId(saved.project.id); setProjectTitle(nextTitle); setProjects(current => [saved.project, ...current.filter(item => item.id !== saved.project.id)]);
    setStepIdx(0); setShowProjects(false); setSavedTick(true); window.setTimeout(() => setSavedTick(false), 1800);
  };

  const reuseProject = async (p: StudioProject) => {
    const {
      voiceDraftLoading, ttsLoading, savingProj,
      setSavingProj, saveStudioProjectVersioned, applySpec,
      setProjectId, setProjectTitle, setProjects,
      autoGen, setStepIdx, setShowProjects,
      setPublished, setSavedTick,
    } = ports;

    if (voiceDraftLoading || ttsLoading || savingProj) return;
    setSavingProj(true);
    try {
      const baseTitle = p.title.replace(/\s*·\s*复用\s*\d*$/, '').trim() || '历史作品集';
      const nextTitle = `${baseTitle} · 复用`;
      const clonedSpec = withoutStudioWorkflowContext(
        JSON.parse(JSON.stringify(p.spec || {})) as Record<string, unknown>,
      );
      const saved = await saveStudioProjectVersioned({
        title: nextTitle,
        status: 'draft',
        spec: clonedSpec,
        thumbSeed: p.thumbSeed,
      });
      if (!saved.ok || !saved.project) throw new Error('复用失败，请稍后重试。');
      applySpec(saved.project.spec);
      setProjectId(saved.project.id);
      setProjectTitle(saved.project.title);
      setProjects(current => [saved.project, ...current.filter(item => item.id !== saved.project.id)]);
      autoGen.current = true;
      setStepIdx(0);
      setShowProjects(false);
      setPublished(false);
      setSavedTick(true);
      window.setTimeout(() => setSavedTick(false), 1800);
    } catch (err: any) {
      alert(err?.message || '复用失败，请稍后重试。');
    } finally {
      setSavingProj(false);
    }
  };

  const removeProject = async (id: string) => {
    const {
      projectDeleteInFlightRef, projectId, savingProj,
      autosaveInFlightRef, message, setProjects,
      frozenStudioSpecRef, currentProjectRef, projectRevisionRef,
      projectRevisionProjectIdRef, projectSaveConflictRef, setBoundProductionSnapshot,
      setProjectId, setProjectWorkflowContext, setShowProjects,
      openCreationHome,
    } = ports;

    if (projectDeleteInFlightRef.current) return;
    if (id === projectId && (savingProj || autosaveInFlightRef.current)) {
      const reason = '当前创作正在保存，请保存完成后再删除。';
      message.warning(reason);
      throw new Error(reason);
    }
    projectDeleteInFlightRef.current = id;
    try {
      const result = await studioApi.deleteProject(id);
      if (!result.ok) {
        const reason = result.error || '删除失败，请稍后重试';
        message.error(reason);
        throw new Error(reason);
      }
      setProjects(items => items.filter(item => item.id !== id));
      if (projectId === id) {
        frozenStudioSpecRef.current = null;
        currentProjectRef.current = null;
        projectRevisionRef.current = undefined;
        projectRevisionProjectIdRef.current = undefined;
        projectSaveConflictRef.current = null;
        setBoundProductionSnapshot(null);
        setProjectId(null);
        setProjectWorkflowContext(null);
        setShowProjects(false);
        openCreationHome(false);
      }
      message.success('创作已删除');
    } finally {
      projectDeleteInFlightRef.current = null;
    }
  };

  return { rememberCanvaCoverReturn, openProjects, reviewVariationItem, reuseVariationBatch, reuseProject, removeProject };
}
