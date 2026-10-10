import { useEffect, useRef, useState } from 'react';
import { authHeader, getToken } from './auth';
import { createAssistantDecisionRequestGuard } from './assistantDecisionRequestGuard';

export interface AssistantDecisionMemoryItem { id: string; text: string; status: string; version: number }

export function useAssistantDecisionMemory(authScope: string, responseErrorMessage: (response: Response) => Promise<string>) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [items, setItems] = useState<AssistantDecisionMemoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [listLoaded, setListLoaded] = useState(false);
  const [feedback, setFeedback] = useState('');
  const scopeRef = useRef(authScope);
  const guardRef = useRef(createAssistantDecisionRequestGuard(() => `${scopeRef.current}:${getToken() ?? ''}`));
  scopeRef.current = authScope;
  useEffect(() => {
    guardRef.current.reset();
    setPanelOpen(false);
    setItems([]);
    setBusy(false);
    setListLoaded(false);
    setFeedback('');
    return () => { guardRef.current.reset(); };
  }, [authScope]);

  const request = async (operation: 'list' | 'save' | 'revoke', text = '', item?: Pick<AssistantDecisionMemoryItem, 'id' | 'version'>) => {
    if (authScope !== scopeRef.current) return;
    const pending = guardRef.current.begin();
    if (!pending) return;
    setBusy(true);
    setFeedback('');
    if (operation === 'list') setListLoaded(false);
    const currentScope = pending.current;
    try {
      const endpoint = '/api/overseas/strategy/decisions';
      const response = await fetch(operation === 'revoke' ? `${endpoint}/${encodeURIComponent(item!.id)}` : endpoint, {
        method: operation === 'save' ? 'POST' : operation === 'revoke' ? 'DELETE' : 'GET',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        ...(operation === 'list' ? {} : { body: JSON.stringify(operation === 'save'
          ? { text, sourceMessage: text, confirmed: true }
          : { expectedVersion: item!.version }) }),
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response));
      const result = await response.json();
      if (!currentScope()) return;
      if (operation === 'list') {
        if (!Array.isArray(result.items)) throw new Error('经营决策列表格式异常，请重试。');
        setItems(result.items);
        setListLoaded(true);
      } else {
        setFeedback(operation === 'save' ? '已保存为经营决策，下次回答会参考。' : '已撤销这条经营决策。');
        if (result.item?.id) setItems(previous => [result.item, ...previous.filter(entry => entry.id !== result.item.id)]);
      }
    } catch (error) {
      if (!currentScope()) return;
      setFeedback(error instanceof Error ? error.message : '经营决策操作失败，请重试。');
    } finally {
      if (pending.finish()) setBusy(false);
    }
  };
  return { panelOpen, setPanelOpen, items, busy, listLoaded, feedback, request };
}

export type AssistantDecisionMemory = ReturnType<typeof useAssistantDecisionMemory>;
