import { Alert, Button, Form, Input, InputNumber, Select, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { getToken } from '../../lib/auth';
import { socialProgramApi, type WeeklyPublicationProductChoices, type WeeklySamplePolicyCandidates, type WeeklySamplePolicyTerms } from '../../lib/socialProgramApi';
import { matchingSamplePolicyCandidate } from './weeklySamplePolicyCandidateRecovery';

type Scope = { programId: string; packageId: string; packageVersion: number };
const MAX_PDF_BYTES = 20 * 1024 * 1024;
type PendingSubmission = { file: File; sourceSha256: string; terms: WeeklySamplePolicyTerms; expectedContextHash: string; token: string | null };
const fileSha256 = async (file: File) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const splitValues = (value: string) => [...new Set(value.split(/[,，;；\n]/).map(part => part.trim()).filter(Boolean))];
const readPdfDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const encoded = typeof reader.result === 'string' ? /^data:[^,]*;base64,([A-Za-z0-9+/]+={0,2})$/.exec(reader.result)?.[1] : null;
    encoded ? resolve(`data:application/pdf;base64,${encoded}`) : reject(Error('PDF 读取失败'));
  };
  reader.onerror = () => reject(Error('PDF 读取失败'));
  reader.readAsDataURL(file);
});

/** Documentary intake only. Neither this form nor a saved candidate approves the sample promise. */
export default function WeeklySamplePolicyCandidateIntervention({ scope }: { scope: Scope }) {
  const identity = `${scope.programId}:${scope.packageId}:${scope.packageVersion}`;
  const current = useRef(identity);
  const lastIdentity = useRef(identity);
  const selectedTask = useRef<string | null>(null);
  const uncertainTasks = useRef(new Map<string, PendingSubmission>());
  const errorRef = useRef<HTMLDivElement>(null);
  current.current = identity;
  const [choices, setChoices] = useState<WeeklyPublicationProductChoices | null>(null);
  const [publicationTaskId, setPublicationTaskId] = useState<string | null>(null);
  selectedTask.current = publicationTaskId;
  const [view, setView] = useState<WeeklySamplePolicyCandidates | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [shippingFeePayer, setShippingFeePayer] = useState<'seller' | 'buyer' | null>(null);
  const [customsDutyPayer, setCustomsDutyPayer] = useState<'seller' | 'buyer' | null>(null);
  const [quantity, setQuantity] = useState<number | null>(null);
  const [markets, setMarkets] = useState('');
  const [customerTypes, setCustomerTypes] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submissionUncertain, setSubmissionUncertain] = useState(false);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    const onSelection = (event: Event) => {
      const detail = (event as CustomEvent<{programId:string;packageId:string;packageVersion:number}>).detail;
      if (detail?.programId === scope.programId && detail.packageId === scope.packageId && detail.packageVersion === scope.packageVersion) setSelectionRevision(value => value + 1);
    };
    window.addEventListener('lingshu:weekly-product-selection-updated', onSelection);
    return () => window.removeEventListener('lingshu:weekly-product-selection-updated', onSelection);
  }, [identity]);
  useEffect(() => {
    const token = getToken(); let live = true;
    if(lastIdentity.current!==identity){uncertainTasks.current.clear();lastIdentity.current=identity;}
    setChoices(null); setPublicationTaskId(null); setView(null); setFile(null); setError(''); setSubmitted(false); setSubmissionUncertain(false); setLoading(true);
    void socialProgramApi.readWeeklyPublicationProductChoices(scope.programId, scope.packageId, scope.packageVersion)
      .then(next => { if (live && current.current === identity && getToken() === token) setChoices(next); })
      .catch(cause => { if (live && current.current === identity && getToken() === token) setError(cause instanceof Error ? cause.message : '发布选品读取失败。'); })
      .finally(() => { if (live && current.current === identity && getToken() === token) setLoading(false); });
    return () => { live = false; };
  }, [identity, selectionRevision]);
  useEffect(() => {
    if (!publicationTaskId || !choices) { setView(null); return; }
    const token = getToken(); let live = true;
    setView(null); setError(''); setSubmitted(false); setSubmissionUncertain(uncertainTasks.current.has(publicationTaskId)); setLoading(true);
    void socialProgramApi.readWeeklySamplePolicyCandidates(scope.programId, scope.packageId, scope.packageVersion, publicationTaskId)
      .then(next => {
        if (!live || current.current !== identity || getToken() !== token) return;
        const selected = choices.publications.find(item => item.publicationTaskId === publicationTaskId);
        if (next.policyStatus !== 'candidate_only' || next.selection.productId !== selected?.selectedProductId) throw Error('样品候选与本任务的已签发选品不一致。');
        setView(next);
        const uncertain = uncertainTasks.current.get(publicationTaskId);
        if (uncertain && uncertain.token === getToken() && matchingSamplePolicyCandidate(next, uncertain.sourceSha256, uncertain.terms)) {
          uncertainTasks.current.delete(publicationTaskId); setSubmissionUncertain(false); setSubmitted(true); setFile(null);
        }
      })
      .catch(cause => { if (live && current.current === identity && getToken() === token) setError(cause instanceof Error ? cause.message : '样品候选读取失败。'); })
      .finally(() => { if (live && current.current === identity && getToken() === token) setLoading(false); });
    return () => { live = false; };
  }, [identity, publicationTaskId, choices]);

  const eligible = choices?.selectionState === 'consistent' ? choices.publications.filter(item => item.selectedProductId !== null) ?? [] : [];
  const selected = eligible.find(item => item.publicationTaskId === publicationTaskId);
  const groupNumber = selected ? [...new Set(choices!.publications.map(item => item.motherContentId))].indexOf(selected.motherContentId) + 1 : null;
  const terms = (): WeeklySamplePolicyTerms | null => {
    const from = Date.parse(validFrom), until = Date.parse(validUntil);
    if (!shippingFeePayer || !customsDutyPayer || !Number.isSafeInteger(quantity) || (quantity ?? 0) < 1
      || !splitValues(markets).length || !splitValues(customerTypes).length
      || !Number.isFinite(from) || !Number.isFinite(until) || until <= from) return null;
    return { sampleFeeCny: 0, shippingFeePayer, customsDutyPayer, maximumFreeQuantity: quantity!, eligibleMarkets: splitValues(markets), eligibleCustomerTypes: splitValues(customerTypes), validFrom: new Date(from).toISOString(), validUntil: new Date(until).toISOString() };
  };
  const canSubmit = !!view && !!selected && !!file && !busy && !submissionUncertain && !!terms();
  const submit = async () => {
    const validTerms = terms();
    if (!canSubmit || !view || !selected || !file || !validTerms) return;
    const captured = identity, taskId = selected.publicationTaskId, token = getToken(); let requestStarted=false; setBusy(true); setError(''); setSubmitted(false);
    try {
      if (file.size < 1 || file.size > MAX_PDF_BYTES || await file.slice(0, 5).text() !== '%PDF-') throw Error('仅接受不超过 20 MiB 的真实 PDF 文件。');
      const sourceSha256 = await fileSha256(file);
      const pdfDataUrl = await readPdfDataUrl(file);
      if (current.current !== captured || selectedTask.current !== taskId || getToken() !== token) return;
      uncertainTasks.current.set(taskId, { file, sourceSha256, terms: validTerms, expectedContextHash: view.contextHash, token });
      requestStarted=true;
      await socialProgramApi.submitWeeklySamplePolicyCandidate(scope.programId, scope.packageId, scope.packageVersion, { publicationTaskId: taskId, expectedContextHash: view.contextHash, terms: validTerms, pdfDataUrl });
      const next = await socialProgramApi.readWeeklySamplePolicyCandidates(scope.programId, scope.packageId, scope.packageVersion, taskId);
      if (current.current !== captured || selectedTask.current !== taskId || getToken() !== token) return;
      if (next.policyStatus !== 'candidate_only' || next.selection.productId !== selected.selectedProductId) throw Error('候选已提交，但回读的任务选品不一致。');
      if (!matchingSamplePolicyCandidate(next, sourceSha256, validTerms)) throw Error('原提交回执尚未核清。');
      uncertainTasks.current.delete(taskId);
      setView(next); setFile(null); setSubmitted(true); setSubmissionUncertain(false);
    } catch (cause) {
      if (current.current === captured && selectedTask.current === taskId && getToken() === token) { if(requestStarted)setSubmissionUncertain(true); setError(`${cause instanceof Error ? cause.message : '提交失败'}；如已发出请求，请先重新读取原候选。`); }
    } finally { if (current.current === captured && getToken() === token) setBusy(false); }
  };
  const refresh = async () => {
    if (!publicationTaskId) return;
    const captured = identity, taskId=publicationTaskId, token = getToken(); setBusy(true); setError('');
    try {
      const next = await socialProgramApi.readWeeklySamplePolicyCandidates(scope.programId, scope.packageId, scope.packageVersion, publicationTaskId);
      if (current.current === captured && selectedTask.current === taskId && getToken() === token) {
        setView(next);
        const uncertain = uncertainTasks.current.get(taskId);
        if (uncertain && uncertain.token === token && matchingSamplePolicyCandidate(next, uncertain.sourceSha256, uncertain.terms)) {
          uncertainTasks.current.delete(taskId); setSubmissionUncertain(false); setSubmitted(true); setFile(null);
        }
      }
    } catch (cause) { if (current.current === captured && selectedTask.current === taskId && getToken() === token) setError(cause instanceof Error ? cause.message : '重新读取候选失败。'); }
    finally { if (current.current === captured && getToken() === token) setBusy(false); }
  };
  const retryOriginal = async () => {
    if (!publicationTaskId) return;
    const taskId = publicationTaskId, pending = uncertainTasks.current.get(taskId), captured = identity, token = getToken();
    if (!pending || pending.token !== token || busy) return;
    setBusy(true); setError('');
    try {
      const pdfDataUrl = await readPdfDataUrl(pending.file);
      if (current.current !== captured || selectedTask.current !== taskId || getToken() !== token) return;
      await socialProgramApi.submitWeeklySamplePolicyCandidate(scope.programId, scope.packageId, scope.packageVersion, { publicationTaskId: taskId, expectedContextHash: pending.expectedContextHash, terms: pending.terms, pdfDataUrl });
      const next = await socialProgramApi.readWeeklySamplePolicyCandidates(scope.programId, scope.packageId, scope.packageVersion, taskId);
      if (current.current !== captured || selectedTask.current !== taskId || getToken() !== token) return;
      if (!matchingSamplePolicyCandidate(next, pending.sourceSha256, pending.terms)) throw Error('原提交回执尚未核清。');
      uncertainTasks.current.delete(taskId); setView(next); setSubmissionUncertain(false); setSubmitted(true); setFile(null);
    } catch (cause) {
      if (current.current === captured && selectedTask.current === taskId && getToken() === token) setError(`${cause instanceof Error ? cause.message : '原提交恢复失败'}；请核验原回执，不要更换 PDF 或条款。`);
    } finally { if (current.current === captured && getToken() === token) setBusy(false); }
  };

  return <section aria-label="本任务免费样品政策候选资料" className="space-y-3 rounded-lg border border-border bg-white p-3">
    <div className="flex flex-wrap items-center gap-2"><h6 className="text-sm font-semibold text-text-primary">免费样品政策候选资料</h6><Tag color="warning">待独立核验</Tag></div>
    <Alert type="warning" showIcon title="上传不等于通过" description="本次仅为所选发布任务留档候选 PDF 与适用范围；不自动覆盖其他发布任务，不解除免费样品成片门禁，也不授权发布或客户消息。" />
    {loading && <p role="status" className="text-xs text-text-muted">正在读取当前任务证据…</p>}
    {choices && choices.selectionState !== 'consistent' && <Alert type="error" showIcon title="发布选品尚未完整" description="原选品签发需先恢复；样品候选不能绑定不完整的商品身份。" />}
    {choices && choices.selectionState === 'consistent' && eligible.length === 0 && <Alert type="info" showIcon title="请先完成发布选品" description="样品政策必须绑定当前发布任务的认证商品回执；不能从采集产品或货盘目录推断。" />}
    {eligible.length > 0 && <Form layout="vertical" onFinish={() => void submit()}>
      <Form.Item label="本次留档的发布任务" required htmlFor={`weekly-sample-policy-task-${scope.packageId}-${scope.packageVersion}`}>
        <Select id={`weekly-sample-policy-task-${scope.packageId}-${scope.packageVersion}`} aria-label="本次留档的发布任务" className="min-h-11 [&_.ant-select-selector]:!min-h-11" value={publicationTaskId} disabled={busy} onChange={value => { setPublicationTaskId(value); setFile(null); }} placeholder="明确选择一个已选品任务" options={eligible.map((item, index) => ({ value: item.publicationTaskId, label: `发布任务 ${index + 1} · ${item.publicationTaskId}` }))} />
      </Form.Item>
      {selected && <p className="text-xs text-text-secondary">仅对应发布任务 {selected.publicationTaskId} · 母版组 {groupNumber}。同组其他任务不因本次上传自动获得候选或政策通过。</p>}
      {view && <><p className="text-xs text-text-secondary">已签发商品：{view.selection.productName}{view.selection.productSku ? ` · SKU ${view.selection.productSku}` : ' · SKU 未登记'}。冻结 CTA：{view.frozenCta}</p>
        <p className="text-xs text-text-secondary">当前已有 {view.candidates.length} 份候选，均为“待独立核验”；现无正式政策通过回执。</p>
        <Form.Item label="免费样品数量上限" required><InputNumber className="!w-full min-h-11 [&_.ant-input-number-input]:!min-h-11" min={1} precision={0} value={quantity} onChange={setQuantity} placeholder="每位符合条件客户最多可领数量" /></Form.Item>
        <Form.Item label="运费承担方" required><Select aria-label="运费承担方" className="min-h-11 [&_.ant-select-selector]:!min-h-11" value={shippingFeePayer} onChange={setShippingFeePayer} placeholder="请选择" options={[{value:'seller',label:'企业承担'},{value:'buyer',label:'客户承担'}]} /></Form.Item>
        <Form.Item label="关税承担方" required><Select aria-label="关税承担方" className="min-h-11 [&_.ant-select-selector]:!min-h-11" value={customsDutyPayer} onChange={setCustomsDutyPayer} placeholder="请选择" options={[{value:'seller',label:'企业承担'},{value:'buyer',label:'客户承担'}]} /></Form.Item>
        <Form.Item label="适用市场" required><Input className="min-h-11" value={markets} onChange={event => setMarkets(event.target.value)} placeholder="例如：越南，美国；可用逗号分隔" /></Form.Item>
        <Form.Item label="适用客户类型" required><Input className="min-h-11" value={customerTypes} onChange={event => setCustomerTypes(event.target.value)} placeholder="例如：批发采购商；可用逗号分隔" /></Form.Item>
        <Form.Item label="生效时间" required><Input className="min-h-11" type="datetime-local" value={validFrom} onChange={event => setValidFrom(event.target.value)} /></Form.Item>
        <Form.Item label="截止时间" required><Input className="min-h-11" type="datetime-local" value={validUntil} onChange={event => setValidUntil(event.target.value)} /></Form.Item>
        <Form.Item label="企业政策 PDF" required><input className="block min-h-11 w-full rounded-lg border border-border bg-white p-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label="企业政策 PDF" type="file" accept="application/pdf,.pdf" onChange={event => setFile(event.target.files?.[0] ?? null)} /></Form.Item>
        <p className="text-xs leading-5 text-text-secondary">样品本体费用固定为 0 元；请在 PDF 中明确适用商品、客户、地区、数量、运税条件、有效期与企业授权来源。PDF 不超过 20 MiB。上传后仍需独立审核，当前不会进入成片。</p>
        <Button className="min-h-11" type="primary" htmlType="submit" loading={busy} disabled={!canSubmit}>提交本任务政策候选</Button>
        {submissionUncertain && <div role="status" className="space-y-2 text-xs text-text-secondary"><p>原提交结果尚未确认。请先重读候选；若仍无相同 PDF 与条款的回执，仅可重试缓存的原请求，不可改传新文件。</p><Button className="min-h-11" onClick={() => void retryOriginal()} loading={busy}>重试原提交（同一请求）</Button></div>}
      </>}
    </Form>}
    {submitted && <Alert type="info" showIcon title="候选已留档，仍待独立核验" description="本次仅记录所选发布任务的候选资料，成片与发布仍受阻。" />}
    {error && <div ref={errorRef} tabIndex={-1}><Alert type="error" showIcon title={error} action={publicationTaskId && <Button className="min-h-11" onClick={() => void refresh()} loading={busy}>重新读取候选</Button>} /></div>}
  </section>;
}
