import { useState } from 'react';
import { Button, Modal } from 'antd';
import { Calculator } from 'lucide-react';
import type { CustomerProfile } from '../../types/customer';
import { isWaitingForHumanQuote } from './customerReplyPreparation';
import { QuoteSkillCard } from './QuoteSkillCard';

export function customerNeedsQuote(customer: CustomerProfile): boolean {
  if (customer.isHistorical || customer.readOnly) return false;
  return isWaitingForHumanQuote(customer)
    || /待报价|等待报价|需要报价|索取报价|询价/.test([customer.handlingReason, customer.nextStep, customer.estimatedValue, customer.progressionGoal?.label, ...customer.tags].join(' '));
}

export function CustomerQuoteLauncher({ customer, channelReady, onInsertReply, onCardSent, onToast }: {
  customer: CustomerProfile;
  channelReady: boolean;
  onInsertReply: (text: string) => void;
  onCardSent: (summary: string, providerMessageId?: string) => void;
  onToast: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!customerNeedsQuote(customer)) return null;
  return <>
    <Button icon={<Calculator size={14} />} onClick={() => setOpen(true)}>智能报价</Button>
    <Modal title="智能报价" open={open} onCancel={() => setOpen(false)} footer={null} width={760} destroyOnHidden>
      <QuoteSkillCard workspace customer={customer} channelReady={channelReady} onToast={onToast}
        onInsertReply={text => { onInsertReply(text); setOpen(false); }} onCardSent={onCardSent} />
    </Modal>
  </>;
}
