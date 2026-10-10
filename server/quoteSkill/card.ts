import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { QuoteSkillDraft } from './types.js';

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]!));
}

function compact(value: unknown, max = 56): string {
  const text = String(value ?? '').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function quoteNumber(draft: Pick<QuoteSkillDraft, 'createdAt' | 'id'>): string {
  const date = String(draft.createdAt || '').slice(0, 10).replaceAll('-', '') || '00000000';
  const suffix = createHash('sha256').update(String(draft.id || draft.createdAt)).digest('hex').slice(0, 6).toUpperCase();
  return `QT-${date}-${suffix}`;
}

export function quoteCardSvg(draft: QuoteSkillDraft): string {
  const number = draft.quoteNumber || quoteNumber(draft);
  const total = draft.subtotal == null ? 'Pending confirmation' : `${draft.currency} ${draft.subtotal.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const englishUnit = ({ '件': 'pcs', '个': 'units', '套': 'sets', '箱': 'cartons' } as Record<string, string>)[draft.unit] || draft.unit;
  const quantity = draft.quantity == null ? 'Pending' : `${draft.quantity.toLocaleString('en-US')} ${englishUnit}`;
  const validity = `${draft.validityDays} days`;
  const status = draft.status === 'confirmed' ? 'CONFIRMED QUOTATION' : 'DRAFT PREVIEW';
  const labels = { title: 'QUOTATION', status, customer: 'CUSTOMER', product: 'PRODUCT', quantity: 'QUANTITY', subtotal: 'PRODUCT SUBTOTAL', valid: 'VALID FOR', delivery: 'DELIVERY TERMS', footer: 'Commercial terms remain subject to the confirmed quotation version.' };
  return `
  <svg width="1200" height="900" viewBox="0 0 1200 900" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="900" fill="#f3f7f4"/>
    <rect x="56" y="48" width="1088" height="804" rx="34" fill="#ffffff" stroke="#dbe8e0" stroke-width="2"/>
    <rect x="56" y="48" width="1088" height="18" rx="9" fill="#17845f"/>
    <text x="106" y="132" font-family="Arial, PingFang SC, sans-serif" font-size="26" font-weight="700" fill="#17845f">${esc(compact(draft.sellerName || 'LINGSHU AI', 44))}</text>
    <text x="106" y="192" font-family="Arial, PingFang SC, sans-serif" font-size="54" font-weight="800" fill="#143d30">${esc(labels.title)}</text>
    <text x="1090" y="134" text-anchor="end" font-family="Arial, PingFang SC, sans-serif" font-size="20" font-weight="700" fill="#17845f">${esc(labels.status)}</text>
    <text x="1090" y="174" text-anchor="end" font-family="Arial, PingFang SC, sans-serif" font-size="22" fill="#5d746b">${esc(number)} · V${draft.version}</text>
    <line x1="106" y1="230" x2="1094" y2="230" stroke="#e2ebe6" stroke-width="2"/>
    <text x="106" y="286" font-family="Arial, PingFang SC, sans-serif" font-size="20" fill="#688078">${esc(labels.customer)}</text>
    <text x="106" y="330" font-family="Arial, PingFang SC, sans-serif" font-size="32" font-weight="700" fill="#193f33">${esc(compact(draft.customerNameSource === 'whatsapp_profile' ? draft.customerName : 'Customer', 34))}</text>
    <text x="106" y="398" font-family="Arial, PingFang SC, sans-serif" font-size="20" fill="#688078">${esc(labels.product)}</text>
    <text x="106" y="444" font-family="Arial, PingFang SC, sans-serif" font-size="34" font-weight="700" fill="#193f33">${esc(compact(draft.productName, 48))}</text>
    <text x="106" y="484" font-family="Arial, PingFang SC, sans-serif" font-size="23" fill="#5d746b">${esc(compact([draft.sku, draft.material].filter(Boolean).join(' · '), 70))}</text>
    <rect x="106" y="540" width="300" height="126" rx="20" fill="#edf7f2"/>
    <text x="134" y="584" font-family="Arial, PingFang SC, sans-serif" font-size="19" fill="#688078">${esc(labels.quantity)}</text>
    <text x="134" y="630" font-family="Arial, PingFang SC, sans-serif" font-size="29" font-weight="800" fill="#143d30">${esc(quantity)}</text>
    <rect x="426" y="540" width="450" height="126" rx="20" fill="#e7f5ef"/>
    <text x="454" y="584" font-family="Arial, PingFang SC, sans-serif" font-size="19" fill="#688078">${esc(labels.subtotal)}</text>
    <text x="454" y="630" font-family="Arial, PingFang SC, sans-serif" font-size="34" font-weight="800" fill="#087852">${esc(total)}</text>
    <rect x="896" y="540" width="198" height="126" rx="20" fill="#f4f7f5"/>
    <text x="924" y="584" font-family="Arial, PingFang SC, sans-serif" font-size="19" fill="#688078">${esc(labels.valid)}</text>
    <text x="924" y="630" font-family="Arial, PingFang SC, sans-serif" font-size="29" font-weight="800" fill="#143d30">${esc(validity)}</text>
    <text x="106" y="724" font-family="Arial, PingFang SC, sans-serif" font-size="20" fill="#688078">${esc(labels.delivery)}</text>
    <text x="106" y="766" font-family="Arial, PingFang SC, sans-serif" font-size="25" font-weight="700" fill="#193f33">${esc(compact([draft.incoterm, draft.destination, draft.leadTime || draft.deliveryDate].filter(Boolean).join(' · '), 78))}</text>
    <text x="1094" y="812" text-anchor="end" font-family="Arial, PingFang SC, sans-serif" font-size="17" fill="#82948d">${esc(labels.footer)}</text>
  </svg>`;
}

export async function renderQuoteCard(draft: QuoteSkillDraft): Promise<Buffer> {
  return sharp(Buffer.from(quoteCardSvg(draft))).png({ compressionLevel: 9, palette: true }).toBuffer();
}

export function quoteCardDigest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
