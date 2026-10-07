import { isBrowserReadToken } from '../digitalEmployees/browserReadSession.js';
import { getWhatsAppCustomers, patchWhatsAppCustomer } from '../whatsapp/historyImport.js';
import { orderStatuses, transitionOrder, updateAfterSales, type OrderStatus, type OrderAudit, type AfterSales } from '../../shared/orderLifecycle.js';
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { enterpriseProductIdentity, mergeEnterpriseProductIdentity } from '../lib/enterpriseProductIdentity.js';
import type { Request } from 'express';
import { store } from '../storage/index.js';
import type { AutonomyLevel } from '../autonomy/actionRules.js';
import { callLLM } from '../agents/llm.js';
import { notifyDeliveryTeam } from '../lib/tenantPlatformApps.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import {
  productApiSecretForKey,
  productApiSecretForTenant,
  type ProductApiCredential,
} from '../lib/productApiCredentials.js';
import { enterpriseProductApiRouter } from './enterpriseProductApi.js';
import { objectStorageEnabled, objectStorageGetObject, objectStorageUpload } from '../storage/objectStorage.js';
import {
  enterpriseAssetContentType,
  enterpriseAssetObjectKey,
  enterpriseAssetTenantKey,
  enterpriseAssetTypeAllowed,
} from '../storage/enterpriseAssets.js';
import { readCustomerMessagingAuthorization } from '../digitalEmployees/customerMessagingPolicy.js';
import {
  assertLegacyExternalEffectAllowed,
  Starter198LegacyEffectError,
  withLegacyExternalEffectAllowed,
} from '../starter198/legacyEffectGuard.js';
import { localFallbacksEnabled } from '../lib/localFallbackPolicy.js';
import { currentDataAuthority } from '../storage/dataAuthority.js';
import { upsertTenantUploadCloudMaterial } from '../lib/cloudMaterials.js';
import { normalizeTenantMedia } from '../lib/tenantMediaNormalization.js';
import os from 'node:os';
import { downloadAndNormalizeExternalImage, ExternalImageImportError } from '../lib/externalProductImageImport.js';
import { readLocalMaterials, saveLocalMaterials } from '../lib/materialLibrary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '../../data/enterprise.json');
const DATA_DIR = path.join(__dirname, '../../data');
const ASSETS_DIR = path.join(DATA_DIR, 'enterprise-assets');
const TENANT_ORDERS_DIR = path.join(DATA_DIR, 'tenant-orders');

function upsertLocalEnterpriseMaterial(input: {
  tenantId: string; title: string; type: 'image' | 'video' | 'audio'; sizeBytes: number;
  duration?: number; width?: number; height?: number; sha256: string; sourceUrl: string;
  sourceName: string; productId?: string; provenance: Record<string, unknown>;
}): Record<string, unknown> {
  const records = readLocalMaterials();
  const index = records.findIndex(item => String(item.tenantId || item.tenant_id || '') === input.tenantId
    && String(item.contentSha256 || item.sha256 || '').toLowerCase() === input.sha256.toLowerCase());
  const now = new Date().toISOString();
  const sourceEntries = ['enterprise_knowledge'];
  if (index >= 0) {
    const current = records[index]!;
    const currentProvenance = current.provenance && typeof current.provenance === 'object' ? current.provenance : {};
    records[index] = {
      ...current,
      ...(input.productId ? { productId: input.productId } : {}),
      sourceUrl: input.sourceUrl,
      provenance: { ...currentProvenance, ...input.provenance, sourceEntry: 'enterprise_knowledge', sourceEntries },
      updatedAt: now,
    };
    saveLocalMaterials(records);
    return records[index]!;
  }
  const created = {
    id: `enterprise-${randomUUID()}`, tenantId: input.tenantId, name: input.title, title: input.title,
    folder: 'enterprise-upload', type: input.type, duration: input.duration || 0,
    width: input.width, height: input.height, sizeBytes: input.sizeBytes, size: `${input.sizeBytes} B`,
    contentSha256: input.sha256, sha256: input.sha256, scope: 'own', usage: 'editable',
    sourceType: 'enterprise_upload', sourceName: input.sourceName, sourceProvider: 'tenant',
    sourceUrl: input.sourceUrl, url: input.sourceUrl, ...(input.productId ? { productId: input.productId } : {}),
    sourceEntry: 'enterprise_knowledge', ownership: 'enterprise', visibility: 'tenant', knowledgeEligible: true,
    provenance: { ...input.provenance, sourceEntry: 'enterprise_knowledge', sourceEntries },
    createdAt: now, updatedAt: now,
  };
  records.push(created);
  saveLocalMaterials(records);
  return created;
}



type QuoteMode = '' | 'range' | 'human_only';
type BargainPolicy = '' | 'no' | 'limited' | 'open';
type NotificationChannel = 'wecom' | 'dingtalk' | 'feishu' | 'sms';

export interface BizRules {
  quoteMode: QuoteMode;
  priceRange?: string;
  bargainPolicy: BargainPolicy;
  bargainFloor?: string;
  moq: string;
  samplePolicy: string;
  paymentTerms: string;
  leadTime: string;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  approvedForAuto: boolean;
  source?: 'manual' | 'pack' | 'learned';
}

export interface NotificationReceiver {
  name: string;
  channel: NotificationChannel;
  target: string;
}

export interface NotificationSettings {
  receivers: NotificationReceiver[];
  workHours: { start: string; end: string };
  quietOutsideHours: boolean;
  nightMode: { enabled: boolean; autoCategories: 'approved' };
  lastTestAt?: string;
}

export interface HandoffRules {
  keywords: string[];
  missStreakToDraft: 1 | 2 | 3;
  negativeSentiment: boolean;
}

export type PartialAutoReplyDecision = 'pending' | 'enabled' | 'declined';

export interface CustomerServiceSettings {
  enabled: boolean;
  enabledAt?: string;
  disabledAt?: string;
  partialAutoReplyEnabled: boolean;
  partialAutoReplyDecision: PartialAutoReplyDecision;
  partialAutoReplyDecisionAt?: string;
}

export interface CustomerServicePolicy {
  enabled: boolean;
  enabledAt: string;
  observationDay: number;
  remainingHours: number;
  eligibleForPartialAutoReply: boolean;
  partialAutoReplyEnabled: boolean;
  partialAutoReplyDecision: PartialAutoReplyDecision;
  shouldAskPartialAutoReply: boolean;
  canAutoSend: boolean;
}

export interface CustomerServiceStatus extends CustomerServicePolicy {
  approvedFaqCount: number;
  autoReplyReady: boolean;
}

export interface SalesStyleProfile {
  learnedFromCount: number;
  lastDistilledAt?: string;
  greeting_style?: { value: string; evidence: string; manual?: boolean };
  quoting_stance?: { value: string; evidence: string; manual?: boolean };
  followup_rhythm?: { value: string; evidence: string; manual?: boolean };
  taboo_phrases?: { value: string[]; evidence: string; manual?: boolean };
  sample_pairs?: Array<{ trigger: string; final: string; evidence?: string }>;
}

export interface OrderRecord {
  idempotencyKey?: string;
  customerSyncStatus?: 'pending' | 'done' | 'failed';
  customerSyncError?: string;
  sourcePostId?: string;
  customerId?: string;
  paidAt?: string;
  refundedAt?: string;
  refundAmount?: number;
  audit?: OrderAudit[];
  afterSales?: AfterSales;
  afterSalesHistory?: AfterSales[];
  id: string;
  orderNo: string;
  buyer: string;
  market: string;
  channel: string;
  product: string;
  quantity: number;
  amount: number;
  cost: number;
  status: OrderStatus;
  orderDate: string;
  owner: string;
  source: string;
  sourceRef?: string;
  importedAt: string;
  updatedAt: string;
}

const ORDER_STATUSES: readonly OrderStatus[] = orderStatuses;

export interface EnterpriseProfile {
  /**
   * Immutable identity of the currently confirmed enterprise facts. Every
   * consumer receives this version together with the profile so content,
   * customer service, quotation, ads and digital employees cannot silently
   * mix facts from different saves.
   */
  factVersion?: {
    id: string;
    revision: number;
    contentHash: string;
    confirmedAt: string;
    confirmedBy: string;
  };
  digitalEmployeeOnboarding?: {
    profileConfirmedAt?: string;
    productSelectionConfirmedAt?: string;
    continuedWithoutProducts?: boolean;
  };
  company: {
    name: string;
    industry: string;
    companyType?: string;
    mainMarkets: string;
    primaryLanguages?: string;
    socialPlatformExperience?: string;
    founded: string;
    description: string;
  };
  socialStrategy?: {
    enabledRoutes: Array<'oem_odm' | 'wholesale_distribution' | 'consumer_retail'>;
    routeStrategies: Partial<Record<'oem_odm' | 'wholesale_distribution' | 'consumer_retail', { targetBuyerRoles: string[]; primaryCta: string }>>;
    manuallyEditedFields?: string[];
    /** Social operating stage selected during application onboarding. */
    contentStage?: 'b2b_launch' | 'b2b_growth' | 'd2c_brand';
    /** PRD-aligned generation preset derived from contentStage. */
    weeklyTaskPackagePreset?: 'b2b_starting' | 'b2b_growing' | 'dtc_sales';
  };
  products: {
    categories: string;
    searchKeywords?: string;
    priceRange: string;
    moq: string;
    certifications: string;
    highlights: string;
    items?: Array<{
      id?: string;
      productId?: string;
      sku?: string;
      name: string;
      category?: string;
      color?: string;
      size?: string;
      tagPrice?: string;
      retailPrice?: string;
      brand?: string;
      material?: string;
      imageUrl?: string;
      priceRange?: string;
      moq?: string;
      certifications?: string;
      highlights?: string;
      attributes?: Record<string, unknown>;
      images?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
      videos?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
      documents?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
      factoryImages?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
      packagingImages?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
      certificateImages?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
      sceneImages?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
      brandAssets?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
    }>;
  };
  brand: {
    /** Customer-facing brand name; independent from the legal enterprise name. */
    name: string;
    tone: string;
    style: string;
    taboos: string;
    usp: string;
    preferredLanguages?: string;
  };
  strategy?: {
    currentGoal?: string;
    focusProducts?: string;
    focusMarkets?: string;
    excludedMarkets?: string;
    pricingStrategy?: string;
    minMargin?: string;
    agentAutonomy?: string;
    aiAutonomy?: AutonomyLevel;
  };
  customers?: {
    targetProfiles?: string;
    highValueSignals?: string;
    lowQualitySignals?: string;
    commonQuestions?: string;
    followupStyle?: string;
  };
  operations?: {
    leadTime?: string;
    customization?: string;
    logistics?: string;
    paymentTerms?: string;
    riskNotes?: string;
  };
  agentLearning?: {
    provenAngles?: string;
    weakAngles?: string;
    pendingAssumptions?: string;
    userCorrections?: string;
  };
  bizRules?: BizRules;
  faq?: FaqItem[];
  notifications?: NotificationSettings;
  handoffRules?: HandoffRules;
  customerService?: CustomerServiceSettings;
  salesStyleProfile?: SalesStyleProfile;
  knowledgeIntake?: {
    lastExtractedAt?: string;
    source?: 'history' | 'products' | 'interview';
    extractedMessages?: number;
    confirmedSections?: string[];
  };
  dataGovernance?: {
    aiAccessEnabled: boolean;
    lastSavedAt?: string;
    lastSavedSource?: 'diagnosis' | 'enterprise_center' | 'knowledge_intake' | 'system' | 'template';
  };
  knowledge: string;
}

const DEFAULT_BIZ_RULES: BizRules = {
  quoteMode: 'human_only',
  priceRange: '',
  bargainPolicy: 'no',
  bargainFloor: '',
  moq: '',
  samplePolicy: '',
  paymentTerms: '',
  leadTime: '',
};

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  receivers: [],
  workHours: { start: '09:00', end: '22:00' },
  quietOutsideHours: true,
  nightMode: { enabled: false, autoCategories: 'approved' },
  lastTestAt: '',
};

const CUSTOMER_SERVICE_OBSERVATION_MS = 3 * 24 * 60 * 60 * 1000;
const DEFAULT_CUSTOMER_SERVICE: CustomerServiceSettings = {
  enabled: false,
  enabledAt: '',
  disabledAt: '',
  partialAutoReplyEnabled: false,
  partialAutoReplyDecision: 'pending',
  partialAutoReplyDecisionAt: '',
};

const DEFAULT_HANDOFF_RULES: HandoffRules = {
  keywords: ['人工', '老板', 'manager', 'complaint', 'refund'],
  missStreakToDraft: 2,
  negativeSentiment: true,
};

function readProfile(): EnterpriseProfile {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    // Reads are side-effect free. Legacy embedded integration credentials are
    // ignored here; any historical credential migration must be an explicit,
    // audited operator command rather than an implicit GET-time write.
    delete parsed.integrations;
    return normalizeProfile(parsed);
  } catch {
    return normalizeProfile({
      company: { name: '', industry: '', companyType: '', mainMarkets: '', primaryLanguages: '', founded: '', description: '' },
      products: {
        categories: '',
        priceRange: '',
        moq: '',
        certifications: '',
        highlights: '',
        items: [],
      },
      brand: { name: '', tone: '', style: '', taboos: '', usp: '', preferredLanguages: '' },
      strategy: { currentGoal: '', focusProducts: '', focusMarkets: '', excludedMarkets: '', pricingStrategy: '', minMargin: '', agentAutonomy: '', aiAutonomy: 'draft' },
      customers: { targetProfiles: '', highValueSignals: '', lowQualitySignals: '', commonQuestions: '', followupStyle: '' },
      operations: { leadTime: '', customization: '', logistics: '', paymentTerms: '', riskNotes: '' },
      agentLearning: { provenAngles: '', weakAngles: '', pendingAssumptions: '', userCorrections: '' },
      bizRules: { ...DEFAULT_BIZ_RULES },
      faq: [],
      notifications: { ...DEFAULT_NOTIFICATIONS, workHours: { ...DEFAULT_NOTIFICATIONS.workHours } },
      handoffRules: { ...DEFAULT_HANDOFF_RULES, keywords: [...DEFAULT_HANDOFF_RULES.keywords] },
      customerService: { ...DEFAULT_CUSTOMER_SERVICE },
      salesStyleProfile: { learnedFromCount: 0, sample_pairs: [] },
      knowledge: '',
    });
  }
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(value, null, 2), 'utf8');
}

function localTenantOrdersFile(tenantId: string): string {
  const key = Buffer.from(tenantId, 'utf8').toString('base64url');
  return path.join(TENANT_ORDERS_DIR, `${key}.json`);
}

function readLocalTenantOrders(tenantId: string): OrderRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(localTenantOrdersFile(tenantId), 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('订单台账格式无效');
    return parsed.map(normalizeOrder).filter(Boolean) as OrderRecord[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function writeLocalTenantOrders(tenantId: string, orders: OrderRecord[]): void {
  fs.mkdirSync(TENANT_ORDERS_DIR, { recursive: true });
  const destination = localTenantOrdersFile(tenantId);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(orders, null, 2), 'utf8');
  fs.renameSync(temporary, destination);
}

function storedOrder(value: unknown): OrderRecord | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  let order = raw.order;
  if (typeof order === 'string') {
    try { order = JSON.parse(order); } catch { return null; }
  }
  return order && typeof order === 'object' ? normalizeOrder(order as Partial<OrderRecord>) : null;
}

async function listStoredTenantOrders(tenantId: string): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await store.list<Record<string, unknown>>('tenant_orders', {
      where: { tenant_id: tenantId },
      page,
      perPage: 200,
    });
    records.push(...result.items);
    totalPages = result.totalPages || 1;
    page += 1;
  } while (page <= totalPages);
  return records;
}

export async function readOrders(tenantId: string): Promise<OrderRecord[]> {
  if (usesLocalOrderAuthority(tenantId)) return readLocalTenantOrders(tenantId);
  const records = await listStoredTenantOrders(tenantId);
  const orders = records.map(storedOrder).filter(Boolean) as OrderRecord[];
  return orders;
}

async function persistOrder(tenantId: string, order: OrderRecord): Promise<boolean> {
  if (usesLocalOrderAuthority(tenantId)) {
    const orders = readLocalTenantOrders(tenantId);
    writeLocalTenantOrders(tenantId, [order, ...orders.filter(item => item.orderNo !== order.orderNo)]);
    return true;
  }
  const result = await store.list<Record<string, unknown>>('tenant_orders', {
    where: { tenant_id: tenantId, order_no: order.orderNo },
    page: 1,
    perPage: 1,
  });
  const existing = result.items[0];
  if (existing?.id) return store.update('tenant_orders', String(existing.id), { order });
  return Boolean(await store.create('tenant_orders', { tenant_id: tenantId, order_no: order.orderNo, order }));
}

async function upsertOrder(tenantId: string, order: OrderRecord): Promise<boolean> {
  if (order.customerId) { order.customerSyncStatus = 'pending'; order.customerSyncError = ''; }
  const stored = await persistOrder(tenantId, order);
  if (!stored) return false;
  if (!order.customerId) return true;
  try {
    const customer = getWhatsAppCustomers(tenantId).find(item => item.id === order.customerId);
    if (!customer) throw new Error('客户已不存在');
    const canonical = (await readOrders(tenantId)).filter(item => item.customerId === order.customerId);
    const orderNumbers = new Set(canonical.map(item => item.orderNo));
    const projected = patchWhatsAppCustomer({ tenantId, customerId: order.customerId, patch: { orders: [
      ...canonical.map(item => ({ id: item.orderNo, status: item.status === '退款' ? 'refunded' : item.status === '已取消' ? 'cancelled' : item.status === '待付款' ? 'pending' : 'paid', total: `$${item.amount}`, createdAt: item.orderDate, items: [{ name: item.product, qty: item.quantity }] })),
      ...(customer.orders || []).filter((item: { id: string }) => !orderNumbers.has(item.id)),
    ] } });
    if (!projected) throw new Error('客户摘要补写失败');
    order.customerSyncStatus = 'done';
  } catch (error) {
    order.customerSyncStatus = 'failed'; order.customerSyncError = (error as Error).message;
  }
  // The canonical order already exists. A failed projection must never make a
  // caller create another order; pending is durable before projection begins.
  try { await persistOrder(tenantId, order); } catch { /* pending record can be retried idempotently */ }
  return true;
}

async function deleteOrder(tenantId: string, orderId: string): Promise<boolean> {
  if (usesLocalOrderAuthority(tenantId)) {
    const orders = readLocalTenantOrders(tenantId);
    const next = orders.filter(order => order.id !== orderId);
    if (next.length === orders.length) return false;
    writeLocalTenantOrders(tenantId, next);
    return true;
  }
  const records = await listStoredTenantOrders(tenantId);
  const record = records.find(item => storedOrder(item)?.id === orderId);
  return record?.id ? store.delete('tenant_orders', String(record.id)) : false;
}

function usesLocalOrderAuthority(tenantId: string): boolean {
  return localFallbacksEnabled()
    && currentDataAuthority() !== 'pocketbase'
    && tenantId.startsWith('local_tenant_');
}

function authenticatedTenantId(res: { locals: Record<string, unknown> }): string | null {
  const tenantId = (res.locals as unknown as Partial<AuthLocals>).tenantId;
  return typeof tenantId === 'string' && tenantId ? tenantId : null;
}

function parseNumber(value: unknown): number {
  const n = Number(String(value ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normalizeStatus(value: unknown): OrderStatus {
  const raw = String(value || '').trim();
  if (ORDER_STATUSES.includes(raw as OrderStatus)) return raw as OrderStatus;
  const lower = raw.toLowerCase();
  if (/^(paid|已付款|付款)$/.test(lower)) return '已付款';
  if (/ship|fulfilled|已发|发货/.test(lower)) return '已发货';
  if (/complete|done|完成/.test(lower)) return '已完成';
  if (/cancel|取消/.test(lower)) return '已取消';
  if (/refund|退款/.test(lower)) return '退款';
  if (/production|生产/.test(lower)) return '生产中';
  return '待付款';
}

function normalizeDate(value: unknown): string {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(raw)) {
    const [y, m, d] = raw.split('/');
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function normalizeOrder(input: Partial<OrderRecord>): OrderRecord | null {
  const buyer = String(input.buyer || '').trim();
  const product = String(input.product || '').trim();
  const amount = parseNumber(input.amount);
  if (!buyer || !product || amount <= 0) return null;
  const now = new Date().toISOString();
  const orderDate = normalizeDate(input.orderDate);
  return {
    id: String(input.id || randomUUID()),
    orderNo: String(input.orderNo || `LS-${orderDate.replaceAll('-', '')}-${randomBytes(3).toString('hex').toUpperCase()}`),
    buyer,
    market: String(input.market || '未标注').trim(),
    channel: String(input.channel || '手工录入').trim(),
    product,
    quantity: Math.max(1, parseNumber(input.quantity) || 1),
    amount,
    cost: Math.max(0, parseNumber(input.cost)),
    status: normalizeStatus(input.status),
    orderDate,
    owner: String(input.owner || '').trim() || '未分配',
    source: String(input.source || '手工录入').trim(),
    idempotencyKey: String(input.idempotencyKey || '').trim().slice(0, 120), customerSyncStatus: input.customerSyncStatus, customerSyncError: input.customerSyncError,
    sourcePostId: String(input.sourcePostId || '').trim(),
    customerId: String(input.customerId || '').trim(),
    paidAt: input.paidAt, refundedAt: input.refundedAt, refundAmount: input.refundAmount,
    audit: input.audit, afterSales: input.afterSales, afterSalesHistory: input.afterSalesHistory,
    sourceRef: String(input.sourceRef || '').trim(),
    importedAt: input.importedAt || now,
    updatedAt: input.updatedAt || now,
  };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const ORDER_HEADER_MAP: Record<string, keyof OrderRecord> = {
  订单号: 'orderNo',
  orderno: 'orderNo',
  order_no: 'orderNo',
  orderid: 'orderNo',
  order_id: 'orderNo',
  客户: 'buyer',
  客户名称: 'buyer',
  buyer: 'buyer',
  customer: 'buyer',
  market: 'market',
  市场: 'market',
  国家: 'market',
  country: 'market',
  渠道: 'channel',
  channel: 'channel',
  商品: 'product',
  '商品/sku': 'product',
  '商品 / sku': 'product',
  产品: 'product',
  sku: 'product',
  product: 'product',
  数量: 'quantity',
  quantity: 'quantity',
  qty: 'quantity',
  gmv: 'amount',
  金额: 'amount',
  订单金额: 'amount',
  amount: 'amount',
  成本: 'cost',
  cost: 'cost',
  状态: 'status',
  status: 'status',
  日期: 'orderDate',
  订单日期: 'orderDate',
  date: 'orderDate',
  orderdate: 'orderDate',
  负责人: 'owner',
  owner: 'owner',
  销售: 'owner',
  来源: 'source',
  source: 'source',
  来源凭证: 'sourceRef',
  凭证: 'sourceRef',
  sourceref: 'sourceRef',
  platform_order_id: 'sourceRef',
  平台订单号: 'sourceRef',
};

function importOrdersFromCsv(text: string): { imported: OrderRecord[]; skipped: number } {
  const rows = parseCsv(text);
  const [headers = [], ...body] = rows;
  const keys = headers.map(header => ORDER_HEADER_MAP[String(header).trim().toLowerCase()] || ORDER_HEADER_MAP[String(header).trim()]);
  const imported: OrderRecord[] = [];
  let skipped = 0;
  for (const row of body) {
    const raw: Partial<OrderRecord> = {};
    row.forEach((value, index) => {
      const key = keys[index];
      if (key) (raw as Record<string, unknown>)[key] = value;
    });
    const order = normalizeOrder({ ...raw, source: raw.source || 'CSV导入' });
    if (order) imported.push(order);
    else skipped += 1;
  }
  return { imported, skipped };
}

function ensureAssetsDir(): void {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

function safeStoredName(originalName: string): string {
  const ext = path.extname(originalName).slice(0, 16).replace(/[^a-zA-Z0-9.]/g, '');
  return `${Date.now()}-${randomUUID()}${ext}`;
}

function emptyProduct(index: number): NonNullable<EnterpriseProfile['products']['items']>[number] {
  return {
    id: randomUUID(),
    name: `产品${index + 1}`,
    images: [],
    videos: [],
    documents: [],
    factoryImages: [],
    packagingImages: [],
    certificateImages: [],
    sceneImages: [],
    brandAssets: [],
  };
}

function normalizedIso(value: unknown): string {
  const timestamp = Date.parse(text(value));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function normalizeCustomerServiceSettings(input: EnterpriseProfile['customerService']): CustomerServiceSettings {
  const enabled = input?.enabled === true;
  const partialAutoReplyEnabled = enabled && input?.partialAutoReplyEnabled === true;
  const rawDecision = input?.partialAutoReplyDecision;
  const partialAutoReplyDecision: PartialAutoReplyDecision = partialAutoReplyEnabled
    ? 'enabled'
    : rawDecision === 'declined'
      ? 'declined'
      : 'pending';
  return {
    enabled,
    enabledAt: enabled ? normalizedIso(input?.enabledAt) : '',
    disabledAt: normalizedIso(input?.disabledAt),
    partialAutoReplyEnabled,
    partialAutoReplyDecision,
    partialAutoReplyDecisionAt: normalizedIso(input?.partialAutoReplyDecisionAt),
  };
}

export function customerServicePolicyFromSettings(
  input: CustomerServiceSettings | undefined,
  nowMs = Date.now(),
): CustomerServicePolicy {
  const settings = normalizeCustomerServiceSettings(input);
  const enabledAtMs = Date.parse(settings.enabledAt || '');
  const elapsedMs = settings.enabled && Number.isFinite(enabledAtMs)
    ? Math.max(0, nowMs - enabledAtMs)
    : 0;
  const eligibleForPartialAutoReply = settings.enabled
    && Number.isFinite(enabledAtMs)
    && elapsedMs >= CUSTOMER_SERVICE_OBSERVATION_MS;
  const partialAutoReplyEnabled = eligibleForPartialAutoReply && settings.partialAutoReplyEnabled;
  return {
    enabled: settings.enabled,
    enabledAt: settings.enabledAt || '',
    observationDay: settings.enabled ? Math.min(3, Math.floor(elapsedMs / (24 * 60 * 60 * 1000)) + 1) : 0,
    remainingHours: settings.enabled
      ? Math.max(0, Math.ceil((CUSTOMER_SERVICE_OBSERVATION_MS - elapsedMs) / (60 * 60 * 1000)))
      : 72,
    eligibleForPartialAutoReply,
    partialAutoReplyEnabled,
    partialAutoReplyDecision: settings.partialAutoReplyDecision,
    shouldAskPartialAutoReply: eligibleForPartialAutoReply
      && settings.partialAutoReplyDecision === 'pending'
      && !partialAutoReplyEnabled,
    canAutoSend: settings.enabled && partialAutoReplyEnabled,
  };
}

export function customerServicePolicy(profile: EnterpriseProfile, nowMs = Date.now()): CustomerServicePolicy {
  return customerServicePolicyFromSettings(profile.customerService, nowMs);
}

export function customerServiceStatus(profile: EnterpriseProfile, nowMs = Date.now()): CustomerServiceStatus {
  const policy = customerServicePolicy(profile, nowMs);
  const approvedFaqCount = (profile.faq ?? []).filter(item => item.approvedForAuto && item.question && item.answer).length;
  return {
    ...policy,
    approvedFaqCount,
    autoReplyReady: policy.canAutoSend
      && approvedFaqCount >= 5
      && normalizeAutonomy(profile.strategy?.aiAutonomy) === 'auto',
  };
}

function normalizeProfile(profile: EnterpriseProfile): EnterpriseProfile {
  const companyInput = (profile.company ?? {}) as Partial<EnterpriseProfile['company']>;
  const company = {
    name: text(companyInput.name),
    industry: text(companyInput.industry),
    companyType: text(companyInput.companyType),
    mainMarkets: text(companyInput.mainMarkets),
    primaryLanguages: text(companyInput.primaryLanguages),
    socialPlatformExperience: text(companyInput.socialPlatformExperience),
    founded: text(companyInput.founded),
    description: text(companyInput.description),
  };
  const products = profile.products ?? { categories: '', priceRange: '', moq: '', certifications: '', highlights: '' };
  const existing = Array.isArray(products.items) ? products.items : [];
  const items = existing.length
    ? existing.map((item, index) => ({
      ...item,
      id: enterpriseProductIdentity(item, index),
      // 空名称代表尚在编辑的产品草稿，不能在保存时隐式删除。
      name: typeof item.name === 'string' ? item.name : (item.sku || ''),
      images: Array.isArray(item.images) ? item.images : [],
      videos: Array.isArray(item.videos) ? item.videos : [],
      documents: Array.isArray(item.documents) ? item.documents : [],
      factoryImages: Array.isArray(item.factoryImages) && item.factoryImages.length ? item.factoryImages : (Array.isArray(item.videos) ? item.videos : []),
      packagingImages: Array.isArray(item.packagingImages) ? item.packagingImages : [],
      certificateImages: Array.isArray(item.certificateImages) && item.certificateImages.length ? item.certificateImages : (Array.isArray(item.documents) ? item.documents : []),
      sceneImages: Array.isArray(item.sceneImages) ? item.sceneImages : [],
      brandAssets: Array.isArray(item.brandAssets) ? item.brandAssets : [],
    }))
    : [];
  const operations = {
    leadTime: '',
    customization: '',
    logistics: '',
    paymentTerms: '',
    riskNotes: '',
    ...(profile.operations ?? {}),
  };
  const bizRules = normalizeBizRules(profile.bizRules, products, operations);
  const notifications = normalizeNotifications(profile.notifications);
  const handoffRules = normalizeHandoffRules(profile.handoffRules);
  const customerService = normalizeCustomerServiceSettings(profile.customerService);
  const salesStyleProfile = normalizeSalesStyleProfile(profile.salesStyleProfile);
  const faq = normalizeFaq(profile.faq);
  const strategy = { ...(profile.strategy ?? {}), aiAutonomy: normalizeAutonomy(profile.strategy?.aiAutonomy) };
  const brandInput = (profile.brand ?? {}) as Partial<EnterpriseProfile['brand']>;
  const brand = {
    name: text(brandInput.name),
    tone: text(brandInput.tone),
    style: text(brandInput.style),
    taboos: text(brandInput.taboos),
    usp: text(brandInput.usp),
    preferredLanguages: text(brandInput.preferredLanguages),
  };
  const dataGovernance = {
    aiAccessEnabled: profile.dataGovernance?.aiAccessEnabled !== false,
    lastSavedAt: text(profile.dataGovernance?.lastSavedAt),
    lastSavedSource: profile.dataGovernance?.lastSavedSource,
  };
  const onboardingInput = profile.digitalEmployeeOnboarding ?? {};
  const digitalEmployeeOnboarding = {
    profileConfirmedAt: text(onboardingInput.profileConfirmedAt),
    productSelectionConfirmedAt: text(onboardingInput.productSelectionConfirmedAt),
    continuedWithoutProducts: onboardingInput.continuedWithoutProducts === true,
  };
  const socialInput: NonNullable<EnterpriseProfile['socialStrategy']> = profile.socialStrategy ?? { enabledRoutes: [], routeStrategies: {} };
  const allowedRoutes = ['oem_odm', 'wholesale_distribution', 'consumer_retail'] as const;
  let enabledRoutes = Array.isArray(socialInput.enabledRoutes)
    ? socialInput.enabledRoutes.filter((route): route is typeof allowedRoutes[number] => allowedRoutes.includes(route))
    : [];
  if (!enabledRoutes.length) {
    const inferenceSource = `${company.companyType} ${products.categories} ${products.highlights} ${operations.customization}`.toLowerCase();
    if (/oem|odm|定制|贴牌|工厂|工贸/.test(inferenceSource)) enabledRoutes = ['oem_odm'];
    else if (/批发|经销|现货|wholesale|distributor/.test(inferenceSource)) enabledRoutes = ['wholesale_distribution'];
    else if (/零售|消费者|retail|consumer/.test(inferenceSource)) enabledRoutes = ['consumer_retail'];
  }
  const defaultBuyers: Record<typeof allowedRoutes[number], string[]> = {
    oem_odm: ['品牌创始人', '产品经理', '采购'],
    wholesale_distribution: ['进口商', '经销商', '渠道采购'],
    consumer_retail: ['终端消费者'],
  };
  const routeStrategies = Object.fromEntries(enabledRoutes.map(route => {
    const source: { targetBuyerRoles: string[]; primaryCta: string } = socialInput.routeStrategies?.[route] ?? { targetBuyerRoles: defaultBuyers[route], primaryCta: '引导通过 Messenger 联系' };
    return [route, { targetBuyerRoles: Array.isArray(source.targetBuyerRoles) && source.targetBuyerRoles.length ? source.targetBuyerRoles.map(text).filter(Boolean) : defaultBuyers[route], primaryCta: text(source.primaryCta) || '引导通过 Messenger 联系' }];
  }));
  const allowedContentStages = ['b2b_launch', 'b2b_growth', 'd2c_brand'] as const;
  const contentStage = allowedContentStages.includes(socialInput.contentStage as typeof allowedContentStages[number])
    ? socialInput.contentStage as typeof allowedContentStages[number]
    : undefined;
  const presetByStage = { b2b_launch: 'b2b_starting', b2b_growth: 'b2b_growing', d2c_brand: 'dtc_sales' } as const;
  const weeklyTaskPackagePreset = contentStage ? presetByStage[contentStage] : undefined;
  const factVersionInput = profile.factVersion;
  const factVersion = factVersionInput && Number.isInteger(Number(factVersionInput.revision))
    && Number(factVersionInput.revision) > 0 && text(factVersionInput.contentHash)
    ? {
      id: text(factVersionInput.id),
      revision: Number(factVersionInput.revision),
      contentHash: text(factVersionInput.contentHash),
      confirmedAt: text(factVersionInput.confirmedAt),
      confirmedBy: text(factVersionInput.confirmedBy),
    }
    : undefined;
  return {
    ...profile,
    company,
    brand,
    operations,
    strategy,
    products: { ...products, searchKeywords: text(products.searchKeywords), items },
    bizRules,
    faq,
    notifications,
    handoffRules,
    customerService,
    salesStyleProfile,
    dataGovernance,
    digitalEmployeeOnboarding,
    socialStrategy: { enabledRoutes, routeStrategies, manuallyEditedFields: Array.isArray(socialInput.manuallyEditedFields) ? socialInput.manuallyEditedFields.map(text).filter(Boolean) : [], contentStage, weeklyTaskPackagePreset },
    ...(factVersion ? { factVersion } : {}),
  };
}

function stableFactJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableFactJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'factVersion' && key !== 'lastSavedAt' && key !== 'lastSavedSource' && key !== 'lastSavedBy')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableFactJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function enterpriseFactContentHash(profile: EnterpriseProfile): string {
  return createHash('sha256').update(stableFactJson(normalizeProfile(profile))).digest('hex');
}

function confirmedFactVersion(
  profile: EnterpriseProfile,
  previous?: EnterpriseProfile | null,
  confirmedBy = 'system',
  now = new Date(),
): NonNullable<EnterpriseProfile['factVersion']> {
  const contentHash = enterpriseFactContentHash(profile);
  const prior = previous?.factVersion;
  if (prior?.contentHash === contentHash && prior.id && prior.revision > 0) return prior;
  const revision = Math.max(0, Number(prior?.revision || 0)) + 1;
  return {
    id: `enterprise-facts-v${revision}-${contentHash.slice(0, 12)}`,
    revision,
    contentHash,
    confirmedAt: now.toISOString(),
    confirmedBy: text(confirmedBy) || 'system',
  };
}

function withConfirmedFactVersion(
  profile: EnterpriseProfile,
  previous?: EnterpriseProfile | null,
  confirmedBy = 'system',
  now = new Date(),
): EnterpriseProfile {
  const normalized = normalizeProfile(profile);
  normalized.factVersion = confirmedFactVersion(normalized, previous, confirmedBy, now);
  return normalized;
}

function mergeEnterpriseProfile(current: EnterpriseProfile, patch: Partial<EnterpriseProfile>): EnterpriseProfile {
  const merge = (base: unknown, incoming: unknown): unknown => {
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return incoming;
    const baseRecord = base && typeof base === 'object' && !Array.isArray(base)
      ? base as Record<string, unknown>
      : {};
    return Object.fromEntries(Object.entries(incoming as Record<string, unknown>).map(([key, value]) => [
      key,
      value && typeof value === 'object' && !Array.isArray(value)
        ? merge(baseRecord[key], value)
        : value,
    ]).concat(Object.entries(baseRecord).filter(([key]) => !(key in (incoming as Record<string, unknown>)))));
  };
  return normalizeProfile(merge(current, patch) as EnterpriseProfile);
}

function markProfileSaved(
  profile: EnterpriseProfile,
  source: NonNullable<EnterpriseProfile['dataGovernance']>['lastSavedSource'],
): EnterpriseProfile {
  return normalizeProfile({
    ...profile,
    dataGovernance: {
      ...profile.dataGovernance,
      aiAccessEnabled: true,
      lastSavedAt: new Date().toISOString(),
      lastSavedSource: source,
    },
  });
}

function styleField(input: unknown): { value: string; evidence: string; manual?: boolean } | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const raw = input as Record<string, unknown>;
  const value = text(raw.value);
  const evidence = text(raw.evidence);
  if (!value && !evidence) return undefined;
  return { value, evidence, manual: raw.manual === true };
}

function normalizeSalesStyleProfile(input: EnterpriseProfile['salesStyleProfile']): SalesStyleProfile {
  const tabooRaw = input?.taboo_phrases;
  const tabooValue = Array.isArray(tabooRaw?.value) ? tabooRaw.value.map(item => text(item)).filter(Boolean) : [];
  return {
    learnedFromCount: Math.max(0, Number(input?.learnedFromCount || 0) || 0),
    lastDistilledAt: text(input?.lastDistilledAt),
    greeting_style: styleField(input?.greeting_style),
    quoting_stance: styleField(input?.quoting_stance),
    followup_rhythm: styleField(input?.followup_rhythm),
    taboo_phrases: tabooValue.length || tabooRaw?.manual ? { value: tabooValue, evidence: text(tabooRaw?.evidence), manual: tabooRaw?.manual === true } : undefined,
    sample_pairs: Array.isArray(input?.sample_pairs) ? input.sample_pairs.map(item => ({
      trigger: text(item?.trigger),
      final: text(item?.final),
      evidence: text(item?.evidence),
    })).filter(item => item.trigger || item.final).slice(0, 8) : [],
  };
}

function normalizeHandoffRules(input: EnterpriseProfile['handoffRules']): HandoffRules {
  const rawKeywords = Array.isArray(input?.keywords) ? input.keywords : DEFAULT_HANDOFF_RULES.keywords;
  const keywords = Array.from(new Set(rawKeywords.map(item => text(item)).filter(Boolean))).slice(0, 20);
  const missRaw = Number(input?.missStreakToDraft);
  return {
    keywords: keywords.length ? keywords : [...DEFAULT_HANDOFF_RULES.keywords],
    missStreakToDraft: missRaw === 1 || missRaw === 3 ? missRaw : 2,
    negativeSentiment: input?.negativeSentiment !== false,
  };
}

function normalizeQuoteMode(value: unknown): QuoteMode {
  return value === 'range' || value === 'human_only' ? 'human_only' : '';
}

function normalizeBargainPolicy(value: unknown): BargainPolicy {
  return value === 'limited' || value === 'open' || value === 'no' ? value : 'no';
}

function normalizeBizRules(
  input: EnterpriseProfile['bizRules'],
  products: EnterpriseProfile['products'],
  operations: NonNullable<EnterpriseProfile['operations']>,
): BizRules {
  const merged = { ...DEFAULT_BIZ_RULES, ...(input ?? {}) };
  const priceRange = text(merged.priceRange) || text(products.priceRange);
  const moq = text(merged.moq) || text(products.moq);
  const paymentTerms = text(merged.paymentTerms) || text(operations.paymentTerms);
  const leadTime = text(merged.leadTime) || text(operations.leadTime);
  const quoteMode = normalizeQuoteMode(merged.quoteMode) || (priceRange ? 'human_only' : '');
  return {
    quoteMode,
    priceRange,
    bargainPolicy: normalizeBargainPolicy(merged.bargainPolicy),
    bargainFloor: text(merged.bargainFloor),
    moq,
    samplePolicy: text(merged.samplePolicy),
    paymentTerms,
    leadTime,
  };
}

function normalizeFaq(input: EnterpriseProfile['faq']): FaqItem[] {
  if (!Array.isArray(input)) return [];
  return input.map(item => ({
    id: text(item?.id) || randomUUID(),
    question: text(item?.question),
    answer: text(item?.answer),
    approvedForAuto: Boolean(item?.approvedForAuto),
    source: normalizeFaqSource(item?.source),
  })).filter(item => item.question || item.answer);
}

function normalizeFaqSource(value: unknown): 'manual' | 'pack' | 'learned' {
  return value === 'pack' || value === 'learned' ? value : 'manual';
}

function normalizeNotifications(input: EnterpriseProfile['notifications']): NotificationSettings {
  const receivers = Array.isArray(input?.receivers)
    ? input.receivers.map(receiver => ({
      name: text(receiver?.name),
      channel: normalizeNotificationChannel(receiver?.channel),
      target: text(receiver?.target),
    })).filter(receiver => receiver.name || receiver.target)
    : [];
  return {
    receivers,
    workHours: {
      start: normalizeHour(input?.workHours?.start, DEFAULT_NOTIFICATIONS.workHours.start),
      end: normalizeHour(input?.workHours?.end, DEFAULT_NOTIFICATIONS.workHours.end),
    },
    quietOutsideHours: input?.quietOutsideHours !== false,
    nightMode: {
      enabled: Boolean(input?.nightMode?.enabled),
      autoCategories: 'approved',
    },
    lastTestAt: text(input?.lastTestAt),
  };
}

function normalizeNotificationChannel(value: unknown): NotificationChannel {
  return value === 'wecom' || value === 'dingtalk' || value === 'feishu' || value === 'sms' ? value : 'wecom';
}

function normalizeHour(value: unknown, fallback: string): string {
  const raw = text(value);
  return /^\d{2}:\d{2}$/.test(raw) ? raw : fallback;
}

function normalizeAutonomy(value: unknown): AutonomyLevel {
  return value === 'remind' || value === 'auto' || value === 'draft' ? value : 'draft';
}

function writeProfile(profile: EnterpriseProfile): void {
  const clean = normalizeProfile(profile) as EnterpriseProfile & { integrations?: unknown };
  delete clean.integrations;
  fs.writeFileSync(DATA_FILE, JSON.stringify(clean, null, 2), 'utf8');
}

function storedProfile(value: unknown): EnterpriseProfile | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return normalizeProfile(JSON.parse(value)); } catch { return null; }
  }
  return typeof value === 'object' ? normalizeProfile(value as EnterpriseProfile) : null;
}

async function readTenantProfile(tenantId: string): Promise<EnterpriseProfile> {
  const result = await store.list<Record<string, unknown>>('tenant_profiles', {
    where: { tenant_id: tenantId }, page: 1, perPage: 1,
  });
  const profile = storedProfile(result.items[0]?.profile);
  if (profile) return withConfirmedFactVersion(
    profile,
    profile,
    profile.factVersion?.confirmedBy || 'legacy_migration',
    new Date(profile.factVersion?.confirmedAt || profile.dataGovernance?.lastSavedAt || 0),
  );
  const fallback = process.env.DEMO_MODE === 'true' ? readProfile() : normalizeProfile({} as EnterpriseProfile);
  return withConfirmedFactVersion(
    fallback,
    fallback,
    fallback.factVersion?.confirmedBy || 'system',
    new Date(fallback.factVersion?.confirmedAt || fallback.dataGovernance?.lastSavedAt || 0),
  );
}

export async function readTenantEnterpriseProfile(tenantId: string): Promise<EnterpriseProfile> {
  return readTenantProfile(tenantId);
}

export interface ConfirmedEnterpriseFacts {
  version: NonNullable<EnterpriseProfile['factVersion']>;
  profile: EnterpriseProfile;
  context: string;
}

export async function readTenantEnterpriseFacts(tenantId: string): Promise<ConfirmedEnterpriseFacts> {
  const profile = await readTenantProfile(tenantId);
  return { version: profile.factVersion!, profile, context: buildEnterpriseContext(profile) };
}

export async function updateTenantEnterpriseProfile(
  tenantId: string,
  patch: Partial<EnterpriseProfile>,
  updatedBy = 'system',
): Promise<EnterpriseProfile> {
  const current = await readTenantProfile(tenantId);
  const next = mergeEnterpriseProfile(current, patch);
  await writeTenantProfile(tenantId, next, updatedBy);
  return next;
}

class EnterpriseFactVersionConflictError extends Error {
  constructor(readonly current: NonNullable<EnterpriseProfile['factVersion']>) {
    super('enterprise_fact_version_conflict');
  }
}

const enterpriseProfileWriteQueues = new Map<string, Promise<void>>();

function normalizeExpectedFactVersion(value: string | undefined): string {
  return String(value || '').trim().replace(/^W\//, '').replace(/^"|"$/g, '');
}

async function writeTenantProfile(
  tenantId: string,
  profile: EnterpriseProfile,
  userId: string,
  expectedFactVersion = '',
): Promise<void> {
  const previousWrite = enterpriseProfileWriteQueues.get(tenantId) || Promise.resolve();
  const currentWrite = previousWrite.catch(() => undefined).then(async () => {
    await writeTenantProfileUnlocked(tenantId, profile, userId, expectedFactVersion);
  });
  enterpriseProfileWriteQueues.set(tenantId, currentWrite);
  try { await currentWrite; }
  finally { if (enterpriseProfileWriteQueues.get(tenantId) === currentWrite) enterpriseProfileWriteQueues.delete(tenantId); }
}

async function writeTenantProfileUnlocked(
  tenantId: string,
  profile: EnterpriseProfile,
  userId: string,
  expectedFactVersion = '',
): Promise<void> {
  const result = await store.list<Record<string, unknown>>('tenant_profiles', {
    where: { tenant_id: tenantId }, page: 1, perPage: 1,
  });
  const existing = result.items[0];
  const previous = storedProfile(existing?.profile);
  if (expectedFactVersion) {
    const current = withConfirmedFactVersion(
      previous || ({} as EnterpriseProfile),
      previous,
      previous?.factVersion?.confirmedBy || 'system',
      new Date(previous?.factVersion?.confirmedAt || previous?.dataGovernance?.lastSavedAt || 0),
    );
    if (expectedFactVersion !== current.factVersion?.contentHash && expectedFactVersion !== current.factVersion?.id) {
      throw new EnterpriseFactVersionConflictError(current.factVersion!);
    }
  }
  const clean = withConfirmedFactVersion(profile, previous, userId) as EnterpriseProfile & { integrations?: unknown };
  delete clean.integrations;
  profile.factVersion = clean.factVersion;
  const ok = existing?.id
    ? await store.update('tenant_profiles', String(existing.id), { profile: clean, updated_by: userId })
    : Boolean(await store.create('tenant_profiles', { tenant_id: tenantId, profile: clean, updated_by: userId }));
  if (!ok) throw new Error('tenant_profile_storage_unavailable');
}

export function readEnterpriseProfile(): EnterpriseProfile {
  return readProfile();
}

export type KnowledgeSectionKey = 'products' | 'materials' | 'bizRules' | 'faq' | 'market' | 'company';

export interface KnowledgeCompletion {
  completed: number;
  total: 6;
  profileCompleteness: {
    percentage: number;
    completed: number;
    total: 4;
    checks: Record<'productImage' | 'price' | 'certificate' | 'market', boolean>;
  };
  todos: Array<{
    id: string;
    kind: 'product_image' | 'price' | 'certificate' | 'market';
    label: string;
    description: string;
    view: 'products' | 'company';
    anchor: string;
    productId?: string;
    productIndex?: number;
  }>;
  sections: Record<KnowledgeSectionKey, { completed: boolean; label: string }>;
  notificationsReady: boolean;
  capabilities: {
    productGrounding: { unlocked: boolean; label: string; reason: string };
    quoteDraft: { unlocked: boolean; label: string; reason: string };
    autoReply: { unlocked: boolean; label: string; reason: string };
    importantAlerts: { unlocked: boolean; label: string; reason: string };
  };
}

function assetCounts(profile: EnterpriseProfile) {
  const items = profile.products.items ?? [];
  return items.reduce((acc, item) => {
    acc.images += (item.images?.length ?? 0) + (item.imageUrl ? 1 : 0);
    acc.videos += item.videos?.length ?? 0;
    acc.documents += item.documents?.length ?? 0;
    return acc;
  }, { images: 0, videos: 0, documents: 0 });
}

function hasTestedNotificationTarget(profile: EnterpriseProfile): boolean {
  return Boolean((profile.notifications?.receivers ?? []).length >= 1 && profile.notifications?.lastTestAt);
}

export function knowledgeCompletion(profile: EnterpriseProfile): KnowledgeCompletion {
  const normalized = normalizeProfile(profile);
  const productItems = normalized.products.items ?? [];
  const counts = assetCounts(normalized);
  const totalAssets = counts.images + counts.videos + counts.documents;
  const hasProductVideo = (normalized.products.items ?? []).some(item => (item.videos?.length ?? 0) >= 1);
  const sections: KnowledgeCompletion['sections'] = {
    products: { label: '产品资料', completed: (normalized.products.items ?? []).length >= 1 },
    materials: { label: '素材库', completed: hasProductVideo || totalAssets >= 5 },
    bizRules: {
      label: '报价与业务规则',
      completed: Boolean(normalized.bizRules?.quoteMode && normalized.bizRules.samplePolicy && normalized.bizRules.paymentTerms),
    },
    faq: { label: '常见问答', completed: (normalized.faq ?? []).length >= 5 },
    market: {
      label: '目标市场与语言',
      completed: Boolean(text(normalized.company.mainMarkets) && text(normalized.company.primaryLanguages)),
    },
    company: { label: '公司介绍', completed: text(normalized.company.description).length >= 50 },
  };
  const productImageReady = productItems.length > 0 && productItems.every(item => Boolean(
    text(item.imageUrl) || (item.images?.length ?? 0) > 0,
  ));
  const priceReady = Boolean(text(normalized.products.priceRange) || text(normalized.bizRules?.priceRange))
    || (productItems.length > 0 && productItems.every(item => Boolean(text(item.priceRange) || text(item.retailPrice) || text(item.tagPrice))));
  const certificateReady = Boolean(text(normalized.products.certifications))
    || (productItems.length > 0 && productItems.every(item => Boolean(
      text(item.certifications) || (item.certificateImages?.length ?? 0) > 0 || (item.documents?.length ?? 0) > 0,
    )));
  const marketReady = Boolean(text(normalized.company.mainMarkets) && text(normalized.company.primaryLanguages));
  const checks = { productImage: productImageReady, price: priceReady, certificate: certificateReady, market: marketReady };
  const incompleteImage = productItems.findIndex(item => !(text(item.imageUrl) || (item.images?.length ?? 0) > 0));
  const incompletePrice = productItems.findIndex(item => !(text(item.priceRange) || text(item.retailPrice) || text(item.tagPrice)));
  const incompleteCertificate = productItems.findIndex(item => !(text(item.certifications) || (item.certificateImages?.length ?? 0) > 0 || (item.documents?.length ?? 0) > 0));
  const todos: KnowledgeCompletion['todos'] = [];
  if (!productImageReady) todos.push({
    id: `product-image-${Math.max(0, incompleteImage)}`, kind: 'product_image', label: '补产品图',
    description: productItems[incompleteImage]?.name ? `${productItems[incompleteImage]!.name} 缺少可用于内容与投放的产品图` : '先添加产品并上传一张产品图',
    view: 'products', anchor: 'product-image',
    ...(incompleteImage >= 0 ? { productId: enterpriseProductIdentity(productItems[incompleteImage]!, incompleteImage), productIndex: incompleteImage } : {}),
  });
  if (!priceReady) todos.push({
    id: `price-${Math.max(0, incompletePrice)}`, kind: 'price', label: '补价格',
    description: productItems[incompletePrice]?.name ? `${productItems[incompletePrice]!.name} 缺少参考价格` : '补充产品或内部参考价格',
    view: 'products', anchor: 'product-price', ...(incompletePrice >= 0 ? { productId: enterpriseProductIdentity(productItems[incompletePrice]!, incompletePrice), productIndex: incompletePrice } : {}),
  });
  if (!certificateReady) todos.push({
    id: `certificate-${Math.max(0, incompleteCertificate)}`, kind: 'certificate', label: '补证书',
    description: productItems[incompleteCertificate]?.name ? `${productItems[incompleteCertificate]!.name} 缺少认证或资质凭证` : '补充认证名称或上传资质凭证',
    view: 'products', anchor: 'product-certificate', ...(incompleteCertificate >= 0 ? { productId: enterpriseProductIdentity(productItems[incompleteCertificate]!, incompleteCertificate), productIndex: incompleteCertificate } : {}),
  });
  if (!marketReady) todos.push({
    id: 'market', kind: 'market', label: '补市场信息', description: '补充目标市场和主要沟通语言',
    view: 'company', anchor: 'enterprise-language-settings',
  });
  const completedChecks = Object.values(checks).filter(Boolean).length;
  return {
    completed: Object.values(sections).filter(section => section.completed).length,
    total: 6,
    profileCompleteness: { percentage: completedChecks * 25, completed: completedChecks, total: 4, checks },
    todos,
    sections,
    notificationsReady: hasTestedNotificationTarget(normalized),
    capabilities: {
      productGrounding: {
        unlocked: sections.products.completed,
        label: '看懂产品',
        reason: sections.products.completed ? 'AI 回复会引用已录入的真实产品' : '先录入 1 个主推产品',
      },
      quoteDraft: {
        unlocked: sections.products.completed && sections.bizRules.completed,
        label: '识别询价并转人工',
        reason: sections.bizRules.completed ? 'AI 会整理询价条件并提醒销售接手' : '再确认样品、付款和交期口径',
      },
      autoReply: {
        unlocked: (normalized.faq ?? []).filter(item => item.approvedForAuto && item.question && item.answer).length >= 5,
        label: '自动回答常见问题',
        reason: (normalized.faq ?? []).filter(item => item.approvedForAuto && item.question && item.answer).length >= 5
          ? '已审批的标准问答可在安全范围内自动发送'
          : '审批 5 条常见问答后解锁',
      },
      importantAlerts: {
        unlocked: hasTestedNotificationTarget(normalized),
        label: '及时提醒重要询盘',
        reason: hasTestedNotificationTarget(normalized) ? '重要询盘会通知指定负责人' : '设置并测试 1 位通知接收人',
      },
    },
  };
}

export function bizRulesReady(profile: EnterpriseProfile): boolean {
  return knowledgeCompletion(profile).sections.bizRules.completed;
}

export function shouldSuppressPrice(profile: EnterpriseProfile): boolean {
  return true;
}

export function autoFaqReady(profile: EnterpriseProfile): boolean {
  return (normalizeProfile(profile).faq ?? []).filter(item => item.approvedForAuto && item.question && item.answer).length >= 5;
}

export function findApprovedFaqAnswer(profile: EnterpriseProfile, message: string): FaqItem | null {
  const normalizedMessage = text(message).toLowerCase();
  if (!normalizedMessage) return null;
  const candidates = (normalizeProfile(profile).faq ?? []).filter(item => item.approvedForAuto && item.question && item.answer);
  return candidates.find(item => normalizedMessage.includes(item.question.toLowerCase()) || item.question.toLowerCase().includes(normalizedMessage)) ?? null;
}

export function buildBizRulesInstruction(profile: EnterpriseProfile): string {
  const normalized = normalizeProfile(profile);
  const rules = normalized.bizRules ?? DEFAULT_BIZ_RULES;
  const lines = [
    'Enterprise business rules:',
    `Quote mode: ${rules.quoteMode || 'not_configured'}`,
    rules.priceRange ? `Internal price reference only; never send it to the buyer: ${rules.priceRange}` : '',
    'Hard rule: never send prices, currency amounts, unit prices, discounts, or quotation promises. Mark price requests as waiting_for_human_quote and hand them to a human seller.',
    rules.moq ? `MOQ guidance: ${rules.moq}` : '',
    rules.samplePolicy ? `Sample policy: ${rules.samplePolicy}` : '',
    rules.paymentTerms ? `Payment terms: ${rules.paymentTerms}` : '',
    rules.leadTime ? `Lead time: ${rules.leadTime}` : '',
    rules.bargainPolicy ? `Bargaining policy: ${rules.bargainPolicy}${rules.bargainFloor ? `; floor note: ${rules.bargainFloor}` : ''}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

export function notificationTargetReady(profile: EnterpriseProfile): boolean {
  return hasTestedNotificationTarget(normalizeProfile(profile));
}

function readApiKey(req: Request) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return String(req.headers['x-api-key'] || bearer || '').trim();
}

async function verifyProductApiKey(req: Request): Promise<{ profile: EnterpriseProfile; secret: ProductApiCredential } | null> {
  const provided = readApiKey(req);
  if (!provided) return null;
  const secret = await productApiSecretForKey(provided);
  if (!secret) return null;
  await assertLegacyExternalEffectAllowed(secret.tenantId);
  return { profile: await readTenantProfile(secret.tenantId), secret };
}

function respondLegacyProductApiFailure(error: unknown, res: import('express').Response): void {
  if (error instanceof Starter198LegacyEffectError) {
    if (error.code === 'starter_198_orchestrator_only') {
      // This public endpoint is authenticated only by the supplied key. Do not
      // reveal that a historical starter key still exists or remains valid.
      res.status(401).json({ error: 'Invalid API Key' });
      return;
    }
    res.status(error.status).json({ error: error.code });
    return;
  }
  res.status(503).json({ error: 'product_api_unavailable' });
}

type ApiProductInput = {
  sku?: unknown;
  name?: unknown;
  color?: unknown;
  size?: unknown;
  tagPrice?: unknown;
  retailPrice?: unknown;
  moq?: unknown;
  brand?: unknown;
  material?: unknown;
  imageUrl?: unknown;
  highlights?: unknown;
  attributes?: unknown;
};

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function normalizeApiProduct(input: ApiProductInput): NonNullable<EnterpriseProfile['products']['items']>[number] | null {
  const sku = text(input.sku);
  const name = text(input.name) || sku;
  if (!name) return null;
  const imageUrl = text(input.imageUrl);
  return {
    id: randomUUID(),
    sku,
    name,
    color: text(input.color),
    size: text(input.size),
    tagPrice: text(input.tagPrice),
    retailPrice: text(input.retailPrice),
    moq: text(input.moq),
    brand: text(input.brand),
    material: text(input.material),
    imageUrl,
    highlights: text(input.highlights),
    attributes: input.attributes && typeof input.attributes === 'object' && !Array.isArray(input.attributes) ? input.attributes as Record<string, unknown> : {},
    images: imageUrl ? [{ name: '商品图片URL', type: 'image/url', size: 0, updatedAt: new Date().toISOString(), url: imageUrl }] : [],
    videos: [],
    documents: [],
    factoryImages: [],
    packagingImages: [],
    certificateImages: [],
    sceneImages: [],
    brandAssets: [],
  };
}

function upsertProductItems(existing: NonNullable<EnterpriseProfile['products']['items']>, incoming: NonNullable<EnterpriseProfile['products']['items']>) {
  const next = [...existing];
  for (const product of incoming) {
    const sku = product.sku?.trim();
    const index = sku
      ? next.findIndex(item => item.sku?.trim() === sku)
      : next.findIndex(item => item.name?.trim() === product.name?.trim());
    if (index >= 0) next[index] = mergeEnterpriseProductIdentity(next[index], product, index);
    else next.push(product);
  }
  return next;
}

export function buildEnterpriseContext(profile: EnterpriseProfile): string {
  if (profile.dataGovernance?.aiAccessEnabled === false) return '';
  const parts: string[] = [];
  if (profile.factVersion) parts.push(`企业事实版本：${profile.factVersion.id}`);
  if (profile.company.name) parts.push(`公司名称：${profile.company.name}`);
  if (profile.company.industry) parts.push(`行业类目：${profile.company.industry}`);
  if (profile.company.companyType) parts.push(`企业类型：${profile.company.companyType}`);
  if (profile.socialStrategy?.enabledRoutes?.length) parts.push(`社媒合作路线：${profile.socialStrategy.enabledRoutes.join('/')}`);
  if (profile.company.mainMarkets) parts.push(`主攻市场：${profile.company.mainMarkets}`);
  if (profile.company.primaryLanguages) parts.push(`主要业务语言：${profile.company.primaryLanguages}`);
  if (profile.company.socialPlatformExperience) parts.push(`海外平台经验：${profile.company.socialPlatformExperience}`);
  if (profile.company.description) parts.push(`公司简介：${profile.company.description}`);
  if (profile.products.categories) parts.push(`主营产品：${profile.products.categories}`);
  if (profile.products.priceRange) parts.push(`价格区间：${profile.products.priceRange}`);
  if (profile.products.moq) parts.push(`起订量：${profile.products.moq}`);
  if (profile.products.certifications) parts.push(`认证资质：${profile.products.certifications}`);
  if (profile.products.highlights) parts.push(`产品优势：${profile.products.highlights}`);
  if (Array.isArray(profile.products.items) && profile.products.items.length) {
    profile.products.items.forEach((item, index) => {
      const details = [
        item.name || `产品${index + 1}`,
        item.category ? `类目：${item.category}` : '',
        item.priceRange ? `价格：${item.priceRange}` : '',
        item.moq ? `起订量：${item.moq}` : '',
        item.certifications ? `资质：${item.certifications}` : '',
        item.highlights ? `卖点：${item.highlights}` : '',
        item.images?.length ? `图片附件：${item.images.map(a => a.name).join('、')}` : '',
        item.videos?.length ? `视频附件：${item.videos.map(a => a.name).join('、')}` : '',
        item.documents?.length ? `资质文书附件：${item.documents.map(a => a.name).join('、')}` : '',
        item.factoryImages?.length ? `工厂实拍素材：${item.factoryImages.map(a => a.name).join('、')}` : '',
        item.packagingImages?.length ? `包装定制素材：${item.packagingImages.map(a => a.name).join('、')}` : '',
        item.certificateImages?.length ? `证书资质素材：${item.certificateImages.map(a => a.name).join('、')}` : '',
        item.sceneImages?.length ? `使用场景素材：${item.sceneImages.map(a => a.name).join('、')}` : '',
        item.brandAssets?.length ? `品牌视觉素材：${item.brandAssets.map(a => a.name).join('、')}` : '',
      ].filter(Boolean);
      if (details.length) parts.push(`产品${index + 1}：${details.join('；')}`);
    });
  }
  if (profile.bizRules) {
    parts.push(`Business rules: quoteMode=${profile.bizRules.quoteMode || 'not_configured'}; priceRange=${profile.bizRules.priceRange || ''}; moq=${profile.bizRules.moq || ''}; samplePolicy=${profile.bizRules.samplePolicy || ''}; paymentTerms=${profile.bizRules.paymentTerms || ''}; leadTime=${profile.bizRules.leadTime || ''}; bargainPolicy=${profile.bizRules.bargainPolicy || ''}; bargainFloor=${profile.bizRules.bargainFloor || ''}`);
  }
  const approvedFaq = (profile.faq ?? []).filter(item => item.approvedForAuto && item.question && item.answer);
  if (approvedFaq.length) {
    parts.push(`Approved FAQ for auto reply:\n${approvedFaq.map(item => `Q: ${item.question}\nA: ${item.answer}`).join('\n')}`);
  }
  if (profile.notifications?.receivers?.length) {
    parts.push(`Notification receivers: ${profile.notifications.receivers.map(item => `${item.name}/${item.channel}`).join('; ')}; workHours=${profile.notifications.workHours.start}-${profile.notifications.workHours.end}; quietOutsideHours=${profile.notifications.quietOutsideHours}; nightMode=${profile.notifications.nightMode.enabled ? 'enabled' : 'disabled'}`);
  }
  if (profile.handoffRules) {
    parts.push(`Handoff rules: keywords=${profile.handoffRules.keywords.join('/')}; missStreakToDraft=${profile.handoffRules.missStreakToDraft}; negativeSentiment=${profile.handoffRules.negativeSentiment}`);
  }
  if (profile.brand?.name) parts.push(`品牌名称：${profile.brand.name}`);
  if (profile.brand?.usp) parts.push(`核心卖点：${profile.brand.usp}`);
  if (profile.brand?.tone) parts.push(`品牌调性：${profile.brand.tone}`);
  if (profile.brand?.preferredLanguages) parts.push(`首选输出语言：${profile.brand.preferredLanguages}`);
  if (profile.brand?.taboos) parts.push(`禁忌话题：${profile.brand.taboos}`);
  if (profile.strategy?.currentGoal) parts.push(`当前经营目标：${profile.strategy.currentGoal}`);
  if (profile.strategy?.focusProducts) parts.push(`重点产品：${profile.strategy.focusProducts}`);
  if (profile.strategy?.focusMarkets) parts.push(`重点市场：${profile.strategy.focusMarkets}`);
  if (profile.strategy?.excludedMarkets) parts.push(`暂不经营市场：${profile.strategy.excludedMarkets}`);
  if (profile.strategy?.pricingStrategy) parts.push(`价格策略：${profile.strategy.pricingStrategy}`);
  if (profile.strategy?.minMargin) parts.push(`最低利润要求：${profile.strategy.minMargin}`);
  if (profile.strategy?.agentAutonomy) parts.push(`Agent 执行权限：${profile.strategy.agentAutonomy}`);
  if (profile.strategy?.aiAutonomy) parts.push(`AI 参与程度：${profile.strategy.aiAutonomy}`);
  if (profile.customers?.targetProfiles) parts.push(`目标客户画像：${profile.customers.targetProfiles}`);
  if (profile.customers?.highValueSignals) parts.push(`高价值客户信号：${profile.customers.highValueSignals}`);
  if (profile.customers?.lowQualitySignals) parts.push(`低质量询盘特征：${profile.customers.lowQualitySignals}`);
  if (profile.customers?.commonQuestions) parts.push(`客户常问问题：${profile.customers.commonQuestions}`);
  if (profile.customers?.followupStyle) parts.push(`跟进偏好：${profile.customers.followupStyle}`);
  if (profile.operations?.leadTime) parts.push(`交期能力：${profile.operations.leadTime}`);
  if (profile.operations?.customization) parts.push(`定制能力：${profile.operations.customization}`);
  if (profile.operations?.logistics) parts.push(`物流履约：${profile.operations.logistics}`);
  if (profile.operations?.paymentTerms) parts.push(`付款条款：${profile.operations.paymentTerms}`);
  if (profile.operations?.riskNotes) parts.push(`履约风险提示：${profile.operations.riskNotes}`);
  if (profile.agentLearning?.provenAngles) parts.push(`已验证有效角度：${profile.agentLearning.provenAngles}`);
  if (profile.agentLearning?.weakAngles) parts.push(`低效角度/需降权：${profile.agentLearning.weakAngles}`);
  if (profile.agentLearning?.pendingAssumptions) parts.push(`待用户确认推断：${profile.agentLearning.pendingAssumptions}`);
  if (profile.agentLearning?.userCorrections) parts.push(`用户纠正偏好：${profile.agentLearning.userCorrections}`);
  if (profile.knowledge) parts.push(`补充知识：${profile.knowledge}`);
  return parts.join('\n');
}

function fallbackFaqStructure(raw: string): FaqItem[] {
  const lines = raw.split(/\r?\n+/).map(line => line.trim()).filter(Boolean);
  const items: FaqItem[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const [questionPart, ...answerParts] = line.split(/[：:]/);
    const looksLikeQuestion = /[?？]|^(q|问|问题)/i.test(line);
    if (answerParts.length || looksLikeQuestion) {
      const question = answerParts.length ? questionPart.replace(/^(q|问|问题)\s*/i, '').trim() : line;
      const answer = answerParts.join(':').replace(/^(a|答|答案)\s*/i, '').trim() || lines[index + 1] || '';
      items.push({ id: randomUUID(), question, answer, approvedForAuto: false });
      if (!answerParts.length && lines[index + 1]) index += 1;
    }
  }
  if (!items.length && raw.trim()) {
    items.push({ id: randomUUID(), question: '常见问题', answer: raw.trim(), approvedForAuto: false });
  }
  return items.slice(0, 20);
}

function parseFaqItemsFromLLM(raw: string): FaqItem[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => ({
      id: randomUUID(),
      question: text(item?.question),
      answer: text(item?.answer),
      approvedForAuto: false,
    })).filter(item => item.question && item.answer).slice(0, 30);
  } catch {
    return [];
  }
}

async function structureFaqText(raw: string): Promise<FaqItem[]> {
  const source = raw.trim();
  if (!source) return [];
  try {
    const prompt = [
      '把下面旧版常见问答文本整理成 JSON 数组。',
      '只返回 JSON，不要解释。数组元素格式：{"question":"客户可能这样问","answer":"标准回答"}。',
      '合并重复问题，保留卖家原意，不要编造价格、交期或政策。',
      '',
      source,
    ].join('\n');
    const result = parseFaqItemsFromLLM(await callLLM(prompt));
    if (result.length) return result;
  } catch {
    // Fall through to deterministic parsing.
  }
  return fallbackFaqStructure(source);
}

export function updateEnterpriseProfile(patch: Partial<EnterpriseProfile>): EnterpriseProfile {
  const next = normalizeProfile({ ...readProfile(), ...patch } as EnterpriseProfile);
  writeProfile(next);
  return next;
}

type PackIndustry = 'apparel' | 'home' | 'general';
type PackScenario = 'presales' | 'shipping' | 'aftersales' | 'credentials';
interface PackEntry { q: string; a: string; vars?: string[] }

const PACK_ROOT = path.join(__dirname, '../knowledge/packs');
const INDUSTRY_LABELS: Record<PackIndustry, string> = { apparel: '服装', home: '家居', general: '通用' };
const SCENARIO_LABELS: Record<PackScenario, string> = { presales: '售前', shipping: '物流与运费', aftersales: '售后', credentials: '公司资质' };

function packVars(profile: EnterpriseProfile): Record<string, string> {
  const rules = profile.bizRules ?? DEFAULT_BIZ_RULES;
  return {
    moq: text(rules.moq),
    samplePolicy: text(rules.samplePolicy),
    paymentTerms: text(rules.paymentTerms),
    leadTime: text(rules.leadTime),
    priceRange: text(rules.priceRange),
    bargainFloor: text(rules.bargainFloor),
  };
}

function readPack(industry: PackIndustry, scenario: PackScenario): PackEntry[] {
  const file = path.join(PACK_ROOT, industry, `${scenario}.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as PackEntry[];
  return Array.isArray(raw) ? raw : [];
}

function fillPackEntry(entry: PackEntry, vars: Record<string, string>) {
  const required = Array.isArray(entry.vars) ? entry.vars : [];
  const missingVars = required.filter(key => !text(vars[key]));
  const answer = required.reduce((next, key) => next.replaceAll(`{${key}}`, vars[key] || `{${key}}`), entry.a);
  return {
    q: text(entry.q),
    a: answer,
    vars: required,
    missingVars,
    ready: missingVars.length === 0,
  };
}

function inferIndustry(profile: EnterpriseProfile): PackIndustry {
  const raw = `${profile.company?.industry || ''} ${profile.products?.categories || ''}`.toLowerCase();
  if (/服装|服饰|衣|裤|裙|鞋|帽|apparel|fashion|garment|clothing|textile/.test(raw)) return 'apparel';
  if (/家居|家具|家纺|收纳|厨房|home|house|furniture|decor|kitchen/.test(raw)) return 'home';
  return 'general';
}

function buildPackPreview(profile: EnterpriseProfile, industry: PackIndustry, scenario: PackScenario) {
  const vars = packVars(profile);
  const items = readPack(industry, scenario).map(entry => fillPackEntry(entry, vars));
  const existing = new Set((profile.faq ?? []).map(item => text(item.question).toLowerCase()).filter(Boolean));
  return {
    id: `${industry}/${scenario}`,
    industry,
    industryLabel: INDUSTRY_LABELS[industry],
    scenario,
    scenarioLabel: SCENARIO_LABELS[scenario],
    count: items.length,
    preview: items.slice(0, 3),
    items: items.map(item => ({ ...item, exists: existing.has(item.q.toLowerCase()) })),
  };
}

function allPackPreviews(profile: EnterpriseProfile) {
  const industries = Object.keys(INDUSTRY_LABELS) as PackIndustry[];
  const scenarios = Object.keys(SCENARIO_LABELS) as PackScenario[];
  return industries.flatMap(industry => scenarios.map(scenario => buildPackPreview(profile, industry, scenario)));
}

export const enterpriseRouter = Router();
enterpriseRouter.use(requireAuth);

async function customerServiceRuntimeStatus(tenantId: string, profile: EnterpriseProfile) {
  const status = customerServiceStatus(profile);
  const messagingAuthorization = await readCustomerMessagingAuthorization(tenantId);
  return {
    ...status,
    autoReplyReady: status.autoReplyReady && messagingAuthorization.inboundAutoSendAllowed,
    messagingAuthorization,
  };
}

enterpriseRouter.get('/profile', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const profile = await readTenantProfile(tenantId);
  res.setHeader('ETag', `"${profile.factVersion!.contentHash}"`);
  res.json(profile);
});

enterpriseRouter.get('/facts', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const facts = await readTenantEnterpriseFacts(tenantId);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('ETag', `"${facts.version.contentHash}"`);
  res.json(facts);
});

enterpriseRouter.get('/customer-service/status', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  res.setHeader('Cache-Control', 'no-store');
  const profile = await readTenantProfile(tenantId);
  res.json(await customerServiceRuntimeStatus(tenantId, profile));
});

enterpriseRouter.patch('/customer-service/status', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  try {
    const current = await readTenantProfile(tenantId);
    const now = new Date().toISOString();
    let settings = normalizeCustomerServiceSettings(current.customerService);
    let strategy = { ...(current.strategy ?? {}), aiAutonomy: normalizeAutonomy(current.strategy?.aiAutonomy) };

    if (typeof req.body?.enabled === 'boolean' && req.body.enabled !== settings.enabled) {
      settings = req.body.enabled
        ? {
          enabled: true,
          enabledAt: now,
          disabledAt: settings.disabledAt || '',
          partialAutoReplyEnabled: false,
          partialAutoReplyDecision: 'pending',
          partialAutoReplyDecisionAt: '',
        }
        : {
          enabled: false,
          enabledAt: '',
          disabledAt: now,
          partialAutoReplyEnabled: false,
          partialAutoReplyDecision: 'pending',
          partialAutoReplyDecisionAt: '',
        };
      strategy = { ...strategy, aiAutonomy: 'draft' };
    }

    const decision = req.body?.partialAutoReplyDecision;
    if (decision === 'enabled' || decision === 'declined') {
      const policy = customerServicePolicyFromSettings(settings);
      if (!policy.enabled) {
        res.status(409).json({ error: 'customer_service_disabled', message: '请先开启智能客服。' });
        return;
      }
      if (!policy.eligibleForPartialAutoReply) {
        res.status(409).json({
          error: 'observation_period_active',
          message: `建议模式还需运行 ${policy.remainingHours} 小时，暂不能开放直接回复。`,
          status: customerServiceStatus({ ...current, customerService: settings }),
        });
        return;
      }
      settings = {
        ...settings,
        partialAutoReplyEnabled: decision === 'enabled',
        partialAutoReplyDecision: decision,
        partialAutoReplyDecisionAt: now,
      };
      strategy = { ...strategy, aiAutonomy: decision === 'enabled' ? 'auto' : 'draft' };
    }

    const profile = markProfileSaved(normalizeProfile({
      ...current,
      strategy,
      customerService: settings,
    }), 'enterprise_center');
    await writeTenantProfile(tenantId, profile, userId);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, status: await customerServiceRuntimeStatus(tenantId, profile), profile });
  } catch (error) {
    console.error('[enterprise] customer service status update failed', error);
    res.status(503).json({ error: 'tenant_profile_storage_unavailable', message: '智能客服设置暂时无法保存，请稍后重试。' });
  }
});

enterpriseRouter.post('/style-profile/distill', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  try {
    const { distillSalesStyleProfile } = await import('../knowledge/styleMemory.js');
    const profile = await distillSalesStyleProfile(tenantId, true);
    if (!profile) {
      res.status(409).json({ error: 'not_enough_samples', message: '修改样本不足 20 条，暂时无法生成销售风格档案。' });
      return;
    }
    res.json({ ok: true, salesStyleProfile: profile });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'style_profile_distill_failed' });
  }
});

enterpriseRouter.get('/knowledge-completion', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const profile = await readTenantProfile(tenantId);
  res.json(knowledgeCompletion(profile));
});

enterpriseRouter.post('/knowledge-intake/extract', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  try {
    const [{ getWhatsAppKnowledgeSamples, getWhatsAppWinningStyleSamples }, { extractKnowledgeFromHistory }, { importWinningStyleMemories }] = await Promise.all([
      import('../whatsapp/historyImport.js'),
      import('../knowledge/intake.js'),
      import('../knowledge/styleMemory.js'),
    ]);
    const profile = await readTenantProfile(tenantId);
    const samples = getWhatsAppKnowledgeSamples(tenantId, { maxConversations: 60, maxMessages: 500, sinceDays: 180 });
    const preview = await extractKnowledgeFromHistory(profile, samples);
    const winningStyleSamples = getWhatsAppWinningStyleSamples(tenantId, 200);
    const styleSamplesImported = await importWinningStyleMemories(tenantId, winningStyleSamples);
    res.json({
      ...preview,
      styleSamplesImported,
      winningStyleSamplesFound: winningStyleSamples.length,
      styleFactsExcluded: true,
    });
  } catch (error) {
    console.error('[knowledge-intake] extract failed:', error);
    res.status(500).json({
      error: 'knowledge_extraction_failed',
      message: error instanceof Error ? error.message : '暂时无法整理历史聊天，请稍后重试。',
    });
  }
});

enterpriseRouter.post('/knowledge-intake/draft', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  try {
    const { draftKnowledgeFromProducts } = await import('../knowledge/intake.js');
    const profile = await readTenantProfile(tenantId);
    res.json(await draftKnowledgeFromProducts(profile));
  } catch (error) {
    console.error('[knowledge-intake] product draft failed:', error);
    res.status(500).json({
      error: 'knowledge_draft_failed',
      message: error instanceof Error ? error.message : '暂时无法生成初稿，请稍后重试。',
    });
  }
});

enterpriseRouter.post('/knowledge-intake/apply', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const profile = await readTenantProfile(tenantId);
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const companyIntro = text(body.companyIntro);
  const rawRules = body.bizRules && typeof body.bizRules === 'object' ? body.bizRules as Record<string, unknown> : {};
  const nextRules: BizRules = normalizeBizRules({
    ...(profile.bizRules ?? DEFAULT_BIZ_RULES),
    ...(rawRules.quoteMode === 'range' || rawRules.quoteMode === 'human_only' ? { quoteMode: rawRules.quoteMode } : {}),
    ...(rawRules.bargainPolicy === 'no' || rawRules.bargainPolicy === 'limited' || rawRules.bargainPolicy === 'open' ? { bargainPolicy: rawRules.bargainPolicy } : {}),
    ...(['priceRange', 'bargainFloor', 'moq', 'samplePolicy', 'paymentTerms', 'leadTime'] as const).reduce<Record<string, string>>((acc, key) => {
      if (key in rawRules) acc[key] = text(rawRules[key]);
      return acc;
    }, {}),
  } as BizRules, profile.products, profile.operations ?? {});

  const incomingFaqs: FaqItem[] = (Array.isArray(body.faqs) ? body.faqs : [])
    .map(item => item && typeof item === 'object' ? item as Record<string, unknown> : {})
    .map(item => ({
      id: text(item.id) || randomUUID(),
      question: text(item.question),
      answer: text(item.answer),
      approvedForAuto: item.approvedForAuto === true,
      source: item.source === 'learned' ? 'learned' as const : 'manual' as const,
    }))
    .filter(item => item.question && item.answer);
  const nextFaqs = [...(profile.faq ?? [])];
  let importedFaqs = 0;
  incomingFaqs.forEach(item => {
    const index = nextFaqs.findIndex(existing => text(existing.question).toLowerCase() === item.question.toLowerCase());
    if (index >= 0) nextFaqs[index] = { ...nextFaqs[index], ...item, id: nextFaqs[index].id };
    else {
      nextFaqs.push(item);
      importedFaqs += 1;
    }
  });

  const rawNotifications = body.notifications && typeof body.notifications === 'object'
    ? body.notifications as Partial<NotificationSettings>
    : null;
  const existingReceivers = profile.notifications?.receivers ?? [];
  const incomingReceivers = Array.isArray(rawNotifications?.receivers) ? rawNotifications.receivers : [];
  const mergedReceivers = [...existingReceivers];
  incomingReceivers.forEach(receiver => {
    const normalizedTarget = text(receiver?.target);
    if (!normalizedTarget) return;
    const index = mergedReceivers.findIndex(existing => existing.channel === receiver.channel && text(existing.target) === normalizedTarget);
    if (index >= 0) mergedReceivers[index] = receiver;
    else mergedReceivers.push(receiver);
  });
  const notifications = rawNotifications
    ? normalizeNotifications({
      ...(profile.notifications ?? DEFAULT_NOTIFICATIONS),
      ...rawNotifications,
      receivers: mergedReceivers,
      workHours: {
        ...(profile.notifications?.workHours ?? DEFAULT_NOTIFICATIONS.workHours),
        ...(rawNotifications.workHours ?? {}),
      },
    })
    : profile.notifications;
  const confirmedSections = Array.isArray(body.confirmedSections)
    ? Array.from(new Set([
      ...(profile.knowledgeIntake?.confirmedSections ?? []),
      ...body.confirmedSections.map(text).filter(Boolean),
    ])).slice(0, 12)
    : profile.knowledgeIntake?.confirmedSections ?? [];
  const source = body.source === 'history' || body.source === 'products' || body.source === 'interview'
    ? body.source
    : profile.knowledgeIntake?.source;
  const extractedMessages = Math.max(0, Number(body.extractedMessages || 0) || 0);

  const nextProfile = markProfileSaved(normalizeProfile({
    ...profile,
    company: {
      ...profile.company,
      description: companyIntro || profile.company.description,
    },
    bizRules: nextRules,
    faq: nextFaqs,
    notifications,
    knowledgeIntake: {
      ...profile.knowledgeIntake,
      lastExtractedAt: new Date().toISOString(),
      source,
      extractedMessages: extractedMessages || profile.knowledgeIntake?.extractedMessages || 0,
      confirmedSections,
    },
  }), 'knowledge_intake');
  await writeTenantProfile(tenantId, nextProfile, userId);
  res.json({
    ok: true,
    profile: nextProfile,
    importedFaqs,
    completion: knowledgeCompletion(nextProfile),
  });
});

enterpriseRouter.post('/faq/structure', async (req, res) => {
  const source = text(req.body?.text);
  if (!source) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  const items = await structureFaqText(source);
  res.json({ items });
});

enterpriseRouter.get('/faq/packs', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const profile = await readTenantProfile(tenantId);
  res.json({
    recommendedIndustry: inferIndustry(profile),
    packs: allPackPreviews(profile),
  });
});

enterpriseRouter.post('/faq/packs/import', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const profile = await readTenantProfile(tenantId);
  const industry = text(req.body?.industry) as PackIndustry;
  const scenario = text(req.body?.scenario) as PackScenario;
  const selected = Array.isArray(req.body?.questions) ? req.body.questions.map(text).filter(Boolean) : [];
  if (!(industry in INDUSTRY_LABELS) || !(scenario in SCENARIO_LABELS)) {
    res.status(400).json({ error: 'invalid_pack' });
    return;
  }
  const pack = buildPackPreview(profile, industry, scenario);
  const selectedSet = new Set(selected.map((item: string) => item.toLowerCase()));
  const existing = new Set((profile.faq ?? []).map(item => text(item.question).toLowerCase()).filter(Boolean));
  const incoming: FaqItem[] = pack.items
    .filter((item: ReturnType<typeof fillPackEntry> & { exists?: boolean }) => item.ready && !item.exists && (!selected.length || selectedSet.has(item.q.toLowerCase())))
    .map((item): FaqItem => ({
      id: randomUUID(),
      question: item.q,
      answer: item.a,
      approvedForAuto: false,
      source: 'pack',
    }))
    .filter(item => {
      const key = item.question.toLowerCase();
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
  const nextProfile = { ...profile, faq: [...(profile.faq ?? []), ...incoming] };
  await writeTenantProfile(tenantId, nextProfile, userId);
  res.json({
    ok: true,
    imported: incoming.length,
    skipped: pack.items.length - incoming.length,
    profile: nextProfile,
  });
});

enterpriseRouter.post('/faq/learned', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const profile = await readTenantProfile(tenantId);
  const buyerMessage = text(req.body?.buyerMessage);
  const answer = text(req.body?.answer);
  const questionInput = text(req.body?.question);
  if (!buyerMessage || !answer) {
    res.status(400).json({ error: 'buyer_message_and_answer_required' });
    return;
  }
  let question = questionInput;
  if (!question) {
    try {
      const prompt = [
        '把买家原话概括成一句中文常见问题，适合放进企业知识库 FAQ。',
        '只返回问题本身，不要解释，不要加引号。',
        `买家原话：${buyerMessage}`,
      ].join('\n');
      question = text(await callLLM(prompt, { backend: 'qwen', model: process.env.KNOWLEDGE_QUERY_MODEL || 'qwen-plus' }));
    } catch {
      question = buyerMessage.length > 60 ? `${buyerMessage.slice(0, 57)}...` : buyerMessage;
    }
  }
  const existing = new Set((profile.faq ?? []).map(item => text(item.question).toLowerCase()).filter(Boolean));
  if (existing.has(question.toLowerCase())) {
    res.json({ ok: true, skipped: true, profile, item: (profile.faq ?? []).find(item => text(item.question).toLowerCase() === question.toLowerCase()) });
    return;
  }
  const item: FaqItem = {
    id: randomUUID(),
    question,
    answer,
    approvedForAuto: false,
    source: 'learned',
  };
  const nextProfile = { ...profile, faq: [...(profile.faq ?? []), item] };
  await writeTenantProfile(tenantId, nextProfile, userId);
  res.json({ ok: true, item, profile: nextProfile });
});

enterpriseRouter.post('/faq/learned/suggest', async (req, res) => {
  const buyerMessage = text(req.body?.buyerMessage);
  if (!buyerMessage) {
    res.status(400).json({ error: 'buyer_message_required' });
    return;
  }
  try {
    const prompt = [
      '把买家原话概括成一句中文常见问题，适合放进企业知识库 FAQ。',
      '只返回问题本身，不要解释，不要加引号。',
      `买家原话：${buyerMessage}`,
    ].join('\n');
    const question = text(await callLLM(prompt, { backend: 'qwen', model: process.env.KNOWLEDGE_QUERY_MODEL || 'qwen-plus' }));
    res.json({ question: question || buyerMessage });
  } catch {
    res.json({ question: buyerMessage.length > 60 ? `${buyerMessage.slice(0, 57)}...` : buyerMessage });
  }
});

enterpriseRouter.post('/notifications/test', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const profile = await readTenantProfile(tenantId);
  const receiver = req.body?.receiver as Partial<NotificationReceiver> | undefined;
  const target = text(receiver?.target);
  const name = text(receiver?.name) || '通知接收人';
  const channel = normalizeNotificationChannel(receiver?.channel);
  if (!target) {
    res.status(400).json({ error: 'receiver target is required' });
    return;
  }
  const normalizedReceiver: NotificationReceiver = { name, channel, target };
  try {
    await notifyDeliveryTeam(`[灵枢测试提醒] ${name} (${channel}/${target}) 已接入重要客户提醒。`, {
      immediate: true,
      receivers: [normalizedReceiver],
    });
  } catch (error) {
    res.status(502).json({
      error: 'notification_test_failed',
      message: channel === 'sms'
        ? '短信通道尚未接入供应商，请先改用钉钉、飞书或企业微信群机器人 Webhook。'
        : `测试消息没有真正送达：${error instanceof Error ? error.message : 'unknown_error'}`,
    });
    return;
  }
  const receivers = [...(profile.notifications?.receivers ?? [])];
  const receiverIndex = receivers.findIndex(item => item.channel === channel && text(item.target) === target);
  if (receiverIndex >= 0) receivers[receiverIndex] = normalizedReceiver;
  else receivers.push(normalizedReceiver);
  const notifications = normalizeNotifications({
    ...(profile.notifications ?? DEFAULT_NOTIFICATIONS),
    receivers,
    lastTestAt: new Date().toISOString(),
  });
  await writeTenantProfile(tenantId, { ...profile, notifications }, userId);
  res.json({ ok: true, lastTestAt: notifications.lastTestAt, notifications });
});

const orderMutations = new Map<string, Promise<void>>();
enterpriseRouter.use('/orders', async (req, res, next) => {
  if (req.method === 'GET') { next(); return; }
  if (isBrowserReadToken(req.headers.authorization)) { res.status(403).json({ error: 'agent_browser_read_only' }); return; }
  const tenantId = authenticatedTenantId(res);
  if (!tenantId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const previous = orderMutations.get(tenantId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  orderMutations.set(tenantId, current);
  await previous;
  const finish = () => { release(); if (orderMutations.get(tenantId) === current) orderMutations.delete(tenantId); };
  res.once('finish', finish); res.once('close', finish);
  next();
});

enterpriseRouter.get('/orders', async (req, res) => {
  try {
  const tenantId = authenticatedTenantId(res);
  if (!tenantId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  res.json({ items: await readOrders(tenantId) });
  } catch (error) { res.status(503).json({ error: '订单存储暂不可用，请使用相同请求重试' }); }
});

enterpriseRouter.post('/orders', async (req, res) => {
  try {
  const tenantId = authenticatedTenantId(res);
  if (!tenantId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const order = normalizeOrder({ ...(req.body || {}), id: undefined, audit: [], afterSales: undefined, afterSalesHistory: [], paidAt: undefined, refundedAt: undefined, refundAmount: undefined, source: req.body?.source || '手工录入' });
  if (!order) {
    res.status(400).json({ error: 'invalid order payload' });
    return;
  }
  const existingOrders = await readOrders(tenantId);
  const repeated = order.idempotencyKey && existingOrders.find(item => item.idempotencyKey === order.idempotencyKey);
  if (repeated) {
    if (repeated.buyer !== order.buyer || repeated.product !== order.product || repeated.amount !== order.amount || repeated.customerId !== order.customerId) { res.status(409).json({ error: '相同请求标识对应不同订单内容，请重新发起录入' }); return; }
    if (repeated.customerSyncStatus !== 'done') await upsertOrder(tenantId, repeated);
    res.json(repeated); return;
  }
  if (order.customerId) {
    const customer = getWhatsAppCustomers(tenantId).find(item => item.id === order.customerId);
    if (!customer) { res.status(422).json({ error: '客户不存在或不属于当前租户' }); return; }
    if (!order.sourcePostId) order.sourcePostId = customer.sourcePostId || '';
  }
  if (req.body?.status && !ORDER_STATUSES.includes(req.body.status)) { res.status(422).json({ error: '无效订单状态' }); return; }
  if (!['待付款', '已取消'].includes(order.status)) {
    const evidence = String(req.body?.evidence || order.sourceRef || '').trim();
    if (!evidence) { res.status(422).json({ error: '已付款/退款等历史状态需提供来源凭证' }); return; }
    order.audit = [{ at: order.importedAt, from: '导入', to: order.status, evidence, source: 'manual_record' }];
  }
  if (existingOrders.some(item => item.orderNo === order.orderNo)) { res.status(409).json({ error: '订单号已存在' }); return; }
  if (!await upsertOrder(tenantId, order)) {
    res.status(503).json({ error: 'order storage unavailable' });
    return;
  }
  res.status(201).json(order);
  } catch (error) { res.status(503).json({ error: '订单存储暂不可用，请使用相同请求重试' }); }
});

enterpriseRouter.patch('/orders/:id/status', async (req, res) => {
  try {
  const tenantId = authenticatedTenantId(res);
  if (!tenantId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const status = req.body?.status;
  const orders = await readOrders(tenantId);
  const index = orders.findIndex(order => order.id === req.params.id);
  if (index < 0) {
    res.status(404).json({ error: 'order not found' });
    return;
  }
  try { orders[index] = transitionOrder(orders[index], status, String(req.body?.evidence || '')); }
  catch (error) { res.status(422).json({ error: (error as Error).message }); return; }
  if (!await upsertOrder(tenantId, orders[index])) {
    res.status(503).json({ error: 'order storage unavailable' });
    return;
  }
  res.json(orders[index]);
  } catch (error) { res.status(503).json({ error: '订单存储暂不可用，请使用相同请求重试' }); }
});

enterpriseRouter.post('/orders/:id/sync-customer', async (req, res) => {
  try {
  const tenantId = authenticatedTenantId(res);
  if (!tenantId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const order = (await readOrders(tenantId)).find(item => item.id === req.params.id);
  if (!order) { res.status(404).json({ error: 'order not found' }); return; }
  if (!await upsertOrder(tenantId, order)) { res.status(503).json({ error: 'order storage unavailable' }); return; }
  res.json(order);
  } catch (error) { res.status(503).json({ error: '订单存储暂不可用，请使用相同请求重试' }); }
});

enterpriseRouter.patch('/orders/:id/aftersales', async (req, res) => {
  try {
  const tenantId = authenticatedTenantId(res);
  if (!tenantId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const order = (await readOrders(tenantId)).find(item => item.id === req.params.id);
  if (!order) { res.status(404).json({ error: 'order not found' }); return; }
  try {
    const updated = updateAfterSales(order, req.body?.status, String(req.body?.text || ''));
    if (!await upsertOrder(tenantId, updated)) { res.status(503).json({ error: 'order storage unavailable' }); return; }
    res.json(updated);
  } catch (error) { res.status(422).json({ error: (error as Error).message }); }
  } catch (error) { res.status(503).json({ error: '订单存储暂不可用，请使用相同请求重试' }); }
});

enterpriseRouter.delete('/orders/:id', async (req, res) => {
  try {
  const tenantId = authenticatedTenantId(res);
  if (!tenantId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const target = (await readOrders(tenantId)).find(item => item.id === req.params.id);
  if (target && (target.status !== '待付款' || target.audit?.length || target.customerId)) {
    res.status(422).json({ error: '已关联客户或已有交易记录的订单请保留审计记录，通过取消/退款维护状态' }); return;
  }
  if (!await deleteOrder(tenantId, req.params.id)) {
    res.status(404).json({ error: 'order not found' });
    return;
  }
  res.status(204).end();
  } catch (error) { res.status(503).json({ error: '订单存储暂不可用，请使用相同请求重试' }); }
});

enterpriseRouter.post('/orders/import', async (req, res) => {
  try {
  const tenantId = authenticatedTenantId(res);
  if (!tenantId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const { csv } = req.body as { csv?: string };
  if (!csv?.trim()) {
    res.status(400).json({ error: 'csv is required' });
    return;
  }
  const result = importOrdersFromCsv(csv);
  const existing = await readOrders(tenantId);
  const merged = new Map<string, OrderRecord>();
  existing.forEach(order => merged.set(order.orderNo, order));
  const additions = result.imported.filter(order => !merged.has(order.orderNo) && Boolean(merged.set(order.orderNo, order)));
  const items = [...merged.values()].sort((a, b) => b.orderDate.localeCompare(a.orderDate));
  for (const order of additions) {
    if (!await upsertOrder(tenantId, order)) {
      res.status(503).json({ error: 'order storage unavailable' });
      return;
    }
  }
  res.json({ ok: true, imported: additions.length, skipped: result.skipped + result.imported.length - additions.length, total: items.length });
  } catch (error) { res.status(503).json({ error: '订单存储暂不可用，请使用相同请求重试' }); }
});

enterpriseRouter.use('/product-api', enterpriseProductApiRouter);

enterpriseRouter.get('/product-api/status', async (_req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const result = await withLegacyExternalEffectAllowed(tenantId, async () => {
      const profile = await readTenantProfile(tenantId);
      const items = profile.products.items ?? [];
      const secret = await productApiSecretForTenant(tenantId);
      return {
        count: items.length,
        lastIngestedAt: secret?.lastIngestedAt || '',
        lastProductName: secret?.lastProductName || items.at(-1)?.name || '',
      };
    });
    res.json(result);
  } catch (error) {
    respondLegacyProductApiFailure(error, res);
  }
});

enterpriseRouter.post('/assets', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { name, type, dataUrl } = req.body as { name?: string; type?: string; dataUrl?: string };
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!name || !match) {
    res.status(400).json({ error: 'invalid asset payload' });
    return;
  }
  let storedName = safeStoredName(name);
  let buffer = Buffer.from(match[2], 'base64');
  let contentType = enterpriseAssetContentType(name, type || match[1]);
  if (!enterpriseAssetTypeAllowed(contentType)) {
    res.status(415).json({ error: 'only image, video and PDF enterprise assets are supported' });
    return;
  }
  if (buffer.length === 0 || buffer.length > 110 * 1024 * 1024) {
    res.status(413).json({ error: 'enterprise asset must be between 1 byte and 110 MB' });
    return;
  }

  let material: Record<string, unknown> | undefined;
  let normalized: Awaited<ReturnType<typeof normalizeTenantMedia>> | undefined;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-enterprise-upload-'));
  try {
    if (contentType.startsWith('image/') || contentType.startsWith('video/') || contentType.startsWith('audio/')) {
      normalized = await normalizeTenantMedia({
        buffer, originalName: name, declaredMimeType: contentType,
        kind: contentType.startsWith('image/') ? 'image' : contentType.startsWith('audio/') ? 'audio' : 'video',
        temporaryDirectory: tempDir,
      });
      buffer = normalized.buffer;
      storedName = safeStoredName(normalized.filename);
      contentType = normalized.mimeType;
    }
    if (objectStorageEnabled()) {
      await objectStorageUpload({
        key: enterpriseAssetObjectKey(tenantId, storedName),
        body: buffer,
        contentType,
      });
    } else {
      ensureAssetsDir();
      const tenantDir = path.join(ASSETS_DIR, enterpriseAssetTenantKey(tenantId));
      fs.mkdirSync(tenantDir, { recursive: true });
      fs.writeFileSync(path.join(tenantDir, storedName), buffer);
    }
    if (contentType.startsWith('image/') || contentType.startsWith('video/') || contentType.startsWith('audio/')) {
      const materialInput: Parameters<typeof upsertTenantUploadCloudMaterial>[0] = {
        tenantId,
        title: name,
        folder: 'enterprise-upload',
        type: contentType.startsWith('image/') ? 'image' : contentType.startsWith('audio/') ? 'audio' : 'video',
        sizeBytes: buffer.length,
        duration: normalized?.duration,
        width: normalized?.width,
        height: normalized?.height,
        sha256: normalized?.sha256 || createHash('sha256').update(buffer).digest('hex'),
        scope: 'own',
        usage: 'editable',
        sourceType: 'enterprise_upload',
        sourceName: name,
        sourceProvider: 'tenant',
        sourceUrl: `/api/overseas/enterprise/assets/${storedName}`,
        sourceEntry: 'enterprise_knowledge',
        provenance: {
          uploadMethod: 'enterprise_knowledge',
          sourceEntry: 'enterprise_knowledge',
          originalName: name,
          mimeType: contentType,
          receivedAt: new Date().toISOString(),
          knowledgeEligible: true,
          normalization: normalized?.normalization,
        },
        media: { name: storedName, buf: buffer, contentType },
        ...(normalized?.poster ? { poster: { name: normalized.poster.filename, buf: normalized.poster.buffer, contentType: normalized.poster.mimeType } } : {}),
      };
      material = currentDataAuthority() === 'local'
        ? upsertLocalEnterpriseMaterial({
          tenantId, title: name, type: materialInput.type, sizeBytes: buffer.length,
          duration: normalized?.duration, width: normalized?.width, height: normalized?.height,
          sha256: materialInput.sha256, sourceUrl: String(materialInput.sourceUrl || ''), sourceName: name,
          provenance: materialInput.provenance || {},
        })
        : await upsertTenantUploadCloudMaterial(materialInput);
      const materialId = String(material.id || '');
      if (materialId) void import('../lib/materialLibraryAnalysis.js')
        .then(module => module.requestMaterialAnalysis(tenantId, materialId))
        .catch(error => console.warn('[enterprise-assets] material analysis start failed', error instanceof Error ? error.message : error));
    }
  } catch (error) {
    console.error('[enterprise-assets] upload failed', error instanceof Error ? error.message : error);
    res.status(503).json({ error: 'enterprise asset storage unavailable' });
    return;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  res.json({
    name,
    type: contentType,
    size: buffer.length,
    updatedAt: new Date().toISOString(),
    url: `/api/overseas/enterprise/assets/${storedName}`,
    material,
  });
});

enterpriseRouter.post('/assets/import-url', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const sourceUrl = String(req.body?.url || '').trim();
  const requestedName = String(req.body?.name || '').trim().slice(0, 160);
  const productId = String(req.body?.productId || '').trim().slice(0, 160);
  if (!sourceUrl) { res.status(400).json({ error: 'url is required' }); return; }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-product-image-import-'));
  try {
    const normalized = await downloadAndNormalizeExternalImage({ url: sourceUrl, temporaryDirectory: tempDir });
    const storedName = safeStoredName(normalized.filename);
    if (objectStorageEnabled()) {
      await objectStorageUpload({ key: enterpriseAssetObjectKey(tenantId, storedName), body: normalized.buffer, contentType: normalized.mimeType });
    } else {
      ensureAssetsDir();
      const tenantDir = path.join(ASSETS_DIR, enterpriseAssetTenantKey(tenantId));
      fs.mkdirSync(tenantDir, { recursive: true });
      fs.writeFileSync(path.join(tenantDir, storedName), normalized.buffer, { mode: 0o600 });
    }
    const enterpriseUrl = `/api/overseas/enterprise/assets/${storedName}`;
    const materialInput: Parameters<typeof upsertTenantUploadCloudMaterial>[0] = {
      tenantId, title: requestedName || path.basename(normalized.filename), folder: 'enterprise-upload', type: 'image',
      width: normalized.width, height: normalized.height, sizeBytes: normalized.buffer.length, sha256: normalized.sha256,
      scope: 'own', usage: 'editable', sourceType: 'enterprise_product_image_import', sourceName: requestedName || normalized.filename,
      sourceProvider: 'tenant', sourceUrl: normalized.sourceUrl, sourceEntry: 'enterprise_knowledge', productId: productId || undefined,
      provenance: { uploadMethod: 'enterprise_external_url', sourceEntry: 'enterprise_knowledge', originalUrl: normalized.sourceUrl,
        enterpriseAssetUrl: enterpriseUrl, normalization: normalized.normalization, knowledgeEligible: true, receivedAt: new Date().toISOString() },
      media: { name: storedName, buf: normalized.buffer, contentType: normalized.mimeType },
      ...(normalized.poster ? { poster: { name: normalized.poster.filename, buf: normalized.poster.buffer, contentType: normalized.poster.mimeType } } : {}),
    };
    const material = currentDataAuthority() === 'local'
      ? upsertLocalEnterpriseMaterial({
        tenantId, title: materialInput.title, type: 'image', sizeBytes: normalized.buffer.length,
        width: normalized.width, height: normalized.height, sha256: normalized.sha256,
        sourceUrl: enterpriseUrl, sourceName: String(materialInput.sourceName || materialInput.title), productId: productId || undefined,
        provenance: materialInput.provenance || {},
      })
      : await upsertTenantUploadCloudMaterial(materialInput);
    void import('../lib/materialLibraryAnalysis.js').then(module => module.requestMaterialAnalysis(tenantId, String(material.id || ''))).catch(() => {});
    res.status(201).json({ name: requestedName || normalized.filename, type: normalized.mimeType, size: normalized.buffer.length,
      width: normalized.width, height: normalized.height, sha256: normalized.sha256, sourceUrl: normalized.sourceUrl,
      url: enterpriseUrl, material });
  } catch (error) {
    const known = error instanceof ExternalImageImportError;
    res.status(known ? 422 : 503).json({ error: error instanceof Error ? error.message : 'external image import failed', ...(known ? { code: error.code } : {}) });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

enterpriseRouter.get('/assets/:file', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const file = path.basename(req.params.file);
  if (objectStorageEnabled()) {
    try {
      const requestedRange = /^bytes=\d*-\d*$/.test(String(req.headers.range || ''))
        ? String(req.headers.range)
        : undefined;
      const object = await objectStorageGetObject(enterpriseAssetObjectKey(tenantId, file), requestedRange);
      if (object) {
        res.setHeader('Content-Type', object.contentType);
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.setHeader('Accept-Ranges', object.acceptRanges || 'bytes');
        if (object.contentLength !== undefined) res.setHeader('Content-Length', String(object.contentLength));
        if (object.contentRange) {
          res.status(206);
          res.setHeader('Content-Range', object.contentRange);
        }
        if (object.etag) res.setHeader('ETag', object.etag);
        if (object.lastModified) res.setHeader('Last-Modified', object.lastModified.toUTCString());
        for await (const chunk of object.body) res.write(chunk);
        res.end();
        return;
      }
    } catch (error) {
      console.error('[enterprise-assets] COS read failed', error instanceof Error ? error.message : error);
      res.status(503).json({ error: 'enterprise asset storage unavailable' });
      return;
    }
  }

  // Compatibility path while the resumable migration copies historical files.
  const tenantDir = path.join(ASSETS_DIR, enterpriseAssetTenantKey(tenantId));
  const filePath = path.join(tenantDir, file);
  if (!fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }
  res.sendFile(filePath);
});

function enterpriseFactVersionMatchesRequest(req: Request, current: EnterpriseProfile): boolean {
  const expected = normalizeExpectedFactVersion(req.header('if-match'));
  return !expected || expected === current.factVersion?.contentHash || expected === current.factVersion?.id;
}

enterpriseRouter.post('/profile', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  try {
    const current = await readTenantProfile(tenantId);
    if (!enterpriseFactVersionMatchesRequest(req, current)) {
      res.status(409).json({
        error: 'enterprise_fact_version_conflict',
        message: '企业资料已由其他页面更新，请刷新后再保存。',
        factVersion: current.factVersion,
      });
      return;
    }
    const profile = markProfileSaved(normalizeProfile({
      ...(req.body as EnterpriseProfile),
      customerService: current.customerService,
    }), 'enterprise_center');
    await writeTenantProfile(tenantId, profile, userId, normalizeExpectedFactVersion(req.header('if-match')));
    res.json({ ok: true, profile });
  } catch (error) {
    if (error instanceof EnterpriseFactVersionConflictError) {
      res.status(409).json({ error: error.message, message: '企业资料已由其他页面更新，请刷新后再保存。', factVersion: error.current });
      return;
    }
    console.error('[enterprise] profile save failed', error);
    res.status(503).json({ error: 'tenant_profile_storage_unavailable', message: '企业资料暂时无法保存，请稍后重试' });
  }
});

enterpriseRouter.patch('/profile', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const source = req.header('x-enterprise-save-source') === 'diagnosis' ? 'diagnosis' : 'enterprise_center';
  try {
    const current = await readTenantProfile(tenantId);
    if (!enterpriseFactVersionMatchesRequest(req, current)) {
      res.status(409).json({
        error: 'enterprise_fact_version_conflict',
        message: '企业资料已由其他页面更新，请刷新后再保存。',
        factVersion: current.factVersion,
      });
      return;
    }
    const profile = markProfileSaved(normalizeProfile({
      ...mergeEnterpriseProfile(current, req.body as Partial<EnterpriseProfile>),
      customerService: current.customerService,
    }), source);
    await writeTenantProfile(tenantId, profile, userId, normalizeExpectedFactVersion(req.header('if-match')));
    res.json({ ok: true, profile });
  } catch (error) {
    if (error instanceof EnterpriseFactVersionConflictError) {
      res.status(409).json({ error: error.message, message: '企业资料已由其他页面更新，请刷新后再保存。', factVersion: error.current });
      return;
    }
    console.error('[enterprise] profile patch failed', error);
    res.status(503).json({ error: 'tenant_profile_storage_unavailable', message: '企业资料暂时无法保存，请稍后重试' });
  }
});

enterpriseRouter.get('/context', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const facts = await readTenantEnterpriseFacts(tenantId);
  res.json({ context: facts.context, factVersion: facts.version });
});

export const productApiRouter = Router();

productApiRouter.post('/bulk', async (req, res) => {
  try {
    const verified = await verifyProductApiKey(req);
    if (!verified) {
      res.status(401).json({ error: 'Invalid API Key' });
      return;
    }
    const { secret } = verified;
    const payload = Array.isArray(req.body) ? req.body : req.body?.products;
    if (!Array.isArray(payload)) {
      res.status(400).json({ error: 'Body should be { products: [...] } or an array.' });
      return;
    }
    const products = payload.map(item => normalizeApiProduct(item)).filter(Boolean) as NonNullable<EnterpriseProfile['products']['items']>;
    const total = await withLegacyExternalEffectAllowed(secret.tenantId, async guard => {
      const profile = await readTenantProfile(secret.tenantId);
      const nextItems = upsertProductItems(profile.products.items ?? [], products);
      const last = products.at(-1);
      await guard.beforeEffect();
      await writeTenantProfile(secret.tenantId, { ...profile, products: { ...profile.products, items: nextItems } }, 'product-api');
      const keyRecord = await store.list<Record<string, unknown>>('tenant_api_keys', { where: { tenant_id: secret.tenantId }, page: 1, perPage: 1 });
      if (keyRecord.items[0]?.id) {
        await guard.beforeEffect();
        await store.update('tenant_api_keys', String(keyRecord.items[0].id), { last_ingested_at: new Date().toISOString(), last_product_name: last?.name || '' });
      }
      return nextItems.length;
    });
    res.json({ ok: true, received: payload.length, upserted: products.length, total });
  } catch (error) {
    respondLegacyProductApiFailure(error, res);
  }
});

productApiRouter.get('/', async (req, res) => {
  try {
    const verified = await verifyProductApiKey(req);
    if (!verified) {
      res.status(401).json({ error: 'Invalid API Key' });
      return;
    }
    const { profile } = verified;
    const sku = text(req.query.sku);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
    const items = (profile.products.items ?? []).filter(item => !sku || item.sku === sku).slice(0, limit);
    res.json({ total: items.length, items });
  } catch (error) {
    respondLegacyProductApiFailure(error, res);
  }
});

productApiRouter.delete('/:sku?', async (req, res) => {
  try {
    const verified = await verifyProductApiKey(req);
    if (!verified) {
      res.status(401).json({ error: 'Invalid API Key' });
      return;
    }
    const { secret } = verified;
    const sku = text(req.params.sku || req.query.sku || req.body?.sku);
    if (!sku) {
      res.status(400).json({ error: 'Missing sku' });
      return;
    }
    const result = await withLegacyExternalEffectAllowed(secret.tenantId, async guard => {
      const profile = await readTenantProfile(secret.tenantId);
      const before = profile.products.items ?? [];
      const after = before.filter(item => item.sku !== sku);
      await guard.beforeEffect();
      await writeTenantProfile(secret.tenantId, { ...profile, products: { ...profile.products, items: after } }, 'product-api');
      return { deleted: before.length - after.length, total: after.length };
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    respondLegacyProductApiFailure(error, res);
  }
});
