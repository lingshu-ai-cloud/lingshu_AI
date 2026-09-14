import type { DataStore, ListResult, Record_ } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import { createHash } from 'node:crypto';

type Row = Record_ & Record<string, unknown>;

export interface StarterProductionObservation {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  updatedAt: string | null;
  evidence: string | null;
}

export interface StarterProductionSource {
  available: boolean;
  truncated: boolean;
  items: StarterProductionObservation[];
}

export interface StarterProductionReadModel {
  inspiration: StarterProductionSource;
  content: StarterProductionSource;
  sales: StarterProductionSource;
}

export class StarterProductionReadError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'StarterProductionReadError';
  }
}

const text = (value: unknown, max = 500): string => (
  typeof value === 'string' ? value.trim().slice(0, max) : ''
);

const DISPLAY_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const EMAIL_ADDRESS = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_NUMBER = /(?:\+?\d[\s().-]*){7,}/g;
const INLINE_URL = /https?:\/\/\S+/gi;

/**
 * Free-form business copy is display-only. Normalize unsafe controls and
 * structurally hide contact locators; secrets/provider objects are excluded by
 * the field-level projectors below instead of relying on keyword redaction.
 */
function businessText(value: unknown, max = 300): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(DISPLAY_CONTROLS, ' ')
    .replace(EMAIL_ADDRESS, '[联系方式已隐藏]')
    .replace(PHONE_NUMBER, '[联系方式已隐藏]')
    .replace(INLINE_URL, '[链接已隐藏]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function publicObservationId(kind: string, value: unknown): string {
  const digest = createHash('sha256').update(`${kind}:${text(value, 200)}`).digest('hex').slice(0, 12);
  return `${kind}-${digest}`;
}

function safeTimestamp(value: unknown): string | null {
  const candidate = text(value, 80);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function safeSourceUrl(value: unknown): string | null {
  try {
    const url = new URL(text(value, 2_000));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, 500);
  } catch { return null; }
}

function knownStatus(value: unknown, allowed: ReadonlySet<string>, fallback: string): string {
  const candidate = text(value, 80).toLowerCase();
  return allowed.has(candidate) ? candidate : fallback;
}

const INSPIRATION_STATUSES = new Set(['collected', 'pending', 'analyzing', 'analyzed', 'ready', 'completed', 'failed']);
const CONTENT_STATUSES = new Set(['draft', 'queued', 'running', 'rendering', 'ready', 'ready_for_approval', 'completed', 'failed', 'cancelled']);
const SALES_STAGES = new Set(['new', 'lead', 'inquiry', 'qualified', 'quoted', 'negotiating', 'follow_up', 'won', 'lost', 'dormant']);
const PLATFORMS = new Set(['facebook', 'instagram', 'tiktok', 'youtube']);
const SALES_SOURCES: Readonly<Record<string, string>> = {
  manual: '人工录入',
  manual_import: '人工导入',
  whatsapp: 'WhatsApp',
  whatsapp_from_youtube: 'YouTube → WhatsApp',
  email: '邮件',
  trade_show: '展会',
  other: '其他已记录来源',
};

function object(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => text(item, 180)).filter(Boolean) : [];
}

async function scopedRows(input: {
  dataStore: DataStore;
  collection: string;
  tenantId: string;
  tenantField: 'tenant_id' | 'tenantId';
  sort: string;
}): Promise<{ available: boolean; truncated: boolean; items: Row[] }> {
  let result: ListResult<Row>;
  try {
    result = await input.dataStore.list<Row>(input.collection, {
      where: { [input.tenantField]: input.tenantId },
      sort: input.sort,
      page: 1,
      perPage: 100,
    });
  } catch {
    return { available: false, truncated: false, items: [] };
  }
  if (!Array.isArray(result.items) || !Number.isFinite(result.totalItems)) {
    throw new StarterProductionReadError('starter_198_production_read_invalid');
  }
  if (result.items.some(item => text(item[input.tenantField], 200) !== input.tenantId)) {
    throw new StarterProductionReadError('starter_198_production_read_tenant_violation');
  }
  return {
    available: true,
    truncated: result.totalItems > result.items.length,
    items: result.items,
  };
}

function inspirationItem(row: Row): StarterProductionObservation {
  const analysis = object(row.aiAnalysis) ?? object(row.ai_analysis);
  const hooks = stringList(analysis?.hooks);
  const sellingPoints = stringList(analysis?.sellingPoints ?? analysis?.selling_points);
  const summary = businessText(analysis?.summary)
    || businessText(analysis?.theme)
    || businessText(hooks[0])
    || businessText(sellingPoints[0])
    || null;
  const platformCandidate = text(row.platform, 40).toLowerCase();
  const platform = PLATFORMS.has(platformCandidate) ? platformCandidate : '';
  const sourceUrl = safeSourceUrl(row.sourceUrl ?? row.source_url);
  return {
    id: publicObservationId('trend', row.id),
    title: businessText(row.title, 240) || '未命名趋势内容',
    summary,
    status: knownStatus(row.status, INSPIRATION_STATUSES, analysis ? 'analyzed' : 'collected'),
    updatedAt: safeTimestamp(row.crawledAt ?? row.crawled_at ?? row.updated),
    evidence: sourceUrl || (platform ? `平台来源：${platform}` : null),
  };
}

function contentItem(row: Row): StarterProductionObservation {
  const spec = object(row.spec);
  const automation = object(spec?.automation);
  const product = businessText(spec?.productInfo ?? spec?.product, 160);
  const format = businessText(spec?.format ?? spec?.contentFormat, 60);
  const summary = businessText(spec?.summary)
    || [product, format].filter(Boolean).join(' · ')
    || null;
  const workflowRunId = text(spec?.workflowRunId ?? automation?.workflowRunId, 200);
  return {
    id: publicObservationId('content', row.id),
    title: businessText(row.title, 240) || '未命名内容项目',
    summary,
    status: knownStatus(row.status, CONTENT_STATUSES, 'unknown'),
    updatedAt: safeTimestamp(row.updated_at ?? row.updated ?? row.created_at),
    evidence: workflowRunId ? `工作流已绑定 · ${publicObservationId('run', workflowRunId).slice(-12)}` : null,
  };
}

function salesItem(row: Row): StarterProductionObservation {
  const payload = object(row.payload);
  const stage = knownStatus(row.stage ?? payload?.stage, SALES_STAGES, 'unknown');
  const source = text(payload?.source, 120).toLowerCase();
  const publicId = publicObservationId('lead', row.id);
  return {
    id: publicId,
    title: `客户线索 ${publicId.slice(-6).toUpperCase()}`,
    summary: stage === 'unknown' ? '阶段待结构化' : `阶段：${stage}`,
    status: stage,
    updatedAt: safeTimestamp(row.last_active_at ?? payload?.updatedAt ?? row.updated),
    evidence: SALES_SOURCES[source] ? `来源：${SALES_SOURCES[source]}` : source ? '来源已记录' : null,
  };
}

function mapSource(
  source: { available: boolean; truncated: boolean; items: Row[] },
  mapper: (row: Row) => StarterProductionObservation,
): StarterProductionSource {
  return {
    available: source.available,
    truncated: source.truncated,
    items: source.items.map(mapper).filter(item => Boolean(item.id)),
  };
}

/**
 * Tenant-scoped, read-only projection of the existing business production
 * surfaces. It deliberately returns summaries instead of raw records so model
 * prompts, credentials and private provider payloads cannot leak into Starter.
 */
export async function readStarterProductionModel(
  tenantId: string,
  dataStore: DataStore = store,
): Promise<StarterProductionReadModel> {
  if (!tenantId || tenantId.length > 200 || /[\u0000-\u001f]/.test(tenantId)) {
    throw new StarterProductionReadError('starter_198_tenant_invalid');
  }
  const [inspiration, content, sales] = await Promise.all([
    scopedRows({ dataStore, collection: 'trend_videos', tenantId, tenantField: 'tenantId', sort: '-crawledAt' }),
    scopedRows({ dataStore, collection: 'studio_projects', tenantId, tenantField: 'tenant_id', sort: '-updated_at' }),
    scopedRows({ dataStore, collection: 'whatsapp_customers', tenantId, tenantField: 'tenant_id', sort: '-last_active_at' }),
  ]);
  return {
    inspiration: mapSource(inspiration, inspirationItem),
    content: mapSource(content, contentItem),
    sales: mapSource(sales, salesItem),
  };
}
