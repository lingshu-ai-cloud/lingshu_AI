import { useEffect, useRef, useState } from 'react';
import { App, Button, Dropdown, Empty, Modal, Spin } from 'antd';
import { Ellipsis, History, MessageSquarePlus, Trash2, Eraser } from 'lucide-react';
import { authHeader, getToken } from '../../lib/auth';
import { clearAssistantThreadJournal, type AssistantJournalScope } from '../../lib/assistantThreadJournal';
import { writeAssistantConversationKey } from '../../lib/assistantConversationIdentity';
import { useAssistantStore, type AgentThreadState, type OrbitAgentId } from '../../stores/assistantStore';
import { emptyAssistantThread, persistedAssistantThread, PRIMARY_ASSISTANT_THREAD as agent, type AssistantThreadSaveQueue } from './globalAssistantRuntime';

type Entry = AgentThreadState & { agentId: string };
type Input = {
  scope: AssistantJournalScope;
  fence: { current: { scopeKey: string; active: boolean } };
  pause: { current: boolean };
  queues: { current: Map<OrbitAgentId, AssistantThreadSaveQueue> };
  abort: { current: AbortController | null };
  wait: (agent: OrbitAgentId) => Promise<void>;
  reset: () => void;
  stop: () => void;
  blocked: boolean;
  ready: boolean;
  hasTransientContent?: boolean;
};

export function assistantConversationCanDelete(thread: AgentThreadState): boolean {
  return Boolean(thread.version || thread.messages.length || thread.draftInput || thread.creationDraft);
}

export function assistantConversationCanClear(thread: AgentThreadState, hasTransientContent = false): boolean {
  return Boolean(thread.messages.length || thread.draftInput || thread.creationDraft || hasTransientContent);
}

export function useAssistantConversationManagement(input: Input) {
  const { modal, message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [historyDeleted, setHistoryDeleted] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [items, setItems] = useState<Entry[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const thread = useAssistantStore(state => state.threads[agent]);
  const activeKey = thread.conversationKey || agent;
  const recoveredDeletedKey = useRef('');
  useEffect(() => {
    if (!input.ready || !thread.deletedAt || recoveredDeletedKey.current === activeKey) return;
    recoveredDeletedKey.current = activeKey;
    input.fence.current.active = false;
    input.fence.current = { scopeKey: input.fence.current.scopeKey, active: true };
    input.abort.current?.abort(); input.abort.current = null; input.stop();
    const queue = input.queues.current.get(agent);
    if (queue?.retryTimer != null) window.clearTimeout(queue.retryTimer);
    if (queue) { queue.retryTimer = null; queue.pending = null; }
    input.pause.current = false;
    lock.current = false;
    setBusy(false);
    input.reset();
    const next = {
      ...emptyAssistantThread(),
      conversationKey: `conversation:${crypto.randomUUID()}`,
      draftInput: thread.draftInput,
    };
    useAssistantStore.getState().hydrateThread(agent, next);
    clearAssistantThreadJournal(window.localStorage, input.scope, agent);
    writeAssistantConversationKey(input.scope, next.conversationKey);
    void message.info('原会话已删除，已为你新建会话。');
  }, [activeKey, input, message, thread.deletedAt]);
  useEffect(() => {
    const stopStaleReply = () => {
      input.fence.current.active = false;
      input.fence.current = { scopeKey: input.fence.current.scopeKey, active: true };
      input.abort.current?.abort(); input.abort.current = null; input.stop();
      void message.info('会话已在其他位置清空或删除，已同步最新状态。');
    };
    window.addEventListener('lingshu:assistant-conversation-reset', stopStaleReply);
    return () => window.removeEventListener('lingshu:assistant-conversation-reset', stopStaleReply);
  }, [input.fence, input.abort, input.stop, message]);
  const api = async (key: string, method = 'GET', body?: unknown, suffix = ''): Promise<Entry> => {
    const response = await fetch(`/api/overseas/assistant-threads/${encodeURIComponent(key)}${suffix}`, {
      method, headers: { ...authHeader(), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '会话暂时无法更新，请重试。');
    return data;
  };
  const refreshHistory = async (page = 1, deleted = historyDeleted) => {
    const token = getToken();
    setHistoryLoading(true); setHistoryError('');
    try {
      const response = await fetch(`/api/overseas/assistant-threads?page=${page}${deleted ? '&deleted=1' : ''}`, { headers: authHeader() });
      if (!response.ok) throw new Error('历史会话读取失败，请重试。');
      const data = await response.json();
      if (token !== getToken()) return;
      const entries = (data.items || []).filter((item: Entry) => (deleted ? Boolean(item.deletedAt) : !item.deletedAt) && /^(?:business|conversation:)/.test(item.agentId));
      setItems(previous => page === 1 ? entries : [...new Map([...previous, ...entries].map(item => [item.agentId, item])).values()]);
      setNextPage(data.nextPage || null);
    } catch (error) { setHistoryError(error instanceof Error ? error.message : '读取失败'); }
    finally { setHistoryLoading(false); }
  };
  const run = async (action: 'new' | 'open' | 'clear' | 'delete' | 'restore', targetKey = activeKey, targetVersion?: number) => {
    if (lock.current || input.pause.current || input.blocked || !input.ready) return;
    const local = useAssistantStore.getState().threads[agent];
    // Toast undo can outlive the render that deleted the active conversation.
    const runningKey = local.conversationKey || agent;
    if (local.pendingContentTaskBinding) {
      void message.warning('有一条任务回执尚待恢复，请先在当前会话完成恢复再管理会话。'); return;
    }
    lock.current = true; setBusy(true); input.pause.current = true;
    // Fence both streaming callbacks and queued PUT retries before changing conversations.
    const oldFence = input.fence.current;
    oldFence.active = false;
    const fence = { scopeKey: oldFence.scopeKey, active: true };
    input.fence.current = fence;
    input.abort.current?.abort(); input.abort.current = null;
    input.stop();
    const token = getToken();
    const current = () => input.fence.current === fence && fence.active && token === getToken();
    const queue = input.queues.current.get(agent);
    if (queue?.retryTimer != null) window.clearTimeout(queue.retryTimer);
    if (queue) { queue.retryTimer = null; queue.pending = null; }
    try {
      await input.wait(agent);
      if (!current()) return;
      const remote = await api(runningKey);
      if (!current()) return;
      if (remote.pendingContentTaskBinding) throw new Error('当前会话有尚待恢复的任务回执，请先恢复后再管理会话。');
      if (remote.deletedAt && action !== 'new' && action !== 'open') throw new Error('会话已删除，请新建会话或打开历史会话。');
      if ((remote.conversationResetVersion || 0) > (local.conversationResetVersion || 0) && !remote.deletedAt) {
        input.reset();
        useAssistantStore.getState().hydrateThread(agent, persistedAssistantThread(remote, emptyAssistantThread())!);
        clearAssistantThreadJournal(window.localStorage, input.scope, agent);
        throw new Error('会话已在其他位置清空，已同步最新状态，请重新操作。');
      }
      let saved = remote;
      if (!remote.deletedAt && (local.messages.length || local.draftInput || local.creationDraft || local.version)) {
        // The drained PUT may have committed while its old UI fence was revoked.
        // Do not use the newly read version to overwrite another tab's transcript.
        const remoteIsEarlierSnapshot = remote.messages.every((msg, index) => {
          const own = local.messages[index];
          return own?.role === msg.role && own.content.startsWith(msg.content);
        });
        if (remote.version > local.version && !remoteIsEarlierSnapshot) {
          throw new Error('会话已在其他窗口更新，未覆盖任何记录。请先刷新核对，再管理会话。');
        }
        saved = await api(runningKey, 'PUT', { ...local, expectedVersion: remote.version });
        if (!current()) return;
        useAssistantStore.getState().setPersistenceMetadata(agent, saved.version, saved.updatedAt);
      }
      let next: AgentThreadState | undefined;
      if (action === 'clear' || action === 'delete' || action === 'restore') {
        const result = await api(targetKey, action === 'delete' ? 'DELETE' : 'POST', {
          expectedVersion: action === 'restore' ? (await api(targetKey)).version : targetKey === runningKey ? saved.version : targetVersion,
        }, action === 'clear' ? '/clear' : action === 'restore' ? '/restore' : '');
        if (!current()) return;
        if (action === 'restore') next = persistedAssistantThread(result, emptyAssistantThread())!;
        else if (targetKey === runningKey) next = action === 'clear'
          ? persistedAssistantThread(result, emptyAssistantThread())!
          : { ...emptyAssistantThread(), conversationKey: `conversation:${crypto.randomUUID()}` };
      } else if (action === 'new') next = { ...emptyAssistantThread(), conversationKey: `conversation:${crypto.randomUUID()}` };
      else {
        const selected = await api(targetKey);
        if (!current()) return;
        if (selected.deletedAt) throw new Error('该会话已删除。');
        next = persistedAssistantThread(selected, emptyAssistantThread())!;
      }
      if (next) {
        input.reset();
        useAssistantStore.getState().hydrateThread(agent, next);
        clearAssistantThreadJournal(window.localStorage, input.scope, agent);
        writeAssistantConversationKey(input.scope, next.conversationKey || agent);
      }
      if (action === 'delete' && targetKey !== runningKey) await refreshHistory();
      else setHistoryOpen(false);
      if (action === 'clear' || action === 'delete') void message.success({ duration: 8, content: <span>{action === 'clear' ? '会话已清空' : '会话已删除'} <Button type="link" size="small" onClick={() => void run('restore', targetKey)}>撤销</Button></span> });
      if (action === 'restore') void message.success('会话已恢复');
    } catch (error) {
      if (current()) void message.error(error instanceof Error ? error.message : '操作失败，请重试。');
    } finally {
      if (current()) { input.pause.current = false; setBusy(false); }
      lock.current = false;
    }
  };
  const confirm = (action: 'clear' | 'delete', key = activeKey, version?: number) => modal.confirm({
    title: action === 'clear' ? '清空当前会话？' : '删除这条会话？',
    content: `${action === 'clear' ? '聊天消息将被清空，会话会保留。' : '会话及聊天消息将从历史记录中移除。'}可在历史会话中恢复已删除的会话；清空后可撤销最近一次操作。尚未取得正式任务回执的内容草稿会取消；已创建的任务、素材、企业资料和已保存的长期记忆会保留，正在执行的任务不受影响。`,
    okText: action === 'clear' ? '清空会话' : '删除会话', cancelText: '取消',
    autoFocusButton: 'cancel', okButtonProps: { danger: true }, onOk: () => run(action, key, version),
  });
  const disabled = busy || input.blocked || !input.ready;
  return <>
    <Dropdown trigger={['click']} menu={{ items: [
      { key: 'new', label: '新建会话', icon: <MessageSquarePlus size={15} /> },
      { key: 'history', label: '历史会话', icon: <History size={15} /> },
      { type: 'divider' },
      { key: 'clear', label: '清空当前会话', icon: <Eraser size={15} />, disabled: !assistantConversationCanClear(thread, input.hasTransientContent) },
      { key: 'delete', label: '删除会话', icon: <Trash2 size={15} />, danger: true,
        disabled: !assistantConversationCanDelete(thread) },
    ], onClick: ({ key }) => {
      if (key === 'history') { setHistoryOpen(true); void refreshHistory(); }
      else if (key === 'new') void run('new');
      else confirm(key as 'clear' | 'delete');
    } }}>
      <Button type="text" aria-label="会话管理" title="会话管理" disabled={disabled} loading={busy} icon={<Ellipsis size={20} />} />
    </Dropdown>
    <Modal title="历史会话" open={historyOpen} onCancel={() => setHistoryOpen(false)} footer={null} width={480}>
      <div className="mb-3 flex gap-2"><Button type={!historyDeleted ? 'primary' : 'default'} onClick={() => { setHistoryDeleted(false); void refreshHistory(1, false); }}>历史会话</Button><Button type={historyDeleted ? 'primary' : 'default'} onClick={() => { setHistoryDeleted(true); void refreshHistory(1, true); }}>已删除会话</Button></div>
      <Spin spinning={historyLoading || busy}>
        {historyError ? <div role="alert">{historyError}<Button onClick={() => void refreshHistory()}>重试</Button></div>
          : !items.length ? <Empty description="暂无历史会话" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          : <div className="max-h-[60vh] overflow-y-auto">{items.map(item => <div key={item.agentId} className="flex items-center gap-2 border-b border-border py-2">
            <button type="button" disabled={disabled} className="min-w-0 flex-1 rounded-lg p-2 text-left hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent" onClick={() => void run(historyDeleted ? 'restore' : 'open', item.agentId)}>
              <span className="block truncate text-text-primary">{item.title || item.messages.find(msg => msg.role === 'user')?.content.slice(0, 40) || '新会话'}{item.agentId === activeKey ? ' · 当前' : ''}</span>
              <span className="text-xs text-text-muted">{item.messages.length} 条消息 · {new Date(item.updatedAt).toLocaleString('zh-CN')}</span>
            </button>
            {historyDeleted ? <Button disabled={disabled} onClick={() => void run('restore', item.agentId)}>恢复会话</Button> : <Dropdown trigger={['click']} getPopupContainer={trigger => trigger.parentElement!} menu={{ items: [{ key: 'delete', label: '删除会话', danger: true }], onClick: () => confirm('delete', item.agentId, item.version) }}>
              <Button type="text" disabled={disabled} aria-label={`管理会话：${item.title || '新会话'}`} icon={<Ellipsis size={18} />} />
            </Dropdown>}
          </div>)}</div>}
        {nextPage && <Button block disabled={historyLoading || busy} onClick={() => void refreshHistory(nextPage)}>加载更多会话</Button>}
      </Spin>
    </Modal>
  </>;
}
