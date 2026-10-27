import { useEffect, useRef } from 'react';
import { App } from 'antd';
import type { CustomerProfile } from '../../types/customer';
import { authHeader } from '../../lib/auth';
import { requestDraft, type DraftResult } from './customerReplyPreparation';

/** Explicit "去跟进" navigation prepares a suggestion; sending stays with the composer. */
export function usePriorityFollowupDraft(input: {
  customer: CustomerProfile | null; text: string; buyerId: string;
  setText: (value: string) => void; setMeta: (value: DraftResult) => void;
  save: (customer: CustomerProfile, text: string) => void; notice: (value: string) => void;
}) {
  const { modal } = App.useApp();
  const latest = useRef(input); latest.current = input;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search), customer = input.customer;
    if (params.get('followupDraft') !== '1' || !customer || params.get('customer') !== customer.id || customer.isHistorical || customer.readOnly || customer.isMock && !(customer.localFollowupPreview === true && customer.id.startsWith('preview_followup_'))) return;
    const identity = authHeader().Authorization, buyerId = input.buyerId;
    let active = true;
    const current = () => active && authHeader().Authorization === identity && latest.current.customer?.id === customer.id && latest.current.buyerId === buyerId;
    const consumeNavigation = () => { if (current()) { const url = new URL(window.location.href); url.searchParams.delete('followupDraft'); window.history.replaceState(window.history.state, '', url); } };
    input.notice('正在根据客户会话准备推荐回复…');
    void requestDraft(customer, '准备本次人工跟进回复，基于当前客户会话和已确认企业事实，不编造价格、库存、交期或承诺。', undefined, 'reply', true).then(result => {
      if (!current()) return;
      if (!result.draft || result.handoffRequired && !result.safeToSendBeforeHandoff) { latest.current.setMeta(result); consumeNavigation(); input.notice(result.handlingReason || '当前需要人工处理，未回填推荐回复。'); return; }
      const apply = () => {
        if (!current()) return;
        latest.current.setMeta(result); latest.current.setText(result.draft); latest.current.save(customer, result.draft);
        input.notice('');
        consumeNavigation();
      };
      if (latest.current.text.trim() && latest.current.text.trim() !== result.draft.trim()) modal.confirm({ title: '输入栏已有草稿', content: '是否用本次推荐回复替换？保留草稿后仍可继续编辑发送。', okText: '替换为推荐回复', cancelText: '保留原草稿', onOk: apply, onCancel: consumeNavigation });
      else apply();
    }).catch(error => { if (current()) input.notice(error instanceof Error ? error.message : '推荐回复暂未生成'); });
    return () => { active = false; };
  }, [input.customer?.id, input.buyerId]);
}
