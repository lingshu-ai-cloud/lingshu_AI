import { Alert, Button, Form, Radio, Select, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { getToken } from '../../lib/auth';
import { socialProgramApi, type WeeklyPublicationProductChoices } from '../../lib/socialProgramApi';

type Scope = { programId: string; packageId: string; packageVersion: number };
type Mode = 'all' | 'mother';

/** A publication choice is an authenticated sidecar to the frozen package, not an edit to its catalogue. */
export default function WeeklyProductSelectionIntervention({ scope, onSelected }: {
  scope: Scope;
  onSelected?: () => void | Promise<void>;
}) {
  const identity = `${scope.programId}:${scope.packageId}:${scope.packageVersion}`;
  const fieldPrefix = `weekly-product-selection-${scope.packageId}-${scope.packageVersion}`;
  const current = useRef(identity);
  const errorRef = useRef<HTMLDivElement>(null);
  current.current = identity;
  const [item, setItem] = useState<WeeklyPublicationProductChoices | null>(null);
  const [mode, setMode] = useState<Mode>('all');
  const [motherId, setMotherId] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    const token = getToken(); let live = true;
    setItem(null); setMode('all'); setMotherId(null); setProductId(null); setError(''); setConflict(false); setLoading(true);
    void socialProgramApi.readWeeklyPublicationProductChoices(scope.programId, scope.packageId, scope.packageVersion)
      .then(next => { if (live && current.current === identity && getToken() === token) setItem(next); })
      .catch(cause => { if (live && current.current === identity && getToken() === token) setError(cause instanceof Error ? cause.message : '发布选品读取失败。'); })
      .finally(() => { if (live && current.current === identity && getToken() === token) setLoading(false); });
    return () => { live = false; };
  }, [identity]);

  const refresh = async () => {
    const captured = identity, token = getToken(); setBusy(true); setError(''); setConflict(false);
    try {
      const next = await socialProgramApi.readWeeklyPublicationProductChoices(scope.programId, scope.packageId, scope.packageVersion);
      if (current.current === captured && getToken() === token) { setItem(next); setProductId(null); }
    } catch (cause) {
      if (current.current === captured && getToken() === token) setError(cause instanceof Error ? cause.message : '重新读取发布选品失败。');
    } finally { if (current.current === captured && getToken() === token) setBusy(false); }
  };

  const groups = item ? [...new Set(item.publications.map(p => p.motherContentId))].map(id => ({
    id,
    publications: item.publications.filter(p => p.motherContentId === id),
  })) : [];
  const chosenGroup = groups.find(group => group.id === motherId);
  const inconsistentGroups = groups.filter(group => new Set(group.publications.map(p => p.selectedProductId).filter(Boolean)).size > 1);
  const pendingProductIds = [...new Set(item?.publications.filter(p => p.pendingOperation).map(p => p.pendingProductId).filter((id): id is string => !!id) ?? [])];
  const pendingNeedsRecovery = Boolean(item?.publications.some(p => p.pendingOperation));
  const targetPublications = mode === 'all' ? item?.publications ?? [] : chosenGroup?.publications ?? [];
  const selectedProduct = item?.products.find(product => product.id === productId);
  const conflictingSelection = targetPublications.some(publication => publication.selectedProductId !== null && publication.selectedProductId !== productId);
  const remainingTargetCount = targetPublications.filter(publication => publication.selectedProductId === null).length;
  const pendingInTarget = targetPublications.some(p => p.pendingOperation);
  const pendingCompatible = !pendingNeedsRecovery || (mode === 'mother' && pendingProductIds.length === 1 && productId === pendingProductIds[0] && pendingInTarget);
  const canSubmit = !!item && !!selectedProduct && targetPublications.length > 0 && remainingTargetCount > 0 && !conflictingSelection && inconsistentGroups.length === 0 && pendingCompatible && !busy;
  const pending = item?.publications.filter(publication => publication.selectedProductId === null).length ?? 0;

  const submit = async () => {
    if (!item || !canSubmit || !productId) return;
    const captured = identity, token = getToken(); setBusy(true); setError(''); setConflict(false);
    try {
      await socialProgramApi.selectWeeklyPublicationProduct(scope.programId, scope.packageId, scope.packageVersion, {
        expectedContextHash: item.contextHash,
        productId,
        publicationTaskIds: targetPublications.map(publication => publication.publicationTaskId),
      });
      const next = await socialProgramApi.readWeeklyPublicationProductChoices(scope.programId, scope.packageId, scope.packageVersion);
      if (current.current !== captured || getToken() !== token) return;
      setItem(next); setProductId(null);
      window.dispatchEvent(new CustomEvent('lingshu:weekly-product-selection-updated', { detail: { programId: scope.programId, packageId: scope.packageId, packageVersion: scope.packageVersion } }));
      try { await onSelected?.(); } catch { setError('选品已记录，但任务状态刷新失败；请重新读取。'); }
    } catch (cause) {
      if (current.current !== captured || getToken() !== token) return;
      const stale = !!cause && typeof cause === 'object' && 'status' in cause && cause.status === 409;
      setConflict(stale);
      setError(stale ? '周包或选品已由其他操作更新；请读取最新版本后重选。' : `${cause instanceof Error ? cause.message : '提交失败'}；请先核对当前记录，勿重复提交。`);
    } finally { if (current.current === captured && getToken() === token) setBusy(false); }
  };

  if (loading) return <p role="status" className="text-xs text-text-muted">正在读取当前周包的发布选品…</p>;
  return <section aria-label="本周发布选品待干预" className="space-y-3 rounded-lg border border-amber-200 bg-white p-4">
    <div className="flex flex-wrap items-center gap-2"><h5 className="text-sm font-semibold text-text-primary">本周发布选品</h5><Tag color={pending ? 'warning' : 'success'}>{item ? `${pending} / ${item.publications.length} 条待选择` : '记录待读取'}</Tag></div>
    {item && <>
      {inconsistentGroups.length > 0 ? <Alert type="error" showIcon title="同母版组产品回执冲突" description="已有不可变回执指向不同商品；本卡禁止继续提交，请系统核验原签发与版本。" /> : item.selectionState === 'incomplete_group' && <Alert type="warning" showIcon title="母版组选品签发尚未完整" description="原选择已有部分不可变回执；该组尚不能进入生产。请按同一商品与原组范围恢复缺失签发，不要改选其他商品。" />}
      {item.selectionState === 'pending_operation' && <Alert type="warning" showIcon title="原选品签发待恢复" description={pendingProductIds.length === 1 ? '原操作已留痕，但部分回执尚未形成。仅可对原商品及原母版组重试；不能改选或启动生产。' : '原操作已留痕，但无法确认原商品；本卡禁止提交，请系统核验后恢复。'} />}
      <p className="text-xs leading-5 text-text-secondary">仅选择本周实际展示的企业商品；不会从采集关键词、产品目录顺序或商品名称中的数字推断 SKU。选品不等于免费样品政策、人物声音、成片验收或发布授权。</p>
      <div className="space-y-1 text-xs text-text-secondary" aria-label="母版组及发布任务选品状态">
        {groups.map((group, index) => {
          const ids = [...new Set(group.publications.map(p => p.selectedProductId).filter(Boolean))];
          const product = item.products.find(p => p.id === ids[0]);
          return <p key={group.id}>母版组 {index + 1}：{group.publications.length} 条发布任务 · {ids.length > 1 ? '产品不一致，需系统恢复' : ids.length === 1 ? `${product?.name ?? '产品记录已变化'}${product?.sku ? `（SKU ${product.sku}）` : '（SKU 未登记）'}` : '待选择'}</p>;
        })}
      </div>
      {pending > 0 && <Form layout="vertical" onFinish={() => void submit()}>
        <Form.Item label="选品作用范围" htmlFor={`${fieldPrefix}-scope`}>
          <Radio.Group id={`${fieldPrefix}-scope`} aria-label="选品作用范围" value={mode} onChange={event => { setMode(event.target.value as Mode); setProductId(null); }}>
            <Radio className="flex min-h-11 items-center" value="all">单一商品用于全部 {item.publications.length} 条发布任务</Radio>
            <Radio className="flex min-h-11 items-center" value="mother">按母版组逐组选择</Radio>
          </Radio.Group>
        </Form.Item>
        {mode === 'mother' && <Form.Item label="母版组" htmlFor={`${fieldPrefix}-mother`} required><Select id={`${fieldPrefix}-mother`} aria-label="母版组" className="min-h-11 [&_.ant-select-selector]:!min-h-11" value={motherId} onChange={value => { setMotherId(value); setProductId(null); }} placeholder="请选择要处理的母版组" options={groups.map((group, index) => ({ value: group.id, label: `母版组 ${index + 1} · ${group.publications.length} 条${group.publications.some(p => p.selectedProductId) ? ' · 已选择' : ' · 待选择'}` }))} /></Form.Item>}
        <Form.Item label="实际展示商品" htmlFor={`${fieldPrefix}-product`} required><Select id={`${fieldPrefix}-product`} aria-label="实际展示商品" className="min-h-11 [&_.ant-select-selector]:!min-h-11" value={productId} onChange={setProductId} placeholder="请从企业货盘明确选择" showSearch optionFilterProp="label" options={item.products.map(product => ({ value: product.id, label: `${product.name}${product.sku ? ` · SKU ${product.sku}` : ' · SKU 未登记'}` }))} /></Form.Item>
        {conflictingSelection && <Alert type="warning" showIcon title="所选范围已有不同商品" description="不能覆盖已签发回执；请按尚未处理的母版组选择。改选已签发任务需要新的不可变周包修订。" />}
        {selectedProduct && targetPublications.length > 0 && <p className="my-3 text-xs leading-5 text-text-secondary">本次范围为 {targetPublications.length} 条发布任务、{mode === 'all' ? `${groups.length} 个母版组` : '当前母版组'}；其中 {remainingTargetCount} 条待签发“{selectedProduct.name}”。{selectedProduct.sku ? `登记 SKU：${selectedProduct.sku}。` : '该商品尚无结构化 SKU，不从名称推断。'}相同商品的中断签发可按原范围恢复；已签发的不同商品不可覆盖。</p>}
        <Button className="min-h-11" type="primary" htmlType="submit" disabled={!canSubmit} loading={busy}>确认本次发布选品</Button>
      </Form>}
      {pending === 0 && <Alert type="success" showIcon title="本周发布选品已记录" description="仅解除选品缺项；免费样品、资产、生产及发布门禁仍独立核验。" />}
    </>}
    {error && <div ref={errorRef} tabIndex={-1}><Alert type="error" showIcon title={error} action={<Button className="min-h-11" loading={busy} onClick={() => void refresh()}>{conflict ? '读取最新版本' : '重新读取'}</Button>} /></div>}
  </section>;
}
