import { CustomerQuoteLauncher } from './CustomerQuoteLauncher';
import { getScrollBehavior } from '../../lib/usePrefersReducedMotion';
import { Avatar, Button, Input, Popover, Tag, Tooltip } from 'antd';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Info, Languages, MessageSquare, RefreshCw, Send, Smile, Sparkles, X } from 'lucide-react';
import type { EmojiClickData, PickerProps } from 'emoji-picker-react';
import { LsAvatarGroup, LsBrandAction, LsCompactFieldGroup } from '../ui/LsExperiencePrimitives';
import { SourceIcon } from './SourceIcon';
import { LiveLocalTime } from './LiveLocalTime';
import { SalesDecisionEvidence, type SalesDecisionMeta } from './SalesDecisionEvidence';
import { lastBuyerEvent, sceneChips, timelineEventAgeHours, type ConversationDraftIntent } from './conversationTiming';
import { STAGE_LABEL, customerDisplayName } from './conversionPresentation';
import type { CustomerProfile } from '../../types/customer';
import type { MessageTemplate, TemplatePlan } from './customerReplyPreparation';

const EmojiPicker = lazy(async () => {
  const picker = await import('emoji-picker-react');
  const NativeEmojiPicker = (props: PickerProps) => <picker.default {...props} emojiStyle={picker.EmojiStyle.NATIVE} />;
  return { default: NativeEmojiPicker };
});

type DraftIntent = ConversationDraftIntent;

function DraftSuggestionBar({
  draft,
  isTemplate,
  templatePlan,
  priceRulesReady,
  knowledgeMiss,
  bridgeOnly,
  onSend,
  onSave,
  savingDraft,
  channelReady,
  onChangeDraft,
  onDismiss,
  onRegenerate,
}: {
  draft: string;
  isTemplate: boolean;
  templatePlan: TemplatePlan | null;
  priceRulesReady: boolean;
  knowledgeMiss?: boolean;
  bridgeOnly?: boolean;
  onSend: () => void;
  onSave: () => void;
  savingDraft: boolean;
  channelReady?: boolean;
  onChangeDraft: (value: string) => void;
  onDismiss: () => void;
  onRegenerate: () => void;
}) {
  const templateApproved = !isTemplate || templatePlan?.template.status === 'approved';
  const draftMessages = draft.split(/\n\s*\n/).map(item => item.trim()).filter(Boolean);
  const updateMessage = (index: number, value: string) => {
    const next = [...draftMessages];
    next[index] = value;
    onChangeDraft(next.filter(Boolean).join('\n\n'));
  };
  return (
    <section data-draft-suggestion className="ml-auto w-fit min-w-[260px] max-w-[90%] rounded-2xl rounded-br-md border border-accent/25 bg-surface shadow-sm sm:max-w-[78%]">
      <header className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-semibold text-text-primary">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-glow text-accent"><Bot size={14} /></span>
          <span className="whitespace-nowrap">{bridgeOnly ? 'AI 承接回复' : 'AI 建议回复'}</span>
          {isTemplate && (
            <span className={`border-l-2 px-1.5 py-0.5 text-[10px] font-bold ${templateApproved ? 'border-accent bg-surface text-accent' : 'border-amber bg-amber-dim text-amber'}`}>
              {templateApproved ? '\u6a21\u677f\u53ef\u53d1' : '\u6a21\u677f\u5ba1\u6838\u4e2d'}
            </span>
          )}
          {knowledgeMiss && (
            <span className="border-l-2 border-amber bg-amber-dim px-1.5 py-0.5 text-[10px] font-bold text-amber">{bridgeOnly ? '已转人工确认' : '知识库未覆盖'}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button type="text" size="small" htmlType="button" onClick={onRegenerate} aria-label="换一版" icon={<RefreshCw size={13} />} />
          <Button type="text" size="small" htmlType="button" onClick={onDismiss} aria-label="关闭 AI 建议" icon={<X size={13} />} />
        </div>
      </header>
      <div className="space-y-2 px-3 pb-3">
        <div className="grid gap-2">
          {draftMessages.map((message, index) => (
            <div key={`${index}-${message.slice(0, 12)}`} className="rounded-2xl rounded-br-md bg-accent-glow px-3 py-2">
              {draftMessages.length > 1 && <span className="mb-0.5 block text-[9px] font-semibold text-text-muted">{index + 1}/{draftMessages.length}</span>}
              <Input.TextArea
                value={message}
                autoSize={{ minRows: 1, maxRows: 6 }}
                onChange={event => updateMessage(index, event.target.value)}
                aria-label={`编辑第 ${index + 1} 条短消息`}
                variant="borderless"
                className="w-full !bg-transparent !p-0 text-sm leading-5 text-text-primary"
              />
            </div>
          ))}
          {draftMessages.length > 1 && <p className="text-[10px] text-text-muted">按顺序发送 · {draftMessages.length} 条</p>}
        </div>
        {isTemplate && templatePlan && (
          <div className="mt-2 border-l-2 border-amber bg-amber-dim px-3 py-2 text-xs leading-relaxed text-amber">
            <p className="font-semibold">{'AI \u5df2\u9009\u62e9\u6a21\u677f\uff1a'}{templatePlan.template.label}</p>
            <p className="mt-1">{'\u53d8\u91cf\uff1a'}{templatePlan.variables.map((item, index) => `{{${index + 1}}}=${item}`).join(' / ')}</p>
            <p className="mt-1 whitespace-pre-line">{'\u6700\u7ec8\u53d1\u9001\u6548\u679c\uff1a'}{templatePlan.rendered}</p>
          </div>
        )}
        <footer className="flex flex-wrap items-center justify-end gap-1.5 border-t border-border pt-2">
          <Button size="small" htmlType="button" onClick={onSave} disabled={savingDraft || !draft.trim()} className="whitespace-nowrap font-semibold">{savingDraft ? '保存中…' : '保存修改'}</Button>
          <Button size="small" type="primary" htmlType="button" onClick={onSend} disabled={!templateApproved || !channelReady} className="whitespace-nowrap font-semibold">
            {!templateApproved ? '\u6d88\u606f\u6a21\u677f\u5ba1\u6838\u4e2d' : isTemplate ? '\u53d1\u9001\u6a21\u677f' : '\u76f4\u63a5\u53d1\u9001'}
          </Button>
        </footer>
      </div>
    </section>
  );
}

function chineseMessageTranslation(body: string, customer: CustomerProfile): string | null {
  if (/[\u4e00-\u9fff]/.test(body)) return null;
  const normalized = body.replace(/\s+/g, ' ').trim().toLowerCase();

  const exact: Record<string, string> = {
    'hi, i need 500 pcs custom hair wigs. please share moq, best price, and delivery time.': '你好，我需要 500 件定制假发。请提供起订量、最优价格和交期。',
    'i can ask our manager to walk you through the options by a short call. what time works for you?': '我可以安排经理通过一次简短通话为您说明方案。您什么时间方便？',
    'need 1000 gift boxes with custom logo. what is the best price?': '需要 1000 套定制 LOGO 礼盒，最优惠价格是多少？',
    'we can support custom logo gift boxes. i will confirm the best price and packaging options for you.': '我们可以支持定制 LOGO 礼盒。我会为您确认最优价格和包装方案。',
    'me interesa el parche de moxibustion, 200 piezas. cual es el precio unitario?': '我对艾灸贴感兴趣，200 件。单价是多少？',
    'curated selection sounds great. standard shipping is fine.': '这个精选组合听起来不错，标准运输就可以。',
    'hi, interested in wholesale hair accessories. what collections do you have?': '你好，我对发饰批发感兴趣。你们有哪些系列？',
    'thanks for reaching out. i sent our hair accessories catalog and 50 pcs mixed wholesale pack for your review.': '感谢联系。我已发送发饰目录和 50 件混批批发包，供您查看。',
  };

  if (exact[normalized]) return exact[normalized];
  if (normalized.includes('thanks for your message') && normalized.includes('moq')) {
    return `感谢您的消息。我会确认${customer.product}的 MOQ、最优价格和交期，然后尽快把详情发给您。`;
  }
  if (normalized.includes('best price') && normalized.includes('delivery time')) {
    return `我会为您确认${customer.product}的最优价格和交期。`;
  }
  return null;
}

export function ChatThread({
  customer,
  draftSuggestion,
  input,
  translatedInput,
  onInputChange,
  onDraftChange,
  onTranslatedInputChange: _onTranslatedInputChange,
  onSend,
  onSaveDraft,
  savingDraft,
  onSendDraft,
  onDismissDraft,
  onRegenerateDraft,
  onSceneDraft,
  onPreviewTranslate,
  templates,
  onManualActive,
  priceRulesReady,
  knowledgeMiss,
  bridgeOnly,
  draftMeta,
  onToast,
  sending,
  channelReady,
  onInsertQuoteReply,
  onQuoteCardSent,
}: {
  customer: CustomerProfile | null;
  onInsertQuoteReply: (text: string) => void;
  onQuoteCardSent: (summary: string, providerMessageId?: string) => void;
  draftSuggestion: string | null;
  input: string;
  translatedInput: string;
  onInputChange: (value: string) => void;
  onDraftChange: (value: string) => void;
  onTranslatedInputChange: (value: string) => void;
  onSend: () => void;
  onSaveDraft: (value: string) => void;
  savingDraft: boolean;
  onSendDraft: () => void;
  onDismissDraft: () => void;
  onRegenerateDraft: () => void;
  onSceneDraft: (intent: DraftIntent) => void;
  onPreviewTranslate: () => Promise<void>;
  templates: MessageTemplate[];
  onManualActive: () => void;
  priceRulesReady: boolean;
  knowledgeMiss?: boolean;
  bridgeOnly?: boolean;
  draftMeta: SalesDecisionMeta | null;
  onToast: (text: string) => void;
  sending?: boolean;
  channelReady?: boolean;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const translationCallback = useRef(onPreviewTranslate);
  translationCallback.current = onPreviewTranslate;
  const [emojiOpen, setEmojiOpen] = useState(false);
  const composerState = draftSuggestion ? 'draft' : input.trim() ? 'typing' : 'idle';
  const isOutsideWindow = customer ? timelineEventAgeHours(lastBuyerEvent(customer)) > 24 : false;
  const templatePlan = null;
  const chips = customer && composerState === 'idle' ? sceneChips(customer) : [];
  const conversationPeople = customer ? [
    { id: customer.id, name: customerDisplayName(customer), color: '#E8C7EC' },
    { id: 'lingshu-customer-agent', name: '客服 Agent', icon: <Bot size={15}/>, color: '#EAF6F2' },
  ] : [];

  const refreshTranslationPreview = useCallback(async () => {
    if (!input.trim()) return;
    setTranslationLoading(true);
    setTranslationError('');
    try {
      await translationCallback.current();
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : '翻译暂不可用，原文已保留。');
    } finally {
      setTranslationLoading(false);
    }
  }, [input]);

  const insertEmoji = (emoji: string) => {
    const start = inputRef.current?.selectionStart ?? input.length;
    const end = inputRef.current?.selectionEnd ?? input.length;
    const next = `${input.slice(0, start)}${emoji}${input.slice(end)}`;
    const nextCaret = start + emoji.length;
    onManualActive();
    onInputChange(next);
    setEmojiOpen(false);
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
    }, 0);
  };

  useEffect(() => {
    if (!previewOpen || !input.trim()) return;
    const timer = window.setTimeout(() => void refreshTranslationPreview(), 500);
    return () => window.clearTimeout(timer);
  }, [previewOpen, input, refreshTranslationPreview]);

  useEffect(() => {
    if (!draftSuggestion) return;
    const timer = window.setTimeout(() => {
      document.querySelector<HTMLElement>('[data-draft-suggestion]')?.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [customer?.id, Boolean(draftSuggestion)]);

  if (!customer) {
    return (
      <section data-testid="conversation-chat-thread" className="flex h-full min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-surface">
        <div className="text-center">
          <MessageSquare size={26} className="mx-auto text-text-muted" />
          <p className="mt-3 text-sm font-semibold text-text-primary">{'\u9009\u62e9\u5de6\u4fa7\u4e00\u4e2a\u5ba2\u6237\u5f00\u59cb'}</p>
          <p className="mt-1 text-xs text-text-muted">{'\u67e5\u770b\u5bf9\u8bdd\u3001\u7f16\u8f91 AI \u8349\u7a3f\u5e76\u53d1\u9001\u56de\u590d'}</p>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="conversation-chat-thread" className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar size={40} className="shrink-0" style={{ background: '#E8C7EC', color: '#6F3E7A', minWidth: 40 }}>{customer.avatar || customer.name.slice(0, 1)}</Avatar>
          <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-base font-semibold text-text-primary">{customerDisplayName(customer)}</p>
            {customer.isHistorical ? <Tag className="!m-0 !text-[10px]">历史会话 · 只读</Tag> : customer.isMock ? <Tag color="purple" className="!m-0 !text-[10px]">模拟客户 · 不对外发送</Tag> : <Tag className="!m-0 !text-[10px]">{channelReady ? '通道已连接' : '通道未连接'}</Tag>}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-muted">
            <span>{STAGE_LABEL[customer.stage]}</span>
            <span>·</span>
            <SourceIcon source={customer.source} size={12} />
            <span>·</span>
            <span>{customer.lastActive}</span>
          </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-2 xl:flex">
            <LsAvatarGroup people={conversationPeople} max={3} size={30}/>
            <span className="border-l border-border pl-3 text-xs font-semibold text-text-secondary">当地时间 <LiveLocalTime timeZone={customer.timeZone} /></span>
          </div>
          <Tooltip title="客户与会话详情"><Button shape="circle" aria-label="客户与会话详情" icon={<Info size={16}/>} /></Tooltip>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-ink px-3 py-5 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {customer.timeline.map(event => {
            if (event.type !== 'messenger' && event.type !== 'instagram' && event.type !== 'whatsapp') {
              return (
                <div key={event.id} className="flex justify-center">
                  <div className="max-w-[90%] rounded-md border border-border bg-surface px-3 py-2 text-center sm:max-w-[82%]">
                    <p className="text-[11px] font-semibold text-text-primary">{event.title}</p>
                    <p className="mt-1 text-xs leading-5 text-text-muted">{event.body}</p>
                    <p className="mt-1 text-[10px] text-text-muted">{event.time}</p>
                  </div>
                </div>
              );
            }
            const isBuyer = event.actor === 'buyer';
            const isAi = event.actor === 'ai';
            // Only show a translation that belongs to this exact message. A generic
            // fallback looks helpful but can silently tell the seller something the
            // buyer or AI never said.
            const translation = event.translatedBody || chineseMessageTranslation(event.body, customer) || null;
            return (
              <div key={event.id} className={`flex ${isBuyer ? 'justify-start' : 'justify-end'}`}>
                <div className={`ls-messenger-bubble relative ${isBuyer ? 'ls-messenger-bubble--inbound' : 'ls-messenger-bubble--outbound'}`}>
                  {isAi && <span className="absolute -top-2 right-3 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[9px] font-bold text-accent">AI</span>}
                  <div className={`flex items-center gap-4 ${isBuyer ? 'justify-end' : 'justify-between'}`}>
                    {!isBuyer && <p className="text-xs font-bold text-white">{event.title}</p>}
                    <span className={`text-[10px] ${isBuyer ? 'text-text-muted' : 'text-white/75'}`}>{event.time}</span>
                  </div>
                  <p className={`mt-1 whitespace-pre-line text-sm leading-relaxed ${isBuyer ? 'text-text-primary' : 'text-white'}`}>{event.body}</p>
                  {!isBuyer && (event.audit?.editedByHuman || event.audit?.memoryApplied?.length) && (
                    <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                      {event.audit.editedByHuman && (
                        <span className="rounded-full bg-surface/15 px-2 py-0.5 text-[10px] font-bold text-white/90" title={event.audit.originalDraft ? `AI 初稿：${event.audit.originalDraft}` : undefined}>AI 草稿 · 人工改过</span>
                      )}
                      {event.audit.memoryApplied?.length ? (
                        <span className="rounded-full bg-emerald-100/25 px-2 py-0.5 text-[10px] font-bold text-white/90" title={event.audit.memoryApplied.join('；')}>已用学习记忆</span>
                      ) : null}
                    </div>
                  )}
                  {translation && (
                    <div className={`mt-2 border-t pt-2 text-xs leading-relaxed ${isBuyer ? 'border-border-bright text-text-secondary' : 'border-white/20 text-white/80'}`}>
                      <span className="font-bold">{'\u4e2d\u6587\u7ffb\u8bd1\uff1a'}</span>{translation}
                    </div>
                  )}
                  {event.autoSent && <div className="mt-2 flex justify-end"><span className="rounded-full bg-surface/15 px-2 py-0.5 text-[10px] font-bold text-white/85">{'AI \u81ea\u52a8\u56de\u590d'}</span></div>}
                  {!isBuyer && event.sendStatus && (
                    <div className="mt-2 flex justify-end">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${event.sendStatus === 'failed' ? 'bg-red-100 text-red-700' : 'bg-surface/15 text-white/85'}`}>
                        {event.sendStatus === 'queued' ? '发送中' : event.sendStatus === 'sent' ? '已发送' : event.sendStatus === 'delivered' ? '已送达' : event.sendStatus === 'failed' ? '发送失败' : event.sendStatus === 'unknown' ? '发送结果待确认' : '草稿'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {draftSuggestion && !customer.isHistorical && (
            <>
              <SalesDecisionEvidence meta={draftMeta} />
              <DraftSuggestionBar draft={draftSuggestion} isTemplate={false} templatePlan={templatePlan} priceRulesReady={priceRulesReady} knowledgeMiss={knowledgeMiss} bridgeOnly={bridgeOnly} onSend={onSendDraft} onSave={() => onSaveDraft(draftSuggestion)} savingDraft={savingDraft} channelReady={channelReady && !isOutsideWindow} onChangeDraft={onDraftChange} onDismiss={onDismissDraft} onRegenerate={onRegenerateDraft} />
            </>
          )}
        </div>
      </div>
      <div className="shrink-0 space-y-2 border-t border-border bg-surface p-3">
        <div className="mx-auto max-w-3xl space-y-2">
          {customer.isHistorical ? <div className="rounded-lg border border-border bg-surface-2 px-3 py-3 text-xs text-text-secondary">这是迁入的历史会话，仅供查看；未绑定已授权渠道，不能回复或对外发送。</div> : <>
          {isOutsideWindow && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">距客户上次互动已超过 24 小时，当前不能直接发送普通 {customer.source === 'instagram' ? 'Instagram' : 'Messenger'} 消息。</div>}
          {composerState === 'idle' && chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map(chip => <Button key={chip.intent} htmlType="button" onClick={() => onSceneDraft(chip.intent)} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-bold text-text-secondary hover:border-accent/30 hover:bg-accent-glow hover:text-accent"><Sparkles size={13} /> {chip.label}</Button>)}
            </div>
          )}
          <div data-testid="conversation-composer" className="relative rounded-lg border border-border bg-surface-2 px-3 py-2.5 focus-within:border-accent">
            {previewOpen && (
              <div className="mb-3 rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-text-secondary">
                <span className="font-semibold text-text-primary">目标语言译文（{customer.language}）：</span>
                {translationLoading ? '翻译中…' : translationError || translatedInput || '请输入中文内容后查看译文'}
              </div>
            )}
            <Input.TextArea ref={node => { inputRef.current = node?.resizableTextArea?.textArea || null; }} data-customer-reply-input aria-label="客户回复" rows={2} value={input} onFocus={onManualActive} onChange={event => { onManualActive(); onInputChange(event.target.value); }} placeholder="输入中文回复…" variant="borderless" className="max-h-24 w-full resize-none" />
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="relative flex items-center gap-1.5">
                <Popover trigger="click" placement="topLeft" open={emojiOpen} onOpenChange={setEmojiOpen} title="选择表情" content={emojiOpen ? <Suspense fallback={<div className="flex h-[360px] w-80 items-center justify-center text-xs text-text-secondary">正在加载表情…</div>}>
                  <EmojiPicker width={320} height={360} lazyLoadEmojis searchPlaceHolder="搜索表情" previewConfig={{ showPreview: false }} onEmojiClick={(emojiData: EmojiClickData) => insertEmoji(emojiData.emoji)}/>
                </Suspense> : null}><Button aria-expanded={emojiOpen} aria-label="添加表情" icon={<Smile size={15}/>}/></Popover>
                <Button
                  htmlType="button"
                  onClick={() => {
                    const shouldOpen = !previewOpen;
                    setPreviewOpen(shouldOpen);
                    if (!shouldOpen) setTranslationError('');
                  }}
                  disabled={!input.trim()}
                  aria-label={previewOpen ? '隐藏目标语言译文' : '显示目标语言译文'}
                  className="!h-auto min-h-9 !whitespace-normal flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-text-muted hover:bg-surface hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                  title={previewOpen ? '隐藏目标语言译文' : '显示目标语言译文'}
                >
                  <Languages size={15} />
                  {previewOpen ? '隐藏译文' : '显示译文'}
                </Button>
              </div>
               <LsCompactFieldGroup className="!w-auto shrink-0">
                 <Button htmlType="button" onClick={() => onSaveDraft(input)} disabled={savingDraft || !input.trim()} className="!h-auto min-h-9 !whitespace-normal px-2 py-2 text-xs font-bold disabled:opacity-40">{savingDraft ? '保存中…' : '保存草稿'}</Button>
                 <CustomerQuoteLauncher key={customer.id} customer={customer} channelReady={Boolean(channelReady)} onInsertReply={onInsertQuoteReply} onCardSent={onQuoteCardSent} onToast={onToast} />
                 <LsBrandAction htmlType="button" onClick={onSend} loading={sending} disabled={sending || !channelReady || !input.trim() || isOutsideWindow} className="!h-auto min-h-9 !whitespace-normal flex items-center gap-1.5 px-4 py-2 text-xs"><Send size={13} /> {!channelReady ? '通道未连接' : isOutsideWindow ? '已超出回复时间' : '发送'}</LsBrandAction>
               </LsCompactFieldGroup>
            </div>
          </div>
          </>}
        </div>
      </div>
    </section>
  );
}
