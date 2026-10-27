import { useEffect, useRef, useState } from 'react';
import { Alert, Button } from 'antd';
import AssistantTaskLinkCard from './AssistantTaskLinkCard';
import type { ContentProductionTaskCard } from '../../../shared/contracts/assistantContentTaskCard';
import { socialContentApi } from '../../lib/socialContentApi';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import { openContentGenerationQueue } from '../../lib/contentGenerationQueue';

export function productionPortalNavigation(taskId: string) {
  return { page: 'socialInspiration', view: 'tasks', socialContentTaskId: taskId,
    socialContentPage: 'socialInspiration', directStudio: false };
}

/** A stored message is a pointer. Queue acceptance and progress are reread with authentication. */
export default function AssistantProductionPortal({ taskId }: { taskId: string }) {
  const scopeIdentity = useRef(productionNavigationIdentity());
  const [item, setItem] = useState<{ title: string; card: ContentProductionTaskCard } | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const abort = new AbortController(), identity = scopeIdentity.current;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout>;
    setItem(null); setError('');
    const read = async () => {
      const request = ++generation;
      try {
        const result = await socialContentApi.getExecutionPortal(taskId, abort.signal);
        if (!active || request !== generation || identity !== productionNavigationIdentity()) return;
        setItem(result.item); setError(result.item ? '' : '尚未取得该任务进入执行队列的回执。');
      } catch (cause) {
        if (active && request === generation && !abort.signal.aborted && identity === productionNavigationIdentity()) setError(cause instanceof Error ? cause.message : '任务状态读取失败');
      } finally {
        if (active && request === generation && !abort.signal.aborted && identity === productionNavigationIdentity()) timer = setTimeout(read, 5000);
      }
    };
    void read();
    const refresh = () => { clearTimeout(timer); void read(); };
    window.addEventListener('focus', refresh);
    return () => { active = false; abort.abort(); clearTimeout(timer); window.removeEventListener('focus', refresh); };
  }, [taskId, revision]);
  if (error) return <Alert className="mt-3" type="warning" title={error} action={<Button onClick={() => setRevision(value => value + 1)}>重试查询</Button>}/>;
  if (!item) return <p role="status" className="mt-3 text-xs text-text-muted">正在核验生产任务回执…</p>;
  return <AssistantTaskLinkCard title={item.title} description={`内容任务 · ${item.card.currentNode.label}`} onOpen={() => {
    if (scopeIdentity.current !== productionNavigationIdentity()) { setItem(null); setError('登录身份已变化，请重新打开会话。'); return; }
    openContentGenerationQueue({view:'tasks',taskId});
  }}/>;
}
