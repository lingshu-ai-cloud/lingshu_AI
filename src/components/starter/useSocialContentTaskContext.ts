import { useEffect, useState } from 'react';
import type {
  SocialContentTaskDetail,
  SocialContentTaskStatus,
} from '../../../shared/contracts/socialContentWorkflow';
import { socialContentApi } from '../../lib/socialContentApi';
import { setActiveSocialContentTaskId } from '../../lib/socialContentContext';
import {
  SOCIAL_CONTENT_TASK_REFRESH_EVENT,
  type SocialContentTaskRefreshDetail,
} from '../../lib/socialContentTaskRefresh';

const POLLING_STATUSES = new Set<SocialContentTaskStatus>(['producing', 'packaging']);
const UNKNOWN_TASK_RETRY_LIMIT = 3;

export function socialContentTaskNeedsPolling(status: SocialContentTaskStatus): boolean {
  return POLLING_STATUSES.has(status);
}

function taskSpread(taskId: string): number {
  let hash = 0;
  for (let index = 0; index < taskId.length; index += 1) {
    hash = (Math.imul(hash, 31) + taskId.charCodeAt(index)) >>> 0;
  }
  return hash % 10_001;
}

/** Successful polling is spread across 55-65s; failures back off to five minutes. */
export function socialContentTaskPollDelay(taskId: string, failures = 0): number {
  const spread = taskSpread(taskId);
  if (failures <= 0) return 55_000 + spread;
  return Math.min(300_000, 30_000 * (2 ** Math.min(failures - 1, 4)) + spread);
}

type TaskSnapshot = {
  taskId: string | null;
  task: SocialContentTaskDetail | null;
  resolved: boolean;
};

export function useSocialContentTaskContext(taskId: string | null): {
  socialTask: SocialContentTaskDetail | null;
  socialTaskResolved: boolean;
} {
  const [snapshot, setSnapshot] = useState<TaskSnapshot>({
    taskId,
    task: null,
    resolved: !taskId,
  });

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let inFlight = false;
    let queuedRefresh = false;
    let failures = 0;
    let latestTask: SocialContentTaskDetail | null = null;

    setSnapshot({ taskId, task: null, resolved: !taskId });
    if (!taskId) return undefined;

    const visible = () => document.visibilityState === 'visible';
    const clearTimer = () => {
      window.clearTimeout(timer);
      timer = undefined;
    };
    const shouldRetry = () => latestTask
      ? socialContentTaskNeedsPolling(latestTask.status)
      : failures <= UNKNOWN_TASK_RETRY_LIMIT;

    const schedule = () => {
      clearTimer();
      if (disposed || !visible() || !shouldRetry()) return;
      timer = window.setTimeout(() => { void refresh(); }, socialContentTaskPollDelay(taskId, failures));
    };

    const refresh = async (force = false) => {
      clearTimer();
      if (disposed) return;
      if (!visible()) {
        if (force) queuedRefresh = true;
        return;
      }
      if (inFlight) {
        if (force) queuedRefresh = true;
        return;
      }
      inFlight = true;
      try {
        const task = await socialContentApi.getTask(taskId);
        if (disposed) return;
        latestTask = task;
        failures = 0;
        setSnapshot({ taskId, task, resolved: true });
        setActiveSocialContentTaskId(task.taskId);
      } catch {
        if (disposed) return;
        failures += 1;
        setSnapshot(current => current.taskId === taskId
          ? { ...current, resolved: true }
          : current);
      } finally {
        inFlight = false;
        if (!disposed && queuedRefresh && visible()) {
          queuedRefresh = false;
          void refresh(true);
        } else {
          schedule();
        }
      }
    };

    const onVisibilityChange = () => {
      if (!visible()) {
        clearTimer();
        return;
      }
      if (queuedRefresh || shouldRetry()) {
        queuedRefresh = false;
        void refresh(true);
      }
    };
    const onTaskChanged = (event: Event) => {
      const changedTaskId = (event as CustomEvent<SocialContentTaskRefreshDetail>).detail?.taskId;
      if (changedTaskId && changedTaskId !== taskId) return;
      if (!visible()) {
        queuedRefresh = true;
        return;
      }
      void refresh(true);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener(SOCIAL_CONTENT_TASK_REFRESH_EVENT, onTaskChanged);
    void refresh(true);
    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener(SOCIAL_CONTENT_TASK_REFRESH_EVENT, onTaskChanged);
    };
  }, [taskId]);

  if (snapshot.taskId !== taskId) {
    return { socialTask: null, socialTaskResolved: !taskId };
  }
  return { socialTask: snapshot.task, socialTaskResolved: snapshot.resolved };
}
