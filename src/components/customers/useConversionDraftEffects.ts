import { useEffect } from 'react';
import { authHeader } from '../../lib/auth';
import type { CustomerProfile, TimelineEvent } from '../../types/customer';
import type { CustomerServiceStatus } from '../../lib/customerService';
import { STAGE_LABEL } from './conversionPresentation';
import { VIEW_META, type CustomerView } from './ConversionCustomerList';
import { isWaitingForHumanQuote, requestDraft, type DraftResult } from './customerReplyPreparation';

interface ConversionDraftEffects {
  selected: CustomerProfile | null;
  selectedId: string | null;
  selectedLatestBuyerId: string;
  customerServiceStatus: CustomerServiceStatus | null;
  lastDraftKey: string;
  view: CustomerView;
  activeView: typeof VIEW_META[CustomerView];
  customerPendingCount: number;
  customerTodoItems: unknown[];
  translationRequestRef: { current: number };
  setDraftSuggestion: (draft: string | null) => void;
  setDraftMeta: (meta: DraftResult | null) => void;
  setLastDraftKey: (key: string) => void;
  setInput: (input: string) => void;
  setTranslatedInput: (input: string) => void;
  updateTimelineEvent: (customerId: string, eventId: string, patch: Partial<TimelineEvent>) => void;
  savePendingDraft: (customer: CustomerProfile, draft?: string) => void;
}

export function useConversionDraftEffects({
  selected, selectedId, selectedLatestBuyerId, customerServiceStatus, lastDraftKey, view, activeView,
  customerPendingCount, customerTodoItems, translationRequestRef, setDraftSuggestion, setDraftMeta,
  setLastDraftKey, setInput, setTranslatedInput, updateTimelineEvent, savePendingDraft,
}: ConversionDraftEffects): void {
  useEffect(() => {
    translationRequestRef.current += 1;
    setDraftSuggestion(null);
    setDraftMeta(null);
    setLastDraftKey('');
    setInput('');
    setTranslatedInput('');
  }, [selectedId]);

  useEffect(() => {
    if (!selected || selected.isHistorical) return;
    const untranslated = selected.timeline.filter(event => (event.type === 'messenger' || event.type === 'instagram' || event.type === 'whatsapp') && !/[\u4e00-\u9fff]/.test(event.body) && !event.translatedBody);
    if (!untranslated.length) return;
    let cancelled = false;
    void Promise.all(untranslated.map(async event => {
      try {
        const response = await fetch('/api/overseas/plugins/translate/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({ text: event.body, target: '简体中文' }),
        });
        const data = await response.json();
        if (!cancelled && response.ok && data.translatedText) {
          updateTimelineEvent(selected.id, event.id, { translatedBody: String(data.translatedText).trim() });
        }
      } catch { /* 翻译为辅助信息，失败时保留原文。 */ }
    }));
    return () => { cancelled = true; };
  }, [selected?.id, selected?.timeline, updateTimelineEvent]);

  useEffect(() => {
    if (!selected || selected.isHistorical) return;
    if (!customerServiceStatus?.enabled) return;
    const lastBuyer = [...selected.timeline].reverse().find(event => (event.type === 'messenger' || event.type === 'instagram' || event.type === 'whatsapp') && event.actor === 'buyer');
    if (!lastBuyer) return;
    if (isWaitingForHumanQuote(selected)) {
      setDraftSuggestion(null);
      setDraftMeta(null);
      return;
    }
    const key = `${selected.id}:${lastBuyer.id}`;
    if (key === lastDraftKey) return;
    setLastDraftKey(key);
    if (selected.pendingDraft?.trim()) {
      setDraftSuggestion(selected.pendingDraft.trim());
      return;
    }
    let cancelled = false;
    void requestDraft(selected).then(result => {
      if (cancelled) return;
      setDraftSuggestion(result.draft);
      setDraftMeta(result);
      if (result.draft) savePendingDraft(selected, result.draft);
    });
    return () => { cancelled = true; };
    // lastDraftKey is intentionally a guard, not a dependency: adding it here
    // would cancel the request immediately after the key is recorded.
  }, [selected?.id, selectedLatestBuyerId, selected?.pendingDraft, selected?.handlingReason, customerServiceStatus?.enabled, savePendingDraft]);

  useEffect(() => {
    const viewLabel = selected ? `客户详情 / ${selected.name}` : activeView.label;
    const summary = selected
      ? `当前页面：客户详情。客户：${selected.name}。阶段：${STAGE_LABEL[selected.stage]}。意向：${selected.intentScore}。产品：${selected.product}。预估价值：${selected.estimatedValue}。摘要：${selected.summary}`
      : `当前页面：我的客户 - ${activeView.label}。${activeView.desc}`;
    window.dispatchEvent(new CustomEvent('lingshu-assistant-context', {
      detail: {
        agent: 'conversion',
        sourcePage: 'conversion',
        label: viewLabel,
        summary,
        pendingCount: customerPendingCount,
        todoItems: customerTodoItems,
        suggestions: selected
          ? ['生成下一条回复', '整理触达要点', '生成报价跟进', '创建今日触达任务']
          : ['现在该先回谁？', '筛选紧急客户', '筛选高意向客户', '创建老客唤醒批次'],
      },
    }));
  }, [view, selected, activeView, customerPendingCount, customerTodoItems]);

}
