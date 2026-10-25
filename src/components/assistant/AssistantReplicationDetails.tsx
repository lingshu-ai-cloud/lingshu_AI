import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Select, Spin } from 'antd';
import type { AssistantCreationPortal } from '../../../shared/contracts/assistantCreationPortal';
import AssistantTaskLinkCard from './AssistantTaskLinkCard';
import { studioApi } from '../../lib/studioApi';
import { socialContentApi } from '../../lib/socialContentApi';
import { replicationConfirmationInput, replicationConfirmationKey } from '../../lib/assistantReplicationConfirmation';
import { productionPortalNavigation } from './AssistantProductionPortal';
import { productionNavigationIdentity } from '../../lib/productionNavigation';

/** Confirm intake and request the existing server start; only persisted evidence proves admission. */
export default function AssistantReplicationDetails({ portal, update }: {
  portal: AssistantCreationPortal; update: (patch: Partial<AssistantCreationPortal>) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const confirmationLock = useRef(false);
  const scope = useRef(productionNavigationIdentity());
  const confirmTask = async () => {
    if (confirmationLock.current || portal.confirmedTaskId || scope.current !== productionNavigationIdentity()) return;
    confirmationLock.current = true; setConfirming(true); setError('');
    try {
      const input = replicationConfirmationInput(portal);
      const key = await replicationConfirmationKey(portal.id, input);
      if (!portal.selectedReferenceSourceUrl) throw new Error('请重新选择对标视频，以核对原始参考来源。');
      const { task } = await socialContentApi.createAssistantAction({ ...input, initialSource: {
        kind: 'reference_link', sourceRef: portal.selectedReferenceSourceUrl,
        cachedReferenceRecordId: portal.selectedReferenceId, label: '首页选定对标视频',
      } }, key);
      if (scope.current === productionNavigationIdentity()) update({ confirmedTaskId: task.taskId });
    } catch (cause) {
      if (scope.current === productionNavigationIdentity()) setError(cause instanceof Error ? cause.message : '任务确认结果待核验，请重试原请求。');
    } finally { confirmationLock.current = false; setConfirming(false); }
  };
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [productIds, setProductIds] = useState<string[]>(portal.selectedProducts?.map(product => product.id) || (portal.selectedProductId ? [portal.selectedProductId] : []));
  const [date, setDate] = useState(portal.plannedPublishAt || '');
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (portal.replicationStep !== 'product') return;
    let active = true;
    setLoading(true); setError('');
    void studioApi.materialProducts().then(result => { if (active) setProducts(result.items.map(({ id, name }) => ({ id, name }))); })
      .catch(() => { if (active) setError('产品资料读取失败，请重试。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [portal.replicationStep, revision]);
  const selectedProducts = products.filter(item => productIds.includes(item.id));
  const productNames = portal.selectedProducts?.map(item => item.name).join('、') || portal.selectedProductName || '';
  const step = portal.replicationStep;
  if (portal.confirmedTaskId) return <AssistantTaskLinkCard
    title={`爆款复刻 · ${productNames}`}
    description={`内容任务 · 预计 ${portal.plannedPublishAt?.replace('T', ' ')} 发布（北京时间）`}
    onOpen={() => {
      if (scope.current === productionNavigationIdentity()) window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { ...productionPortalNavigation(portal.confirmedTaskId!), navigationIdentity: scope.current } }));
    }}/>;
  return <section aria-label="复刻信息确认" className="mt-3 space-y-4">
    <div className="flex justify-end"><span className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-text-primary">{step === 'product' ? '就用这条对标视频' : `选择产品：${productNames}`}</span></div>
    {step === 'product' && <>
      <p className="text-sm text-text-primary">这条视频准备推广哪些产品？可以选择一款或多款。</p>
      {error && <Alert type="warning" title={error} action={<Button onClick={() => setRevision(value => value + 1)}>重试</Button>}/>}
      <Select mode="multiple" aria-label="选择推广产品" className="w-full" showSearch optionFilterProp="label"
        placeholder="选择一款或多款产品，可搜索名称" value={productIds} loading={loading} disabled={loading || Boolean(error)}
        maxTagCount="responsive" options={products.map(item => ({ value: item.id, label: item.name }))}
        onChange={setProductIds} allowClear popupMatchSelectWidth listHeight={224}/>
      <p role="status" className="text-xs text-text-secondary">已选择 {selectedProducts.length} 款产品{selectedProducts.length ? `：${selectedProducts.map(item => item.name).join('、')}` : ''}</p>
      {!loading && !error && !products.length && <p className="text-xs text-text-secondary">暂无企业产品，请先补充企业产品资料。</p>}
      <div className="flex justify-end gap-2"><Button onClick={() => update({ replicationStep: 'reference' })}>重选视频</Button>
        <Button type="primary" disabled={!selectedProducts.length || loading || Boolean(error)} onClick={() => { if (selectedProducts.length) update({ selectedProducts, selectedProductId: selectedProducts.length === 1 ? selectedProducts[0].id : undefined, selectedProductName: selectedProducts.length === 1 ? selectedProducts[0].name : undefined, replicationStep: 'schedule' }); }}>确认产品</Button></div>
      {loading && <Spin size="small"/>}
    </>}
    {step === 'schedule' && <>
      <p className="text-sm text-text-primary">预计什么时候发布？先确认目标时间，后续再结合周排期安排。</p>
      <label className="block text-xs text-text-secondary">预计发布时间（北京时间）
        <input aria-label="预计发布时间" type="datetime-local" value={date} onChange={event => { setDate(event.target.value); setError(''); }}
          className="mt-2 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-text-primary"/>
      </label>
      {error && <p role="alert" className="text-xs text-text-secondary">{error}</p>}
      <div className="flex justify-end gap-2"><Button onClick={() => update({ replicationStep: 'product' })}>修改产品</Button>
        <Button type="primary" disabled={!date} onClick={() => {
          if (!Number.isFinite(Date.parse(`${date}+08:00`)) || Date.parse(`${date}+08:00`) <= Date.now()) { setError('请选择未来的发布时间。'); return; }
          update({ plannedPublishAt: date, replicationStep: 'summary' });
        }}>确认预计发布时间</Button></div>
    </>}
    {step === 'summary' && <>
      <div className="flex justify-end"><span className="rounded-lg bg-surface-2 px-3 py-2 text-sm">预计 {portal.plannedPublishAt?.replace('T', ' ')} 发布（北京时间）</span></div>
      <p className="text-sm text-text-primary">请确认本条创作任务的信息。</p>
      <p className="text-xs text-text-secondary">确认后可在执行队列查看本条任务。</p>
      {error && <Alert type="warning" title={error}/>}
      <div className="flex flex-wrap justify-end gap-2"><Button disabled={confirming} onClick={() => update({ replicationStep: 'reference' })}>修改对标视频</Button><Button disabled={confirming} onClick={() => update({ replicationStep: 'product' })}>修改产品</Button><Button disabled={confirming} onClick={() => update({ replicationStep: 'schedule' })}>修改时间</Button><Button type="primary" loading={confirming} onClick={() => void confirmTask()}>确认本条创作任务</Button></div>
    </>}
  </section>;
}
