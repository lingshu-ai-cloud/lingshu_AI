import { useCallback, useEffect, useRef, useState } from 'react';
import { readScriptGapTasks, SCRIPT_GAP_QUEUE_EVENT, type ScriptGapTask } from '../lib/scriptGapQueue';

export function useScriptGapTasks(active = true): { scriptGapTasks: ScriptGapTask[]; shootingTaskError: string; shootingTasksLoading: boolean; refreshScriptGapTasks: () => Promise<void> } {
  const [scriptGapTasks, setScriptGapTasks] = useState<ScriptGapTask[]>([]);
  const [shootingTaskError, setShootingTaskError] = useState('');
  const [shootingTasksLoading, setShootingTasksLoading] = useState(false);
  const requestRef = useRef(0);
  const readsInFlight = useRef(0);
  const refreshScriptGapTasks = useCallback(async () => {
    const request = ++requestRef.current;
    readsInFlight.current += 1;
    setShootingTasksLoading(true);
    try {
      const tasks = await readScriptGapTasks();
      if (request === requestRef.current) { setScriptGapTasks(tasks); setShootingTaskError(''); }
    } catch (error) {
      if (request === requestRef.current) setShootingTaskError(error instanceof Error ? error.message : '待拍任务读取失败');
    } finally { readsInFlight.current -= 1; if (request === requestRef.current) setShootingTasksLoading(false); }
  }, []);
  useEffect(() => {
    void refreshScriptGapTasks();
    const refresh = () => { if (document.visibilityState !== 'hidden' && !readsInFlight.current) void refreshScriptGapTasks(); };
    window.addEventListener(SCRIPT_GAP_QUEUE_EVENT, refresh);
    window.addEventListener('focus', refresh);
    const timer = active ? window.setInterval(refresh, 10000) : undefined;
    return () => {
      requestRef.current += 1;
      if (timer !== undefined) window.clearInterval(timer);
      window.removeEventListener(SCRIPT_GAP_QUEUE_EVENT, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [active, refreshScriptGapTasks]);
  return { scriptGapTasks, shootingTaskError, shootingTasksLoading, refreshScriptGapTasks };
}
