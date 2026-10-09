import fs from 'node:fs';
import path from 'node:path';
import { buildBusinessSnapshot } from './businessSnapshot.js';
import { getTenantFollowupDispatchStatus } from './followupDispatchWorker.js';
import { listConnectedPublishingAccounts } from './publishingTargets.js';
import { readTenantEnterpriseProfile } from '../routes/enterprise.js';
import { store } from '../storage/index.js';
import { getWhatsAppCustomers } from '../whatsapp/historyImport.js';
import { isSyntheticMaterial } from '../lib/materialTruthfulness.js';

export type AcceptanceCheckStatus = 'passed' | 'waived' | 'blocked' | 'failed';

export interface DigitalEmployeeAcceptanceCheck {
  key: string;
  label: string;
  status: AcceptanceCheckStatus;
  summary: string;
  evidence: Record<string, unknown>;
}

export interface DigitalEmployeeAcceptanceReport {
  schemaVersion: 1;
  tenantId: string;
  runId: string;
  generatedAt: string;
  overall: AcceptanceCheckStatus;
  checks: DigitalEmployeeAcceptanceCheck[];
  waivers: string[];
  blockers: string[];
  failures: string[];
  counters: Record<string, number>;
}

type StoredRecord = { id: string; [key: string]: unknown };

export interface DigitalEmployeeAcceptanceFacts {
  tenantId: string;
  runId: string;
  config: StoredRecord | null;
  enterpriseReady: boolean;
  productCount: number;
  materialCount: number;
  goal: StoredRecord | null;
  plan: StoredRecord | null;
  run: StoredRecord | null;
  tasks: StoredRecord[];
  realSources: StoredRecord[];
  exactAnalyses: StoredRecord[];
  completedProjects: StoredRecord[];
  connectedPublishingAccounts: StoredRecord[];
  publishedReceipts: StoredRecord[];
  segments: StoredRecord[];
  batches: StoredRecord[];
  batchItems: StoredRecord[];
  providerReady: boolean;
  realSendAuthorized: boolean;
  sendReceipts: StoredRecord[];
  reviews: StoredRecord[];
  syntheticRecords: Array<{ type: string; id: string }>;
  requireExactVideoAnalysis: boolean;
  waiveWhatsAppRealSend: boolean;
  whatsAppWaiverReason: string;
}

function object(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* malformed persisted evidence is treated as absent */ }
  }
  return {};
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function syntheticMarker(value: unknown): boolean {
  const source = text(value).toLowerCase();
  if (!source) return false;
  return ['fixture', 'mock', 'placeholder', 'demo', 'frontend_preview', 'sample_data', 'sandbox'].includes(source)
    || /(^|[\/_:.-])(fixture|mock|placeholder|frontend_preview|sample_data|demo_seed|demo_data|sandbox)([\/_:.-]|$)/.test(source);
}

function syntheticRecord(record: StoredRecord): boolean {
  const nested = object(record.aiAnalysis || record.stats || record.spec);
  if ([record.isMock, record.is_mock, record.isDemo, record.is_demo, record.fixture, record.synthetic, nested.isMock, nested.synthetic].some(value => value === true)) return true;
  return [record.source, record.sourceType, record.origin, record.dataSource, nested.source, nested.sourceType, nested.origin].some(syntheticMarker);
}

function exactVideoAnalysis(record: StoredRecord): boolean {
  const analysis = object(record.aiAnalysis);
  const gemini = object(analysis.gemini);
  return analysis.analysisMode === 'exact'
    && ['video', 'video_review_required'].includes(String(analysis.analysisQuality || ''))
    && Object.keys(gemini).length > 0
    && Boolean(text(gemini.structure) || Array.isArray(gemini.scriptDetails15s) || Array.isArray(gemini.coarseStructure));
}

function hasPublishReceipt(record: StoredRecord): boolean {
  if (text(record.platform_post_id)) return true;
  const stats = object(record.stats);
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (!value || typeof value !== 'object') return false;
    const item = value as Record<string, unknown>;
    if (['postId', 'platformPostId', 'platform_post_id'].some(key => text(item[key]))) return true;
    return Object.values(item).some(visit);
  };
  return visit(stats.publishResults);
}

function completedProject(record: StoredRecord): boolean {
  if (syntheticRecord(record)) return false;
  const spec = object(record.spec);
  const automation = object(spec.automation);
  const quality = object(automation.quality);
  const qualityChecks = object(quality.checks);
  const outputPath = text(automation.renderOutputPath || spec.renderOutputPath || spec.videoPath || spec.outputPath);
  const requiredQualityChecks = [
    'renderedFile', 'visualContent', 'groundedScript', 'materialBound', 'voiceAndSubtitles',
    'semanticAlignment', 'routeDifferentiation', 'sceneDiversity', 'internalMarkerFree', 'subtitleSafe', 'platformBriefApplied',
  ];
  const customerFacingContent = JSON.stringify({ title: record.title, script: spec.script, subtitles: spec.alignedCuesByLang });
  if (/(^|[^a-z0-9])e2e[-_:]|local\.test|(^|[^a-z])(mock|fixture|placeholder)([^a-z]|$)/i.test(customerFacingContent)) return false;
  if (!requiredQualityChecks.every(key => qualityChecks[key] === true)) return false;
  if (!outputPath || record.status !== 'ready_for_approval' || automation.stage !== 'completed' || quality.passed !== true) return false;
  if (/^https?:\/\//i.test(outputPath)) return true;
  try { return fs.statSync(outputPath).size >= 10_000; } catch { return false; }
}

function belongsToRun(record: StoredRecord, runId: string): boolean {
  if (!runId) return false;
  const spec = object(record.spec);
  const stats = object(record.stats);
  return [record.run_id, record.runId, record.workflowRunId, spec.workflowRunId, stats.workflowRunId]
    .some(value => text(value) === runId);
}

function check(
  key: string,
  label: string,
  status: AcceptanceCheckStatus,
  summary: string,
  evidence: Record<string, unknown>,
): DigitalEmployeeAcceptanceCheck {
  return { key, label, status, summary, evidence };
}

function task(facts: DigitalEmployeeAcceptanceFacts, key: string): StoredRecord | undefined {
  return facts.tasks.find(item => text(item.task_key) === key);
}

export function evaluateDigitalEmployeeAcceptance(facts: DigitalEmployeeAcceptanceFacts): DigitalEmployeeAcceptanceReport {
  const checks: DigitalEmployeeAcceptanceCheck[] = [];
  const configBody = object(facts.config?.config);
  const requiredTaskKeys = ['context_readiness', 'goal_decomposition', 'content_production', 'content_quality_gate', 'weekly_review'];
  const missingTaskKeys = requiredTaskKeys.filter(key => !task(facts, key));
  const approvedItems = facts.batchItems.filter(item => ['approved', 'sent', 'delivered', 'read'].includes(text(item.status)));
  const sendReceiptsWithoutProviderId = facts.batchItems.filter(item => (
    ['sent', 'delivered', 'read'].includes(text(item.status)) && !text(item.provider_message_id)
  ));

  checks.push(check(
    'tenant_onboarding',
    '新租户与首次配置',
    facts.config && facts.enterpriseReady ? 'passed' : 'failed',
    facts.config && facts.enterpriseReady ? '企业档案与数字员工配置均已持久化' : '企业档案或数字员工配置缺失',
    { configId: facts.config?.id || '', configStatus: facts.config?.status || '', enterpriseReady: facts.enterpriseReady },
  ));

  checks.push(check(
    'weekly_plan',
    '首个周目标与任务编排',
    facts.goal && facts.plan && facts.run && !missingTaskKeys.length ? 'passed' : 'failed',
    facts.goal && facts.plan && facts.run && !missingTaskKeys.length ? '目标、计划、运行和核心任务已形成同一条链路' : '周目标、计划、运行或核心任务不完整',
    { goalId: facts.goal?.id || '', planId: facts.plan?.id || '', runId: facts.run?.id || '', taskCount: facts.tasks.length, missingTaskKeys },
  ));

  checks.push(check(
    'source_collection',
    '公开来源采集',
    facts.realSources.length ? 'passed' : 'blocked',
    facts.realSources.length ? `已取得 ${facts.realSources.length} 条可追溯公开来源` : '尚未取得可追溯公开来源，不能用演示数据代替',
    { sourceIds: facts.realSources.map(item => item.id), collectionTaskStatus: task(facts, 'scheduled_source_collection')?.status || 'not_planned' },
  ));

  checks.push(check(
    'exact_video_analysis',
    '视频级精确分析',
    facts.exactAnalyses.length || !facts.requireExactVideoAnalysis ? 'passed' : 'blocked',
    facts.exactAnalyses.length
      ? `已完成 ${facts.exactAnalyses.length} 条视频级精确分析`
      : facts.requireExactVideoAnalysis ? '缺少视频级模型回执；元数据分析不能冒充全片分析' : '当前验收未强制视频级精确分析',
    { exactAnalysisIds: facts.exactAnalyses.map(item => item.id), required: facts.requireExactVideoAnalysis },
  ));

  checks.push(check(
    'owned_inputs',
    '真实产品与自有素材',
    facts.productCount > 0 && facts.materialCount > 0 ? 'passed' : 'blocked',
    facts.productCount > 0 && facts.materialCount > 0 ? '产品事实和可编辑素材均已接入' : '缺少产品或可编辑自有素材，内容任务必须停在知识缺口',
    { productCount: facts.productCount, materialCount: facts.materialCount },
  ));

  checks.push(check(
    'content_output',
    '真实成片与质量门',
    facts.completedProjects.length ? 'passed' : 'blocked',
    facts.completedProjects.length ? `已核验 ${facts.completedProjects.length} 个真实成片文件及质量回执` : '尚无同时具备成片文件、质量通过和当前运行归属的作品',
    { projectIds: facts.completedProjects.map(item => item.id), contentTaskStatus: task(facts, 'content_production')?.status || 'not_planned' },
  ));

  const publishingEnabled = Array.isArray(configBody.enabledWorkflows) && configBody.enabledWorkflows.includes('content_publish');
  const allowRealPublishing = configBody.allowRealPublishing === true;
  let publishingStatus: AcceptanceCheckStatus = 'blocked';
  let publishingSummary = '发布链路尚未形成可验证状态';
  if (!facts.connectedPublishingAccounts.length) {
    publishingStatus = facts.publishedReceipts.length ? 'failed' : 'passed';
    publishingSummary = facts.publishedReceipts.length
      ? '未连接发布账号却出现发布成功回执，存在假成功风险'
      : '未连接发布账号，流程安全停靠且没有伪造发布结果';
  } else if (!allowRealPublishing) {
    publishingStatus = facts.publishedReceipts.length ? 'failed' : 'passed';
    publishingSummary = facts.publishedReceipts.length
      ? '租户未授权真实发布却出现平台回执'
      : '已有账号但未授权真实发布，内容仅停在人工审批/发布日历';
  } else if (facts.publishedReceipts.length) {
    publishingStatus = 'passed';
    publishingSummary = `已核验 ${facts.publishedReceipts.length} 条平台发布回执`;
  }
  checks.push(check('publishing_safety', '一键分发真实性与安全停靠', publishingStatus, publishingSummary, {
    publishingEnabled,
    allowRealPublishing,
    connectedAccountCount: facts.connectedPublishingAccounts.length,
    publishedReceiptIds: facts.publishedReceipts.map(item => item.id),
    publishTaskStatus: task(facts, 'platform_publish')?.status || 'not_planned',
  }));

  checks.push(check(
    'followup_approval',
    '客户分层、逐客草稿与审批',
    facts.segments.length && facts.batches.length && approvedItems.length ? 'passed' : 'blocked',
    facts.segments.length && facts.batches.length && approvedItems.length ? `已冻结客群并批准 ${approvedItems.length} 条逐客草稿` : '客户分层、批次或已批准草稿尚不完整',
    { segmentIds: facts.segments.map(item => item.id), batchIds: facts.batches.map(item => item.id), approvedItems: approvedItems.length },
  ));

  let sendStatus: AcceptanceCheckStatus = 'blocked';
  let sendSummary = '尚未取得授权测试接收方的真实发送回执';
  if (sendReceiptsWithoutProviderId.length) {
    sendStatus = 'failed';
    sendSummary = '存在 sent/delivered/read 状态但缺少 provider_message_id，不能认定真实发送';
  } else if (facts.sendReceipts.length) {
    sendStatus = facts.providerReady && facts.realSendAuthorized ? 'passed' : 'failed';
    sendSummary = sendStatus === 'passed'
      ? `已核验 ${facts.sendReceipts.length} 条 WhatsApp provider message id`
      : '未满足通道或租户授权条件却出现真实发送回执';
  } else if (facts.waiveWhatsAppRealSend) {
    sendStatus = 'waived';
    sendSummary = `Meta 当前不可连接，本轮仅豁免真实发送回执；客服分层、逐客草稿和人工审批仍必须通过。原因：${facts.whatsAppWaiverReason}`;
  } else if (!facts.providerReady) {
    sendSummary = 'WhatsApp provider 尚未配置，真实发送必须失败即停';
  } else if (!facts.realSendAuthorized) {
    sendSummary = '租户尚未授权真实客户消息，真实发送必须失败即停';
  }
  checks.push(check('whatsapp_real_send', '授权测试接收方真实发送', sendStatus, sendSummary, {
    providerReady: facts.providerReady,
    realSendAuthorized: facts.realSendAuthorized,
    providerMessageIds: facts.sendReceipts.map(item => item.provider_message_id),
    invalidReceiptItemIds: sendReceiptsWithoutProviderId.map(item => item.id),
    waived: facts.waiveWhatsAppRealSend,
    waiverReason: facts.whatsAppWaiverReason,
  }));

  checks.push(check(
    'weekly_review',
    '阶段性复盘',
    facts.reviews.length ? 'passed' : 'blocked',
    facts.reviews.length ? '已生成基于真实业务快照的周复盘' : '尚未生成本运行的周复盘',
    { reviewIds: facts.reviews.map(item => item.id), reviewTaskStatus: task(facts, 'weekly_review')?.status || 'not_planned' },
  ));

  checks.push(check(
    'truthfulness',
    '数据真实性',
    facts.syntheticRecords.length ? 'failed' : 'passed',
    facts.syntheticRecords.length ? '验收租户中发现 mock/demo/fixture 数据' : '验收证据未混入 mock/demo/fixture 数据',
    { syntheticRecords: facts.syntheticRecords },
  ));

  const failures = checks.filter(item => item.status === 'failed').map(item => `${item.label}：${item.summary}`);
  const blockers = checks.filter(item => item.status === 'blocked').map(item => `${item.label}：${item.summary}`);
  const waivers = checks.filter(item => item.status === 'waived').map(item => `${item.label}：${item.summary}`);
  return {
    schemaVersion: 1,
    tenantId: facts.tenantId,
    runId: facts.runId,
    generatedAt: new Date().toISOString(),
    overall: failures.length ? 'failed' : blockers.length ? 'blocked' : 'passed',
    checks,
    waivers,
    blockers,
    failures,
    counters: {
      tasks: facts.tasks.length,
      realSources: facts.realSources.length,
      exactAnalyses: facts.exactAnalyses.length,
      products: facts.productCount,
      materials: facts.materialCount,
      completedProjects: facts.completedProjects.length,
      publishingAccounts: facts.connectedPublishingAccounts.length,
      publishingReceipts: facts.publishedReceipts.length,
      segments: facts.segments.length,
      batches: facts.batches.length,
      approvedFollowups: approvedItems.length,
      whatsappReceipts: facts.sendReceipts.length,
      reviews: facts.reviews.length,
    },
  };
}

async function list(collection: string, tenantId: string, tenantField: 'tenant_id' | 'tenantId' = 'tenant_id'): Promise<StoredRecord[]> {
  // Digital employee collections use explicit `created_at` fields rather than
  // PocketBase's optional `created` system field. Sorting every collection by
  // `created` makes PocketBase reject the request and silently activates the
  // local-development fallback, so an acceptance run can appear empty even
  // though all evidence was persisted remotely. The report is scoped by the
  // immutable run id below, so collection order is not part of the contract.
  const result = await store.list<StoredRecord>(collection, { where: { [tenantField]: tenantId }, perPage: 1_000 });
  return result.items;
}

function localTenantMaterials(tenantId: string): StoredRecord[] {
  const file = path.join(process.cwd(), 'data/materials.json');
  try {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return Array.isArray(rows)
      ? rows.filter(item => item && typeof item === 'object' && text((item as StoredRecord).tenantId) === tenantId) as StoredRecord[]
      : [];
  } catch {
    return [];
  }
}

export async function collectDigitalEmployeeAcceptanceFacts(input: {
  tenantId: string;
  runId?: string;
  requireExactVideoAnalysis?: boolean;
  waiveWhatsAppRealSend?: boolean;
  whatsAppWaiverReason?: string;
}): Promise<DigitalEmployeeAcceptanceFacts> {
  const tenantId = text(input.tenantId);
  if (!tenantId) throw new Error('tenant_id_required');
  const [configs, goals, plans, runs, sources, projects, posts, segments, batches, batchItems, reviews, profile, accounts, channel, snapshot] = await Promise.all([
    list('digital_employee_configs', tenantId),
    list('weekly_goals', tenantId),
    list('weekly_plans', tenantId),
    list('workflow_runs', tenantId),
    list('trend_videos', tenantId, 'tenantId'),
    list('studio_projects', tenantId),
    list('posts', tenantId),
    list('customer_segments', tenantId),
    list('followup_batches', tenantId),
    list('followup_batch_items', tenantId),
    list('weekly_reviews', tenantId),
    readTenantEnterpriseProfile(tenantId),
    listConnectedPublishingAccounts(tenantId),
    getTenantFollowupDispatchStatus(tenantId),
    buildBusinessSnapshot(tenantId),
  ]);
  const run = input.runId ? runs.find(item => item.id === input.runId) || null : runs[0] || null;
  const runId = run?.id || text(input.runId);
  const goal = run ? goals.find(item => item.id === text(run.goal_id)) || null : goals[0] || null;
  const plan = run ? plans.find(item => item.id === text(run.plan_id)) || null : plans[0] || null;
  const tasks = runId ? (await list('workflow_tasks', tenantId)).filter(item => text(item.run_id) === runId) : [];
  const scopedProjects = projects.filter(item => belongsToRun(item, runId));
  const scopedPosts = posts.filter(item => belongsToRun(item, runId));
  const scopedSegments = segments.filter(item => text(item.run_id) === runId);
  const scopedBatches = batches.filter(item => text(item.run_id) === runId);
  const batchIds = new Set(scopedBatches.map(item => item.id));
  const scopedBatchItems = batchItems.filter(item => batchIds.has(text(item.batch_id)));
  const sendReceipts = scopedBatchItems.filter(item => ['sent', 'delivered', 'read'].includes(text(item.status)) && text(item.provider_message_id));
  const rawMaterials = localTenantMaterials(tenantId);
  const materials = rawMaterials.filter(item => !isSyntheticMaterial(item));
  const productMaterialCount = (profile.products.items || []).reduce((total, product) => total + [
    ...(product.images || []), ...(product.videos || []), ...(product.factoryImages || []),
    ...(product.packagingImages || []), ...(product.sceneImages || []), ...(product.brandAssets || []),
  ].filter(asset => !isSyntheticMaterial(asset as unknown as Record<string, unknown>)).length, 0);
  const allRelevant = [
    ...sources.map(item => ({ type: 'trend_video', item })),
    ...scopedProjects.map(item => ({ type: 'studio_project', item })),
    ...scopedPosts.map(item => ({ type: 'post', item })),
    ...scopedSegments.map(item => ({ type: 'customer_segment', item })),
    ...scopedBatches.map(item => ({ type: 'followup_batch', item })),
    ...scopedBatchItems.map(item => ({ type: 'followup_batch_item', item })),
    ...rawMaterials.map(item => ({ type: 'material', item })),
  ];
  const configBody = object(configs[0]?.config);
  const enabledWorkflows = Array.isArray(configBody.enabledWorkflows)
    ? configBody.enabledWorkflows.map(item => text(item))
    : [];
  // Calling getWhatsAppCustomers here deliberately exercises the same tenant
  // data path used by the customer Agent and business snapshot.
  getWhatsAppCustomers(tenantId);
  return {
    tenantId,
    runId,
    config: configs[0] || null,
    enterpriseReady: snapshot.readiness.find(item => item.key === 'enterprise')?.status === 'ready',
    productCount: profile.products.items?.length || 0,
    materialCount: materials.length + productMaterialCount,
    goal,
    plan,
    run,
    tasks,
    realSources: sources.filter(item => !syntheticRecord(item) && /^https?:\/\//i.test(text(item.sourceUrl))),
    exactAnalyses: sources.filter(item => !syntheticRecord(item) && exactVideoAnalysis(item)),
    completedProjects: scopedProjects.filter(completedProject),
    connectedPublishingAccounts: accounts as unknown as StoredRecord[],
    publishedReceipts: scopedPosts.filter(hasPublishReceipt),
    segments: scopedSegments,
    batches: scopedBatches,
    batchItems: scopedBatchItems,
    providerReady: channel.authorization.providerReady,
    realSendAuthorized: configBody.allowRealCustomerMessages === true && channel.authorization.manualFollowupSendAllowed,
    sendReceipts,
    reviews: reviews.filter(item => text(item.run_id) === runId),
    syntheticRecords: allRelevant.filter(entry => syntheticRecord(entry.item)).map(entry => ({ type: entry.type, id: entry.item.id })),
    requireExactVideoAnalysis: input.requireExactVideoAnalysis ?? enabledWorkflows.includes('viral_clone'),
    waiveWhatsAppRealSend: input.waiveWhatsAppRealSend === true,
    whatsAppWaiverReason: text(input.whatsAppWaiverReason),
  };
}

export async function buildDigitalEmployeeAcceptanceReport(input: {
  tenantId: string;
  runId?: string;
  requireExactVideoAnalysis?: boolean;
  waiveWhatsAppRealSend?: boolean;
  whatsAppWaiverReason?: string;
}): Promise<DigitalEmployeeAcceptanceReport> {
  return evaluateDigitalEmployeeAcceptance(await collectDigitalEmployeeAcceptanceFacts(input));
}
