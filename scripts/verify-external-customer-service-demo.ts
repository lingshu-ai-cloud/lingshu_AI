import fs from 'node:fs';
import path from 'node:path';

const baseUrl = String(process.env.EXTERNAL_DEMO_BASE_URL || 'http://127.0.0.1:8788').replace(/\/$/, '');
const email = String(process.env.EXTERNAL_DEMO_EMAIL || '').trim().toLowerCase();
const password = String(process.env.EXTERNAL_DEMO_PASSWORD || '');

if (!email || !password) throw new Error('EXTERNAL_DEMO_EMAIL / EXTERNAL_DEMO_PASSWORD are required');

async function jsonRequest<T>(urlPath: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${urlPath}`, init);
  const data = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(`${urlPath} failed (${response.status}): ${data.message || data.error || 'unknown error'}`);
  return data;
}

const login = await jsonRequest<{ token: string }>('/api/overseas/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };
const session = await jsonRequest<{
  user?: { email?: string; role?: string };
  tenant?: { subscriptionPlan?: string };
  subscription?: { status?: string; plan?: string };
}>('/api/overseas/auth/me', { headers });
const profile = await jsonRequest<{
  company?: { name?: string; mainMarkets?: string };
  products?: { items?: unknown[] };
  faq?: unknown[];
  salesStyleProfile?: { learnedFromCount?: number };
}>('/api/overseas/enterprise/profile', { headers });
const status = await jsonRequest<{ enabled?: boolean; canAutoSend?: boolean }>('/api/overseas/enterprise/customer-service/status', { headers });
const [memoryOverview, styleEvidence, customerMemory, responseStrategies] = await Promise.all([
  jsonRequest<{ readiness?: { editedConfirmed?: number; customerCount?: number } }>('/api/overseas/agent-memory/overview', { headers }),
  jsonRequest<{ items?: Array<Record<string, unknown>> }>('/api/overseas/agent-memory/style-evidence', { headers }),
  jsonRequest<{ items?: Array<Record<string, unknown>> }>('/api/overseas/agent-memory/customer-memories', { headers }),
  jsonRequest<{ items?: Array<Record<string, unknown>> }>('/api/overseas/agent-memory/strategies', { headers }),
]);

if (session.user?.email !== email || session.user?.role !== 'admin') throw new Error('Demo workspace permission verification failed');
if ((session.tenant?.subscriptionPlan || session.subscription?.plan) !== 'customer') throw new Error('Demo account is not isolated as a customer tenant');
if (session.subscription?.status !== 'active') throw new Error('Demo subscription is not active');
if (profile.company?.name !== '文澜天下' || !profile.company.mainMarkets?.includes('苏州')) throw new Error('Industrial equipment enterprise profile is incomplete');
if ((profile.products?.items?.length || 0) < 5 || (profile.faq?.length || 0) < 8) throw new Error('Demo knowledge base is incomplete');
if ((profile.salesStyleProfile?.learnedFromCount || 0) < 10) throw new Error('Learning history was not seeded');
if (!status.enabled || status.canAutoSend) throw new Error('Customer service must be enabled in suggestion-only mode');
const demoStyleEvidence = (styleEvidence.items || []).filter(item => String(item.evidenceSource || '').startsWith('外部演示初始化'));
const demoCustomerMemory = (customerMemory.items || []).filter(item => String(item.customerId || '').startsWith('mock-'));
const demoStrategyIds = new Set((responseStrategies.items || []).map(item => String(item.strategyId || '')));
if (demoStyleEvidence.length < 8) throw new Error('Demo style evidence is missing');
if (demoCustomerMemory.length < 6) throw new Error('Demo customer-private memory is missing');
for (const strategyId of ['T_CONTINUOUS_CHAT', 'T_PILOT_ENTRY', 'T_HIGH_VALUE_HANDOFF']) {
  if (!demoStrategyIds.has(strategyId)) throw new Error(`Demo response strategy is missing: ${strategyId}`);
}
if ((memoryOverview.readiness?.editedConfirmed || 0) < 8 || (memoryOverview.readiness?.customerCount || 0) < 6) {
  throw new Error('Demo memory readiness is incomplete');
}

const distDir = path.resolve(process.env.EXTERNAL_DEMO_DIST_DIR || path.join(process.cwd(), 'dist'));
const indexPath = path.join(distDir, 'index.html');
if (!fs.existsSync(indexPath)) throw new Error(`Frontend bundle not found: ${indexPath}`);
const indexHtml = fs.readFileSync(indexPath, 'utf8');
const entryAsset = indexHtml.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
if (!entryAsset) throw new Error('Frontend entry asset was not found');
const entryPath = path.join(distDir, entryAsset.replace(/^\/+/, ''));
const entryJs = fs.readFileSync(entryPath, 'utf8');
for (const marker of ['wenlantianxia-test@local.test', 'mock-big-order-suzhou-semiconductor', 'AI 草稿 · 人工改过', '客服演示沙盘']) {
  if (!entryJs.includes(marker)) throw new Error(`Frontend bundle is stale; missing marker: ${marker}`);
}

type DraftResult = { draft?: string; handoffRequired?: boolean; category?: string; verification?: { status?: string } };
const draftCases = [
  {
    name: 'solution_discovery',
    body: {
      customerId: 'online-demo-solution', language: '中文', stage: '需求确认', product: '柔性装配追溯线', internalProduct: 'LX-Trace 柔性装配追溯线', intent: 'reply',
      timeline: [
        { id: '1', actor: 'buyer', body: '我们无锡工厂要改造电池模组线，扫码和扭矩现在各自分开。' },
        { id: '2', actor: 'seller', body: '可以先把追溯链路理清。你们现在一条线每班大概多少件？' },
        { id: '3', actor: 'buyer', body: '每班约6000件，漏一条扭矩记录就要停线追查，想先从一条线试点。' },
      ],
    },
  },
  {
    name: 'large_order_handoff',
    body: {
      customerId: 'online-demo-large-order', language: '中文', stage: '报价谈判', product: '18 条半导体装配线改造', internalProduct: '非标整线集成', intent: 'reply',
      bant: { total: 96, budget: 25, authority: 24, need: 24, timing: 23 },
      timeline: [
        { id: '1', actor: 'buyer', body: '我们集团今年准备改造18条线，预算约480万，总经理会参加本周方案会。' },
        { id: '2', actor: 'buyer', body: '这周能不能给正式总价和交付承诺？' },
      ],
    },
  },
] as const;

const draftSummary: Array<{ name: string; chars: number; handoff: boolean; category: string; verification: string }> = [];
for (const item of draftCases) {
  const result = await jsonRequest<DraftResult>('/api/overseas/agents/conversion/draft', {
    method: 'POST', headers, body: JSON.stringify(item.body),
  });
  if (!result.draft?.trim() && !result.handoffRequired) throw new Error(`${item.name} did not produce a draft or handoff`);
  if (item.name === 'large_order_handoff' && !result.handoffRequired) throw new Error('Large-order conversation was not handed to a human');
  draftSummary.push({
    name: item.name,
    chars: result.draft?.trim().length || 0,
    handoff: Boolean(result.handoffRequired),
    category: String(result.category || ''),
    verification: String(result.verification?.status || ''),
  });
}

console.log(JSON.stringify({
  ok: true,
  account: { email, role: session.user.role, plan: session.tenant?.subscriptionPlan || session.subscription?.plan },
  enterprise: { company: profile.company.name, products: profile.products?.items?.length || 0, faq: profile.faq?.length || 0, learnedFrom: profile.salesStyleProfile?.learnedFromCount || 0 },
  customerService: { enabled: status.enabled, canAutoSend: status.canAutoSend },
  memory: {
    styleEvidence: demoStyleEvidence.length,
    customerMemory: demoCustomerMemory.length,
    responseStrategies: demoStrategyIds.size,
    editedConfirmed: memoryOverview.readiness?.editedConfirmed || 0,
    customerCoverage: memoryOverview.readiness?.customerCount || 0,
  },
  frontend: { entryAsset, simulationBundleVerified: true },
  drafts: draftSummary,
}));
