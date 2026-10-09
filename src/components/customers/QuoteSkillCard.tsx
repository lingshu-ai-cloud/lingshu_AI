import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, BadgeCheck, Calculator, Check, ChevronDown, ChevronUp, Eye, Loader2, PencilLine, Send, Sparkles, X } from 'lucide-react';
import type { CustomerProfile } from '../../types/customer';
import { quoteSkillApi, type QuoteCatalogProduct, type QuoteSkillDraft } from '../../lib/quoteSkillApi';
import AgentDecisionCard from '../AgentDecisionCard';

function money(value: number | null, currency: string): string {
  return value == null ? '待补价' : `${currency} ${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

const fieldClass = 'mt-1 w-full rounded-lg border border-border bg-white px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent';
type CatalogPriceMode = 'catalog' | 'manual';

function catalogRef(product: Pick<QuoteCatalogProduct, 'sku' | 'name'>): string {
  return product.sku || product.name;
}

export function QuoteSkillCard({ customer, onInsertReply, onToast, channelReady, onCardSent }: {
  customer: CustomerProfile;
  onInsertReply: (text: string) => void;
  onToast: (text: string) => void;
  channelReady: boolean;
  onCardSent: (summary: string, providerMessageId?: string) => void;
}) {
  const [draft, setDraft] = useState<QuoteSkillDraft | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [catalog, setCatalog] = useState<QuoteCatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedCatalogRef, setSelectedCatalogRef] = useState('');
  const [catalogPriceMode, setCatalogPriceMode] = useState<CatalogPriceMode>('manual');
  const activeCustomerIdRef = useRef(customer.id);
  const requestGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const previewUrlRef = useRef('');
  const detailsId = useId();
  const [form, setForm] = useState({ productName: '', sku: '', quantity: '', unit: '件', material: '', unitPrice: '', currency: 'CNY', leadTime: '', deliveryDate: '', destination: '', incoterm: '', packaging: '', drawingVersion: '', paymentTerms: '', validityDays: '15' });
  activeCustomerIdRef.current = customer.id;

  const replacePreviewUrl = (nextUrl: string) => {
    const previousUrl = previewUrlRef.current;
    if (previousUrl && previousUrl !== nextUrl) URL.revokeObjectURL(previousUrl);
    previewUrlRef.current = nextUrl;
    setPreviewUrl(nextUrl);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = '';
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void quoteSkillApi.availability().then(data => { if (alive) setAvailable(data.enabled); }).catch(() => { if (alive) setAvailable(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (available !== true) return;
    let alive = true;
    const requestedCustomerId = customer.id;
    const generation = ++requestGenerationRef.current;
    replacePreviewUrl('');
    setDraft(null); setExpanded(false); setEditing(false); setLoading(false);
    setSelectedCatalogRef(''); setCatalogPriceMode('manual');
    void quoteSkillApi.latest(requestedCustomerId).then(result => {
      if (alive && mountedRef.current && activeCustomerIdRef.current === requestedCustomerId && requestGenerationRef.current === generation) setDraft(result.draft);
    }).catch(() => {});
    return () => { alive = false; };
  }, [available, customer.id]);

  useEffect(() => {
    if (available !== true) return;
    let alive = true;
    setCatalogLoading(true);
    void quoteSkillApi.catalog()
      .then(result => { if (alive) setCatalog(result.items); })
      .catch(() => { if (alive) setCatalog([]); })
      .finally(() => { if (alive) setCatalogLoading(false); });
    return () => { alive = false; };
  }, [available]);

  useEffect(() => {
    if (!draft) return;
    setForm({ productName: draft.productName, sku: draft.sku, quantity: draft.quantity == null ? '' : String(draft.quantity), unit: draft.unit, material: draft.material, unitPrice: draft.unitPrice == null ? '' : String(draft.unitPrice), currency: draft.currency, leadTime: draft.leadTime, deliveryDate: draft.deliveryDate, destination: draft.destination, incoterm: draft.incoterm, packaging: draft.packaging, drawingVersion: draft.drawingVersion, paymentTerms: draft.paymentTerms, validityDays: String(draft.validityDays) });
    const matchedRef = draft.matchedProduct ? catalogRef(draft.matchedProduct) : '';
    const manualPrice = draft.unitPriceSource === 'human' || (!draft.unitPriceSource && draft.pricingExplanation.some(item => item.includes('人工填写')));
    setSelectedCatalogRef(matchedRef);
    setCatalogPriceMode(matchedRef && !manualPrice && draft.matchedProduct?.unitPrice != null ? 'catalog' : 'manual');
  }, [draft]);

  if (available !== true) return null;
  const run = async (action: (isCurrent: () => boolean) => Promise<void>) => {
    const requestedCustomerId = customer.id;
    const generation = ++requestGenerationRef.current;
    const isCurrent = () => mountedRef.current && activeCustomerIdRef.current === requestedCustomerId && requestGenerationRef.current === generation;
    setLoading(true);
    try { await action(isCurrent); }
    catch (error) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : '报价能力暂时不可用';
      if (/其他成员更新|刷新后重试/.test(message)) {
        const latest = await quoteSkillApi.latest(requestedCustomerId).catch(() => null);
        if (!isCurrent()) return;
        setDraft(latest?.draft || null);
      }
      onToast(message);
    } finally { if (isCurrent()) setLoading(false); }
  };
  const createDraft = (clonePrevious = false) => run(async isCurrent => { const result = await quoteSkillApi.create({ customerId: customer.id, customerWhatsAppName: customer.whatsappProfileName, customerLanguage: customer.language, productHint: customer.product || customer.outboundProduct, messages: customer.timeline.filter(event => (event.type === 'whatsapp' || event.type === 'messenger' || event.type === 'instagram') && event.actor === 'buyer').slice(-12).map(event => event.body), clonePrevious }); if (!isCurrent()) return; setDraft(result.draft); setExpanded(true); setEditing(false); onToast(clonePrevious ? '已复制上一版，可编辑后重新确认' : result.draft.status === 'needs_clarification' ? '已整理询价，请补齐报价信息' : '报价草稿已生成'); });
  const save = () => draft && run(async isCurrent => { if (!form.productName.trim() || !form.material.trim() || !form.unit.trim() || !form.destination.trim() || !form.incoterm.trim() || !form.paymentTerms.trim() || (!form.deliveryDate.trim() && !form.leadTime.trim()) || !(Number(form.quantity) > 0) || !(Number(form.unitPrice) > 0) || !Number.isInteger(Number(form.validityDays)) || Number(form.validityDays) < 1 || Number(form.validityDays) > 365) throw new Error('请完整填写产品、数量、规格、单价、交货地点、贸易术语、交期、付款条款和有效期'); const result = await quoteSkillApi.update(draft.id, draft.revision, { ...form, quantity: Number(form.quantity), unitPrice: Number(form.unitPrice), validityDays: Number(form.validityDays), ...(selectedCatalogRef ? { catalogProductRef: selectedCatalogRef, catalogPriceMode } : {}) }); if (!isCurrent()) return; setDraft(result.draft); setEditing(false); onToast('报价草稿已更新'); });
  const confirm = () => draft && run(async isCurrent => { const result = await quoteSkillApi.confirm(draft.id, draft.revision); if (!isCurrent()) return; setDraft(result.draft); onToast('报价已人工确认，可预览并发送'); });
  const preview = () => draft && run(async isCurrent => { const blob = await quoteSkillApi.card(draft.id); if (!isCurrent()) return; replacePreviewUrl(URL.createObjectURL(blob)); });
  const insertConfirmedReply = () => draft && run(async isCurrent => { const result = await quoteSkillApi.reply(draft.id); if (isCurrent()) { onInsertReply(result.reply); onToast('已插入报价，请核对后发送'); } });
  const sendCard = () => draft && run(async isCurrent => {
    if (customer.isMock) {
      if (!isCurrent()) return;
      const sentAt = new Date().toISOString();
      setDraft({ ...draft, delivery: { status: 'sent', sentAt, providerMessageId: `mock-${Date.now()}`, imageSha256: 'mock' } });
      onCardSent(`${draft.quoteNumber} · V${draft.version} · ${money(draft.subtotal, draft.currency)}`);
      replacePreviewUrl('');
      onToast('模拟报价卡已发送，仅写入本地会话');
      return;
    }
    let result: Awaited<ReturnType<typeof quoteSkillApi.sendCard>>;
    try {
      result = await quoteSkillApi.sendCard(draft.id);
    } catch (error) {
      // The server persists a sending/outcome-unknown claim before the external
      // call. Refresh even on failure so the UI immediately reflects that lock
      // and never invites a duplicate send for the same quote version.
      const latest = await quoteSkillApi.latest(customer.id).catch(() => null);
      if (isCurrent() && latest?.draft) setDraft(latest.draft);
      throw error;
    }
    if (!isCurrent()) return;
    setDraft(result.draft);
    onCardSent(`${result.draft.quoteNumber} · V${result.draft.version} · ${money(result.draft.subtotal, result.draft.currency)}`, result.providerMessageId);
    replacePreviewUrl('');
    onToast('报价卡已发送到 WhatsApp');
  });

  if (!draft) return <section className="rounded-lg border border-emerald-200 bg-white p-3" data-quote-skill-card><div className="flex items-center gap-2 text-xs font-black text-emerald-800"><Sparkles size={14} />智能报价</div><p className="mt-1 text-[11px] leading-5 text-text-muted">从当前会话提取需求，形成待人工核对的英文报价草稿。</p><button type="button" disabled={loading} onClick={() => createDraft(false)} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{loading ? <Loader2 size={13} className="animate-spin" /> : <Calculator size={13} />}整理报价</button></section>;

  const ready = draft.status === 'ready_for_review';
  const confirmed = draft.status === 'confirmed';
  const sent = draft.delivery?.status === 'sent';
  const deliveryPending = draft.delivery?.status === 'sending' || draft.delivery?.status === 'outcome_unknown';
  const set = (field: keyof typeof form, value: string) => {
    setForm(current => ({ ...current, [field]: value }));
    if (field === 'productName' || field === 'sku') { setSelectedCatalogRef(''); setCatalogPriceMode('manual'); }
    else if ((field === 'unitPrice' || field === 'currency') && selectedCatalogRef) setCatalogPriceMode('manual');
  };
  const selectedCatalogIndex = selectedCatalogRef ? catalog.findIndex(product => catalogRef(product) === selectedCatalogRef) : -1;
  const selectedCatalogProduct = selectedCatalogIndex >= 0 ? catalog[selectedCatalogIndex] : undefined;
  const selectCatalogProduct = (value: string) => {
    if (value === '__custom__') { setSelectedCatalogRef(''); setCatalogPriceMode('manual'); return; }
    const product = catalog[Number(value)];
    if (!product) return;
    setSelectedCatalogRef(catalogRef(product));
    setCatalogPriceMode(product.unitPrice == null ? 'manual' : 'catalog');
    setForm(current => ({
      ...current,
      productName: product.name,
      sku: product.sku,
      material: product.material,
      unit: product.unit || current.unit,
      unitPrice: product.unitPrice == null ? '' : String(product.unitPrice),
      currency: product.currency || current.currency,
      leadTime: product.leadTime,
    }));
  };
  const selectCatalogPriceMode = (mode: CatalogPriceMode) => {
    setCatalogPriceMode(mode);
    if (mode === 'catalog' && selectedCatalogProduct?.unitPrice != null) setForm(current => ({ ...current, unitPrice: String(selectedCatalogProduct.unitPrice), currency: selectedCatalogProduct.currency || current.currency }));
  };
  return <section className="rounded-lg border border-border bg-white p-3" data-quote-skill-card>
    <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="flex items-center gap-1.5 text-xs font-black text-text-primary">{sent || confirmed ? <BadgeCheck size={14} className="text-emerald-700" /> : <AlertTriangle size={14} className="text-amber-700" />}智能报价</p><p className="mt-1 truncate text-[11px] font-bold text-text-secondary">{draft.productName || '产品待确认'} · V{draft.version}</p></div><button type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(value => !value)} className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-accent">{expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}{expanded ? '收起' : '详情'}</button></div>
    <div className="mt-3 grid grid-cols-2 gap-2">{[['状态', sent ? '已发送' : draft.delivery?.status === 'outcome_unknown' ? '发送待核对' : draft.delivery?.status === 'sending' ? '发送处理中' : confirmed ? '已确认' : ready ? '待确认' : '待补充'], ['总额', money(draft.subtotal, draft.currency)], ['数量', draft.quantity == null ? '待确认' : `${draft.quantity} ${draft.unit}`], ['有效期', `${draft.validityDays} 天`]].map(([label, value]) => <div key={label} className="rounded-md bg-slate-50 px-2 py-2"><p className="text-[9px] font-bold text-text-muted">{label}</p><p className="mt-0.5 truncate text-[11px] font-black text-text-primary">{value}</p></div>)}</div>
    {ready && !editing && <div className="mt-3"><AgentDecisionCard
      kind="quote_confirmation"
      title={`确认报价 ${draft.quoteNumber} · V${draft.version}`}
      summary="确认后才可生成对客报价卡并发送；本次确认只覆盖当前版本。"
      cost={money(draft.subtotal, draft.currency)}
      outputs={{ count: 1, format: '报价卡片' }}
      facts={[{ label: '产品', value: draft.productName || '待确认' }, { label: '客户', value: customer.whatsappProfileName || customer.name }]}
      primary={{ label: '人工确认', disabled: loading, onClick: confirm }}
      secondary={{ label: '编辑报价', disabled: loading, onClick: () => setEditing(true) }}
    /></div>}
    <div id={detailsId} hidden={!expanded}>
      {draft.customerBudget && <p className="mt-3 rounded-md bg-amber-50 p-2 text-[11px] text-amber-800">客户预算：{money(draft.customerBudget.amount, draft.customerBudget.currency)}。{draft.customerBudget.currency !== draft.currency ? '与报价币种不同，需人工核对汇率。' : draft.subtotal != null && draft.subtotal > draft.customerBudget.amount ? `产品小计超出预算 ${money(draft.subtotal - draft.customerBudget.amount, draft.currency)}，需与客户确认预算或调整采购方案；运费和税费另行确认。` : '运费和税费另行确认。'}</p>}
      {!confirmed && !editing && <button type="button" disabled={loading} onClick={() => createDraft(false)} className="mt-3 rounded-md border border-border px-2 py-1.5 text-[10px] font-bold">按最新会话重新整理</button>}
      {editing ? <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="col-span-2 text-[10px] font-bold text-text-muted">企业知识库产品<select aria-label="企业知识库产品" className={fieldClass} value={selectedCatalogIndex >= 0 ? String(selectedCatalogIndex) : '__custom__'} onChange={e => selectCatalogProduct(e.target.value)} disabled={catalogLoading}><option value="__custom__">{catalogLoading ? '正在读取产品…' : '自定义产品'}</option>{catalog.map((product, index) => <option key={`${product.sku || product.name}-${index}`} value={index}>{product.name}{product.sku ? ` · ${product.sku}` : ''}{product.unitPrice != null ? ` · ${product.currency} ${product.unitPrice}` : ''}</option>)}</select>{!catalogLoading && !catalog.length && <span className="mt-1 block font-normal text-amber-700">企业知识库暂无产品，可继续手工填写。</span>}</label>
        <label className="col-span-2 text-[10px] font-bold text-text-muted">产品名称<input className={fieldClass} value={form.productName} onChange={e => set('productName', e.target.value)} /></label>
        <label className="text-[10px] font-bold text-text-muted">SKU<input className={fieldClass} value={form.sku} onChange={e => set('sku', e.target.value)} /></label><label className="text-[10px] font-bold text-text-muted">材料/规格<input className={fieldClass} value={form.material} onChange={e => set('material', e.target.value)} /></label>
        <label className="text-[10px] font-bold text-text-muted">数量<input type="number" min="0.000001" className={fieldClass} value={form.quantity} onChange={e => set('quantity', e.target.value)} /></label><label className="text-[10px] font-bold text-text-muted">单位<input className={fieldClass} value={form.unit} onChange={e => set('unit', e.target.value)} /></label>
        <label className="text-[10px] font-bold text-text-muted">币种<select className={fieldClass} value={form.currency} onChange={e => set('currency', e.target.value)}>{['CNY','USD','EUR','GBP','JPY','AUD','CAD','SGD','HKD'].map(value => <option key={value}>{value}</option>)}</select></label><label className="text-[10px] font-bold text-text-muted">单价<input type="number" min="0.000001" className={fieldClass} value={form.unitPrice} onChange={e => set('unitPrice', e.target.value)} /></label>
        {selectedCatalogRef && <label className="col-span-2 text-[10px] font-bold text-text-muted">价格来源<select aria-label="价格来源" className={fieldClass} value={catalogPriceMode} onChange={e => selectCatalogPriceMode(e.target.value as CatalogPriceMode)}><option value="catalog" disabled={selectedCatalogProduct?.unitPrice == null}>使用企业目录价{selectedCatalogProduct?.unitPrice != null ? ` · ${selectedCatalogProduct.currency} ${selectedCatalogProduct.unitPrice}` : '（暂无可用单价）'}</option><option value="manual">人工单价（议价/特批）</option></select>{catalogPriceMode === 'manual' && <span className="mt-1 block font-normal text-amber-700">当前单价按人工报价保存，不会被目录价覆盖。</span>}</label>}
        <label className="text-[10px] font-bold text-text-muted">参考交期<input className={fieldClass} value={form.leadTime} onChange={e => set('leadTime', e.target.value)} /></label><label className="text-[10px] font-bold text-text-muted">目标日期<input className={fieldClass} value={form.deliveryDate} onChange={e => set('deliveryDate', e.target.value)} /></label>
        <label className="col-span-2 text-[10px] font-bold text-text-muted">交货地点/港口<input className={fieldClass} value={form.destination} onChange={e => set('destination', e.target.value)} /></label><label className="text-[10px] font-bold text-text-muted">贸易术语<select className={fieldClass} value={form.incoterm} onChange={e => set('incoterm', e.target.value)}><option value="">待确认</option>{['EXW','FCA','FOB','CFR','CIF','CPT','CIP','DAP','DPU','DDP'].map(value => <option key={value}>{value}</option>)}</select></label><label className="text-[10px] font-bold text-text-muted">有效期（天）<input type="number" min="1" max="365" className={fieldClass} value={form.validityDays} onChange={e => set('validityDays', e.target.value)} /></label>
        <label className="col-span-2 text-[10px] font-bold text-text-muted">付款条款<input className={fieldClass} value={form.paymentTerms} onChange={e => set('paymentTerms', e.target.value)} /></label><label className="col-span-2 text-[10px] font-bold text-text-muted">包装要求<input className={fieldClass} value={form.packaging} onChange={e => set('packaging', e.target.value)} /></label><label className="col-span-2 text-[10px] font-bold text-text-muted">图纸版本<input className={fieldClass} value={form.drawingVersion} onChange={e => set('drawingVersion', e.target.value)} /></label>
        <button type="button" disabled={loading} onClick={save} className="col-span-2 inline-flex items-center justify-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-black text-white"><Check size={12} />保存报价</button>
      </div> : <div className="mt-3 space-y-2 border-t border-border pt-3 text-[11px] text-text-secondary"><p><b>单价：</b>{money(draft.unitPrice, draft.currency)}/{draft.unit}</p><p><b>规格：</b>{draft.material || '待确认'}{draft.sku ? ` · ${draft.sku}` : ''}</p><p><b>交付：</b>{[draft.incoterm, draft.destination, draft.leadTime || draft.deliveryDate].filter(Boolean).join(' · ') || '待确认'}</p><p><b>付款：</b>{draft.paymentTerms || '待确认'}</p>{draft.packaging && <p><b>包装：</b>{draft.packaging}</p>}{draft.drawingVersion && <p><b>图纸：</b>{draft.drawingVersion}</p>}{(draft.missingFields.length > 0 || draft.blockers.length > 0) && <div className="rounded-md bg-amber-50 p-2 text-amber-800">{[...draft.missingFields.map(item => `缺少：${item}`), ...draft.blockers].map(item => <p key={item}>• {item}</p>)}</div>}</div>}
      <div className="mt-3 flex flex-wrap gap-1.5">{!confirmed && (!ready || editing) && <button type="button" onClick={() => setEditing(value => !value)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[10px] font-bold"><PencilLine size={11} />{editing ? '取消编辑' : '编辑'}</button>}{!editing && draft.clarificationQuestions.length > 0 && !confirmed && <button type="button" onClick={() => onInsertReply(draft.clarificationQuestions.join('\n'))} className="rounded-md border border-border px-2 py-1.5 text-[10px] font-bold">插入澄清问题</button>}{!editing && <button type="button" disabled={loading} onClick={preview} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[10px] font-bold"><Eye size={11} />预览卡片</button>}{confirmed && !editing && <button type="button" disabled={loading} onClick={insertConfirmedReply} className="rounded-md border border-border px-2 py-1.5 text-[10px] font-bold">插入报价回复</button>}{confirmed && !editing && <button type="button" disabled={loading} onClick={() => createDraft(true)} className="rounded-md border border-border px-2 py-1.5 text-[10px] font-bold">新建版本</button>}{sent && <p className="self-center text-[10px] font-bold text-emerald-700">该版本已发送</p>}{deliveryPending && <p className="self-center text-[10px] font-bold text-amber-700">该版本已有发送尝试，请先核对回执</p>}</div>
    </div>
    {previewUrl && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-label="报价卡片预览"><div className="w-full max-w-2xl rounded-xl bg-white p-4 shadow-2xl"><div className="flex items-center justify-between"><div><p className="text-sm font-black">报价卡片预览</p><p className="text-[11px] text-text-muted">客户将收到下方图片和报价摘要。</p></div><button type="button" aria-label="关闭预览" onClick={() => replacePreviewUrl('')} className="rounded-md p-2 hover:bg-slate-100"><X size={16} /></button></div><img src={previewUrl} alt="报价卡片" className="mt-3 max-h-[65vh] w-full rounded-lg border border-border object-contain"/><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => replacePreviewUrl('')} className="rounded-lg border border-border px-4 py-2 text-xs font-bold">返回修改</button>{confirmed && customer.source !== 'messenger' && customer.source !== 'instagram' && !draft.delivery && <button type="button" disabled={loading || (!customer.isMock && !channelReady)} onClick={sendCard} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-black text-white disabled:opacity-50">{loading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}发送到 WhatsApp</button>}</div>{!confirmed && <p className="mt-2 text-right text-[10px] text-amber-700">这是草稿预览，人工确认后才能发送。</p>}{confirmed && deliveryPending && <p className="mt-2 text-right text-[10px] text-amber-700">该版本已有发送尝试，为避免重复报价已禁止重发。</p>}{confirmed && customer.source !== 'messenger' && customer.source !== 'instagram' && !customer.isMock && !channelReady && <p className="mt-2 text-right text-[10px] text-amber-700">WhatsApp 通道未连接，暂时不能发送。</p>}</div></div>}
  </section>;
}
