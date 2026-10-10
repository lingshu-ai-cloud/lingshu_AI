#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = flag => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : '';
};
const root = path.resolve(value('--root') || defaultRoot);
const tenantId = value('--tenant') || 'local_tenant_customer_1b2913131e2c46deab66172228c4df0a';
const apply = args.includes('--apply');
const now = new Date();
const nowIso = now.toISOString();
const stamp = nowIso.replaceAll(':', '').replaceAll('.', '-');
const dataDir = path.join(root, 'data');
const localStoreDir = path.join(dataDir, 'local-store');
const catalogFile = path.join(root, 'fixtures/beauty-showcase/product-catalog.json');
const sourceMediaDir = path.join(root, 'fixtures/beauty-showcase/media/tenants/local_tenant_customer_aurelia_beauty');
const targetProductMediaDir = path.join(dataDir, 'media/tenants', tenantId, 'rongshang-products');
const backupDir = path.join(dataDir, 'local-reset-backups', `${stamp}-${tenantId}`);
const resetBackupsDir = path.join(dataDir, 'local-reset-backups');

const currentStoreFile = name => name.endsWith('.json') && !name.includes('.before-');
const isTenantRow = row => row && typeof row === 'object'
  && (row.tenant_id === tenantId || row.tenantId === tenantId);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
};
const copyIfExists = (file, relative) => {
  if (!fs.existsSync(file)) return;
  const target = path.join(backupDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file, target);
};
const id = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
const sourceBackup = (() => {
  const explicit = value('--source-backup');
  if (explicit) return path.resolve(explicit);
  if (!fs.existsSync(resetBackupsDir)) return '';
  const candidates = fs.readdirSync(resetBackupsDir)
    .filter(name => name.includes(tenantId))
    .map(name => path.join(resetBackupsDir, name));
  return candidates.find(candidate => path.basename(candidate).startsWith('2026-10-10T164352-'))
    || candidates.find(candidate => fs.existsSync(path.join(candidate, 'local-store/trend_videos.json'))
      && readJson(path.join(candidate, 'local-store/trend_videos.json')).some(isTenantRow))
    || '';
})();

if (!fs.existsSync(catalogFile)) throw new Error(`catalog_missing:${catalogFile}`);
if (!fs.existsSync(localStoreDir)) throw new Error(`local_store_missing:${localStoreDir}`);
const catalog = readJson(catalogFile);
if (!Array.isArray(catalog.products) || catalog.products.length !== 41) {
  throw new Error(`beauty_catalog_must_have_41_products:${catalog.products?.length ?? 'missing'}`);
}
const skuSet = new Set(catalog.products.map(product => String(product.sku || '')));
if (skuSet.size !== 41 || [...skuSet].some(sku => !/^GUIANFA-RS-\d{3}$/.test(sku))) {
  throw new Error('beauty_catalog_skus_invalid');
}

const storeFiles = fs.readdirSync(localStoreDir)
  .filter(currentStoreFile)
  .map(name => path.join(localStoreDir, name));
const relatedJsonFiles = [
  'materials.json',
  'crawler-ops-queue.json',
  'video-admin-alerts.json',
  'whatsapp-customers.json',
  'whatsapp-interactions.json',
  'messenger-customers.json',
  'instagram-customers.json',
].map(name => path.join(dataDir, name)).filter(fs.existsSync);
if (!sourceBackup) throw new Error('tenant_reset_source_backup_missing');
const sourceTrendFile = path.join(sourceBackup, 'local-store/trend_videos.json');
const sourceMaterialsFile = path.join(sourceBackup, 'materials.json');
if (!fs.existsSync(sourceTrendFile) || !fs.existsSync(sourceMaterialsFile)) throw new Error('tenant_reset_source_assets_missing');
const sourceTrends = readJson(sourceTrendFile).filter(isTenantRow);
if (sourceTrends.length !== 25) throw new Error(`tenant_trend_snapshot_must_have_25:${sourceTrends.length}`);
const pollutedTrendIds = new Set([
  'trend_videos_c9733f10519249eb92a9dbac5b8bc7e8',
  'trend_videos_7ea7805811b14cf0a9ff7699462c96af',
]);
const TREND_LIGHTING_THEME = /照明|灯具|lighting|light fixture|HENG\s*HUI/i;
const restoredTrends = sourceTrends.filter(record => !pollutedTrendIds.has(record.id));
if (restoredTrends.length !== 23) throw new Error(`beauty_trend_restore_must_have_23:${restoredTrends.length}`);
const lightingIndustryTheme = record => {
  let analysis = record.aiAnalysis;
  if (typeof analysis === 'string') {
    try { analysis = JSON.parse(analysis); } catch { throw new Error(`trend_analysis_invalid_json:${record.id}`); }
  }
  const themes = [];
  const visit = value => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'theme' && typeof child === 'string') themes.push(child);
      visit(child);
    }
  };
  visit(analysis);
  return themes.find(theme => TREND_LIGHTING_THEME.test(theme)) || '';
};
for (const trend of restoredTrends) {
  const theme = lightingIndustryTheme(trend);
  if (theme) throw new Error(`beauty_trend_contains_lighting_theme:${trend.id}`);
}
const BEAUTY = /美妆|护肤|面膜|精华|洁面|卸妆|防晒|洗发|沐浴|香体|化妆品|cosmetic|skincare|beauty|serum|cream|lotion|facial mask|shampoo/i;
const LIGHTING = /灯具|照明|灯带|筒灯|射灯|吊灯|壁灯|台灯|lighting|lamp|light fixture/i;
const RUNTIME_ARTIFACT = /fallback|兜底|placeholder|generated|sentence|replication|first.frame|heygen|seedance|presenter|ai.storyboard/i;
const semanticFields = ['industry', 'name', 'title', 'tags', 'description', 'productName', 'sourceName', 'sourceProvider', 'sourceUrl', 'shotFunction'];
const localMediaPaths = record => ['url', 'poster', 'file', 'filePath', 'localPath', 'previewUrl']
  .flatMap(key => typeof record[key] === 'string' && record[key].startsWith('/media/') ? [path.join(dataDir, record[key].slice(1))] : []);
const restoredMaterials = readJson(sourceMaterialsFile).filter(record => {
  if (!isTenantRow(record)) return false;
  const semanticText = semanticFields.map(key => String(record[key] || '')).join(' ');
  if (LIGHTING.test(semanticText) || RUNTIME_ARTIFACT.test(String(record.sourceType || ''))) return false;
  if (record.industry !== '美妆护肤' && !BEAUTY.test(semanticText)) return false;
  const files = localMediaPaths(record);
  return files.length > 0 && files.every(file => fs.existsSync(file) && fs.statSync(file).isFile());
});
const seedanceBudgetFile = path.join(dataDir, 'seedance-budget-usage.json');
const firstFrameBudgetDir = path.join(dataDir, 'first-frame-budget', tenantId);
const storyboardBudgetFiles = fs.existsSync(path.join(dataDir, 'storyboard-aigc-budget'))
  ? fs.readdirSync(path.join(dataDir, 'storyboard-aigc-budget'), { recursive: true })
    .filter(name => String(name).endsWith('.json'))
    .map(name => path.join(dataDir, 'storyboard-aigc-budget', String(name)))
    .filter(file => {
      try { return JSON.stringify(readJson(file)).includes(tenantId); } catch { return false; }
    })
  : [];

const before = {};
const cleaned = new Map();
for (const file of [...storeFiles, ...relatedJsonFiles]) {
  const parsed = readJson(file);
  if (!Array.isArray(parsed)) continue;
  const count = parsed.filter(isTenantRow).length;
  before[path.relative(root, file)] = count;
  cleaned.set(file, parsed.filter(row => !isTenantRow(row)));
}

const products = catalog.products.map(product => {
  const imageUrl = product.imageFile
    ? `/media/tenants/${tenantId}/rongshang-products/${product.imageFile}`
    : '';
  return {
    id: product.sku,
    sku: product.sku,
    name: product.name,
    category: product.category,
    brand: product.brand || catalog.source.brand,
    images: imageUrl ? [{ name: `${product.name}原始主图`, type: 'image', url: imageUrl, view: 'front' }] : [],
    videos: [], documents: [], factoryImages: [], packagingImages: [], certificateImages: [], sceneImages: [], brandAssets: [],
    retailPrice: `¥${product.retailPriceCny}`,
    priceRange: `¥${product.retailPriceCny} / US$${product.retailPriceUsd}`,
    certifications: product.certifications || '以实物标签与正式资料为准',
    highlights: Array.isArray(product.highlights) ? product.highlights.join('；') : String(product.highlights || ''),
    ...(imageUrl ? { imageUrl } : {}),
    attributes: {
      货盘序号: product.number,
      净含量: product.netContent || '附件未标注',
      美元建议零售价: `US$${product.retailPriceUsd}`,
      核心场景: product.scene,
      来源文件: catalog.source.fileName,
      来源页码: product.sourcePage,
      原图状态: product.imageFile ? '已从附件直接提取' : '附件未嵌入产品图',
    },
  };
});
const categories = [...new Set(products.map(product => product.category).filter(Boolean))].join('、');
const primaryProduct = products[0];
const profile = {
  factVersion: {
    id: id('beauty_facts'), revision: 1,
    contentHash: crypto.createHash('sha256').update(JSON.stringify({ tenantId, products, company: 'GUIANFA美妆供应链' })).digest('hex'),
    confirmedAt: nowIso, confirmedBy: 'tenant_beauty_reset',
  },
  socialStrategy: {
    enabledRoutes: ['oem_odm', 'wholesale_distribution'],
    routeStrategies: {
      oem_odm: { targetBuyerRoles: ['海外美妆品牌方', '跨境电商卖家', '区域代理商'], primaryCta: '私信获取美妆产品目录与 OEM/ODM 合作资料' },
      wholesale_distribution: { targetBuyerRoles: ['美妆批发商', '连锁零售采购', '区域经销商'], primaryCta: '私信获取产品目录与批发合作资料' },
    },
    manuallyEditedFields: [], contentStage: 'b2b_launch', weeklyTaskPackagePreset: 'b2b_starting',
  },
  digitalEmployeeOnboarding: { profileConfirmedAt: nowIso, productSelectionConfirmedAt: nowIso, continuedWithoutProducts: false },
  company: {
    name: 'GUIANFA美妆供应链', industry: '美妆个护与护肤品', companyType: '品牌与供应链',
    mainMarkets: '东南亚、北美、中东', primaryLanguages: '英语、中文', socialPlatformExperience: '', founded: '',
    description: '提供护肤、面膜、洗护、防晒与香体等美妆个护产品，面向海外品牌方、跨境卖家、批发商与渠道采购开展产品展示及合作沟通。产品事实以已导入的融尚货盘资料为准。',
  },
  brand: {
    name: catalog.source.brand, tone: '专业、可信、面向采购决策', style: '产品质地与使用场景清晰，强调可核验产品事实',
    taboos: '不得虚构功效、认证、MOQ、交期、库存、客户案例或经营结果', usp: '覆盖多品类美妆个护货盘，适合海外 B2B 选品与内容展示', preferredLanguages: '英语、中文',
  },
  products: { categories, priceRange: '', moq: '', certifications: '以各产品实物标签与正式资料为准', highlights: '41 条 GUIANFA 美妆个护产品货盘', items: products },
  customers: {
    targetProfiles: '海外美妆品牌方、跨境电商卖家、美妆批发商、连锁零售采购与区域代理商',
    commonQuestions: '产品品类、规格、价格、MOQ、打样、包装定制与交期', highValueSignals: '明确目标品类、市场、数量、预算或定制需求',
    lowQualitySignals: '需求不明确或要求无法核验的功效与资质承诺', followupStyle: '先确认品类、市场和采购需求，再提供可核验资料并转人工确认商务条款',
  },
  strategy: {
    currentGoal: `围绕${primaryProduct.name}建立首条海外 B2B 美妆内容生产闭环`, focusMarkets: '东南亚、北美、中东',
    excludedMarkets: '', focusProducts: primaryProduct.name, minMargin: '', pricingStrategy: '价格以货盘建议零售价为参考，商务报价需人工确认', aiAutonomy: 'draft', agentAutonomy: '内部分析与草稿自动执行；发布与对外承诺需人工批准',
  },
  bizRules: { quoteMode: 'human_only', priceRange: '', bargainPolicy: 'no', bargainFloor: '', moq: '', samplePolicy: '', paymentTerms: '', leadTime: '' },
  operations: { customization: '', leadTime: '', logistics: '', paymentTerms: '', riskNotes: '功效、认证、MOQ、交期与库存均需依据正式资料复核' },
  knowledge: `产品目录来源：${catalog.source.fileName}；共 41 条 GUIANFA 美妆个护产品。`, faq: [],
  customerService: { enabled: false, enabledAt: '', disabledAt: '', partialAutoReplyEnabled: false, partialAutoReplyDecision: 'pending', partialAutoReplyDecisionAt: '' },
  notifications: { receivers: [], workHours: { start: '09:00', end: '18:00' }, quietOutsideHours: true, nightMode: { enabled: false, autoCategories: 'approved' }, lastTestAt: '' },
  handoffRules: { keywords: ['人工', '报价', '合同', '投诉', '退款'], missStreakToDraft: 2, negativeSentiment: true },
  salesStyleProfile: { learnedFromCount: 0, lastDistilledAt: '', sample_pairs: [] },
  agentLearning: { pendingAssumptions: '', provenAngles: '', userCorrections: '', weakAngles: '' },
  dataGovernance: { aiAccessEnabled: true, lastSavedAt: nowIso, lastSavedSource: 'tenant_beauty_reset' },
};

const weekStart = new Date(now);
weekStart.setUTCDate(now.getUTCDate() + ((8 - now.getUTCDay()) % 7 || 7));
weekStart.setUTCHours(0, 0, 0, 0);
const weekEnd = new Date(weekStart); weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
const date = value => value.toISOString().slice(0, 10);
const goalId = id('weekly_goals');
const planId = id('weekly_plans');
const runId = id('workflow_runs');
const planTasks = [
  { key: 'context_readiness', title: '核验美妆企业与 41 条产品货盘', agentRole: 'orchestrator', kind: 'analysis', sequence: 1, status: 'succeeded', destination: 'enterprise' },
  { key: 'beauty_content_direction', title: `制定${primaryProduct.name}首条 B2B 内容方向`, agentRole: 'director', kind: 'planning', sequence: 2, status: 'pending', destination: 'smartBusiness' },
  { key: 'beauty_content_production', title: `制作${primaryProduct.name}首条产品视频`, agentRole: 'content', kind: 'production', sequence: 3, status: 'pending', destination: 'studio' },
  { key: 'beauty_publish_review', title: '审核成片与发布资料', agentRole: 'business', kind: 'review', sequence: 4, status: 'pending', destination: 'smartBusiness' },
];

const seeds = {
  'tenant_profiles.json': [{ id: id('tenant_profiles'), created: nowIso, updated: nowIso, tenant_id: tenantId, profile, updated_by: 'tenant_beauty_reset' }],
  'weekly_goals.json': [{ id: goalId, created: nowIso, updated: nowIso, tenant_id: tenantId, business_line: 'content_growth', content_platforms: ['tiktok'], title: '美妆 B2B 首条内容生产', objective: `围绕${primaryProduct.name}完成一条可审核的视频草稿`, metric: 'approved_content_packages', baseline: 0, target: 1, unit: '条', starts_at: date(weekStart), ends_at: date(weekEnd), scope: { primaryProduct: { sku: primaryProduct.sku, name: primaryProduct.name }, externalEffectsAllowed: false } }],
  'weekly_plans.json': [{ id: planId, created: nowIso, updated: nowIso, tenant_id: tenantId, goal_id: goalId, status: 'approved', plan: { strategy: `以${primaryProduct.name}为首条内容主题，先完成内部脚本、分镜和成片审核。`, successCriteria: ['产品事实只来自 41 条美妆货盘', '形成一条可审核视频草稿', '不自动发布，不发送客户消息'], estimatedCost: 0, estimatedMinutes: 60, qualityGates: ['产品事实核验', '脚本与分镜审核', '成片质量审核'], riskSummary: '本计划只创建内部任务，不执行付费生成和真实发布。', tasks: planTasks } }],
  'workflow_runs.json': [{ id: runId, created: nowIso, updated: nowIso, created_at: nowIso, updated_at: nowIso, tenant_id: tenantId, goal_id: goalId, plan_id: planId, status: 'pending', starts_at: date(weekStart), ends_at: date(weekEnd), policy_snapshot: { allowPaidGeneration: false, allowRealPublishing: false, allowRealCustomerMessages: false }, current_sequence: 2 }],
  'workflow_tasks.json': planTasks.map(task => ({ id: id('workflow_tasks'), created: nowIso, updated: nowIso, created_at: nowIso, updated_at: nowIso, tenant_id: tenantId, run_id: runId, goal_id: goalId, plan_id: planId, task_key: task.key, task_version: 1, title: task.title, description: task.title, agent_role: task.agentRole, kind: task.kind, sequence: task.sequence, priority: 'high', status: task.status, status_source: 'tenant_beauty_reset', owner_id: task.agentRole, depends_on: task.sequence === 1 ? [] : [planTasks[task.sequence - 2].key], business_domain: 'content_growth', capability_key: task.key, destination: task.destination, destination_view: '', execution_mode: 'internal', external_effect: 'none', automatic_execution_allowed: task.sequence <= 2, requires_approval: task.key === 'beauty_publish_review', policy_source: 'tenant_beauty_reset', blocked_reason: '', business_refs: { productSku: primaryProduct.sku, productName: primaryProduct.name }, output: task.status === 'succeeded' ? { productCount: 41, catalogSource: catalog.source.fileName } : {} })),
  'trend_videos.json': restoredTrends,
};

seeds['weekly_goals.json'][0].scope.assetInventory = { trendVideoCount: restoredTrends.length, materialCount: restoredMaterials.length };
seeds['weekly_plans.json'][0].plan.strategy += ` 已接入 ${restoredTrends.length} 条本地灵感参考和 ${restoredMaterials.length} 条经文件校验的美妆素材。`;
seeds['workflow_tasks.json'][0].output = { ...seeds['workflow_tasks.json'][0].output, trendVideoCount: restoredTrends.length, materialCount: restoredMaterials.length, sourceBackup: path.relative(root, sourceBackup) };

const tenantRegistry = path.join(dataDir, 'local-auth-tenants.json');
const accountsRegistry = path.join(dataDir, 'local-auth-accounts.json');
const registries = [tenantRegistry, accountsRegistry].filter(fs.existsSync);
const report = {
  mode: apply ? 'apply' : 'dry_run', tenantId, backupDir: apply ? path.relative(root, backupDir) : null,
  before, preservedIdentity: {
    tenant: fs.existsSync(tenantRegistry) && readJson(tenantRegistry).some(row => row.id === tenantId),
    loginAccounts: fs.existsSync(accountsRegistry) ? readJson(accountsRegistry).filter(row => row.tenantId === tenantId).length : 0,
  },
  seed: { products: products.length, productSkus: [products[0].sku, products.at(-1).sku], company: profile.company.name, brand: profile.brand.name, trendVideos: restoredTrends.length, materials: restoredMaterials.length, sourceBackup: path.relative(root, sourceBackup), weeklyGoals: 1, weeklyPlans: 1, workflowRuns: 1, workflowTasks: planTasks.length },
  externalEffects: { paidGenerationCalls: 0, publishingCalls: 0, customerMessages: 0 },
};

if (apply) {
  fs.mkdirSync(backupDir, { recursive: true });
  for (const file of [...storeFiles, ...relatedJsonFiles, ...registries]) copyIfExists(file, path.relative(dataDir, file));
  copyIfExists(seedanceBudgetFile, path.relative(dataDir, seedanceBudgetFile));
  for (const file of storyboardBudgetFiles) copyIfExists(file, path.relative(dataDir, file));
  if (fs.existsSync(firstFrameBudgetDir)) {
    for (const name of fs.readdirSync(firstFrameBudgetDir)) copyIfExists(path.join(firstFrameBudgetDir, name), path.relative(dataDir, path.join(firstFrameBudgetDir, name)));
  }
  for (const [file, rows] of cleaned) writeJson(file, rows);
  const materialsFile = path.join(dataDir, 'materials.json');
  const foreignMaterials = fs.existsSync(materialsFile) ? readJson(materialsFile).filter(row => !isTenantRow(row)) : [];
  writeJson(materialsFile, [...foreignMaterials, ...restoredMaterials]);
  for (const [name, rows] of Object.entries(seeds)) {
    const file = path.join(localStoreDir, name);
    const base = fs.existsSync(file) ? readJson(file).filter(row => !isTenantRow(row)) : [];
    writeJson(file, [...rows, ...base]);
  }
  const tenants = readJson(tenantRegistry).map(row => row.id === tenantId ? { ...row, name: profile.company.name, companyName: profile.company.name, industry: profile.company.industry, updatedAt: nowIso } : row);
  writeJson(tenantRegistry, tenants);
  if (fs.existsSync(seedanceBudgetFile)) {
    const budget = readJson(seedanceBudgetFile);
    if (budget && typeof budget === 'object' && !Array.isArray(budget)) { delete budget[tenantId]; writeJson(seedanceBudgetFile, budget); }
  }
  fs.rmSync(firstFrameBudgetDir, { recursive: true, force: true });
  for (const file of storyboardBudgetFiles) fs.rmSync(file, { force: true });
  fs.rmSync(targetProductMediaDir, { recursive: true, force: true });
  fs.mkdirSync(targetProductMediaDir, { recursive: true });
  for (const product of catalog.products) if (product.imageFile) fs.copyFileSync(path.join(sourceMediaDir, product.imageFile), path.join(targetProductMediaDir, product.imageFile));
  writeJson(path.join(backupDir, 'reset-report.json'), report);
}

console.log(JSON.stringify(report, null, 2));
