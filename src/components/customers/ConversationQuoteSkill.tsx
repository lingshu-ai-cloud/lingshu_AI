import type { RefObject } from 'react';
import type { CustomerProfile } from '../../types/customer';
import { QuoteSkillCard } from './QuoteSkillCard';

export function ConversationQuoteSkill({ customer, inputRef, onManualActive, onInputChange, onToast, channelReady, onCardSent }: {
  customer: CustomerProfile;
  channelReady: boolean;
  onCardSent: (summary: string, providerMessageId?: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onManualActive: () => void;
  onInputChange: (text: string) => void;
  onToast: (text: string) => void;
}) {
  return <QuoteSkillCard customer={customer} channelReady={channelReady} onCardSent={onCardSent} onInsertReply={text => {
    onManualActive();
    onInputChange(text);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }} onToast={onToast} />;
}
