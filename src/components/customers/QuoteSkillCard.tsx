import { useEffect, useState } from 'react';
import { AlertTriangle, BadgeCheck, Calculator, Check, Loader2, MessageSquareText, PencilLine, Sparkles } from 'lucide-react';
import type { CustomerProfile } from '../../types/customer';
import { quoteSkillApi, type QuoteSkillDraft } from '../../lib/quoteSkillApi';

function quoteLikely(customer: CustomerProfile): boolean {
  const latest = [...customer.timeline].reverse().find(event => event.actor === 'buyer')?.body || '';
  return customer.stage === 'inquiry' || customer.stage === 'quoted' || /\b(quote|quotation|price|pricing|rfq|cost)\b|报价|价格|询价|多少钱/i.test(latest);
}

function money(value: number | null, currency: string): string {
  return value == null ? '待人工填写' : `${currency} ${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

export function QuoteSkillCard({ customer, onInsertReply, onToast }: {
  customer: CustomerProfile;
  onInsertReply: (text: string) => void;
  onToast: (text: string) => void;
}) {
  const [draft, setDraft] = useState<QuoteSkillDraft | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [productName, setProductName] = useState('');
  const [material, setMaterial] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [destination, setDestination] = useState('');
  const [incoterm, setIncoterm] = useState('');
  const [packaging, setPackaging] = useState('');
  const [drawingVersion, setDrawingVersion] = useState('');
  const [currency, setCurrency] = useState('CNY');
  const [unit, setUnit] = useState('件');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [validityDays, setValidityDays] = useState('15');

  useEffect(() => {
    let alive = true;
    void quoteSkillApi.availability()
      .then(data => { if (alive) setAvailable(data.enabled); })
      .catch(() => { if (alive) setAvailable(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (available !== true) return;
    let alive = true;
    setDraft(null);
    void quoteSkillApi.latest(customer.id).then(result => { if (alive) setDraft(result.draft); }).catch(() => {});
    return () => { alive = false; };
  }, [available, customer.id]);

  useEffect(() => {
    if (!draft) return;
    setQuantity(draft.quantity == null ? '' : String(draft.quantity));
    setUnitPrice(draft.unitPrice == null ? '' : String(draft.unitPrice));
    setProductName(draft.productName);
    setMaterial(draft.material);
    setDeliveryDate(draft.deliveryDate);
    setDestination(draft.destination);
    setIncoterm(draft.incoterm);
    setPackaging(draft.packaging);
    setDrawingVersion(draft.drawingVersion);
    setCurrency(draft.currency);
    setUnit(draft.unit);
    setPaymentTerms(draft.paymentTerms);
    setValidityDays(String(draft.validityDays));
  }, [draft]);

  if (available !== true || (!quoteLikely(customer) && !draft)) return null;

  const run = async (action: () => Promise<void>) => {
    setLoading(true);
    try { await action(); } catch (error) {
      const message = error instanceof Error ? error.message : '报价能力暂时不可用';
      if (/其他成员更新|刷新后重试/.test(message)) {
        const latest = await quoteSkillApi.latest(customer.id).catch(() => null);
        if (latest) setDraft(latest.draft);
      }
      onToast(message);
    }
    finally { setLoading(false); }
  };

  const createDraft = () => run(async () => {
    const result = await quoteSkillApi.create({
      customerId: customer.id,
      customerName: customer.name,
      customerLanguage: customer.language,
      productHint: customer.product || customer.outboundProduct,
      messages: customer.timeline.filter(event => event.type === 'whatsapp').slice(-12).map(event => event.body),
    });
    setDraft(result.draft);
    onToast(result.draft.status === 'needs_clarification' ? '已整理询盘，请补充缺失信息' : '已生成内部报价草稿');
  });

  const save = () => draft && run(async () => {
    if (!productName.trim() || !material.trim() || !unit.trim() || !destination.trim() || !incoterm.trim() || !paymentTerms.trim() || (!deliveryDate.trim() && !draft.leadTime.trim()) || !(Number(quantity) > 0) || !(Number(unitPrice) > 0) || !Number.isInteger(Number(validityDays)) || Number(validityDays) < 1 || Number(validityDays) > 365) {
      throw new Error('请完整填写产品、数量、材料、单价、交货地点、贸易术语、交期、付款条款和报价有效期');
    }
    const result = await quoteSkillApi.update(draft.id, draft.revision, {
      productName,
      quantity: quantity ? Number(quantity) : null,
      unitPrice: unitPrice ? Number(unitPrice) : null,
      material,
      deliveryDate,
      destination,
      incoterm,
      packaging,
      drawingVersion,
      currency,
      unit,
      paymentTerms,
      validityDays: Number(validityDays),
    });
    setDraft(result.draft);
    setEditing(false);
    onToast('报价草稿已更新');
  });

  const confirm = () => draft && run(async () => {
    const result = await quoteSkillApi.confirm(draft.id, draft.revision);
    setDraft(result.draft);
    onToast('报价已由你确认，仍不会自动发送');
  });

  const generateReply = () => draft && run(async () => {
    const result = await quoteSkillApi.reply(draft.id);
    onInsertReply(result.reply);
    onToast('报价回复已放入输入框，请核对后发送');
  });

  if (!draft) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4" data-quote-skill-card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-black text-emerald-800"><Sparkles size={14} />智能报价能力包</div>
            <p className="mt-1 text-xs leading-5 text-emerald-700">检测到客户可能在询价。Agent 可以整理需求并调用企业产品与报价规则，结果只生成内部草稿。</p>
          </div>
          <button type="button" disabled={loading} onClick={createDraft} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Calculator size={13} />}整理报价
          </button>
        </div>
      </div>
    );
  }

  const ready = draft.status === 'ready_for_review';
  const confirmed = draft.status === 'confirmed';
  return (
    <div className={`rounded-2xl border p-4 ${confirmed ? 'border-emerald-200 bg-emerald-50/60' : ready ? 'border-cyan-200 bg-cyan-50/60' : 'border-amber-200 bg-amber-50/60'}`} data-quote-skill-card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-black text-text-primary">
            {confirmed ? <BadgeCheck size={15} className="text-emerald-700" /> : ready ? <Calculator size={15} className="text-cyan-700" /> : <AlertTriangle size={15} className="text-amber-700" />}
            报价能力包 V{draft.version} · {confirmed ? '人工已确认' : ready ? '待人工确认' : '需要补充信息'}
          </div>
          <p className="mt-1 text-[11px] text-text-muted">正式报价属于 L4 高风险动作，系统不会自动发送。</p>
        </div>
        {!confirmed
          ? <button type="button" onClick={() => setEditing(value => !value)} className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[11px] font-bold text-text-secondary"><PencilLine size={12} />编辑</button>
          : <button type="button" disabled={loading} onClick={createDraft} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-emerald-800 disabled:opacity-50"><Sparkles size={12} />新建报价版本</button>}
      </div>

      {editing ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="col-span-2 text-[11px] font-bold text-text-muted">产品或 SKU<input required maxLength={200} value={productName} onChange={event => setProductName(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary outline-none focus:border-cyan-400" /></label>
          <label className="text-[11px] font-bold text-text-muted">数量<input required min="0.000001" max="1000000000" value={quantity} onChange={event => setQuantity(event.target.value)} inputMode="decimal" type="number" className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary outline-none focus:border-cyan-400" /></label>
          <label className="text-[11px] font-bold text-text-muted">计价单位<input required maxLength={40} value={unit} onChange={event => setUnit(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary outline-none focus:border-cyan-400" /></label>
          <label className="text-[11px] font-bold text-text-muted">币种<select value={currency} onChange={event => setCurrency(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary outline-none focus:border-cyan-400"><option>CNY</option><option>USD</option><option>EUR</option><option>GBP</option><option>JPY</option><option>AUD</option><option>CAD</option><option>SGD</option><option>HKD</option></select></label>
          <label className="text-[11px] font-bold text-text-muted">单价（{currency}）<input required min="0.000001" max="1000000000" value={unitPrice} onChange={event => setUnitPrice(event.target.value)} inputMode="decimal" type="number" className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary outline-none focus:border-cyan-400" /></label>
          <label className="text-[11px] font-bold text-text-muted">材料/规格<input required maxLength={200} value={material} onChange={event => setMaterial(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary outline-none focus:border-cyan-400" /></label>
          <label className="text-[11px] font-bold text-text-muted">目标交期<input required={!draft.leadTime} value={deliveryDate} onChange={event => setDeliveryDate(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary outline-none focus:border-cyan-400" /></label>
          <label className="col-span-2 text-[11px] font-bold text-text-muted">交货地点或港口<input required value={destination} onChange={event => setDestination(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary outline-none focus:border-cyan-400" /></label>
          <label className="text-[11px] font-bold text-text-muted">贸易术语<select required value={incoterm} onChange={event => setIncoterm(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary outline-none focus:border-cyan-400"><option value="">待确认</option><option>EXW</option><option>FCA</option><option>FOB</option><option>CFR</option><option>CIF</option><option>CPT</option><option>CIP</option><option>DAP</option><option>DPU</option><option>DDP</option></select></label>
          <label className="text-[11px] font-bold text-text-muted">图纸版本<input value={drawingVersion} onChange={event => setDrawingVersion(event.target.value)} maxLength={80} className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary outline-none focus:border-cyan-400" /></label>
          <label className="col-span-2 text-[11px] font-bold text-text-muted">包装要求<input value={packaging} onChange={event => setPackaging(event.target.value)} maxLength={200} className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary outline-none focus:border-cyan-400" /></label>
          <label className="text-[11px] font-bold text-text-muted">付款条款<input required value={paymentTerms} onChange={event => setPaymentTerms(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary outline-none focus:border-cyan-400" /></label>
          <label className="text-[11px] font-bold text-text-muted">有效期（天）<input required min="1" max="365" value={validityDays} onChange={event => setValidityDays(event.target.value)} inputMode="numeric" type="number" className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary outline-none focus:border-cyan-400" /></label>
          <button type="button" disabled={loading} onClick={save} className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-xl bg-cyan-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{loading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}保存报价信息</button>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 text-xs">
          <div><p className="text-[10px] font-bold text-text-muted">产品</p><p className="mt-0.5 font-black text-text-primary">{draft.productName || '待确认'}{draft.sku ? ` · ${draft.sku}` : ''}</p></div>
          <div><p className="text-[10px] font-bold text-text-muted">数量</p><p className="mt-0.5 font-black text-text-primary">{draft.quantity ?? '待确认'} {draft.unit}</p></div>
          <div><p className="text-[10px] font-bold text-text-muted">建议单价</p><p className="mt-0.5 font-black text-text-primary">{money(draft.unitPrice, draft.currency)}</p></div>
          <div><p className="text-[10px] font-bold text-text-muted">产品小计</p><p className="mt-0.5 font-black text-text-primary">{money(draft.subtotal, draft.currency)}</p></div>
          <div><p className="text-[10px] font-bold text-text-muted">材料/规格</p><p className="mt-0.5 font-black text-text-primary">{draft.material || '待确认'}</p></div>
          <div><p className="text-[10px] font-bold text-text-muted">参考交期</p><p className="mt-0.5 font-black text-text-primary">{draft.leadTime || draft.deliveryDate || '待确认'}</p></div>
          <div><p className="text-[10px] font-bold text-text-muted">交货地点/港口</p><p className="mt-0.5 font-black text-text-primary">{draft.destination || '待客户补充'}</p></div>
          <div><p className="text-[10px] font-bold text-text-muted">贸易术语</p><p className="mt-0.5 font-black text-text-primary">{draft.incoterm || '待客户补充'}</p></div>
          <div><p className="text-[10px] font-bold text-text-muted">有效期</p><p className="mt-0.5 font-black text-text-primary">{draft.validityDays} 天</p></div>
          {draft.drawingVersion && <div><p className="text-[10px] font-bold text-text-muted">图纸版本</p><p className="mt-0.5 font-black text-text-primary">{draft.drawingVersion}</p></div>}
          {draft.packaging && <div><p className="text-[10px] font-bold text-text-muted">包装要求</p><p className="mt-0.5 font-black text-text-primary">{draft.packaging}</p></div>}
          {draft.paymentTerms && <div className="col-span-2"><p className="text-[10px] font-bold text-text-muted">付款条款</p><p className="mt-0.5 font-black text-text-primary">{draft.paymentTerms}</p></div>}
        </div>
      )}

      {!editing && draft.pricingExplanation.length > 0 && <div className="mt-3 rounded-xl border border-white/80 bg-white/70 px-3 py-2 text-[11px] leading-5 text-text-secondary">{draft.pricingExplanation.map(item => <p key={item}>• {item}</p>)}</div>}
      {!editing && (draft.missingFields.length > 0 || draft.blockers.length > 0) && <div className="mt-3 text-[11px] leading-5 text-amber-800">{[...draft.missingFields.map(item => `缺少：${item}`), ...draft.blockers].map(item => <p key={item}>• {item}</p>)}</div>}

      {!editing && <div className="mt-4 flex flex-wrap justify-end gap-2">
        {draft.clarificationQuestions.length > 0 && !confirmed && <button type="button" onClick={() => onInsertReply(draft.clarificationQuestions.join('\n'))} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-2 text-xs font-black text-text-secondary"><MessageSquareText size={13} />插入澄清问题</button>}
        {ready && <button type="button" disabled={loading} onClick={confirm} className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{loading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}人工确认报价</button>}
        {confirmed && <button type="button" disabled={loading} onClick={generateReply} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{loading ? <Loader2 size={13} className="animate-spin" /> : <MessageSquareText size={13} />}生成客户回复</button>}
      </div>}
    </div>
  );
}
