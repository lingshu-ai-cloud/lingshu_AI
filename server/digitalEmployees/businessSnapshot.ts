import { contentAccepted } from './contentAcceptance.js';
import fs from 'node:fs';
import { paidOrder } from '../../shared/orderLifecycle.js';
import { readOrders, readTenantEnterpriseProfile } from '../routes/enterprise.js';
import { getWhatsAppCustomers } from '../whatsapp/historyImport.js';
import { store } from '../storage/index.js';
import { buildDailyTotals, type SocialMetricKey } from '../socialMetrics/aggregation.js';
import { listSocialMetricSnapshots } from '../socialMetrics/store.js';
import { isSyntheticMaterial, syntheticMaterialMarker } from '../lib/materialTruthfulness.js';

export type DataAvailability = 'available' | 'pending' | 'unavailable';

export interface BusinessMetric {
  value: number | null;
  status: DataAvailability;
  source: string;
  note?: string;
}

export interface BusinessReadinessItem {
  key: 'enterprise' | 'products' | 'social_accounts' | 'viral_library' | 'content_projects' | 'customers' | 'automation';
  label: string;
  status: 'ready' | 'incomplete' | 'empty';
  count: number | null;
  page: string;
  note: string;
}

export interface BusinessSnapshot {
  generatedAt: string;
  range: { startsAt: string; endsAt: string; timeZone: 'Asia/Shanghai' };
  readiness: BusinessReadinessItem[];
  content: {
    scheduledAutomations: BusinessMetric;
    collectedItems: BusinessMetric;
    exactAnalyses: BusinessMetric;
    contentProjects: BusinessMetric;
    completedWorks: BusinessMetric;
    production?: {
      status: DataAvailability;
      note: string;
      projects: Array<{ id: string; title: string; route: string; digitalPresenter: boolean; platform: string; completed: boolean; approved: boolean; blocked: boolean }>;
    };

    approvedWorks?: BusinessMetric;
    scheduledPosts: BusinessMetric;
    publishedPosts: BusinessMetric;
    failedPosts: BusinessMetric;
    inquiries: BusinessMetric;
    deals: BusinessMetric;
  };
  customer: {
    total: BusinessMetric;
    attributed: BusinessMetric;
    highIntent: BusinessMetric;
    aiAuto: BusinessMetric;
    draftReview: BusinessMetric;
    humanNeeded: BusinessMetric;
    quoted: BusinessMetric;
    won: BusinessMetric;
    segmentSnapshots: BusinessMetric;
    followupDrafts: BusinessMetric;
    outreachBatches: BusinessMetric;
    outreachSent: BusinessMetric;
    outreachFailed: BusinessMetric;
  };
  social: {
    accountCount: BusinessMetric;
    platformCount: BusinessMetric;
    views: BusinessMetric;
    reach: BusinessMetric;
    likes: BusinessMetric;
    comments: BusinessMetric;
    shares: BusinessMetric;
    saves: BusinessMetric;
    profileViews: BusinessMetric;
    platformBreakdown: Array<{ platform: string; accounts: number; views: number | null; likes: number | null; comments: number | null; shares: number | null; status: DataAvailability }>;
    dailyTrend: Array<{ date: string; views: number | null; interactions: number | null }>;
  };
  next24Hours: Array<{
    id: string;
    kind: 'automation' | 'publish' | 'followup';
    title: string;
    scheduledAt: string;
    scheduleLabel: string;
    page: 'scheduled' | 'smartAssets' | 'conversion';
    status: string;
  }>;
  attribution: {
    attributedCustomers: number;
    postsWithInquiries: number;
    status: DataAvailability;
  };
  interactionReview: {
    deadline: string;
    comments: number | null;
    inquiries: number | null;
    qualifiedInquiries: number | null;
    unknownSourceInquiries: number | null;
    creativeLearnings: number | null;
    status: DataAvailability;
    note: string;
    breakdown: Array<{
      businessDirectionRef: string | null;
      accountId: string;
      contentId: string | null;
      comments: number;
      inquiries: number;
      qualifiedInquiries: number;
    }>;
  };
  dataGaps: string[];
}

type GenericRecord = { id: string; [key: string]: unknown };

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* unavailable JSON is treated as an empty payload */ }
  }
  return {};
}

function time(value: unknown): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function metric(value: number | null, source: string, status: DataAvailability = 'available', note = ''): BusinessMetric {
  return { value, status, source, ...(note ? { note } : {}) };
}

function inRange(value: unknown, startsAt: number, endsAt: number): boolean {
  const parsed = time(value);
  return parsed >= startsAt && parsed <= endsAt;
}

function nextSimpleCronOccurrence(expr: string, nowMs: number): number | null {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  const weekday = parts[4];
  if (!Number.isInteger(minute) || minute < 0 || minute > 59 || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const chinaOffsetMs = 8 * 60 * 60 * 1000;
  const localNow = new Date(nowMs + chinaOffsetMs);
  for (let offset = 0; offset <= 7; offset += 1) {
    const localCandidate = new Date(Date.UTC(
      localNow.getUTCFullYear(),
      localNow.getUTCMonth(),
      localNow.getUTCDate() + offset,
      hour,
      minute,
      0,
      0,
    ));
    const candidateMs = localCandidate.getTime() - chinaOffsetMs;
    if (candidateMs <= nowMs) continue;
    if (weekday !== '*' && !weekday.split(',').map(Number).includes(localCandidate.getUTCDay())) continue;
    return candidateMs;
  }
  return null;
}

function publicPostStatus(record: GenericRecord): string {
  const stats = jsonObject(record.stats);
  return String(stats.status || (record.platform_post_id ? 'published' : 'scheduled'));
}

function exactAnalysis(record: GenericRecord): boolean {
  const analysis = jsonObject(record.aiAnalysis);
  return analysis.analysisMode === 'exact' && analysis.analysisQuality === 'video' && Boolean(analysis.gemini);
}

function connectedAccount(record: GenericRecord): boolean {
  return String(record.status || '').toLowerCase() === 'connected' && !syntheticRecord(record);
}

function syntheticMarker(value: unknown): boolean {
  const source = String(value || '').trim().toLowerCase();
  if (!source) return false;
  if (['fixture', 'mock', 'placeholder', 'demo', 'frontend_preview', 'sample_data', 'sandbox'].includes(source)) return true;
  return /(^|[\/_:.-])(fixture|mock|placeholder|frontend_preview|sample_data|demo_seed|demo_data|sandbox)([\/_:.-]|$)/.test(source);
}

function syntheticRecord(record: Record<string, unknown>, nested: Record<string, unknown> = {}): boolean {
  if ([record.isMock, record.is_mock, record.isDemo, record.is_demo, record.fixture, record.synthetic, nested.isMock, nested.synthetic].some(value => value === true)) return true;
  return [record.source, record.sourceType, record.origin, record.dataSource, nested.source, nested.sourceType, nested.origin]
    .some(syntheticMarker);
}

function hasPublishedReceipt(record: GenericRecord): boolean {
  if (String(record.platform_post_id || '').trim()) return true;
  const stats = jsonObject(record.stats);
  const results = jsonObject(stats.publishResults);
  return Object.values(results).some(value => {
    const result = jsonObject(value);
    return Boolean(String(result.postId || result.platformPostId || result.providerMessageId || '').trim());
  });
}

function realContentProject(record: GenericRecord): boolean {
  const spec = jsonObject(record.spec);
  // Titles such as “product demo” may be legitimate; provenance, not display
  // text, determines whether a project is synthetic.
  return !syntheticRecord(record, spec);
}

function completedWorkHasReceipt(record: GenericRecord): boolean {
  if (!realContentProject(record)) return false;
  const spec = jsonObject(record.spec);
  const automation = jsonObject(spec.automation);
  if (automation.managedBy === 'digital_employee') {
    const quality = jsonObject(automation.quality);
    const outputPath = String(automation.renderOutputPath || spec.renderOutputPath || '').trim();
    if (record.status !== 'ready_for_approval' || automation.stage !== 'completed' || quality.passed !== true || !outputPath) return false;
    try { return fs.statSync(outputPath).size >= 10_000; } catch { return false; }
  }
  const paths = [spec.renderOutputPath, spec.videoPath, spec.outputPath]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  for (const value of Object.values(jsonObject(spec.languageRenderOutputs))) {
    const output = jsonObject(value);
    if (String(output.status || '') === 'done' && String(output.path || '').trim()) paths.push(String(output.path).trim());
  }
  return ['completed', 'published'].includes(String(record.status || spec.status || '')) && paths.some(outputPath => {
    if (/^https?:\/\//i.test(outputPath)) return true;
    try { return fs.statSync(outputPath).size >= 10_000; } catch { return false; }
  });
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : [];
}

/** A project is ready only when it has a truthful production input or an
 * automated state that can advance with persisted material evidence. */
function contentProjectReady(record: GenericRecord): boolean {
  if (!realContentProject(record)) return false;
  if (completedWorkHasReceipt(record)) return true;
  const spec = jsonObject(record.spec);
  const automation = jsonObject(spec.automation);
  if (['blocked', 'failed', 'cancelled', 'archived'].includes(String(record.status || automation.status || '').toLowerCase())) return false;

  const selectedIds = stringList(spec.selectedMaterialIds).filter(id => !syntheticMaterialMarker(id));
  const rawSelectedEvidence = Array.isArray(spec.selectedMaterialEvidence) ? spec.selectedMaterialEvidence : [];
  const selectedEvidence = rawSelectedEvidence
    .filter(item => item && typeof item === 'object' && !isSyntheticMaterial(item as Record<string, unknown>));
  if (selectedIds.length > 0 && (rawSelectedEvidence.length === 0 || selectedEvidence.length > 0)) return true;

  const evidence = jsonObject(automation.evidence);
  const evidenceAssetIds = stringList(evidence.assetIds).filter(id => !syntheticMaterialMarker(id));
  const stage = String(automation.stage || '');
  return automation.managedBy === 'digital_employee'
    && !String(automation.blocker || '').trim()
    && ['script', 'material_match', 'voice_subtitles', 'render', 'quality'].includes(stage)
    && evidenceAssetIds.length > 0;
}

export function productionProject(record: GenericRecord) {
  const spec = jsonObject(record.spec);
  const automation = jsonObject(spec.automation);
  const plan = jsonObject(jsonObject(spec.contentOrder).videoPlan);
  const completed = completedWorkHasReceipt(record);
  return {
    id: String(record.id), title: String(record.title || '未命名作品'),
    route: String(plan.route || automation.route || spec.mode || 'unknown'),
    digitalPresenter: ['heygen', 'avatar'].includes(String(plan.presenter)) || spec.presenterMode === 'digital',
    platform: String(spec.platform || jsonObject(automation.routePlan).platform || ''),
    completed,
    approved: completed && contentAccepted(spec),
    blocked: ['blocked', 'failed'].includes(String(record.status)) || ['blocked', 'failed'].includes(String(automation.status)) || Boolean(automation.blocker),
  };
}

export async function buildBusinessSnapshot(
  tenantId: string,
  range?: { startsAt?: string; endsAt?: string },
  now = new Date(),
): Promise<BusinessSnapshot> {
  const startsAt = range?.startsAt ? time(`${range.startsAt}T00:00:00+08:00`) : now.getTime() - 7 * 86_400_000;
  const endsAt = range?.endsAt ? time(`${range.endsAt}T23:59:59+08:00`) : now.getTime();
  const nowMs = now.getTime();
  const nextDay = nowMs + 24 * 60 * 60 * 1000;

  const [profile, scheduledResult, videoResult, projectResult, postResult, socialResult, youtubeResult, segmentResult, batchResult, recipientResult, interactionResult, qualificationResult, learningResult, socialMetricSnapshots, orderResult] = await Promise.all([
    readTenantEnterpriseProfile(tenantId).catch(() => null),
    store.list<GenericRecord>('scheduled_tasks', { where: { tenant_id: tenantId }, perPage: 500 }).catch(() => ({ items: [] } as { items: GenericRecord[] })),
    store.list<GenericRecord>('trend_videos', { where: { tenantId }, perPage: 500, sort: '-crawledAt' }).catch(() => ({ items: [] } as { items: GenericRecord[] })),
    store.list<GenericRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500, sort: '-updated_at' }).catch(() => ({ items: [], failed: true })),
    store.list<GenericRecord>('posts', { where: { tenant_id: tenantId }, perPage: 500, sort: '-published_at' }).catch(() => ({ items: [] } as { items: GenericRecord[] })),
    store.list<GenericRecord>('social_accounts', { where: { tenantId }, perPage: 100 }).catch(() => ({ items: [] } as { items: GenericRecord[] })),
    store.list<GenericRecord>('youtube_accounts', { where: { tenantId }, perPage: 100 }).catch(() => ({ items: [] } as { items: GenericRecord[] })),
    store.list<GenericRecord>('customer_segments', { where: { tenant_id: tenantId }, perPage: 200, sort: '-created_at' }).catch(() => ({ items: [] } as { items: GenericRecord[] })),
    store.list<GenericRecord>('followup_batches', { where: { tenant_id: tenantId }, perPage: 200, sort: '-created_at' }).catch(() => ({ items: [] } as { items: GenericRecord[] })),
    store.list<GenericRecord>('followup_batch_items', { where: { tenant_id: tenantId }, perPage: 1000, sort: '-created_at' }).catch(() => ({ items: [] } as { items: GenericRecord[] })),
    store.list<GenericRecord>('social_interaction_writebacks', { where: { tenant_id: tenantId }, perPage: 1000, sort: '-occurredAt' }).then(result => ({ ...result, failed: false })).catch(() => ({ items: [], failed: true } as { items: GenericRecord[]; failed: boolean })),
    store.list<GenericRecord>('social_sales_qualifications', { where: { tenant_id: tenantId }, perPage: 1000, sort: '-confirmed_at' }).then(result => ({ ...result, failed: false })).catch(() => ({ items: [], failed: true } as { items: GenericRecord[]; failed: boolean })),
    store.list<GenericRecord>('social_creative_learnings', { where: { tenant_id: tenantId }, perPage: 500, sort: '-created_at' }).then(result => ({ ...result, failed: false })).catch(() => ({ items: [], failed: true } as { items: GenericRecord[]; failed: boolean })),
    listSocialMetricSnapshots(tenantId).catch(() => []),
    readOrders(tenantId).then(items => ({ items, failed: false })).catch(() => ({ items: [], failed: true })),
  ]);

  const customers = getWhatsAppCustomers(tenantId);
  const scheduled = scheduledResult.items.filter(item => !syntheticRecord(item, jsonObject(item.payload)));
  const videos = videoResult.items.filter(item => !syntheticRecord(item, jsonObject(item.aiAnalysis)));
  const projects = projectResult.items.filter(realContentProject);
  const posts = postResult.items.filter(item => !syntheticRecord(item, jsonObject(item.stats)));
  const socialAccounts = [...socialResult.items, ...youtubeResult.items].filter(connectedAccount);
  const segments = segmentResult.items.filter(item => !syntheticRecord(item));
  const batches = batchResult.items.filter(item => !syntheticRecord(item));
  const recipients = recipientResult.items.filter(item => !syntheticRecord(item));
  const connectedAccountIds = new Set(socialAccounts.map(item => item.id));
  const connectedMetricSnapshots = socialMetricSnapshots.filter(item => connectedAccountIds.has(item.accountId));
  const weekVideos = videos.filter(item => inRange(item.crawledAt || item.created, startsAt, endsAt));
  const weekProjects = projects.filter(item => inRange(item.updated_at || item.updated || item.created_at, startsAt, endsAt));
  const weekPosts = posts.filter(item => inRange(item.published_at || item.created, startsAt, endsAt));
  const weekBatches = batches.filter(item => inRange(item.created_at || item.created, startsAt, endsAt));
  const weekRecipients = recipients.filter(item => inRange(item.created_at || item.created, startsAt, endsAt));
  const weekInteractions = interactionResult.items.filter(item => inRange(item.occurredAt || item.created_at, startsAt, endsAt));
  const weekQualifications = qualificationResult.items.filter(item => inRange(item.confirmed_at, startsAt, endsAt));
  const qualifiedInteractionIds = new Set(weekQualifications.filter(item => item.status === 'qualified' && ['sales', 'crm'].includes(String(item.authority))).map(item => String(item.interaction_id)));
  const qualifiedInquiries = weekInteractions.filter(item => item.kind !== 'comment' && qualifiedInteractionIds.has(item.id));
  const weekInquiries = weekInteractions.filter(item => item.kind !== 'comment');
  const interactionReviewUnavailable = interactionResult.failed || qualificationResult.failed;
  const interactionBreakdown = [...weekInteractions.reduce((groups, item) => {
    const businessDirectionRef = String(item.businessDirectionRef || '').trim();
    const accountId = String(item.accountId || '').trim();
    const contentId = String(item.contentId || '').trim();
    const groupKey = JSON.stringify([businessDirectionRef, accountId, contentId]);
    const group = groups.get(groupKey) || {
      businessDirectionRef: businessDirectionRef || null,
      accountId,
      contentId: contentId || null,
      comments: 0,
      inquiries: 0,
      qualifiedInquiries: 0,
    };
    if (item.kind === 'comment') group.comments += 1;
    else {
      group.inquiries += 1;
      if (qualifiedInteractionIds.has(item.id)) group.qualifiedInquiries += 1;
    }
    groups.set(groupKey, group);
    return groups;
  }, new Map<string, {
    businessDirectionRef: string | null; accountId: string; contentId: string | null;
    comments: number; inquiries: number; qualifiedInquiries: number;
  }>()).values()];
  const published = weekPosts.filter(hasPublishedReceipt);
  const receiptPostIds = new Set(posts.filter(hasPublishedReceipt).map(item => item.id));
  const attributedPaidOrders = orderResult.items.filter(order => !syntheticRecord(order as unknown as Record<string, unknown>)
    && paidOrder(order) && receiptPostIds.has(String(order.sourcePostId || ''))
    && inRange(order.paidAt || `${order.orderDate}T00:00:00+08:00`, startsAt, endsAt));
  const failed = weekPosts.filter(item => publicPostStatus(item) === 'failed');
  const scheduledPosts = weekPosts.filter(item => publicPostStatus(item) === 'scheduled');
  const productItems = profile?.products?.items || [];
  // Categories describe a market, not a concrete product that a content or
  // customer Agent can safely quote. Only persisted product records count.
  const productCount = productItems.length;
  const exactVideos = videos.filter(exactAnalysis);
  const readyProjects = projects.filter(contentProjectReady);
  const enterpriseReady = Boolean(profile?.company?.name && profile?.company?.industry);
  const startDay = new Date(startsAt).toISOString().slice(0, 10);
  const endDay = new Date(endsAt).toISOString().slice(0, 10);
  const totalSocialMetric = (key: SocialMetricKey, snapshots = connectedMetricSnapshots): number | null => {
    const points = buildDailyTotals(snapshots, key).filter(point => point.date >= startDay && point.date <= endDay);
    return points.length ? points.reduce((sum, point) => sum + point.value, 0) : null;
  };
  const socialMetric = (key: SocialMetricKey) => {
    const value = totalSocialMetric(key);
    return metric(value, `social_metric_snapshots.${key}`, value === null ? 'unavailable' : 'available', value === null ? '已连接平台尚未回流该指标' : '来自已授权平台的真实回执');
  };
  const accountPlatforms = [...new Set(socialAccounts.map(item => String(item.platform || (item.channelId ? 'youtube' : '')).toLowerCase()).filter(Boolean))];
  const publishingAvailability: DataAvailability = socialAccounts.length ? 'available' : 'unavailable';
  const publishingValue = (value: number) => socialAccounts.length ? value : null;
  const publishingNote = socialAccounts.length ? '来自已授权平台的真实回执' : '尚未连接社媒账号，不能把缺失回执显示为 0';
  const platformBreakdown = accountPlatforms.map(platform => {
    const platformSnapshots = connectedMetricSnapshots.filter(item => item.platform === platform);
    const views = totalSocialMetric('views', platformSnapshots);
    const likes = totalSocialMetric('likes', platformSnapshots);
    const comments = totalSocialMetric('comments', platformSnapshots);
    const shares = totalSocialMetric('shares', platformSnapshots);
    return { platform, accounts: socialAccounts.filter(item => String(item.platform || (item.channelId ? 'youtube' : '')).toLowerCase() === platform).length, views, likes, comments, shares, status: views === null ? 'unavailable' as const : 'available' as const };
  });
  const viewPoints = new Map(buildDailyTotals(connectedMetricSnapshots, 'views').filter(point => point.date >= startDay && point.date <= endDay).map(point => [point.date, point.value]));
  const interactionPoints = new Map<string, number>();
  for (const key of ['likes', 'comments', 'shares', 'saves'] as SocialMetricKey[]) {
    for (const point of buildDailyTotals(connectedMetricSnapshots, key).filter(point => point.date >= startDay && point.date <= endDay)) interactionPoints.set(point.date, (interactionPoints.get(point.date) || 0) + point.value);
  }
  const dailyTrend = [...new Set([...viewPoints.keys(), ...interactionPoints.keys()])].sort().map(date => ({ date, views: viewPoints.get(date) ?? null, interactions: interactionPoints.get(date) ?? null }));

  const readiness: BusinessReadinessItem[] = [
    { key: 'enterprise', label: '企业资料', status: enterpriseReady ? 'ready' : 'incomplete', count: null, page: 'enterprise', note: enterpriseReady ? '企业与行业信息可用于任务上下文' : '需要补齐企业名称和行业' },
    { key: 'products', label: '产品资料', status: productCount > 0 ? 'ready' : 'empty', count: productCount, page: 'enterprise', note: productCount > 0 ? '可用于产品生成与逐客推荐' : '尚无可引用产品' },
    { key: 'social_accounts', label: '社媒账号', status: socialAccounts.length > 0 ? 'ready' : 'empty', count: socialAccounts.length, page: 'accountManagement', note: socialAccounts.length > 0 ? '发布账号已接入' : '尚未连接发布账号' },
    { key: 'viral_library', label: '爆款库', status: exactVideos.length > 0 ? 'ready' : videos.length > 0 ? 'incomplete' : 'empty', count: exactVideos.length, page: 'socialInspiration', note: exactVideos.length > 0 ? `${exactVideos.length} 条已完成全片精确分析` : videos.length > 0 ? `已有 ${videos.length} 条采集记录，仍需完成全片精确分析` : '需要先创建采集任务' },
    { key: 'content_projects', label: '内容项目', status: readyProjects.length > 0 ? 'ready' : projects.length > 0 ? 'incomplete' : 'empty', count: readyProjects.length, page: 'smartAssets', note: readyProjects.length > 0 ? `${readyProjects.length} 个项目已有真实选材或可推进产出` : projects.length > 0 ? `已有 ${projects.length} 个空壳或阻塞项目，尚不可推进` : '尚无内容项目' },
    { key: 'customers', label: '客户与会话', status: customers.length > 0 ? 'ready' : 'empty', count: customers.length, page: 'conversion', note: customers.length > 0 ? '可执行分层与逐客草稿' : '尚无真实 WhatsApp 客户' },
    { key: 'automation', label: '定时自动化', status: scheduled.some(item => item.enabled !== false) ? 'ready' : 'empty', count: scheduled.filter(item => item.enabled !== false).length, page: 'scheduled', note: scheduled.length > 0 ? '经营自动化任务已配置' : '尚未配置采集或经营任务' },
  ];

  const next24Hours: BusinessSnapshot['next24Hours'] = [];
  for (const task of scheduled.filter(item => item.enabled !== false)) {
    const nextAt = nextSimpleCronOccurrence(String(task.cron_expr || ''), nowMs);
    if (!nextAt || nextAt > nextDay) continue;
    next24Hours.push({ id: task.id, kind: 'automation', title: String(task.name || '经营自动化任务'), scheduledAt: new Date(nextAt).toISOString(), scheduleLabel: String(task.cron_label || ''), page: 'scheduled', status: 'scheduled' });
  }
  for (const post of posts) {
    const scheduledAt = time(post.published_at);
    if (scheduledAt <= nowMs || scheduledAt > nextDay || publicPostStatus(post) !== 'scheduled') continue;
    next24Hours.push({ id: post.id, kind: 'publish', title: String(post.title || '内容发布'), scheduledAt: new Date(scheduledAt).toISOString(), scheduleLabel: `${String(post.platform || '社媒')} 定时发布`, page: 'smartAssets', status: 'scheduled' });
  }
  for (const recipient of recipients) {
    const scheduledAt = time(recipient.scheduled_at);
    if (scheduledAt <= nowMs || scheduledAt > nextDay || !['queued', 'approved', 'retry_wait'].includes(String(recipient.status || ''))) continue;
    next24Hours.push({ id: recipient.id, kind: 'followup', title: String(recipient.customer_name || '客户跟进'), scheduledAt: new Date(scheduledAt).toISOString(), scheduleLabel: '按客户时区跟进', page: 'conversion', status: String(recipient.status) });
  }
  next24Hours.sort((left, right) => time(left.scheduledAt) - time(right.scheduledAt));

  const dataGaps: string[] = [];
  if (orderResult.failed) dataGaps.push('订单台账读取失败，成交指标不可用');
  if (orderResult.items.some(order => paidOrder(order) && !order.sourcePostId)) dataGaps.push('部分已付款订单未绑定来源内容，暂不计入内容成交归因');
  if (!enterpriseReady) dataGaps.push('企业资料不完整，内容与客服任务只能使用有限上下文');
  if (!socialAccounts.length) dataGaps.push('尚未连接社媒账号，无法取得真实发布回执');
  if (!videos.length) dataGaps.push('爆款库暂无真实记录，不能计算分析成功率');
  else if (!exactVideos.length) dataGaps.push('爆款库只有采集元数据，尚无可用于内容复刻的全片精确分析');
  if (projects.length && !readyProjects.length) dataGaps.push('现有内容项目均为空壳或阻塞状态，尚无真实选材或可推进产出');
  if (!customers.length) dataGaps.push('暂无真实 WhatsApp 客户，客户指标不可用');
  if (!segments.length) dataGaps.push('尚未保存客户分层快照，无法生成可审计的逐客跟进名单');
  if (!batches.length) dataGaps.push('尚无批量跟进批次，触达指标等待回流');
  if (interactionResult.failed) dataGaps.push('互动回写存储不可用，评论和询盘复盘指标暂不可用');
  else if (!weekInteractions.length) dataGaps.push('本周期尚无忠实回写的评论、私信、表单或询盘记录');
  if (!learningResult.failed && !learningResult.items.length) dataGaps.push('尚未形成带样本边界和证据引用的 CreativeLearning');

  const attributedCustomers = customers.filter(customer => customer.sourcePostId || customer.sourceTrackCode || String(customer.source || '').startsWith('whatsapp_from_')).length;
  const customersWithVerifiedAiReply = customers.filter(customer => (
    Array.isArray(customer.timeline)
    && customer.timeline.some((event: Record<string, unknown>) => {
      const audit = jsonObject(event.audit);
      return event.actor === 'ai' && Boolean(audit.providerMessageId);
    })
  ));
  const postsWithInquiries = new Set(qualifiedInquiries
    .map(item => String(item.contentId || ''))
    .filter(contentId => contentId && receiptPostIds.has(contentId))).size;

  return {
    generatedAt: now.toISOString(),
    range: { startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), timeZone: 'Asia/Shanghai' },
    readiness,
    content: {
      scheduledAutomations: metric(scheduled.filter(item => item.enabled !== false).length, 'scheduled_tasks'),
      collectedItems: metric(weekVideos.length, 'trend_videos'),
      exactAnalyses: metric(weekVideos.filter(exactAnalysis).length, 'trend_videos.aiAnalysis'),
      contentProjects: metric(weekProjects.length, 'studio_projects'),
      production: {
        status: 'failed' in projectResult || ('totalItems' in projectResult && Number(projectResult.totalItems) > projectResult.items.length) ? 'unavailable' : 'available',
        note: '按所选周期内更新的作品统计当前状态，每个项目计一件；创作方式与数字人出镜可重叠，作品数量不等于发布次数。',
        projects: weekProjects.map(productionProject),
      },
      approvedWorks: metric(weekProjects.filter(project => completedWorkHasReceipt(project) && contentAccepted(jsonObject(project.spec))).length, 'studio_projects.spec.contentAcceptance + current content fingerprint'),
      completedWorks: metric(weekProjects.filter(completedWorkHasReceipt).length, 'studio_projects.spec.automation.quality + render receipt', 'available', '仅统计存在可核验成片的作品；作品完成不等于平台发布'),
      scheduledPosts: metric(publishingValue(scheduledPosts.length), 'posts.stats.status', publishingAvailability, publishingNote),
      publishedPosts: metric(publishingValue(published.length), 'posts.publishResults', publishingAvailability, publishingNote),
      failedPosts: metric(publishingValue(failed.length), 'posts.publishResults', publishingAvailability, publishingNote),
      inquiries: metric(interactionReviewUnavailable ? null : publishingValue(qualifiedInquiries.length), 'social_interaction_writebacks + sales/CRM qualification', interactionReviewUnavailable ? 'unavailable' : publishingAvailability, '只统计销售或可信 CRM 确认的有效询盘；未知内容来源仍保留并计入询盘总数'),
      deals: metric(orderResult.failed ? null : attributedPaidOrders.length, 'tenant_orders.sourcePostId + paid status + posts provider receipt', orderResult.failed ? 'unavailable' : 'available', '人工维护订单台账，按付款日（历史订单使用订单日）统计当前未退款的归因订单；不代表已核验支付网关回执'),
    },
    customer: {
      total: metric(customers.length, 'whatsapp_customers', customers.length ? 'available' : 'unavailable'),
      attributed: metric(attributedCustomers, 'whatsapp_customers.sourcePostId', customers.length ? 'available' : 'unavailable'),
      highIntent: metric(customers.filter(customer => Number(customer.intentScore || 0) >= 75 || ['qualified', 'hot'].includes(String(customer.bant?.level || ''))).length, 'whatsapp_customers.intentScore', customers.length ? 'available' : 'unavailable'),
      aiAuto: metric(customersWithVerifiedAiReply.length, 'whatsapp_interactions.audit.providerMessageId', customers.length ? 'available' : 'unavailable', '仅统计取得 WhatsApp provider message id 的 AI 自动回复'),
      draftReview: metric(customers.filter(customer => customer.handlingMode === 'ai_draft').length, 'whatsapp_customers.handlingMode', customers.length ? 'available' : 'unavailable'),
      humanNeeded: metric(customers.filter(customer => customer.handlingMode === 'human_needed').length, 'whatsapp_customers.handlingMode', customers.length ? 'available' : 'unavailable'),
      quoted: metric(customers.filter(customer => customer.stage === 'quoted').length, 'whatsapp_customers.stage', customers.length ? 'available' : 'unavailable'),
      won: metric(customers.filter(customer => customer.stage === 'won').length, 'whatsapp_customers.stage', customers.length ? 'available' : 'unavailable'),
      segmentSnapshots: metric(segments.filter(item => ['active', 'generated', 'ready'].includes(String(item.status || 'generated'))).length, 'customer_segments', segments.length ? 'available' : 'pending'),
      followupDrafts: metric(weekRecipients.filter(item => ['draft', 'approved', 'blocked', 'retry_wait'].includes(String(item.status || ''))).length, 'followup_batch_items.status', batches.length ? 'available' : 'pending'),
      outreachBatches: metric(weekBatches.length, 'followup_batches', batches.length ? 'available' : 'pending'),
      outreachSent: metric(weekRecipients.filter(item => ['sent', 'delivered', 'read', 'partial_sent'].includes(String(item.status || '')) && Boolean(item.provider_message_id)).length, 'followup_batch_items.status + provider_message_id', batches.length ? 'available' : 'pending'),
      outreachFailed: metric(weekRecipients.filter(item => item.status === 'failed').length, 'followup_batch_items.status', batches.length ? 'available' : 'pending'),
    },
    social: {
      accountCount: metric(socialAccounts.length, 'social_accounts + youtube_accounts', socialAccounts.length ? 'available' : 'unavailable'),
      platformCount: metric(accountPlatforms.length, 'social_accounts.platform', socialAccounts.length ? 'available' : 'unavailable'),
      views: socialMetric('views'),
      reach: socialMetric('reach'),
      likes: socialMetric('likes'),
      comments: socialMetric('comments'),
      shares: socialMetric('shares'),
      saves: socialMetric('saves'),
      profileViews: socialMetric('profileViews'),
      platformBreakdown,
      dailyTrend,
    },
    next24Hours,
    attribution: { attributedCustomers, postsWithInquiries, status: posts.length && customers.length ? 'available' : 'pending' },
    interactionReview: {
      deadline: new Date(endsAt).toISOString(),
      comments: interactionResult.failed ? null : weekInteractions.filter(item => item.kind === 'comment').length,
      inquiries: interactionResult.failed ? null : weekInquiries.length,
      qualifiedInquiries: interactionReviewUnavailable ? null : qualifiedInquiries.length,
      unknownSourceInquiries: interactionResult.failed ? null : weekInquiries.filter(item => item.source_confidence === 'unknown' || !item.contentId).length,
      creativeLearnings: learningResult.failed ? null : learningResult.items.filter(item => inRange(item.created_at, startsAt, endsAt)).length,
      status: interactionReviewUnavailable || learningResult.failed ? 'unavailable' : 'available',
      note: '评论必须关联账号和内容；询盘无法可靠关联内容时保留为未知来源，不伪造全链路归因。',
      breakdown: interactionResult.failed ? [] : interactionBreakdown,
    },
    dataGaps,
  };
}
