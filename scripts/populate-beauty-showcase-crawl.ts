import '../server/loadEnvironment.js';

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import sharp from 'sharp';
import { localAccountRecordsFile, readLocalAccountRecords } from '../server/lib/localAccountStore.js';
import { readLocalMaterials, saveLocalMaterials, type MaterialRecord } from '../server/lib/materialLibrary.js';
import { runWithDataAuthority } from '../server/storage/dataAuthority.js';
import { store } from '../server/storage/index.js';

const EMAIL = 'beauty-showcase@local.test';
const TENANT_ID = 'local_tenant_customer_aurelia_beauty';
const USER_ID = 'local_user_customer_aurelia_beauty';
const VIDEO_BATCH = 'beauty_real_crawl_30_v1';
const MATERIAL_BATCH = 'beauty_real_materials_30_v1';
const BASELINE_BATCH = 'beauty_showcase_v2';
const OBSERVED_AT = new Date().toISOString();
const ROOT = process.cwd();
const MEDIA_ROOT = path.resolve(ROOT, 'data', 'media');
const RELATIVE_ASSET_DIR = path.posix.join('tenants', TENANT_ID, 'real-crawl-30');
const ASSET_DIR = path.join(MEDIA_ROOT, RELATIVE_ASSET_DIR);
const MANIFEST_FILE = path.resolve(ROOT, 'docs', 'examples', 'beauty-b2b-commons-seed-30.manifest.json');
const PYTHON = String(process.env.BEAUTY_CRAWL_PYTHON || 'python3').trim();

type Phase = 'preview' | 'videos' | 'materials' | 'verify' | 'all';
const phaseArg = process.argv.find(arg => arg.startsWith('--phase='));
const PHASE = String(phaseArg?.split('=')[1] || 'all') as Phase;
if (!['preview', 'videos', 'materials', 'verify', 'all'].includes(PHASE)) {
  throw new Error('phase must be preview, videos, materials, verify, or all');
}

type BuyerModel = 'B2B' | 'B2C';
type SearchPlan = { category: string; label: string; buyerModel: BuyerModel; quota: number; query: string; maxDuration: number };
type YoutubeCandidate = {
  id: string;
  title: string;
  sourceUrl: string;
  duration: number;
  views: number;
  channelName: string;
  channelUrl: string;
  handle: string;
  thumbnailUrl: string;
  category: string;
  categoryLabel: string;
  buyerModel: BuyerModel;
  query: string;
  rankInPool: number;
  candidatePoolSize: number;
};

type ManifestAsset = {
  id: string;
  title: string;
  enabled: boolean;
  source: { provider: string; creator: string; pageUrl: string; downloadUrl: string; approvedDownloadHosts: string[] };
  license: { name: string; url: string; evidence: string; capturedAt: string; attributionText: string };
  approval: { approvedBy: string; approvedAt: string; reference: string; rationale: string; rights: Record<string, boolean> };
  expectedSourceSha256: string;
  clip: { startSeconds: number; durationSeconds: number };
  industry: string;
  shotFunction: string;
  applicability: string;
  tags: string[];
  visualReview: Record<string, any> & { segment?: Record<string, any>; visualObservations?: string[] };
};

type CommonsImageSource = {
  id: string;
  fileName: string;
  name: string;
  creator: string;
  expectedLicense: string;
  category: string;
  description: string;
  tags: string[];
};

const searchPlans: SearchPlan[] = [
  { category: 'skincare_oem_factory', label: '护肤 OEM 工厂与私标能力', buyerModel: 'B2B', quota: 3, query: 'private label skincare manufacturer factory tour cosmetics OEM', maxDuration: 1_200 },
  { category: 'formulation_lab', label: '美妆配方研发与实验室', buyerModel: 'B2B', quota: 3, query: 'cosmetic formulation laboratory manufacturing R&D skincare factory', maxDuration: 1_200 },
  { category: 'filling_packaging_line', label: '灌装包装与自动化产线', buyerModel: 'B2B', quota: 3, query: 'cosmetic filling packaging production line skincare factory', maxDuration: 1_200 },
  { category: 'lipstick_makeup_production', label: '口红彩妆生产工艺', buyerModel: 'B2B', quota: 3, query: 'lipstick makeup factory manufacturing process cosmetics', maxDuration: 1_200 },
  { category: 'quality_control_testing', label: '品质控制与检测证明', buyerModel: 'B2B', quota: 3, query: 'cosmetics factory quality control laboratory testing skincare manufacturing', maxDuration: 1_200 },
  { category: 'trade_show_supplier', label: '美妆展会与供应商获客', buyerModel: 'B2B', quota: 3, query: 'cosmetics trade show beauty supplier exhibition manufacturer', maxDuration: 1_200 },
  { category: 'haircare_personal_care_oem', label: '洗护个护 OEM 制造', buyerModel: 'B2B', quota: 3, query: 'shampoo hair care cosmetics factory manufacturing private label', maxDuration: 1_200 },
  { category: 'skincare_routine_review', label: '护肤流程与产品测评', buyerModel: 'B2C', quota: 1, query: 'viral skincare routine product review shorts', maxDuration: 240 },
  { category: 'makeup_tutorial_transformation', label: '彩妆教程与妆效变化', buyerModel: 'B2C', quota: 1, query: 'viral makeup tutorial transformation product shorts', maxDuration: 240 },
  { category: 'sunscreen_texture_test', label: '防晒质地与上脸测试', buyerModel: 'B2C', quota: 1, query: 'sunscreen texture test review shorts skincare', maxDuration: 240 },
  { category: 'lip_swatch_review', label: '唇部产品试色与测评', buyerModel: 'B2C', quota: 1, query: 'lipstick lip tint swatch review shorts viral', maxDuration: 240 },
];

const baselineMaterialCategories = [
  '产品矩阵有序陈列',
  '面霜质地静物特写',
  '成分氛围护理场景',
  '真人手持产品使用',
  '彩妆工具组合陈列',
];

const commonsImages: CommonsImageSource[] = [
  { id: 'lipstick-application', fileName: 'Lipstick application taken on canon EOS 100D.jpg', name: '口红上妆动作近景', creator: 'Greta Ceresini', expectedLicense: 'CC BY 2.0', category: '口红上妆动作近景', description: '嘴唇上妆动作，可用于彩妆使用步骤和动作参考。', tags: ['美妆', '口红', '上妆', '动作', 'B2C'] },
  { id: 'nail-polish-bottles', fileName: 'Nail Polish bottles (2).jpg', name: '甲油瓶色彩组合陈列', creator: 'Joe Shlabotnik', expectedLicense: 'CC BY 2.0', category: '甲油瓶色彩组合陈列', description: '多色甲油瓶组合，可用于色彩矩阵和品类陈列参考。', tags: ['美妆', '甲油', '产品组合', '色彩', 'B2C'] },
  { id: 'perfume-bottle', fileName: 'Perfume bottle.jpg', name: '香水瓶白底线稿插画', creator: 'David Ring', expectedLicense: 'CC0', category: '香水瓶白底线稿插画', description: '复古香水瓶白底线稿插画，可用于香水品类、复古视觉和插画风格参考，不得标记为实拍产品。', tags: ['美妆', '香水', '线稿插画', '白底', 'B2C'] },
  { id: 'eyeshadow-palette', fileName: 'A hand presents a makeup palette featuring four shades and a small mirror.jpg', name: '眼影盘手持展示', creator: 'Shixart1985', expectedLicense: 'CC BY 2.0', category: '眼影盘手持展示', description: '手持四色眼影盘，可用于开盒、色号和产品结构展示参考。', tags: ['美妆', '眼影盘', '手持展示', '色号', 'B2C'] },
];

function assertAccount(): void {
  const accounts = readLocalAccountRecords(localAccountRecordsFile());
  const account = accounts.find(item => item.email.toLowerCase() === EMAIL);
  if (!account) throw new Error(`local account not found: ${EMAIL}`);
  if (account.tenantId !== TENANT_ID || account.userId !== USER_ID || account.accountType !== 'customer') {
    throw new Error('beauty showcase account mapping does not match the isolated customer tenant');
  }
}

function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeJson(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function tagsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (Array.isArray(parsed)) return parsed.map(String).map(item => item.trim()).filter(Boolean);
  } catch {
    return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  }
  return [];
}

function compactMetric(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return String(value);
}

function ytDlpSearch(plan: SearchPlan): YoutubeCandidate[] {
  const result = spawnSync(PYTHON, [
    '-m', 'yt_dlp', '--flat-playlist', '--skip-download', '--no-warnings', '--dump-single-json',
    `ytsearch30:${plan.query}`,
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, PYTHONWARNINGS: 'ignore' } });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`yt-dlp search failed for ${plan.category}: ${String(result.stderr || '').trim()}`);
  }
  const payload = JSON.parse(result.stdout) as { entries?: Array<Record<string, any>> };
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const candidates = entries.flatMap((entry): YoutubeCandidate[] => {
    const id = String(entry.id || '').trim();
    const title = String(entry.title || '').trim();
    const views = Number(entry.view_count || 0);
    const duration = Number(entry.duration || 0);
    const channelName = String(entry.channel || entry.uploader || '').trim();
    const channelUrl = String(entry.uploader_url || entry.channel_url || '').trim();
    if (!/^[\w-]{6,20}$/.test(id) || !title || !channelName || !/^https:\/\/www\.youtube\.com\//.test(channelUrl)) return [];
    if (!Number.isFinite(views) || views <= 0 || !Number.isFinite(duration) || duration < 4 || duration > plan.maxDuration) return [];
    const thumbnails = Array.isArray(entry.thumbnails) ? entry.thumbnails : [];
    const thumbnail = thumbnails.filter((item: any) => /^https:\/\//.test(String(item?.url || ''))).sort((a: any, b: any) => Number(b.width || 0) - Number(a.width || 0))[0];
    return [{
      id,
      title,
      sourceUrl: `https://www.youtube.com/watch?v=${id}`,
      duration,
      views,
      channelName,
      channelUrl,
      handle: String(entry.uploader_id || '').trim(),
      thumbnailUrl: String(thumbnail?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`),
      category: plan.category,
      categoryLabel: plan.label,
      buyerModel: plan.buyerModel,
      query: plan.query,
      rankInPool: 0,
      candidatePoolSize: 0,
    }];
  }).sort((a, b) => b.views - a.views);
  return candidates.map((candidate, index) => ({ ...candidate, rankInPool: index + 1, candidatePoolSize: candidates.length }));
}

function crawlYoutubeSelection(): YoutubeCandidate[] {
  const selected: YoutubeCandidate[] = [];
  const usedUrls = new Set<string>();
  const usedChannels = new Set<string>();
  for (const plan of searchPlans) {
    const candidates = ytDlpSearch(plan);
    const primary = candidates.filter(item => !usedUrls.has(item.sourceUrl) && !usedChannels.has(item.channelUrl));
    const fallback = candidates.filter(item => !usedUrls.has(item.sourceUrl));
    const chosen: YoutubeCandidate[] = [];
    for (const candidate of [...primary, ...fallback]) {
      if (chosen.some(item => item.sourceUrl === candidate.sourceUrl)) continue;
      chosen.push(candidate);
      if (chosen.length === plan.quota) break;
    }
    if (chosen.length !== plan.quota) throw new Error(`not enough public candidates for ${plan.category}: ${chosen.length}/${plan.quota}`);
    for (const candidate of chosen) {
      selected.push(candidate);
      usedUrls.add(candidate.sourceUrl);
      usedChannels.add(candidate.channelUrl);
    }
  }
  if (selected.length !== 25) throw new Error(`expected 25 new public videos, got ${selected.length}`);
  if (selected.filter(item => item.buyerModel === 'B2B').length !== 21 || selected.filter(item => item.buyerModel === 'B2C').length !== 4) {
    throw new Error('selected public video buyer mix is not 21 B2B / 4 B2C');
  }
  return selected;
}

function backupFiles(label: string, files: string[]): { directory: string; restore: () => void } {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = path.resolve(ROOT, 'data', 'backups', `${label}-${stamp}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const saved: Array<{ original: string; backup: string; existed: boolean }> = [];
  for (const original of files) {
    const backup = path.join(directory, path.basename(original));
    const existed = fs.existsSync(original);
    if (existed) fs.copyFileSync(original, backup);
    saved.push({ original, backup, existed });
  }
  fs.writeFileSync(path.join(directory, 'README.json'), JSON.stringify({ label, createdAt: OBSERVED_AT, files: saved.map(item => ({ path: item.original, existed: item.existed })) }, null, 2), { mode: 0o600 });
  return {
    directory,
    restore: () => {
      for (const item of saved) {
        if (item.existed) fs.copyFileSync(item.backup, item.original);
        else if (fs.existsSync(item.original)) fs.unlinkSync(item.original);
      }
    },
  };
}

function videoAnalysis(item: YoutubeCandidate): Record<string, unknown> {
  const momentum = item.views >= 100_000 ? 'high_performance' : item.views >= 10_000 ? 'proven_performance' : 'category_top_candidate';
  return {
    source: 'youtube-public-search',
    sourceType: 'external_reference',
    contentFormat: 'video',
    industry: 'beauty',
    buyerModel: item.buyerModel,
    materialCategory: item.categoryLabel,
    views: compactMetric(item.views),
    keyword: item.query,
    crawlRule: `YouTube 公开搜索 · ${item.categoryLabel} · 按公开播放量择优`,
    sourceAccount: item.channelUrl,
    sourceAccountName: item.channelName,
    analysisSource: 'youtube-public-metadata',
    analysisQuality: 'metadata',
    analysisMode: 'strategy',
    requestedAnalysisMode: 'exact',
    downloadStatus: 'queued',
    videoFetchStatus: 'public_embed',
    geminiStatus: 'queued',
    analyzedAt: OBSERVED_AT,
    analysisLayers: [
      { level: 'L0', status: 'complete', scope: 'YouTube 公开标题、作者、封面、时长与播放量', confidence: 0.98 },
      { level: 'L1', status: 'pending', scope: '全片画面、字幕与镜头切分', confidence: null },
      { level: 'L2', status: 'pending', scope: '结构、节奏、钩子与证明位置', confidence: null },
      { level: 'L3', status: 'pending', scope: '逐镜复刻说明和差异化边界', confidence: null },
      { level: 'L4', status: 'pending', scope: '等待真实制作结果回流', confidence: null },
    ],
    publicMetrics: { plays: item.views, observedAt: OBSERVED_AT },
    publicBaseline: {
      sampleSize: item.candidatePoolSize,
      rank: item.rankInPool,
      status: 'category_search_snapshot',
      method: '同一细分类公开搜索候选按可见播放量降序；不是全平台绝对爆款结论',
    },
    candidateEvidence: {
      relevance: { level: 'high', reasons: [`美妆细分类：${item.categoryLabel}`, `客群：${item.buyerModel}`] },
      momentum: { level: momentum, reasons: [`公开播放量 ${compactMetric(item.views)}`, `搜索候选排名 ${item.rankInPool}/${item.candidatePoolSize}`], confidence: 0.82 },
      transferability: { level: 'pending_review', mechanisms: ['标题主题', '封面构图', '公开播放指标'], limitations: ['必须完成全片精确分析；不得下载、剪入或重发原作者媒体'] },
    },
    rightsStatus: { mayAnalyze: true, mayUseOriginalMedia: false, mayAdapt: true, note: '公开视频仅作为策略与重新制作参考；原视频、原声音、人物、商标和品牌素材不得直接进入成片。' },
    gemini: {
      theme: `${item.buyerModel} 美妆参考：${item.title}`,
      hooks: [`待精确分析原视频前三秒，再提取「${item.categoryLabel}」的可迁移机制`],
      sellingPoints: [`细分类：${item.categoryLabel}`, `公开视频播放量：${compactMetric(item.views)}`],
      mood: '仅完成公开元数据采集，等待编导 Agent 全片精确分析',
      structure: '标题与封面参考 → 全片分析待执行 → 生成差异化复刻脚本',
      baseRequirements: '不得直接复用原片、原声、原字幕、原人物或原品牌素材；只能在完成全片分析后重新拍摄和重做表达。',
      recommendedScriptType: 'storyboard',
    },
    provenance: { sourceUrl: item.sourceUrl, authorUrl: item.channelUrl, crawledVia: ['yt-dlp public YouTube search metadata'], originalMediaCached: false, observedAt: OBSERVED_AT },
  };
}

async function writeVideosAndAccounts(selected: YoutubeCandidate[]): Promise<string> {
  const trendFile = path.resolve(ROOT, 'data', 'local-store', 'trend_videos.json');
  const competitorFile = path.resolve(ROOT, 'data', 'local-store', 'competitor_accounts.json');
  const backup = backupFiles('beauty-real-crawl-videos', [trendFile, competitorFile]);
  try {
    const allVideos = await store.list<Record<string, any>>('trend_videos', { where: { tenantId: TENANT_ID }, page: 1, perPage: 500 });
    for (const record of allVideos.items.filter(item => item.seedBatchId === VIDEO_BATCH)) await store.delete('trend_videos', String(record.id));
    const baseline = allVideos.items.filter(item => item.seedBatchId === BASELINE_BATCH);
    if (baseline.length !== 5) throw new Error(`expected five real TikTok baseline videos, got ${baseline.length}`);
    for (const [index, record] of baseline.entries()) {
      const analysis = safeJson(record.aiAnalysis);
      analysis.industry = 'beauty';
      analysis.buyerModel = 'B2C';
      analysis.materialCategory = ['成分痛点问答', '多产品清单推荐', '品牌梗互动', '专家背书互动', '单成分问题解决'][index] || '品牌消费者内容';
      await store.update('trend_videos', String(record.id), {
        tags: JSON.stringify(Array.from(new Set([...tagsOf(record.tags), 'B2C', '美妆消费者内容']))),
        aiAnalysis: JSON.stringify(analysis),
      });
    }
    for (const [index, item] of selected.entries()) {
      await store.create('trend_videos', {
        tenantId: TENANT_ID,
        platform: 'youtube',
        title: item.title,
        thumbnailUrl: item.thumbnailUrl,
        duration: item.duration,
        sourceUrl: item.sourceUrl,
        tags: JSON.stringify(['美妆', item.buyerModel, item.categoryLabel, item.category]),
        aiAnalysis: JSON.stringify(videoAnalysis(item)),
        status: 'pending',
        crawledAt: new Date(Date.parse(OBSERVED_AT) - index * 1_000).toISOString(),
        contentFormat: 'video',
        sourceType: 'youtube_public_reference',
        seedBatchId: VIDEO_BATCH,
      });
    }

    const allCompetitors = await store.list<Record<string, any>>('competitor_accounts', { where: { tenantId: TENANT_ID }, page: 1, perPage: 500 });
    for (const record of allCompetitors.items.filter(item => item.sourceBatchId === VIDEO_BATCH)) await store.delete('competitor_accounts', String(record.id));
    const accountMap = new Map<string, { platform: 'youtube' | 'tiktok'; url: string; name: string; handle: string; buyerModels: Set<string>; categories: Set<string> }>();
    for (const item of selected) {
      const current = accountMap.get(item.channelUrl) || { platform: 'youtube' as const, url: item.channelUrl, name: item.channelName, handle: item.handle, buyerModels: new Set<string>(), categories: new Set<string>() };
      current.buyerModels.add(item.buyerModel);
      current.categories.add(item.categoryLabel);
      accountMap.set(item.channelUrl, current);
    }
    for (const record of baseline) {
      const analysis = safeJson(record.aiAnalysis);
      const url = String(analysis.sourceAccount || '').trim();
      if (!url) throw new Error(`baseline video ${record.id} has no corresponding source account`);
      const current = accountMap.get(url) || { platform: 'tiktok' as const, url, name: String(analysis.sourceAccountName || url), handle: url.split('/@')[1] || '', buyerModels: new Set<string>(), categories: new Set<string>() };
      current.buyerModels.add('B2C');
      current.categories.add(String(analysis.materialCategory || '美妆消费者内容'));
      accountMap.set(url, current);
    }
    const existingByUrl = new Map(allCompetitors.items.filter(item => item.sourceBatchId !== VIDEO_BATCH).map(item => [String(item.accountUrl), item]));
    for (const account of accountMap.values()) {
      if (existingByUrl.has(account.url)) continue;
      await store.create('competitor_accounts', {
        tenantId: TENANT_ID,
        platform: account.platform,
        accountUrl: account.url,
        accountName: account.name,
        handle: account.handle,
        note: `真实公开来源；${[...account.buyerModels].join('/')}；${[...account.categories].join('、')}；原媒体仅供分析，不得直接商用。`,
        lastCrawledAt: OBSERVED_AT,
        lastCrawlCount: selected.filter(item => item.channelUrl === account.url).length + baseline.filter(record => String(safeJson(record.aiAnalysis).sourceAccount || '') === account.url).length,
        sourceBatchId: VIDEO_BATCH,
        createdAt: OBSERVED_AT,
      });
    }
    return backup.directory;
  } catch (error) {
    backup.restore();
    throw error;
  }
}

function curlToFile(url: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  const result = spawnSync('/usr/bin/curl', [
    '--location', '--fail', '--silent', '--show-error', '--retry', '3', '--retry-all-errors', '--max-time', '300',
    '--user-agent', 'Mozilla/5.0 (compatible; LingshuBeautyCrawler/1.0)', '--output', temporary, url,
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0 || !fs.existsSync(temporary) || fs.statSync(temporary).size === 0) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw new Error(`download failed for ${url}: ${String(result.stderr || '').trim()}`);
  }
  fs.renameSync(temporary, target);
}

function loadManifestAssets(): ManifestAsset[] {
  const payload = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')) as { tenantId?: string; assets?: ManifestAsset[] };
  // The checked-in Commons manifest is intentionally tenant-neutral. Ownership
  // is assigned here only after the target local account has been verified.
  if ((payload.tenantId && payload.tenantId !== TENANT_ID) || !Array.isArray(payload.assets)) throw new Error('B2B Commons manifest tenant or assets are invalid');
  const assets = payload.assets.slice(0, 21);
  if (assets.length !== 21 || new Set(assets.map(item => item.shotFunction)).size !== 21) throw new Error('B2B manifest must provide 21 distinct shot functions');
  if (assets.some(item => item.approval.approvedBy !== 'pending-human-rights-review')) throw new Error('B2B manifest review boundary changed unexpectedly');
  return assets;
}

function ensureSource(asset: ManifestAsset): string {
  const parsed = new URL(asset.source.downloadUrl);
  if (!asset.source.approvedDownloadHosts.includes(parsed.hostname)) throw new Error(`unapproved material host: ${parsed.hostname}`);
  const extension = path.extname(parsed.pathname) || '.webm';
  const target = path.join(ASSET_DIR, 'b2b-sources', `${asset.expectedSourceSha256}${extension}`);
  if (!fs.existsSync(target) || sha256File(target) !== asset.expectedSourceSha256) curlToFile(asset.source.downloadUrl, target);
  const actual = sha256File(target);
  if (actual !== asset.expectedSourceSha256) throw new Error(`source hash mismatch for ${asset.source.pageUrl}: ${actual}`);
  return target;
}

function makeB2BMaterial(asset: ManifestAsset, index: number, sourceFile: string): MaterialRecord {
  if (!ffmpegStatic) throw new Error('ffmpeg-static binary is unavailable');
  const fileName = `${asset.id}.mp4`;
  const target = path.join(ASSET_DIR, 'b2b-clips', fileName);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target) || fs.statSync(target).size < 10_000) {
    const temporary = `${target}.${process.pid}.tmp.mp4`;
    const result = spawnSync(String(ffmpegStatic), [
      '-hide_banner', '-loglevel', 'error', '-ss', String(asset.clip.startSeconds), '-i', sourceFile,
      '-t', String(asset.clip.durationSeconds), '-vf', 'scale=720:-2',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-c:a', 'aac', '-movflags', '+faststart', '-y', temporary,
    ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0 || !fs.existsSync(temporary) || fs.statSync(temporary).size < 10_000) {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      throw new Error(`ffmpeg clip failed for ${asset.id}: ${String(result.stderr || '').trim()}`);
    }
    fs.renameSync(temporary, target);
  }
  const relative = path.posix.join(RELATIVE_ASSET_DIR, 'b2b-clips', fileName);
  const segment = { ...(asset.visualReview.segment || {}), id: `${asset.id}-segment`, start: 0, end: asset.clip.durationSeconds, duration: asset.clip.durationSeconds, recommendedFunctions: [asset.shotFunction], needsReview: true };
  return {
    id: `beauty-real-${asset.id}`,
    tenantId: TENANT_ID,
    name: asset.title,
    folder: '美妆B2B公开参考（待人工授权复核）',
    type: 'video',
    duration: asset.clip.durationSeconds,
    size: `${Math.ceil(fs.statSync(target).size / 1024)} KB`,
    file: relative,
    url: `/media/${relative}`,
    poster: '',
    scope: 'own',
    usage: 'reference_only',
    sourceType: 'licensed_reference',
    sourceName: asset.title,
    sourceProvider: asset.source.provider,
    sourceCreator: asset.source.creator,
    sourceUrl: asset.source.pageUrl,
    sourceDownloadUrl: asset.source.downloadUrl,
    sourceFileSha256: asset.expectedSourceSha256,
    contentSha256: sha256File(target),
    licenseEvidence: asset.license.evidence,
    licenseName: asset.license.name,
    licenseUrl: asset.license.url,
    attributionText: asset.license.attributionText,
    licenseEvidenceCapturedAt: asset.license.capturedAt,
    rightsReviewStatus: 'pending_human_review',
    rightsReviewReference: asset.approval.reference,
    rightsReviewRationale: asset.approval.rationale,
    declaredLicenseRights: asset.approval.rights,
    commercialUseApproved: false,
    derivativesApproved: false,
    rawLibraryUseApproved: false,
    mayAnalyze: true,
    mayUseInProduction: false,
    industry: 'beauty_manufacturing',
    buyerModel: 'B2B',
    materialCategory: asset.shotFunction,
    shotFunction: asset.shotFunction,
    applicability: asset.applicability,
    tags: [...asset.tags, 'B2B', 'reference_only', 'pending_human_rights_review'].join(','),
    visualObservations: asset.visualReview.visualObservations || [],
    visualReview: asset.visualReview,
    segmentAnalysisStatus: 'completed',
    segments: [segment],
    provenance: { source: 'wikimedia_commons', sourceUrl: asset.source.pageUrl, downloadUrl: asset.source.downloadUrl, originalSha256: asset.expectedSourceSha256, clipStartSeconds: asset.clip.startSeconds, clipDurationSeconds: asset.clip.durationSeconds, crawledAt: OBSERVED_AT },
    seedBatchId: MATERIAL_BATCH,
    importBatchId: MATERIAL_BATCH,
    createdAt: new Date(Date.parse(OBSERVED_AT) - index * 1_000).toISOString(),
  };
}

async function fetchJson(url: string): Promise<any> {
  const result = spawnSync('/usr/bin/curl', [
    '--location', '--fail', '--silent', '--show-error', '--retry', '3', '--retry-all-errors', '--max-time', '90',
    '--user-agent', 'LingshuBeautyCrawler/1.0 (local development)', url,
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`JSON fetch failed for ${url}: ${String(result.stderr || '').trim()}`);
  }
  return JSON.parse(result.stdout);
}

function extValue(metadata: Record<string, any> | undefined, key: string): string {
  return String(metadata?.[key]?.value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function makeCommonsImageMaterial(source: CommonsImageSource, index: number): Promise<MaterialRecord> {
  const title = `File:${source.fileName}`;
  const api = `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url%7Cextmetadata&format=json&formatversion=2&titles=${encodeURIComponent(title)}`;
  const payload = await fetchJson(api);
  const page = payload?.query?.pages?.[0];
  const info = page?.imageinfo?.[0];
  const downloadUrl = String(info?.url || '');
  const metadata = info?.extmetadata as Record<string, any> | undefined;
  const license = extValue(metadata, 'LicenseShortName');
  const artist = extValue(metadata, 'Artist') || source.creator;
  const canonical = String(info?.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`);
  if (!/^https:\/\/upload\.wikimedia\.org\//.test(downloadUrl) || !license.toLowerCase().includes(source.expectedLicense.toLowerCase())) {
    throw new Error(`Commons license/source verification failed for ${source.fileName}: ${license}`);
  }
  const target = path.join(ASSET_DIR, 'b2c-images', `${source.id}.jpg`);
  if (!fs.existsSync(target) || fs.statSync(target).size < 10_000) curlToFile(downloadUrl, target);
  const image = sharp(target);
  const metadataImage = await image.metadata();
  if (!metadataImage.width || !metadataImage.height) throw new Error(`invalid image: ${source.fileName}`);
  const relative = path.posix.join(RELATIVE_ASSET_DIR, 'b2c-images', `${source.id}.jpg`);
  return {
    id: `beauty-real-b2c-${source.id}`,
    tenantId: TENANT_ID,
    name: source.name,
    folder: '美妆B2C公开参考（待人工授权复核）',
    type: 'image',
    duration: 0,
    width: metadataImage.width,
    height: metadataImage.height,
    size: `${Math.ceil(fs.statSync(target).size / 1024)} KB`,
    file: relative,
    url: `/media/${relative}`,
    poster: `/media/${relative}`,
    scope: 'own',
    usage: 'reference_only',
    sourceType: 'licensed_reference',
    sourceName: source.name,
    sourceProvider: 'Wikimedia Commons',
    sourceCreator: artist,
    sourceUrl: canonical,
    sourceDownloadUrl: downloadUrl,
    contentSha256: sha256File(target),
    licenseEvidence: canonical,
    licenseName: license,
    licenseUrl: extValue(metadata, 'LicenseUrl'),
    attributionText: `${source.name} — ${artist}，${license}，来源：${canonical}`,
    licenseEvidenceCapturedAt: OBSERVED_AT,
    licenseEvidenceTextSha256: createHash('sha256').update(`${canonical}|${artist}|${license}`).digest('hex'),
    rightsReviewStatus: 'pending_human_review',
    rightsReviewRationale: '著作权许可已从 Commons API 核验；人物、商标、场地与 SaaS 商用边界仍需受信任的人类审核员复核。',
    commercialUseApproved: false,
    derivativesApproved: false,
    rawLibraryUseApproved: false,
    mayAnalyze: true,
    mayUseInProduction: false,
    industry: 'beauty_consumer',
    buyerModel: 'B2C',
    materialCategory: source.category,
    shotFunction: source.category,
    applicability: 'consumer_beauty_reference',
    tags: [...source.tags, 'reference_only', 'pending_human_rights_review'].join(','),
    visualObservations: [source.description, `许可：${license}`, '待人工检查人物、商标与场景权利'],
    segmentAnalysisStatus: 'completed',
    segments: [{ id: `beauty-real-b2c-${source.id}-segment`, start: 0, end: 1, duration: 1, subject: source.tags.slice(0, 3), action: source.description, shot: '公开图片参考', camera: '静态图片', environment: '美妆消费场景', recommendedFunctions: [source.category], authenticity: '只描述原图可见内容，不把外部产品或人物误认为客户资产', confidence: 0.9, needsReview: true }],
    provenance: { source: 'wikimedia_commons_api', sourceUrl: canonical, downloadUrl, crawledAt: OBSERVED_AT, licenseObserved: license },
    seedBatchId: MATERIAL_BATCH,
    importBatchId: MATERIAL_BATCH,
    createdAt: new Date(Date.parse(OBSERVED_AT) - (21 + index) * 1_000).toISOString(),
  };
}

async function writeMaterials(): Promise<string> {
  fs.mkdirSync(ASSET_DIR, { recursive: true });
  const manifest = loadManifestAssets();
  const sourceCache = new Map<string, string>();
  const b2b: MaterialRecord[] = [];
  for (const [index, asset] of manifest.entries()) {
    let sourceFile = sourceCache.get(asset.expectedSourceSha256);
    if (!sourceFile) {
      sourceFile = ensureSource(asset);
      sourceCache.set(asset.expectedSourceSha256, sourceFile);
    }
    b2b.push(makeB2BMaterial(asset, index, sourceFile));
  }
  const b2c: MaterialRecord[] = [];
  for (const [index, source] of commonsImages.entries()) b2c.push(await makeCommonsImageMaterial(source, index));
  const materialFile = path.resolve(ROOT, 'data', 'materials.json');
  const backup = backupFiles('beauty-real-crawl-materials', [materialFile]);
  try {
    const current = readLocalMaterials();
    const withoutBatch = current.filter(item => !(String(item.tenantId || item.tenant_id || '') === TENANT_ID && item.seedBatchId === MATERIAL_BATCH));
    const baseline = withoutBatch.filter(item => String(item.tenantId || item.tenant_id || '') === TENANT_ID && item.seedBatchId === BASELINE_BATCH);
    if (baseline.length !== 5) throw new Error(`expected five baseline beauty materials, got ${baseline.length}`);
    const patchedBaseline = baseline.map((item, index) => ({ ...item, buyerModel: 'B2C', materialCategory: baselineMaterialCategories[index], audienceCategory: 'consumer_beauty' }));
    const baselineIds = new Set(baseline.map(item => String(item.id)));
    saveLocalMaterials([...withoutBatch.filter(item => !baselineIds.has(String(item.id))), ...patchedBaseline, ...b2b, ...b2c]);
    return backup.directory;
  } catch (error) {
    backup.restore();
    throw error;
  }
}

async function verify(): Promise<Record<string, unknown>> {
  const [videoResult, competitorResult] = await Promise.all([
    store.list<Record<string, any>>('trend_videos', { where: { tenantId: TENANT_ID }, page: 1, perPage: 500 }),
    store.list<Record<string, any>>('competitor_accounts', { where: { tenantId: TENANT_ID }, page: 1, perPage: 500 }),
  ]);
  const videos = videoResult.items;
  const videoAnalyses = videos.map(item => ({ record: item, analysis: safeJson(item.aiAnalysis) }));
  const materials = readLocalMaterials().filter(item => String(item.tenantId || item.tenant_id || '') === TENANT_ID);
  const videoB2B = videoAnalyses.filter(item => item.analysis.buyerModel === 'B2B').length;
  const videoB2C = videoAnalyses.filter(item => item.analysis.buyerModel === 'B2C').length;
  const materialB2B = materials.filter(item => item.buyerModel === 'B2B').length;
  const materialB2C = materials.filter(item => item.buyerModel === 'B2C').length;
  const sourceUrls = videos.map(item => String(item.sourceUrl || '')).filter(Boolean);
  const categories = materials.map(item => String(item.materialCategory || '')).filter(Boolean);
  const accountUrls = new Set(competitorResult.items.map(item => String(item.accountUrl || '')).filter(Boolean));
  const missingAccounts = videoAnalyses.filter(item => !accountUrls.has(String(item.analysis.sourceAccount || ''))).map(item => item.record.sourceUrl);
  const commercialBoundaryViolations = materials.filter(item => item.usage === 'reference_only' && (item.commercialUseApproved === true || item.mayUseInProduction === true));
  const result = {
    tenantId: TENANT_ID,
    videos: { total: videos.length, B2B: videoB2B, B2C: videoB2C, uniqueSourceUrls: new Set(sourceUrls).size, publicReferenceOnly: videoAnalyses.filter(item => item.analysis.rightsStatus?.mayUseOriginalMedia === false).length },
    competitorAccounts: { total: competitorResult.items.length, everyVideoLinked: missingAccounts.length === 0, missingAccountLinks: missingAccounts },
    materials: { total: materials.length, B2B: materialB2B, B2C: materialB2C, videos: materials.filter(item => item.type === 'video').length, images: materials.filter(item => item.type === 'image').length, distinctCategories: new Set(categories).size, productionEligible: materials.filter(item => item.commercialUseApproved === true && item.usage !== 'reference_only').length, pendingHumanRightsReview: materials.filter(item => item.rightsReviewStatus === 'pending_human_review').length },
    safety: { referenceCommercialBoundaryViolations: commercialBoundaryViolations.map(item => item.id) },
  };
  const valid = videos.length === 30 && videoB2B === 21 && videoB2C === 9 && new Set(sourceUrls).size === 30
    && materials.length === 30 && materialB2B === 21 && materialB2C === 9 && new Set(categories).size === 30
    && missingAccounts.length === 0 && commercialBoundaryViolations.length === 0;
  if (!valid) throw new Error(`beauty crawl verification failed: ${JSON.stringify(result)}`);
  return result;
}

assertAccount();
await runWithDataAuthority('local', async () => {
  if (PHASE === 'preview') {
    const selected = crawlYoutubeSelection();
    console.log(JSON.stringify({ phase: PHASE, selected: selected.map(item => ({ buyerModel: item.buyerModel, category: item.categoryLabel, title: item.title, views: item.views, duration: item.duration, account: item.channelName, sourceUrl: item.sourceUrl, rank: `${item.rankInPool}/${item.candidatePoolSize}` })) }, null, 2));
    return;
  }
  const backups: string[] = [];
  if (PHASE === 'videos' || PHASE === 'all') {
    const selected = crawlYoutubeSelection();
    backups.push(await writeVideosAndAccounts(selected));
    console.log(JSON.stringify({ milestone: 'videos', imported: selected.length, B2B: 21, B2C: 4, baselineB2C: 5, backups }, null, 2));
  }
  if (PHASE === 'materials' || PHASE === 'all') {
    backups.push(await writeMaterials());
    console.log(JSON.stringify({ milestone: 'materials', imported: 25, B2B: 21, B2C: 4, baselineB2C: 5, backups }, null, 2));
  }
  if (PHASE === 'verify' || PHASE === 'all') console.log(JSON.stringify({ milestone: 'verify', ...(await verify()) }, null, 2));
});
