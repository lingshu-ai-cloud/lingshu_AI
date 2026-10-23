import { Button } from 'antd';
import { studioSpecHasMeaningfulContent } from '../../lib/studioProjectContext';
import { studioApi, type StudioProject } from '../../lib/studioApi';
import { completeDemoStep } from '../../lib/demoProgress';
import { productionApi } from '../../lib/productionApi';
import { studioAutosaveFingerprint, studioDraftChanged } from '../../lib/studioAutosave';
import type { StudioProjectLifecyclePorts } from './studioProjectLifecyclePorts.js';

export function createStudioProjectPersistence(ports: Pick<StudioProjectLifecyclePorts,
  | 'projectRevisionRef'
  | 'projectRevisionProjectIdRef'
  | 'projectSaveConflictRef'
  | 'projectHydrationPendingRef'
  | 'applySpec'
  | 'currentProjectRef'
  | 'setProjectId'
  | 'setProjectTitle'
  | 'setProjects'
  | 'notification'
  | 'setAutosaveError'
  | 'setAutosaveStatus'
  | 'setLastAutosavedAt'
  | 'setModeNotice'
  | 'setProjectHydrationRevision'
  | 'projectDeleteInFlightRef'
  | 'frozenStudioSpecRef'
  | 'managedProductionProjectRef'
  | 'sourceDraftCheckPending'
  | 'existingSourceDraftPrompt'
  | 'workflowProjectSelectionPending'
  | 'modeActionLoading'
  | 'scriptLoading'
  | 'materialSelectLoading'
  | 'coverLoading'
  | 'rendering'
  | 'batchRenderingLangs'
  | 'posterLoading'
  | 'captionLoading'
  | 'voiceDraftLoading'
  | 'ttsLoading'
  | 'agentProduction'
  | 'collectSpec'
  | 'projectId'
  | 'projectTitle'
  | 'lastSavedAutosaveFingerprintRef'
  | 'modeScripts'
  | 'script'
  | 'contentMode'
  | 'posterJsonText'
  | 'posterGenerationIsVerified'
  | 'posterDraft'
  | 'autosaveInFlightRef'
  | 'autosavePendingRef'
  | 'setSavingProj'
  | 'cover'
  | 'socialDigitalHumanPlans'
  | 'setProductionPlans'
  | 'workflowContext'
  | 'setSavedTick'
  | 'autosaveSnapshotRef'
>) {

  const adoptEditorProjectRevision = (project: StudioProject) => {
    const {
      projectRevisionRef, projectRevisionProjectIdRef,
    } = ports;

    studioApi.adoptProjectRevision(project);
    projectRevisionRef.current = project.updatedAt;
    projectRevisionProjectIdRef.current = project.id;
  };

  const saveStudioProjectVersioned = async (input: Parameters<typeof studioApi.saveProject>[0]) => {
    const {
      projectRevisionProjectIdRef, projectRevisionRef, currentProjectRef,
    } = ports;

    const expectedProjectId = currentProjectRef.current;
    const targetProjectId = input.id;
    const result = await studioApi.saveProject({
      ...input,
      ...(!input.baseUpdatedAt && targetProjectId
        && projectRevisionProjectIdRef.current === targetProjectId && projectRevisionRef.current
        ? { baseUpdatedAt: projectRevisionRef.current }
        : {}),
    });
    if (currentProjectRef.current !== expectedProjectId) return result;
    if (result.ok && result.project?.id) {
      projectRevisionRef.current = result.project.updatedAt;
      projectRevisionProjectIdRef.current = result.project.id;
    } else if (result.recovery === 'reload_required' && result.project?.id) {
      showProjectSaveConflict(result.project, input.spec);
    }
    return result;
  };

  const reloadLatestProjectAfterConflict = async () => {
    const {
      projectSaveConflictRef, projectHydrationPendingRef, applySpec,
      currentProjectRef, setProjectId, setProjectTitle,
      setProjects, notification, setAutosaveError,
      setAutosaveStatus, setLastAutosavedAt, setModeNotice,
      setProjectHydrationRevision,
    } = ports;

    const pending = projectSaveConflictRef.current;
    if (!pending) return;
    try {
      const latest = await studioApi.getProject(pending.project.id);
      adoptEditorProjectRevision(latest);
      projectHydrationPendingRef.current = true;
      applySpec(latest.spec);
      currentProjectRef.current = latest.id;
      setProjectId(latest.id);
      setProjectTitle(latest.title);
      setProjects(current => [latest, ...current.filter(item => item.id !== latest.id)]);
      projectSaveConflictRef.current = null;
      notification.destroy('studio-project-save-conflict');
      setAutosaveError('');
      setAutosaveStatus('saved');
      setLastAutosavedAt(new Date());
      setModeNotice('已按你的选择载入后台最新版本；冲突期间的本页修改没有自动覆盖生产结果。');
      window.setTimeout(() => {
        projectHydrationPendingRef.current = false;
        setProjectHydrationRevision(value => value + 1);
      }, 0);
    } catch (error) {
      setModeNotice(error instanceof Error ? `最新草稿载入失败：${error.message}` : '最新草稿载入失败，请稍后重试。');
    }
  };

  const showProjectSaveConflict = (project: StudioProject, localSpec: Record<string, unknown>) => {
    const {
      projectSaveConflictRef, setAutosaveStatus, setAutosaveError,
      notification,
    } = ports;

    projectSaveConflictRef.current = { project, localSpec: structuredClone(localSpec) };
    setAutosaveStatus('error');
    setAutosaveError('后台项目已更新，当前修改尚未保存');
    notification.warning({
      key: 'studio-project-save-conflict',
      message: '检测到后台生产结果更新',
      description: '当前页面的编辑仍保留，自动保存已暂停，没有覆盖后台结果。确认后再载入最新版本。',
      placement: 'top',
      duration: 0,
      btn: <Button size="small" type="primary" onClick={() => void reloadLatestProjectAfterConflict()}>载入最新版本</Button>,
    });
  };

  const saveProject = async (
    status: 'draft' | 'ready_for_approval' | 'published' | 'template' = 'draft',
    options: { silent?: boolean; allowDuringModeAction?: boolean; specOverrides?: Record<string, unknown>; onSavedProject?: (id: string) => void } = {},
  ) => {
    const {
      projectDeleteInFlightRef, setModeNotice, frozenStudioSpecRef,
      projectHydrationPendingRef, managedProductionProjectRef, projectSaveConflictRef,
      sourceDraftCheckPending, existingSourceDraftPrompt, workflowProjectSelectionPending,
      modeActionLoading, scriptLoading, materialSelectLoading,
      coverLoading, rendering, batchRenderingLangs,
      posterLoading, captionLoading, voiceDraftLoading,
      ttsLoading, agentProduction, collectSpec,
      currentProjectRef, projectId, projectTitle,
      lastSavedAutosaveFingerprintRef, modeScripts, script,
      contentMode, posterJsonText, posterGenerationIsVerified,
      posterDraft, autosaveInFlightRef, autosavePendingRef,
      setAutosaveError, setAutosaveStatus, setSavingProj,
      cover, projectRevisionProjectIdRef, projectRevisionRef,
      applySpec, setProjectHydrationRevision, setProjectId,
      setProjects, socialDigitalHumanPlans, setProductionPlans,
      workflowContext, setLastAutosavedAt, setSavedTick,
      autosaveSnapshotRef,
    } = ports;

    let expectedProjectId = currentProjectRef.current;
    const isCurrent = () => currentProjectRef.current === expectedProjectId;
    const silent = options.silent === true;
    if (projectDeleteInFlightRef.current) {
      if (!silent) setModeNotice('正在删除创作，请稍候。');
      return false;
    }
    if (frozenStudioSpecRef.current) {
      if (!silent) setModeNotice('当前是已冻结生产计划，请从原任务发起修订；浏览和刷新不会覆盖分镜或供应商记录。');
      return false;
    }
    if (projectHydrationPendingRef.current) {
      if (!silent) setModeNotice('正在恢复项目数据，请稍候再保存。');
      return false;
    }
    if (managedProductionProjectRef.current) {
      if (!silent) setModeNotice('该内容由自动任务管理。内容制作页不承载任务详情或流程修订，请返回数字员工任务现场处理。');
      return false;
    }
    if (projectSaveConflictRef.current) {
      if (!silent) showProjectSaveConflict(projectSaveConflictRef.current.project, projectSaveConflictRef.current.localSpec);
      return false;
    }
    if (silent && (sourceDraftCheckPending || existingSourceDraftPrompt)) return false;
    if (silent && workflowProjectSelectionPending) return false;
    if (silent && (
      (modeActionLoading && !options.allowDuringModeAction) || scriptLoading || materialSelectLoading || coverLoading
      || rendering || batchRenderingLangs || posterLoading || captionLoading
    )) return false;
    if (voiceDraftLoading || ttsLoading) {
      if (!silent) alert('多语字幕或配音仍在生成，请等待完成后再保存草稿。');
      return false;
    }
    if (agentProduction.active) return false;
    const nextSpec = { ...collectSpec(), ...options.specOverrides };
    const targetProjectId = status === 'template' ? null : currentProjectRef.current ?? projectId;
    const snapshotFingerprint = studioAutosaveFingerprint(targetProjectId, projectTitle, nextSpec);
    if (silent && !studioDraftChanged(lastSavedAutosaveFingerprintRef.current, snapshotFingerprint)) return true;
    if (!['draft', 'template'].includes(status)) {
      const invalidScript = modeScripts.find(item => {
        const provenance = String(item.generationProvenance || item.generationSource || '').toLowerCase();
        const quality = String(item.qualityStatus || '').toLowerCase();
        return provenance !== 'ai'
          || !quality
          || ['failed', 'rejected', 'fallback', 'unreviewed', 'needs_confirmation'].includes(quality)
          || item.publishable !== true;
      });
      const activeScriptHasVerifiedRecord = !script.trim() || modeScripts.some(item => (
        item.script.trim() === script.trim()
        && String(item.generationProvenance || item.generationSource || '').toLowerCase() === 'ai'
        && Boolean(item.qualityStatus)
        && !['failed', 'rejected', 'fallback', 'unreviewed', 'needs_confirmation'].includes(String(item.qualityStatus).toLowerCase())
        && item.publishable === true
      ));
      if ((contentMode === 'poster' && Boolean(posterJsonText.trim()) && !posterGenerationIsVerified) || invalidScript || (contentMode === 'video' && !activeScriptHasVerifiedRecord)) {
        const reason = contentMode === 'poster'
          ? posterDraft?.fieldsToConfirm?.length
            ? `图文仍有待确认商业字段：${posterDraft.fieldsToConfirm.join('、')}`
            : '图文尚未获得可发布的 AI 事实与质量校验结果'
          : invalidScript
            ? `${invalidScript.title || '脚本'}仍是失败、降级或待复核草稿`
            : '当前脚本缺少与正文一致的 AI 来源、质量和可发布记录';
        setModeNotice(`${reason}。已保留在当前编辑器中；请先保存为草稿，不能直接进入作品交付。`);
        return false;
      }
    }
    if (silent && !projectId && !studioSpecHasMeaningfulContent(nextSpec)) return false;
    if (autosaveInFlightRef.current) {
      autosavePendingRef.current = true;
      if (!silent) setModeNotice('当前草稿正在保存，已安排再次自动保存，请稍候。');
      return false;
    }
    autosaveInFlightRef.current = true;
    setAutosaveError('');
    if (silent) {
      setAutosaveStatus('saving');
    }
    else setSavingProj(true);
    try {
      const targetProjectId = status === 'template' ? undefined : currentProjectRef.current ?? projectId ?? undefined;
      const saved = await saveStudioProjectVersioned({
        id: targetProjectId,
        title: projectTitle.trim() || '未命名草稿',
        status,
        spec: nextSpec,
        thumbSeed: cover,
        ...(targetProjectId && projectRevisionProjectIdRef.current === targetProjectId && projectRevisionRef.current
          ? { baseUpdatedAt: projectRevisionRef.current }
          : {}),
      });
      if (!isCurrent()) return false;
      const { project } = saved;
      if (!saved.ok && saved.recovery === 'reload_required' && project?.id) {
        showProjectSaveConflict(project, nextSpec);
        return false;
      }
      if (!saved.ok) throw new Error(saved.error || '草稿保存失败，请重试；当前编辑仍保留在页面中。');
      if (!project?.id) throw new Error('草稿保存失败，请重试；当前编辑仍保留在页面中。');
      projectRevisionRef.current = project.updatedAt;
      projectRevisionProjectIdRef.current = project.id;
      if (saved.recoveredFromConflict) {
        projectHydrationPendingRef.current = true;
        applySpec(project.spec);
        setModeNotice('后台最新生产结果已与本页修改安全合并，当前页面已更新。');
        window.setTimeout(() => {
          if (!isCurrent()) return;
          projectHydrationPendingRef.current = false;
          setProjectHydrationRevision(value => value + 1);
        }, 0);
      }
      if (project?.id && status !== 'template') {
        lastSavedAutosaveFingerprintRef.current = studioAutosaveFingerprint(project.id, projectTitle, nextSpec);
        currentProjectRef.current = project.id; expectedProjectId = project.id;
        setProjectId(project.id);
        options.onSavedProject?.(project.id);
        setProjects(current => [project, ...current.filter(item => item.id !== project.id)]);
        if (socialDigitalHumanPlans.length) {
          const syncedPlans = await productionApi.syncAgentPlans(project.id);
          if (!isCurrent()) return false;
          setProductionPlans(current => [...syncedPlans, ...current.filter(item => !syncedPlans.some(synced => synced.id === item.id))]);
        }
        if (!workflowContext && new URLSearchParams(location.search).get('page') === 'smartAssets') {
          const url = new URL(location.href);
          url.searchParams.set('project', project.id);
          history.replaceState(history.state, '', url);
        }
      }
      setAutosaveStatus('saved');
      setLastAutosavedAt(new Date());
      if (!silent) {
        completeDemoStep('traffic');
        setSavedTick(true);
        setTimeout(() => { if (isCurrent()) setSavedTick(false); }, 1800);
      }
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      setAutosaveError(error instanceof Error ? error.message : '草稿保存失败，请检查网络后重试。');
      setAutosaveStatus('error');
      if (!silent) throw error;
      console.warn('[AiCreateStudio] autosave failed', error);
      return false;
    } finally {
      autosaveInFlightRef.current = false;
      if (autosavePendingRef.current) {
        autosavePendingRef.current = false;
        queueMicrotask(() => { void autosaveSnapshotRef.current(); });
      }
      if (!silent) setSavingProj(false);
    }
  };

  const commitProjectTitle = async () => {
    const {
      projectTitle, setProjectTitle, managedProductionProjectRef,
      frozenStudioSpecRef, setModeNotice, currentProjectRef,
      projectId, setAutosaveStatus, setAutosaveError,
      setSavingProj, workflowContext, setProjects,
      setLastAutosavedAt,
    } = ports;

    const normalizedTitle = projectTitle.trim().slice(0, 120) || '未命名草稿';
    if (normalizedTitle !== projectTitle) setProjectTitle(normalizedTitle);
    // Ordinary drafts can use the full editor save. Managed/frozen production
    // projects deliberately block that path, so rename them with a fresh CAS
    // snapshot and preserve every production field byte-for-byte.
    if (!managedProductionProjectRef.current && !frozenStudioSpecRef.current) {
      try {
        await saveProject('draft');
      } catch (error) {
        setModeNotice(error instanceof Error ? error.message : '草稿名称保存失败');
      }
      return;
    }
    const id = currentProjectRef.current ?? projectId;
    if (!id) {
      setAutosaveStatus('error');
      setAutosaveError('项目尚未载入，草稿名称暂时无法保存');
      return;
    }
    setSavingProj(true);
    setAutosaveStatus('saving');
    setAutosaveError('');
    try {
      const current = await studioApi.getProject(id, workflowContext ? {
        runId: workflowContext.runId,
        taskId: workflowContext.taskId,
      } : undefined);
      const saved = await saveStudioProjectVersioned({
        id: current.id,
        title: normalizedTitle,
        status: current.status,
        spec: current.spec,
        thumbSeed: current.thumbSeed,
        baseUpdatedAt: current.updatedAt,
      });
      if (!saved.ok || !saved.project) throw new Error(saved.error || '草稿名称保存失败');
      const renamedProject = saved.project;
      setProjectTitle(renamedProject.title);
      setProjects(existing => [renamedProject, ...existing.filter(item => item.id !== renamedProject.id)]);
      setAutosaveStatus('saved');
      setLastAutosavedAt(new Date());
    } catch (error) {
      const message = error instanceof Error ? error.message : '草稿名称保存失败';
      setAutosaveError(message);
      setAutosaveStatus('error');
      setModeNotice(message);
    } finally {
      setSavingProj(false);
    }
  };

  return { adoptEditorProjectRevision, saveStudioProjectVersioned, reloadLatestProjectAfterConflict, showProjectSaveConflict, saveProject, commitProjectTitle };
}
