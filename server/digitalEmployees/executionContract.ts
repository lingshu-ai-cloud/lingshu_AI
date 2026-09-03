import { createHash } from 'node:crypto';
import { readTenantEnterpriseProfile, type EnterpriseProfile } from '../routes/enterprise.js';
import { listSocialMetricSnapshots } from '../socialMetrics/store.js';
import { store } from '../storage/index.js';
import { listAllRecords } from '../storage/pagination.js';
import type { DigitalEmployeeConfig, WeeklyGoalInput } from './domain.js';

export type ContractGapSeverity = 'blocking' | 'warning';
export interface ContractGap { code: string; severity: ContractGapSeverity; title: string; resolution: string; source: string; }
export interface ExecutionContract {
  schemaVersion: 1;
  goalVersion: number;
  compiledAt: string;
  payloadHash: string;
  readiness: 'blocked' | 'ready_with_assumptions' | 'ready';
  intent: { outcome: string; priority: 'high' | 'normal'; focusProducts: string[]; audience: string; market: string; };
  measurement: { metric: string; definition: string; baseline: number; target: number; unit: string; window: { startsAt: string; endsAt: string }; source: string; missing: boolean; };
  facts: Array<{ key: string; summary: string; source: string; sourceVersion: string }>;
  resources: { productCount: number; connectedAccounts: Array<{ id: string; platform: string }>; historicalPosts: number; metricSnapshots: number; studioAvailable: boolean; };
  dataGovernance: { aiAccessEnabled: boolean; sourceVersion: string; };
  policy: { autonomyMode: string; aiAccessEnabled: boolean; realPublishRequiresApproval: true; approvalOwner: string; budgetLimit: number; constraints: string[]; stopConditions: string[]; };
  budgetAllocation: Array<{ category: string; limit: number }>;
  qualityGates: string[];
  completionCriteria: string[];
  assumptions: string[];
  gaps: ContractGap[];
  sourceFingerprint: string;
}

function clean(value: unknown, max = 300): string { return String(value ?? '').trim().slice(0, max); }
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}
function stableHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex'); }
export function fingerprintFormalSourceVersions(value: unknown): string { return stableHash(value); }
function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch { return {}; }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function readinessForGaps(gaps: ContractGap[]): ExecutionContract['readiness'] {
  return gaps.some(item => item.severity === 'blocking') ? 'blocked' : gaps.length ? 'ready_with_assumptions' : 'ready';
}
function profileFacts(profile: EnterpriseProfile) {
  const sourceVersion = clean(profile.dataGovernance?.lastSavedAt) || 'unknown';
  const productFacts = (profile.products.items || []).slice(0, 3).map((item, index) => {
    const attributes = Object.entries(item.attributes || {}).slice(0, 20)
      .map(([key, value]) => `${clean(key, 80)}：${clean(value, 160)}`)
      .filter(value => !value.endsWith('：'));
    return {
      key: `product_${index + 1}`,
      summary: [
        `名称：${clean(item.name, 200)}`,
        item.sku ? `SKU：${clean(item.sku, 120)}` : '',
        item.category ? `品类：${clean(item.category, 160)}` : '',
        item.brand ? `品牌：${clean(item.brand, 160)}` : '',
        item.material ? `材质：${clean(item.material, 200)}` : '',
        item.priceRange ? `价格：${clean(item.priceRange, 160)}` : '',
        item.moq ? `MOQ：${clean(item.moq, 160)}` : '',
        item.certifications ? `资质：${clean(item.certifications, 240)}` : '',
        item.highlights ? `卖点：${clean(item.highlights, 500)}` : '',
        attributes.length ? `属性：${attributes.join('；')}` : '',
      ].filter(Boolean).join(' · ').slice(0, 1_500),
      source: `enterprise/products/items/${index + 1}`,
      sourceVersion,
    };
  });
  return [
    { key: 'company', summary: [profile.company.name, profile.company.industry, profile.company.description].map(item => clean(item)).filter(Boolean).join(' · '), source: 'enterprise/profile', sourceVersion: clean(profile.dataGovernance?.lastSavedAt) || 'unknown' },
    { key: 'products', summary: [profile.products.categories, profile.products.priceRange, profile.products.moq, profile.products.certifications, profile.products.highlights, `${profile.products.items?.length || 0} 个产品`].map(item => clean(item)).filter(Boolean).join(' · '), source: 'enterprise/products', sourceVersion },
    ...productFacts,
    { key: 'brand', summary: [profile.brand.tone, profile.brand.style, profile.brand.taboos].map(item => clean(item)).filter(Boolean).join(' · '), source: 'enterprise/brand', sourceVersion: clean(profile.dataGovernance?.lastSavedAt) || 'unknown' },
    { key: 'customer', summary: clean(profile.customers?.targetProfiles), source: 'enterprise/customers', sourceVersion: clean(profile.dataGovernance?.lastSavedAt) || 'unknown' },
    { key: 'business_rules', summary: [profile.bizRules?.moq, profile.bizRules?.leadTime, profile.operations?.riskNotes].map(item => clean(item)).filter(Boolean).join(' · '), source: 'enterprise/business-rules', sourceVersion: clean(profile.dataGovernance?.lastSavedAt) || 'unknown' },
  ].filter(item => item.summary);
}

export async function compileExecutionContract(input: { tenantId: string; goal: WeeklyGoalInput; goalVersion: number; config: DigitalEmployeeConfig }): Promise<ExecutionContract> {
  const [profile, social, youtube, posts, metrics] = await Promise.all([
    readTenantEnterpriseProfile(input.tenantId),
    listAllRecords<Record<string, unknown> & { id: string }>({ store, collection: 'social_accounts', query: { where: { tenantId: input.tenantId, status: 'connected' } } }),
    listAllRecords<Record<string, unknown> & { id: string }>({ store, collection: 'youtube_accounts', query: { where: { tenantId: input.tenantId, status: 'connected' } } }),
    listAllRecords<Record<string, unknown> & { id: string }>({ store, collection: 'posts', query: { where: { tenant_id: input.tenantId } } }),
    listSocialMetricSnapshots(input.tenantId),
  ]);
  const aiAccessEnabled = profile.dataGovernance?.aiAccessEnabled !== false;
  const sourceVersion = clean(profile.dataGovernance?.lastSavedAt) || 'unknown';
  const accounts = [...social, ...youtube].map(item => ({ id: clean(item.id), platform: clean(item.platform || item.type || 'youtube') }));
  // Revoking AI access must immediately remove enterprise facts from newly
  // compiled contracts; retaining them would turn a blocked run into a data
  // exfiltration snapshot.
  const products = aiAccessEnabled ? profile.products.items || [] : [];
  const facts = aiAccessEnabled ? profileFacts(profile) : [];
  const gaps: ContractGap[] = [];
  if (!aiAccessEnabled) gaps.push({ code: 'ai_data_access_disabled', severity: 'blocking', title: '企业数据未授权给 AI', resolution: '由企业管理员在数据治理设置中显式开启 AI 访问', source: 'enterprise/data-governance' });
  if (aiAccessEnabled && (!profile.company.name || !profile.company.industry)) gaps.push({ code: 'enterprise_identity_missing', severity: 'blocking', title: '企业基础事实不完整', resolution: '在企业中心补全企业名称和行业', source: 'enterprise/profile' });
  if (!products.length) gaps.push({ code: 'focus_product_missing', severity: 'blocking', title: '没有可引用的真实产品', resolution: '在企业中心录入至少一个主推产品', source: 'enterprise/products' });
  if (aiAccessEnabled && !profile.customers?.targetProfiles && !input.config.customerProfile) gaps.push({ code: 'audience_missing', severity: 'blocking', title: '目标客户不明确', resolution: '补全客户画像', source: 'enterprise/customers' });
  if (aiAccessEnabled && !profile.brand.tone && !profile.brand.taboos) gaps.push({ code: 'brand_policy_missing', severity: 'warning', title: '品牌表达规则不完整', resolution: '在企业中心补充语气和禁用表达', source: 'enterprise/brand' });
  if (!accounts.length) gaps.push({ code: 'channel_not_connected', severity: 'warning', title: '未连接可发布社媒账号', resolution: '可继续生成草稿，但不能执行真实发布', source: 'channels/accounts' });
  if (!metrics.length) gaps.push({ code: 'metric_baseline_unverified', severity: 'warning', title: '指标基线缺少平台数据验证', resolution: '使用人工输入基线，并在接入指标后重新编译', source: 'social-metrics' });
  const assumptions = gaps.filter(item => item.severity === 'warning').map(item => item.title);
  const focusProducts = products.slice(0, 3).map(item => clean(item.name)).filter(Boolean);
  const accountVersions = [...social, ...youtube].map(item => ({
    id: clean(item.id, 120), platform: clean(item.platform || item.type || 'youtube', 30),
    status: clean(item.status, 30), updated: clean(item.updated || item.updated_at, 60),
  })).sort((a, b) => `${a.platform}:${a.id}`.localeCompare(`${b.platform}:${b.id}`));
  const productVersions = products.map(item => ({
    id: clean((item as Record<string, unknown>).id || item.sku || item.name, 160),
    factHash: stableHash({ name: clean(item.name), category: clean(item.category), sku: clean(item.sku), brand: clean(item.brand), material: clean(item.material), highlights: clean(item.highlights), attributes: (item as Record<string, unknown>).attributes || {} }),
  })).sort((a, b) => a.id.localeCompare(b.id));
  const postVersions = posts.map(item => {
    const stats = jsonRecord(item.stats);
    return { id: clean(item.id, 120), updated: clean(item.updated || item.updated_at, 60), status: clean(stats.status || item.status, 30), publishedAt: clean(item.published_at, 60) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const metricVersions = metrics.map(item => ({
    id: clean(item.id, 120), capturedAt: clean(item.capturedAt, 60), platform: clean(item.platform, 30),
    accountIdHash: stableHash(clean(item.accountId, 200)), contentIdHash: stableHash(clean(item.contentId, 200)), metricsHash: stableHash(item.metrics),
  })).sort((a, b) => `${a.capturedAt}:${a.id}`.localeCompare(`${b.capturedAt}:${b.id}`));
  // Only hashes and non-secret lifecycle metadata are persisted in the source
  // fingerprint. Tokens, account secrets and raw post bodies are never copied.
  const sourceFingerprint = fingerprintFormalSourceVersions({
    aiAccessEnabled, sourceVersion, factsHash: stableHash(facts), accountVersions,
    productVersions, postVersions, metricVersions,
  });
  const draft = {
    schemaVersion: 1 as const, goalVersion: input.goalVersion, compiledAt: new Date().toISOString(),
    readiness: readinessForGaps(gaps),
    intent: { outcome: input.goal.objective, priority: 'high' as const, focusProducts, audience: clean((aiAccessEnabled ? profile.customers?.targetProfiles : '') || input.config.customerProfile), market: input.goal.scope },
    measurement: { metric: input.goal.metric, definition: `${input.goal.metric} 在目标周期内的可归因增量`, baseline: input.goal.baseline, target: input.goal.target, unit: input.goal.unit, window: { startsAt: input.goal.startsAt, endsAt: input.goal.endsAt }, source: metrics.length ? 'social_metric_snapshots' : 'manual_baseline', missing: !metrics.length },
    facts, resources: { productCount: products.length, connectedAccounts: accounts, historicalPosts: posts.length, metricSnapshots: metrics.length, studioAvailable: true },
    dataGovernance: { aiAccessEnabled, sourceVersion },
    policy: { autonomyMode: input.config.autonomyMode, aiAccessEnabled, realPublishRequiresApproval: true as const, approvalOwner: input.config.approvalOwner, budgetLimit: input.goal.budgetLimit, constraints: [...new Set([...input.config.constraints, ...input.goal.constraints])], stopConditions: ['预算超限', '引用事实不存在或已失效', '连续三次执行失败', '审批内容版本变更'] },
    budgetAllocation: [{ category: '内容生成', limit: Math.round(input.goal.budgetLimit * 0.55 * 100) / 100 }, { category: '素材与工具', limit: Math.round(input.goal.budgetLimit * 0.25 * 100) / 100 }, { category: '预留与重试', limit: Math.round(input.goal.budgetLimit * 0.2 * 100) / 100 }],
    qualityGates: ['产品、企业和资质声明可追溯', '受众、市场和 CTA 一致', '品牌禁用表达检查', '真实对外动作精确审批'],
    completionCriteria: [`${input.goal.metric} 达到 ${input.goal.target} ${input.goal.unit}`, '每项产出物保存在原业务模块并有引用', '发布结果必须来自真实 Worker 回执', '生成包含缺失数据说明的周复盘'],
    assumptions, gaps, sourceFingerprint,
  };
  return { ...draft, payloadHash: stableHash(draft) };
}

export function contractStillValid(contract: ExecutionContract, input: { goalVersion: number; sourceFingerprint: string }): boolean {
  return contract.goalVersion === input.goalVersion && contract.sourceFingerprint === input.sourceFingerprint;
}
