import { getToken, AUTH_TOKEN_CHANGED_EVENT } from '../../lib/auth';
import { applyCurrentSocialContentOperation, socialContentOperationCurrent } from '../../lib/socialContentOperationIdentity';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RegisterSocialPublicationInput,
  SocialContentArtifact,
  SocialContentFile,
  SocialContentTaskPage,
  SocialContentTaskDetail,
  SocialContentWorkspace,
  SocialWorkPackageKind,
  SubmitSocialMetricsInput,
} from '../../../shared/contracts/socialContentWorkflow';
import { SocialContentRequestError, socialContentApi, type SocialContentUploadResult } from '../../lib/socialContentApi';
import { SOCIAL_CONTENT_NAVIGATION_EVENT, readActiveSocialContentTaskId, setActiveSocialContentTaskId } from '../../lib/socialContentContext';
import { mergeSocialContentTaskSummaries, restoreSavedSocialContentTask } from '../../lib/socialContentTaskPagination';
import { socialArtifactGenerationDisclosure } from '../../lib/socialArtifactGeneration';

function taskListWith(workspace: SocialContentWorkspace, task: SocialContentTaskDetail) {
  return mergeSocialContentTaskSummaries(workspace.tasks, [task]);
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
  const [errorCode, setErrorCode] = useState('');
  const [notice, setNotice] = useState('');
  const selectedIdentity=useRef(workspace?.currentTask);selectedIdentity.current=workspace?.currentTask;
  const currentOperationIdentity=()=>({token:mounted.current?getToken():null,taskId:selectedIdentity.current?.taskId??null,version:selectedIdentity.current?.version??null,generation:readGeneration.current});
  useEffect(()=>{const changed=()=>{readGeneration.current++;selectedIdentity.current=undefined;setWorkspace(null);setError('登录身份已变化，请重新读取内容任务');setNotice('');};window.addEventListener(AUTH_TOKEN_CHANGED_EVENT,changed);window.addEventListener('storage',changed);return()=>{window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT,changed);window.removeEventListener('storage',changed);};},[]);

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
    return () => { mounted.current = false; readGeneration.current += 1; selectedIdentity.current=undefined; };
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
    const token=getToken();
    const generation = ++readGeneration.current;
    setError('');
    setErrorCode('');
    try {
      let next = await socialContentApi.getWorkspace();
      const savedTaskId = readActiveSocialContentTaskId();
      next = await restoreSavedSocialContentTask(next, savedTaskId, taskId => socialContentApi.getTask(taskId));
      if (!mounted.current || generation !== readGeneration.current || getToken()!==token) return;
      setWorkspace(next);
      setActiveSocialContentTaskId(next.currentTask?.taskId || null);
    } catch (loadError) {
      if (mounted.current && generation === readGeneration.current && getToken()===token) setError(loadError instanceof Error ? loadError.message : '内容任务暂时无法读取');
    } finally {
      if (mounted.current && generation === readGeneration.current && getToken()===token) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const restore = (event: Event) => {
      if ((event as CustomEvent<{ page: string }>).detail?.page === 'smartAssets') void load();
    };
    window.addEventListener(SOCIAL_CONTENT_NAVIGATION_EVENT, restore);
    return () => window.removeEventListener(SOCIAL_CONTENT_NAVIGATION_EVENT, restore);
  }, [load]);

  const loadMoreTasks = useCallback(async () => {
    const snapshot = workspace;
    if (!snapshot || loadingMoreTasksRef.current || snapshot.taskList.page >= snapshot.taskList.totalPages) return;
    const requestedPage = snapshot.taskList.page + 1;
    const generation = readGeneration.current;
    loadingMoreTasksRef.current = true;
    setLoadingMoreTasks(true);
    setError('');
    setErrorCode('');
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
    const operationToken=getToken(),operationTaskId=selectedIdentity.current?.taskId;
    const stillCurrent=()=>mounted.current&&getToken()===operationToken&&selectedIdentity.current?.taskId===operationTaskId;
    busyOperations.current += 1;
    setBusy(true);
    setError('');
    setErrorCode('');
    setNotice('');
    try {
      const result = await operation();
      if (stillCurrent()) setNotice(typeof success === 'function' ? success(result) : success);
      return result;
    } catch (operationError) {
      if (stillCurrent()) {
        setError(operationError instanceof Error ? operationError.message : '操作未完成，请重试');
        setErrorCode(operationError instanceof SocialContentRequestError ? operationError.code : '');
      }
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
    const managedPending = task?.status !== 'paused' && ((task?.managedExecution?.reference?.status === 'queued' && ['draft', 'needs_input', 'plan_review'].includes(task?.status || ''))
      || ['scheduled', 'blocked'].includes(task?.managedExecution?.publishing?.status || ''));
    if (!task || busy || (!managedPending && !['producing', 'asset_review', 'packaging', 'attention'].includes(task.status))) return;
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
    const activeProduction = ['producing', 'asset_review', 'packaging', 'attention'].includes(task.status);
    const timer = window.setInterval(() => { void refreshTask(); }, activeProduction ? 5_000 : 15_000);
    window.addEventListener('focus', refreshTask);
    document.addEventListener('visibilitychange', onVisible);
    void refreshTask();
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshTask);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [workspace?.currentTask?.taskId, workspace?.currentTask?.status, workspace?.currentTask?.managedExecution?.reference?.status, workspace?.currentTask?.managedExecution?.publishing?.status, busy, applyTask]);

  const startTask = useCallback(async () => {
    const task = workspace?.currentTask;
    if (!task) return;
    const expected=currentOperationIdentity();
    return run(async () => {
      try {
        const next = await applyCurrentSocialContentOperation(expected,currentOperationIdentity,()=>socialContentApi.startTask(task.taskId, task.version, `social:start:${operationSuffix(`${task.taskId}:${task.version}`)}`),applyTask);
        return next;
      } catch (error) {
        // Reference analysis may advance the task projection before production
        // is admitted. Refresh that new version so the beginner does not get
        // stuck retrying with a stale task while the Director Agent works.
        if (error instanceof SocialContentRequestError && error.status === 409 && socialContentOperationCurrent(expected,currentOperationIdentity())) {
          const latest = await socialContentApi.getTask(task.taskId).catch(() => null);
          if (latest && socialContentOperationCurrent(expected,currentOperationIdentity())) applyTask(latest);
        }
        throw error;
      }
    }, (result: SocialContentTaskDetail) => {
      if (result.status === 'attention') return `《${result.brief.title}》已提交并保留当前结果；系统正在切换可用素材方案，需要你确认时会明确提醒`;
      const remainingSeconds = result.productionProgress?.estimatedRemainingSeconds;
      const eta = remainingSeconds == null
        ? '预计时间会在制作开始后实时更新'
        : `当前预计还需 ${Math.max(1, Math.ceil(remainingSeconds / 60))} 分钟`;
      return `《${result.brief.title}》已提交，只执行一次；${eta}，离开或刷新本页不会影响任务`;
    });
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
    errorCode,
    notice,
    refresh: load,
    loadMoreTasks,
    selectTask,
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
