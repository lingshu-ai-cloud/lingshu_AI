import { authHeader } from './auth';

export type QuoteSkillStatus = 'needs_clarification' | 'ready_for_review' | 'confirmed';

export interface QuoteSkillDraft {
  id: string;
  revision: number;
  version: number;
  status: QuoteSkillStatus;
  intentScore: number;
  productName: string;
  sku: string;
  quantity: number | null;
  unit: string;
  material: string;
  deliveryDate: string;
  destination: string;
  incoterm: string;
  packaging: string;
  drawingVersion: string;
  unitPrice: number | null;
  currency: string;
  subtotal: number | null;
  leadTime: string;
  paymentTerms: string;
  validityDays: number;
  missingFields: string[];
  blockers: string[];
  pricingExplanation: string[];
  clarificationQuestions: string[];
  humanConfirmationRequired: true;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/overseas/quote-skill${path}`, {
    ...options,
    headers: { ...authHeader(), ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...(options?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || '报价能力暂时不可用');
  return data as T;
}

export const quoteSkillApi = {
  availability: () => request<{ enabled: boolean }>('/availability'),
  latest: (customerId: string) => request<{ draft: QuoteSkillDraft | null }>(`/customers/${encodeURIComponent(customerId)}/latest`),
  create: (input: { customerId: string; customerName: string; customerLanguage: string; productHint: string; messages: string[] }) => request<{ draft: QuoteSkillDraft }>('/drafts', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, expectedRevision: number, patch: Partial<Pick<QuoteSkillDraft, 'productName' | 'sku' | 'quantity' | 'unit' | 'material' | 'deliveryDate' | 'destination' | 'incoterm' | 'packaging' | 'drawingVersion' | 'unitPrice' | 'currency' | 'leadTime' | 'paymentTerms' | 'validityDays'>>) => request<{ draft: QuoteSkillDraft }>(`/drafts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ ...patch, expectedRevision }) }),
  confirm: (id: string, expectedRevision: number) => request<{ draft: QuoteSkillDraft }>(`/drafts/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: JSON.stringify({ expectedRevision }) }),
  reply: (id: string) => request<{ reply: string }>(`/drafts/${encodeURIComponent(id)}/reply`, { method: 'POST' }),
};
