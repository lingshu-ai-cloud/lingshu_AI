import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CreateSocialContentTaskInput,
  RegisterSocialPublicationInput,
  SocialContentArtifact,
  SocialContentFile,
  SocialContentTaskPage,
  SocialContentTaskDetail,
  SocialContentWorkspace,
  SocialWorkPackageKind,
  SubmitSocialMetricsInput,
} from '../../../shared/contracts/socialContentWorkflow';
import { socialContentMaterialPolicy } from '../../../shared/socialContentMaterialPolicy';
import { socialContentApi, type SocialContentUploadResult } from '../../lib/socialContentApi';
import { readActiveSocialContentTaskId, setActiveSocialContentTaskId } from '../../lib/socialContentContext';
import type { SocialContentDraft } from '../../lib/socialContentModel';
import { mergeSocialContentTaskSummaries, restoreSavedSocialContentTask } from '../../lib/socialContentTaskPagination';
import { socialArtifactGenerationDisclosure } from '../../lib/socialArtifactGeneration';
import { splitBusinessList, splitLines } from './socialContentUi';

export type SocialContentSaveTarget =
  | { mode: 'new'; taskId: null; expectedVersion: null; attemptId: string }
  | { mode: 'edit'; taskId: string; expectedVersion: string; attemptId: string };

function requestInput(draft: SocialContentDraft): CreateSocialContentTaskInput {
  return {
    title: draft.title.trim(),
    objective: draft.primaryGoal.trim(),
    productRef: draft.productName.trim() || null,
    audience: draft.audience.trim() || null,
    markets: splitBusinessList(draft.market),
    languages: splitBusinessList(draft.language),
    platforms: draft.platforms,
    formats: draft.formats,
    aspectRatio: draft.aspectRatio || null,
    cadence: draft.cadence.trim() || null,
    requestedOutputCount: draft.mode === 'instant'
      ? 1
      : Number.isInteger(draft.quantity) && draft.quantity > 0 ? draft.quantity : null,
    weeklyBudgetCny: draft.weeklyBudgetCny,
    perItemBudgetCny: draft.perItemBudgetCny,
    retryReserveCny: draft.retryReserveCny,
    planningMode: draft.planningMode,
    shootingWindowMinutes: draft.shootingWindowMinutes,
    specialRequirements: draft.specialRequirements.trim() || null,
    dueAt: draft.desiredDeliveryAt ? new Date(`${draft.desiredDeliveryAt}T12:00:00`).toISOString() : null,
    brandNotes: draft.keyFacts.trim() || null,
    restrictions: splitLines(draft.prohibitedClaims),
    callToAction: draft.callToAction.trim() || null,
    productionMode: draft.productionMode,
    mode: draft.mode,
    themeId: draft.themeId || null,
    customTopic: draft.customTopic.trim() || null,
    topic: draft.topic.trim() || null,
  };
}

function taskListWith(workspace: SocialContentWorkspace, task: SocialContentTaskDetail) {
  return mergeSocialContentTaskSummaries(workspace.tasks, [task]);
}

function referenceLabel(value: string): string {
  try { return new URL(value).hostname.replace(/^www\./, ''); }
  catch { return '参考链接'; }
}

function operationSuffix(value: string): string {
  let left = 2166136261;
  let right = 5381;
  for (let index = 0; index < value.length; index += 1) {
    left = Math.imul(left ^ value.charCodeAt(index), 16777619);
    right = Math.imul(right, 33) ^ value.charCodeAt(index);
  }
  return `${(left >>> 0).toString(36)}${(right >>> 0).toString(36)}`;
}

export function useSocialContentWorkspace() {
  const mounted = useRef(true);
  const uploadedFiles = useRef(new WeakMap<File, { taskId: string; usage: SocialContentFile['usage']; upload: SocialContentUploadResult }>());
  const fileOperationIds = useRef(new WeakMap<File, string>());
  const readGeneration = useRef(0);
  const busyOperations = useRef(0);
  const loadingMoreTasksRef = useRef(false);
  const [workspace, setWorkspace] = useState<SocialContentWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMoreTasks, setLoadingMoreTasks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const fileOperationKey = useCallback((file: File): string => {
    const existing = fileOperationIds.current.get(file);
    if (existing) return existing;
    const next = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    fileOperationIds.current.set(file, next);
    return next;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const applyTask = useCallback((task: SocialContentTaskDetail) => {
    if (!mounted.current) return;
    readGeneration.current += 1;
    setActiveSocialContentTaskId(task.taskId);
    setWorkspace(current => {
      if (!current) return current;
      const knownTask = current.tasks.some(item => item.taskId === task.taskId);
      const totalItems = current.taskList.totalItems + (knownTask ? 0 : 1);
      return {
        ...current,
        currentTask: task,
        tasks: taskListWith(current, task),
        taskList: {
          ...current.taskList,
          totalItems,
          totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / current.taskList.perPage),
        },
      };
    });
  }, []);

  const load = useCallback(async () => {
    const generation = ++readGeneration.current;
    setError('');
    try {
      let next = await socialContentApi.getWorkspace();
      const savedTaskId = readActiveSocialContentTaskId();
      next = await restoreSavedSocialContentTask(next, savedTaskId, taskId => socialContentApi.getTask(taskId));
      if (!mounted.current || generation !== readGeneration.current) return;
      setWorkspace(next);
      setActiveSocialContentTaskId(next.currentTask?.taskId || null);
    } catch (loadError) {
      if (mounted.current && generation === readGeneration.current) setError(loadError instanceof Error ? loadError.message : '内容任务暂时无法读取');
    } finally {
      if (mounted.current && generation === readGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadMoreTasks = useCallback(async () => {
    const snapshot = workspace;
    if (!snapshot || loadingMoreTasksRef.current || snapshot.taskList.page >= snapshot.taskList.totalPages) return;
    const requestedPage = snapshot.taskList.page + 1;
    const generation = readGeneration.current;
    loadingMoreTasksRef.current = true;
    setLoadingMoreTasks(true);
    setError('');
    try {
      const [page, refreshedFirstPage] = await Promise.all([
        socialContentApi.listTasks(requestedPage, snapshot.taskList.perPage),
        socialContentApi.listTasks(1, snapshot.taskList.perPage).catch(() => null),
      ]);
      if (page.page !== requestedPage) throw new Error('任务列表更新异常，请重新加载');
      const validFirstPage: SocialContentTaskPage | null = refreshedFirstPage?.page === 1
        && refreshedFirstPage.perPage === page.perPage ? refreshedFirstPage : null;
      if (!mounted.current || generation !== readGeneration.current) return;
      setWorkspace(current => {
        if (!current || current.taskList.page >= page.page) return current;
        const latestPage = validFirstPage ?? page;
        return {
          ...current,
          tasks: mergeSocialContentTaskSummaries(current.tasks, [
            ...(validFirstPage?.items ?? []),
            ...page.items,
          ]),
          taskList: {
            page: page.page,
            perPage: latestPage.perPage,
            totalItems: latestPage.totalItems,
            totalPages: latestPage.totalPages,
          },
        };
      });
    } catch (loadError) {
      if (mounted.current && generation === readGeneration.current) {
        setError(loadError instanceof Error ? loadError.message : '更多内容任务暂时无法读取');
      }
    } finally {
      loadingMoreTasksRef.current = false;
      if (mounted.current) setLoadingMoreTasks(false);
    }
  }, [workspace]);

  const run = useCallback(async <T,>(
    operation: () => Promise<T>,
    success: string | ((result: T) => string),
  ): Promise<T> => {
    busyOperations.current += 1;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await operation();
      if (mounted.current) setNotice(typeof success === 'function' ? success(result) : success);
      return result;
    } catch (operationError) {
      if (mounted.current) setError(operationError instanceof Error ? operationError.message : '操作未完成，请重试');
      throw operationError;
    } finally {
      busyOperations.current = Math.max(0, busyOperations.current - 1);
      if (mounted.current) setBusy(busyOperations.current > 0);
    }
  }, []);

  const selectTask = useCallback((taskId: string) => {
    if (workspace?.currentTask?.taskId === taskId) return;
    void run(async () => {
      const generation = ++readGeneration.current;
      const task = await socialContentApi.getTask(taskId);
      if (generation !== readGeneration.current) return task;
      applyTask(task);
      return task;
    }, '已切换内容任务').catch(() => {});
  }, [workspace?.currentTask?.taskId, run, applyTask]);

  useEffect(() => {
    const task = workspace?.currentTask;
    if (!task || busy || !['producing', 'asset_review', 'packaging', 'attention'].includes(task.status)) return;
    let disposed = false;
    let polling = false;
    const refreshTask = async () => {
      if (disposed || polling || document.visibilityState === 'hidden') return;
      polling = true;
      const generation = ++readGeneration.current;
      try {
        const next = await socialContentApi.getTask(task.taskId);
        if (!disposed && generation === readGeneration.current) applyTask(next);
      } catch {
        // Keep the last confirmed state; the visible refresh action remains available.
      } finally {
        polling = false;
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshTask(); };
    const timer = window.setInterval(() => { void refreshTask(); }, 30_000 + Math.floor(Math.random() * 5_000));
    window.addEventListener('focus', refreshTask);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshTask);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [workspace?.currentTask?.taskId, workspace?.currentTask?.status, busy, applyTask]);

  const saveDraft = useCallback(async (
    draft: SocialContentDraft,
    files: File[],
    start: boolean,
    target: SocialContentSaveTarget,
    onTaskProgress?: (task: SocialContentTaskDetail) => void,
  ) => run(async () => {
    let task: SocialContentTaskDetail;
    let recoverTaskId = target.taskId;
    const applyProgress = (next: SocialContentTaskDetail) => {
      task = next;
      recoverTaskId = next.taskId;
      applyTask(next);
      onTaskProgress?.(next);
    };
    try {
      if (target.mode === 'edit') {
        task = await socialContentApi.updateTask(target.taskId, {
          expectedVersion: target.expectedVersion,
          changes: requestInput(draft),
        }, `${target.attemptId}:brief:${target.expectedVersion}`);
      } else if (draft.mode === 'weekly') {
        const planned = await socialContentApi.createWeeklyPlan({
          title: draft.title.trim(),
          objective: draft.primaryGoal.trim(),
          productRef: draft.productName.trim() || null,
          audience: draft.audience.trim() || null,
          items: [{
            title: draft.title.trim(),
            objective: draft.primaryGoal.trim(),
            themeId: draft.themeId || null,
            customTopic: draft.customTopic.trim() || null,
            topic: draft.topic.trim() || null,
          }],
        }, `${target.attemptId}:weekly-plan`);
        task = planned.tasks[0];
        if (!task) throw new Error('周计划未生成内容任务，请重试');
        task = await socialContentApi.updateTask(task.taskId, {
          expectedVersion: task.version,
          changes: requestInput(draft),
        }, `${target.attemptId}:brief:${task.version}`);
      } else {
        task = await socialContentApi.createTask(requestInput(draft), `${target.attemptId}:create`);
      }
      applyProgress(task);

      const sourceIdsToRemove = new Set(draft.removedSourceIds);
      if (!draft.keyFacts.trim()) {
        task.sources.filter(source => source.status === 'active' && source.kind === 'text_note' && source.sourceRef === 'brief:brand-notes')
          .forEach(source => sourceIdsToRemove.add(source.sourceId));
      }
      for (const sourceId of sourceIdsToRemove) {
        const source = task.sources.find(item => item.sourceId === sourceId && item.status === 'active');
        if (!source) continue;
        const result = await socialContentApi.removeSource(task.taskId, source.sourceId, task.version, `${target.attemptId}:source:remove:${operationSuffix(source.sourceId)}`);
        applyProgress(result.task);
      }

      const existingRefs = new Set(task.sources.filter(source => source.status === 'active').map(source => `${source.kind}:${source.sourceRef}`));
      for (const source of draft.selectedSources) {
        if (existingRefs.has(`${source.kind}:${source.sourceRef}`)) continue;
        const result = await socialContentApi.addSource(task.taskId, {
          kind: source.kind,
          sourceRef: source.sourceRef,
          sourceVersion: source.sourceVersion,
          label: source.label,
          purpose: '本次内容任务',
        }, `${target.attemptId}:source:selected:${operationSuffix(`${source.kind}:${source.sourceRef}:${source.sourceVersion || ''}`)}`);
        existingRefs.add(`${source.kind}:${source.sourceRef}`);
        applyProgress(result.task);
      }
      if (draft.keyFacts.trim() && !existingRefs.has('text_note:brief:brand-notes')) {
        const result = await socialContentApi.addSource(task.taskId, {
          kind: 'text_note',
          sourceRef: 'brief:brand-notes',
          label: '企业与产品关键信息',
          purpose: '本次内容任务',
        }, `${target.attemptId}:source:brand-notes`);
        existingRefs.add('text_note:brief:brand-notes');
        applyProgress(result.task);
      }
      for (const link of draft.referenceLinks) {
        if (existingRefs.has(`reference_link:${link}`)) continue;
        const result = await socialContentApi.addSource(task.taskId, {
          kind: 'reference_link',
          sourceRef: link,
          label: referenceLabel(link),
          purpose: '内容参考',
        }, `${target.attemptId}:source:link:${operationSuffix(link)}`);
        existingRefs.add(`reference_link:${link}`);
        applyProgress(result.task);
      }
      for (const file of files) {
        const fileKey = fileOperationKey(file);
        const cached = uploadedFiles.current.get(file);
        const upload = cached?.taskId === task.taskId && cached.usage === 'source'
          ? cached.upload
          : await socialContentApi.uploadFile(task.taskId, file, 'source', `${target.attemptId}:file:${fileKey}`);
        uploadedFiles.current.set(file, { taskId: task.taskId, usage: 'source', upload });
        const sourceRef = upload.material?.sourceRef || upload.file.fileRef;
        const sourceVersion = upload.material?.sourceVersion || upload.file.sha256;
        if (existingRefs.has(`material:${sourceRef}`)) continue;
        const result = await socialContentApi.addSource(task.taskId, {
          kind: 'material',
          sourceRef,
          sourceVersion,
          label: file.name,
          purpose: '本次内容任务',
        }, `${target.attemptId}:source:file:${fileKey}`);
        existingRefs.add(`material:${sourceRef}`);
        applyProgress(result.task);
      }

      const selections = (['industry_launch', 'content_rocket', 'task_express'] as SocialWorkPackageKind[]).map(kind => {
        const packageKey = draft.packageSelection[kind];
        const card = workspace?.catalog.find(item => item.kind === kind && item.packageKey === packageKey && item.available);
        if (!card) throw new Error('本次作业方案暂时不可用，请重新选择');
        return { kind, packageKey: card.packageKey, version: card.version };
      });
      task = await socialContentApi.selectPackages(task.taskId, { expectedVersion: task.version, selections }, `${target.attemptId}:packages:${task.version}`);
      applyProgress(task);
      if (start) {
        task = await socialContentApi.startTask(task.taskId, task.version, `${target.attemptId}:start:${task.version}`);
        applyProgress(task);
      }
      return task;
    } catch (error) {
      if (recoverTaskId) {
        try {
          const latest = await socialContentApi.getTask(recoverTaskId);
          applyProgress(latest);
          if (start && ['producing', 'asset_review', 'packaging', 'delivered', 'awaiting_publish', 'awaiting_metrics', 'reviewed'].includes(latest.status)) {
            return latest;
          }
        } catch {
          // Keep the last confirmed task version so the editor remains recoverable.
        }
      }
      throw error;
    }
  }, start
    ? (result: SocialContentTaskDetail) => result.status === 'attention'
      ? `任务已保留，请按提示补充${socialContentMaterialPolicy(result.theme?.themeId ?? null).subjectLabel}后继续`
      : '内容生产任务已进入执行队列'
    : '草稿已保存'), [workspace, run, applyTask, fileOperationKey]);

  const startTask = useCallback(async () => {
    const task = workspace?.currentTask;
    if (!task) return;
    return run(async () => {
      const next = await socialContentApi.startTask(task.taskId, task.version, `social:start:${operationSuffix(`${task.taskId}:${task.version}`)}`);
      applyTask(next);
      return next;
    }, (result: SocialContentTaskDetail) => result.status === 'attention'
      ? `任务已保留，请按提示补充${socialContentMaterialPolicy(result.theme?.themeId ?? null).subjectLabel}后继续`
      : '内容生产任务已进入执行队列');
  }, [workspace?.currentTask, run, applyTask]);

  const decideArtifact = useCallback(async (artifact: SocialContentArtifact, decision: 'approved' | 'changes_requested', note: string | null = null) => {
    const task = workspace?.currentTask;
    if (!task) return;
    await run(async () => {
      const input = {
        expectedVersion: artifact.version,
        decision,
        note,
      } as const;
      const result = await socialContentApi.decideArtifact(task.taskId, artifact.artifactId, input, `social:artifact:${operationSuffix(`${task.taskId}:${artifact.artifactId}:${JSON.stringify(input)}`)}`);
      applyTask(result.task);
      return result;
    }, decision === 'approved' ? '成品已确认' : '修改要求已提交');
  }, [workspace?.currentTask, run, applyTask]);

  const decideArtifactBatch = useCallback(async (decision: 'approved' | 'changes_requested', note: string | null = null) => {
    const task = workspace?.currentTask;
    if (!task) return;
    const artifacts = task.artifacts
      .filter(artifact => artifact.status === 'review_required')
      .filter(artifact => decision !== 'approved' || socialArtifactGenerationDisclosure(artifact).approvalAllowed)
      .map(artifact => ({ artifactId: artifact.artifactId, expectedVersion: artifact.version }));
    if (artifacts.length === 0) {
      setError('当前没有待验收内容');
      return;
    }
    await run(async () => {
      const input = { artifacts, decision, note } as const;
      const next = await socialContentApi.decideArtifactBatch(
        task.taskId,
        input,
        `social:artifact-batch:${operationSuffix(`${task.taskId}:${JSON.stringify(input)}`)}`,
      );
      applyTask(next);
      return next;
    }, decision === 'approved' ? `已确认 ${artifacts.length} 项内容` : `已退回 ${artifacts.length} 项内容`);
  }, [workspace?.currentTask, run, applyTask]);

  const createDeliveryPackage = useCallback(async () => {
    const task = workspace?.currentTask;
    if (!task) return;
    const artifactIds = task.artifacts
      .filter(artifact => artifact.status === 'approved')
      .map(artifact => artifact.artifactId)
      .sort();
    if (artifactIds.length === 0) {
      setError('请先确认至少一项内容成品');
      return;
    }
    await run(async () => {
      const input = { expectedTaskVersion: task.version, artifactIds };
      const result = await socialContentApi.createDeliveryPackage(task.taskId, input, `social:delivery:${operationSuffix(`${task.taskId}:${task.version}:${artifactIds.join(',')}`)}`);
      applyTask(result.task);
      return result;
    }, '交付包已准备好');
  }, [workspace?.currentTask, run, applyTask]);

  const downloadLatest = useCallback(async () => {
    const item = workspace?.currentTask?.deliveryPackages.filter(entry => entry.downloadHref && (entry.status === 'ready' || entry.status === 'confirmed')).at(-1);
    if (!item?.downloadHref) { setError('交付包尚未准备好'); return; }
    await run(() => socialContentApi.downloadPackage(item.downloadHref!), '交付包已下载');
  }, [workspace?.currentTask, run]);

  const registerPublication = useCallback(async (input: RegisterSocialPublicationInput) => {
    const task = workspace?.currentTask;
    if (!task) return;
    await run(async () => {
      const result = await socialContentApi.registerPublication(task.taskId, input, `social:publication:${operationSuffix(`${task.taskId}:${JSON.stringify(input)}`)}`);
      applyTask(result.task);
      return result;
    }, '发布结果已登记');
  }, [workspace?.currentTask, run, applyTask]);

  const submitMetrics = useCallback(async (publicationId: string, input: SubmitSocialMetricsInput, files: File[] = []) => {
    const task = workspace?.currentTask;
    if (!task) return;
    await run(async () => {
      const evidenceRefs: string[] = [];
      for (const file of files) {
        const fileKey = fileOperationKey(file);
        const cached = uploadedFiles.current.get(file);
        const upload = cached?.taskId === task.taskId && cached.usage === 'metric_evidence'
          ? cached.upload
          : await socialContentApi.uploadFile(task.taskId, file, 'metric_evidence', `social:metric-file:${fileKey}`);
        uploadedFiles.current.set(file, { taskId: task.taskId, usage: 'metric_evidence', upload });
        evidenceRefs.push(upload.file.fileRef);
      }
      const submission = {
        ...input,
        evidenceRefs: [...new Set([...(input.evidenceRefs || []), ...evidenceRefs])],
      };
      const result = await socialContentApi.submitMetrics(publicationId, submission, `social:metrics:${operationSuffix(`${task.taskId}:${publicationId}:${JSON.stringify(submission)}`)}`);
      applyTask(result.task);
      return result;
    }, '发布数据已保存');
  }, [workspace?.currentTask, run, applyTask, fileOperationKey]);

  return {
    workspace,
    loading,
    loadingMoreTasks,
    busy,
    error,
    notice,
    refresh: load,
    loadMoreTasks,
    selectTask,
    saveDraft,
    startTask,
    decideArtifact,
    decideArtifactBatch,
    createDeliveryPackage,
    downloadLatest,
    registerPublication,
    submitMetrics,
    dismissNotice: () => setNotice(''),
  };
}
