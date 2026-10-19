import { Alert, Button, Form, Input, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { getToken } from '../../lib/auth';
import { socialProgramApi, type WeeklyCtaContact } from '../../lib/socialProgramApi';
import WeeklySamplePolicyCandidateIntervention from './WeeklySamplePolicyCandidateIntervention';

type Scope = { programId: string; packageId: string; packageVersion: number };

/** The frozen CTA is displayed verbatim; filling a contact never rewrites an accepted weekly template. */
export default function WeeklyCtaContactIntervention({ scope, onRecorded, openWhenMissing = false, samplePolicySectionId }: {
  scope: Scope;
  onRecorded?: () => void | Promise<void>;
  openWhenMissing?: boolean;
  samplePolicySectionId?: string;
}) {
  const identity = `${scope.programId}:${scope.packageId}:${scope.packageVersion}`;
  const current = useRef(identity);
  const errorRef = useRef<HTMLDivElement>(null);
  current.current = identity;
  const [item, setItem] = useState<WeeklyCtaContact | null>(null);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selectionRevision, setSelectionRevision] = useState(0);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    const onSelection = (event: Event) => {
      const detail = (event as CustomEvent<Scope>).detail;
      if (detail?.programId === scope.programId && detail.packageId === scope.packageId && detail.packageVersion === scope.packageVersion)
        setSelectionRevision(value => value + 1);
    };
    window.addEventListener('lingshu:weekly-product-selection-updated', onSelection);
    return () => window.removeEventListener('lingshu:weekly-product-selection-updated', onSelection);
  }, [identity]);
  useEffect(() => {
    const token = getToken();
    let live = true;
    setItem(null); setValue(''); setError(''); setConflict(false); setLoading(true); setBusy(false); setExpanded(false);
    void socialProgramApi.readWeeklyCtaContact(scope.programId, scope.packageId, scope.packageVersion)
      .then(next => {
        if (!live || current.current !== identity || getToken() !== token) return;
        setItem(next);
        setValue(next.contactValue || '');
        setExpanded(next.status === 'missing' && openWhenMissing);
      })
      .catch(cause => {
        if (!live || current.current !== identity || getToken() !== token) return;
        setError(cause?.status === 404 ? '当前任务没有可填写的冻结 CTA，请核对周包版本。' : cause instanceof Error ? cause.message : '联系信息读取失败。');
      })
      .finally(() => { if (live && current.current === identity && getToken() === token) setLoading(false); });
    return () => { live = false; };
  }, [identity, openWhenMissing, selectionRevision]);

  const refresh = async () => {
    const captured = identity, token = getToken();
    setBusy(true); setError(''); setConflict(false);
    try {
      const next = await socialProgramApi.readWeeklyCtaContact(scope.programId, scope.packageId, scope.packageVersion);
      if (current.current !== captured || getToken() !== token) return;
      setItem(next);
      setValue(next.contactValue || '');
      setExpanded(next.status === 'missing');
    } catch (cause) {
      if (current.current === captured && getToken() === token) setError(cause instanceof Error ? cause.message : '重新读取联系信息失败。');
    } finally {
      if (current.current === captured && getToken() === token) setBusy(false);
    }
  };

  const submit = async () => {
    if (!item || busy || !value.trim() || (item.status === 'recorded' && value.trim() === item.contactValue)) return;
    const captured = identity, token = getToken();
    setBusy(true); setError(''); setConflict(false);
    try {
      await socialProgramApi.recordWeeklyCtaContact(scope.programId, scope.packageId, scope.packageVersion, {
        contactChannel: 'whatsapp', contactValue: value.trim(), expectedContextHash: item.contextHash, expectedReceiptId: item.receiptId,
      });
      // Re-read the authoritative receipt. A POST response alone must not imply a task has resumed.
      const next = await socialProgramApi.readWeeklyCtaContact(scope.programId, scope.packageId, scope.packageVersion);
      if (current.current !== captured || getToken() !== token) return;
      setItem(next);
      setValue(next.contactValue || '');
      if (next.status === 'recorded') {
        setExpanded(false);
        window.dispatchEvent(new CustomEvent('lingshu:weekly-cta-contact-updated', { detail: { programId: scope.programId, packageId: scope.packageId, packageVersion: scope.packageVersion } }));
        try { await onRecorded?.(); }
        catch { setError('联系号码已保存，但任务状态刷新失败；请重新读取。'); }
      }
    } catch (cause) {
      if (current.current === captured && getToken() === token) {
        const stale = !!cause && typeof cause === 'object' && 'status' in cause && cause.status === 409;
        setConflict(stale);
        setError(stale ? '联系信息已被其他操作更新；请重新读取最新版本后再修改。' : `${cause instanceof Error ? cause.message : '保存失败'}；请重新读取核对，勿重复提交。`);
      }
    } finally {
      if (current.current === captured && getToken() === token) setBusy(false);
    }
  };

  if (loading) return <p role="status" className="text-xs text-text-muted">正在读取当前周包的 CTA 联系信息…</p>;
  if (!item && !error) return null;
  const productLabel = item?.selectedProduct?.name || (item?.productSelectionStatus === 'unavailable'
    ? '选品读取异常，请刷新任务卡核验原回执'
    : item?.productSelectionStatus === 'multiple'
      ? '各母版组已选不同产品；请按发布任务核对样品政策'
      : '尚未完成全部发布任务选品');
  return <section aria-label="CTA 联系信息待干预" className="space-y-3 rounded-lg border border-amber-200 bg-white p-4">
    <div className="flex flex-wrap items-center gap-2"><h5 className="text-sm font-semibold text-text-primary">本任务的 CTA 联系信息</h5><Tag color="warning">{item?.status === 'recorded' ? '联系方式已填写 · 样品证据待提供' : '联系待填写 · 待干预'}</Tag></div>
    {item && <p className="text-xs text-amber-800">联系方式：{item.status === 'recorded' ? '已记录' : '待填写'}；免费样品承诺：待提供可核验证据。两项是独立缺口。</p>}
    {item && <><dl className="space-y-1 text-xs text-text-secondary"><div><dt className="inline font-semibold">本轮产品：</dt><dd className="inline">{productLabel}</dd></div><div><dt className="inline font-semibold">冻结 CTA：</dt><dd className="inline">{item.frozenCta}</dd></div></dl>
      {!expanded ? <Button onClick={() => setExpanded(true)}>{item.status === 'recorded' ? '更正联系号码' : '填写联系号码'}</Button> : <Form layout="vertical" onFinish={() => void submit()}>
        <Form.Item label="联系渠道"><Input value="WhatsApp" disabled /></Form.Item>
        <Form.Item label="企业 WhatsApp 接单号码" htmlFor="weekly-cta-contact-value" required validateStatus={!value.trim() ? 'error' : undefined} help={!value.trim() ? '请填写允许对外展示的真实号码' : undefined}>
          <Input id="weekly-cta-contact-value" className="min-h-11" autoFocus value={value} onChange={event => setValue(event.target.value)} maxLength={64} autoComplete="tel" aria-required="true" aria-invalid={!value.trim()} placeholder="例如：+8613800000000" />
        </Form.Item>
        <p className="mb-3 text-xs leading-5 text-text-secondary">请填写企业当前可用的 WhatsApp 接单号码。本次只记录联系信息；上方冻结 CTA 的免费样品承诺仍需单独核验，不会因此启动付费生产、验收或发布。</p>
        <div className="flex flex-wrap gap-2"><Button className="min-h-11" type="primary" htmlType="submit" loading={busy} disabled={!value.trim() || (item.status === 'recorded' && value.trim() === item.contactValue)}>确认并保存联系信息</Button><Button className="min-h-11" onClick={() => { setValue(item.contactValue || ''); setExpanded(false); }} disabled={busy}>取消</Button></div>
      </Form>}
      {error && <div ref={errorRef} tabIndex={-1}><Alert type="error" showIcon title={error} action={<Button className="min-h-11" loading={busy} onClick={() => void refresh()}>{conflict ? '读取最新版本' : '重新读取'}</Button>} /></div>}
      {item.status === 'recorded' && <p role="status" className="text-xs text-text-secondary">号码已填写：{item.contactValue}。免费样品承诺与其他生产条件仍待核验；本卡不代表成片或发布已完成。</p>}
      {item && <section id={samplePolicySectionId} tabIndex={-1} aria-label="本任务免费样品证据缺口" className="space-y-2 rounded-lg border border-border bg-white p-3">
        <h6 className="text-sm font-semibold text-text-primary">本任务的免费样品证据</h6>
        <Alert type="warning" showIcon title="样品政策待核验" description="联系方式与免费样品政策是独立缺口。此处仅留档候选资料，不接收审批、不会解除生产门禁。" />
        <dl className="space-y-1 text-xs text-text-secondary">
          <div><dt className="inline font-semibold">适用产品：</dt><dd className="inline">{productLabel}</dd></div>
          <div><dt className="inline font-semibold">适用范围：</dt><dd className="inline">请说明具体 SKU、型号或香型，以及地区、客户类型和领取数量限制。</dd></div>
          <div><dt className="inline font-semibold">费用条件：</dt><dd className="inline">请说明样品是否免费、运费及税费由谁承担、是否有先付款或订单门槛。</dd></div>
          <div><dt className="inline font-semibold">有效期：</dt><dd className="inline">请提供政策生效与截止时间，以及目前是否仍可履约。</dd></div>
          <div><dt className="inline font-semibold">企业来源：</dt><dd className="inline">请准备企业授权人确认的政策文件或可核验公告，标明发布主体、版本和适用产品。</dd></div>
        </dl>
        <p className="text-xs leading-5 text-text-secondary">下方可为一个已选品的发布任务留档政策 PDF 候选。文件上传或自由文本本身不等于政策已核验；需另由正式证据审查确认，才可能用于冻结 CTA 的成片准入。</p>
        <WeeklySamplePolicyCandidateIntervention scope={scope} />
      </section>}
    </>}
    {error && !item && <div ref={errorRef} tabIndex={-1}><Alert type="error" showIcon title={error} action={<Button className="min-h-11" loading={busy} onClick={() => void refresh()}>{conflict ? '读取最新版本' : '重新读取'}</Button>} /></div>}
  </section>;
}
