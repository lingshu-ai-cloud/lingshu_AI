import { authHeader } from './auth';

export type QuoteSkillStatus = 'needs_clarification' | 'ready_for_review' | 'confirmed';

export interface QuoteSkillDraft {
  id: string;
  revision: number;
  version: number;
  quoteNumber: string;
  sellerName: string;
  customerNameSource: 'whatsapp_profile' | 'safe_fallback';
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
  unitPriceSource?: 'product_catalog' | 'human';
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
  matchedProduct: QuoteCatalogProduct | null;
  delivery?:
    | { status: 'sending'; attemptId: string; startedAt: string; imageSha256: string }
    | { status: 'outcome_unknown'; attemptId: string; startedAt: string; outcomeUnknownAt: string; imageSha256: string; providerMessageId?: string }
    | { status: 'sent'; attemptId?: string; startedAt?: string; sentAt: string; providerMessageId: string; imageSha256: string };
}

export interface QuoteCatalogProduct {
  sku: string;
  name: string;
  material: string;
  unit: string;
  unitPrice: number | null;
  currency: string;
  moq: number | null;
  leadTime: string;
  priceSource: string;
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

async function imageRequest(path: string): Promise<Blob> {
  const response = await fetch(`/api/overseas/quote-skill${path}`, { headers: authHeader() });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || data.error || '报价卡片生成失败');
  }
  return response.blob();
}

export const quoteSkillApi = {
  availability: () => request<{ enabled: boolean }>('/availability'),
  catalog: () => request<{ items: QuoteCatalogProduct[] }>('/catalog'),
  latest: (customerId: string) => request<{ draft: QuoteSkillDraft | null }>(`/customers/${encodeURIComponent(customerId)}/latest`),
  create: (input: { customerId: string; customerWhatsAppName?: string; customerLanguage: string; productHint: string; messages: string[]; clonePrevious?: boolean }) => request<{ draft: QuoteSkillDraft }>('/drafts', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, expectedRevision: number, patch: Partial<Pick<QuoteSkillDraft, 'productName' | 'sku' | 'quantity' | 'unit' | 'material' | 'deliveryDate' | 'destination' | 'incoterm' | 'packaging' | 'drawingVersion' | 'unitPrice' | 'currency' | 'leadTime' | 'paymentTerms' | 'validityDays'>> & { catalogProductRef?: string; catalogPriceMode?: 'catalog' | 'manual' }) => request<{ draft: QuoteSkillDraft }>(`/drafts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ ...patch, expectedRevision }) }),
  confirm: (id: string, expectedRevision: number) => request<{ draft: QuoteSkillDraft }>(`/drafts/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: JSON.stringify({ expectedRevision }) }),
  reply: (id: string) => request<{ reply: string }>(`/drafts/${encodeURIComponent(id)}/reply`, { method: 'POST' }),
  card: (id: string) => imageRequest(`/drafts/${encodeURIComponent(id)}/card`),
  sendCard: (id: string) => request<{ draft: QuoteSkillDraft; status: 'sent'; providerMessageId: string; sentAt: string }>(`/drafts/${encodeURIComponent(id)}/send-card`, { method: 'POST' }),
};
