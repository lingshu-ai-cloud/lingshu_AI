import { Card, CardContent, CardHeader } from '../../ui/card';
import type { CustomerProfile } from '../../../types/customer';
import { useState } from 'react';
import { authHeader } from '../../../lib/auth';

export function TagsWidget({ customer, onCustomerPatch, onToast }: { customer: CustomerProfile; onCustomerPatch?: (patch: Partial<CustomerProfile>) => void; onToast?: (text: string) => void }) {
  const [analyzing, setAnalyzing] = useState(false);
  const analyze = async () => {
    setAnalyzing(true);
    try {
      const response = await fetch(`/api/overseas/customers/${encodeURIComponent(customer.id)}/context-tags`, { method: 'POST', headers: authHeader() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || '标签分析失败');
      onCustomerPatch?.(result.customer);
      onToast?.('已根据客户会话更新标签');
    } catch (error) { onToast?.(error instanceof Error ? error.message : '标签分析失败'); }
    finally { setAnalyzing(false); }
  };
  return (
    <Card>
      <CardHeader>
        <p className="text-xs font-bold text-text-primary">客户标签</p>
        {customer.source === 'messenger' && <button type="button" disabled={analyzing} onClick={() => void analyze()} className="mt-2 text-[11px] font-bold text-accent disabled:opacity-50">{analyzing ? '分析中…' : '根据会话更新标签'}</button>}
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5">
          {customer.tags.map(tag => (
            <span key={tag} title={customer.contextTagEvidence?.find(item => item.tag === tag)?.excerpt} className="rounded-full border border-border px-2 py-1 text-[10px] font-semibold text-text-muted">
              {tag}
            </span>
          ))}
        </div>
        {(customer.contextTagEvidence || []).length > 0 && <details className="mt-2 text-[10px] text-text-muted"><summary className="cursor-pointer">查看标签依据</summary>{customer.contextTagEvidence!.map(item => <p key={item.tag} className="mt-1"><b>{item.tag}：</b>“{item.excerpt}”</p>)}</details>}
      </CardContent>
    </Card>
  );
}
