import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Select, Spin } from 'antd';
import { LsFlowDialog } from '../ui/LsExperiencePrimitives';
import { generateProductHighlight, readHighlightProducts, saveProductHighlight, type HighlightProductSnapshot } from '../../lib/productHighlightApi';
import type { ProductHighlightDraft } from '../../../shared/contracts/productHighlight';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import { AUTH_TOKEN_CHANGED_EVENT } from '../../lib/auth';

export default function ProductHighlightDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<HighlightProductSnapshot | null>(null);
  const [productId, setProductId] = useState('');
  const [draft, setDraft] = useState<ProductHighlightDraft | null>(null);
  const [highlight, setHighlight] = useState('');
  const [stage, setStage] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef(0), opened = useRef(open); opened.current = open;
  const begin = () => {
    const version = ++request.current, identity = productionNavigationIdentity();
    return () => opened.current && version === request.current && identity === productionNavigationIdentity();
  };
  const refresh = async () => {
    const current = begin(); setBusy(true); setError(''); setSnapshot(null); setDraft(null); setStage(0); setProductId('');
    try { const next = await readHighlightProducts(); if (current()) setSnapshot(next); }
    catch (error) { if (current()) setError(error instanceof Error ? error.message : '产品读取失败'); }
    finally { if (current()) setBusy(false); }
  };
  useEffect(() => {
    if (open) void refresh();
    const reset = () => { request.current += 1; setSnapshot(null); setDraft(null); onClose(); };
    const storage = (event: StorageEvent) => { if (!event.key || event.key === 'overseas_token') reset(); };
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, reset); window.addEventListener('storage', storage);
    return () => { request.current += 1; window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, reset); window.removeEventListener('storage', storage); };
  }, [open]);
  const generate = async () => {
    if (!snapshot || !productId || busy) return;
    const current = begin(); setBusy(true); setError('');
    try {
      const result = await generateProductHighlight(snapshot, productId);
      if (current()) { setDraft(result); setHighlight(result.highlight); setStage(1); }
    } catch (error) { if (current()) setError(error instanceof Error ? error.message : '卖点提炼失败'); }
    finally { if (current()) setBusy(false); }
  };
  const save = async () => {
    if (!snapshot || !draft || busy) return;
    const current = begin(); setBusy(true); setError('');
    try { await saveProductHighlight(snapshot, draft, highlight, current); if (current()) setStage(2); }
    catch (error) { if (current()) setError(error instanceof Error ? error.message : '回填结果尚未确认，请刷新知识库核对'); }
    finally { if (current()) setBusy(false); }
  };
  return <LsFlowDialog open={open} title="提炼口播核心卖点" current={stage} width={600}
    steps={[{ title: '选择产品' }, { title: '确认卖点' }, { title: '完成' }]}
    onCancel={onClose} maskClosable={!busy} closable={!busy} keyboard={!busy}
    footer={stage === 2 ? <Button type="primary" onClick={onClose}>完成</Button> : <>
      <Button disabled={busy} onClick={onClose}>取消</Button>
      {stage === 1 && <Button disabled={busy} onClick={() => { setStage(0); setDraft(null); }}>重新选择</Button>}
      <Button type="primary" loading={busy} disabled={stage === 0 ? !productId : !highlight.trim()}
        onClick={() => void (stage === 0 ? generate() : save())}>{stage === 0 ? '提炼核心卖点' : '确认回填'}</Button>
    </>}>
    {error && <Alert className="mb-4" type="error" showIcon title={error}/>}
    {stage === 0 && <div className="space-y-3">
      <div className="flex items-center justify-between"><label htmlFor="highlight-product">选择企业知识库产品</label><Button type="link" disabled={busy} onClick={() => void refresh()}>刷新产品</Button></div>
      {busy && !snapshot ? <Spin/> : <Select id="highlight-product" aria-label="选择企业知识库产品" className="w-full" value={productId || undefined}
        placeholder="请选择一个产品" disabled={busy} onChange={setProductId}
        options={(snapshot?.products.items || []).filter(item => item.id).map(item => ({ value: item.id!, label: item.name }))}/>}
      {snapshot && !snapshot.products.items.length && <p>企业知识库还没有产品，请先录入产品资料。</p>}
    </div>}
    {stage === 1 && draft && <div className="space-y-3">
      <p className="font-semibold">{draft.productName}</p>
      <div><p className="mb-1 text-text-secondary">原核心卖点</p><p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3">{draft.previousHighlight || '尚未填写'}</p></div>
      <label className="block">提炼后的核心卖点<Input.TextArea aria-label="提炼后的核心卖点" className="mt-2" rows={3} maxLength={300} showCount disabled={busy} value={highlight} onChange={event => setHighlight(event.target.value)}/></label>
      <p className="text-xs text-text-secondary">用于口播优化。确认后保存至该产品的“核心卖点”字段。</p>
    </div>}
    {stage === 2 && <Alert type="success" showIcon title="已回填企业知识库" description={`${draft?.productName}的核心卖点已保存。`}/>}
  </LsFlowDialog>;
}
