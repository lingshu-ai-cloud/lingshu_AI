import { useEffect, useRef, useState } from 'react';
import { AUTH_TOKEN_CHANGED_EVENT, authHeader } from './auth';
import { platformAdsApi, type PlatformAdTask } from './platformAds';

const parameter = 'adsTaskId';
const read = () => new URL(window.location.href).searchParams.get(parameter) || '';
function write(id: string) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(parameter, id); else url.searchParams.delete(parameter);
  window.history.replaceState(window.history.state, '', url);
}
/** URL identifiers are navigation only; every restored plan is read with current authentication. */
export function useAdPlanNavigation(previewMode = false) {
  const [identity, setIdentity] = useState(authHeader().Authorization || '');
  const [taskId, setTaskId] = useState(previewMode ? '' : read());
  const [task, setTask] = useState<PlatformAdTask | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const restore = () => { generation.current++; setTask(null); setError(''); setTaskId(read()); };
    const authChanged = () => {
      const current = authHeader().Authorization || '';
      if (current === identity) return;
      generation.current++; write(''); setTask(null); setTaskId(''); setError(''); setLoading(false); setIdentity(current);
    };
    window.addEventListener('popstate', restore);
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, authChanged);
    window.addEventListener('storage', authChanged);
    return () => { generation.current++; window.removeEventListener('popstate', restore); window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, authChanged); window.removeEventListener('storage', authChanged); };
  }, [identity]);
  useEffect(() => {
    const run = ++generation.current;
    if (!taskId || previewMode) { setTask(null); setLoading(false); setError(''); return; }
    setTask(null); setLoading(true); setError('');
    void platformAdsApi.getTask(taskId).then(value => {
      if (run === generation.current && identity === authHeader().Authorization) setTask(value);
    }).catch(e => {
      if (run === generation.current) setError(`无法读取所选计划，请确认计划仍存在且当前账号有权访问。${e instanceof Error ? e.message : '请重试。'}`);
    }).finally(() => { if (run === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [taskId, identity, previewMode, attempt]);
  const select = (id: string) => { if (!previewMode) write(id); setTaskId(id); };
  return { identity, taskId, task, loading: loading || !!taskId && !task && !error, error, select, retry: () => setAttempt(value => value + 1) };
}

export function useAdPlanTasks(identity: string, previewMode = false) {
  const [snapshot, setSnapshot] = useState<{ identity: string; items: PlatformAdTask[] } | null>(null);
  const [loading, setLoading] = useState(!previewMode), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(''); setLoading(!previewMode);
    if (previewMode) return;
    void platformAdsApi.listTasks().then(items => {
      if (active && identity === authHeader().Authorization) setSnapshot({ identity, items });
    }).catch(e => {
      if (active && identity === authHeader().Authorization) setError(`计划列表读取失败：${e instanceof Error ? e.message : '服务暂不可用'}。已有列表保留，不能据此判断没有计划。`);
    }).finally(() => { if (active && identity === authHeader().Authorization) setLoading(false); });
    return () => { active = false; };
  }, [identity, previewMode, attempt]);
  return { items: snapshot?.identity === identity ? snapshot.items : null, loading, error, retry: () => setAttempt(value => value + 1) };
}
