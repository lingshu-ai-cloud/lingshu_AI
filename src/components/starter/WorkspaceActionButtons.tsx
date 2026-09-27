import { useState } from 'react';
import { Check, Download, Loader2, MessageSquarePlus, Send, X } from 'lucide-react';
import {
  starterWorkspaceApi,
  starterWorkspaceCommandTargetId,
  type StarterWorkspaceAction,
  type StarterWorkspaceCommandInput,
} from '../../lib/starterWorkspace';

const COMPOSER_COMMANDS = new Set(['confirm_initial_setup', 'confirm_quote_rule', 'submit_quote_inquiry', 'submit_orchestrator_input', 'resolve_decision', 'cancel_run', 'submit_publication_evidence', 'submit_quote_send_evidence']);

const EMPTY_SETUP = {
  companyName: '', industry: '', primaryBusiness: '', focusProducts: '',
  targetMarkets: '', customerProfile: '', primaryPlatform: 'tiktok',
  primaryLanguage: 'en', constraints: '',
};

const EMPTY_QUOTE_RULE = {
  sku: '', currency: 'USD', unitPrice: '', unitCost: '', moq: '100', incoterm: 'FOB',
  shippingFlatFee: '0', taxRateBps: '0', paymentTerm: 'T/T 30% deposit, 70% before shipment',
  leadTimeDays: '30', validDays: '14', minMarginBps: '1000', sourceReference: '',
};

const EMPTY_QUOTE_INQUIRY = {
  sourceChannel: 'manual', sourceReference: '', quantity: '', destinationCountry: '',
};

interface Props {
  actions: StarterWorkspaceAction[];
  targetId: string;
  pendingCommand: string | null;
  onExecute: (input: StarterWorkspaceCommandInput) => Promise<unknown>;
}

function actionStyle(kind: StarterWorkspaceAction['kind']): string {
  if (kind === 'primary') return 'border-accent bg-accent text-white hover:bg-accent-dim';
  if (kind === 'danger') return 'border-red-200 bg-white text-red-700 hover:bg-red-50';
  return 'border-border bg-white text-text-secondary hover:bg-surface-2 hover:text-text-primary';
}

export default function WorkspaceActionButtons({ actions, targetId, pendingCommand, onExecute }: Props) {
  const [composerAction, setComposerAction] = useState<StarterWorkspaceAction | null>(null);
  const [input, setInput] = useState('');
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [publicUrl, setPublicUrl] = useState('');
  const [platformPostId, setPlatformPostId] = useState('');
  const [quoteChannel, setQuoteChannel] = useState('');
  const [quoteReference, setQuoteReference] = useState('');
  const [setup, setSetup] = useState(EMPTY_SETUP);
  const [quoteRule, setQuoteRule] = useState(EMPTY_QUOTE_RULE);
  const [quoteInquiry, setQuoteInquiry] = useState(EMPTY_QUOTE_INQUIRY);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState('');

  if (actions.length === 0) return null;

  const execute = async (selected: StarterWorkspaceAction, payload?: Record<string, unknown>) => {
    if (!selected.command) return;
    if (selected.kind === 'danger' && !window.confirm(`确认“${selected.label}”？系统会先安全处理在途任务。`)) return;
    const commandTargetId = starterWorkspaceCommandTargetId(selected.command, targetId);
    await onExecute({
      command: selected.command,
      ...(commandTargetId ? { targetId: commandTargetId } : {}),
      expectedVersion: selected.expectedVersion || undefined,
      ...(payload && Object.keys(payload).length > 0 ? { payload } : {}),
    });
    setComposerAction(null);
    setInput('');
    setDecision('approved');
    setPublicUrl('');
    setPlatformPostId('');
    setQuoteChannel('');
    setQuoteReference('');
    setSetup(EMPTY_SETUP);
    setQuoteRule(EMPTY_QUOTE_RULE);
    setQuoteInquiry(EMPTY_QUOTE_INQUIRY);
  };

  const composerPayload = (): Record<string, unknown> => {
    if (!composerAction) return {};
    if (composerAction.command === 'confirm_initial_setup') return {
      companyName: setup.companyName.trim(),
      industry: setup.industry.trim(),
      primaryBusiness: setup.primaryBusiness.trim(),
      focusProducts: setup.focusProducts.trim(),
      targetMarkets: setup.targetMarkets.trim(),
      customerProfile: setup.customerProfile.trim(),
      primaryPlatform: setup.primaryPlatform,
      primaryLanguage: setup.primaryLanguage,
      constraints: setup.constraints.split('\n').map(item => item.trim()).filter(Boolean).slice(0, 10),
    };
    if (composerAction.command === 'submit_orchestrator_input') return { input: input.trim() };
    if (composerAction.command === 'confirm_quote_rule') return {
      sku: quoteRule.sku.trim(),
      currency: quoteRule.currency,
      unitPrice: quoteRule.unitPrice.trim(),
      unitCost: quoteRule.unitCost.trim(),
      moq: Number(quoteRule.moq),
      incoterm: quoteRule.incoterm,
      shippingFlatFee: quoteRule.shippingFlatFee.trim(),
      taxRateBps: Number(quoteRule.taxRateBps),
      paymentTerm: quoteRule.paymentTerm.trim(),
      leadTimeDays: Number(quoteRule.leadTimeDays),
      validDays: Number(quoteRule.validDays),
      minMarginBps: Number(quoteRule.minMarginBps),
      sourceReference: quoteRule.sourceReference.trim(),
    };
    if (composerAction.command === 'submit_quote_inquiry') return {
      sourceChannel: quoteInquiry.sourceChannel,
      sourceReference: quoteInquiry.sourceReference.trim(),
      quantity: Number(quoteInquiry.quantity),
      destinationCountry: quoteInquiry.destinationCountry.trim().toUpperCase(),
    };
    if (composerAction.command === 'resolve_decision') return { decision, note: input.trim() };
    if (composerAction.command === 'cancel_run') return input.trim() ? { reason: input.trim() } : {};
    if (composerAction.command === 'submit_publication_evidence') {
      return {
        ...(publicUrl.trim() ? { publicUrl: publicUrl.trim() } : {}),
        ...(platformPostId.trim() ? { platformPostId: platformPostId.trim() } : {}),
      };
    }
    if (composerAction.command === 'submit_quote_send_evidence') {
      return {
        channel: quoteChannel.trim(),
        providerReference: quoteReference.trim(),
      };
    }
    return {};
  };

  const composerReady = !composerAction ? false
    : composerAction.command === 'confirm_initial_setup'
      ? [setup.companyName, setup.industry, setup.primaryBusiness, setup.focusProducts, setup.targetMarkets, setup.customerProfile].every(value => Boolean(value.trim()))
    : composerAction.command === 'confirm_quote_rule'
      ? [quoteRule.sku, quoteRule.unitPrice, quoteRule.unitCost, quoteRule.moq, quoteRule.paymentTerm, quoteRule.sourceReference].every(value => Boolean(value.trim()))
        && [quoteRule.moq, quoteRule.taxRateBps, quoteRule.leadTimeDays, quoteRule.validDays, quoteRule.minMarginBps].every(value => Number.isSafeInteger(Number(value)))
    : composerAction.command === 'submit_quote_inquiry'
      ? Boolean(quoteInquiry.sourceReference.trim() && quoteInquiry.destinationCountry.trim().length === 2)
        && Number.isSafeInteger(Number(quoteInquiry.quantity)) && Number(quoteInquiry.quantity) > 0
    : composerAction.command === 'submit_orchestrator_input' ? Boolean(input.trim())
      : composerAction.command === 'submit_publication_evidence' ? Boolean(publicUrl.trim() || platformPostId.trim())
        : composerAction.command === 'submit_quote_send_evidence'
          ? Boolean(quoteChannel.trim() && quoteReference.trim())
        : true;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex flex-wrap gap-2">
        {actions.map(item => {
          const pendingTargetId = item.command ? starterWorkspaceCommandTargetId(item.command, targetId) : undefined;
          const isPending = pendingCommand === `${item.command}:${pendingTargetId ?? ''}`;
          if (item.kind === 'download') {
            return item.href ? (
              <button
                key={item.id}
                type="button"
                disabled={Boolean(downloadingId)}
                onClick={() => {
                  setDownloadingId(item.id);
                  setDownloadError('');
                  void starterWorkspaceApi.download(item.href!).catch(error => {
                    setDownloadError(error instanceof Error ? error.message : '文件下载失败');
                  }).finally(() => setDownloadingId(null));
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-accent bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-accent-dim"
              >
                {downloadingId === item.id ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Download size={13} aria-hidden="true" />}{item.label}
              </button>
            ) : (
              <button key={item.id} type="button" disabled className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-muted opacity-60">
                <Download size={13} aria-hidden="true" />{item.label}
              </button>
            );
          }
          if (!item.command) return null;
          const itemCommand = item.command;
          return (
            <button
              key={item.id}
              type="button"
              disabled={Boolean(item.disabledReason) || Boolean(pendingCommand)}
              title={item.disabledReason || undefined}
              onClick={() => COMPOSER_COMMANDS.has(itemCommand) ? setComposerAction(item) : void execute(item).catch(() => {})}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${actionStyle(item.kind)}`}
            >
              {isPending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : item.kind === 'primary' ? <Check size={13} aria-hidden="true" /> : <MessageSquarePlus size={13} aria-hidden="true" />}
              {item.label}
            </button>
          );
        })}
      </div>
      {downloadError && <p role="alert" className="mt-2 text-xs text-red-700">{downloadError}</p>}

      {composerAction && (
        <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold text-text-primary">{composerAction.label}</p>
            <button type="button" onClick={() => { setComposerAction(null); setInput(''); setDecision('approved'); setPublicUrl(''); setPlatformPostId(''); setQuoteChannel(''); setQuoteReference(''); setSetup(EMPTY_SETUP); setQuoteRule(EMPTY_QUOTE_RULE); setQuoteInquiry(EMPTY_QUOTE_INQUIRY); }} aria-label="关闭补充输入" className="text-text-muted hover:text-text-primary">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          {composerAction.command === 'resolve_decision' && (
            <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label="决策结果">
              <button type="button" onClick={() => setDecision('approved')} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${decision === 'approved' ? 'border-accent bg-emerald-50 text-accent' : 'border-border bg-white text-text-secondary'}`}>同意建议</button>
              <button type="button" onClick={() => setDecision('rejected')} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${decision === 'rejected' ? 'border-red-300 bg-red-50 text-red-700' : 'border-border bg-white text-text-secondary'}`}>退回调整</button>
            </div>
          )}
          {composerAction.command === 'confirm_initial_setup' ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <p className="sm:col-span-2 text-[11px] leading-relaxed text-text-muted">只需确认一次。灵小枢会据此固化一个品牌、一个主推产品和一套安全执行边界；不会连接发布账号或开启自动外发。</p>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">企业名称<input value={setup.companyName} onChange={event => setSetup(current => ({ ...current, companyName: event.target.value }))} maxLength={120} className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">所属行业<input value={setup.industry} onChange={event => setSetup(current => ({ ...current, industry: event.target.value }))} maxLength={120} className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary sm:col-span-2">主要业务<input value={setup.primaryBusiness} onChange={event => setSetup(current => ({ ...current, primaryBusiness: event.target.value }))} maxLength={500} placeholder="例如：保温杯 OEM / ODM" className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">本轮唯一主推产品<input value={setup.focusProducts} onChange={event => setSetup(current => ({ ...current, focusProducts: event.target.value }))} maxLength={500} className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">目标市场<input value={setup.targetMarkets} onChange={event => setSetup(current => ({ ...current, targetMarkets: event.target.value }))} maxLength={300} placeholder="例如：德国" className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary sm:col-span-2">核心客户<input value={setup.customerProfile} onChange={event => setSetup(current => ({ ...current, customerProfile: event.target.value }))} maxLength={500} placeholder="例如：礼品经销商" className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">首发平台<select value={setup.primaryPlatform} onChange={event => setSetup(current => ({ ...current, primaryPlatform: event.target.value }))} className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary"><option value="tiktok">TikTok</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="youtube">YouTube</option></select></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">内容语言<select value={setup.primaryLanguage} onChange={event => setSetup(current => ({ ...current, primaryLanguage: event.target.value }))} className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary"><option value="en">English</option><option value="de">Deutsch</option><option value="fr">Français</option><option value="es">Español</option><option value="pt">Português</option></select></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary sm:col-span-2">不能违反的规则（可选，每行一条）<textarea value={setup.constraints} onChange={event => setSetup(current => ({ ...current, constraints: event.target.value }))} rows={2} maxLength={2400} placeholder="例如：不得编造材质、认证和交期" className="resize-y border border-border bg-white px-3 py-2 text-sm font-normal leading-relaxed text-text-primary" /></label>
            </div>
          ) : composerAction.command === 'confirm_quote_rule' ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <p className="sm:col-span-2 text-[11px] leading-relaxed text-text-muted">首次确认后形成不可变规则版本。灵小售只做确定性计算，AI 不能改价格、折扣、账期或交期；更新规则会生成新版本。</p>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">产品 SKU<input value={quoteRule.sku} onChange={event => setQuoteRule(current => ({ ...current, sku: event.target.value }))} maxLength={80} placeholder="例如 CUP-500-BLK" className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">币种<select value={quoteRule.currency} onChange={event => setQuoteRule(current => ({ ...current, currency: event.target.value }))} className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary"><option value="USD">USD</option><option value="EUR">EUR</option><option value="CNY">CNY</option><option value="GBP">GBP</option></select></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">含税前单价<input value={quoteRule.unitPrice} onChange={event => setQuoteRule(current => ({ ...current, unitPrice: event.target.value }))} inputMode="decimal" placeholder="例如 8.50" className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">单位成本<input value={quoteRule.unitCost} onChange={event => setQuoteRule(current => ({ ...current, unitCost: event.target.value }))} inputMode="decimal" placeholder="例如 5.20" className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">MOQ<input value={quoteRule.moq} onChange={event => setQuoteRule(current => ({ ...current, moq: event.target.value }))} inputMode="numeric" className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">贸易条款<select value={quoteRule.incoterm} onChange={event => setQuoteRule(current => ({ ...current, incoterm: event.target.value }))} className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary"><option value="EXW">EXW</option><option value="FOB">FOB</option><option value="CIF">CIF</option><option value="DDP">DDP</option></select></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">固定运费<input value={quoteRule.shippingFlatFee} onChange={event => setQuoteRule(current => ({ ...current, shippingFlatFee: event.target.value }))} inputMode="decimal" className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">税率（基点，100=1%）<input value={quoteRule.taxRateBps} onChange={event => setQuoteRule(current => ({ ...current, taxRateBps: event.target.value }))} inputMode="numeric" className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary sm:col-span-2">付款条款<input value={quoteRule.paymentTerm} onChange={event => setQuoteRule(current => ({ ...current, paymentTerm: event.target.value }))} maxLength={120} className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">标准交期（天）<input value={quoteRule.leadTimeDays} onChange={event => setQuoteRule(current => ({ ...current, leadTimeDays: event.target.value }))} inputMode="numeric" className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">报价有效期（天）<input value={quoteRule.validDays} onChange={event => setQuoteRule(current => ({ ...current, validDays: event.target.value }))} inputMode="numeric" className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">最低毛利（基点）<input value={quoteRule.minMarginBps} onChange={event => setQuoteRule(current => ({ ...current, minMarginBps: event.target.value }))} inputMode="numeric" className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">规则依据编号<input value={quoteRule.sourceReference} onChange={event => setQuoteRule(current => ({ ...current, sourceReference: event.target.value }))} maxLength={160} placeholder="例如 price-list-2026-09" className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
            </div>
          ) : composerAction.command === 'submit_quote_inquiry' ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <p className="sm:col-span-2 text-[11px] leading-relaxed text-text-muted">只录入报价所需事实。请填写外部系统里的不透明询盘编号，不要粘贴客户消息、姓名、手机号或邮箱；系统不会自动联系客户。</p>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">来源<select value={quoteInquiry.sourceChannel} onChange={event => setQuoteInquiry(current => ({ ...current, sourceChannel: event.target.value }))} className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary"><option value="manual">手工录入</option><option value="whatsapp">WhatsApp</option><option value="email">邮件</option><option value="trade_show">展会</option><option value="other">其他</option></select></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">询盘引用编号<input value={quoteInquiry.sourceReference} onChange={event => setQuoteInquiry(current => ({ ...current, sourceReference: event.target.value }))} maxLength={120} placeholder="例如 wa_msg_8f31a2（不要填联系方式）" className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">数量<input value={quoteInquiry.quantity} onChange={event => setQuoteInquiry(current => ({ ...current, quantity: event.target.value }))} inputMode="numeric" placeholder="例如 500" className="border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary" /></label>
              <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">目的国二字码<input value={quoteInquiry.destinationCountry} onChange={event => setQuoteInquiry(current => ({ ...current, destinationCountry: event.target.value.toUpperCase() }))} maxLength={2} placeholder="例如 DE" className="border border-border bg-white px-3 py-2 text-sm font-normal uppercase text-text-primary" /></label>
            </div>
          ) : composerAction.command === 'submit_publication_evidence' ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input value={publicUrl} onChange={event => setPublicUrl(event.target.value)} type="url" placeholder="公开发布 URL" className="w-full border border-border bg-white px-3 py-2 text-sm" />
              <input value={platformPostId} onChange={event => setPlatformPostId(event.target.value)} placeholder="平台内容 ID（可选）" className="w-full border border-border bg-white px-3 py-2 text-sm" />
            </div>
          ) : composerAction.command === 'submit_quote_send_evidence' ? (
            <div className="mt-2 grid gap-2">
              <p className="text-[11px] text-text-muted">报价文件哈希由系统自动锁定。这里只登记你在系统外的人工发送记录并等待验真，不会调用平台或自动标记为已发送。</p>
              <input value={quoteChannel} onChange={event => setQuoteChannel(event.target.value)} maxLength={80} placeholder="发送渠道，例如 Messenger / 邮件" className="w-full border border-border bg-white px-3 py-2 text-sm" />
              <input value={quoteReference} onChange={event => setQuoteReference(event.target.value)} maxLength={240} placeholder="消息 ID、邮件 Message-ID 或工单引用" className="w-full border border-border bg-white px-3 py-2 text-sm" />
            </div>
          ) : (
            <>
              <p className="mt-1 text-[11px] text-text-muted">只填写这次需要补充或纠正的内容，无需重述整个任务。</p>
              <textarea
                id={`starter-command-${targetId}`}
                value={input}
                onChange={event => setInput(event.target.value)}
                rows={3}
                maxLength={4000}
                placeholder={composerAction.command === 'resolve_decision' ? '补充理由（可选）' : composerAction.command === 'cancel_run' ? '取消原因（可选）' : '只填写新信息'}
                className="mt-2 w-full resize-y border border-border bg-white px-3 py-2 text-sm leading-relaxed outline-none"
              />
            </>
          )}
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={!composerReady || Boolean(pendingCommand)}
              onClick={() => void execute(composerAction, composerPayload()).catch(() => {})}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingCommand ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Send size={13} aria-hidden="true" />}
              提交给灵小枢
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
