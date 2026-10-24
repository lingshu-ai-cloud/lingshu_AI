import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Select } from 'antd';
import type { CustomerProfile } from '../../types/customer';
import { authHeader } from '../../lib/auth';
import { saveCustomerTagCorrection } from '../../lib/customerTagCorrection';
import { customerTagDimensions, customerTagDimensionLabels, protectedCustomerTag, readTagCorrections, type CustomerTagDimension } from '../../../shared/contracts/customerTags';
import { customerProfileTags, type ProfileTag } from './customerTagPresentation';

export function CustomerProfileTags({ customer, onUpdated }: { customer: CustomerProfile; onUpdated: (patch: Partial<CustomerProfile>) => void }) {
  const [expanded, setExpanded] = useState(false), [selected, setSelected] = useState<ProfileTag | null>(null);
  const [label, setLabel] = useState(''), [dimension, setDimension] = useState<CustomerTagDimension>('profile');
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const identity = JSON.stringify([customer.id, typeof window === 'undefined' ? '' : authHeader().Authorization]);
  const active = useRef(identity); active.current = identity;
  useEffect(() => { setSelected(null); setExpanded(false); setBusy(false); setError(''); }, [identity]);
  useEffect(() => () => { active.current = ''; }, []);
  const tags = customerProfileTags(customer), visible = expanded ? tags : tags.slice(0, 4);
  const removed = readTagCorrections(customer.contextTagCorrections).filter(c => !c.replacement);
  const open = (tag: ProfileTag) => { setSelected(tag); setLabel(tag.label); setDimension(tag.dimension); setReason(''); setError(''); };
  const save = async (remove: boolean) => {
    if (!selected || busy) return;
    const captured = identity;
    setBusy(true); setError('');
    try {
      const prior = readTagCorrections(customer.contextTagCorrections).find(c => c.tag === selected.key);
      const patch = await saveCustomerTagCorrection(customer, { tag: selected.key, replacement: remove ? null : label.trim(), dimension, reason: reason.trim(), expectedUpdatedAt: prior?.updatedAt || null });
      if (active.current !== captured) return;
      onUpdated(patch); setSelected(null);
    } catch (e) { if (active.current === captured) setError(e instanceof Error ? e.message : '保存失败，请重试'); }
    finally { if (active.current === captured) setBusy(false); }
  };
  const editable = !customer.isHistorical && !customer.readOnly && selected && !protectedCustomerTag(selected.key);
  return <div aria-label="客户画像标签" className="space-y-1.5">
    {customerTagDimensions.map(d => {
      const items = visible.filter(t => t.dimension === d);
      return items.length ? <div key={d} className="flex items-start gap-2 text-xs"><span className="w-12 shrink-0 pt-1 text-text-muted">{customerTagDimensionLabels[d]}</span><div className="flex min-w-0 flex-wrap gap-1">{items.map(t => <button key={t.key} type="button" onClick={() => open(t)} aria-label={`${t.label}：${t.source === 'ai' ? 'AI 标签，查看依据与纠正' : t.source === 'human' ? '人工已纠正，查看详情' : '查看标签详情'}`} className="rounded border border-border bg-surface-2 px-1.5 py-1 text-left text-xs text-text-secondary hover:border-accent">{t.label}{t.source === 'ai' ? ' · AI' : t.source === 'human' ? ' · 人工' : ''}</button>)}</div></div> : null;
    })}
    {!tags.length && <p className="text-xs text-text-muted">暂无画像标签</p>}
    {(tags.length > 4 || removed.length > 0) && <Button type="text" size="small" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>{expanded ? '收起标签' : `查看全部标签与纠正记录（${tags.length}）`}</Button>}
    {expanded && removed.map(c => <button key={c.tag} type="button" onClick={() => open({key:c.tag,label:c.tag,dimension:c.dimension,source:'human',reason:c.reason,updatedAt:c.updatedAt,evidence:c.evidence?.length?c.evidence.map(e=>({...e,tag:c.tag})):customer.contextTagEvidence?.filter(e=>e.tag===c.tag)})} className="block text-xs text-text-muted underline">已移除：{c.tag} · 查看纠正记录</button>)}
    <Modal title="标签依据与人工纠正" open={Boolean(selected)} onCancel={() => { if (!busy) setSelected(null); }} footer={editable ? <div className="flex justify-end gap-2"><Button disabled={busy || !reason.trim()} onClick={() => void save(true)}>移除此标签</Button><Button type="primary" loading={busy} disabled={!label.trim() || !reason.trim()} onClick={() => void save(false)}>保存纠正</Button></div> : null} width={520} destroyOnHidden>
      {selected && <div className="space-y-3 text-sm text-text-secondary">
        <p>原标签：{selected.key} · {selected.source === 'ai' ? customer.isMock ? 'AI 模拟样例' : 'AI 会话分析' : selected.source === 'human' ? '人工已纠正' : '已有标签（来源未标注）'}</p>
        {selected.evidence?.length ? selected.evidence.map(e => <blockquote key={`${e.tag}:${e.messageId}`} className="border-l-2 border-border pl-3"><p>“{e.excerpt}”</p><p className="mt-1 text-xs text-text-muted">依据消息：{e.messageId}{customer.timeline.some(t=>t.id===e.messageId&&t.actor==='buyer'&&t.body.includes(e.excerpt)) ? ' · 已匹配买家原文' : ' · 当前会话未能核验，请人工确认'}</p></blockquote>) : <p className="text-xs text-text-muted">没有可核验的 AI 消息依据，不能据此视为已确认事实。</p>}
        {selected.updatedAt && <p className="text-xs text-text-muted">更新时间：{new Date(selected.updatedAt).toLocaleString('zh-CN')}</p>}
        {selected.reason && <p>上次纠正理由：{selected.reason}</p>}
        {editable ? <><label className="block">标签名称<Input aria-label="纠正后的标签" value={label} maxLength={100} onChange={e=>setLabel(e.target.value)} /></label><label className="block">标签维度<Select aria-label="标签维度" value={dimension} onChange={setDimension} className="w-full" options={customerTagDimensions.map(value=>({value,label:customerTagDimensionLabels[value]}))} /></label><label className="block">纠正理由<Input.TextArea aria-label="纠正理由" value={reason} maxLength={500} onChange={e=>setReason(e.target.value)} /></label></> : <p className="text-xs text-text-muted">{selected && protectedCustomerTag(selected.key) ? '联系许可限制请通过原授权流程处理，不能用标签纠正解除。' : '当前客户仅可查看。'}</p>}
        {error && <Alert type="error" showIcon title={error} />}
      </div>}
    </Modal>
  </div>;
}
