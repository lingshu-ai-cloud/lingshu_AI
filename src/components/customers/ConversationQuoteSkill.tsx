import type { RefObject } from 'react';
import type { CustomerProfile } from '../../types/customer';
import { QuoteSkillCard } from './QuoteSkillCard';

export function ConversationQuoteSkill({ customer, inputRef, onManualActive, onInputChange, onToast }: {
  customer: CustomerProfile;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onManualActive: () => void;
  onInputChange: (text: string) => void;
  onToast: (text: string) => void;
}) {
  return <QuoteSkillCard customer={customer} onInsertReply={text => {
    onManualActive();
    onInputChange(text);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }} onToast={onToast} />;
}
