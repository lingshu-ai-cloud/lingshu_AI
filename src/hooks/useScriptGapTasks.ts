import { useEffect, useState } from 'react';
import { readScriptGapTasks, SCRIPT_GAP_QUEUE_EVENT, type ScriptGapTask } from '../lib/scriptGapQueue';

export function useScriptGapTasks(): { scriptGapTasks: ScriptGapTask[]; shootingTaskError: string } {
  const [scriptGapTasks, setScriptGapTasks] = useState<ScriptGapTask[]>([]);
  const [shootingTaskError, setShootingTaskError] = useState('');
  useEffect(() => {
    let cancelled = false;
    const refresh = () => { void readScriptGapTasks().then(tasks => {
      if (!cancelled) { setScriptGapTasks(tasks); setShootingTaskError(''); }
    }).catch(error => { if (!cancelled) setShootingTaskError(error instanceof Error ? error.message : '待拍任务读取失败'); }); };
    refresh();
    window.addEventListener(SCRIPT_GAP_QUEUE_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener(SCRIPT_GAP_QUEUE_EVENT, refresh); window.removeEventListener('focus', refresh); };
  }, []);
  return { scriptGapTasks, shootingTaskError };
}
